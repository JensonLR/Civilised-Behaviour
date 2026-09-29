import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  type Scene,
} from "three";
import { PROP_DEFS, PropKind, type PropKindId, type PropStateType } from "@cb/shared";

interface Look {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

/** Shared geometry/material per prop kind: N props of a kind cost N draw calls but zero extra GPU memory. */
function buildLooks(): Record<PropKindId, Look> {
  const c = PROP_DEFS[PropKind.CRATE].half;
  const b = PROP_DEFS[PropKind.BARREL].half;
  const o = PROP_DEFS[PropKind.BOTTLE].half;
  const h = PROP_DEFS[PropKind.CHAIR].half;
  return {
    [PropKind.CRATE]: { geometry: new BoxGeometry(c[0] * 2, c[1] * 2, c[2] * 2), material: new MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.9 }) },
    [PropKind.BARREL]: { geometry: new CylinderGeometry(b[0], b[0] * 0.92, b[1] * 2, 14), material: new MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8 }) },
    [PropKind.BOTTLE]: { geometry: new CapsuleGeometry(o[0], o[1] * 2, 4, 8), material: new MeshStandardMaterial({ color: 0x3d7a4d, roughness: 0.25, metalness: 0.1 }) },
    [PropKind.CHAIR]: { geometry: new BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2), material: new MeshStandardMaterial({ color: 0x7a3f2a, roughness: 0.85 }) },
  };
}

/** Renders server-owned props from interpolated replicated state. Purely visual: the server owns physics. */
export class PropViews {
  private readonly looks = buildLooks();
  private readonly meshes = new Map<string, Mesh>();

  constructor(private readonly scene: Scene) {}

  get count(): number {
    return this.meshes.size;
  }

  /** `value` reads the smoothed (interpolated) numeric field of a prop. */
  sync(
    props: { forEach(cb: (p: PropStateType, id: string) => void): void },
    value: (p: PropStateType, field: "x" | "y" | "z" | "qx" | "qy" | "qz" | "qw") => number,
  ): void {
    const seen = new Set<string>();
    props.forEach((p, id) => {
      seen.add(id);
      let m = this.meshes.get(id);
      if (!m) {
        const look = this.looks[p.kind as PropKindId] ?? this.looks[PropKind.CRATE];
        m = new Mesh(look.geometry, look.material);
        m.castShadow = true;
        m.receiveShadow = true;
        m.matrixAutoUpdate = true;
        this.scene.add(m);
        this.meshes.set(id, m);
      }
      m.position.set(value(p, "x"), value(p, "y"), value(p, "z"));
      m.quaternion.set(value(p, "qx"), value(p, "qy"), value(p, "qz"), value(p, "qw")).normalize();
    });
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        m.removeFromParent();
        this.meshes.delete(id);
      }
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.removeFromParent();
    this.meshes.clear();
    for (const l of Object.values(this.looks)) {
      l.geometry.dispose();
      l.material.dispose();
    }
  }
}
