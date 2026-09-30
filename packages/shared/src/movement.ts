import { BUTTON, CHARACTER, FLAG, MOVEMENT } from "./constants.ts";
import type { CollisionWorld, Vec2 } from "./collision.ts";
import { TAU, approach, approachAngle, clamp } from "./math.ts";
import { createInjuryMods, injuryMods } from "./injury.ts";

/**
 * The authoritative-and-predicted character state. Every field is a scalar so it maps 1:1 to
 * PlayerState schema fields and to the client reconciler's rollback snapshot.
 */
export interface CharState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Body heading, radians (0 = facing -Z). */
  facing: number;
  /** Bit field, see FLAG. */
  flags: number;
  /** Seconds of remaining stumble (reduced control). Set by the server on knockback. */
  stumble: number;
  /**
   * Server-owned INPUTS to the step (read, never written by it): packed wound severities and the lost-limb mask. They are mirrored
   * by the client reconciler together with the position they produced, so injuries slow client and server identically (injury.ts).
   */
  wounds: number;
  missing: number;
}

/** Wire-level input frame (MoveInput schema). Quantised: stick axes are int8, yaw is uint16. */
export interface MoveCommand {
  /** Forward stick, -127..127 (+ = forward relative to camera). */
  moveF: number;
  /** Right stick, -127..127 (+ = right relative to camera). */
  moveR: number;
  /** Camera heading, 0..65535 mapping to 0..2PI. */
  yaw: number;
  buttons: number;
  /**
   * Combat aim (weapons.ts): the direction of a shot, which may differ a little from the camera yaw (the crosshair, not the muzzle, is
   * where the player is looking), and the weapon they want in hand. Optional: the movement step never reads them, so replaying an input
   * with or without them moves the body identically.
   */
  aimYaw?: number;
  aimElev?: number;
  weapon?: number;
}

export const yawFromWire = (w: number): number => (w / 65536) * TAU;
export const yawToWire = (rad: number): number => {
  const n = ((rad % TAU) + TAU) % TAU;
  return Math.round((n / TAU) * 65536) & 0xffff;
};
export const axisToWire = (v: number): number => Math.round(clamp(v, -1, 1) * 127);

const scratch: Vec2 = { x: 0, z: 0 };
const mods = createInjuryMods();

/**
 * One fixed step of the character controller. Pure with respect to (state, cmd, dt, world):
 * identical inputs give identical outputs on client and server, which is what lets the
 * client reconciler replay unacknowledged inputs after a server correction.
 */
