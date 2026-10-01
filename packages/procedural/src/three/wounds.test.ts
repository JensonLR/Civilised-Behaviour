import { Box3, Color, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { Rng, ZONE, setWound, type ZoneId } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { computeProportions } from "../proportions.ts";
import { FIT_SHAPES } from "./fit/shapes.ts";
import { buildCharacter } from "./rig.ts";
import { BodyMarks, buildGrimeGeometry, buildOpenWoundGeometry, buildWoundGeometry, grimeLevel, stepExposure, type Exposure, type GoreLevel, type GrimePart } from "./wounds.ts";

/** Open wounds on the fallen, mud and soot by exposure, and the manager that hangs them on a body (package W). */

const ZONES: ZoneId[] = [ZONE.HEAD, ZONE.TORSO, ZONE.ARM_L, ZONE.ARM_R, ZONE.LEG_L, ZONE.LEG_R];
const PARTS: GrimePart[] = ["torso", "head", "upperArm", "foreArm", "thigh", "shin"];
const shapes = FIT_SHAPES.filter((_, i) => i < 12 || i % 6 === 0);
const tris = (g: BufferGeometry | undefined): number => (g ? (g.index ? g.index.count : g.attributes.position!.count) / 3 : 0);
const finite = (g: BufferGeometry): boolean => (g.attributes.position!.array as Float32Array).every(Number.isFinite);

/** A vertex colour that is a blood red: in linear light its red is many times its green and blue. */
function reddest(g: BufferGeometry): number {
  const c = g.attributes.color!;
  let worst = 0;
  const col = new Color();
  for (let i = 0; i < c.count; i++) {
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i));
    if (col.r > 0.04) worst = Math.max(worst, col.r / Math.max(1e-4, Math.max(col.g, col.b)));
  }
  return worst;
}

describe("open wounds", () => {
  it("every zone, severity and dryness builds finite geometry on every body shape; severity 0 and gore Off build nothing", () => {
    for (const { name, spec } of shapes) {
      const P = computeProportions(spec);
      for (const z of ZONES) {
        for (const sev of [1, 2, 3]) {
          for (const dry of [0, 0.5, 1]) {
            const g = buildOpenWoundGeometry(z, sev, "full", dry, P, spec);
            expect(g, `${name} zone ${z} sev ${sev}`).toBeDefined();
            expect(finite(g!), `${name} zone ${z}`).toBe(true);
            // it is a small mark: nothing bigger than a hand's span, and near the body (inside a box a body fits)
            const box = new Box3().setFromBufferAttribute(g!.attributes.position as never);
            const size = box.getSize(new (box.max.constructor as new () => typeof box.max)());
            expect(Math.max(size.x, size.y, size.z), `${name} zone ${z} sev ${sev}: size`).toBeLessThan(0.5);
          }
        }
        expect(buildOpenWoundGeometry(z, 0, "full", 0, P, spec)).toBeUndefined();
        expect(buildOpenWoundGeometry(z, 3, "off", 0, P, spec), `${name} off`).toBeUndefined();
      }
    }
  });

  it("a fresh wound is wet and drips, and a dried one is darker with neither; reduced is a plain brown blotch", () => {
    const spec = generateCharacter(5);
    const P = computeProportions(spec);
    for (const z of [ZONE.TORSO, ZONE.LEG_L, ZONE.ARM_R]) {
      const fresh = buildOpenWoundGeometry(z, 3, "full", 0, P, spec)!;
      const dried = buildOpenWoundGeometry(z, 3, "full", 1, P, spec)!;
      expect(tris(fresh), `zone ${z}: drips and the highlight go`).toBeGreaterThan(tris(dried));
      const lum = (g: BufferGeometry): number => {
        const c = g.attributes.color!;
        let s = 0;
        for (let i = 0; i < c.count; i++) s += c.getX(i) + c.getY(i) + c.getZ(i);
        return s / c.count;
      };
      expect(lum(dried), `zone ${z}: a dried wound is darker`).toBeLessThan(lum(fresh));
      const reduced = buildOpenWoundGeometry(z, 3, "reduced", 0, P, spec)!;
      expect(tris(reduced)).toBeLessThan(tris(fresh) / 2);
      expect(reddest(reduced), "reduced is a brown, not a red").toBeLessThan(reddest(fresh));
    }
  });

  it("the open wound is on top of where the dressing sits: it replaces a dressing on a body that is down, it does not hide inside the body", () => {
    const spec = generateCharacter(9);
    const P = computeProportions(spec);
    for (const z of ZONES) {
      const dressing = buildWoundGeometry(z, 2, "full", P, spec)!;
      const open = buildOpenWoundGeometry(z, 2, "full", 0.2, P, spec)!;
      const a = new Box3().setFromBufferAttribute(dressing.attributes.position as never);
      const b = new Box3().setFromBufferAttribute(open.attributes.position as never);
      // (the same neighbourhood of the same bone: centres within a hand's length)
      const ca = a.getCenter(new (a.max.constructor as new () => typeof a.max)());
      const cb = b.getCenter(new (b.max.constructor as new () => typeof b.max)());
      expect(ca.distanceTo(cb), `zone ${z}`).toBeLessThan(0.45);
    }
  });
});

