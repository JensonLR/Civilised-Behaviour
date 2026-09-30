import { describe, expect, it } from "vitest";
import type { BufferAttribute } from "three";
import { generateCharacter } from "../spec.ts";
import { computeProportions } from "../proportions.ts";
import { JAW_MAX, MOUTH_MORPH_NAMES, jawWeight } from "./faceMorph.ts";
import { FACE_THETAS, MOUTH_BAND, headShape, skullGrid } from "./headShape.ts";
import { mouthGeo } from "./mouthGeo.ts";

const shapeFor = (seed: number) => headShape(computeProportions(generateCharacter(seed)));

describe("the face grid and the mouth", () => {
  it("the rows are monotone, symmetric in the columns, and two of them bound the mouth seam", () => {
    const g = skullGrid(false);
    expect(g.rows).toBe(24);
    for (let j = 0; j < FACE_THETAS.length - 1; j++) expect(FACE_THETAS[j + 1]!).toBeGreaterThan(FACE_THETAS[j]!);
    expect(MOUTH_BAND.lo).toBeLessThan(MOUTH_BAND.up);
    expect(MOUTH_BAND.up - MOUTH_BAND.lo).toBeLessThan(0.07); // a lip's height: the band is what stretches when the jaw opens
    expect(g.phis[g.cols / 2]).toBeCloseTo(0, 9); // a column straight down the middle of the face
    // the jaw belongs to the skull above the band's upper row and is all jaw below the lower row
    const at = (th: number, x = 0) => jawWeight(x, Math.sin(th), -Math.cos(th));
    expect(at(MOUTH_BAND.up + 0.01)).toBe(0);
    expect(at(MOUTH_BAND.up)).toBeCloseTo(0, 6);
    expect(at(MOUTH_BAND.lo)).toBeCloseTo(1, 6);
    expect(at(-0.9)).toBeCloseTo(1, 6);
    expect(at(MOUTH_BAND.lo, 0.28)).toBeLessThan(0.45); // the corners of the mouth stay put
  });

  it("the mouth is collapsed onto the seam when shut and opens between the lips with the jaw", () => {
    for (const seed of [1, 4, 9]) {
      const shape = shapeFor(seed);
      const m = mouthGeo(shape, 0, 0xc29a45);
      const geo = m.full;
      const pos = geo.attributes.position as BufferAttribute;
      const R = shape.R;
      const names = geo.userData.morphNames as readonly string[];
      expect(names).toEqual([...MOUTH_MORPH_NAMES]);
      const jaw = geo.morphAttributes.position![0] as BufferAttribute;
      const ix = geo.index!;
      const area = (get: (i: number, c: number) => number): number => {
        let a = 0;
        for (let t = 0; t < ix.count; t += 3) {
          const i = ix.getX(t);
          const j = ix.getX(t + 1);
          const k = ix.getX(t + 2);
          const u = [0, 1, 2].map((c) => get(j, c) - get(i, c));
          const v = [0, 1, 2].map((c) => get(k, c) - get(i, c));
          a += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
        }
        return a;
      };
      const shut = area((i, c) => [pos.getX(i), pos.getY(i), pos.getZ(i)][c]!);
      const open = area((i, c) => [pos.getX(i) + jaw.getX(i), pos.getY(i) + jaw.getY(i), pos.getZ(i) + jaw.getZ(i)][c]!);
      expect(open, `seed ${seed}`).toBeGreaterThan(shut * 3); // shut, only the seam has any area
      expect(m.halfWidth).toBeGreaterThan(R * 0.25);
      expect(m.halfWidth).toBeLessThan(R * 0.36);
      // the lower lip goes down by a real amount when the jaw is fully open (the chin of a full gape is the jaw angle times its distance from the hinge)
      let lowest = 0;
      for (let i = 0; i < jaw.count; i++) lowest = Math.min(lowest, jaw.getY(i));
      expect(-lowest).toBeGreaterThan(R * 0.15 * (JAW_MAX / 0.3));
      // crowd levels draw the seam alone: a static line with no morph targets
      expect(m.line.morphAttributes.position).toBeUndefined();
      expect(m.line.index!.count).toBeLessThan(geo.index!.count);
    }
  });

  it("teeth come in the catalog's variety: gold, missing and buck teeth change the mouth", () => {
    const shape = shapeFor(3);
    const plain = mouthGeo(shape, 0, 0xc29a45).full.attributes.position!.count;
    expect(mouthGeo(shape, 1, 0xc29a45).full.attributes.position!.count).toBeLessThan(plain); // missing front teeth
    expect(mouthGeo(shape, 16, 0xc29a45).full.attributes.position!.count).toBeGreaterThan(plain); // buck teeth
    expect(mouthGeo(shape, 0, 0xc29a45)).toBe(mouthGeo(shape, 0, 0xc29a45)); // memoised
    const gold = mouthGeo(shape, 2, 0xc29a45).full.attributes.color!;
    const ivory = mouthGeo(shape, 0, 0xc29a45).full.attributes.color!;
    let diff = 0;
    for (let i = 0; i < gold.array.length; i++) diff += Math.abs((gold.array[i] as number) - (ivory.array[i] as number));
    expect(diff).toBeGreaterThan(0.05);
  });
});
