import { BUTTON, FLAG, MOVEMENT } from "./constants.ts";
import type { CollisionWorld, Vec2 } from "./collision.ts";
import { yawFromWire, type CharState, type MoveCommand } from "./movement.ts";
import { angleDelta, approach, clamp, lerp, wrapAngle } from "./math.ts";
import { hash3 } from "./rng.ts";
import { LIMB } from "./limbs.ts";
import { ZONE, woundLevel } from "./wounds.ts";
import type { RegionId } from "./campaignTypes.ts";
import { SALTMARKET_MOUNT_SPOTS } from "./saltmarket.ts";
import { VESPER_MOUNT_SPOTS } from "./vesper.ts";

/**
 * Mounts: a SECOND pure shared step (D-034). A horse is not a second predicted entity: it is a picture of the RIDER's predicted state, and
 * while `MOUNTED` is set the movement step hands over to `stepMounted`, which has the same shape as `stepCharacter` (state, command, dt, world),
 * the same collision and ground rules, and no allocation. The server flips MOUNTED/HITCHED like it flips CARRYING; the client predicts them
 * from the replicated flags. Nothing here reads Math.random or the clock.
 */

/**
 * The flag bits this step reads and writes. Phase 0 puts the same three numbers into `FLAG` in constants.ts (`FLAG.MOUNTED` ...); the values are
 * frozen in the contract, and `mount.test.ts` asserts they cannot collide with the existing bits.
 */
export const MOUNT_FLAG = { MOUNTED: 4096, HITCHED: 8192, GALLOPING: 16384 } as const;

export const MOUNT = {
  walk: 3.0,
  trot: 6.4,
  gallop: 10.5,
  /** Speed above which GALLOPING is raised (between the trot and the gallop: a canter is still a "run"). */
  gallopFlagAt: 8.5,
  accel: 9,
  decel: 14,
  brake: 22,
  /** Turn rate (rad/s) at a standstill and at a full gallop; linear in between (a galloping horse swings wide). */
  turnSlow: 3.2,
  turnFast: 1.1,
  radius: 0.62,
  height: 2.5,
  /** Steepest slope (rise/run) a horse will climb; a walker's is 1.2. */
  maxSlope: 0.8,
  /** Fraction of speed lost climbing a slope at maxSlope (scaled by the slope below it). */
  climbPenalty: 0.45,
  jumpSpeed: 7.4,
  /** Below this speed a horse will not jump (it has no run-up). */
  jumpMinSpeed: 1.5,
  /** A hitched wagon slows the horse and its turning. */
  hitchMul: 0.78,
  hitchTurnMul: 0.75,
  /** Height of the rider's seat above the ground (combat lifts the hit zones by this). */
  seatHeight: 0.95,
  /** How close (m) a person must be to the horse to mount it, or to the wagon's tongue to hitch. */
  reach: 2.4,
  /**
   * The horse steps up only a small kerb: its shoulders and hocks clear less than a man's stride. The shared obstacle code steps up to CHARACTER.stepHeight (0.5 m); the
   * mounted step queries it with the feet this far lower, which leaves 0.2 m. That is also what lets a 1.1 m wall be jumped and a 1.6 m one not.
   */
  stepDrop: 0.3,
  /** A two-arm loss halves the steering (the reins are gone). */
  noArmsSteer: 0.5,
  /** Impact thresholds and the thrown rider's consequences. */
  throwFrom: 3.5,
  throwSpan: 6,
  thrown: { velScale: 0.6, vy: 3.2, stumble: 1.2, bolt: 4 },
} as const;

/**
 * How far the integrator should lift a mounted rider's hit zones (Combat's `bodyLift`): the zones are laid out for a standing body whose hips are `hipHeight` metres up (~0.9 for a
 * default character); a rider's pelvis is at `MOUNT.seatHeight`, so the whole stack moves up by the difference. Never negative.
 */
export const riderBodyLift = (hipHeight: number): number => Math.max(0, MOUNT.seatHeight - (Number.isFinite(hipHeight) ? hipHeight : 0.9));

