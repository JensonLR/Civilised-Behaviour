import type { Rng } from "@cb/shared";
import { N, R, T, V, bp, hp, lp, type Layer } from "./dsp.ts";

/**
 * Every sound effect in the game, as arithmetic. Nothing here is a sample: each entry is a recipe (`layers`) that the engine renders ONCE
 * into an AudioBuffer with an OfflineAudioContext (a few variants each), normalises to `peakDb`, and then plays back through a pooled,
 * spatialised voice. So a footstep at runtime is one buffer source, not fifteen oscillators, and every level below is a number we can measure.
 *
 * Levels (`peakDb`, dBFS of the loudest sample): the cannon and explosions sit at about -0.5 and everything else is placed relative to them, so
 * a musket is clearly quieter than a cannon, footsteps and UI ticks are far below both. The master limiter in the engine catches the sum.
 */

export interface SoundParams {
  /** Frequency multiplier chosen for this variant. */
  pitch: number;
  /** Deterministic per (sound, key, variant): the same buffer on every run. */
  rng: Rng;
  /** Selector for sounds with named versions (gore level, surface, ...). */
  key: string;
  variant: number;
}

export type SoundGroup = "weapon" | "impact" | "foot" | "body" | "ui" | "world" | "ambient";

export interface SoundDef {
  group: SoundGroup;
  layers(p: SoundParams): Layer[];
  /** Loudest sample after normalisation, dBFS. */
  peakDb: number;
  /** Full level inside `ref` metres, silent beyond `max`. Ignored for `ui` sounds. */
  ref: number;
  max: number;
  /** Reverb send (0..1) before distance adds more. */
  reverb: number;
  /** Voice priority (higher survives stealing), simultaneous-voice cap and minimum seconds between plays. */
  prio: number;
  cap: number;
  gap: number;
  /** Baked variants per key (default 3) and the keys (default one). */
  variants: number;
  keys: readonly string[];
  /** Waveshaper drive applied to the whole sound (harmonics for the big guns). */
  drive: number;
  /** 0..1: how hard this sound ducks music and ambience for a moment. */
  duck: number;
  /** Non-positional: heard at full level in the centre (interface, your own body). */
  ui: boolean;
  /** Random pitch spread at play time (fraction). */
  jitter: number;
  /** Loops with this period (seconds) while held alive. */
  loop: number;
}

const def = (o: Partial<SoundDef> & Pick<SoundDef, "group" | "layers" | "peakDb">): SoundDef => ({
  ref: 8,
  max: 80,
  reverb: 0.15,
  prio: 1,
  cap: 4,
  gap: 0,
  variants: 3,
  keys: [""],
  drive: 0,
  duck: 0,
  ui: false,
  jitter: 0.05,
  loop: 0,
  ...o,
});

const jit = (p: SoundParams, spread: number): number => 1 + (p.rng.next() * 2 - 1) * spread;

// ---- weapons ---------------------------------------------------------------------------------------------------------------------------

const musket = def({
  group: "weapon", peakDb: -1, ref: 14, max: 260, reverb: 0.45, prio: 3, cap: 6, gap: 0.03, duck: 0.35, drive: 0.6, jitter: 0.04,
  layers: (p) => [
    N({ dec: 0.05, peak: 1.25, f: [hp(2200), lp(9000)] }),
    N({ atk: 0.002, dec: 0.38, peak: 0.9, f: [lp(4200 * jit(p, 0.1), 320, 0.32)] }),
    T({ hz: 165 * jit(p, 0.08), to: 48, over: 0.14, atk: 0.002, dec: 0.28, peak: 0.75 }),
    N({ kind: "pink", at: 0.01, atk: 0.006, dec: 0.9, peak: 0.32, f: [bp(700, 0.6)] }),
    N({ kind: "brown", at: 0.04, atk: 0.03, dec: 0.9, peak: 0.28, f: [lp(700)] }),
    N({ dec: 0.18, atk: 0.01, peak: 0.25, f: [hp(5000)] }),
  ],
});

const pistol = def({
  group: "weapon", peakDb: -2, ref: 10, max: 200, reverb: 0.3, prio: 3, cap: 6, gap: 0.03, duck: 0.2, drive: 0.4,
  layers: (p) => [
    N({ dec: 0.035, peak: 1.2, f: [hp(2800)] }),
    N({ atk: 0.001, dec: 0.2, peak: 0.9, f: [lp(5200 * jit(p, 0.1), 600, 0.16)] }),
    T({ hz: 230 * jit(p, 0.08), to: 85, over: 0.07, atk: 0.001, dec: 0.14, peak: 0.5 }),
    N({ kind: "pink", at: 0.01, atk: 0.01, dec: 0.55, peak: 0.28, f: [bp(1100, 0.7)] }),
  ],
});

