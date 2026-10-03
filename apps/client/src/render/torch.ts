import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Scene } from "three";
import { PALETTE } from "@cb/shared";
import { toonMaterial } from "./world/toon.ts";

/**
 * A lit torch held upright in a hand (D-047: the Syndicate's raiders on the Raid on the Post, whose copy has always had them waving torches). One shared stick and two shared flame
 * cones for every torch in the scene; the flames are unlit (they ARE the light) and flicker by a pure function of time and a per-torch phase. `TorchHold` keeps the torch upright
 * whatever the wrist is doing (a person holds a torch up, not along their fingers), allocation-free per frame.
 */

const C = PALETTE.camp;
let shared: { stick: BufferGeometry; outer: BufferGeometry; inner: BufferGeometry; glow: BufferGeometry; wood: ReturnType<typeof toonMaterial>; flameOuter: MeshBasicMaterial; flameCore: MeshBasicMaterial; glowMat: MeshBasicMaterial } | undefined;
function parts(): NonNullable<typeof shared> {
  if (!shared) {
    // sized to read at fighting distance on the caricature's hand (the first cut, a 0.26 m flame, was a speck at 6 m: looked at, D-047)
    const stick = new CylinderGeometry(0.03, 0.04, 0.9, 6);
    stick.translate(0, 0.25, 0);
    // the toon material reads VERTEX colours: without them the stick drew black (D-048, seen in the first look at a dropped torch). Pole wood, charred at the burning head.
    const wood = new Color(C.pole), char = new Color(C.charred);
    const pos = stick.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) (pos.getY(i) > 0.58 ? char : wood).toArray(col, i * 3);
    stick.setAttribute("color", new BufferAttribute(col, 3));
    const outer = new ConeGeometry(0.12, 0.42, 7);
    outer.translate(0, 0.86, 0);
    const inner = new ConeGeometry(0.065, 0.26, 6);
    inner.translate(0, 0.8, 0);
    const glow = new IcosahedronGeometry(0.26, 1);
    glow.translate(0, 0.84, 0);
    shared = {
      stick, outer, inner, glow,
      wood: toonMaterial({}),
      flameOuter: new MeshBasicMaterial({ color: C.flameOuter, transparent: true, opacity: 0.92, depthWrite: false }),
      flameCore: new MeshBasicMaterial({ color: C.flameCore }),
      glowMat: new MeshBasicMaterial({ color: C.flameMid, transparent: true, opacity: 0.28, depthWrite: false, blending: AdditiveBlending }),
    };
  }
  return shared;
}

const qWrist = new Quaternion();
const qUp = new Quaternion();
const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.18);

/** One character's torch: built on first use, hung on the hand bone, shown or hidden each frame. */
export class TorchHold {
  readonly group = new Group();
  private readonly outer: Mesh;
  private readonly glow: Mesh;
  private readonly phase: number;

  constructor(seed: number) {
    const p = parts();
    const stick = new Mesh(p.stick, p.wood);
    stick.castShadow = true;
    this.outer = new Mesh(p.outer, p.flameOuter);
    const core = new Mesh(p.inner, p.flameCore);
    this.glow = new Mesh(p.glow, p.glowMat);
    this.group.add(stick, this.outer, core, this.glow);
    this.group.name = "torch";
    this.group.visible = false;
    this.phase = (seed % 97) * 0.37;
  }

  /** Hangs the torch on `hand` (the wrist bone). Call again after the rig is rebuilt. */
  attach(hand: Group): void {
    hand.add(this.group);
  }

