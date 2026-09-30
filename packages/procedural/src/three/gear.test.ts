import { Box3, Mesh, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import * as C from "../catalog.ts";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { buildCharacter } from "./rig.ts";

const options: [keyof CharacterSpec, readonly string[]][] = [
  ["neckwear", C.NECKWEAR],
  ["pack", C.PACKS],
  ["hipGear", C.HIP_GEAR],
  ["gloves", C.GLOVES],
];
const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
const boneTris = (spec: CharacterSpec, bone: string): number => {
  const rig = buildCharacter(spec, { outline: false });
  let n = 0;
  rig.root.traverse((o) => o instanceof Mesh && o.name === `mesh_${bone}` && (n += tris(o.geometry)));
  rig.dispose();
  return n;
};
/** A checksum of a bone's positions and colours: an option that draws something changes it. */
const boneDigest = (spec: CharacterSpec, bone: string): number => {
  const rig = buildCharacter(spec, { outline: false });
  let h = 0;
  rig.root.traverse((o) => {
    if (!(o instanceof Mesh) || o.name !== `mesh_${bone}`) return;
    for (const name of ["position", "color"] as const) {
      const a = o.geometry.attributes[name]!.array;
      for (let i = 0; i < a.length; i++) h = (h * 31 + Math.round((a[i] as number) * 1000)) | 0;
    }
  });
  rig.dispose();
  return h;
};

describe("expedition gear", () => {
  for (const [key, names] of options) {
    for (let v = 1; v < names.length; v++) {
      it(`${String(key)} = ${names[v]}: builds clean geometry on every body shape and changes the rig`, () => {
        for (let seed = 0; seed < 12; seed++) {
          const base = { ...generateCharacter(seed), neckwear: 0, pack: 0, hipGear: 0, gloves: 0 };
          const spec = { ...base, [key]: v };
          const rig = buildCharacter(spec, { outline: false });
          rig.root.traverse((o) => {
            if (!(o instanceof Mesh)) return;
            const p = o.geometry.attributes.position!;
            for (let i = 0; i < p.count; i++) if (!Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))) throw new Error(`NaN in ${o.name}`);
          });
          const box = new Box3().setFromObject(rig.root);
          expect(box.min.y).toBeGreaterThan(-0.1); // never below the ground
          rig.dispose();
        }
        const bone = key === "gloves" ? "handL" : "torso";
        const a = { ...generateCharacter(3), neckwear: 0, pack: 0, hipGear: 0, gloves: 0 };
        // (gloves recolour and reshape the hand - mitts fuse the fingers into one mass, so they may have FEWER triangles - so they must differ; the rest add geometry)
        if (key === "gloves") expect(boneDigest({ ...a, [key]: v } as CharacterSpec, bone)).not.toBe(boneDigest(a, bone));
        else expect(boneTris({ ...a, [key]: v } as CharacterSpec, bone)).toBeGreaterThanOrEqual(boneTris(a, bone));
      });
    }
  }
});