export function stepCharacter(s: CharState, cmd: MoveCommand, dt: number, world: CollisionWorld): void {
  const downed = (s.flags & FLAG.DOWNED) !== 0;
  const wasGrounded = (s.flags & FLAG.GROUNDED) !== 0;
  const buttons = cmd.buttons;
  const camYaw = yawFromWire(cmd.yaw);

  // ---- intent ----------------------------------------------------------------------------
  let f = cmd.moveF / 127;
  let r = cmd.moveR / 127;
  let mag = Math.hypot(f, r);
  if (mag > 1) {
    f /= mag;
    r /= mag;
    mag = 1;
  }
  const control = s.stumble > 0 ? MOVEMENT.stumbleControl : 1;
  s.stumble = Math.max(0, s.stumble - dt);

  const dragged = (s.flags & FLAG.DRAGGED) !== 0;
  if (dragged) {
    stepDragged(s, dt, world);
    return;
  }
  const carrying = (s.flags & FLAG.CARRYING) !== 0;
  const dragging = (s.flags & FLAG.DRAGGING) !== 0;
  const reviving = (s.flags & FLAG.REVIVING) !== 0;
  const operating = (s.flags & FLAG.OPERATING) !== 0;
  const aiming = !downed && (buttons & BUTTON.AIM) !== 0;
  // Injuries (server-owned wounds/missing, read as predicted inputs). A downed body only crawls, so they are moot there.
  injuryMods(s.wounds, s.missing, (s.flags & FLAG.PEG_LEG) !== 0, mods);
  const crouching = !downed && (buttons & BUTTON.CROUCH) !== 0;
  const sprinting = !downed && !crouching && !carrying && !dragging && !aiming && mods.sprintOk && (buttons & BUTTON.SPRINT) !== 0 && f > 0.3;
  let topSpeed: number = MOVEMENT.runSpeed;
  if (downed) topSpeed = MOVEMENT.crawlSpeed;
  else if (crouching) topSpeed = MOVEMENT.crouchSpeed;
  else if (sprinting) topSpeed = MOVEMENT.sprintSpeed;
  if (!downed) topSpeed *= mods.speedMul;
  if (carrying) topSpeed *= MOVEMENT.carryFactor;
  if (dragging) topSpeed *= MOVEMENT.dragFactor;
  if (aiming) topSpeed *= MOVEMENT.aimFactor;
  if (reviving || operating) topSpeed = 0; // kneeling over a teammate or working a cannon: hold position (turning still allowed)

  // Camera-relative world direction. Yaw 0 looks down -Z; +R is camera-right.
  const sinY = Math.sin(camYaw);
  const cosY = Math.cos(camYaw);
  const dirX = -sinY * f + cosY * r;
  const dirZ = -cosY * f - sinY * r;
  const wantVx = dirX * topSpeed * (mag > 0 ? 1 : 0);
  const wantVz = dirZ * topSpeed * (mag > 0 ? 1 : 0);

  // ---- horizontal velocity -----------------------------------------------------------------
  const rate = wasGrounded ? (mag > 0 ? MOVEMENT.groundAccel : MOVEMENT.groundDecel) : MOVEMENT.airAccel;
  const maxDv = rate * control * dt;
  const dvx = wantVx - s.vx;
  const dvz = wantVz - s.vz;
  const dvLen = Math.hypot(dvx, dvz);
  if (dvLen <= maxDv || dvLen < 1e-9) {
    s.vx = wantVx;
    s.vz = wantVz;
  } else {
    s.vx += (dvx / dvLen) * maxDv;
    s.vz += (dvz / dvLen) * maxDv;
  }

  // ---- jump -----------------------------------------------------------------------------------
  const jumpHeld = (buttons & BUTTON.JUMP) !== 0;
  let flags = s.flags;
  if (!jumpHeld) flags &= ~FLAG.JUMP_LATCH;
  if (jumpHeld && wasGrounded && !downed && !crouching && !carrying && !dragging && !reviving && !operating && mods.jumpOk && (flags & FLAG.JUMP_LATCH) === 0 && s.stumble <= 0) {
    s.vy = MOVEMENT.jumpSpeed;
    flags |= FLAG.JUMP_LATCH;
    flags &= ~FLAG.GROUNDED;
  }
  const grounded = wasGrounded && (flags & FLAG.GROUNDED) !== 0;

  // ---- horizontal integration with collision -----------------------------------------------
  const height = crouching || downed ? CHARACTER.crouchHeight : CHARACTER.height;
  let nx = s.x + s.vx * dt;
  let nz = s.z + s.vz * dt;
  scratch.x = nx;
  scratch.z = nz;
  world.resolveXZ(scratch, s.y, CHARACTER.radius, height);
  nx = scratch.x;
  nz = scratch.z;

  if (grounded && !walkable(world, s, nx, nz)) {
    // Try sliding along each axis so steep terrain doesn't glue the character in place.
    scratch.x = s.x + s.vx * dt;
    scratch.z = s.z;
    world.resolveXZ(scratch, s.y, CHARACTER.radius, height);
    const okX = walkable(world, s, scratch.x, scratch.z);
    const ax = scratch.x;
    const az = scratch.z;
    scratch.x = s.x;
    scratch.z = s.z + s.vz * dt;
    world.resolveXZ(scratch, s.y, CHARACTER.radius, height);
    const okZ = walkable(world, s, scratch.x, scratch.z);
    if (okX && (!okZ || Math.abs(s.vx) >= Math.abs(s.vz))) {
      nx = ax;
      nz = az;
      s.vz = 0;
    } else if (okZ) {
      nx = scratch.x;
      nz = scratch.z;
      s.vx = 0;
    } else {
      nx = s.x;
      nz = s.z;
      s.vx = 0;
      s.vz = 0;
    }
  }
  // Report actual displacement back into velocity so walls kill momentum instead of banking it.
  if (dt > 0) {
    const ax = (nx - s.x) / dt;
    const az = (nz - s.z) / dt;
    if (Math.abs(ax) < Math.abs(s.vx)) s.vx = ax;
    if (Math.abs(az) < Math.abs(s.vz)) s.vz = az;
  }
  s.x = nx;
  s.z = nz;

  // ---- vertical --------------------------------------------------------------------------------
  const ground = world.groundHeight(s.x, s.z, s.y);
  if (grounded) {
    if (s.y - ground <= CHARACTER.snapDistance) {
      s.y = ground;
      s.vy = 0;
      flags |= FLAG.GROUNDED;
    } else {
      flags &= ~FLAG.GROUNDED;
    }
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

  // ---- facing --------------------------------------------------------------------------------------
  const speed = Math.hypot(s.vx, s.vz);
  // The body faces where the camera looks while aiming or attacking (a swing or a shot goes where the player is looking).
  if ((buttons & (BUTTON.AIM | BUTTON.FIRE | BUTTON.MELEE)) !== 0 && !downed) {
    s.facing = approachAngle(s.facing, Math.atan2(sinY, cosY), MOVEMENT.turnRate * dt); // (the camera looks along (-sin, -cos): facing = yaw)
  } else if (speed > 0.3) {
    s.facing = approachAngle(s.facing, Math.atan2(-s.vx, -s.vz), MOVEMENT.turnRate * dt);
  }

  flags = crouching ? flags | FLAG.CROUCHING : flags & ~FLAG.CROUCHING;
  flags = sprinting ? flags | FLAG.SPRINTING : flags & ~FLAG.SPRINTING;
  flags = aiming ? flags | FLAG.AIMING : flags & ~FLAG.AIMING;
  s.flags = flags;
}

/**
 * A dragged body has no will of its own: the server writes its velocity each tick (dragger's velocity plus a spring toward
 * the trailing position) and this integrates it with the same collision and ground rules as a walker. Input is ignored, so
 * the client's prediction of a dragged local player stays consistent with the server instead of fighting it.
 * Facing is server-owned while dragged.
 */
function stepDragged(s: CharState, dt: number, world: CollisionWorld): void {
  scratch.x = s.x + s.vx * dt;
  scratch.z = s.z + s.vz * dt;
  world.resolveXZ(scratch, s.y, CHARACTER.radius, CHARACTER.crouchHeight);
  s.x = scratch.x;
  s.z = scratch.z;
  s.y = world.groundHeight(s.x, s.z, s.y + CHARACTER.snapDistance);
  s.vy = 0;
  s.flags |= FLAG.GROUNDED;
  s.stumble = 0;
}

/** Terrain-slope check for a grounded move. Obstacle step-ups are handled by groundHeight. */
function walkable(world: CollisionWorld, s: CharState, nx: number, nz: number): boolean {
  const dx = nx - s.x;
  const dz = nz - s.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const rise = world.terrainHeight(nx, nz) - world.terrainHeight(s.x, s.z);
  return rise <= 0 || rise / dist <= CHARACTER.maxSlope;
}

export function createCharState(x: number, z: number, world: CollisionWorld): CharState {
  return {
    x,
    y: world.groundHeight(x, z, 1e6),
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    flags: FLAG.GROUNDED,
    stumble: 0,
    wounds: 0,
    missing: 0,
  };
}

export { approach };