const blunderbuss = def({
  group: "weapon", peakDb: -0.5, ref: 20, max: 300, reverb: 0.55, prio: 3, cap: 3, gap: 0.05, duck: 0.5, drive: 0.9, jitter: 0.03, variants: 3,
  layers: (p) => {
    const out: Layer[] = [
      N({ dec: 0.08, peak: 1.2, f: [hp(1200)] }),
      N({ atk: 0.004, dec: 0.6, peak: 1, f: [lp(3200, 200, 0.5)] }),
      N({ kind: "pink", at: 0.018, atk: 0.01, dec: 0.35, peak: 0.6, f: [bp(500, 0.5)] }),
      T({ hz: 118 * jit(p, 0.06), to: 32, over: 0.3, atk: 0.003, dec: 0.5, peak: 0.9 }),
      T({ type: "triangle", at: 0.02, hz: 60, to: 30, over: 0.4, atk: 0.01, dec: 0.6, peak: 0.35 }),
      N({ kind: "brown", at: 0.05, atk: 0.04, dec: 1.4, peak: 0.35, f: [lp(550)] }),
    ];
    // Pellets whining away: a scatter of tiny bright ticks.
    for (let i = 0; i < 6; i++) out.push(N({ at: 0.05 + p.rng.next() * 0.25, dec: 0.015, peak: 0.12, f: [bp(3000 + p.rng.next() * 3000, 2)] }));
    return out;
  },
});

const cannon = def({
  group: "weapon", peakDb: -0.3, ref: 45, max: 520, reverb: 0.7, prio: 4, cap: 3, gap: 0.1, duck: 0.8, drive: 1.2, jitter: 0.03, variants: 2,
  layers: (p) => [
    N({ dec: 0.1, peak: 1.2, f: [hp(900), lp(7000)] }),
    N({ kind: "pink", atk: 0.01, dec: 0.9, peak: 0.7, f: [bp(380, 0.6)] }),
    N({ atk: 0.006, dec: 1.0, peak: 1, f: [lp(2600, 110, 0.9, 0.8)] }),
    T({ hz: 72 * jit(p, 0.05), to: 26, over: 0.8, atk: 0.004, dec: 1.6, peak: 1.2 }),
    T({ at: 0.05, hz: 44, to: 22, over: 1.2, atk: 0.03, dec: 2.0, peak: 0.7 }),
    N({ kind: "brown", at: 0.1, atk: 0.12, dec: 2.4, peak: 0.6, f: [lp(260, 90, 2.5)] }),
    N({ kind: "pink", at: 0.38, atk: 0.02, dec: 0.9, peak: 0.25, f: [lp(900)] }),
    T({ type: "triangle", hz: 320, to: 90, over: 0.04, dec: 0.09, peak: 0.5 }),
  ],
});

const explosion = def({
  group: "weapon", peakDb: -0.3, ref: 40, max: 480, reverb: 0.75, prio: 4, cap: 3, gap: 0.08, duck: 0.8, drive: 1.4, jitter: 0.04, variants: 2,
  layers: (p) => {
    const out: Layer[] = [
      N({ dec: 0.06, peak: 1.2, f: [hp(1400)] }),
      N({ atk: 0.004, dec: 1.4, peak: 1.2, f: [lp(3000, 140, 1.1)] }),
      T({ hz: 60 * jit(p, 0.06), to: 22, over: 1.0, atk: 0.003, dec: 2.0, peak: 1.2 }),
      N({ kind: "pink", atk: 0.01, dec: 1.1, peak: 0.9, f: [bp(320, 0.5)] }),
      N({ kind: "brown", at: 0.15, atk: 0.2, dec: 2.6, peak: 0.55, f: [lp(240)] }),
      N({ kind: "pink", at: 0.5, atk: 0.1, dec: 1.6, peak: 0.22, f: [lp(1000)] }),
    ];
    // Debris pattering down.
    for (let i = 0; i < 14; i++) out.push(N({ at: 0.12 + i * 0.09 + p.rng.next() * 0.06, dec: 0.04 + p.rng.next() * 0.06, peak: 0.3 * (1 - i / 16), f: [bp(800 + p.rng.next() * 3000, 1.5)] }));
    return out;
  },
});

