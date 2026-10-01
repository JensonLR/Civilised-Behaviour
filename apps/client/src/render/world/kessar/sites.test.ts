import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3, type BufferGeometry } from "three";
import { KESSAR_SITES as S, createKessarWorld, kessarPlan } from "./shared.ts";
import { buildKessarSites } from "./sites.ts";

/** Geometry-only checks: the author of the sites could not run the screenshot tool, so what these prove is budgets, placement and palette discipline, NOT looks. */
const world = createKessarWorld(7);
const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
const bounds = (g: BufferGeometry, near: { x: number; z: number }, r: number): boolean => {
  const p = g.attributes.position!.array as ArrayLike<number>;
  for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i]! - near.x, p[i + 2]! - near.z) < r) return true;
  return false;
};

describe("Kessar sites geometry", () => {
  const hi = buildKessarSites(world, 1)!;
  const lo = buildKessarSites(world, 0)!;

  it("builds one non-empty merged geometry at both LODs, with finite attributes and the ink normals", () => {
    for (const g of [hi, lo]) {
      expect(g).toBeDefined();
      expect(tris(g)).toBeGreaterThan(300);
      for (const key of Object.keys(g.attributes)) {
        const a = g.attributes[key]!.array as ArrayLike<number>;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`${key}[${i}] is ${a[i]}`);
      }
      expect(g.attributes.color).toBeDefined();
      expect(g.attributes.normal).toBeDefined();
      expect(g.attributes.onormal).toBeDefined();
    }
  });

  it("stays inside the budget (one draw, one ink hull: +2 calls) and the cheap LOD is cheaper", () => {
    expect(tris(hi)).toBeLessThan(14_000);
    expect(tris(lo)).toBeLessThan(tris(hi));
    expect(tris(lo)).toBeLessThan(9_000);
  });

  it("puts things where the plan says: the camp, the Cut, the ford and both flags", () => {
    const plan = kessarPlan();
    for (const t of plan.sites.camp.tents) expect(bounds(hi, t, 2.5), `tent at ${t.x}, ${t.z}`).toBe(true);
    expect(bounds(hi, plan.sites.camp.wagon, 1.8)).toBe(true);
    expect(bounds(hi, plan.sites.camp.fire, 0.9)).toBe(true);
    expect(bounds(hi, plan.sites.cut.keg, 0.6)).toBe(true);
    expect(bounds(hi, plan.sites.ford.marker, 0.7)).toBe(true);
    for (const f of plan.sites.ford.flags) expect(bounds(hi, f, 0.3)).toBe(true);
    // nothing strays: every vertex is within a bounded distance of a site point
    const anchors = [S.hostage.cage, ...S.hostage.posts, S.convoy.cut, S.border.marker, ...plan.sites.ford.flags, plan.sites.camp.fire, plan.sites.camp.flag];
    const p = hi.attributes.position!.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i += 3) {
      const near = anchors.some((a) => Math.hypot(p[i]! - a.x, p[i + 2]! - a.z) < 14);
      if (!near) throw new Error(`stray vertex at ${p[i]}, ${p[i + 2]}`);
    }
  });

  it("is deterministic, rises from the ground and stays low (no tower, nothing underground)", () => {
    const again = buildKessarSites(world, 1)!;
    expect(Array.from(again.attributes.position!.array)).toEqual(Array.from(hi.attributes.position!.array));
    const box = new Box3().setFromBufferAttribute(hi.attributes.position as never);
    expect(box.max.y - box.min.y).toBeGreaterThan(5);
    expect(box.max.y - box.min.y).toBeLessThan(40);
    const sy = world.terrainHeight(S.hostage.cage.x, S.hostage.cage.z);
    expect(box.min.y).toBeGreaterThan(sy - 6);
  });

  it("uses palette colours only: no colour literal in the source", () => {
    const src = readFileSync(join(process.cwd().endsWith("client") ? "src" : "apps/client/src", "render/world/kessar/sites.ts"), "utf8");
    expect(/0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(src)).toBe(false);
  });
});
