import { Color, InstancedMesh, Matrix4, Quaternion, Vector3, type Object3D } from "three";
import { PALETTE } from "@cb/shared";

/** D-103: the plant sets fire burns (their instanced meshes' names across the region views). Rocks, pebbles, trees and lilies are not among them. */
export const SCORCH_PLANTS: ReadonlySet<string> = new Set(["grass", "sedge", "barley", "bush", "scrub", "tufts", "ferns", "daisies", "cups", "reeds", "toadstools", "tamarisk", "mounds"]);

const m = new Matrix4();
const p = new Vector3();
const q = new Quaternion();
const s = new Vector3();
/** A charred plant's tint (an instance colour multiplies the plant's own: dark, faintly warm). */
const CHAR = new Color(PALETTE.camp.charred).multiplyScalar(0.55);

/**
 * D-103: every plant (an instance of a SCORCH_PLANTS mesh under `root`) standing where `burnt(x, z)` burns down to black stubble: a fifth of its height, darkened. Each instance
 * burns once (a mark per mesh in its userData), so calling again as the scorch grows only touches the new ground. The outline hull shares the instance matrices, so it follows.
 * Returns how many plants burnt this call.
 */
export function scorchPlants(root: Object3D, burnt: (x: number, z: number) => boolean): number {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof InstancedMesh) || !SCORCH_PLANTS.has(o.name)) return;
    const ud = o.userData as { charred?: Uint8Array };
    const done = (ud.charred ??= new Uint8Array(o.count));
    let any = false;
    for (let i = 0; i < o.count; i++) {
      if (done[i]) continue;
      o.getMatrixAt(i, m);
      m.decompose(p, q, s);
      if (!burnt(p.x, p.z)) continue;
      done[i] = 1;
      any = true;
      n++;
      s.set(s.x * 0.8, s.y * 0.2, s.z * 0.8);
      o.setMatrixAt(i, m.compose(p, q, s));
      if (o.instanceColor) o.setColorAt(i, CHAR);
    }
    if (any) {
      o.instanceMatrix.needsUpdate = true;
      if (o.instanceColor) o.instanceColor.needsUpdate = true;
    }
  });
  return n;
}