const sabreSwing = def({
  group: "weapon", peakDb: -9, ref: 6, max: 50, reverb: 0.12, prio: 1, cap: 3, gap: 0.05, jitter: 0.08,
  layers: (p) => [
    N({ kind: "pink", atk: 0.07, dec: 0.12, peak: 0.9, f: [bp(600, 1.6, 2400 * jit(p, 0.1), 0.14)] }),
    N({ at: 0.09, atk: 0.02, dec: 0.22, peak: 0.5, f: [bp(2400, 1.2, 900, 0.2)] }),
    R({ at: 0.03, hz: 3200 * jit(p, 0.05), ratios: [1, 1.5], amps: [0.06, 0.03], decs: [0.25, 0.2], peak: 1 }),
  ],
});

const sabreHit = def({
  group: "weapon", peakDb: -3, ref: 12, max: 110, reverb: 0.35, prio: 2, cap: 4, gap: 0.04, jitter: 0.06,
  layers: (p) => [
    N({ dec: 0.012, peak: 1, f: [hp(3000)] }),
    R({ hz: 1180 * jit(p, 0.12), ratios: [1, 2.76, 5.4, 8.93], amps: [1, 0.55, 0.3, 0.18], decs: [0.7, 0.45, 0.3, 0.2], peak: 0.55 }),
    R({ hz: 620 * jit(p, 0.1), ratios: [1, 2.4], amps: [0.5, 0.3], decs: [0.5, 0.3], peak: 0.4 }),
    T({ hz: 150, to: 90, over: 0.04, dec: 0.07, peak: 0.5 }),
  ],
});

const reload = def({
  group: "weapon", peakDb: -10, ref: 6, max: 50, reverb: 0.1, prio: 1, cap: 2, gap: 0.08, jitter: 0.04,
  layers: (p) => [
    N({ dec: 0.012, peak: 0.9, f: [bp(2600, 3)] }),
    T({ type: "triangle", hz: 1800 * jit(p, 0.05), dec: 0.015, peak: 0.2 }),
    ...[0, 1, 2].map((i) => N({ at: 0.07 + i * 0.055, dec: 0.01, peak: 0.55, f: [bp(2200 + i * 300, 3)] })),
    N({ kind: "pink", at: 0.13, atk: 0.02, dec: 0.12, peak: 0.35, f: [bp(1300, 2, 2200, 0.15)] }),
    N({ at: 0.27, dec: 0.02, peak: 1, f: [bp(1800, 2)] }),
    T({ at: 0.27, hz: 700, to: 400, over: 0.02, dec: 0.04, peak: 0.5 }),
  ],
});

// ---- impacts ---------------------------------------------------------------------------------------------------------------------------

const flesh = def({
  group: "impact", peakDb: -5, ref: 10, max: 90, reverb: 0.2, prio: 2, cap: 5, gap: 0.02, jitter: 0.1,
  layers: (p) => [
    T({ hz: 120 * jit(p, 0.1), to: 55, over: 0.07, dec: 0.13, peak: 0.7 }),
    N({ dec: 0.05, peak: 1, f: [hp(200), lp(2200)] }),
    N({ kind: "pink", atk: 0.004, dec: 0.09, peak: 0.7, f: [bp(500, 1.2)] }),
    N({ at: 0.02, atk: 0.01, dec: 0.12, peak: 0.25, f: [bp(700, 4, 1400, 0.1)] }),
  ],
});

const wood = def({
  group: "impact", peakDb: -5.5, ref: 10, max: 90, reverb: 0.2, prio: 2, cap: 5, gap: 0.02, jitter: 0.12,
  layers: (p) => [
    T({ type: "triangle", hz: 300 * jit(p, 0.15), to: 170, over: 0.04, dec: 0.11, peak: 1 }),
    T({ hz: 620 * jit(p, 0.1), to: 420, over: 0.03, dec: 0.07, peak: 0.4 }),
    N({ dec: 0.02, peak: 0.6, f: [bp(1800, 2)] }),
    N({ kind: "pink", dec: 0.08, peak: 0.35, f: [bp(420, 5)] }),
    N({ at: 0.02, dec: 0.04, peak: 0.18, f: [hp(4000)] }),
  ],
});

const earth = def({
  group: "impact", peakDb: -6, ref: 10, max: 90, reverb: 0.15, prio: 2, cap: 5, gap: 0.02, jitter: 0.1,
  layers: (p) => [
    T({ hz: 95 * jit(p, 0.1), to: 48, over: 0.09, dec: 0.18, peak: 0.7 }),
    N({ kind: "brown", atk: 0.003, dec: 0.2, peak: 0.8, f: [lp(500)] }),
    N({ dec: 0.06, peak: 0.6, f: [hp(900), bp(1800, 0.8)] }),
    ...[0, 1, 2].map(() => N({ at: 0.03 + p.rng.next() * 0.15, dec: 0.02, peak: 0.15, f: [bp(3000 + p.rng.next() * 2000, 3)] })),
  ],
});

