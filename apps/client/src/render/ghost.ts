import { Mesh, MeshBasicMaterial, type Material, type Object3D } from "three";

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
