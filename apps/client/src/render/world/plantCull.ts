import { Box3, BufferGeometry, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from "three";

/**
 * A plant never grows through anything built. The scatter planners keep plants off the collision footprints by their centre alone, and most of what is built
 * (a ruin's fallen blocks, a well's kerb, stepping stones, a boardwalk, a fort's courtyard walls, a revetment) has no footprint to keep off: grass grew out of
 * stones, reeds through a stepping stone, a bush a metre into the keep. Once a region's view has built everything, this hides every decorative plant (no
 * collider: hiding one changes nothing in play) whose body meets what is built.
 *
 * What is built is rasterised in plan into 25 cm cells, each holding the heights its geometry spans; a plant is tested by the cells under the middle of its
 * crown (its whole reach) over its height from a hand above its foot (so a reed standing level with a pool's surface, or grass
 * beside a paving stone, stays). Run once per view, after the build; allocation only then. Deterministic: every client hides the same plants.
 */

/** The decorative plants (no collider) a built thing displaces, by mesh name. */
export const PLANTS = /^(grass|cups|daisies|lilies|toadstools|ferns|bush|berry-bush|reeds|sedge|tufts|scrub|tamarisk|pebbles|barley)$/;
/** Instanced meshes that are built (the rest of the instanced meshes are wild: trees, rocks, animals). */
const BUILT_INSTANCED = /^(flagstones|stakes|peg_flags)$/;
/** Plain meshes that are not built: the ground, water, light, ink, weather, paint on the ground. */
const NOT_BUILT = /(_outline$|^terrain$|^skirt$|^hills$|^horizon$|^water$|^flood$|^falls$|^fire-pool$|^flame$|^windows$|glow|^lantern-glass$|^rain$|^motes$|^smoke|^shafts?$|^sky|^road-paint$|^hq-route)/;

const CELL = 0.25;
/** How far into a plant's reach the test looks (its edge is thin). */
const CROWN = 1;
/** The plant's height is tested from this far above its foot. */
const FOOT = 0.1;
/** How much height a plant and a built cell must share to count. */
const SHARE = 0.05;

const key = (ix: number, iz: number): number => (ix + 32768) * 65536 + (iz + 32768);

/** Squared plan distance from (px, pz) to the triangle (a, b, c); 0 inside it. A wall's triangle is edge-on in plan: the distance to its edges still finds it. */
function dist2Tri(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const s1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const s2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx);
  const s3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
    if (Math.abs(s1) + Math.abs(s2) + Math.abs(s3) > 1e-9) return 0;
  }
  const seg = (x0: number, z0: number, x1: number, z1: number): number => {
    const dx = x1 - x0, dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / l2)) : 0;
    const qx = x0 + t * dx - px, qz = z0 + t * dz - pz;
    return qx * qx + qz * qz;
  };
  return Math.min(seg(ax, az, bx, bz), seg(bx, bz, cx, cz), seg(cx, cz, ax, az));
}

/** What is built under `root`, in plan: per 25 cm cell, the lowest and highest point of what stands in it. */
export class BuiltMask {
  private readonly cells = new Map<number, number>();
  private readonly lo: number[] = [];
  private readonly hi: number[] = [];