const iron = def({
  group: "impact", peakDb: -4, ref: 12, max: 110, reverb: 0.4, prio: 2, cap: 5, gap: 0.02, jitter: 0.03,
  layers: (p) => [
    N({ dec: 0.01, peak: 1, f: [hp(4000)] }),
    R({ hz: (1000 + p.rng.next() * 400) * jit(p, 0.04), ratios: [1, 2.32, 4.25, 6.63], amps: [1, 0.6, 0.32, 0.16], decs: [0.55, 0.35, 0.22, 0.14], peak: 0.6 }),
    T({ hz: 400, to: 300, over: 0.03, dec: 0.08, peak: 0.35 }),
    T({ hz: 3200, to: 1800, over: 0.2, atk: 0.002, dec: 0.22, peak: 0.12, vib: [22, 0.01] }),
  ],
});

// ---- movement --------------------------------------------------------------------------------------------------------------------------

const foot = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef => def({ group: "foot", ref: 3, max: 45, reverb: 0.05, prio: 0, cap: 4, gap: 0.12, variants: 4, jitter: 0.1, ...o });

const stepGrass = foot({
  peakDb: -16,
  layers: (p) => [
    N({ kind: "pink", atk: 0.012, dec: 0.1, peak: 1, f: [bp(1400 * jit(p, 0.15), 0.7), lp(3500)] }),
    N({ at: 0.01, atk: 0.01, dec: 0.07, peak: 0.12, f: [hp(3500), lp(8000)] }),
    T({ hz: 85, to: 55, over: 0.04, dec: 0.07, peak: 0.3 }),
  ],
});

const stepDirt = foot({
  peakDb: -15,
  layers: (p) => [
    N({ kind: "pink", atk: 0.006, dec: 0.08, peak: 1, f: [lp(1300 * jit(p, 0.15), undefined, undefined, 0.6)] }),
    N({ at: 0.005, dec: 0.05, peak: 0.35, f: [bp(2600, 1.2)] }),
    T({ hz: 100, to: 60, over: 0.04, dec: 0.09, peak: 0.3 }),
    ...[0, 1].map(() => N({ at: 0.02 + p.rng.next() * 0.08, dec: 0.012, peak: 0.18, f: [bp(3200 + p.rng.next() * 2000, 3)] })),
  ],
});

const stepStone = foot({
  peakDb: -14, reverb: 0.18,
  layers: (p) => [
    N({ dec: 0.012, peak: 1, f: [bp(2400 * jit(p, 0.12), 2)] }),
    T({ hz: 1100 * jit(p, 0.2), dec: 0.04, peak: 0.1 }),
    T({ hz: 130, to: 80, over: 0.03, dec: 0.06, peak: 0.25 }),
    N({ kind: "pink", at: 0.01, atk: 0.003, dec: 0.25, peak: 0.18, f: [bp(1800, 1.5)] }),
  ],
});

const stepWood = foot({
  peakDb: -14, reverb: 0.1,
  layers: (p) => {
    const out: Layer[] = [
      T({ type: "triangle", hz: 190 * jit(p, 0.1), to: 130, over: 0.05, dec: 0.11, peak: 0.5 }),
      T({ hz: 430 * jit(p, 0.1), to: 300, over: 0.04, dec: 0.07, peak: 0.55 }),
      N({ kind: "pink", dec: 0.09, peak: 0.7, f: [bp(520, 3)] }),
      N({ dec: 0.015, peak: 0.5, f: [bp(1500, 2)] }),
    ];
    if (p.rng.next() > 0.8) out.push(T({ type: "sawtooth", at: 0.03, hz: 190, to: 250, over: 0.16, atk: 0.03, dec: 0.16, peak: 0.12, f: [lp(700)] }));
    return out;
  },
});

const stepWater = foot({
  peakDb: -14, reverb: 0.2, ref: 4,
  layers: (p) => [
    N({ atk: 0.01, dec: 0.25, peak: 1, f: [bp(900, 0.9, 2500, 0.15)] }),
    ...[0, 1, 2].map(() => T({ at: 0.02 + p.rng.next() * 0.15, hz: 400 + p.rng.next() * 200, to: 900 + p.rng.next() * 300, over: 0.05, atk: 0.003, dec: 0.06, peak: 0.25 })),
    T({ hz: 90, to: 60, over: 0.05, dec: 0.1, peak: 0.5 }),
  ],
});

