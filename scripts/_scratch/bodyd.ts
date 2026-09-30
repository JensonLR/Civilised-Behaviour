import { generateCharacter } from "../../packages/procedural/src/spec.ts";
import { auditHead, bodyDepth } from "../../packages/procedural/src/three/headAudit.ts";
const base = { ...generateCharacter(3), hat: 0, hair: 0, beard: 6, moustache: 0, sideburns: 0, eyewear: 0, headScale: 255, torsoWidth: 255, belly: 255, height: 40, legLength: 20, jaw: 255, earScale: 255, scars: 0, eyepatch: 0, earring: 0, hairAcc: 0, mark: 0, facePaint: 0, tattoo: 0 };
const a = auditHead(base as any);
a.prims.forEach((p, i) => { if (p.label === "beard") console.log(i, p.kind, p.tris.length / 3, (bodyDepth(a, p) * 100).toFixed(1), "cm"); });
