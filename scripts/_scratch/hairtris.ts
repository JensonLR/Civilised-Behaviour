import { generateCharacter } from "../../packages/procedural/src/spec.ts";
import { auditHead } from "../../packages/procedural/src/three/headAudit.ts";
for (const h of [0, 1, 7, 8, 10, 11, 15, 16]) {
  let t = 0;
  for (let s = 0; s < 6; s++) { const spec = { ...generateCharacter(s), hair: h, hat: 0, beard: 0, moustache: 0, sideburns: 0, eyewear: 0 }; const a = auditHead(spec); for (const p of a.prims) if (p.label === "hair") t += p.tris.length / 3; }
  console.log("hair", h, (t / 6).toFixed(0));
}