const jump = def({
  group: "body", peakDb: -14, ref: 4, max: 45, reverb: 0.05, prio: 1, cap: 3, gap: 0.1,
  layers: () => [
    N({ kind: "pink", atk: 0.03, dec: 0.12, peak: 0.6, f: [bp(800, 0.6, 1400, 0.1)] }),
    T({ hz: 110, to: 70, over: 0.05, dec: 0.1, peak: 0.3 }),
  ],
});

const land = def({
  group: "body", peakDb: -8, ref: 6, max: 60, reverb: 0.12, prio: 1, cap: 3, gap: 0.1,
  layers: (p) => [
    T({ hz: 90, to: 45, over: 0.08, dec: 0.18, peak: 0.6 }),
    N({ kind: "brown", atk: 0.003, dec: 0.18, peak: 0.8, f: [lp(600)] }),
    N({ kind: "pink", at: 0.01, dec: 0.1, peak: 0.5, f: [bp(900, 0.6)] }),
    R({ at: 0.02, hz: 2600 * jit(p, 0.1), ratios: [1, 1.7], amps: [0.08, 0.05], decs: [0.12, 0.09], peak: 1 }),
  ],
});

const pickup = def({
  group: "body", peakDb: -13, ref: 6, max: 50, reverb: 0.06, prio: 1, cap: 3, gap: 0.1,
  layers: () => [
    N({ kind: "pink", atk: 0.02, dec: 0.14, peak: 0.7, f: [bp(900, 0.8, 1500, 0.1)] }),
    T({ type: "triangle", hz: 640, to: 520, over: 0.02, dec: 0.05, peak: 0.3 }),
  ],
});

const drop = def({
  group: "body", peakDb: -9, ref: 8, max: 70, reverb: 0.12, prio: 1, cap: 3, gap: 0.1,
  layers: (p) => [
    T({ hz: 110 * jit(p, 0.1), to: 60, over: 0.06, dec: 0.12, peak: 0.5 }),
    N({ kind: "pink", dec: 0.12, peak: 0.7, f: [lp(1400)] }),
    N({ at: 0.012, dec: 0.025, peak: 0.6, f: [bp(1200, 2)] }),
  ],
});

const throwS = def({
  group: "body", peakDb: -10, ref: 6, max: 50, reverb: 0.06, prio: 1, cap: 3, gap: 0.1,
  layers: () => [
    N({ kind: "pink", atk: 0.05, dec: 0.16, peak: 1, f: [bp(400, 1.2, 1800, 0.18)] }),
    N({ atk: 0.02, dec: 0.1, peak: 0.25, f: [bp(1500, 0.7)] }),
  ],
});

// ---- people ----------------------------------------------------------------------------------------------------------------------------

/**
 * A voice for `seed` (the caricature's look hashed): pitch from a deep bass to a reedy tenor, and a vowel from a small set, so the same
 * expedition members sound like the same people every time. Twelve baked characters, chosen by seed.
 */
const VOWELS: readonly (readonly [number, number, number][])[] = [
  [[520, 9, 1], [920, 10, 0.7], [2500, 12, 0.25]], // "oh"
  [[640, 9, 1], [1190, 10, 0.6], [2400, 12, 0.25]], // "uh"
  [[700, 9, 1], [1220, 10, 0.5], [2600, 12, 0.2]], // "ah"
  [[400, 9, 1], [1900, 10, 0.5], [2600, 12, 0.3]], // "eh/ih" (a reedy yelp)
];
const hurt = def({
  group: "body", peakDb: -6, ref: 12, max: 90, reverb: 0.2, prio: 3, cap: 3, gap: 0.25, variants: 12, jitter: 0.05,
  layers: (p) => {
    const v = p.variant;
    const f0 = 88 + ((v * 37) % 12) * 9; // 88..187 Hz
    const scale = 0.92 + (((v * 7) % 5) / 4) * 0.2; // vocal-tract size
    const vowel = VOWELS[v % VOWELS.length]!.map(([f, q, g]) => [f * scale, q, g] as const);
    return [
      V({ hz: f0 * 1.35, to: f0 * 0.85, over: 0.26, formants: vowel, atk: 0.012, dec: 0.28, peak: 0.9, breath: 0.25 }),
      V({ at: 0.24, hz: f0 * 1.0, to: f0 * 0.7, over: 0.18, formants: vowel, atk: 0.02, dec: 0.16, peak: 0.45 }),
    ];
  },
});

