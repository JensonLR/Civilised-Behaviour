import { describe, expect, it } from "vitest";
import { Box3, BufferGeometry, Vector3 } from "three";
import { CAMP, createArena, villagePlan, GATE_CLOCK_Y } from "@cb/shared";
import { addOutlineNormals } from "@cb/procedural/three";
import { Kit, weldedOutlineNormals } from "./kit.ts";
import { buildVillage, LAMP_SWING } from "./village.ts";
import { hqSolid, hqCloth } from "./hq.ts";
import { windmillGeometry, WINDMILL } from "./windmill.ts";
import { cliffGeometry } from "./flora.ts";
import { crateSlim } from "./objects.ts";
import { buildShafts, createShaftUniforms } from "./shafts.ts";
import type { WindowPane } from "./camplife.ts";

/** Fraction of triangles whose winding agrees with their stored vertex normals (what shading actually uses). */
function windingAgreement(g: BufferGeometry): number {
  const p = g.attributes.position!;
  const n = g.attributes.normal!;
  let ok = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const nn = new Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const face = b.sub(a).cross(c.sub(a));
    if (face.lengthSq() < 1e-14) {
      ok++;
      continue;
    }
    nn.fromBufferAttribute(n, i);
    if (face.dot(nn) > 0) ok++;
  }
  return ok / (p.count / 3);
}

function expectFinite(g: BufferGeometry, attrs: string[], name: string): void {
  for (const attr of attrs) {
    const a = g.getAttribute(attr);
    expect(a, `${name} needs ${attr}`).toBeDefined();
    for (let i = 0; i < a!.count; i++) {
      expect(Number.isFinite(a!.getX(i)), `${name} ${attr}[${i}]`).toBe(true);
      if (a!.itemSize >= 2) expect(Number.isFinite(a!.getY(i)), `${name} ${attr}[${i}].y`).toBe(true);
      if (a!.itemSize >= 3) expect(Number.isFinite(a!.getZ(i)), `${name} ${attr}[${i}].z`).toBe(true);
    }
  }
}

const bounds = (g: BufferGeometry): Box3 => new Box3().setFromBufferAttribute(g.attributes.position as never);

describe("the settlement mesh", () => {
  const world = createArena(7);
  const plan = villagePlan(world.terrain);
  const panes: WindowPane[] = [];
  const stats: Record<string, number> = {};
  const geo = buildVillage(world, 1, stats, panes)!;

  it("is one finite merged non-indexed geometry with colour, an ink normal and the sway kind, and its faces agree with their normals", () => {
    expect(geo).toBeDefined();
    expect(geo.index).toBeNull();
    expect(geo.attributes.position!.count % 3).toBe(0);
    expectFinite(geo, ["position", "normal", "color", "onormal"], "village");
    const sway = geo.getAttribute("aSway");
    expect(sway).toBeDefined();
    const kinds = new Set<number>();
    for (let i = 0; i < sway!.count; i++) {
      expect(Number.isFinite(sway!.getX(i))).toBe(true);
      kinds.add(Math.floor(sway!.getX(i)));
    }
    // cloth (0-1), the mill wheel (2), the punt (3) and the gate clock's hands (4-7) all exist
    for (const k of [0, 2, 3, 4]) expect(kinds.has(k), `sway kind ${k}`).toBe(true);
    const on = geo.attributes.onormal!;
    for (let i = 0; i < on.count; i += 11) expect(Math.hypot(on.getX(i), on.getY(i), on.getZ(i))).toBeCloseTo(1, 3);
    expect(windingAgreement(geo)).toBeGreaterThan(0.97);
  }, 60_000);

  it("stays over the village: inside the map, nothing buried, the gate tower and the clock at their planned height", () => {
    const b = bounds(geo);
    const gate = plan.buildings.find((x) => x.id === "gate")!;
    expect(b.min.x).toBeGreaterThan(-80);
    expect(b.max.x).toBeLessThan(40);
    expect(b.min.z).toBeGreaterThan(-90);
    expect(b.max.z).toBeLessThan(-20);
    // the tallest thing is the gate tower with its clock: above the clock, but no more than ~ 5 m over it
    expect(b.max.y).toBeGreaterThan(gate.ground + GATE_CLOCK_Y);
    expect(b.max.y).toBeLessThan(gate.ground + GATE_CLOCK_Y + 8);
    // and the lowest is the pond bed under the jetty piles / the weir apron, not something fallen through the world
    expect(b.min.y).toBeGreaterThan(plan.jetty.waterY - 3);
  });

  it("every building kind, the wheel, the waterside and the props were built, and the low-detail hull is cheaper", () => {
    for (const k of ["cottage", "stilt", "granary", "hall", "workshop", "mill", "clock", "stall", "wheel", "waterside", "fences", "gardens", "lamps"]) expect(stats[k], k).toBeGreaterThan(0);
    const hull = buildVillage(world, 0)!;
    expect(hull.attributes.position!.count).toBeLessThan(geo.attributes.position!.count * 0.7);
    expectFinite(hull, ["position", "normal", "color", "onormal"], "village hull");
  }, 60_000);

  it("collects a lit window pane for the lantern glass at lod 1 and none at lod 0", () => {
    expect(panes.length).toBeGreaterThan(10);
    for (const p of panes) for (const v of [p.x, p.y, p.z]) expect(Number.isFinite(v)).toBe(true);
    const none: WindowPane[] = [];
    buildVillage(world, 0, undefined, none);
    expect(none.length).toBe(0);
  });

  it("builds nothing for an empty world (the menu backdrop)", () => {
    expect(buildVillage({ obstacles: [] } as never, 1)).toBeUndefined();
    expect(LAMP_SWING).toBeGreaterThan(0);
  });
});