/** Gaits, in the order the animator knows them. */
export const GAIT = { idle: 0, walk: 1, trot: 2, canter: 3, gallop: 4 } as const;
export type Gait = (typeof GAIT)[keyof typeof GAIT];

/** Gait of a horse moving at `speed` m/s. */
export function gaitOf(speed: number): Gait {
  if (!(speed > 0.35)) return GAIT.idle;
  if (speed < (MOUNT.walk + MOUNT.trot) / 2) return GAIT.walk;
  if (speed < (MOUNT.trot + MOUNT.gallop) / 2 - 0.4) return GAIT.trot;
  if (speed < MOUNT.gallop - 0.6) return GAIT.canter;
  return GAIT.gallop;
}

/** Whether (px, pz) is close enough to a horse at (hx, hz) to mount it. */
export const mountReach = (px: number, pz: number, hx: number, hz: number, reach: number = MOUNT.reach): boolean => (px - hx) * (px - hx) + (pz - hz) * (pz - hz) <= reach * reach;

const scratch: Vec2 = { x: 0, z: 0 };

/** Terrain-slope check for a grounded move with the horse's own limit. Obstacle step-ups are handled by groundHeight. */
function climbable(world: CollisionWorld, x0: number, z0: number, nx: number, nz: number): boolean {
  const dx = nx - x0;
  const dz = nz - z0;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-6) return true;
  const rise = world.terrainHeight(nx, nz) - world.terrainHeight(x0, z0);
  return rise <= 0 || rise / dist <= MOUNT.maxSlope;
}

/**
 * One fixed step of a ridden horse. The stick sets a DESIRED heading (camera-relative, as walking); the body turns toward it at a rate that falls
 * with speed; velocity is ALWAYS along the facing (no strafing); speed eases to the gait the stick and SPRINT ask for, scaled by how far the body
 * still has to turn (an about-turn brakes first). Walls shed speed (the displacement is reported back into velocity, as the walker does), JUMP
 * gives the jump with no air control, GALLOPING is derived. Injuries: legs are the horse's, so leg mods are ignored; a rider with no arms
 * steers at half rate; a winded or dizzy rider (head/torso grievous) cannot ask for the gallop.
 */