  /** Adds one triangle (world space). */
  addTriangle(a: Vector3, b: Vector3, c: Vector3): void {
    const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y);
    const reach2 = (CELL * 0.71) ** 2; // (a cell counts when the triangle comes within half its diagonal of its middle)
    for (let ix = Math.floor(Math.min(a.x, b.x, c.x) / CELL); ix <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); ix++)
      for (let iz = Math.floor(Math.min(a.z, b.z, c.z) / CELL); iz <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); iz++) {
        if (dist2Tri((ix + 0.5) * CELL, (iz + 0.5) * CELL, a.x, a.z, b.x, b.z, c.x, c.z) > reach2) continue;
        const k = key(ix, iz);
        const i = this.cells.get(k);
        if (i === undefined) {
          this.cells.set(k, this.lo.length);
          this.lo.push(y0);
          this.hi.push(y1);
        } else {
          if (y0 < this.lo[i]!) this.lo[i] = y0;
          if (y1 > this.hi[i]!) this.hi[i] = y1;
        }
      }
  }

  /** Adds every triangle of a mesh (each instance of an instanced one), as drawn. */
  addMesh(mesh: Mesh): void {
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.getAttribute("position");
    if (!pos) return;
    const index = geo.getIndex();
    const tri = index ? index.count / 3 : pos.count / 3;
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    const m = new Matrix4(), im = new Matrix4();
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      m.copy(mesh.matrixWorld);
      if (inst) {
        inst.getMatrixAt(k, im);
        if (Math.abs(im.determinant()) < 1e-12) continue;
        m.multiply(im);
      }
      for (let t = 0; t < tri; t++) {
        const at = (j: number): number => (index ? index.getX(t * 3 + j) : t * 3 + j);
        a.fromBufferAttribute(pos, at(0)).applyMatrix4(m);
        b.fromBufferAttribute(pos, at(1)).applyMatrix4(m);
        c.fromBufferAttribute(pos, at(2)).applyMatrix4(m);
        this.addTriangle(a, b, c);
      }
    }
  }

  /** True when what is built in the cells within `r` of (x, z) shares more than `SHARE` of the heights y0..y1. */
  blocks(x: number, z: number, r: number, y0: number, y1: number): boolean {
    const rr = Math.max(r, CELL); // (a tuft of grass leans its blades a cell out: one leaned into a mill tower's wall)
    for (let ix = Math.floor((x - rr) / CELL); ix <= Math.floor((x + rr) / CELL); ix++)
      for (let iz = Math.floor((z - rr) / CELL); iz <= Math.floor((z + rr) / CELL); iz++) {
        const cx = (ix + 0.5) * CELL - x, cz = (iz + 0.5) * CELL - z;
        if (cx * cx + cz * cz > rr * rr && !(Math.abs(cx) <= CELL / 2 && Math.abs(cz) <= CELL / 2)) continue;
        const i = this.cells.get(key(ix, iz));
        if (i === undefined) continue;
        if (Math.min(y1, this.hi[i]!) - Math.max(y0, this.lo[i]!) > SHARE) return true;
      }
    return false;
  }
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/**
 * Hides every decorative plant under `root` that grows through something built (see the file's note). Returns how many it hid. Call it again when what is built
 * changes (a founded outpost, a dress applied): every plant is put back where its planner put it first, then culled against what stands now.
 */
export function cullPlants(root: Object3D): number {
  root.updateMatrixWorld(true);
  const mask = new BuiltMask();
  const plants: InstancedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const inst = (mesh as InstancedMesh).isInstancedMesh;
    if (inst && PLANTS.test(mesh.name)) plants.push(mesh as InstancedMesh);
    else if (inst ? BUILT_INSTANCED.test(mesh.name) : !NOT_BUILT.test(mesh.name)) mask.addMesh(mesh);
  });
  let hidden = 0;
  const m = new Matrix4(), im = new Matrix4();
  const box = new Box3();
  for (const p of plants) {
    // (the planner's matrices, kept the first time: a later cull starts from them, so a plant hidden by an outpost that is gone grows back)
    const first = p.userData.plantMatrices as Float32Array | undefined;
    if (first) {
      (p.instanceMatrix.array as Float32Array).set(first);
      p.instanceMatrix.needsUpdate = true;
    } else p.userData.plantMatrices = (p.instanceMatrix.array as Float32Array).slice();
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    const local = p.geometry.boundingBox!;
    let changed = false;
    for (let k = 0; k < p.count; k++) {
      p.getMatrixAt(k, im);
      if (Math.abs(im.determinant()) < 1e-12) continue;
      m.multiplyMatrices(p.matrixWorld, im);
      box.copy(local).applyMatrix4(m);
      const r = (CROWN * (box.max.x - box.min.x + box.max.z - box.min.z)) / 4;
      if (mask.blocks((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, r, box.min.y + FOOT, box.max.y)) {
        p.setMatrixAt(k, HIDDEN);
        changed = true;
        hidden++;
      }
    }
    if (changed) p.instanceMatrix.needsUpdate = true;
  }
  return hidden;
}
