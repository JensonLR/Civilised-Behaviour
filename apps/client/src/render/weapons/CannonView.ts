import { Group, Mesh, MeshToonMaterial, Vector3 } from "three";
import { PALETTE, type CannonStateType } from "@cb/shared";
import { PartBuilder, addOutlineNormals, isSharedInk, outlineMaterial, sharedToonRamp } from "@cb/procedural/three";
import type { Scene } from "three";
import type { ShotFx } from "./ShotFx.ts";

const W = PALETTE.weapons;

/**
 * The camp's field cannon: an oak carriage with iron-tyred wheels, a bronze barrel on trunnions, a rammer and a pyramid of shot. Built from the same
 * primitives, toon ramp and ink as everything else. It shows the replicated `CannonStateType` (heading, elevation, loading phase, fuse, crew, rounds
 * left, times fired) and adds only presentation: recoil that rolls the whole gun back and eases it home, the rammer working the bore while the crew
 * loads, sparks at the touch hole while the fuse burns. Model space: origin on the ground under the trunnions, the muzzle toward -Z.
 */

const TRUNNION = 0.95;

function lay(b: PartBuilder, z0: number, z1: number, rBack: number, rFront: number, color: number, y = 0, x = 0): void {
  const back = Math.max(z0, z1);
  const front = Math.min(z0, z1);
  b.cylinder(rBack, rFront, back - front, color, [x, y, (back + front) / 2], [Math.PI / 2, 0, 0]);
}

function wheel(b: PartBuilder, x: number): void {
  const cy = 0.55;
  const cz = 0.05;
  b.torus(0.5, 0.055, W.carriage, [x, cy, cz], [0, Math.PI / 2, 0]);
  b.torus(0.545, 0.03, W.ironBand, [x, cy, cz], [0, Math.PI / 2, 0]);
  b.cylinder(0.1, 0.1, 0.2, W.ironBand, [x, cy, cz], [0, 0, Math.PI / 2]);
  b.cylinder(0.055, 0.055, 0.24, W.carriage, [x, cy, cz], [0, 0, Math.PI / 2]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.box(0.05, 0.42, 0.055, W.carriage, [x, cy + Math.cos(a) * 0.3, cz + Math.sin(a) * 0.3], [a, 0, 0]);
  }
}

function carriage(b: PartBuilder): void {
  wheel(b, 0.52);
  wheel(b, -0.52);
  // axle, cheeks (the two side brackets), cross-beams, the trail sloping down to the ground, the shoe and handspike
  b.cylinder(0.05, 0.05, 1.2, W.ironBand, [0, 0.55, 0.05], [0, 0, Math.PI / 2]);
  for (const s of [1, -1]) {
    b.box(0.1, 0.36, 1.35, W.carriage, [0.27 * s, 0.76, 0.3], [-0.05, 0, 0]);
    b.box(0.106, 0.075, 1.36, W.ironBand, [0.27 * s, 0.94, 0.3], [-0.05, 0, 0]);
    b.box(0.14, 0.14, 0.14, W.ironBand, [0.31 * s, 0.95, 0.0]);
    b.cylinder(0.075, 0.075, 0.08, W.ironBand, [0.36 * s, 0.95, 0.0], [0, 0, Math.PI / 2]);
  }
  b.box(0.5, 0.14, 0.12, W.carriage, [0, 0.66, -0.3]);
  b.box(0.5, 0.14, 0.12, W.carriage, [0, 0.66, 0.8]);
  b.box(0.2, 0.16, 1.35, W.carriage, [0, 0.37, 1.4], [0.45, 0, 0]); // the trail: from the cross-beam down to the shoe on the ground
  b.box(0.22, 0.06, 0.24, W.ironBand, [0, 0.05, 2.02]);
  // the handspike lies on the ground beside the trail, and the powder keg stands on it (nothing hovers)
  b.cylinder(0.03, 0.03, 1.0, W.walnut, [-0.36, 0.03, 1.5], [Math.PI / 2, 0, 0.06]);
  b.cylinder(0.14, 0.14, 0.28, W.walnut, [0.34, 0.14, 1.12]);
  b.torus(0.142, 0.012, W.ironBand, [0.34, 0.07, 1.12], [Math.PI / 2, 0, 0]);
  b.torus(0.142, 0.012, W.ironBand, [0.34, 0.21, 1.12], [Math.PI / 2, 0, 0]);
}