  /** Shows it (or not), keeps it upright against the hand's world turn, and flickers the flame. `t` is seconds. */
  update(on: boolean, t: number): void {
    this.group.visible = on;
    if (!on) return;
    const hand = this.group.parent;
    if (hand) {
      hand.getWorldQuaternion(qWrist);
      // world orientation wanted: upright with a slight forward lean; local = inverse(parent world) * wanted
      qUp.copy(tilt);
      this.group.quaternion.copy(qWrist.invert()).multiply(qUp);
    }
    const f = 0.85 + 0.15 * Math.sin(t * 17 + this.phase) * Math.sin(t * 7.3 + this.phase * 2.1);
    this.outer.scale.set(1, f, 1);
    this.glow.scale.setScalar(0.9 + 0.2 * f);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** How long a dropped torch burns on the ground, and how long its last embers take to go out (seconds). */
export const GROUND_TORCH = { burnS: 18, outS: 4, cap: 8 } as const;

/**
 * Torches lying where their bearers fell (the raid's raiders; a torch does not vanish because the hand that held it let go). A small pool (`GROUND_TORCH.cap`; the oldest is reused):
 * the stick flat in the grass, the flame rising from its head and burning down, then out. Scenery only: it decides nothing and sets nothing alight. Allocation-free per frame.
 */
export class GroundTorches {
  private readonly slots: { group: Group; flame: Group; age: number; phase: number }[] = [];
  private next = 0;
  private t = 0;

  constructor(private readonly scene: Scene) {}

  /** A torch falls at (x, y, z) (y: the ground), its stick lying along `yaw`. */
  drop(x: number, y: number, z: number, yaw: number, seed: number): void {
    let s = this.slots.length < GROUND_TORCH.cap ? undefined : this.slots[this.next]!;
    if (!s) {
      const p = parts();
      const group = new Group();
      group.name = "groundTorch";
      // the stick lies flat (its length along local x); the flame stands up from the head end, as a flame does
      const stick = new Mesh(p.stick, p.wood);
      stick.rotation.z = -Math.PI / 2;
      stick.position.set(-0.25, 0.04, 0);
      stick.castShadow = true;
      // the flame stands on the head lying in the grass; it burns down toward its own BASE (scaled in a group whose origin is the base: the shared cones sit 0.65 m up
      // their own origin, so scaling the meshes themselves sank a dying flame into the ground, seen in the first look)
      const flame = new Group();
      flame.position.set(0.42, 0, 0);
      const outer = new Mesh(p.outer, p.flameOuter);
      const core = new Mesh(p.inner, p.flameCore);
      const glow = new Mesh(p.glow, p.glowMat);
      for (const m of [outer, core, glow]) m.position.y = -0.64;
      flame.add(outer, core, glow);
      group.add(stick, flame);
      this.scene.add(group);
      s = { group, flame, age: 0, phase: 0 };
      this.slots.push(s);
    }
    this.next = (this.slots.indexOf(s) + 1) % GROUND_TORCH.cap;
    s.group.position.set(x, y, z);
    s.group.rotation.set(0, yaw, 0);
    s.group.visible = true;
    s.age = 0;
    s.phase = (seed % 97) * 0.37;
  }

  /** Burns every lying torch down; `dt` seconds. */
  update(dt: number): void {
    this.t += dt;
    for (const s of this.slots) {
      if (!s.group.visible) continue;
      s.age += dt;
      const life = groundFlame(s.age);
      if (life <= 0) {
        s.group.visible = false;
        continue;
      }
      const f = 0.85 + 0.15 * Math.sin(this.t * 17 + s.phase) * Math.sin(this.t * 7.3 + s.phase * 2.1);
      s.flame.scale.set(life, life * f, life);
    }
  }

  /** How many are still burning (tests, the overlay). */
  get burning(): number {
    let n = 0;
    for (const s of this.slots) if (s.group.visible) n++;
    return n;
  }

  /** Puts every torch out (a new shore). */
  clear(): void {
    for (const s of this.slots) s.group.visible = false;
  }

  dispose(): void {
    for (const s of this.slots) s.group.removeFromParent();
    this.slots.length = 0;
  }
}

/** A lying torch's flame size by age: full while it burns, then shrinking to nothing over `outS`. Pure. */
export function groundFlame(age: number): number {
  if (age < GROUND_TORCH.burnS) return 1;
  return Math.max(0, 1 - (age - GROUND_TORCH.burnS) / GROUND_TORCH.outS);
}
