import { Group, Scene } from "three";
import { describe, expect, it } from "vitest";
import { DEBRIS, LimbDebris } from "./LimbDebris.ts";

const flat = (): number => 0;
const limb = (): Group => new Group();
const run = (d: LimbDebris, seconds: number, dt = 1 / 30): void => {
  for (let t = 0; t < seconds; t += dt) d.update(dt);
};

describe("LimbDebris", () => {
  it("flies off in the direction of the blow, lands, and comes to rest flat on the ground", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, flat);
    const g = limb();
    g.position.set(0, 1.1, 0);
    d.spawn(g, 1, 0, 1, "full");
    run(d, 0.5);
    expect(g.position.x).toBeGreaterThan(0.5); // thrown along +x
    run(d, 6);
    expect(g.position.y).toBeCloseTo(DEBRIS.restHeight, 3);
    const x = g.position.x;
    run(d, 1);
    expect(g.position.x).toBeCloseTo(x, 1); // stopped
    // lying: the limb's length axis (-Y) has been laid horizontal
    const axisY = -1 * (1 - 2 * (g.quaternion.x ** 2 + g.quaternion.z ** 2));
    expect(Math.abs(axisY)).toBeLessThan(0.1);
  });

  it("follows uneven ground", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, (x) => 0.5 + 0.2 * Math.sin(x));
    const g = limb();
    g.position.set(0, 2, 0);
    d.spawn(g, 0, 1, 0.5, "off");
    run(d, 8);
    expect(g.position.y).toBeCloseTo(0.5 + 0.2 * Math.sin(g.position.x) + DEBRIS.restHeight, 2);
  });

  it("is capped, dropping the oldest, and cleans up after itself", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, flat);
    const groups = Array.from({ length: DEBRIS.max + 3 }, limb);
    for (const g of groups) d.spawn(g, 1, 0, 0.5, "reduced");
    expect(d.count).toBe(DEBRIS.max);
    expect(groups[0]!.parent).toBeNull();
    expect(groups[groups.length - 1]!.parent).toBe(scene);
    run(d, DEBRIS.life + 1, 0.5);
    expect(d.count).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("shrinks before it vanishes", () => {
    const d = new LimbDebris(new Scene(), flat);
    const g = limb();
    d.spawn(g, 1, 0, 0.5, "full");
    run(d, DEBRIS.life - DEBRIS.fade / 2, 0.25);
    expect(g.scale.x).toBeLessThan(0.7);
    expect(g.scale.x).toBeGreaterThan(0);
  });

  it("survives a zero blow direction and stays finite", () => {
    const d = new LimbDebris(new Scene(), flat);
    const g = limb();
    g.position.set(0, 1, 0);
    d.spawn(g, 0, 0, 0, "full");
    run(d, 5);
    for (const v of [g.position.x, g.position.y, g.position.z, g.quaternion.w]) expect(Number.isFinite(v)).toBe(true);
  });
});
