import { Group, Mesh, MeshToonMaterial, Vector3 } from "three";
import { CRANK, CRANK_PHASE, PALETTE, type CannonStateType } from "@cb/shared";
import { PartBuilder, addOutlineNormals, isSharedInk, outlineMaterial, sharedToonRamp } from "@cb/procedural/three";
import type { Scene } from "three";

const W = PALETTE.weapons;

/**
 * D-092: the post's crank gun, a cluster of five brass-banded barrels on a light two-wheeled carriage, with a hopper on top and a handle on the right. Built
 * like the field cannon (`CannonView`: the same primitives, toon ramp and ink) and following the same replicated `CannonStateType` (kind 1): heading,
 * elevation, rounds fired, the phase. Presentation only: the barrels turn a fifth for every round and the handle with them, the gun shivers as it fires, the
 * handle jerks while it is jammed, and the spare hoppers stand in a row by the wheel, one for each in the limber. Model space: origin on the ground under the
 * barrels' pivot, the muzzles toward -Z.
 */

const BARRELS = 5;
const WHEEL_R = 0.42;

function carriage(b: PartBuilder): void {
  for (const s of [1, -1]) {
    const x = 0.42 * s;
    b.torus(WHEEL_R, 0.045, W.carriage, [x, WHEEL_R, 0.1], [0, Math.PI / 2, 0]);
    b.torus(WHEEL_R + 0.035, 0.022, W.ironBand, [x, WHEEL_R, 0.1], [0, Math.PI / 2, 0]);
    b.cylinder(0.07, 0.07, 0.16, W.ironBand, [x, WHEEL_R, 0.1], [0, 0, Math.PI / 2]);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.box(0.04, 0.36, 0.045, W.carriage, [x, WHEEL_R + Math.cos(a) * 0.2, 0.1 + Math.sin(a) * 0.2], [a, 0, 0]);
    }
  }
  b.cylinder(0.045, 0.045, 0.92, W.ironBand, [0, WHEEL_R, 0.1], [0, 0, Math.PI / 2]);
  // the cheeks rising to the pivot, and the trail from the axle down to its shoe on the ground behind
  for (const s of [1, -1]) b.box(0.07, CRANK.trunnion - WHEEL_R + 0.1, 0.22, W.carriage, [0.2 * s, (CRANK.trunnion + WHEEL_R) / 2, 0.08]);
  b.box(0.42, 0.06, 0.16, W.ironBand, [0, CRANK.trunnion - 0.1, 0.08]);
  // (short: the gun stands within a metre of its pivot, the collider's circle, so the crew at the breech never stands in it)
  b.box(0.16, 0.12, 0.85, W.carriage, [0, 0.25, 0.55], [0.3, 0, 0]);
  b.box(0.2, 0.08, 0.2, W.ironBand, [0, 0.04, 0.94]);
}

/** The barrels' frame (it turns about the bore line): five tubes round the axis, two brass plates holding them, the muzzle ring. */
function cluster(b: PartBuilder): void {
  for (let i = 0; i < BARRELS; i++) {
    const a = (i / BARRELS) * Math.PI * 2;
    const x = Math.cos(a) * 0.065, y = Math.sin(a) * 0.065;
    b.cylinder(0.022, 0.024, 1.15, W.steelDark, [x, y, -0.48], [Math.PI / 2, 0, 0]);
    b.cylinder(0.012, 0.012, 0.02, PALETTE.ink, [x, y, -1.055], [Math.PI / 2, 0, 0]);
  }
  for (const z of [-0.98, -0.45]) b.cylinder(0.11, 0.11, 0.05, W.brass, [0, 0, z], [Math.PI / 2, 0, 0]);
  b.cylinder(0.025, 0.025, 1.2, W.brassDark, [0, 0, -0.45], [Math.PI / 2, 0, 0]);
}

/** What does not turn: the breech casing, the hopper on top of it, the handle's boss; the knob and arm are their own group. */
function breech(b: PartBuilder): void {
  b.box(0.27, 0.27, 0.42, W.bronze, [0, 0, 0.28]);
  b.box(0.29, 0.04, 0.44, W.bronzeDark, [0, 0.135, 0.28]);
  b.box(0.17, 0.3, 0.2, W.ironBand, [0, 0.29, 0.26]);
  b.box(0.19, 0.03, 0.22, W.brass, [0, 0.45, 0.26]);
  b.cylinder(0.06, 0.06, 0.06, W.brassDark, [0.16, 0, 0.36], [0, 0, Math.PI / 2]);
  b.sphere(0.035, W.bronzeDark, [0, 0.03, 0.5]);
}