describe("grime", () => {
  it("level 0 builds nothing; more exposure never means fewer marks; every part on every body shape is finite and bounded", () => {
    for (const { name, spec } of shapes) {
      const P = computeProportions(spec);
      for (const part of PARTS) {
        expect(buildGrimeGeometry(part, "L", 0, 0, P, spec), `${name} ${part}`).toBeUndefined();
        let prevMud = 0;
        let prevSoot = 0;
        for (let l = 1; l <= 3; l++) {
          const m = buildGrimeGeometry(part, "R", l, 0, P, spec);
          const s = buildGrimeGeometry(part, "R", 0, l, P, spec);
          if (m) expect(finite(m)).toBe(true);
          if (s) expect(finite(s)).toBe(true);
          expect(tris(m), `${name} ${part} mud ${l}`).toBeGreaterThanOrEqual(prevMud);
          expect(tris(s), `${name} ${part} soot ${l}`).toBeGreaterThanOrEqual(prevSoot);
          prevMud = tris(m);
          prevSoot = tris(s);
          for (const g of [m, s]) {
            if (!g) continue;
            const box = new Box3().setFromBufferAttribute(g.attributes.position as never);
            expect(box.max.y - box.min.y, `${name} ${part}`).toBeLessThan(1.4);
            expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), `${name} ${part} reaches sideways`).toBeLessThan(0.8);
          }
        }
      }
    }
    // the worst of it is a lot of marks, not a thousand
    const spec = generateCharacter(3);
    const P = computeProportions(spec);
    let total = 0;
    for (const part of PARTS) total += tris(buildGrimeGeometry(part, "L", 3, 3, P, spec)) + tris(buildGrimeGeometry(part, "R", 3, 3, P, spec));
    expect(total).toBeLessThan(5600); // (counted both sides for the centre parts too: a real body is about 4,000)
  });

  it("grime is dirt, not blood: no vertex colour is a red, at any level, and it does not depend on the gore setting", () => {
    const spec = generateCharacter(11);
    const P = computeProportions(spec);
    for (const part of PARTS) {
      const g = buildGrimeGeometry(part, "L", 3, 3, P, spec);
      if (g) expect(reddest(g), part).toBeLessThan(3);
    }
  });

  it("the marks are the same every time for the same look (deterministic), and differ between looks", () => {
    const a = generateCharacter(3);
    const b = generateCharacter(4);
    const Pa = computeProportions(a);
    const Pb = computeProportions(b);
    const ga = buildGrimeGeometry("torso", "L", 3, 3, Pa, a)!;
    const gb = buildGrimeGeometry("torso", "L", 3, 3, Pa, a)!;
    expect(Array.from(ga.attributes.position!.array)).toEqual(Array.from(gb.attributes.position!.array));
    const gc = buildGrimeGeometry("torso", "L", 3, 3, Pb, b)!;
    expect(Array.from(gc.attributes.position!.array)).not.toEqual(Array.from(ga.attributes.position!.array));
  });

  it("exposure: mud collects only while walking on mud, dries slowly, washes off in water; soot collects near blasts and only rain and water wash it", () => {
    const e: Exposure = { mud: 0, soot: 0 };
    const dry = { mud: 0, moving: true, blast: 0, rain: 0, washing: false };
    for (let t = 0; t < 120; t++) stepExposure(e, 1, dry);
    expect(e.mud).toBe(0);
    for (let t = 0; t < 30; t++) stepExposure(e, 1, { ...dry, mud: 1 });
    const walked = e.mud;
    expect(walked).toBeGreaterThan(0.3);
    expect(grimeLevel(walked)).toBeGreaterThanOrEqual(1);
    for (let t = 0; t < 30; t++) stepExposure(e, 1, { ...dry, mud: 1, moving: false });
    expect(e.mud, "standing still in mud collects nothing and it dries a little").toBeLessThan(walked);
    for (let t = 0; t < 120; t++) stepExposure(e, 1, { ...dry, mud: 1 });
    expect(e.mud).toBeLessThanOrEqual(1);
    expect(grimeLevel(e.mud)).toBe(3);
    for (let t = 0; t < 15; t++) stepExposure(e, 1, { ...dry, washing: true });
    expect(e.mud, "a wade in the river washes it").toBe(0);
    for (let t = 0; t < 20; t++) stepExposure(e, 1, { ...dry, blast: 1 });
    expect(grimeLevel(e.soot)).toBe(3);
    const sooty = e.soot;
    for (let t = 0; t < 20; t++) stepExposure(e, 1, dry);
    expect(e.soot, "soot stays when you walk away").toBeGreaterThan(sooty * 0.9);
    for (let t = 0; t < 40; t++) stepExposure(e, 1, { ...dry, rain: 1 });
    expect(e.soot, "rain takes some").toBeLessThan(sooty * 0.9);
    // a level needs real exposure, and the ladder only rises
    let prev = 0;
    for (let v = 0; v <= 1.0001; v += 0.01) {
      const l = grimeLevel(v);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
    expect(grimeLevel(0.05)).toBe(0);
    for (const bad of [NaN, -1]) stepExposure(e, bad, dry);
    expect(Number.isFinite(e.mud + e.soot)).toBe(true);
  });
});

