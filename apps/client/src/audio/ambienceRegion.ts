import type { Rng, RegionId } from "@cb/shared";

/**
 * WHAT EACH REGION SOUNDS LIKE (D-038, docs/_notes/polish2.md section 6). The weather beds (wind, rain, crickets, birds) are shared; on top of them each region has its own voices, scheduled
 * as one-shot positional events around the listener: Hollowmere the mill and the river; Kessar surf, lamp chains and gulls; Highmark wind in the grass, herd bells and a far horn; Vesper
 * canyon wind, drips and creaking timber; the Saltmarket lapping water, a wind-pump, halyards and frogs. Pure tables and a pure, allocation-free scheduler (`stepRegionAmbience`) so a test can
 * run a region for an hour of game time and see what it plays; `ambience.ts` calls it and hands each event to the engine.
 */

export type Daypart = "any" | "day" | "night";

export interface RegionEvent {
  /** A sound in SOUNDS (soundsGrit.ts, or the long-standing `gull`). */
  sound: string;
  /** The keyed version of the sound, if it has one. */
  key?: string;
  /** Seconds between plays: a uniform draw from this range, each time. */
  every: readonly [number, number];
  /** Metres from the listener: a uniform draw from this range, in a random direction. */
  dist: readonly [number, number];
  /** Metres above the listener's feet. */
  height: number;
  volume: readonly [number, number];
  /** Probability that a due event actually plays (the horn is rarer than its timer). */
  chance: number;
  when: Daypart;
}

export interface RegionAmbience {
  /** Added to the wind bed's target (0..1): the plain is breezy, the gorge breathes. */
  wind: number;
  events: readonly RegionEvent[];
}

const E = (sound: string, every: [number, number], dist: [number, number], volume: [number, number] = [0.7, 1], extra: Partial<RegionEvent> = {}): RegionEvent => ({ sound, every, dist, height: 1.5, volume, chance: 1, when: "any", ...extra });

export const REGION_AMBIENCE: Readonly<Record<RegionId, RegionAmbience>> = {
  hollowmere: { wind: 0, events: [E("amb_mill", [7, 14], [28, 70], [0.6, 0.9], { when: "day" })] },
  kessar: {
    wind: 0.08,
    events: [E("amb_surf", [4, 8], [40, 90], [0.7, 1], { height: 0 }), E("amb_lamp_chain", [6, 12], [14, 42], [0.5, 0.9], { height: 3 }), E("gull", [8, 18], [0, 0], [0.5, 0.9], { when: "day" })],
  },
  highmark: {
    wind: 0.2,
    events: [E("amb_gust", [6, 12], [20, 60], [0.6, 1], { key: "grass", height: 0.5 }), E("amb_herd_bell", [5, 11], [30, 85], [0.6, 1], { height: 1 }), E("amb_far_horn", [40, 90], [220, 420], [0.7, 1], { height: 4, chance: 0.7, when: "day" })],
  },
  vesper: {
    wind: 0.14,
    events: [E("amb_gust", [8, 14], [15, 50], [0.6, 1], { key: "canyon", height: 6 }), E("amb_drip", [2, 5], [5, 20], [0.6, 1], { height: 2 }), E("amb_timber_creak", [10, 20], [10, 36], [0.6, 1], { height: 2 })],
  },
  saltmarket: {
    wind: 0.06,
    events: [E("amb_lap", [2, 4], [6, 18], [0.6, 1], { height: 0 }), E("amb_wind_pump", [12, 22], [20, 55], [0.6, 1], { height: 3 }), E("amb_halyard", [7, 14], [12, 38], [0.6, 1], { height: 4 }), E("amb_frog", [3, 7], [10, 40], [0.6, 1], { height: 0, when: "night" })],
  },
};

/** Per-event countdowns for one region (a fixed-size typed array: nothing is allocated after construction). */
export class RegionSchedule {
  readonly due: Float64Array;
  constructor(readonly region: RegionId, rng: Rng) {
    const ev = REGION_AMBIENCE[region].events;
    this.due = new Float64Array(ev.length);
    // stagger the first plays so a region does not open with every voice at once
    for (let i = 0; i < ev.length; i++) this.due[i] = 1 + rng.next() * ev[i]!.every[1] * 0.6;
  }
}

/** Receives one event: the sound, its key (or ""), a bearing (radians), a distance, a height above the listener and a volume. Plain numbers, so the scheduler allocates nothing. */
export type RegionEmit = (sound: string, key: string, az: number, dist: number, height: number, volume: number) => void;

const dayOk = (when: Daypart, daylight: number): boolean => when === "any" || (when === "day" ? daylight > 0.45 : daylight < 0.4);

/** Advances `s` by `dt` seconds. `daylight` is 0..1 (ambienceMix.daylight); `rain` 0..1 silences the quiet outdoor voices. Deterministic in (rng, the calls). */
export function stepRegionAmbience(s: RegionSchedule, dt: number, daylight: number, rain: number, rng: Rng, emit: RegionEmit): void {
  if (!(dt > 0)) return;
  const ev = REGION_AMBIENCE[s.region].events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!;
    s.due[i] = s.due[i]! - dt;
    if (s.due[i]! > 0) continue;
    s.due[i] = e.every[0] + rng.next() * (e.every[1] - e.every[0]);
    if (!dayOk(e.when, daylight) || rng.next() > e.chance) continue;
    if (rain > 0.7 && (e.sound === "amb_far_horn" || e.sound === "gull")) continue; // nothing carries through a downpour
    const az = rng.next() * Math.PI * 2;
    const dist = e.dist[0] + rng.next() * (e.dist[1] - e.dist[0]);
    emit(e.sound, e.key ?? "", az, dist, e.height, e.volume[0] + rng.next() * (e.volume[1] - e.volume[0]));
  }
}
