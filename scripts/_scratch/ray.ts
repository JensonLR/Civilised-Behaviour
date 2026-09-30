import { Raycaster, Vector3 } from "three";
import { generateCharacter } from "../../packages/procedural/src/spec.ts";
import { buildCharacter } from "../../packages/procedural/src/three/rig.ts";
import { CharacterAnimator } from "../../packages/procedural/src/three/animator.ts";
const spec = { ...generateCharacter(3), hat: 0, eyewear: 0, eyepatch: 0, hair: 0 };
const rig = buildCharacter(spec, { outline: false });
const a = new CharacterAnimator(rig); a.autoBlink = false; a.setExpression("sleep");
for (let i = 0; i < 60; i++) a.update(1/30, { speed: 0, flags: 1, vy: 0 });
rig.root.updateMatrixWorld(true);
const f = rig.face;
const gp = f.glintR.geometry.attributes.position!; const origin = new Vector3(gp.getX(0), gp.getY(0), gp.getZ(0)).applyMatrix4(f.glintR.matrixWorld);
console.log("glint world", origin.toArray().map(v=>v.toFixed(3)), "lid rot", f.lidR.rotation.x.toFixed(2));
const eyeC = f.eyeR.getWorldPosition(new Vector3());
console.log("eye centre", eyeC.toArray().map(v=>v.toFixed(3)));
// ray from in front of the glint toward the eye centre along -view
const dirToEye = new Vector3(0,0,1).transformDirection(rig.root.matrixWorld);
const start = origin.clone().addScaledVector(dirToEye, -1);
const rc = new Raycaster(start, dirToEye);
const hits = rc.intersectObjects([f.lidR, f.glintR, f.pupilR, f.lowerLidR, f.eyeR.children[0]!], false);
console.log(hits.slice(0,6).map(h => `${h.object === f.lidR ? "lid" : h.object === f.glintR ? "glint" : h.object === f.lowerLidR ? "lower" : "other"} d=${h.distance.toFixed(4)}`));
{
  const lp = f.lidR.geometry.attributes.position!;
  let minZ = 1e9, maxZ = -1e9;
  const v = new Vector3();
  for (let i = 0; i < lp.count; i++) { v.set(lp.getX(i), lp.getY(i), lp.getZ(i)).applyMatrix4(f.lidR.matrixWorld); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
  console.log("lid world z range", minZ.toFixed(3), maxZ.toFixed(3), "eyeR", f.eyeRadius, "scale", rig.root.scale.toArray(), f.eyeR.scale.toArray(), f.lidR.rotation.toArray());
  console.log("lid geo params", (f.lidR.geometry as any).parameters, lp.count);
}
{
  const gp2 = f.glintR.geometry.attributes.position!;
  console.log("glint verts", Array.from({length: Math.min(gp2.count, 4)}, (_, i) => [gp2.getX(i), gp2.getY(i), gp2.getZ(i)].map(v => +v.toFixed(4))), "count", gp2.count, "eyeR", f.eyeRadius);
}