const down = def({
  group: "body", peakDb: -7, ref: 12, max: 90, reverb: 0.22, prio: 3, cap: 3, gap: 0.3,
  layers: (p) => [
    T({ hz: 78, to: 38, over: 0.18, atk: 0.003, dec: 0.3, peak: 0.6 }),
    N({ kind: "brown", atk: 0.004, dec: 0.3, peak: 0.7, f: [lp(420)] }),
    N({ kind: "pink", at: 0.02, atk: 0.04, dec: 0.3, peak: 0.8, f: [bp(700, 0.5)] }),
    R({ at: 0.05, hz: 1900 * jit(p, 0.1), ratios: [1, 1.5, 2.2], amps: [0.1, 0.08, 0.06], decs: [0.15, 0.1, 0.08], peak: 1 }),
    N({ kind: "pink", at: 0.1, atk: 0.08, dec: 0.35, peak: 0.18, f: [bp(500, 0.6)] }),
  ],
});

const sever = def({
  group: "body", peakDb: -5, ref: 14, max: 100, reverb: 0.25, prio: 3, cap: 2, gap: 0.2, keys: ["full", "reduced", "off"], variants: 2,
  layers: (p) => {
    if (p.key === "off") {
      // Gore Off: a comic plink and boing, like a dropped xylophone. Still unmistakable, nothing wet.
      return [
        T({ hz: 1319, atk: 0.002, dec: 0.35, peak: 0.8 }),
        T({ hz: 2638, atk: 0.002, dec: 0.18, peak: 0.25 }),
        T({ at: 0.02, hz: 260, to: 620, over: 0.09, dec: 0.12, peak: 0.4 }),
        R({ hz: 1760, ratios: [1, 2.76], amps: [0.15, 0.08], decs: [0.4, 0.25], peak: 1 }),
      ];
    }
    const full = p.key === "full";
    const out: Layer[] = [
      N({ dec: 0.012, peak: 1, f: [bp(2300, 5)] }),
      T({ type: "triangle", hz: 320, to: 110, over: 0.035, dec: 0.06, peak: 0.7 }),
      N({ kind: "pink", atk: 0.01, dec: 0.28, peak: full ? 0.8 : 0.4, f: [bp(350, 3, 1100, 0.2)] }),
      T({ at: 0.06, hz: 100, to: 55, over: 0.1, dec: 0.15, peak: 0.6 }),
    ];
    if (full) for (let i = 0; i < 3; i++) out.push(T({ at: 0.05 + i * 0.06 + p.rng.next() * 0.03, hz: 180, to: 420, over: 0.05, atk: 0.005, dec: 0.08, peak: 0.25 }));
    return out;
  },
});

// ---- interface -------------------------------------------------------------------------------------------------------------------------

const ui = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef => def({ group: "ui", ui: true, reverb: 0, prio: 2, cap: 3, gap: 0.03, variants: 2, jitter: 0.02, ...o });

const uiClick = ui({
  peakDb: -18,
  layers: () => [
    N({ dec: 0.008, peak: 1, f: [bp(3200, 2)] }),
    T({ type: "triangle", hz: 1500, to: 900, over: 0.02, dec: 0.04, peak: 0.4 }),
    T({ hz: 200, to: 140, over: 0.02, dec: 0.03, peak: 0.35 }),
  ],
});
const uiHover = ui({
  peakDb: -28, gap: 0.05,
  layers: () => [N({ dec: 0.01, peak: 1, f: [bp(4200, 3)] }), T({ hz: 1900, dec: 0.02, peak: 0.15 })],
});
const uiConfirm = ui({
  peakDb: -12, reverb: 0.05,
  layers: () => [
    T({ hz: 130, to: 70, over: 0.06, dec: 0.14, peak: 1 }),
    N({ dec: 0.03, peak: 0.5, f: [lp(1500)] }),
    R({ at: 0.05, hz: 1760, ratios: [1, 2.01], amps: [0.35, 0.15], decs: [0.5, 0.25], peak: 1 }),
  ],
});
const uiError = ui({
  peakDb: -14,
  layers: () => [
    T({ type: "square", hz: 165, to: 140, over: 0.1, dec: 0.1, peak: 0.5, f: [lp(700)] }),
    T({ type: "square", at: 0.12, hz: 140, to: 120, over: 0.1, dec: 0.14, peak: 0.5, f: [lp(600)] }),
    T({ hz: 90, dec: 0.1, peak: 0.5 }),
  ],
});