export function stepMounted(s: CharState, cmd: MoveCommand, dt: number, world: CollisionWorld): void {
  const buttons = cmd.buttons;
  const wasGrounded = (s.flags & FLAG.GROUNDED) !== 0;
  const hitched = (s.flags & MOUNT_FLAG.HITCHED) !== 0;
  const control = s.stumble > 0 ? MOVEMENT.stumbleControl : 1;
  s.stumble = Math.max(0, s.stumble - dt);

  // ---- the stick ------------------------------------------------------------------------------------------------------------------------------
  let f = cmd.moveF / 127;
  let r = cmd.moveR / 127;
  let mag = Math.sqrt(f * f + r * r);
  if (mag > 1) {
    f /= mag;
    r /= mag;
    mag = 1;
  }
  const camYaw = yawFromWire(cmd.yaw);
  const sinY = Math.sin(camYaw);
  const cosY = Math.cos(camYaw);
  const dirX = -sinY * f + cosY * r;
  const dirZ = -cosY * f - sinY * r;

  const armsGone = (s.missing & (LIMB.ARM_L | LIMB.ARM_R)) === (LIMB.ARM_L | LIMB.ARM_R);
  const gallopOk = woundLevel(s.wounds, ZONE.HEAD) < 3 && woundLevel(s.wounds, ZONE.TORSO) < 3;

  // ---- speed along the facing (the velocity is always along it; a fresh mount may still carry the walker's sideways velocity, which is dropped here) ----
  const fx = -Math.sin(s.facing);
  const fz = -Math.cos(s.facing);
  let speed = Math.max(0, s.vx * fx + s.vz * fz);

  const grounded = wasGrounded;
  let flags = s.flags;
  if (grounded) {
    // ---- steering --------------------------------------------------------------------------------------------------------------------------------
    let err = 0;
    if (mag > 0.05) {
      err = angleDelta(s.facing, Math.atan2(-dirX, -dirZ));
      const turn = lerp(MOUNT.turnSlow, MOUNT.turnFast, clamp(speed / MOUNT.gallop, 0, 1)) * (hitched ? MOUNT.hitchTurnMul : 1) * (armsGone ? MOUNT.noArmsSteer : 1) * control;
      s.facing = wrapAngle(s.facing + clamp(err, -turn * dt, turn * dt));
      err = angleDelta(s.facing, Math.atan2(-dirX, -dirZ));
    }
    // ---- gait ------------------------------------------------------------------------------------------------------------------------------------
    let top = 0;
    if (mag > 0.05) top = (buttons & BUTTON.SPRINT) !== 0 && mag > 0.3 && gallopOk ? MOUNT.gallop : mag > 0.6 ? MOUNT.trot : MOUNT.walk;
    if (hitched) top *= MOUNT.hitchMul;
    top *= clamp(Math.cos(err) + 0.35, 0, 1);
    // uphill: the horse slows in proportion to the slope it is about to climb
    if (top > 0 && speed > 0.1) {
      const ahead = Math.max(0.6, speed * dt * 2);
      const slope = (world.terrainHeight(s.x + fx * ahead, s.z + fz * ahead) - world.terrainHeight(s.x, s.z)) / ahead;
      if (slope > 0) top *= 1 - MOUNT.climbPenalty * clamp(slope / MOUNT.maxSlope, 0, 1);
    }
    const rate = top >= speed ? MOUNT.accel * control : mag > 0.05 ? MOUNT.brake : MOUNT.decel;
    speed = approach(speed, top, rate * dt);

    // ---- jump (a run-up is needed; no control in the air) -----------------------------------------------------------------------------------------
    const jumpHeld = (buttons & BUTTON.JUMP) !== 0;
    if (!jumpHeld) flags &= ~FLAG.JUMP_LATCH;
    if (jumpHeld && (flags & FLAG.JUMP_LATCH) === 0 && speed >= MOUNT.jumpMinSpeed && s.stumble <= 0) {
      s.vy = MOUNT.jumpSpeed;
      flags |= FLAG.JUMP_LATCH;
      flags &= ~FLAG.GROUNDED;
    }
  } else if ((buttons & BUTTON.JUMP) === 0) flags &= ~FLAG.JUMP_LATCH;

  // The facing may have turned this step: velocity follows it (airborne it keeps the take-off heading, since neither changes).
  s.vx = -Math.sin(s.facing) * speed;
  s.vz = -Math.cos(s.facing) * speed;

  // ---- horizontal integration with collision (the feet are queried a little low: the horse steps up a kerb, not a stair) -----------------------------
  const feet = s.y - MOUNT.stepDrop;
  const h = MOUNT.height + MOUNT.stepDrop;
  const x0 = s.x;
  const z0 = s.z;
  let nx = x0 + s.vx * dt;
  let nz = z0 + s.vz * dt;
  scratch.x = nx;
  scratch.z = nz;
  world.resolveXZ(scratch, feet, MOUNT.radius, h);
  nx = scratch.x;
  nz = scratch.z;
  if (grounded && (flags & FLAG.GROUNDED) !== 0 && !climbable(world, x0, z0, nx, nz)) {
    // a slope too steep for a horse: it stops (no sliding along it: the walker's trick would let a gallop skate up a cliff)
    nx = x0;
    nz = z0;
    s.vx = 0;
    s.vz = 0;
    speed = 0;
  }
  if (dt > 0) {
    // Report the actual displacement back into velocity so walls kill speed instead of banking it.
    const ax = (nx - x0) / dt;
    const az = (nz - z0) / dt;
    const along = ax * -Math.sin(s.facing) + az * -Math.cos(s.facing);
    if (along < speed) speed = Math.max(0, along);
    s.vx = -Math.sin(s.facing) * speed;
    s.vz = -Math.cos(s.facing) * speed;
  }
  s.x = nx;
  s.z = nz;

  // ---- vertical (the walker's rules; the ground is read with the lowered feet) ---------------------------------------------------------------------------
  const yBefore = s.y;
  const ground = world.groundHeight(s.x, s.z, s.y - MOUNT.stepDrop);
  const stillGrounded = (flags & FLAG.GROUNDED) !== 0;
  if (stillGrounded) {
    if (s.y - ground <= 0.35) {
      s.y = ground;
      s.vy = 0;
    } else flags &= ~FLAG.GROUNDED;
  }
  if ((flags & FLAG.GROUNDED) === 0) {
    s.vy = Math.max(s.vy - MOVEMENT.gravity * dt, -MOVEMENT.terminalVelocity);
    s.y += s.vy * dt;
    if (s.vy <= 0 && s.y <= ground) {
      s.y = ground;
      s.vy = 0;
      flags |= FLAG.GROUNDED;
    }
  }

  if (s.y < yBefore) {
    // Came down (off a ledge, a landing): at the lower height an obstacle that was below the hooves a moment ago may now be beside them. Push out again so no step
    // ever ends inside one.
    scratch.x = s.x;
    scratch.z = s.z;
    world.resolveXZ(scratch, s.y - MOUNT.stepDrop, MOUNT.radius, MOUNT.height + MOUNT.stepDrop);
    s.x = scratch.x;
    s.z = scratch.z;
  }

  flags &= ~(FLAG.CROUCHING | FLAG.SPRINTING);
  flags = (buttons & BUTTON.AIM) !== 0 ? flags | FLAG.AIMING : flags & ~FLAG.AIMING;
  flags = speed >= MOUNT.gallopFlagAt ? flags | MOUNT_FLAG.GALLOPING : flags & ~MOUNT_FLAG.GALLOPING;
  s.flags = flags;
}

