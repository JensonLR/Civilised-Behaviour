import { Box3, BufferGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CAMP, PROP_DEFS, PropKind, createArena, type PropKindId } from "@cb/shared";
import { acaciaGeometry, boulderGeometry, broadleafGeometry, bushGeometry, flowerGeometry, grassTuftGeometry, pebbleGeometry, snagGeometry, TREE_BASE_RADIUS } from "./flora.ts";
import { Kit } from "./kit.ts";
import { buildBanners, buildFlame, buildLandmarks, cart, luggage, tent } from "./landmarks.ts";
import { crateParts, propGeometry } from "./objects.ts";
import { PALETTE } from "@cb/shared";
import { IcosahedronGeometry } from "three";

const builders: Record<string, (lod: 0 | 1) => BufferGeometry> = {
  broadleaf: broadleafGeometry,
  acacia: acaciaGeometry,
  snag: snagGeometry,
  bush: bushGeometry,
  boulder: boulderGeometry,
  crate: (l) => propGeometry(PropKind.CRATE, l),
  barrel: (l) => propGeometry(PropKind.BARREL, l),
  bottle: (l) => propGeometry(PropKind.BOTTLE, l),
  chair: (l) => propGeometry(PropKind.CHAIR, l),
  tent: (l) => { const k = new Kit(); tent(k, l); return k.build()!; },
  luggage: (l) => { const k = new Kit(); luggage(k, l); return k.build()!; },
  cart: (l) => { const k = new Kit(); cart(k, l); return k.build()!; },
};

const tris = (g: BufferGeometry): number => g.attributes.position!.count / 3;

/** Signed volume of a non-indexed triangle soup: positive when the faces point outward. */
function signedVolume(g: BufferGeometry): number {
  const p = g.attributes.position!;
  let v = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

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
      ok++; // degenerate sliver (a lathe pole): no direction to disagree with
      continue;
    }
    nn.fromBufferAttribute(n, i);
    if (face.dot(nn) > 0) ok++;
  }
  return ok / (p.count / 3);
}