describe("the expedition HQ", () => {
  const world = createArena(7);
  const solid = ((): BufferGeometry => {
    const k = new Kit();
    hqSolid(k, world, 1);
    return k.build()!;
  })();
  const cloth = ((): BufferGeometry => {
    const k = new Kit({ sway: true });
    hqCloth(k, world, 1);
    return k.build()!;
  })();

  it("the solid parts and the cloth are finite, outward-facing and stay within the marquee's footprint and height", () => {
    const h = CAMP.hq;
    for (const [name, g] of [["hq solid", solid], ["hq cloth", cloth]] as const) {
      expectFinite(g, ["position", "normal", "color", "onormal"], name);
      expect(windingAgreement(g), name).toBeGreaterThan(0.97);
      const b = bounds(g);
      const ground = world.terrainHeight(h.x, h.z);
      // the pavilion, its poles, the supply pyramid and the crates in front of it (+x): within a few metres of the pavilion and below its ridge plus the flag poles
      expect(b.min.x).toBeGreaterThan(h.x - h.hx - 2.5);
      expect(b.max.x).toBeLessThan(h.x + h.hx + 6);
      expect(b.min.z).toBeGreaterThan(h.z - h.hz - 3);
      expect(b.max.z).toBeLessThan(h.z + h.hz + 3);
      expect(b.max.y - ground).toBeLessThan(h.ridge + 1.5);
      expect(b.min.y - ground).toBeGreaterThan(-0.7);
    }
    // the cloth flutters: it carries a sway weight that is zero somewhere (pinned) and positive somewhere (loose)
    const sw = cloth.getAttribute("aSway")!;
    const vals = Array.from({ length: sw.count }, (_, i) => sw.getX(i));
    expect(Math.min(...vals)).toBeLessThan(0.01);
    expect(Math.max(...vals)).toBeGreaterThan(0.2);
  });
});

