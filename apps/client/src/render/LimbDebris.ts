import { Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, type Object3D } from "three";
import type { GoreLevel } from "@cb/procedural/three";
import { PALETTE } from "@cb/shared";

export const DEBRIS = {
  /** Severed limbs alive at once; the oldest is dropped first. Four players can only lose four limbs each, and most are gone within seconds. */
  max: 16,
  /** Seconds a limb lies about before it shrinks away. */
  life: 40,
  fade: 1.5,
  gravity: 13,
  restitution: 0.32,
  /** Height of the limb's centre above the ground once it lies flat (its own thickness). */
  restHeight: 0.06,
} as const;

interface Piece {
  group: Group;
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity, rad/s (world axes). */
  wx: number;
  wy: number;
  wz: number;
  age: number;
  landed: boolean;
  /** Orientation it settles into once it lands: the limb's length horizontal. */
  lying: Quaternion;
  /** A limb bleeds where it lands (`onLand`); a weapon knocked out of a hand (D-104) only clatters (`onClatter`). */
  bleed: boolean;
  /** Height of its centre above the ground once it lies flat. */
  rest: number;
}

const capGeo = new SphereGeometry(1, 8, 5);
const capMats = new Map<GoreLevel, MeshBasicMaterial>();
const capMat = (gore: GoreLevel): MeshBasicMaterial => {
  let m = capMats.get(gore);
  if (!m) capMats.set(gore, (m = new MeshBasicMaterial({ color: PALETTE.gore[gore].fresh })));
  return m;
};

/** A gun lying on its side: its grip's centre this far above the ground (the stock's half thickness). */
const WEAPON_REST = 0.035;

const spin = new Quaternion();
const axis = new Vector3();
const down = new Vector3(0, -1, 0);
const along = new Vector3();

/**
 * Severed limbs as cosmetic debris: a pooled handful of frozen-pose limb copies (see CharacterRig.detachLimb) that fly off, bounce,
 * settle flat and eventually shrink away. Purely presentational (Math.random is fine here; nothing feeds the simulation), so it
 * needs neither Rapier nor the server: the authoritative fact is the victim's `missing` bit.
 */
export class LimbDebris {
  private readonly pieces: Piece[] = [];
  /** Told once when a limb first hits the ground (x, z, heading vx, vz): the integrator leaves a pool and a spatter there (render/decals). */
  onLand: ((x: number, z: number, vx: number, vz: number) => void) | undefined;
  /** D-104: told once when a thrown weapon first hits the ground (x, y, z): the integrator plays the clatter. */
  onClatter: ((x: number, y: number, z: number) => void) | undefined;

