import { WEAPON } from "@cb/shared";
import { WEAPON_ANCHORS, placeLocal, solveArm, type ArmAngles } from "@cb/procedural/three";

/**
 * The first-person VIEWMODEL, as maths: where the weapon and the two hands are in CAMERA space (x right, y up, -z ahead, metres), for every
 * weapon and every state (hip, aimed, sprinting, reloading, firing, swinging, drawing, carrying...). No three.js, no DOM, no allocation per
 * frame; `ViewModel.ts` draws it and `viewmodel.test.ts` pins it down.
 *
 * Why camera space and not the body's torso frame (the animator's hold): the body is a third-person figure whose shoulders sit behind and
 * beside the lens, so anything it holds lands low and to the side of a first-person frame. The viewmodel is the same arms and the same
 * weapon models on their own camera at a fixed distance, so the sights can be put exactly on the crosshair.
 *
 * Weapon model space (`WEAPON_ANCHORS`, `WeaponModels.ts`): the origin is the RIGHT hand's grip, -Z down the barrel or blade, +Y up.
 * Euler order is three's XYZ, the same as `placeLocal`. Poses are `[x, y, z, rx, ry, rz]`.
 */

type Pose = readonly [number, number, number, number, number, number];

/** Vertical field of view of the viewmodel camera (the world's own first-person FOV is wider and zooms a little when aiming; this one never does). */
export const VM = {
  fov: 62,
  near: 0.03,
  far: 12,
  /** Seconds to lower and raise a weapon when the choice changes. */
  lowerSeconds: 0.14,
  raiseSeconds: 0.24,
  /** D-101: seconds of empty hands with nothing to do before they lower out of view (a phone's picture was a third hands). */
  restAfterSeconds: 1.2,
} as const;

/** The body measurements the arms depend on (from the rig's proportions; `vmBodyFrom`). */
export interface VmBody {
  /** Shoulder half width. */
  hw: number;
  /** How far the shoulder joint is below the eye, and behind it (metres). */
  drop: number;
  back: number;
  upper: number;
  lower: number;
  /**
   * The forearm and hand are drawn at this scale (1 = as built). A caricature's fist can be 38 cm across; at the distance of a gun that would fill the
   * frame, so a big-handed character's viewmodel hand is brought down to a size that still reads as theirs but leaves the sights visible.
   */
  fs: number;
  /**
   * The upper arm is drawn at this scale (1 = as built, at most `MAX_ARM_SCALE`): a caricature with short arms could not otherwise hold a rifle at the
   * sights, and a longer sleeve at the edge of the frame is easier to believe than a hand that stops short of the fore-end.
   */
  us: number;
}

/** The minimum of a rig's proportions this needs (structurally a `Proportions`). */
export interface VmProportions {
  shoulderHalfWidth: number;
  torsoHeight: number;
  neck: number;
  headRadius: number;
  armUpper: number;
  armLower: number;
  handRadius?: number;
}

/** The hand radius (metres) the viewmodel aims for; bigger hands are scaled down toward it (never below `MIN_HAND_SCALE`), smaller ones are left alone. */
export const VM_HAND = 0.095;
export const MIN_HAND_SCALE = 0.62;
/** The whole arm's reach the viewmodel aims for, and the most the upper arm is stretched to get there. */
export const VM_REACH = 0.74;
export const MAX_ARM_SCALE = 1.25;

/** `eyeUp` is the eyes' height above the head centre (rig.face.eyeL.position.y, ~0.03). */
export function vmBodyFrom(P: VmProportions, eyeUp = 0.03): VmBody {
  const fs = P.handRadius ? clamp(VM_HAND / P.handRadius, MIN_HAND_SCALE, 1) : 1;
  return {
    // (the torso is not drawn, so the shoulders sit where the hands can use them: a caricature's 0.5 m head would put the eyes 65 cm above its shoulders,
    //  and an 80 cm span between them is not a build any hand pose should depend on)
    hw: clamp(P.shoulderHalfWidth, 0.2, 0.3),
    // the shoulder joint sits at 88% of the torso; the eye is a neck, a head radius and a little more above the top of it
    drop: clamp(P.torsoHeight * 0.12 + P.neck + P.headRadius + eyeUp, 0.3, 0.42),
    back: 0.07,
    upper: P.armUpper,
    lower: P.armLower,
    fs,
    us: clamp((VM_REACH - P.armLower * fs) / P.armUpper, 1, MAX_ARM_SCALE),
  };
}

// ---- poses --------------------------------------------------------------------------------------------------------------------------------

type Kind = "long" | "pistol" | "blade" | "stick" | "none";
export const kindOf = (id: number): Kind =>
  id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS ? "long" : id === WEAPON.PISTOL ? "pistol" : id === WEAPON.SABRE ? "blade" : id === WEAPON.UMBRELLA ? "stick" : "none";