function barrel(b: PartBuilder): void {
  // the tube, in relief: breech reinforce, the chase, the muzzle swell; rings at the joins; a cascabel behind
  lay(b, 0.62, 0.05, 0.2, 0.185, W.bronze);
  lay(b, 0.05, -0.75, 0.185, 0.15, W.bronze);
  lay(b, -0.75, -1.05, 0.15, 0.14, W.bronze);
  lay(b, -1.02, -1.2, 0.175, 0.175, W.bronzeDark);
  for (const z of [0.5, 0.1, -0.3, -0.75, -1.0]) b.torus(0.19 - (0.62 - z) * 0.05, 0.02, W.bronzeDark, [0, 0, z], [0, 0, 0]);
  b.sphere(0.1, W.bronze, [0, 0, 0.7]);
  b.cylinder(0.05, 0.08, 0.1, W.bronzeDark, [0, 0, 0.63], [Math.PI / 2, 0, 0]);
  b.cylinder(0.065, 0.065, 0.78, W.ironBand, [0, 0, 0], [0, 0, Math.PI / 2]);
  b.cylinder(0.02, 0.02, 0.05, PALETTE.ink, [0, 0.2, 0.42]); // the touch hole
  b.cylinder(0.11, 0.11, 0.02, PALETTE.ink, [0, 0, -1.205], [Math.PI / 2, 0, 0]); // the bore
}

function rammer(b: PartBuilder): void {
  lay(b, 0, -1.6, 0.018, 0.018, W.walnut);
  lay(b, -1.6, -1.86, 0.075, 0.075, PALETTE.material.cream);
  b.sphere(0.075, PALETTE.material.cream, [0, 0, -1.87]);
}

export class CannonView {
  readonly root = new Group();
  private readonly pivot = new Group();
  private readonly barrelGroup = new Group();
  private readonly ramGroup = new Group();
  private readonly balls: Mesh[] = [];
  private recoil = 0;
  private lastFired = -1;
  private time = 0;
  private readonly tmp = new Vector3();

  constructor(scene: Scene, private readonly fx: ShotFx, outline: boolean) {
    const ramp = sharedToonRamp();
    const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
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
    this.pivot.position.set(0, TRUNNION, 0);
    this.barrelGroup.add(make(barrel));
    this.pivot.add(this.barrelGroup);
    this.root.add(this.pivot);
    this.ramGroup.add(make(rammer));
    this.ramGroup.visible = false;
    this.pivot.add(this.ramGroup);
    // shot in a pyramid by the wheel
    const ballGeo = new PartBuilder();
    ballGeo.sphere(0.115, W.shell);
    const bg = ballGeo.build();
    if (bg) {
      addOutlineNormals(bg);
      const spots: [number, number, number][] = [[0.95, 0.115, 0.5], [1.19, 0.115, 0.5], [1.07, 0.115, 0.29], [1.07, 0.3, 0.44]];
      for (const [x, y, z] of spots) {
        const m = new Mesh(bg, new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
        m.position.set(x, y, z);
        m.castShadow = true;
        this.root.add(m);
        if (outline) {
          const h = new Mesh(bg, outlineMaterial());
          h.position.copy(m.position);
          this.root.add(h);
          m.userData.hull = h;
        }
        this.balls.push(m);
      }
    }
    scene.add(this.root);
  }

  /** Follows the replicated state. `dt` in seconds. */
  update(dt: number, st: CannonStateType): void {
    this.time += dt;
    this.recoil = Math.max(0, this.recoil - dt / 1.7);
    if (this.lastFired !== -1 && st.fired !== this.lastFired) this.recoil = 1;
    this.lastFired = st.fired;
    const eased = this.recoil * this.recoil;
    // the whole gun rolls back along its barrel line, the barrel slides in its cheeks, both ease home
    this.root.position.set(st.x + Math.sin(st.yaw) * eased * 0.45, st.y, st.z + Math.cos(st.yaw) * eased * 0.45);
    this.root.rotation.y = st.yaw;
    this.pivot.rotation.x = st.elev;
    this.barrelGroup.position.z = eased * 0.28;
    // the rammer works while the crew loads
    const loading = st.phase === 1 && st.crew > 0;
    this.ramGroup.visible = loading;
    if (loading) {
      const stroke = 0.5 - 0.5 * Math.cos(this.time * (st.crew >= 2 ? 6 : 3.5));
      this.ramGroup.position.set(0, 0.02, -0.1 + stroke * 0.95);
    }
    // shot on the ground: one for each round left in the limber (four at most drawn)
    const show = Math.min(this.balls.length, st.shells);
    for (let i = 0; i < this.balls.length; i++) {
      const m = this.balls[i]!;
      const on = i < show;
      m.visible = on;
      const h = m.userData.hull as Mesh | undefined;
      if (h) h.visible = on;
    }
    if (st.phase === 3) {
      this.pivot.updateWorldMatrix(true, false);
      this.pivot.localToWorld(this.tmp.set(0, 0.22, 0.42));
      this.fx.fuse(this.tmp.x, this.tmp.y, this.tmp.z);
    }
  }

  /** The muzzle in world space and the direction it points. */
  muzzle(pos: Vector3, dir: Vector3): void {
    this.root.updateMatrixWorld(true);
    this.barrelGroup.localToWorld(pos.set(0, 0, -1.2));
    this.barrelGroup.getWorldDirection(dir).negate();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof Mesh) {
        // geometry is per view here (one gun per camp); materials too
        o.geometry.dispose();
        const m = o.material;
        if (!Array.isArray(m) && !isSharedInk(m)) m.dispose();
      }
    });
  }
}
