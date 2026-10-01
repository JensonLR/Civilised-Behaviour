import { FLAG, seedFromString } from "@cb/shared";
import { footstep, playBlast, playSfx, setAmbienceMood, setAudioRegion, setMusicMix, stopSfx } from "../audio/index.ts";
import { MUSIC_LAYERS, newMusicState, stepMusic, type MusicLayerId, type MusicMood, type MusicSignals } from "../audio/musicLayers.ts";
import { ambienceMood } from "../audio/mixDuck.ts";
import { getAdaptiveMusic } from "../settings.ts";
import { Stride } from "../audio/stride.ts";
import { regionSurface, surfaceAt } from "../audio/surface.ts";

interface Track {
  stride: Stride;
  flags: number;
  /** Most negative vertical speed since leaving the ground (for how hard the landing is). */
  fall: number;
  seen: boolean;
}

/** The plain jolly bed (Adaptive music off): nothing but the bed. */
const PLAIN_BED = Object.fromEntries(MUSIC_LAYERS.map((id) => [id, id === "bed" ? 1 : 0])) as Record<MusicLayerId, number>;

/** What a blow struck: the surface ids of the weapon visuals (earth, wood, iron, stone, water, flesh) in words the sound table understands. */
export type ImpactMaterial = "earth" | "wood" | "stone" | "metal" | "water" | "flesh";
const IMPACT_NAME: Record<Exclude<ImpactMaterial, "flesh">, string> = { earth: "impact_earth", wood: "impact_splinter", stone: "impact_chip", metal: "impact_ring", water: "impact_splash" };
export type FoleyName = "cloth" | "gear" | "holster" | "draw" | "ramrod" | "powder" | "cock" | "shell";

/**
 * Turns replicated player state into sounds: footsteps on the cadence of the stride law, jumps and landings, picking up and putting down,
 * going down, being revived, and the voice of a wound. Everything is derived from state every client already has (flags, velocity,
 * position), so remote players are heard from where they are without any extra network traffic.
 */
export class GameAudio {
  private readonly tracks = new Map<string, Track>();
  private reviving = false;
  /** The region the signals last named: it picks the ground under the boots (sand, mud, stone). */
  private region = "hollowmere";
  private readonly mood = newMusicState();

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
      footstep(regionSurface(this.region, surfaceAt(x, z, y - this.ground(x, z))), speed, { x, y, z, crouching: (flags & FLAG.CROUCHING) !== 0, volume: isMe ? 1 : 0.9 });
    }
    if (!grounded && vy < t.fall) t.fall = vy;
    if (wasGrounded && !grounded && vy > 2.5) playSfx("jump", { x, y, z, volume: isMe ? 1 : 0.8 });
    if (!wasGrounded && grounded) {
      if (t.fall < -3 && !downed) playSfx("land", { x, y, z, volume: Math.min(1, -t.fall / 14) });
      t.fall = 0;
    }
    if (downed && !wasDowned) {
      playSfx("down", { x, y, z });
      this.fall(x, y, z, isMe);
    }
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
    playSfx("gore_sever_wet", { x, y, z, volume: 0.8 }); // the Gore setting picks its version (audio/index.ts); at Off it is a rubbery boing
  }

  /** A body goes down for good: the weight and the gear landing, then (a moment later) a bad breath. */
  private fall(x: number, y: number, z: number, isMe: boolean): void {
    playSfx("gore_body_fall", { x, y, z, volume: isMe ? 0.9 : 1 });
    setTimeout(() => playSfx("gore_bad_breath", { x, y, z, seed: Math.floor((x + z) * 7) & 7 }), 700);
  }

  /** A blow struck `material` at (x, y, z) with `power` 0..1 (a pistol ball 0.4, a blunderbuss or a cannon 1): the right sound for what it hit. Flesh is the heavy or light blow, wet at the Gore setting. */
  impact(material: ImpactMaterial, x: number, y: number, z: number, power = 0.6): void {
    if (material === "flesh") playSfx(power >= 0.6 ? "gore_flesh_heavy" : "gore_flesh_light", { x, y, z, volume: 0.6 + 0.4 * Math.min(1, power) });
    else playSfx(IMPACT_NAME[material], { x, y, z, volume: 0.6 + 0.4 * Math.min(1, power) });
  }

  /** Blood reaching the ground (a decal landing, a pool spreading): a soft wet sound, quiet and near. */
  bloodOnGround(x: number, y: number, z: number): void {
    playSfx("gore_blood_ground", { x, y, z, volume: 0.8 });
  }

  /** An explosion or a cannon shot with its rumbling tail (audio/index.ts `playBlast`). */
  blast(kind: "explosion" | "cannon", x: number, y: number, z: number): void {
    playBlast(kind, x, y, z);
  }

  /** Handling sounds: cloth, gear, holster, draw, ramrod, powder, cock, shell. Place them at the body that makes them. */
  foley(name: FoleyName, x: number, y: number, z: number, volume = 1): void {
    playSfx(`foley_${name}`, { x, y, z, volume });
  }

  /**
   * One frame of the adaptive score: the mood driver reads `signals` (game/musicSignals.ts builds them), moves the stem gains, and the mixer follows (the stems, the ambience's -6 dB in a fight,
   * everything at half under a parley). With Adaptive music off the plain jolly bed plays and nothing else. The mood is readable for a debug overlay.
   */
  update(dt: number, signals: MusicSignals): void {
    setAudioRegion(signals.region);
    this.region = signals.region;
    if (getAdaptiveMusic()) {
      stepMusic(this.mood, signals, dt);
      setMusicMix(this.mood.gain, this.mood.parleyDuck);
      setAmbienceMood(ambienceMood(this.mood));
    } else {
      setMusicMix(PLAIN_BED, signals.parley ? 0.5 : 1);
      setAmbienceMood(signals.parley ? 0.5 : 1);
    }
  }

  get musicMood(): MusicMood {
    return this.mood.mood;
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
