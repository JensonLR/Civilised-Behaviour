import { FLAG, seedFromString } from "@cb/shared";
import { footstep, playSfx, stopSfx } from "../audio/index.ts";
import { Stride } from "../audio/stride.ts";
import { surfaceAt } from "../audio/surface.ts";

interface Track {
  stride: Stride;
  flags: number;
  /** Most negative vertical speed since leaving the ground (for how hard the landing is). */
  fall: number;
  seen: boolean;
}

/**
 * Turns replicated player state into sounds: footsteps on the cadence of the stride law, jumps and landings, picking up and putting down,
 * going down, being revived, and the voice of a wound. Everything is derived from state every client already has (flags, velocity,
 * position), so remote players are heard from where they are without any extra network traffic.
 */
export class GameAudio {
  private readonly tracks = new Map<string, Track>();
  private reviving = false;

  constructor(private readonly ground: (x: number, z: number) => number) {}

  private track(id: string, flags: number): Track {
    let t = this.tracks.get(id);
    if (!t) {
      t = { stride: new Stride(), flags, fall: 0, seen: true };
      this.tracks.set(id, t);
    }
    return t;
  }

  /** Seconds left in which the local player's put-down counts as a throw (they pressed Throw). */
  private throwWindow = 0;

  /** The local player pressed Throw this step (so the next put-down is a throw, not a drop). */
  localThrow(): void {
    this.throwWindow = 0.5;
  }

  /** Call once per player per frame from the actor sync. */
  actor(id: string, isMe: boolean, dt: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, flags: number): void {
    const t = this.track(id, flags);
    t.seen = true;
    const grounded = (flags & FLAG.GROUNDED) !== 0;
    const wasGrounded = (t.flags & FLAG.GROUNDED) !== 0;
    const downed = (flags & FLAG.DOWNED) !== 0;
    const wasDowned = (t.flags & FLAG.DOWNED) !== 0;
    const carrying = (flags & FLAG.CARRYING) !== 0;
    const wasCarrying = (t.flags & FLAG.CARRYING) !== 0;
    const speed = Math.hypot(vx, vz);
    if (isMe && this.throwWindow > 0) this.throwWindow -= dt;

    // Footfalls, on the animator's stride law.
    if (!downed && t.stride.advance(dt, speed, grounded)) {
      footstep(surfaceAt(x, z, y - this.ground(x, z)), speed, { x, y, z, crouching: (flags & FLAG.CROUCHING) !== 0, volume: isMe ? 1 : 0.9 });
    }
    if (!grounded && vy < t.fall) t.fall = vy;
    if (wasGrounded && !grounded && vy > 2.5) playSfx("jump", { x, y, z, volume: isMe ? 1 : 0.8 });
    if (!wasGrounded && grounded) {
      if (t.fall < -3 && !downed) playSfx("land", { x, y, z, volume: Math.min(1, -t.fall / 14) });
      t.fall = 0;
    }
    if (downed && !wasDowned) playSfx("down", { x, y, z });
    if (!downed && wasDowned) playSfx("revive_done", { x, y, z });
    if (carrying && !wasCarrying) playSfx("pickup", { x, y, z });
    if (!carrying && wasCarrying) playSfx(isMe && this.throwWindow > 0 ? "throw" : "drop", { x, y, z });
    t.flags = flags;
  }

  /** The local player is reviving or being revived (progress 0..100), or -1. Keeps the revive loop alive, rising in pitch as it nears done. */
  revive(progress: number): void {
    if (progress >= 0) {
      this.reviving = true;
      playSfx("revive_hold", { volume: 0.9, pitch: 0.9 + Math.min(100, progress) / 100 * 0.35 });
    } else if (this.reviving) {
      this.reviving = false;
      stopSfx("revive_hold");
    }
  }

  /** A body was hit: the victim cries out, in a voice that belongs to their face. */
  hurt(x: number, y: number, z: number, look: string, power: number, isMe: boolean): void {
    playSfx("hurt", { x, y, z, seed: seedFromString(look), volume: (isMe ? 1 : 0.9) * Math.min(1, 0.55 + power) });
  }

  sever(x: number, y: number, z: number): void {
    playSfx("limb_sever", { x, y, z });
  }

  /** Drops per-player state for anyone who left. */
  sweep(): void {
    for (const [id, t] of this.tracks) {
      if (!t.seen) this.tracks.delete(id);
      t.seen = false;
    }
  }

  dispose(): void {
    this.tracks.clear();
    stopSfx("revive_hold");
  }
}