describe("scenery geometry", () => {
  for (const [name, build] of Object.entries(builders)) {
    for (const lod of [1, 0] as const) {
      it(`${name} (lod ${lod}) is finite, carries colour and a unit smoothed outline normal, and its faces agree with their normals`, () => {
        const g = build(lod);
        const pos = g.attributes.position!;
        expect(pos.count % 3).toBe(0);
        expect(g.index).toBeNull();
        for (const attr of ["position", "normal", "color", "onormal"]) {
          const a = g.getAttribute(attr);
          expect(a, `${name} needs ${attr}`).toBeDefined();
          for (let i = 0; i < a!.count; i++) for (const v of [a!.getX(i), a!.getY(i), a!.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
        }
        const on = g.attributes.onormal!;
        for (let i = 0; i < on.count; i += 7) expect(Math.hypot(on.getX(i), on.getY(i), on.getZ(i))).toBeCloseTo(1, 3);
        const col = g.attributes.color!;
        for (let i = 0; i < col.count; i += 5) for (const v of [col.getX(i), col.getY(i), col.getZ(i)]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(windingAgreement(g), name).toBeGreaterThan(0.99);
      });
    }
    it(`${name}'s outline hull is cheaper than the mesh it outlines`, () => {
      expect(tris(build(0))).toBeLessThanOrEqual(tris(build(1)));
    });
  }

  it("rocks, pebbles and shrubs are closed solids facing outward (positive signed volume)", () => {
    for (const g of [boulderGeometry(1), boulderGeometry(0), pebbleGeometry(), bushGeometry(1)]) expect(signedVolume(g)).toBeGreaterThan(0.05);
  });

  it("a tree's trunk base matches the collision radius contract and the crowns lift it to a readable height", () => {
    for (const [name, build, lo, hi] of [["broadleaf", broadleafGeometry, 6.5, 9.5], ["acacia", acaciaGeometry, 5, 7.2], ["snag", snagGeometry, 4.4, 6]] as const) {
      const g = build(1);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, name).toBeGreaterThan(lo);
      expect(g.boundingBox!.max.y, name).toBeLessThan(hi);
      expect(g.boundingBox!.min.y, name).toBeLessThan(0); // buried a little: no floating trunks on slopes
    }
    expect(TREE_BASE_RADIUS).toBeGreaterThan(0.3);
  });

  it("ground cover is small, cheap and pointing up-ish (lit like the ground)", () => {
    for (const g of [grassTuftGeometry(), flowerGeometry()]) {
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeLessThan(0.75);
      expect(tris(g)).toBeLessThanOrEqual(16);
      const n = g.attributes.normal!;
      for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.6);
    }
  });

  it("the jitter moves shared vertices together: a jittered rock has no cracks", () => {
    const k = new Kit();
    k.add(new IcosahedronGeometry(1, 1), { colour: PALETTE.world.rock, flat: true, jitter: 0.2, seed: 9 });
    const g = k.build()!;
    const key = (i: number): string => `${g.attributes.position!.getX(i).toFixed(4)},${g.attributes.position!.getY(i).toFixed(4)},${g.attributes.position!.getZ(i).toFixed(4)}`;
    const jittered = new Set(Array.from({ length: g.attributes.position!.count }, (_, i) => key(i)));
    const plain = new Kit().add(new IcosahedronGeometry(1, 1), { colour: PALETTE.world.rock, flat: true }).build()!;
    const plainKeys = new Set(Array.from({ length: plain.attributes.position!.count }, (_, i) => `${plain.attributes.position!.getX(i).toFixed(3)},${plain.attributes.position!.getY(i).toFixed(3)},${plain.attributes.position!.getZ(i).toFixed(3)}`));
    expect(jittered.size).toBe(plainKeys.size);
    // and it is deterministic
    const again = new Kit().add(new IcosahedronGeometry(1, 1), { colour: PALETTE.world.rock, flat: true, jitter: 0.2, seed: 9 }).build()!;
    expect(Array.from(again.attributes.position!.array)).toEqual(Array.from(g.attributes.position!.array));
  });
});

describe("props stay inside their physics", () => {
  const box = (g: BufferGeometry): Box3 => (g.computeBoundingBox(), g.boundingBox!.clone());
  it("every prop's visual fits its physics extents to within ~5% and fills most of them", () => {
    for (const kind of Object.keys(PROP_DEFS).map(Number) as PropKindId[]) {
      const def = PROP_DEFS[kind];
      const b = box(propGeometry(kind, 1));
      const size = b.getSize(new Vector3());
      const [a0, a1, a2] = def.half;
      // physics height: capsule half-length includes the caps
      const halfY = def.shape === "capsule" ? a1 + a0 : a1;
      const halfX = def.shape === "box" ? a0 : a0;
      const halfZ = def.shape === "box" ? a2 : a0;
      expect(size.y / 2, `${def.name} height`).toBeLessThanOrEqual(halfY * 1.05);
      expect(size.x / 2, `${def.name} x`).toBeLessThanOrEqual(halfX * 1.05);
      expect(size.z / 2, `${def.name} z`).toBeLessThanOrEqual(halfZ * 1.05);
      expect(size.y / 2, `${def.name} fills height`).toBeGreaterThan(halfY * 0.85);
      expect(Math.max(size.x, size.z) / 2, `${def.name} fills width`).toBeGreaterThan(Math.min(halfX, halfZ) * 0.8);
      // centred on the body
      const c = b.getCenter(new Vector3());
      expect(Math.abs(c.y), `${def.name} centred`).toBeLessThan(halfY * 0.15);
    }
  });

  it("a chair's legs stand on the floor of its box and its back reaches the top", () => {
    const b = box(propGeometry(PropKind.CHAIR, 1));
    const h = PROP_DEFS[PropKind.CHAIR].half[1];
    expect(b.min.y).toBeLessThan(-h * 0.9);
    expect(b.max.y).toBeGreaterThan(h * 0.85);
  });
});

describe("camp landmarks", () => {
  it("each hand-made landmark stays inside its collision footprint (ropes and shafts excepted)", () => {
    const within = (b: Box3, hx: number, hz: number, tol = 1.06): void => {
      expect(Math.max(-b.min.x, b.max.x)).toBeLessThanOrEqual(hx * tol);
      expect(Math.max(-b.min.z, b.max.z)).toBeLessThanOrEqual(hz * tol);
    };
    const t = new Kit();
    tent(t, 0);
    const tb = box2(t.build()!);
    within(tb, CAMP.tentHalf.hx, CAMP.tentHalf.hz);
    expect(tb.max.y).toBeLessThanOrEqual(CAMP.tentHalf.height * 1.05);
    expect(tb.max.y).toBeGreaterThan(CAMP.tentHalf.height * 0.9);
    const l = new Kit();
    luggage(l, 0);
    const lb = box2(l.build()!);
    within(lb, CAMP.luggage.hx, CAMP.luggage.hz);
    expect(lb.max.y).toBeLessThanOrEqual(CAMP.luggage.height * 1.05);
    expect(lb.max.y).toBeGreaterThan(CAMP.luggage.height * 0.9);
    const k = new Kit();
    crateParts(k, 1.2, 0.9, 1.2, 0);
    within(box2(k.build()!), 0.6, 0.6, 1.03);
  });

  it("the whole camp is one merged geometry (one draw + one hull); the flame is separate and unlit", () => {
    const w = createArena(7);
    const camp = buildLandmarks(w, 1)!;
    const hull = buildLandmarks(w, 0)!;
    expect(camp).toBeDefined();
    expect(tris(hull)).toBeLessThan(tris(camp));
    expect(tris(camp)).toBeLessThan(20000);
    expect(buildFlame().getAttribute("normal")).toBeDefined();
  });

  it("banners: the pennant and the board lettering have in-range UVs and waves, and only the pennant waves", () => {
    const g = buildBanners(createArena(7))!;
    const uv = g.attributes.uv!;
    const wave = g.attributes.wave!;
    let waving = 0;
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
      expect(wave.getX(i)).toBeGreaterThanOrEqual(0);
      expect(wave.getX(i)).toBeLessThanOrEqual(1);
      if (wave.getX(i) > 0) waving++;
    }
    expect(waving).toBeGreaterThan(20);
    expect(waving).toBeLessThan(uv.count);
    // the hoist edge of the pennant does not move
    let hoistFixed = true;
    for (let i = 0; i < uv.count; i++) if (uv.getX(i) === 0 && uv.getY(i) > 0.6 && wave.getX(i) !== 0) hoistFixed = false;
    expect(hoistFixed).toBe(true);
  });
});

function box2(g: BufferGeometry): Box3 {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
}