// ---- what a mount row means (MountState in schema.ts, written by the server's Mounts system, read by the client's MountView) --------------------------------------------

/** `MountState.kind`. */
export const MOUNT_KIND = { horse: 0, wagon: 1 } as const;
/** `MountState.phase`: loose (standing), ridden, led (follows a leader or a route), bolting (runs a few seconds then stands), wrecked (a wagon smashed or burned out). */
export const MOUNT_PHASE = { loose: 0, ridden: 1, led: 2, bolting: 3, wrecked: 4 } as const;
/** Pounds one cargo crate is worth when a wagon is seized. */
export const CARGO_POUNDS = 22;
/** Most mount rows a room keeps (horses and wagons together). */
export const MOUNT_CAP = 10;
/** Seconds a bolting horse runs. */
export const BOLT_SECONDS = 4;

// ---- falling off ------------------------------------------------------------------------------------------------------------------------------------

/** Grip lost per wound level of an arm (none, light, gash, grievous): a module constant so the throw roll allocates nothing. */
const ARM_GRIP: readonly number[] = [0, 0, 0.04, 0.1];

/**
 * The chance (0..1) that an impact unseats the rider. `impact` is the speed the horse shed against a wall (or a hoof-first landing) plus the push of a blast or
 * a blow, in m/s: below THROW_FROM nothing happens however the rider is hurt, and it rises to certain over THROW_SPAN. A maimed rider holds on worse (a lost arm
 * adds 0.15, a grievous one 0.10, a gash 0.04), scaled in by how hard the impact was, so wounds never throw a rider at a standstill.
 */
export function throwRiskValue(speedBefore: number, speedAfter: number, power: number, wounds: number, missing = 0): number {
  const shed = Math.max(0, speedBefore - speedAfter);
  const impact = shed + Math.max(0, power);
  if (!(impact > 0)) return 0;
  const base = clamp((impact - MOUNT.throwFrom) / MOUNT.throwSpan, 0, 1);
  const armL = (missing & LIMB.ARM_L) !== 0 ? 0.15 : (ARM_GRIP[woundLevel(wounds, ZONE.ARM_L)] ?? 0.1);
  const armR = (missing & LIMB.ARM_R) !== 0 ? 0.15 : (ARM_GRIP[woundLevel(wounds, ZONE.ARM_R)] ?? 0.1);
  const grip = armL + armR;
  return clamp(base + grip * clamp(impact / 4, 0, 1), 0, 1);
}