describe("the windmill on the second summit", () => {
  const g = windmillGeometry();
  it("is finite, outward-facing, stands on y = 0 with the hub and sails at their planned height, and the sails (and only they) carry sway = 1", () => {
    expectFinite(g, ["position", "normal", "color", "onormal", "aSway"], "windmill");
    expect(windingAgreement(g)).toBeGreaterThan(0.97);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    // the finial tops the cap; the sails reach hubY + sail above the hub only for the sail pointing up
    expect(b.max.y).toBeGreaterThan(WINDMILL.hubY + WINDMILL.sail * 0.8);
    const sw = g.getAttribute("aSway")!;
    const pos = g.attributes.position!;
    let moving = 0;
    for (let i = 0; i < sw.count; i++) {
      if (sw.getX(i) === 1) {
        moving++;
        // a turning vertex is on the sail side of the hub plane (x >= hubX - 1) and within the sail's reach of the hub
        expect(pos.getX(i)).toBeGreaterThan(WINDMILL.hubX - 1);
        expect(Math.hypot(pos.getY(i) - WINDMILL.hubY, pos.getZ(i))).toBeLessThan(WINDMILL.sail + 0.8);
      }
    }
    expect(moving).toBeGreaterThan(200);
    expect(moving).toBeLessThan(sw.count / 1.5);
  });
});

describe("crags and slim crates", () => {
  it("a cliff is a finite stack of ledges facing outward, standing on the ground, cheaper at lod 0", () => {
    const a = cliffGeometry(1);
    const h = cliffGeometry(0);
    for (const [name, g] of [["cliff", a], ["cliff hull", h]] as const) {
      expectFinite(g, ["position", "normal", "color", "onormal"], name);
      expect(windingAgreement(g), name).toBeGreaterThan(0.99);
    }
    a.computeBoundingBox();
    expect(a.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.5);
    expect(a.boundingBox!.max.y).toBeGreaterThan(0.8); // (unit-sized: the scatter scales each crag)
    expect(h.attributes.position!.count).toBeLessThanOrEqual(a.attributes.position!.count);
  });

  it("crateSlim fills its box (to within the slats) and is cheaper than a full crate", () => {
    const k = new Kit();
    crateSlim(k, 0.9, 0.6, 0.7);
    const g = k.build()!;
    expectFinite(g, ["position", "normal", "color", "onormal"], "crate");
    expect(windingAgreement(g)).toBeGreaterThan(0.99);
    const s = bounds(g).getSize(new Vector3());
    expect(s.x).toBeGreaterThan(0.86);
    expect(s.x).toBeLessThan(0.96);
    expect(s.y).toBeGreaterThan(0.56);
    expect(s.y).toBeLessThan(0.66);
    expect(s.z).toBeGreaterThan(0.66);
    expect(s.z).toBeLessThan(0.76);
    expect(g.attributes.position!.count / 3).toBeLessThan(140);
  });
});

describe("canopy sun shafts", () => {
  it("are one instanced quad set with finite per-instance shape and their own shared uniforms", () => {
    const u = createShaftUniforms();
    const m = buildShafts([{ x: 1, y: 0, z: 2, height: 9, width: 2, v: 0.3 }, { x: -4, y: 1, z: 5, height: 12, width: 1.5, v: 0.8 }] as never, u)!;
    expect(m.count).toBe(2);
    const info = m.geometry.getAttribute("aShaft")!;
    for (let i = 0; i < info.count; i++) for (const v of [info.getX(i), info.getY(i), info.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
    expect((m.material as unknown as { uniforms: Record<string, unknown> }).uniforms.uShaft).toBe(u.uShaft);
    expect(buildShafts([], u)).toBeUndefined();
  });
});

describe("welded ink normals", () => {
  it("agree with the character package's addOutlineNormals on a merged scenery solid", () => {
    const k = new Kit();
    crateSlim(k, 0.9, 0.6, 0.7);
    const g = k.build()!; // built with weldedOutlineNormals
    const ref = g.clone();
    ref.deleteAttribute("onormal");
    addOutlineNormals(ref);
    const a = g.attributes.onormal!;
    const b = ref.attributes.onormal!;
    expect(a.count).toBe(b.count);
    for (let i = 0; i < a.count; i++) {
      expect(a.getX(i)).toBeCloseTo(b.getX(i), 4);
      expect(a.getY(i)).toBeCloseTo(b.getY(i), 4);
      expect(a.getZ(i)).toBeCloseTo(b.getZ(i), 4);
    }
    // and it can be re-run on its own output without changing it
    const again = g.clone();
    weldedOutlineNormals(again);
    for (let i = 0; i < a.count; i += 9) expect(again.attributes.onormal!.getX(i)).toBeCloseTo(a.getX(i), 4);
  });
});
