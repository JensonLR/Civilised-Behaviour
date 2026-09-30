import { Mesh } from "three";
import { generateCharacter } from "../../packages/procedural/src/spec.ts";
import { auditHead } from "../../packages/procedural/src/three/headAudit.ts";
import { buildCharacter } from "../../packages/procedural/src/three/rig.ts";
const N = Number(process.argv[2] ?? 40);
const tot: Record<string, number> = {};
let head = 0;
for (let s = 0; s < N; s++) {
  const a = auditHead(generateCharacter(s));
  for (const p of a.prims) tot[p.label] = (tot[p.label] ?? 0) + p.tris.length / 3;
  head += a.geo.index!.count / 3;
}
console.log("head total avg", (head / N).toFixed(0));
for (const [k, v] of Object.entries(tot).sort((a, b) => b[1] - a[1])) console.log(k.padEnd(12), (v / N).toFixed(0));
// face parts
let f = 0;
for (let s = 0; s < 10; s++) {
  const rig = buildCharacter(generateCharacter(s), { outline: false });
  const root = rig.root.getObjectByName("faceRoot")!;
  root.traverse((o) => { if (o instanceof Mesh) f += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3; });
}
console.log("faceRoot tris avg", (f / 10).toFixed(0));
{
  const rig = buildCharacter(generateCharacter(3), { outline: false });
  const root = rig.root.getObjectByName("faceRoot")!;
  const rows: string[] = [];
  root.traverse((o) => { if (o instanceof Mesh) rows.push(`${o.parent?.name || o.parent?.type}/${o.name || "mesh"}: ${((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3)} vis=${o.visible}`); });
  console.log(rows.join("\n"));
}