interface KindPoses {
  hip: Pose;
  ads: Pose;
  sprint: Pose;
  reload: Pose;
}

const P_RIFLE: KindPoses = {
  hip: [0.2, -0.12, -0.5, 0.05, 0.16, 0],
  // the sight line (rear notch and front blade, both at y = +0.058 in model space) runs through the eye
  ads: [0, -0.058, -0.4, 0, 0, 0],
  sprint: [0.24, -0.2, -0.42, -0.35, 0.55, 0.15],
  reload: [0.04, -0.2, -0.4, 0.78, 0.3, 0],
};
const P_BLUNDER: KindPoses = {
  hip: [0.2, -0.12, -0.46, 0.05, 0.16, 0],
  // no sights: the top of the barrels, just under the eye line
  ads: [0, -0.05, -0.3, 0, 0, 0],
  sprint: [0.24, -0.2, -0.4, -0.35, 0.55, 0.15],
  reload: [0.04, -0.2, -0.38, 0.85, 0.3, 0],
};
const P_PISTOL: KindPoses = {
  hip: [0.2, -0.13, -0.5, 0.12, 0.08, 0],
  ads: [0, -0.052, -0.46, 0, 0, 0],
  sprint: [0.22, -0.2, -0.38, -0.3, 0.35, 0.1],
  reload: [0.06, -0.24, -0.42, 1.0, 0.2, 0],
};
const P_BLADE: KindPoses = {
  hip: [0.22, -0.17, -0.5, 0.75, 0.25, 0],
  ads: [0.1, -0.12, -0.55, 0.35, 0.18, 0],
  sprint: [0.24, -0.25, -0.4, -0.4, 0.3, 0.2],
  reload: [0.22, -0.17, -0.5, 0.75, 0.25, 0],
};
const P_STICK: KindPoses = {
  hip: [0.21, -0.2, -0.46, 1.0, 0.1, 0],
  ads: [0.1, -0.14, -0.5, 0.55, 0.1, 0],
  sprint: [0.24, -0.26, -0.4, -0.2, 0.2, 0.2],
  reload: [0.21, -0.2, -0.46, 1.0, 0.1, 0],
};
const POSES: Record<number, KindPoses> = {
  [WEAPON.RIFLE]: P_RIFLE,
  [WEAPON.BLUNDERBUSS]: P_BLUNDER,
  [WEAPON.PISTOL]: P_PISTOL,
  [WEAPON.SABRE]: P_BLADE,
  [WEAPON.UMBRELLA]: P_STICK,
};

/**
 * The sight line of an aimed weapon in MODEL space: a point at the rear (nearest the eye) and one at the front. When aimed, both must lie on the
 * camera's forward axis. Kept beside the poses so the test can prove it and a change to a model's sights breaks loudly.
 */
export const SIGHTS: Record<number, { rear: readonly [number, number, number]; front: readonly [number, number, number] }> = {
  [WEAPON.RIFLE]: { rear: [0, 0.058, -0.14], front: [0, 0.058, -0.985] },
  [WEAPON.BLUNDERBUSS]: { rear: [0, 0.042, -0.05], front: [0, 0.05, -0.62] },
  [WEAPON.PISTOL]: { rear: [0, 0.05, -0.05], front: [0, 0.049, -0.355] },
};

/** Where the free hand rests when a piece needs only one (camera space). */
const REST_L: readonly [number, number, number] = [-0.19, -0.19, -0.44];
const REST_R: readonly [number, number, number] = [0.19, -0.19, -0.44];
/** The powder horn on the left hip, for reloads, relative to the left shoulder (it is below the frame: the hand leaves the picture to fetch it). */
const HORN_FROM_SHOULDER: readonly [number, number, number] = [0.04, -0.44, -0.12];

/** Melee blows (camera space): each variant is a wind-up pose and a strike pose. */
const BLOWS: readonly { wind: Pose; strike: Pose }[] = [
  // 0: slash from the right shoulder across to the left
  { wind: [0.36, -0.06, -0.3, 1.0, -0.5, -0.6], strike: [-0.26, -0.2, -0.52, 0.2, 0.9, 0.5] },
  // 1: backhand from the left back across to the right
  { wind: [-0.2, -0.14, -0.34, 0.5, 0.9, 0.5], strike: [0.34, -0.2, -0.5, 0.2, -0.7, -0.5] },
  // 2: overhead chop
  { wind: [0.16, 0.16, -0.22, 2.2, 0.05, 0], strike: [0.06, -0.24, -0.56, -0.35, 0.05, 0] },
];
/** The butt-stroke of a firearm / a thrust of a cane: wind back, drive forward. */
/** D-108: with a firearm in hand, V is the boot: the piece comes up and out of the way, muzzle high, while the leg does the work (the body's own leg kicks below). */
const BRACE: { wind: Pose; strike: Pose } = { wind: [0.26, -0.04, -0.2, 0.75, 0.45, 0.15], strike: [0.3, 0.04, -0.16, 0.95, 0.55, 0.22] };