/** True if the rider is thrown. `roll` is a 0..1 deterministic draw (`throwRoll`). */
export const throwRisk = (speedBefore: number, speedAfter: number, power: number, wounds: number, roll: number, missing = 0): boolean =>
  roll < throwRiskValue(speedBefore, speedAfter, power, wounds, missing);

/** The deterministic 0..1 draw behind a throw: the same seed, tick and rider always fall (or stay on) the same way. */
export const throwRoll = (seed: number, tick: number, riderSlot: number): number => hash3(seed, tick | 0, riderSlot | 0, 0x7a0e) / 4294967296;

/** Damage a thrown rider takes: `speed` m/s at the moment of the throw. Bounded (a fall from a gallop hurts; it never kills: players go down, not out). */
export const throwDamage = (speed: number): number => clamp(speed * 1.5 - 4, 0, 18);

// ---- the wagon -------------------------------------------------------------------------------------------------------------------------------------

/**
 * A rigid one-axle trailer. `x, z` is the AXLE; the hitch point (the horse's collar, supplied by the caller) pulls it along. The wagon frame is the rig's: forward
 * is -Z (toward the horse), +X right, origin on the axle at ground level. `y` is optional (a wagon on a bridge deck): when present it follows the ground.
 */
export interface Trailer {
  x: number;
  z: number;
  facing: number;
  y?: number;
}

export const WAGON = {
  /** Axle to hitch point. */
  len: 2.6,
  /** Collision radius of the axle (the box is ~1.7 wide and 3.1 long: this keeps the whole thing off walls without a rotating box). */
  radius: 1.3,
  height: 1.8,
  /** Where the horse's collar sits behind the horse's centre (so the hitch point trails the horse). */
  hitchBack: 1.4,
  /** Deck height; roof-rack height; the crate's centre height above a bay's deck point. */
  deck: 0.8,
  rack: 1.7,
  /** Four crate bays on the deck: x right, z along (negative forward), y the CENTRE height of a crate standing there (deck 0.8 + half a crate 0.3). Two lying bodies are lashed on the roof rack (y = the body's centre). */
  bays: [
    { x: -0.42, y: 1.1, z: -0.55 },
    { x: 0.42, y: 1.1, z: -0.55 },
    { x: -0.42, y: 1.1, z: 0.55 },
    { x: 0.42, y: 1.1, z: 0.55 },
  ],
  bodyBays: [
    { x: -0.42, y: 1.86, z: 0.15, along: true },
    { x: 0.42, y: 1.86, z: 0.15, along: true },
  ],
  /** How far (m) from a bay's world position an unload press reaches, and from the wagon's axle a load press reaches. */
  bayReach: 1.7,
  loadReach: 2.6,
  /** Wheels turn with the distance travelled: radius (m). */
  wheelRadius: 0.55,
} as const;

/**
 * Pulls the trailer's axle to `len` behind the hitch point (hx, hz) and turns its facing toward the hitch, then keeps it out of the world (resolveXZ at radius 1.3).
 * Allocation-free. `dt` is part of the signature for symmetry with the other steps (a rigid trailer does not integrate).
 * Returns false when the wagon is WEDGED: the pulled position leaves it overlapping something (a gap narrower than the wagon), so it stays where it was (still valid)
 * while the horse goes on; the caller decides what a stretched trace does (the server snaps it, see Mounts). It can therefore never be inside an obstacle.
 */
