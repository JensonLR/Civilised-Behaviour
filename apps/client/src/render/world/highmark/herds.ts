import { Color, CylinderGeometry, Matrix4, Sphere, SphereGeometry, Vector3, type BufferGeometry, type Object3D } from "three";
import { PALETTE, HERD_CAP, herdAt, herdCount, herdPlan, herdVariety, type CollisionWorld, type HerdPlan } from "./shared.ts";
import { Kit, type V3 } from "../kit.ts";
import type { Lod } from "../flora.ts";
import { composeInstance, makeInstances, toonMaterial, type InstanceSet } from "../toon.ts";

/**
 * The herds of Highmark: up to HERD_CAP long-horned grazers on the grass, ONE instanced draw (and one ink hull). Their positions are `herdAt` of the shared plan at the clock the
 * Stage hands over: a pure function of (seed, world seconds), so every client sees them in the same place and nothing is stored or sent. They are scenery: nothing hits them.
 * The beast faces local +x. The matrices are rewritten each frame without allocating.
 */

const P = PALETTE.highmark;

/** A grazing beast: barrel body, a shoulder hump, a lowered neck and head, four legs, a tail, two long curved horns. Faces +x, feet at y = 0. */
export function herdBeastGeometry(lod: Lod): BufferGeometry {
  const k = new Kit();
  const hide = P.hide;
  const dark = P.hideDark;
  const body = (s: V3, at: V3, colour: number): void => void k.add(new SphereGeometry(1, lod ? 8 : 5, lod ? 5 : 3), { at, scale: s, colour, flat: true });
  body([0.95, 0.5, 0.45], [0, 1.1, 0], hide);
  body([0.42, 0.34, 0.4], [0.5, 1.32, 0], dark);                    // the shoulder hump
  body([0.34, 0.3, 0.32], [-0.6, 1.05, 0], hide);                    // the haunch
  k.limb([0.78, 1.25, 0], [1.2, 0.85, 0], 0.2, 0.15, hide, lod ? 6 : 5);      // the neck, lowered to the grass
  body([0.27, 0.19, 0.17], [1.38, 0.78, 0], dark);                   // the head
  for (const [x, z] of [[-0.55, -0.22], [-0.55, 0.22], [0.55, -0.22], [0.55, 0.22]] as const) k.limb([x, 0.95, z], [x, 0.03, z], 0.085, 0.055, dark, 5);
  k.limb([-0.9, 1.15, 0], [-1.12, 0.45, 0], 0.045, 0.02, dark, 4);   // the tail
  for (const s of [-1, 1]) {
    k.limb([1.36, 0.95, s * 0.14], [1.32, 1.12, s * 0.46], 0.05, 0.035, P.hidePale, 4);
    k.limb([1.32, 1.12, s * 0.46], [1.5, 1.52, s * 0.52], 0.035, 0.012, P.hidePale, 4);
  }
  if (lod) k.add(new CylinderGeometry(0.17, 0.17, 0.4, 6), { at: [1.5, 0.74, 0], rot: [0, 0, Math.PI / 2], colour: P.hidePale, flat: true });
  return k.build()!;
}

const m4 = new Matrix4();
const pos = { x: 0, z: 0, yaw: 0 };

export class Herds {
  readonly plan: HerdPlan;
  readonly count: number;
  private set: InstanceSet | undefined;
  private readonly bob: Float32Array;

  constructor(root: Object3D, private readonly world: CollisionWorld, seed: number, outlines: boolean, lod: Lod, private readonly track: (x: { dispose(): void }) => void, enabled = true) {
    this.plan = herdPlan(seed);
    this.count = Math.min(HERD_CAP, herdCount(this.plan));
    this.bob = new Float32Array(this.count);
    if (!enabled || this.count === 0) return;
    const mats: Matrix4[] = [];
    const cols: Color[] = [];
    for (let i = 0; i < this.count; i++) {
      herdAt(this.plan, i, 0, pos);
      mats.push(composeInstance(new Matrix4(), pos.x, world.terrainHeight(pos.x, pos.z), pos.z, -pos.yaw, 1, 1, 1));
      const v = herdVariety(this.plan, i);
      this.bob[i] = v * 6.28;
      cols.push(new Color(1 - 0.18 * v, 1 - 0.14 * v, 1 - 0.1 * v));
    }
    const geo = herdBeastGeometry(lod);
    track(geo);
    const hull = outlines ? herdBeastGeometry(0) : undefined;
    if (hull) track(hull);
    const mat = toonMaterial({ wetDark: 0.6 });
    track(mat);
    this.set = makeInstances(root, geo, mat, mats, cols, { name: "herds", castShadow: true, outline: outlines, ink: "medium", hullGeometry: hull });
    for (const m of [this.set?.mesh, this.set?.hull]) {
      if (!m) continue;
      m.frustumCulled = false;   // the herds drift; one draw either way
      m.boundingSphere = new Sphere(new Vector3(0, 40, 0), 140);
    }
  }

  /** Writes every animal's matrix for `worldSec` (allocation-free). */
  update(worldSec: number): void {
    const set = this.set;
    if (!set) return;
    for (let i = 0; i < this.count; i++) {
      herdAt(this.plan, i, worldSec, pos);
      const sway = 0.05 * Math.sin(worldSec * 1.3 + this.bob[i]!);
      composeInstance(m4, pos.x, this.world.terrainHeight(pos.x, pos.z), pos.z, -pos.yaw, 1, 1, 1, 0, sway);
      set.mesh.setMatrixAt(i, m4);
    }
    set.mesh.instanceMatrix.needsUpdate = true;
  }
}