const reviveHold = def({
  group: "body", peakDb: -14, ui: true, ref: 4, max: 40, reverb: 0.08, prio: 2, cap: 1, gap: 0, variants: 1, loop: 1.6, jitter: 0,
  layers: (p) => [
    // A heartbeat (two thumps, the second softer) twice per loop, under a bandage rustle. Everything ends well inside the loop period.
    ...[0, 0.8].flatMap((t) => [
      T({ at: t, hz: 62, to: 48, over: 0.06, atk: 0.004, dec: 0.16, peak: 0.6 }),
      T({ at: t, type: "triangle", hz: 130, to: 90, over: 0.05, atk: 0.004, dec: 0.1, peak: 0.5 }),
      T({ at: t + 0.16, hz: 58, to: 46, over: 0.06, atk: 0.004, dec: 0.14, peak: 0.4 }),
      T({ at: t + 0.16, type: "triangle", hz: 120, to: 85, over: 0.05, atk: 0.004, dec: 0.08, peak: 0.3 }),
    ]),
    ...[0.05, 0.31, 0.52, 0.86, 1.12, 1.3].map((t) => N({ kind: "pink", at: t + p.rng.next() * 0.04, atk: 0.03, dec: 0.12, peak: 0.28, f: [bp(1000, 0.9)] })),
  ],
});

const reviveDone = def({
  group: "body", peakDb: -8, ref: 8, max: 60, reverb: 0.3, prio: 3, cap: 1, gap: 0.5, variants: 1, jitter: 0,
  layers: () => [
    T({ hz: 523.25, atk: 0.004, dec: 0.9, peak: 0.6 }),
    T({ type: "triangle", hz: 1046.5, atk: 0.004, dec: 0.5, peak: 0.15 }),
    T({ at: 0.12, hz: 783.99, atk: 0.004, dec: 1.1, peak: 0.6 }),
    T({ at: 0.12, type: "triangle", hz: 1568, atk: 0.004, dec: 0.5, peak: 0.12 }),
    N({ kind: "pink", atk: 0.08, dec: 0.35, peak: 0.3, f: [bp(700, 0.5, 400, 0.3)] }),
    R({ at: 0.12, hz: 2093, ratios: [1, 1.5], amps: [0.1, 0.06], decs: [0.6, 0.4], peak: 1 }),
  ],
});

const notice = def({
  group: "ui", peakDb: -9, ui: true, reverb: 0.12, prio: 2, cap: 2, gap: 1.5, variants: 2, jitter: 0,
  layers: (p) => {
    // A brass counter bell struck twice, then the clatter of a telegraph key.
    const bell = (at: number): Layer => R({ at, hz: 2093, ratios: [1, 2.02, 2.98, 4.2], amps: [1, 0.5, 0.3, 0.15], decs: [0.9, 0.6, 0.4, 0.25], peak: 0.5 });
    const out: Layer[] = [bell(0), bell(0.28)];
    let t = 0.55;
    for (let i = 0; i < 7; i++) {
      out.push(N({ at: t, dec: 0.008, peak: 0.5, f: [bp(1400, 4)] }), T({ type: "square", at: t, hz: 1100, dec: 0.01, peak: 0.05, f: [lp(2000)] }));
      t += 0.05 + p.rng.next() * 0.07;
    }
    out.push(R({ at: t + 0.05, hz: 2637, ratios: [1, 2.01], amps: [0.4, 0.1], decs: [0.5, 0.3], peak: 0.5 }));
    return out;
  },
});

// ---- world ---------------------------------------------------------------------------------------------------------------------------

const thunder = def({
  group: "ambient", peakDb: -6, ui: true, reverb: 0.3, prio: 2, cap: 2, gap: 2, variants: 3, jitter: 0.05, duck: 0.25,
  layers: (p) => {
    const out: Layer[] = [
      N({ atk: 0.003, dec: 0.12, peak: 0.8, f: [hp(400), lp(4000, 800, 0.4)] }),
      N({ kind: "brown", at: 0.05, atk: 0.4, dec: 3.5, peak: 1, f: [lp(500, 120, 3.5)] }),
      T({ hz: 48, to: 30, over: 3, atk: 0.3, dec: 3, peak: 0.6 }),
    ];
    for (let i = 0; i < 3; i++) out.push(N({ kind: "brown", at: 0.6 + i * 0.85 + p.rng.next() * 0.3, atk: 0.08, dec: 1.4 - i * 0.3, peak: 0.7 - i * 0.15, f: [lp(420 - i * 80)] }));
    return out;
  },
});

