import { Material, Mesh, MeshBasicMaterial, type Object3D } from "three";

/**
 * "Shadow only": the local player's own arms and weapon are drawn by the first-person viewmodel, so on the body they must not show in the picture, but they
 * must still be in the shadow map (a shadow with no arms under a first-person player looks broken). A mesh that casts a shadow gets a material that writes
 * neither colour nor depth (the shadow pass ignores that: it draws depth with its own material); a mesh that does not (an ink hull, a dressing) is hidden.
 * Reversible: the original material and visibility are kept on the mesh.
 */
let ghost: MeshBasicMaterial | undefined;
export const ghostMaterial = (): MeshBasicMaterial => (ghost ??= new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));

interface Saved {
  material?: Material | Material[];
  visible?: boolean;
}

export function ghostTree(root: Object3D, on: boolean): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const d = o.userData as { ghost?: Saved };
    if (on) {
      if (!d.ghost) d.ghost = { visible: o.visible, ...(o.castShadow ? { material: o.material } : {}) };
      if (o.castShadow) o.material = ghostMaterial();
      else o.visible = false;
    } else if (d.ghost) {
      if (d.ghost.material) o.material = d.ghost.material;
      else o.visible = d.ghost.visible ?? true;
      delete d.ghost;
    }
  });
}

/**
 * D-077: "SEE-THROUGH". When a wall behind the player brings the follow camera hard against their back, the picture would be the inside of their own hat:
 * the local body is then drawn screen-door dithered (two pixels in three dropped, on a diagonal lattice), so the world shows through it. Every mesh
 * keeps its own look: its material is swapped for a dithered copy made once per material (the original's shader patch runs first, then the discard).
 * Ink hulls hide. The shadow pass draws depth with its own material, so the shadow stays whole. Reversible, like `ghostTree`.
 */
const seeThroughCopies = new WeakMap<Material, Material>();
function seeThrough(m: Material): Material {
  let c = seeThroughCopies.get(m);
  if (c) return c;
  c = m.clone();
  const orig = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  c.onBeforeCompile = (shader, renderer) => {
    orig(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `void main() {
        if (int(mod(gl_FragCoord.x + gl_FragCoord.y * 2.0, 3.0)) != 0) discard; // (one pixel in three, on a diagonal lattice)`,
    );
  };
  c.customProgramCacheKey = () => `${key()}|see-through`;
  seeThroughCopies.set(m, c);
  return c;
}

export function seeThroughTree(root: Object3D, on: boolean): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const d = o.userData as { see?: Saved; ghost?: Saved };
    if (d.ghost) return; // (a ghosted mesh, in first person, stays ghosted)
    if (on) {
      if (d.see) return;
      d.see = { visible: o.visible, material: o.material };
      if (!o.castShadow && !o.receiveShadow && o.material instanceof Material && (o.material as Material & { side?: number }).side === 1) o.visible = false; // an ink hull (back faces only)
      else o.material = Array.isArray(o.material) ? o.material.map(seeThrough) : seeThrough(o.material);
    } else if (d.see) {
      o.material = d.see.material!;
      o.visible = d.see.visible ?? true;
      delete d.see;
    }
  });
}
