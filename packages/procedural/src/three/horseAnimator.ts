import { MathUtils } from "three";
import type { HorseRig } from "./horse.ts";

/** What the animator reads each frame; the game maps replicated mount state onto it. */
export interface HorsePoseInput {
  /** Horizontal speed, m/s. */
  speed: number;
  /** Standing on the ground (default true). False + `vy` gives the jump. */
  grounded?: boolean;
  /** Vertical velocity, m/s (the jump's arc). */
  vy?: number;
  /** Yaw rate, rad/s (positive = turning left). The body rolls and the neck bends into a turn. */
  turn?: number;
  /** 0..1: how heavily the horse is loaded (a wagon behind it, a rider on a pack saddle): it sags and shortens its stride a touch. */
  load?: number;
  /** Bolting: ears flat, head up, tail streaming, whatever the speed. */
  bolting?: boolean;
  /** 0..1 rearing (the horse throws its rider: the body pivots on the hind hooves). */
  rear?: number;
  /** Somebody is on its back or holding its head: the reins are drawn taut and the ears listen. */
  ridden?: boolean;
  /** Pulling a wagon: head low, a harness's lean into the collar. */
  hitched?: boolean;
}

const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = MathUtils.clamp;
/** A hostile or broken input (NaN, Infinity) must never reach the blend state: damping NaN would poison it for good. */
const fin = (v: number | undefined, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const tri = (x: number, a: number, b: number, c: number): number => (x <= a || x >= c ? 0 : x < b ? (x - a) / (b - a) : (c - x) / (c - b));
const h01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** The four gaits' tables: leg phase offsets (LF, RF, LH, RH), stance fraction, swing amplitude (fore, hind) and knee/hock fold (fore, hind). */
const GAITS = {
  walk: { off: [0.25, 0.75, 0, 0.5], duty: 0.62, ampF: 0.36, ampH: 0.3, foldF: 0.75, foldH: 0.55, speed: 3.0 },
  trot: { off: [0, 0.5, 0.5, 0], duty: 0.5, ampF: 0.5, ampH: 0.42, foldF: 1.15, foldH: 0.95, speed: 6.4 },
  canter: { off: [0.62, 0.34, 0.34, 0.0], duty: 0.42, ampF: 0.62, ampH: 0.55, foldF: 1.35, foldH: 1.15, speed: 8.9 },
  gallop: { off: [0.46, 0.54, 0.0, 0.1], duty: 0.33, ampF: 0.8, ampH: 0.72, foldF: 1.55, foldH: 1.35, speed: 10.5 },
} as const;
const NAMES = ["walk", "trot", "canter", "gallop"] as const;

/**
 * Procedural animation of the horse rig (rigid hierarchy; conventions as the characters': a hanging limb swings FORWARD with a positive rotation.x, a foreleg's knee folds
 * with a negative one, a hind leg's hock folds with a positive one, the barrel pitches nose-UP with a positive rotation.x). The gait phase is driven by distance travelled
 * (no skating) and the four gaits are BLENDED by speed, not switched, so accelerating from a walk to a gallop passes through trot and canter without a pop. The animator owns
 * every channel it writes: all of them are reset at the start of each update.
 *
 * `motion` is what the rider needs (see `RideInput`): where the barrel is and how it is tilted.
 */
export class HorseAnimator {
  private phase = 0;
  private time = 0;
  private move = 0;
  private air = 0;
  private load = 0;
  private bolt = 0;
  private rearW = 0;
  private turnS = 0;
  private lean = 0;
  private readonly w = [0, 0, 0, 0];
  private readonly seed: number;
  private idleAct = 0;
  private idleSlot = -1;
  private idleAmt = 0;
  /** What the rider needs: the barrel's origin height above its rest (`bob`) and z shift (`bodyZ`, while rearing), its pitch (nose-up positive) and roll. */
  readonly motion = { bob: 0, bodyZ: 0, pitch: 0, roll: 0, gait: 0, stride: 1.5 };
  /** Idle ear flicks, tail swishes and hoof pawing. Off for stills and deterministic tests. */
  ambient = true;

  constructor(private readonly rig: HorseRig, seed = 1) {
    this.seed = seed | 0;
  }

  /** Where in the stride the legs are (0..1), for tests. */
  get stridePhase(): number {
    return this.phase;
  }

  update(dt: number, input: HorsePoseInput): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.1);
    const j = this.rig.joints;
    const speed = Number.isFinite(input.speed) ? Math.min(Math.max(0, input.speed), 40) : 0;
    const grounded = input.grounded !== false;
    this.time += dt;

    // ---- blend state ---------------------------------------------------------------------------------------------------------------------------------
    this.move = damp(this.move, speed > 0.25 ? 1 : 0, 9, dt);
    this.air = damp(this.air, grounded ? 0 : 1, grounded ? 9 : 16, dt);
    this.load = damp(this.load, clamp(fin(input.load), 0, 1), 4, dt);
    this.bolt = damp(this.bolt, input.bolting ? 1 : 0, 6, dt);
    this.rearW = damp(this.rearW, clamp(fin(input.rear), 0, 1), 7, dt);
    this.turnS = damp(this.turnS, clamp(fin(input.turn), -3, 3), 6, dt);
    const targets = [tri(speed, -1, 3.0, 6.4), tri(speed, 3.0, 6.4, 8.9), tri(speed, 6.4, 8.9, 10.5), smooth(8.9, 10.5, speed)];
    // below the walk's speed the walk fades with the legs (`move`); above the gallop the gallop holds
    if (speed < 3.0) targets[0] = 1;
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += targets[i]!;
    for (let i = 0; i < 4; i++) this.w[i] = damp(this.w[i]!, targets[i]! / (sum || 1), 8, dt);

    // ---- stride: distance-locked phase ----------------------------------------------------------------------------------------------------------------
    const stride = 1.4 + 0.3 * speed; // metres per cycle: ~2.3 at a walk, ~3.3 at a trot, ~4.5 at a gallop
    this.motion.stride = stride;
    if (grounded) this.phase = (this.phase + (speed * dt) / stride) % 1;

    // ---- reset every channel this animator owns ------------------------------------------------------------------------------------------------------
    j.body.position.set(0, 0.62, 0);
    j.body.rotation.set(0, 0, 0);
    j.neck.rotation.set(0, 0, 0);
    j.head.rotation.set(-0.8, 0, 0);
    j.tail.rotation.set(0, 0, 0);
    j.earL.rotation.set(0, 0, 0);
    j.earR.rotation.set(0, 0, 0);
    for (const l of [j.foreL, j.foreR, j.hindL, j.hindR]) {
      l.top.rotation.set(0, 0, 0);
      l.knee.rotation.set(0, 0, 0);
    }

    // ---- legs --------------------------------------------------------------------------------------------------------------------------------------------
    const legs = [j.foreL, j.foreR, j.hindL, j.hindR] as const;
    let bob = 0;
    let pitch = 0;
    let headNod = 0;
    for (let g = 0; g < 4; g++) {
      const wg = this.w[g]! * this.move;
      if (wg < 0.001) continue;
      const G = GAITS[NAMES[g]!];
      for (let k = 0; k < 4; k++) {
        const fore = k < 2;
        const p = (this.phase + G.off[k]!) % 1;
        const amp = fore ? G.ampF : G.ampH;
        let ang: number;
        let lift = 0;
        if (p < G.duty) ang = amp * (1 - (2 * p) / G.duty);
        else {
          const u = (p - G.duty) / (1 - G.duty);
          const e = u * u * (3 - 2 * u);
          ang = amp * (-1 + 2 * e);
          lift = Math.sin(Math.PI * u);
        }
        legs[k]!.top.rotation.x += ang * wg;
        legs[k]!.knee.rotation.x += (fore ? -1 : 1) * lift * (fore ? G.foldF : G.foldH) * wg;
      }
      const ph = 2 * Math.PI * this.phase;
      if (g === 0) {
        bob += 0.012 * Math.cos(ph * 2) * wg;
        pitch += 0.012 * Math.sin(ph) * wg;
        headNod += 0.07 * Math.sin(ph - 0.6) * wg;
      } else if (g === 1) {
        bob += 0.034 * Math.abs(Math.cos(ph * 2 + 0.2)) * wg - 0.012 * wg;
        pitch += 0.018 * Math.sin(ph * 2) * wg;
        headNod += 0.05 * Math.sin(ph * 2 - 0.6) * wg;
      } else if (g === 2) {
        bob += 0.05 * Math.sin(ph + 1.1) * wg;
        pitch += 0.075 * Math.sin(ph + 0.4) * wg;
        headNod += 0.12 * Math.sin(ph - 0.2) * wg;
      } else {
        bob += 0.065 * Math.sin(ph + 1.0) * wg;
        pitch += 0.1 * Math.sin(ph + 0.3) * wg;
        headNod += 0.16 * Math.sin(ph - 0.3) * wg;
      }
    }
    const fast = this.w[2]! + this.w[3]!;

    // ---- the jump: forelegs tucked, hind legs trailing, the barrel following the arc ---------------------------------------------------------------------------
    const a = this.air;
    if (a > 0.001) {
      const vy = fin(input.vy);
      pitch = pitch * (1 - a) + clamp(vy * 0.05, -0.32, 0.32) * a;
      for (const l of [j.foreL, j.foreR]) {
        l.top.rotation.x = l.top.rotation.x * (1 - a) + 0.85 * a;
        l.knee.rotation.x = l.knee.rotation.x * (1 - a) - 1.55 * a;
      }
      for (const l of [j.hindL, j.hindR]) {
        l.top.rotation.x = l.top.rotation.x * (1 - a) - 0.65 * a;
        l.knee.rotation.x = l.knee.rotation.x * (1 - a) + 1.25 * a;
      }
      bob *= 1 - a;
      headNod = headNod * (1 - a) - 0.2 * a;
    }

    // ---- rearing: pivot on the hind hooves ------------------------------------------------------------------------------------------------------------------
    const r = this.rearW;
    if (r > 0.001) {
      const ang = 0.95 * r;
      for (const l of [j.foreL, j.foreR]) {
        l.top.rotation.x = l.top.rotation.x * (1 - r) + 0.9 * r;
        l.knee.rotation.x = l.knee.rotation.x * (1 - r) - 1.25 * r;
      }
      for (const l of [j.hindL, j.hindR]) {
        l.top.rotation.x = l.top.rotation.x * (1 - r) + -ang * 0.9 * r;
        l.knee.rotation.x = l.knee.rotation.x * (1 - r) + ang * 0.35 * r;
      }
      headNod = headNod * (1 - r) + 0.25 * r;
    }

    // ---- body ---------------------------------------------------------------------------------------------------------------------------------------------
    const sag = 0.028 * this.load;
    const turn = this.turnS;
    this.lean = damp(this.lean, clamp(speed / 10.5, 0, 1), 4, dt);
    const roll = clamp(-turn * 0.035 * speed, -0.16, 0.16);
    j.body.rotation.z = roll;
    // while rearing the barrel pivots on the hind hooves (z = +0.72 behind the centre, on the ground), otherwise on its own centre
    const ra = 0.95 * r;
    let by = 0.62 - sag + bob;
    let bz = 0;
    if (ra > 0) {
      by = 0.62 * Math.cos(ra) + 0.72 * Math.sin(ra) - sag + bob;
      bz = 0.72 + 0.62 * Math.sin(ra) - 0.72 * Math.cos(ra);
    }
    j.body.rotation.x = pitch + ra;
    j.body.position.set(0, by, bz);
    this.motion.bob = by - 0.62;
    this.motion.bodyZ = bz;
    this.motion.pitch = pitch + ra;
    this.motion.roll = roll;
    this.motion.gait = this.w[1]! * 1 + this.w[2]! * 2 + this.w[3]! * 3 + 0;

    // ---- neck and head -----------------------------------------------------------------------------------------------------------------------------------
    const stretch = fast * 0.5 + (input.hitched ? 0.12 : 0);
    j.neck.rotation.x = -0.28 * stretch * (1 - r) + 0.14 * this.bolt;
    j.neck.rotation.y = clamp(turn * 0.07, -0.25, 0.25);
    j.head.rotation.x = -0.8 + headNod + 0.18 * stretch - 0.28 * this.bolt;
    j.head.rotation.y = clamp(turn * 0.05, -0.2, 0.2);

    // ---- tail ----------------------------------------------------------------------------------------------------------------------------------------------
    const tw = this.time * (2 + speed * 0.5);
    j.tail.rotation.x = -(0.15 * Math.min(1, speed / 6.4) + 1.0 * fast + 0.9 * this.bolt) + 0.04 * Math.sin(tw);
    j.tail.rotation.z = 0.1 * Math.sin(this.time * 1.3 + this.seed) * (1 - fast) + 0.07 * Math.sin(tw * 1.3);

    // ---- ears: forward at rest, pinned back at a gallop, a bolt and a rear; a flick now and then --------------------------------------------------------------------------
    const pin = clamp(fast * 0.9 + this.bolt + this.rearW * 0.6, 0, 1);
    let flickL = 0;
    let flickR = 0;
    // ---- idle life -------------------------------------------------------------------------------------------------------------------------------------------
    if (this.ambient && this.move < 0.2) {
      const slot = Math.floor(this.time / 3.2);
      if (slot !== this.idleSlot) {
        this.idleSlot = slot;
        const rnd = h01(slot * 31 + this.seed);
        this.idleAct = rnd < 0.3 ? 1 : rnd < 0.6 ? 2 : rnd < 0.75 ? 3 : 0; // 1 flick the ears, 2 swish, 3 paw
      }
      const t = (this.time / 3.2) % 1;
      this.idleAmt = damp(this.idleAmt, 1, 5, dt);
      const env = Math.sin(Math.PI * clamp(t * 1.4, 0, 1));
      if (this.idleAct === 1) {
        flickL = 0.4 * Math.sin(t * Math.PI * 7) * env;
        flickR = -0.3 * Math.sin(t * Math.PI * 6 + 1) * env;
      } else if (this.idleAct === 2) j.tail.rotation.z += 0.45 * Math.sin(t * Math.PI * 5) * env;
      else if (this.idleAct === 3) {
        j.foreL.top.rotation.x += 0.55 * Math.max(0, Math.sin(t * Math.PI * 6)) * env;
        j.foreL.knee.rotation.x -= 0.9 * Math.max(0, Math.sin(t * Math.PI * 6)) * env;
        j.head.rotation.x += 0.08 * Math.sin(t * Math.PI * 6) * env;
      }
      j.head.rotation.x += 0.025 * Math.sin(this.time * 0.9 + this.seed); // breathing
      j.neck.rotation.x += 0.015 * Math.sin(this.time * 0.9 + this.seed + 0.6);
    }
    const listen = input.ridden ? 0.18 * Math.sin(this.time * 0.8 + this.seed) : 0;
    j.earL.rotation.x = pin * 0.75 + flickL + listen * 0.5;
    j.earR.rotation.x = pin * 0.75 + flickR - listen * 0.5;
    j.earL.rotation.z = -pin * 0.25 + flickL * 0.4;
    j.earR.rotation.z = pin * 0.25 - flickR * 0.4;

    this.rig.syncReins(input.ridden === true);
  }
}
