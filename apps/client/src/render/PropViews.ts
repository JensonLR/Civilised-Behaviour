import { AdditiveBlending, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, MeshToonMaterial, Quaternion, Vector3, type Scene } from "three";
import { INTERACT, PALETTE, PROP_DEFS, PropKind, type PropKindId, type PropStateType } from "@cb/shared";
import { WORLD_INK, instancedWorldOutline, syncInstancedOutline } from "@cb/procedural/three";
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
/** D-054: sparks per lit keg (a core at the fuse's end, the rest jumping round it), and how many lit kegs are drawn at once. */
export const SPARKS_PER_KEG = 6;
export const SPARK_KEGS = 8;

export class PropViews {
  private readonly material: MeshToonMaterial = toonMaterial();
  /** One instanced batch for every lit keg's sparks: additive, unlit, a single draw. */
  private readonly sparks: InstancedMesh;
  private readonly sp = new Vector3();
  private readonly tip = new Vector3();
  private readonly s3 = new Vector3();
  private frame = 0;
  /** Where the lit kegs' fuses are this frame (x, y, z, tenths left; read by the audio for the hiss). */
  readonly fuses: { x: number; y: number; z: number; tenths: number }[] = Array.from({ length: SPARK_KEGS }, () => ({ x: 0, y: 0, z: 0, tenths: 0 }));
  litCount = 0;
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
        const hull = instancedWorldOutline(mesh, { thickness: WORLD_INK.medium });
        hull.geometry = propGeometry(kind, 0);
        hull.frustumCulled = false;
        scene.add(hull);
        set.hull = hull;
      }
      this.sets.set(kind, set);
    }
    this.sparks = new InstancedMesh(
      new IcosahedronGeometry(0.045, 0),
      new MeshBasicMaterial({ color: PALETTE.weaponFx.spark, transparent: true, opacity: 0.95, depthWrite: false, blending: AdditiveBlending }),
      SPARKS_PER_KEG * SPARK_KEGS,
    );
    this.sparks.name = "keg_sparks";
    this.sparks.count = 0;
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    scene.add(this.sparks);
  }

  private sparkAt(i: number, x: number, y: number, z: number, scale: number): void {
    this.sp.set(x, y, z);
    this.s3.setScalar(scale);
    this.sparks.setMatrixAt(i, this.m4.compose(this.sp, this.q.identity(), this.s3));
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
    let lit = 0;
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
      // D-054: a lit keg's fuse spits sparks from the top of the keg (the top follows the keg as it tumbles through the air)
      const fuse = prop.fuse ?? 0;
      if (fuse > 0 && lit < SPARK_KEGS) {
        const half = PROP_DEFS[kind].half[1];
        this.tip.set(0, half + 0.06, 0).applyQuaternion(this.q).add(this.p);
        const f = this.fuses[lit]!;
        f.x = this.tip.x;
        f.y = this.tip.y;
        f.z = this.tip.z;
        f.tenths = fuse;
        const base = lit * SPARKS_PER_KEG;
        this.sparkAt(base, this.tip.x, this.tip.y, this.tip.z, 2.6 + 0.8 * Math.sin(this.frame * 1.7 + lit)); // (the core: a spitting bead of light at the fuse's end, the tell a player must see from across a camp)
        for (let k = 1; k < SPARKS_PER_KEG; k++) {
          // a cheap, frame-varying scatter (rendering only: nothing here is simulated)
          const h = Math.sin((this.frame + k * 13.7 + lit * 7.1) * 12.9898) * 43758.5453;
          const r = h - Math.floor(h);
          const a = r * Math.PI * 2;
          const d = 0.06 + 0.22 * ((r * 7.3) % 1);
          this.sparkAt(base + k, this.tip.x + Math.cos(a) * d, this.tip.y + 0.03 + 0.24 * ((r * 3.1) % 1), this.tip.z + Math.sin(a) * d, 0.7 + ((r * 5.7) % 1) * 0.8);
        }
        lit++;
      }
    });
    this.frame++;
    this.litCount = lit;
    this.sparks.count = lit * SPARKS_PER_KEG;
    this.sparks.visible = lit > 0;
    if (lit > 0) this.sparks.instanceMatrix.needsUpdate = true;
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
    this.sparks.removeFromParent();
    this.sparks.geometry.dispose();
    (this.sparks.material as MeshBasicMaterial).dispose();
    this.sparks.dispose();
    this.material.dispose();
    this.total = 0;
  }
}
