import { Mesh } from "three";
import { generateCharacter } from "/home/user/Civilised-Behaviour/packages/procedural/src/spec.ts";
import { buildCharacter, clearCharacterCaches } from "/home/user/Civilised-Behaviour/packages/procedural/src/three/rig.ts";
const lod = Number(process.argv[2] ?? 1) as 0 | 1 | 2;
const N = 60;
const acc = new Map<string, number>();
let total = 0;
for (let s = 0; s < N; s++) {
  const rig = buildCharacter(generateCharacter(s), { outline: false, lod });
  rig.root.traverse((o) => {
    if (o instanceof Mesh && o.visible) {
      let vis = true;
      for (let n: any = o; n; n = n.parent) if (!n.visible) vis = false;
      if (!vis) return;
      const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
      const k = o.name.startsWith("mesh_") ? o.name : o.parent?.name === "faceRoot" || o.parent?.parent?.name === "faceRoot" || o.parent?.parent?.parent?.name === "faceRoot" ? "face" : o.name || "other";
      acc.set(k, (acc.get(k) ?? 0) + t);
      total += t;
    }
  });
  rig.dispose();
  clearCharacterCaches();
}
console.log("LOD", lod, "avg total", (total / N).toFixed(0));
for (const [k, v] of [...acc.entries()].sort((a, b) => b[1] - a[1])) console.log(k.padEnd(16), (v / N).toFixed(0));