function handle(b: PartBuilder): void {
  b.box(0.03, 0.03, 0.2, W.ironBand, [0, 0, -0.1]);
  b.cylinder(0.022, 0.022, 0.12, W.walnut, [0.06, 0, -0.2], [0, 0, Math.PI / 2]);
}

function hopper(b: PartBuilder): void {
  b.box(0.17, 0.26, 0.2, W.ironBand, [0, 0.13, 0]);
  b.box(0.19, 0.03, 0.22, W.brass, [0, 0.27, 0]);
}

export class CrankGunView {
  readonly root = new Group();
  private readonly pivot = new Group();
  private readonly turning = new Group();
  private readonly arm = new Group();
  private readonly spares: Group[] = [];
  private shiver = 0;
  private spin = 0;
  private lastFired = -1;
  private time = 0;

  constructor(scene: Scene, outline: boolean) {
    const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: sharedToonRamp() });
    const make = (build: (b: PartBuilder) => void): Group => {
      const g = new Group();
      const b = new PartBuilder();
      build(b);
      const geo = b.build();
      if (geo) {
        addOutlineNormals(geo);
        const m = new Mesh(geo, mat);
        m.castShadow = true;
        g.add(m);
        if (outline) g.add(new Mesh(geo, outlineMaterial()));
      }
      return g;
    };
    this.root.add(make(carriage));
    this.pivot.position.set(0, CRANK.trunnion, 0);
    this.pivot.add(make(breech));
    this.turning.add(make(cluster));
    this.pivot.add(this.turning);
    this.arm.position.set(0.2, 0, 0.36);
    this.arm.add(make(handle));
    this.pivot.add(this.arm);
    this.root.add(this.pivot);
    // the spare hoppers, in a row on the ground beside the right wheel (three at most: the limber's)
    for (let i = 0; i < CRANK.hoppers - 1; i++) {
      const h = make(hopper);
      h.position.set(0.75, 0, -0.25 + i * 0.26);
      this.spares.push(h);
      this.root.add(h);
    }
    scene.add(this.root);
  }

  /** Follows the replicated state. `dt` in seconds. */
  update(dt: number, st: CannonStateType): void {
    this.time += dt;
    if (this.lastFired !== -1 && st.fired !== this.lastFired) {
      const n = (st.fired - this.lastFired + 256) & 255;
      this.spin += n * ((Math.PI * 2) / BARRELS);
      this.shiver = 1;
    }
    this.lastFired = st.fired;
    this.shiver = Math.max(0, this.shiver - dt / 0.12);
    const jitter = this.shiver * 0.012 * Math.sin(this.time * 90);
    this.root.position.set(st.x + Math.sin(st.yaw) * jitter, st.y, st.z + Math.cos(st.yaw) * jitter);
    this.root.rotation.y = st.yaw;
    this.pivot.rotation.x = st.elev;
    this.turning.rotation.z = this.spin;
    // the handle goes round with the barrels (one turn a round); jammed, it jerks against the stop while somebody tries it
    const jammed = st.phase === CRANK_PHASE.JAMMED && st.crew > 0;
    this.arm.rotation.x = jammed ? 0.35 * Math.sin(this.time * 14) : this.spin * (BARRELS / (Math.PI * 2)) * Math.PI * 2;
    const show = Math.min(this.spares.length, st.shells);
    for (let i = 0; i < this.spares.length; i++) this.spares[i]!.visible = i < show;
  }

  /** The muzzle in world space (the middle of the barrels' mouths) and the direction it points. */
  muzzle(pos: Vector3, dir: Vector3): void {
    this.root.updateMatrixWorld(true);
    this.pivot.localToWorld(pos.set(0, 0, -CRANK.barrel));
    this.pivot.getWorldDirection(dir).negate();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (!Array.isArray(m) && !isSharedInk(m)) m.dispose();
      }
    });
  }
}
