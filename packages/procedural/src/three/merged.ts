import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Sphere, Vector3 } from "three";

/**
 * Rigid skinning for the crowd (D-036, package Q). A character is a rigid hierarchy of bone meshes (rig.ts): 13 draw calls at a mid distance, 20 with the face, more with ink. A crowd
 * of two dozen of them is the one place the game spends hundreds of draws at once, so a CROWD rig merges the geometry of every bone at levels 1 and 2 into ONE `SkinnedMesh` whose
 * every vertex is weighted 1.0 to the bone it came from. The rig's own joints (plain Groups) ARE the skeleton, so the animator, the IK and the trade poses keep driving the very same
 * objects and the merged mesh simply follows them: no second pose, no copy, nothing to sync. Triangles do not change; draws do (see docs/PERFORMANCE.md).
 *
 * The vertices are stored in the rig-root frame at the REST pose (the joints' world matrices when the rig was built, root at the identity), the skeleton's bone inverses are the inverses
 * of those rest matrices, and the mesh is bound with an identity bind matrix as a child of the rig root in the default `attached` mode. Then, for a vertex v of bone b,
 *   rootLocal = bone_b(root frame, now) * rest_b^-1 * (rest_b * v_b) = bone_b(root frame, now) * v_b,
 * exactly where the rigid bone mesh would have drawn it.
 */
export interface RigidPart {
  geometry: BufferGeometry;
  /** Index into the skeleton's bone list. */
  bone: number;
  /** Bone-local geometry -> rig-root frame at rest (a bone's own rest matrix, or that times a part's offset inside the bone). */
  matrix: Matrix4;
}

const m3 = new Matrix3();
const v3 = new Vector3();

/**
 * Concatenates `parts` into one indexed geometry with `position`, `normal`, `color`, `skinIndex` (Uint16 x4, the bone) and `skinWeight` (1,0,0,0). Parts that arrive without normals get
 * them computed; a part whose matrix mirrors (a negative determinant) has its winding flipped so it stays front-facing. `fab` (D-078, cloth) is carried. Morph targets and every other attribute are dropped: a crowd
 * level does not use them. The inputs are never modified or disposed (some come from shared caches).
 */
export function mergeRigid(parts: readonly RigidPart[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    const n = p.geometry.attributes.position!.count;
    vertices += n;
    indices += p.geometry.index ? p.geometry.index.count : n;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const fab = new Float32Array(vertices);
  const skinIndex = new Uint16Array(vertices * 4);
  const skinWeight = new Float32Array(vertices * 4);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geometry;
    const pos = g.attributes.position!;
    const n = pos.count;
    const nrm = g.attributes.normal ?? (() => {
      const c = g.clone();
      c.computeVertexNormals();
      return c.attributes.normal!;
    })();
    const col = g.attributes.color;
    const fb = g.attributes.fab;
    m3.getNormalMatrix(p.matrix);
    for (let i = 0; i < n; i++) {
      v3.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
      position[(vo + i) * 3] = v3.x;
      position[(vo + i) * 3 + 1] = v3.y;
      position[(vo + i) * 3 + 2] = v3.z;
      v3.fromBufferAttribute(nrm, i).applyMatrix3(m3).normalize();
      normal[(vo + i) * 3] = v3.x;
      normal[(vo + i) * 3 + 1] = v3.y;
      normal[(vo + i) * 3 + 2] = v3.z;
      if (col) {
        color[(vo + i) * 3] = col.getX(i);
        color[(vo + i) * 3 + 1] = col.getY(i);
        color[(vo + i) * 3 + 2] = col.getZ(i);
      } else color.fill(1, (vo + i) * 3, (vo + i) * 3 + 3);
      if (fb) fab[vo + i] = fb.getX(i);
      skinIndex[(vo + i) * 4] = p.bone;
      skinWeight[(vo + i) * 4] = 1;
    }
    const flip = p.matrix.determinant() < 0;
    const count = g.index ? g.index.count : n;
    for (let k = 0; k < count; k += 3) {
      const a = g.index ? g.index.getX(k) : k;
      const b = g.index ? g.index.getX(k + 1) : k + 1;
      const c = g.index ? g.index.getX(k + 2) : k + 2;
      index[io++] = vo + a;
      index[io++] = vo + (flip ? c : b);
      index[io++] = vo + (flip ? b : c);
    }
    vo += n;
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(position, 3));
  out.setAttribute("normal", new BufferAttribute(normal, 3));
  out.setAttribute("color", new BufferAttribute(color, 3));
  out.setAttribute("fab", new BufferAttribute(fab, 1)); // D-078: which vertices are cloth (the material weaves them)
  out.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
  out.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** A sphere that surely holds the figure in any pose the animator reaches (arms overhead, a lunge): the rest bounds grown by a margin. Skinned meshes are culled by it. */
export function posedBounds(geometry: BufferGeometry, margin = 0.6): Sphere {
  const s = (geometry.boundingSphere ?? new Sphere()).clone();
  s.radius += margin;
  return s;
}
