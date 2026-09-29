import { InstancedMesh, Matrix4, MeshToonMaterial, Quaternion, Vector3, type Scene } from "three";
import { INTERACT, PROP_DEFS, PropKind, type PropKindId, type PropStateType } from "@cb/shared";
import { instancedOutline, syncInstancedOutline } from "@cb/procedural/three";
import { propGeometry } from "./world/objects.ts";
import { toonMaterial } from "./world/toon.ts";

interface KindSet {
  mesh: InstancedMesh;
  hull?: InstancedMesh;
}

const KINDS = Object.keys(PROP_DEFS).map(Number) as PropKindId[];

/**
 * Renders server-owned props from interpolated replicated state. Purely visual: the server owns physics.
 * One InstancedMesh per kind (crate, barrel, bottle, chair) - each toon-shaded with the world's ramp and, on presets with
 * outlines, one ink hull draw per kind sharing the same instance buffer - so 48 props cost 4 (or 8) draws, not 48.
 * The instance matrices are rewritten every frame from the interpolated state (at most `maxPropsPerRoom` of them).
 */
export class PropViews {
  private readonly material: MeshToonMaterial = toonMaterial();
  private readonly sets = new Map<PropKindId, KindSet>();
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private total = 0;

  constructor(
    private readonly scene: Scene,
    outlines = true,
  ) {
    for (const kind of KINDS) {
      const geo = propGeometry(kind, 1);
      const mesh = new InstancedMesh(geo, this.material, INTERACT.maxPropsPerRoom);
      mesh.name = `props_${PROP_DEFS[kind].name}`;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances move every frame; the set is tiny
      scene.add(mesh);
      const set: KindSet = { mesh };
      if (outlines) {
        const hull = instancedOutline(mesh);
        hull.geometry = propGeometry(kind, 0);
        hull.frustumCulled = false;
        scene.add(hull);
        set.hull = hull;
      }
      this.sets.set(kind, set);
    }
  }

  get count(): number {
    return this.total;
  }

  /** `value` reads the smoothed (interpolated) numeric field of a prop. */
  sync(
    props: { forEach(cb: (p: PropStateType, id: string) => void): void },
    value: (p: PropStateType, field: "x" | "y" | "z" | "qx" | "qy" | "qz" | "qw") => number,
  ): void {
    for (const s of this.sets.values()) s.mesh.count = 0;
    let total = 0;
    props.forEach((prop) => {
      const kind = (this.sets.has(prop.kind as PropKindId) ? prop.kind : PropKind.CRATE) as PropKindId;
      const set = this.sets.get(kind)!;
      const i = set.mesh.count;
      if (i >= INTERACT.maxPropsPerRoom) return;
      this.p.set(value(prop, "x"), value(prop, "y"), value(prop, "z"));
      this.q.set(value(prop, "qx"), value(prop, "qy"), value(prop, "qz"), value(prop, "qw")).normalize();
      set.mesh.setMatrixAt(i, this.m4.compose(this.p, this.q, this.one));
      set.mesh.count = i + 1;
      total++;
    });
    this.total = total;
    for (const s of this.sets.values()) {
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.visible = s.mesh.count > 0; // an empty kind costs no draw call
      if (s.hull) {
        syncInstancedOutline(s.hull, s.mesh);
        s.hull.visible = s.mesh.visible;
      }
    }
  }

  dispose(): void {
    for (const s of this.sets.values()) {
      s.mesh.removeFromParent();
      s.hull?.removeFromParent();
      s.mesh.geometry.dispose();
      s.hull?.geometry.dispose();
      s.mesh.dispose();
    }
    this.sets.clear();
    this.material.dispose();
    this.total = 0;
  }
}
