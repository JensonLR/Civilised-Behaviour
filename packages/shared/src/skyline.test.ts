import { describe, expect, it } from "vitest";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { createRegionWorld, regionLanding } from "./regions.ts";
import { skylineDistance, skylineFrom, skylineStats } from "./skyline.ts";

/**
 * D-037: the skyline tool that makes "a distinct silhouette" a measurable acceptance (packages C3 and D4 assert their region's targets from their landing and the middle of their route; docs/_notes/regions34.md).
 * Here: the tool itself on synthetic worlds, determinism, and that it tells the existing regions' landings apart from a wall of rock and from a flat marsh.
 */
const flat = (obstacles: Obstacle[] = []): CollisionWorld => new CollisionWorld({ height: () => 0 }, obstacles, 120);
const box = (x: number, z: number, hx: number, hz: number, y1: number): Obstacle => ({ kind: "box", x, z, hx, hz, yaw: 0, y0: 0, y1 });

describe("skyline", () => {
  it("an empty plain is an open horizon: every bin at or below zero, nothing walled, no spikes", () => {
    const s = skylineStats(skylineFrom(flat(), 0, 0));
    expect(s.open).toBe(1);
    expect(s.walled).toBe(0);
    expect(s.spikes).toBe(0);
    expect(s.max).toBeLessThanOrEqual(0);
  });
  it("a ring of tall walls is walled in on every side; a lone mast is one spike on an open line", () => {
    const ring: Obstacle[] = [box(0, -30, 40, 3, 30), box(0, 30, 40, 3, 30), box(-30, 0, 3, 40, 30), box(30, 0, 3, 40, 30)];
    const walled = skylineStats(skylineFrom(flat(ring), 0, 0));
    expect(walled.walled).toBeGreaterThan(0.95);
    expect(walled.mean).toBeGreaterThan(20);
    const mast = skylineStats(skylineFrom(flat([{ kind: "circle", x: 12, z: -30, r: 0.4, y0: 0, y1: 14 }]), 0, 0));
    expect(mast.spikes).toBeGreaterThanOrEqual(1);
    expect(mast.open).toBeGreaterThan(0.9);
    expect(mast.max).toBeGreaterThan(10);
  });
  it("is deterministic, finite, and sensitive: the two older regions read as themselves from their landings", () => {
    const k = createRegionWorld("kessar", 7), h = createRegionWorld("highmark", 7);
    const kl = regionLanding("kessar"), hl = regionLanding("highmark");
    const a = skylineFrom(k, kl.x, kl.z), a2 = skylineFrom(k, kl.x, kl.z), b = skylineFrom(h, hl.x, hl.z);
    expect(a).toEqual(a2);
    for (const v of [...a, ...b]) expect(Number.isFinite(v)).toBe(true);
    expect(a.length).toBe(72);
    expect(skylineDistance(a, a)).toBe(0);
    expect(skylineDistance(a, b)).toBeGreaterThan(0.5);
    // both landings face open water behind them and one great mass ahead: neither is a cleft, neither is a flat line with hairs on it
    for (const s of [skylineStats(a), skylineStats(b)]) {
      expect(s.walled).toBeLessThan(0.2);
      expect(s.max).toBeGreaterThan(10);
    }
    // from the middle of Kessar's river gorge (the bridge) the walls close in: the tool sees a cleft
    expect(skylineStats(skylineFrom(k, 0, 20)).walled).toBeGreaterThan(0.9);
  });
});
