import { generateCharacter } from "../packages/procedural/src/spec.ts";
import { buildCharacter, clearCharacterCaches } from "../packages/procedural/src/three/rig.ts";
import { PartBuilder } from "../packages/procedural/src/three/parts.ts";
const lod = Number(process.argv[2] ?? 1) as 0 | 1 | 2;
const bone = process.argv[3] ?? "head";
const N = 60;
const acc = new Map<string, [number, number]>();
for (let s = 0; s < N; s++) {
  clearCharacterCaches();
  PartBuilder.audit = [];
  const rig = buildCharacter(generateCharacter(s), { outline: false, lod });
  for (const a of PartBuilder.audit) {
    if (a.tag !== bone) continue;
    const e = acc.get(a.kind) ?? [0, 0];
    e[0] += a.triangles;
    e[1]++;
    acc.set(a.kind, e);
  }
  PartBuilder.audit = undefined;
  rig.dispose();
}
console.log("LOD", lod, bone);
for (const [k, [t, n]] of [...acc.entries()].sort((a, b) => b[1][0] - a[1][0])) console.log(k.padEnd(10), "tris/char", (t / N).toFixed(0), "prims/char", (n / N).toFixed(1));
