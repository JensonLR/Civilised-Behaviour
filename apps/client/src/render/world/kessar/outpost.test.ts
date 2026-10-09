import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BufferGeometry } from "three";
import { Box3 } from "three";
import { KESSAR_OUTPOST, OUTPOST_STAGES, RING_R, createKessarWorld, outpostPlan, type OutpostStage, type RegionDress } from "@cb/shared";
import { buildOutpostGeometry, buildRoadRibbon } from "./outpost.ts";

/** Geometry-only checks (the outpost's looks were not looked at by anybody: BUILD_STATE says so): finite, placed where the plan says, within budget, palette only. */
const world = createKessarWorld(7);
const dress = (outpost: OutpostStage, o: Partial<RegionDress> = {}): RegionDress => ({ outpost, rivalPost: 0, road: 0, telegraph: false, launch: false, name: "Quim's Rest", ...o });
const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
const S = KESSAR_OUTPOST.site;

describe("outpost geometry", () => {
  it("every stage builds one finite merged geometry with colours and ink normals, at both LODs; the cheap LOD is cheaper", () => {
    let prev = 0;
    for (const st of OUTPOST_STAGES) {
      const hi = buildOutpostGeometry(world, dress(st), 1)!;
      const lo = buildOutpostGeometry(world, dress(st), 0)!;
      expect(hi, st).toBeDefined();
      for (const g of [hi, lo]) {
        for (const key of Object.keys(g.attributes)) {
          const a = g.attributes[key]!.array as ArrayLike<number>;
          for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`${st} ${key}[${i}] is ${a[i]}`);
        }
        expect(g.attributes.color).toBeDefined();
        expect(g.attributes.onormal).toBeDefined();
      }
      expect(tris(lo)).toBeLessThanOrEqual(tris(hi));
      expect(tris(hi)).toBeGreaterThanOrEqual(prev);
      prev = tris(hi);
    }
  });

  it("the budget: a whole town is one solid (+ one hull) under 60k triangles; a camp under 8k", () => {
    expect(tris(buildOutpostGeometry(world, dress("camp"), 1)!)).toBeLessThan(8_000);
    expect(tris(buildOutpostGeometry(world, dress("town", { telegraph: true, launch: true, rivalPost: 2 }), 1)!)).toBeLessThan(60_000);
  });

  it("puts every plan piece where the collision world has it, and keeps the yard clear of solids", () => {
    for (const st of OUTPOST_STAGES) {
      const g = buildOutpostGeometry(world, dress(st), 1)!;
      const p = g.attributes.position!.array as ArrayLike<number>;
      for (const piece of outpostPlan(st).pieces.filter((x) => x.solid)) {
        const r = (piece.shape === "circle" ? piece.hx : Math.hypot(piece.hx, piece.hz)) + 1.5;
        let found = false;
        for (let i = 0; i < p.length && !found; i += 3) found = Math.hypot(p[i]! - piece.x, p[i + 2]! - piece.z) < r;
        expect(found, `${st} ${piece.kind} at ${piece.x}, ${piece.z}`).toBe(true);
      }
      // nothing solid is drawn inside the delivery yard (bar the foundation's own stakes and string, which are slender)
      if (st !== "none") for (let i = 0; i < p.length; i += 3) expect(Math.hypot(p[i]! - S.x, p[i + 2]! - S.z) > 3.5 || p[i + 1]! < world.terrainHeight(S.x, S.z) + 2, `${st} vertex in the yard`).toBe(true);
    }
  });

  it("the dress adds the telegraph's poles, the launch and the Syndicate's post, each as more geometry, and nothing strays beyond its own site", () => {
    const base = tris(buildOutpostGeometry(world, dress("settlement"), 1)!);
    for (const o of [{ telegraph: true }, { launch: true }, { rivalPost: 1 as const }, { rivalPost: 2 as const }]) expect(tris(buildOutpostGeometry(world, dress("settlement", o), 1)!)).toBeGreaterThan(base);
    expect(buildOutpostGeometry(world, dress("none"), 1)).toBeDefined(); // the foundation is drawn even before there is a camp
    const g = buildOutpostGeometry(world, dress("town", { telegraph: true, launch: true, rivalPost: 2 }), 1)!;
    const box = new Box3().setFromBufferAttribute(g.attributes.position as never);
    expect(box.max.y - box.min.y).toBeLessThan(45);
    expect(Math.hypot(S.x, S.z) + RING_R).toBeLessThan(200);
  });

  it("is deterministic", () => {
    const a = buildOutpostGeometry(world, dress("town", { telegraph: true }), 1)!;
    const b = buildOutpostGeometry(world, dress("town", { telegraph: true }), 1)!;
    expect(Array.from(a.attributes.position!.array)).toEqual(Array.from(b.attributes.position!.array));
  });

  it("the road is a ground ribbon: none at level 0, wider at level 2, finite and hugging the terrain", () => {
    expect(buildRoadRibbon(world, 0)).toBeUndefined();
    const r1 = buildRoadRibbon(world, 1)!, r2 = buildRoadRibbon(world, 2)!;
    // (D-091: both levels run the one way, out through the gate; level 2 is the same road, wider. Each cross-section is three vertices, edge to edge.)
    const width = (g: typeof r1): number => {
      const q = g.attributes.position!.array as ArrayLike<number>;
      return Math.hypot(q[6]! - q[0]!, q[8]! - q[2]!);
    };
    expect(tris(r2)).toBe(tris(r1));
    expect(width(r1)).toBeCloseTo(2.2, 3);
    expect(width(r2)).toBeCloseTo(3.4, 3);
    const p = r2.attributes.position!.array as ArrayLike<number>;
    for (let i = 0; i < p.length; i += 3) {
      expect(Number.isFinite(p[i]! + p[i + 1]! + p[i + 2]!)).toBe(true);
      expect(Math.abs(p[i + 1]! - world.terrainHeight(p[i]!, p[i + 2]!))).toBeLessThan(0.1);
    }
  });

  it("uses palette colours only: no colour literal in the source", () => {
    for (const f of ["outpost.ts", "../hqHistory.ts"]) {
      const src = readFileSync(join(process.cwd().endsWith("client") ? "src" : "apps/client/src", "render/world/kessar", f), "utf8");
      expect(/0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(src), f).toBe(false);
    }
  });
});