  constructor(
    private readonly scene: { add(o: Object3D): unknown },
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  get count(): number {
    return this.pieces.length;
  }

  /** Takes ownership of `pivot` (origin at the cut end). `dx`/`dz` is the unit direction of the blow, `power` 0..1. */
  spawn(pivot: Group, dx: number, dz: number, power: number, gore: GoreLevel): void {
    const cap = new Mesh(capGeo, capMat(gore));
    cap.scale.set(0.055, 0.03, 0.055);
    cap.rotation.x = 0;
    pivot.add(cap);
    this.scene.add(pivot);
    if (this.pieces.length >= DEBRIS.max) this.remove(0);
    const len = Math.hypot(dx, dz);
    const ux = len > 1e-6 ? dx / len : 0;
    const uz = len > 1e-6 ? dz / len : 1;
    const p = Math.max(0.2, Math.min(1, power));
    const speed = 2.2 + p * 3.6;
    const yaw = Math.random() * Math.PI * 2;
    along.set(Math.cos(yaw), 0, Math.sin(yaw));
    const lying = new Quaternion().setFromUnitVectors(down, along);
    this.pieces.push({
      group: pivot,
      vx: ux * speed + (Math.random() - 0.5) * 1.4,
      vy: 3.2 + p * 2.6 + Math.random(),
      vz: uz * speed + (Math.random() - 0.5) * 1.4,
      wx: (Math.random() - 0.5) * 16,
      wy: (Math.random() - 0.5) * 8,
      wz: (Math.random() - 0.5) * 16,
      age: 0,
      landed: false,
      lying,
      bleed: true,
      rest: DEBRIS.restHeight,
    });
  }

  /**
   * D-104: a weapon knocked out of a hand. Takes ownership of `obj` (already placed in the world where the hand was): it spins away along (dx, dz) and up, clatters down,
   * and settles flat on its side, the way a dropped gun lies. No blood: it is not a limb. It shares the pool and the life of the limbs.
   */
  throwAway(obj: Object3D, dx: number, dz: number, power: number): void {
    const g = new Group();
    g.position.copy(obj.position);
    g.quaternion.copy(obj.quaternion);
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    obj.visible = true; // (a weapon model is built hidden until a hand shows it: this one was invisible in the first look)
    g.add(obj);
    this.scene.add(g);
    if (this.pieces.length >= DEBRIS.max) this.remove(0);
    const len = Math.hypot(dx, dz);
    const ux = len > 1e-6 ? dx / len : 0;
    const uz = len > 1e-6 ? dz / len : 1;
    const p = Math.max(0.2, Math.min(1, power));
    const speed = 1.6 + p * 2.4;
    // lying flat: level, turned to a random heading (the model's barrel runs along -Z, its sights up)
    const lying = new Quaternion().setFromAxisAngle(axis.set(0, 1, 0), Math.random() * Math.PI * 2).multiply(spin.setFromAxisAngle(axis.set(0, 0, 1), Math.PI / 2));
    this.pieces.push({
      group: g,
      vx: ux * speed + (Math.random() - 0.5) * 0.8,
      vy: 2.4 + p * 1.8 + Math.random() * 0.6,
      vz: uz * speed + (Math.random() - 0.5) * 0.8,
      wx: (Math.random() - 0.5) * 18,
      wy: (Math.random() - 0.5) * 10,
      wz: (Math.random() - 0.5) * 18,
      age: 0,
      landed: false,
      lying,
      bleed: false,
      rest: WEAPON_REST,
    });
  }

  /**
   * D-064: a blast at (x, z) throws whatever limbs lie within `radius` up and away again (they land again, and bleed again where they land). Falloff with distance; a piece
   * already in the air is simply hurried along.
   */
  blast(x: number, z: number, radius: number): void {
    if (!(radius > 0)) return;
    for (const s of this.pieces) {
      const g = s.group;
      const dx = g.position.x - x;
      const dz = g.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const ux = d > 1e-3 ? dx / d : Math.cos(s.age * 7);
      const uz = d > 1e-3 ? dz / d : Math.sin(s.age * 7);
      s.vx += ux * (3 + 7 * f);
      s.vz += uz * (3 + 7 * f);
      s.vy = Math.max(s.vy, 0) + 4 + 7 * f;
      s.wx += (Math.random() - 0.5) * 24 * f;
      s.wy += (Math.random() - 0.5) * 12 * f;
      s.wz += (Math.random() - 0.5) * 24 * f;
      s.landed = false;
      g.position.y += 0.02; // (off the ground, or the contact test would catch it again before it rises)
    }
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const s = this.pieces[i]!;
      s.age += dt;
      if (s.age >= DEBRIS.life) {
        this.remove(i);
        continue;
      }
      const g = s.group;
      const ground = this.groundAt(g.position.x, g.position.z) + s.rest;
      if (!s.landed || g.position.y > ground + 1e-3 || s.vy > 0) {
        s.vy -= DEBRIS.gravity * dt;
        g.position.x += s.vx * dt;
        g.position.y += s.vy * dt;
        g.position.z += s.vz * dt;
      }
      // Contact uses the same 1 mm the step above treats as resting: a bounce whose last step ended inside it, above `ground`, was neither
      // moved nor caught and hovered there, spinning, for the limb's whole life.
      if (g.position.y <= ground + 1e-3) {
        g.position.y = ground;
        if (s.vy < -1.2) s.vy = -s.vy * DEBRIS.restitution;
        else s.vy = 0;
        const drag = Math.exp(-4 * dt);
        s.vx *= drag;
        s.vz *= drag;
        if (!s.landed) {
          if (s.bleed) this.onLand?.(g.position.x, g.position.z, s.vx, s.vz);
          else this.onClatter?.(g.position.x, g.position.y, g.position.z);
        }
        s.landed = true;
        s.wx *= 0.5;
        s.wy *= 0.5;
        s.wz *= 0.5;
      }
      if (s.landed && s.vy === 0) {
        // Rolled to a stop: settle flat.
        g.quaternion.slerp(s.lying, 1 - Math.exp(-7 * dt));
      } else {
        const w = Math.hypot(s.wx, s.wy, s.wz);
        if (w > 1e-6) {
          axis.set(s.wx / w, s.wy / w, s.wz / w);
          spin.setFromAxisAngle(axis, w * dt);
          g.quaternion.premultiply(spin);
        }
      }
      const left = DEBRIS.life - s.age;
      g.scale.setScalar(left < DEBRIS.fade ? Math.max(0.001, left / DEBRIS.fade) : 1);
    }
  }

  private remove(i: number): void {
    const [s] = this.pieces.splice(i, 1);
    s?.group.removeFromParent();
  }

  dispose(): void {
    while (this.pieces.length) this.remove(0);
  }
}