// ---- state --------------------------------------------------------------------------------------------------------------------------------

/** How the hands are otherwise occupied. */
export const MODE = { FREE: 0, CARRY: 1, KNEEL: 2, DRAG: 3, CREW: 4 } as const;
export type Mode = (typeof MODE)[keyof typeof MODE];

/** What the game tells the viewmodel each frame. Cosmetic; nothing here feeds the simulation. */
export interface VmFrame {
  /** The weapon wanted in hand (`WEAPON` id) or -1 for bare hands. */
  weapon: number;
  aiming: boolean;
  sprinting: boolean;
  /** Horizontal speed, m/s, and whether the feet are down (the bob is locked to distance walked). */
  speed: number;
  grounded: boolean;
  /** 0..1 reload progress, 0 when not reloading. */
  reload: number;
  mode: Mode;
  /** The camera's yaw and pitch (radians, + pitch = down): the weapon lags behind their change. */
  yaw: number;
  pitch: number;
  /** The viewmodel is shown at all (first person, on your feet). Off = it lowers out of view. */
  shown: boolean;
}

export interface VmState {
  /** The weapon drawn (lags the wish by the lower/raise), and 0..1 how far it is raised. */
  id: number;
  draw: number;
  presence: number;
  aim: number;
  sprint: number;
  reload: number;
  reloadT: number;
  mode: Mode;
  modeBlend: number;
  kick: number;
  kickSide: number;
  kickRoll: number;
  kickSeconds: number;
  swingT: number;
  swingSeconds: number;
  swingKind: number;
  swingCount: number;
  bash: boolean;
  bobPhase: number;
  bobAmp: number;
  swayX: number;
  swayY: number;
  lastYaw: number;
  lastPitch: number;
  primed: boolean;
  time: number;
  /** D-101: 0..1, how far idle empty hands have lowered out of view, and how long they have been idle. */
  rest: number;
  restT: number;
  /** 0..1: how much sway and recoil the player wants, and how much walking bob (settings: reduced motion, head bob). */
  motion: number;
  bob: number;
}

export const newVmState = (): VmState => ({
  id: -1, draw: 1, presence: 0, aim: 0, sprint: 0, reload: 0, reloadT: 0, mode: MODE.FREE, modeBlend: 0,
  kick: 0, kickSide: 0, kickRoll: 0, kickSeconds: 0.3, swingT: -1, swingSeconds: 0.5, swingKind: 0, swingCount: 0, bash: false,
  bobPhase: 0, bobAmp: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, primed: false, time: 0, motion: 1, bob: 1, rest: 0, restT: 0,
});