export function trailStep(w: Trailer, hx: number, hz: number, _dt: number, world: CollisionWorld, len: number = WAGON.len): boolean {
  const px = w.x;
  const pz = w.z;
  let dx = px - hx;
  let dz = pz - hz;
  // (not `Math.hypot`: the engine calls it as a builtin and boxes both arguments and the result, 38 B on every step of every wagon, measured; a square root of the sum is exact and allocation-free)
  let d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) {
    // hitched onto the very point: fall straight behind the way the wagon faces
    dx = Math.sin(w.facing);
    dz = Math.cos(w.facing);
    d = 1;
  }
  scratch.x = hx + (dx / d) * len;
  scratch.z = hz + (dz / d) * len;
  const feet = (w.y ?? world.terrainHeight(scratch.x, scratch.z) + 0.3) - MOUNT.stepDrop;
  const h = WAGON.height + MOUNT.stepDrop;
  world.resolveXZ(scratch, feet, WAGON.radius, h);
  // Did the push-out settle? (three passes can leave a wagon wedged between two obstacles: then it does not move at all.)
  const nx = scratch.x;
  const nz = scratch.z;
  const settled = !world.resolveXZ(scratch, feet, WAGON.radius - 1e-3, h);
  if (settled) {
    w.x = nx;
    w.z = nz;
  }
  if (w.y !== undefined) w.y = world.groundHeight(w.x, w.z, w.y - MOUNT.stepDrop);
  const fx = hx - w.x;
  const fz = hz - w.z;
  if (fx * fx + fz * fz > 1e-8) w.facing = Math.atan2(-fx, -fz);
  return settled;
}

/** The hitch point of a horse at (x, z) facing `facing`: behind its centre. Writes into `out`. */
export function hitchPoint(x: number, z: number, facing: number, out: Vec2): void {
  out.x = x + Math.sin(facing) * WAGON.hitchBack;
  out.z = z + Math.cos(facing) * WAGON.hitchBack;
}

/** A wagon-frame point to the world (x right/z along as `WAGON.bays`), for a wagon at (w.x, w.z) with `w.facing`. Writes x/z into `out`. */
export function wagonToWorld(w: Trailer, lx: number, lz: number, out: Vec2): void {
  const c = Math.cos(w.facing);
  const s = Math.sin(w.facing);
  // facing 0 looks down -Z: local +X is world +X rotated by the facing, local +Z (back) is the opposite of forward
  out.x = w.x + lx * c + lz * s;
  out.z = w.z - lx * s + lz * c;
}

/** Wheel rotation (radians) for a wagon that has travelled `distance` metres. */
export const wheelAngle = (distance: number): number => wrapAngle(distance / WAGON.wheelRadius);

// ---- where mounts start -------------------------------------------------------------------------------------------------------------------------------

export interface MountSpot {
  x: number;
  z: number;
  yaw: number;
}
export interface RegionMountSpots {
  horses: MountSpot[];
  wagon: MountSpot;
}

/**
 * Where the loadout's horses and wagon are put at landfall. Hollowmere: the stable, on the open ground west of the marquee and the supply pyramid; Kessar: a ring
 * behind the landing (z <= 82). Facing 0 is north (-Z). `mount.test.ts` proves every spot open under the real step in both regions (and with the bridge down).
 */
export function regionMountSpots(id: RegionId): RegionMountSpots {
  if (id === "kessar") {
    return {
      horses: [
        { x: -5, z: 79, yaw: 0.4 },
        { x: 5, z: 79, yaw: -0.4 },
      ],
      wagon: { x: 0, z: 74, yaw: 0 },
    };
  }
  // D-037: the later regions declare their own spots beside their plans (vesper.ts, saltmarket.ts)
  if (id === "vesper") return VESPER_MOUNT_SPOTS;
  if (id === "saltmarket") return SALTMARKET_MOUNT_SPOTS;
  // D-036: Highmark: a ring behind the Reed Landing (z <= 108), on the open quay-side grass. G proves each open (mount.test.ts runs every region in REGION_IDS).
  if (id === "highmark") {
    return {
      horses: [
        { x: -5, z: 108, yaw: 0.4 },
        { x: 5, z: 108, yaw: -0.4 },
      ],
      wagon: { x: 0, z: 102, yaw: 0 },
    };
  }
  // The open ground west of the marquee is the stable (the camp is crowded: this is the nearest spot to the supply pyramid with room for a wagon, 1.6 m clear on every seed).
  return {
    horses: [
      { x: -17, z: -1, yaw: -1.2 },
      { x: -14.5, z: -1, yaw: -1.0 },
    ],
    wagon: { x: -13, z: 2, yaw: -1.57 },
  };
}
