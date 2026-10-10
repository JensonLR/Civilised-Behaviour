import { FLAG, seedFromString } from "@cb/shared";
import { footstep, playBlast, playSfx, setAmbienceMood, setAudioRegion, setMusicMix, stopSfx } from "../audio/index.ts";
import { MUSIC_LAYERS, newMusicState, stepMusic, type MusicLayerId, type MusicMood, type MusicSignals } from "../audio/musicLayers.ts";
import { ambienceMood } from "../audio/mixDuck.ts";
import { getAdaptiveMusic, getGore } from "../settings.ts";
import { Stride } from "../audio/stride.ts";
import { regionSurfaceAt, type Surface } from "../audio/surface.ts";

interface Track {
  stride: Stride;
  flags: number;
  /** Most negative vertical speed since leaving the ground (for how hard the landing is). */
  fall: number;
  seen: boolean;
  /** The foot that lands next (+1 right, -1 left): the boot prints alternate. */
  foot: 1 | -1;
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

  /**
   * @param onStep  each footfall, on the same stride law as the footstep sound (the Game lays a boot print in mud: D-058): where, which way the body moves, which foot, and the surface.
   */
  constructor(
    private readonly ground: (x: number, z: number) => number,
    private readonly onStep?: (x: number, z: number, vx: number, vz: number, foot: 1 | -1, surface: Surface) => void,
    /** Standing water over the ground at (x, z), metres (the region's terrain): the splash under a boot. */
    private readonly water?: (x: number, z: number) => number,
  ) {}

  private track(id: string, flags: number): Track {
    let t = this.tracks.get(id);
    if (!t) {
      t = { stride: new Stride(), flags, fall: 0, seen: true, foot: 1 };
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
      const surface = regionSurfaceAt(this.region, x, z, y - this.ground(x, z), this.water?.(x, z) ?? 0);
      footstep(surface, speed, { x, y, z, crouching: (flags & FLAG.CROUCHING) !== 0, volume: isMe ? 1 : 0.9 });
      this.onStep?.(x, z, vx, vz, t.foot, surface);
      t.foot = t.foot === 1 ? -1 : 1;
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

  /** D-054: the nearest lit keg is `distance` metres away (Infinity: none lit). The hiss fades out by 30 m and quickens as the fuse burns down (`tenths` left). */
  fuse(distance: number, tenths: number): void {
    if (Number.isFinite(distance) && distance < 30) {
      this.hissing = true;
      const near = 1 - distance / 30;
      playSfx("fuse_hiss", { volume: near * near, pitch: 1 + Math.max(0, 40 - tenths) / 40 * 0.25 });
    } else if (this.hissing) {
      this.hissing = false;
      stopSfx("fuse_hiss");
    }
  }
  private hissing = false;

  /**
   * D-103: the nearest flames are `distance` metres off (Infinity: nothing burns) and `cells` of ground are burning. The roar fades out by 40 m and grows with the size of the
   * fire; burning yourself, it is right on top of you.
   */
  fire(distance: number, cells: number, alight: boolean): void {
    const d = alight ? 0 : distance;
    if (Number.isFinite(d) && d < 40 && cells > 0) {
      this.roaring = true;
      const near = 1 - d / 40;
      const size = Math.min(1, 0.45 + cells / 60);
      playSfx("grass_fire", { volume: near * near * size, pitch: 0.95 + Math.min(0.1, cells / 2000) });
    } else if (this.roaring) {
      this.roaring = false;
      stopSfx("grass_fire");
    }
  }
  private roaring = false;

  /** A body was hit: the victim cries out, in a voice that belongs to their face. */
  hurt(x: number, y: number, z: number, look: string, power: number, isMe: boolean): void {
    playSfx("hurt", { x, y, z, seed: seedFromString(look), volume: (isMe ? 1 : 0.9) * Math.min(1, 0.55 + power) });
  }

  /** D-073: a scream (a limb gone, a ruinous blow) in the voice of that face; at Gore Off it is only the hurt cry (the scream is the gore, not the information). */
  scream(x: number, y: number, z: number, look: string, isMe: boolean): void {
    if (getGore() === "off") return this.hurt(x, y, z, look, 1, isMe);
    playSfx("scream", { x, y, z, seed: seedFromString(look), volume: isMe ? 1 : 0.95 });
  }

  /** D-087: a line of the Society's gibberish in the voice of that face (`key`: the shape of what is said). Positional, or in the centre when no place is given (a parley). */
  babble(look: string, key: string, at?: { x: number; y: number; z: number }, isMe = false): void {
    const seed = seedFromString(look);
    // (the look picks one of the four voices and nudges its pitch, so a character always sounds like themselves)
    const pitch = 0.94 + ((seed >>> 4) % 13) / 100;
    playSfx("babble", at ? { ...at, key, seed, pitch, volume: isMe ? 0.9 : 1 } : { key, seed, pitch, volume: 0.75 });
  }

  /** D-073: a cry of panic (a civilian bolting, a soldier breaking), in the voice of that face. */
  panic(x: number, y: number, z: number, look: string): void {
    playSfx("panic", { x, y, z, seed: seedFromString(look), volume: 0.85 });
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

  /** D-105: a coup de grace lands (the bone and the heavy blow; the Gore setting keys the wet ones, audio/index.ts). */
  finisher(x: number, y: number, z: number): void {
    playSfx("gore_bone", { x, y, z, volume: 1 });
    playSfx("gore_flesh_heavy", { x, y, z, volume: 0.9 });
  }

  /** D-104: a weapon knocked out of a hand hits the ground. */
  clatter(x: number, y: number, z: number): void {
    playSfx("drop", { x, y, z, volume: 0.9 });
    playSfx("foley_gear", { x, y, z, volume: 0.6 });
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