describe("the marks on a body", () => {
  const rigFor = (seed: number) => buildCharacter({ ...generateCharacter(seed), woodenLeg: 0 }, { outline: false });

  it("open wounds and grime hang on the right bones, a state change re-makes only what changed, and Off shows no open wound", () => {
    const rig = rigFor(5);
    const marks = new BodyMarks(rig);
    expect(marks.meshCount).toBe(0);
    let mask = 0;
    mask = setWound(mask, ZONE.TORSO, 3);
    mask = setWound(mask, ZONE.LEG_L, 2);
    marks.set({ open: mask, dryness: 0, mud: 0, soot: 0, gore: "full" });
    expect(marks.meshCount).toBe(2);
    const torsoMesh = rig.joints.torso.children.find((c) => c.name === "marks_open1")!;
    expect(torsoMesh).toBeDefined();
    const geo = (torsoMesh as unknown as { geometry: BufferGeometry }).geometry;
    marks.set({ open: mask, dryness: 0.05, mud: 0, soot: 0, gore: "full" }); // (the same quarter of its drying: nothing is re-made)
    expect((torsoMesh as unknown as { geometry: BufferGeometry }).geometry).toBe(geo);
    marks.set({ open: mask, dryness: 1, mud: 0, soot: 0, gore: "full" });
    expect((torsoMesh as unknown as { geometry: BufferGeometry }).geometry).not.toBe(geo);
    marks.set({ open: mask, dryness: 1, mud: 0, soot: 0, gore: "off" });
    expect(marks.meshCount, "Off shows none").toBe(0);
    marks.set({ open: 0, dryness: 0, mud: 3, soot: 3, gore: "off" });
    expect(marks.meshCount, "grime shows at every gore level").toBeGreaterThanOrEqual(8);
    expect(rig.joints.kneeL.children.some((c) => c.name === "marks_grimeshinL")).toBe(true);
    expect(rig.joints.head.children.some((c) => c.name === "marks_grimehead")).toBe(true);
    marks.set({ open: 0, dryness: 0, mud: 0, soot: 0, gore: "off" });
    expect(marks.meshCount).toBe(0);
    marks.dispose();
    expect(rig.joints.torso.children.some((c) => c.name.startsWith("marks_"))).toBe(false);
  });

  it("builds on every body shape and its cost is bounded: a body wearing the worst of everything is a dozen meshes and a few thousand triangles", () => {
    const rng = new Rng(3);
    for (const { name, spec } of shapes.slice(0, 14)) {
      const rig = buildCharacter({ ...spec, woodenLeg: 0 }, { outline: false });
      const marks = new BodyMarks(rig);
      let mask = 0;
      for (const z of ZONES) mask = setWound(mask, z, 1 + rng.int(0, 2));
      marks.set({ open: mask, dryness: 0.3, mud: 3, soot: 3, gore: "full" });
      expect(marks.meshCount, name).toBeLessThanOrEqual(16);
      let t = 0;
      rig.root.traverse((o) => {
        if (o.name.startsWith("marks_") && "geometry" in o) t += tris((o as unknown as { geometry: BufferGeometry }).geometry);
      });
      expect(t, name).toBeLessThan(9000);
      marks.dispose();
    }
    void ("full" as GoreLevel);
  });
});