const bird = def({
  group: "ambient", peakDb: -20, ref: 20, max: 130, reverb: 0.3, prio: 0, cap: 3, gap: 0.3, variants: 8, jitter: 0.06,
  layers: (p) => {
    const kind = p.variant % 3;
    const base = 2800 + p.rng.next() * 1500;
    if (kind === 0) {
      // "tweet-tweet-tweet": rising chirps with a bright overtone.
      return [0, 1, 2].flatMap((i) => [
        T({ at: i * 0.13, hz: base, to: base * 1.3, over: 0.07, atk: 0.006, dec: 0.06, peak: 0.5 }),
        T({ at: i * 0.13, hz: base * 2, to: base * 2.6, over: 0.07, atk: 0.006, dec: 0.05, peak: 0.1 }),
      ]);
    }
    if (kind === 1) {
      // A trill: seven quick alternating notes.
      return Array.from({ length: 7 }, (_, i) => T({ at: i * 0.05, hz: i % 2 ? base : base * 1.18, atk: 0.004, dec: 0.03, peak: 0.4 }));
    }
    // A woodpigeon's coo: low, breathy, two phrases.
    const low = 480 + p.rng.next() * 120;
    return [T({ hz: low, to: low * 0.83, over: 0.25, atk: 0.05, dec: 0.3, peak: 0.6 }), T({ at: 0.32, hz: low * 1.05, to: low * 0.8, over: 0.3, atk: 0.05, dec: 0.4, peak: 0.6 })];
  },
});

const firePop = def({
  group: "ambient", peakDb: -24, ref: 4, max: 42, reverb: 0.05, prio: 0, cap: 4, gap: 0.03, variants: 8, jitter: 0.1,
  layers: (p) => [
    N({ dec: 0.008 + p.rng.next() * 0.03, peak: 1, f: [bp(1800 + p.rng.next() * 3700, 1.5)] }),
    ...(p.rng.next() > 0.6 ? [T({ hz: 900, to: 400, over: 0.02, dec: 0.02, peak: 0.3 })] : []),
  ],
});
const fireSnap = def({
  group: "ambient", peakDb: -18, ref: 5, max: 48, reverb: 0.08, prio: 0, cap: 2, gap: 0.2, variants: 4, jitter: 0.08,
  layers: (p) => [
    N({ dec: 0.05, peak: 1, f: [bp(1200, 1)] }),
    T({ hz: 400, to: 120, over: 0.03, dec: 0.05, peak: 0.5 }),
    ...[0, 1, 2, 3].map(() => N({ at: 0.03 + p.rng.next() * 0.15, dec: 0.01, peak: 0.3, f: [bp(3500 + p.rng.next() * 2500, 3)] })),
  ],
});

/** All sound names: a plain object so `playSfx(name)` is one hash lookup. */
export const SOUNDS: Readonly<Record<string, SoundDef>> = {
  musket_shot: musket,
  pistol_shot: pistol,
  blunderbuss_shot: blunderbuss,
  cannon_shot: cannon,
  explosion,
  sabre_swing: sabreSwing,
  sabre_hit: sabreHit,
  reload_click: reload,
  impact_flesh: flesh,
  impact_wood: wood,
  impact_earth: earth,
  impact_iron: iron,
  footstep_grass: stepGrass,
  footstep_dirt: stepDirt,
  footstep_stone: stepStone,
  footstep_wood: stepWood,
  footstep_water: stepWater,
  jump,
  land,
  pickup,
  drop,
  throw: throwS,
  ui_click: uiClick,
  ui_hover: uiHover,
  ui_confirm: uiConfirm,
  ui_error: uiError,
  revive_hold: reviveHold,
  revive_done: reviveDone,
  hurt,
  down,
  limb_sever: sever,
  notice,
  telegram_bell: notice,
  thunder,
  bird,
  fire_pop: firePop,
  fire_snap: fireSnap,
};

export const SOUND_NAMES: readonly string[] = Object.keys(SOUNDS);

/** The names the combat agent is promised (see docs/_notes/audio-ui.md); a test keeps this list honest. */
export const REQUIRED_SOUNDS = [
  "musket_shot", "pistol_shot", "blunderbuss_shot", "cannon_shot", "sabre_swing", "sabre_hit", "reload_click",
  "impact_flesh", "impact_wood", "impact_earth", "impact_iron", "explosion",
  "footstep_grass", "footstep_dirt", "footstep_stone", "footstep_wood", "jump", "land", "pickup", "drop", "throw",
  "ui_click", "ui_hover", "ui_confirm", "ui_error", "revive_hold", "revive_done", "hurt", "down", "limb_sever", "notice", "telegram_bell",
] as const;