/** Seconds a shot's recoil takes to settle, by weapon. */
const KICK_SECONDS: Record<number, number> = { [WEAPON.PISTOL]: 0.24, [WEAPON.RIFLE]: 0.36, [WEAPON.BLUNDERBUSS]: 0.42 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A shot left the barrel: the picture of its recoil begins now. `n` is the shot counter (a different side-kick every time, the same on every machine). */
export function vmFire(s: VmState, weapon: number, n: number): void {
  s.kick = 1;
  s.kickSeconds = KICK_SECONDS[weapon] ?? 0.3;
  const h = Math.sin(n * 12.9898 + weapon * 78.233) * 43758.5453;
  const r = h - Math.floor(h);
  s.kickSide = (r - 0.5) * 2;
  s.kickRoll = (((r * 7.3) % 1) - 0.5) * 2;
}

/** A blow begins. `windup` is the weapon's own wind-up time (the strike lands at 36% of the animation). */
export function vmSwing(s: VmState, windup: number, bash: boolean): void {
  s.swingSeconds = Math.max(0.3, windup / 0.36);
  s.swingT = 0;
  s.bash = bash;
  s.swingKind = bash ? 3 : s.id < 0 ? s.swingCount++ : s.swingCount++ % 3; // (bare fists alternate hands)
}

/** Advances every timer and blend by one frame. Allocation-free. */
export function stepViewmodel(s: VmState, f: VmFrame, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  dt = Math.min(dt, 0.1);
  s.time += dt;

  // drawing and putting away: lower the piece, swap it, raise the new one
  const want = f.shown ? f.weapon : s.id;
  if (want !== s.id) {
    s.draw -= dt / VM.lowerSeconds;
    if (s.draw <= 0) {
      s.draw = 0;
      s.id = want;
      s.swingT = -1;
    }
  } else s.draw = Math.min(1, s.draw + dt / VM.raiseSeconds);
  s.presence = damp(s.presence, f.shown ? 1 : 0, f.shown ? 9 : 14, dt);

  const armed = s.id >= 0;
  const canAim = f.aiming && armed && !f.sprinting && f.reload <= 0 && s.swingT < 0 && f.mode === MODE.FREE;
  s.aim = damp(s.aim, canAim ? 1 : 0, canAim ? 14 : 11, dt);
  s.sprint = damp(s.sprint, f.sprinting && f.speed > 1 && s.swingT < 0 && f.mode === MODE.FREE ? 1 : 0, 9, dt);
  s.reload = damp(s.reload, f.reload > 0 && armed ? 1 : 0, 8, dt);
  s.reloadT = f.reload;
  s.mode = f.mode !== MODE.FREE ? f.mode : s.mode;
  s.modeBlend = damp(s.modeBlend, f.mode !== MODE.FREE ? 1 : 0, 9, dt);
  // D-101: empty hands with nothing to do lower out of view after a moment (a punch, a load in the arms, a kneel or a drag brings them straight back up)
  const idleHands = s.id < 0 && f.weapon < 0 && f.mode === MODE.FREE && s.swingT < 0 && s.modeBlend < 0.05;
  s.restT = idleHands ? s.restT + dt : 0;
  s.rest = damp(s.rest, s.restT > VM.restAfterSeconds ? 1 : 0, s.restT > 0 ? 4 : 18, dt);

  s.kick = Math.max(0, s.kick - dt / s.kickSeconds);
  if (s.swingT >= 0) {
    s.swingT += dt;
    if (s.swingT >= s.swingSeconds) s.swingT = -1;
  }

  // walking: the bob is locked to distance, so it never runs while standing still or in the air
  const moving = f.grounded ? clamp(f.speed / 4.4, 0, 1.4) : 0;
  s.bobAmp = damp(s.bobAmp, moving, 8, dt);
  if (f.grounded) s.bobPhase = (s.bobPhase + (f.speed * dt * Math.PI * 2) / 1.6) % (Math.PI * 2 * 1000);

  // look sway: the weapon trails a turn of the head, then settles
  if (!s.primed) {
    s.lastYaw = f.yaw;
    s.lastPitch = f.pitch;
    s.primed = true;
  }
  let dy = f.yaw - s.lastYaw;
  dy = dy - Math.PI * 2 * Math.round(dy / (Math.PI * 2));
  const dp = f.pitch - s.lastPitch;
  s.lastYaw = f.yaw;
  s.lastPitch = f.pitch;
  const k = Math.exp(-dt * 9);
  s.swayX = clamp(s.swayX * k + dy * 0.3, -0.07, 0.07);
  s.swayY = clamp(s.swayY * k + dp * 0.3, -0.06, 0.06);
}

// ---- the pose -------------------------------------------------------------------------------------------------------------------------------

export interface VmHand {
  x: number;
  y: number;
  z: number;
  /** 0 open .. 1 fist. */
  grip: number;
  /** The direction of the handle this fist wraps round, in camera space (unit), or all zero when it holds nothing with an axis. */
  ax: number;
  ay: number;
  az: number;
}

export interface VmOut {
  /** Anything to draw at all. */
  visible: boolean;
  /** The weapon (model id or -1) and its transform in camera space. */
  weapon: number;
  weaponVisible: boolean;
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  right: VmHand;
  left: VmHand;
  /** The ramrod drawn out of the muzzle (metres), for the model. */
  rod: number;
}

const newHand = (): VmHand => ({ x: 0, y: 0, z: 0, grip: 0, ax: 0, ay: 0, az: 0 });
export const newVmOut = (): VmOut => ({ visible: false, weapon: -1, weaponVisible: false, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, right: newHand(), left: newHand(), rod: 0 });

interface P6 {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}
const cur: P6 = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const tgt: P6 = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const V = { x: 0, y: 0, z: 0 };
const V2 = { x: 0, y: 0, z: 0 };

const set = (o: P6, p: Pose): void => {
  o.x = p[0];
  o.y = p[1];
  o.z = p[2];
  o.rx = p[3];
  o.ry = p[4];
  o.rz = p[5];
};
const mix = (o: P6, p: Pose | P6, t: number): void => {
  const q = p as unknown as Record<string | number, number>;
  const isArr = Array.isArray(p);
  o.x = lerp(o.x, isArr ? q[0]! : q.x!, t);
  o.y = lerp(o.y, isArr ? q[1]! : q.y!, t);
  o.z = lerp(o.z, isArr ? q[2]! : q.z!, t);
  o.rx = lerp(o.rx, isArr ? q[3]! : q.rx!, t);
  o.ry = lerp(o.ry, isArr ? q[4]! : q.ry!, t);
  o.rz = lerp(o.rz, isArr ? q[5]! : q.rz!, t);
};

/** How far the ramrod is drawn out at reload progress u (out during the ram, in before and after). */
const rodOut = (u: number): number => smooth(0.5, 0.58, u) * (1 - smooth(0.88, 0.94, u));

interface Way {
  u: number;
  horn: boolean;
  x: number;
  y: number;
  z: number;
}
const waysCache = new Map<number, Way[]>();

/** The free hand's route through a reload: to the horn, over the muzzle to pour, back for the ball, strokes of the ramrod, the pan, home. */
function reloadWays(id: number): Way[] {
  const hit = waysCache.get(id);
  if (hit) return hit;
  const a = WEAPON_ANCHORS[id]!;
  const long = id === WEAPON.RIFLE || id === WEAPON.BLUNDERBUSS;
  const mz = a.muzzle;
  const top: [number, number, number] = [mz[0], mz[1] + 0.07, mz[2] + 0.03];
  const low: [number, number, number] = [mz[0], mz[1] + 0.07, mz[2] + (long ? 0.36 : 0.17)];
  const w = (u: number, p: readonly number[], horn = false): Way => ({ u, horn, x: p[0]!, y: p[1]!, z: p[2]! });
  const list: Way[] = [w(0, foreOf(id)), w(0.12, [0, 0, 0], true), w(0.28, top), w(0.36, [top[0], top[1] + 0.035, top[2]]), w(0.46, [0, 0, 0], true), w(0.53, top)];
  for (let i = 0; i < 6; i++) list.push(w(0.53 + ((i + 1) * 0.32) / 6, i % 2 === 0 ? low : top));
  list.push(w(0.92, [a.lock[0], a.lock[1] + 0.06, a.lock[2] - 0.03]), w(1, foreOf(id)));
  waysCache.set(id, list);
  return list;
}

/** Where the right fist's centre goes in weapon space, and the left fist's offset from the fore-end anchor (the fore-end is held from below). */
export const HAND_AT: Record<number, readonly [number, number, number]> = {
  [WEAPON.RIFLE]: [0, -0.06, 0.07],
  [WEAPON.BLUNDERBUSS]: [0, -0.06, 0.07],
  [WEAPON.PISTOL]: [0, -0.072, 0.045],
  [WEAPON.SABRE]: [0, 0, 0.03],
  [WEAPON.UMBRELLA]: [0, 0, 0.03],
};
const LEFT_UNDER = 0.075;
const foreOf = (id: number): readonly [number, number, number] => {
  const l = WEAPON_ANCHORS[id]!.left;
  return [l[0], l[1] - LEFT_UNDER, l[2]];
};

/** The handle axes (weapon space) the fists wrap round, used when the rig's own anchors do not say (older builds of the procedural package). */
const GRIP_R: Record<number, readonly [number, number, number]> = {
  [WEAPON.RIFLE]: [0, 0.94, -0.34],
  [WEAPON.BLUNDERBUSS]: [0, 0.94, -0.34],
  [WEAPON.PISTOL]: [0, 0.95, -0.31],
  [WEAPON.SABRE]: [0, 0, -1],
  [WEAPON.UMBRELLA]: [0, 0, -1],
};

/** Computes the free hand's place during a reload into `o` (camera space). */
function reloadHand(u: number, id: number, o: { x: number; y: number; z: number }, p: P6, body: VmBody): void {
  const ways = reloadWays(id);
  let i = 0;
  while (i < ways.length - 2 && u > ways[i + 1]!.u) i++;
  const w0 = ways[i]!;
  const w1 = ways[i + 1]!;
  const t = smooth(w0.u, w1.u, u);
  const at = (w: Way, dst: { x: number; y: number; z: number }): void => {
    if (w.horn) {
      dst.x = -body.hw + HORN_FROM_SHOULDER[0];
      dst.y = -body.drop + HORN_FROM_SHOULDER[1];
      dst.z = body.back + HORN_FROM_SHOULDER[2];
    } else placeLocal(p.x, p.y, p.z, p.rx, p.ry, p.rz, w.x, w.y, w.z, dst);
  };
  at(w0, V);
  at(w1, V2);
  o.x = lerp(V.x, V2.x, t);
  o.y = lerp(V.y, V2.y, t);
  o.z = lerp(V.z, V2.z, t);
}

const tmpP = { x: 0, y: 0, z: 0 };
const tmpL = { x: 0, y: 0, z: 0 };
const tmpAx = { x: 0, y: 0, z: 0 };

/** Rotates a weapon-space direction into camera space by the weapon's rotation. */
function axisOf(p: P6, a: readonly [number, number, number] | undefined, out: VmHand): void {
  if (!a) {
    out.ax = out.ay = out.az = 0;
    return;
  }
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  placeLocal(0, 0, 0, p.rx, p.ry, p.rz, a[0] / l, a[1] / l, a[2] / l, tmpAx);
  out.ax = tmpAx.x;
  out.ay = tmpAx.y;
  out.az = tmpAx.z;
}

/**
 * The whole viewmodel for one frame. `body` gives the arm reach. `s.motion` scales the walking bob, the sway and the recoil (0 = still).
 * Writes `out`; the arms are then solved with `solveViewArm`.
 */
export function computeViewmodel(s: VmState, body: VmBody, out: VmOut): VmOut {
  const id = s.id;
  const kind = kindOf(id);
  const armed = kind !== "none";
  const poses = armed ? POSES[id]! : undefined;
  const anchors = armed ? WEAPON_ANCHORS[id] : undefined;
  const motion = s.motion;
  out.visible = s.presence > 0.01;
  out.weapon = id;
  out.weaponVisible = armed && s.draw > 0.01 && s.modeBlend < 0.5;
  out.rod = 0;
  out.right.grip = armed ? 0.92 : 0.65;
  out.left.grip = kind === "long" ? 0.86 : armed ? 0.5 : 0.65;
  out.right.ax = out.right.ay = out.right.az = 0;
  out.left.ax = out.left.ay = out.left.az = 0;

  // ---- the weapon (or the right fist) --------------------------------------------------------------------------------------------------
  if (poses) {
    set(cur, poses.hip);
    mix(cur, poses.ads, s.aim);
    mix(cur, poses.sprint, s.sprint * (1 - s.aim));
    if (kind === "long" || kind === "pistol") mix(cur, poses.reload, s.reload);
  } else set(cur, [REST_R[0], REST_R[1], REST_R[2], 0, 0, 0]);

  // ---- blows ---------------------------------------------------------------------------------------------------------------------------
  const swinging = s.swingT >= 0 && s.swingSeconds > 0;
  let jab = 0; // 0..1 how far the fist that throws is out
  if (swinging) {
    const u = s.swingT / s.swingSeconds;
    const wind = smooth(0, 0.34, u);
    const stroke = smooth(0.36, 0.6, u);
    const back = smooth(0.66, 1, u);
    const weight = wind * (1 - back);
    if (!armed) jab = stroke * (1 - back);
    else if (s.bash) {
      set(tgt, BRACE.wind);
      mix(tgt, BRACE.strike, stroke);
      mix(cur, tgt, weight);
    } else {
      const b = BLOWS[s.swingKind % BLOWS.length]!;
      set(tgt, b.wind);
      mix(tgt, b.strike, stroke);
      mix(cur, tgt, weight);
    }
  }
  const leftPunch = !armed && (s.swingKind & 1) === 1;
  if (jab > 0 && !leftPunch) {
    cur.z += JAB_DRIVE * jab;
    cur.y += 0.09 * jab;
    cur.x -= 0.11 * jab;
  }

  // ---- ambient motion ------------------------------------------------------------------------------------------------------------------
  const calm = 1 - 0.85 * s.aim;
  const m = s.bobAmp * s.bob * calm;
  const ph = s.bobPhase;
  cur.x += Math.sin(ph) * 0.012 * m + s.swayX * motion * calm;
  cur.y += -Math.abs(Math.sin(ph)) * 0.011 * m + s.swayY * motion * calm + Math.sin(s.time * 1.6) * 0.0022 * calm * motion;
  cur.rz += Math.sin(ph) * 0.02 * m - s.swayX * 0.5 * motion;
  cur.rx += Math.cos(ph * 2) * 0.012 * m - s.swayY * 0.6 * motion;
  cur.ry += -s.swayX * 0.7 * motion;

  // ---- recoil: the piece drives back into the shoulder and the muzzle climbs, a little to one side ---------------------------------------------
  if (s.kick > 0 && (kind === "long" || kind === "pistol")) {
    const k = s.kick * s.kick;
    const back = kind === "long" ? 0.075 : 0.06;
    const climb = kind === "long" ? 0.13 : 0.34;
    const braced = 1 - 0.35 * s.aim;
    cur.z += k * back * (0.5 + 0.5 * motion);
    cur.rx += k * climb * (0.4 + 0.6 * motion) * braced;
    cur.y += k * 0.012 * motion;
    cur.ry += k * s.kickSide * 0.03 * motion;
    cur.rz += k * s.kickRoll * 0.04 * motion;
  }

  // ---- drawing and putting away: rises from below, muzzle high ------------------------------------------------------------------------------
  const d = 1 - smooth(0, 1, s.draw) + (1 - smooth(0, 1, s.presence)) * 0.8 + smooth(0, 1, s.rest) * 0.8;
  cur.y -= d * 0.34;
  cur.rx -= d * 0.7;
  cur.z += d * 0.05;

  out.px = cur.x;
  out.py = cur.y;
  out.pz = cur.z;
  out.rx = cur.rx;
  out.ry = cur.ry;
  out.rz = cur.rz;

  // ---- the hands -------------------------------------------------------------------------------------------------------------------------
  const rh = out.right;
  const lh = out.left;
  if (armed) {
    const at = HAND_AT[id]!;
    placeLocal(cur.x, cur.y, cur.z, cur.rx, cur.ry, cur.rz, at[0], at[1], at[2], tmpP);
    rh.x = tmpP.x;
    rh.y = tmpP.y;
    rh.z = tmpP.z;
    axisOf(cur, GRIP_R[id], rh);
  } else {
    rh.x = cur.x;
    rh.y = cur.y;
    rh.z = cur.z;
  }
  if (kind === "long" || (kind === "pistol" && s.reload > 0.02)) {
    foreGrip(cur, id, body, tmpL);
    if (s.reload > 0.02) {
      reloadHand(s.reloadT, id, V, cur, body);
      lh.x = lerp(tmpL.x, V.x, s.reload);
      lh.y = lerp(tmpL.y, V.y, s.reload);
      lh.z = lerp(tmpL.z, V.z, s.reload);
      if (s.reload > 0.01 && anchors) out.rod = anchors.rod * rodOut(s.reloadT);
    } else {
      lh.x = tmpL.x;
      lh.y = tmpL.y;
      lh.z = tmpL.z;
    }
    if (s.reload < 0.5) axisOf(cur, [0, 0, -1], lh);
  } else if (kind === "pistol") {
    // the duellist's stance: the free hand tucked back and low, out of the frame
    lh.x = lerp(REST_L[0], -body.hw + 0.05, s.aim);
    lh.y = lerp(REST_L[1], -body.drop - 0.38, s.aim);
    lh.z = lerp(REST_L[2], body.back - 0.2, s.aim);
  } else if (kind === "blade" || kind === "stick") {
    lh.x = lerp(REST_L[0], -0.22, s.aim);
    lh.y = lerp(REST_L[1], -0.3, s.aim);
    lh.z = lerp(REST_L[2], -0.36, s.aim);
  } else {
    // bare fists: walking swings them a little, sprinting pumps them, a jab throws one
    lh.x = REST_L[0];
    lh.y = REST_L[1];
    lh.z = REST_L[2];
    const pump = Math.sin(s.bobPhase) * (0.02 + 0.05 * s.sprint) * s.bobAmp * s.bob;
    lh.z -= pump;
    rh.z += pump;
    lh.y += Math.sin(s.time * 1.6 + 1) * 0.002;
    if (leftPunch) {
      lh.z += JAB_DRIVE * jab;
      lh.y += 0.09 * jab;
      lh.x += 0.11 * jab;
    }
    lh.y -= d * 0.3;
  }
  if (armed && kind !== "long" && !(kind === "pistol" && s.reload > 0.02)) lh.y -= d * 0.3;

  // ---- hands busy: carrying, kneeling, dragging, working a gun -----------------------------------------------------------------------------------
  if (s.modeBlend > 0.003) busyHands(s, out);
  return out;
}

/** How far a jab drives the fist along the line of sight (metres). */
const JAB_DRIVE = -0.36;

/**
 * The left hand's place on a two-handed piece: the fore-end (held from below), or as far along toward the grip as this arm can reach (the shoulder may be
 * brought forward a little: `SHOULDER_SLACK`).
 */
function foreGrip(p: P6, id: number, body: VmBody, o: { x: number; y: number; z: number }): void {
  const f = foreOf(id);
  const reach = (body.upper * body.us + body.lower * body.fs) * 0.955 + SHOULDER_SLACK;
  const sx = -body.hw;
  const sy = -body.drop;
  const sz = body.back;
  for (let s = 1; s >= 0.15; s -= 0.1) {
    placeLocal(p.x, p.y, p.z, p.rx, p.ry, p.rz, f[0] * s, f[1] * s, f[2] * s, o);
    if (Math.hypot(o.x - sx, o.y - sy, o.z - sz) <= reach) return;
  }
}

/** How far the viewmodel may bring a shoulder toward a target that is out of reach (metres). The torso is not drawn, so a shoulder can go where the hand needs it. */
export const SHOULDER_SLACK = 0.12;
/** A brought-forward shoulder never passes this far behind the lens: its cap would be seen. */
export const SHOULDER_MIN_Z = 0.05;

function busyHands(s: VmState, out: VmOut): void {
  const k = s.modeBlend;
  const t = s.time;
  let rx = 0.16;
  let ry = -0.3;
  let rz = -0.5;
  let lx = -0.16;
  let ly = -0.3;
  let lz = -0.5;
  if (s.mode === MODE.CARRY) {
    // both hands out in front, under a load
    rx = 0.17; ry = -0.2; rz = -0.5; lx = -0.17; ly = -0.2; lz = -0.5;
  } else if (s.mode === MODE.KNEEL) {
    // reaching down and forward to the patient, pressing
    const press = Math.sin(t * 4) * 0.02;
    rx = 0.12; ry = -0.3 + press; rz = -0.5; lx = -0.12; ly = -0.3 - press; lz = -0.5;
  } else if (s.mode === MODE.DRAG) {
    rx = 0.14; ry = -0.25; rz = -0.54; lx = -0.14; ly = -0.25; lz = -0.54;
  } else if (s.mode === MODE.CREW) {
    // ramming and sponging: the hands pump along the line of sight
    const ram = Math.sin(t * 5.2);
    rx = 0.16; ry = -0.15; rz = -0.5 - 0.1 * ram; lx = -0.16; ly = -0.15; lz = -0.5 + 0.1 * ram;
  }
  const r = out.right;
  const l = out.left;
  r.x = lerp(r.x, rx, k);
  r.y = lerp(r.y, ry, k);
  r.z = lerp(r.z, rz, k);
  l.x = lerp(l.x, lx, k);
  l.y = lerp(l.y, ly, k);
  l.z = lerp(l.z, lz, k);
  r.grip = lerp(r.grip, 0.8, k);
  l.grip = lerp(l.grip, 0.8, k);
  if (k > 0.5) r.ax = r.ay = r.az = l.ax = l.ay = l.az = 0;
}

// ---- arms ---------------------------------------------------------------------------------------------------------------------------------

export interface ViewArm extends ArmAngles {
  /** The shoulder joint's place in camera space (brought toward the hand if it was out of reach). */
  sx: number;
  sy: number;
  sz: number;
  /** How far the target was beyond the arm's reach from the natural shoulder, metres (0 when it was in reach). */
  stretch: number;
  /** Left over after the solve: how far the hand is from where it was asked to be (metres). */
  error: number;
}

export const newViewArm = (): ViewArm => ({ a: 0, b: 0, e: 0, sx: 0, sy: 0, sz: 0, stretch: 0, error: 0 });

/**
 * Solves one arm to a hand target in camera space. The natural shoulder is `(+-hw, -drop, back)`; if the target is beyond reach the SHOULDER is
 * moved toward it (by at most `SHOULDER_SLACK`), because the torso is not drawn and a caricature with short arms must still be able to hold a rifle
 * at the sights. The angles are what `shoulder.rotation.set(a, 0, b)` and `elbow.rotation.x = e` take. `side` is +1 for the right arm, -1 for the left.
 */
export function solveViewArm(body: VmBody, side: 1 | -1, tx: number, ty: number, tz: number, out: ViewArm): ViewArm {
  const lower = body.lower * body.fs;
  const upper = body.upper * body.us;
  const reach = (upper + lower) * 0.955;
  let sx = side * body.hw;
  let sy = -body.drop;
  let sz = body.back;
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const d = Math.hypot(dx, dy, dz);
  out.stretch = Math.max(0, d - reach);
  if (d > reach) {
    const k = Math.min(SHOULDER_SLACK, d - reach) / d;
    sx += dx * k;
    sy += dy * k;
    sz = Math.max(SHOULDER_MIN_Z, sz + dz * k);
  }
  out.sx = sx;
  out.sy = sy;
  out.sz = sz;
  out.error = solveArm(upper, lower, side, tx - sx, ty - sy, tz - sz, out);
  return out;
}

/**
 * Maps a point in the viewmodel camera's space to where the WORLD camera (a different field of view) would draw it at the same place on the screen. The
 * muzzle flash and smoke live in the world scene, so they must be put where the viewmodel's muzzle appears, not where it is. Writes `out`.
 */
export function matchScreenPoint(px: number, py: number, pz: number, vmFovDeg: number, worldFovDeg: number, out: { x: number; y: number; z: number }): void {
  const k = Math.tan((worldFovDeg * Math.PI) / 360) / Math.tan((vmFovDeg * Math.PI) / 360);
  out.x = px * k;
  out.y = py * k;
  out.z = pz;
}

/** The viewmodel camera's field of view for the user's FOV setting: it follows a little, so extreme settings do not stretch the hands. */
export const viewmodelFov = (userFov: number): number => clamp(VM.fov + (userFov - 65) * 0.35, 50, 76);
