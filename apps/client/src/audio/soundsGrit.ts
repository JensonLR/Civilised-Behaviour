import { N, R, T, V, bp, hp, lp, type Layer } from "./dsp.ts";
import { def, jit, type SoundDef, type SoundParams } from "./soundKit.ts";

/**
 * THE GRIT PASS (D-038, package A): the sounds the jolly surface was missing. All synthesised from the same kit as sounds.ts (no samples), all captioned (captions.ts), none required for
 * readability (every one has a caption and a visual twin; the gore ones also have a dry version for Gore Off).
 *
 *  gore      heavy and light flesh, bone, a wet sever, blood on the ground, a body falling, a bad breath. Keys `full | reduced | off` (the Gore setting): full is wet, reduced is half as
 *            wet, off is dry and a little comic (a thump, a knock, a puff): the same event, no mess in the ears either.
 *  impacts   splinter (wood), chip (stone), ring (metal), splash (water).
 *  foley     cloth, gear, holster, draw, ramrod, powder, cock, shell; boots in mud and sand (the plank is the wooden step).
 *  tails     the long rumble and debris after an explosion or a cannon: `near`, `far`, `cannon`.
 *  ambience  the regions' own voices (mill, lamp chains, herd bells, a far horn, drips, timber, halyards, a wind-pump, frogs, surf, lapping, gusts): scheduled by ambienceRegion.ts.
 */

const GORE_KEYS = ["full", "reduced", "off"] as const;
/** How wet a gore key is: full 1, reduced 0.5, off 0 (every wet layer is scaled by it, so `off` has none). */
const wet = (key: string): number => (key === "full" ? 1 : key === "reduced" ? 0.5 : 0);

const gore = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef =>
  def({ group: "body", ref: 12, max: 90, reverb: 0.2, prio: 2, cap: 4, gap: 0.04, variants: 3, jitter: 0.08, keys: GORE_KEYS, ...o });

/** A blow that lands on a body: a thump with weight, a wet slap, a few droplets. `big` is the heavy blow. */
const fleshBlow = (p: SoundParams, big: boolean): Layer[] => {
  const w = wet(p.key);
  const s = big ? 1 : 0.6;
  const out: Layer[] = [
    T({ hz: (big ? 96 : 140) * jit(p, 0.1), to: big ? 42 : 80, over: big ? 0.1 : 0.07, atk: 0.002, dec: big ? 0.26 : 0.14, peak: 0.9 * s }),
    N({ kind: "brown", atk: 0.003, dec: big ? 0.3 : 0.16, peak: 0.9 * s, f: [lp(big ? 420 : 620)] }),
    N({ kind: "pink", atk: 0.002, dec: 0.07, peak: 0.6 * s, f: [bp(520, 1.1)] }),
  ];
  if (w === 0) {
    // Gore Off: a dull comic thump, a woody knock on top. Nothing wet.
    out.push(T({ type: "triangle", at: 0.004, hz: 230 * jit(p, 0.1), to: 150, over: 0.05, dec: 0.1, peak: 0.45 * s }));
    return out;
  }
  out.push(N({ kind: "pink", at: 0.012, atk: 0.02, dec: big ? 0.26 : 0.16, peak: 0.7 * w * s, f: [bp(1000, 0.9, 380, 0.2)] }));
  const drops = big ? 5 : 3;
  for (let i = 0; i < drops; i++) out.push(N({ at: 0.05 + p.rng.next() * 0.3, dec: 0.012, peak: 0.22 * w, f: [bp(1500 + p.rng.next() * 2200, 3)] }));
  return out;
};

const fleshHeavy = gore({ peakDb: -6, ref: 14, max: 100, prio: 3, layers: (p) => fleshBlow(p, true) });
const fleshLight = gore({ peakDb: -9, layers: (p) => fleshBlow(p, false) });

/** Bone: a hard crack, a hollow knock, a little crunch. */
const bone = gore({
  peakDb: -7, ref: 12, max: 95, prio: 3, cap: 3, gap: 0.08,
  layers: (p) => {
    const w = wet(p.key);
    const out: Layer[] = [
      N({ dec: 0.012, peak: 1, f: [hp(3000)] }),
      T({ type: "triangle", hz: 760 * jit(p, 0.1), to: 260, over: 0.025, atk: 0.001, dec: 0.06, peak: 0.7 }),
      R({ hz: 880 * jit(p, 0.08), ratios: [1, 2.3, 3.9], amps: [1, 0.45, 0.2], decs: [0.16, 0.1, 0.06], peak: 0.4 }),
      T({ at: 0.02, hz: 110, to: 60, over: 0.06, dec: 0.1, peak: 0.5 }),
    ];
    if (w > 0) for (let i = 0; i < 3; i++) out.push(N({ at: 0.03 + i * 0.045 + p.rng.next() * 0.02, dec: 0.02, peak: 0.4 * w, f: [bp(1700 + p.rng.next() * 600, 2.5)] }));
    return out;
  },
});

/** A wet sever: the slice, the slurp, the heavy part landing. Played with `limb_sever`, which keeps its own comic Off. */
const severWet = gore({
  peakDb: -8, ref: 14, max: 100, prio: 3, cap: 2, gap: 0.2, variants: 2,
  layers: (p) => {
    const w = wet(p.key);
    if (w === 0) {
      // Gore Off: a rubbery boing and a hollow tock.
      return [T({ hz: 220, to: 520, over: 0.1, atk: 0.003, dec: 0.2, peak: 0.6 }), T({ type: "triangle", at: 0.12, hz: 180, to: 110, over: 0.05, dec: 0.1, peak: 0.5 }), N({ dec: 0.01, peak: 0.3, f: [bp(1600, 3)] })];
    }
    const out: Layer[] = [
      N({ atk: 0.004, dec: 0.1, peak: 1, f: [bp(2600, 1.2, 900, 0.1)] }),
      N({ kind: "pink", at: 0.02, atk: 0.03, dec: 0.32, peak: 0.8 * w, f: [bp(380, 1.4, 1300, 0.25)] }),
      T({ at: 0.09, hz: 90, to: 46, over: 0.12, atk: 0.003, dec: 0.2, peak: 0.7 }),
      N({ kind: "brown", at: 0.1, atk: 0.005, dec: 0.2, peak: 0.6, f: [lp(480)] }),
    ];
    for (let i = 0; i < 4; i++) out.push(N({ at: 0.22 + i * 0.07 + p.rng.next() * 0.04, dec: 0.014, peak: 0.28 * w, f: [bp(1000 + p.rng.next() * 1400, 3)] }));
    return out;
  },
});

/** Blood on the ground: a splat, then drops. Off: a soft pat, like a bag of flour. */
const bloodGround = gore({
  peakDb: -13, ref: 6, max: 40, prio: 1, cap: 3, gap: 0.1,
  layers: (p) => {
    const w = wet(p.key);
    if (w === 0) return [N({ kind: "brown", atk: 0.004, dec: 0.12, peak: 0.9, f: [lp(320)] }), T({ hz: 95, to: 62, over: 0.05, dec: 0.09, peak: 0.5 })];
    const out: Layer[] = [
      N({ kind: "pink", atk: 0.004, dec: 0.2, peak: 0.9 * w, f: [bp(650, 1, 280, 0.2)] }),
      N({ kind: "brown", atk: 0.002, dec: 0.12, peak: 0.5, f: [lp(420)] }),
    ];
    const drops = w >= 1 ? 7 : 4;
    for (let i = 0; i < drops; i++) out.push(T({ at: 0.06 + i * 0.07 + p.rng.next() * 0.05, hz: 1500 + p.rng.next() * 1000, to: 700, over: 0.02, atk: 0.001, dec: 0.025, peak: 0.28 * w }));
    return out;
  },
});

/** A body going down: the weight, the gear, a limp second thud as it settles. Not gory in itself, so one version. */
const bodyFall = def({
  group: "body", peakDb: -8, ref: 14, max: 90, reverb: 0.22, prio: 3, cap: 3, gap: 0.2, variants: 3, jitter: 0.07,
  layers: (p) => [
    T({ hz: 74 * jit(p, 0.1), to: 36, over: 0.13, atk: 0.003, dec: 0.32, peak: 0.9 }),
    N({ kind: "brown", atk: 0.004, dec: 0.38, peak: 0.9, f: [lp(380)] }),
    N({ kind: "pink", at: 0.01, atk: 0.03, dec: 0.26, peak: 0.45, f: [bp(900, 0.6)] }),
    ...[0, 1, 2].map((i) => R({ at: 0.05 + i * 0.07 + p.rng.next() * 0.03, hz: 2400 + p.rng.next() * 1400, ratios: [1, 2.76, 5.4], amps: [1, 0.35, 0.12], decs: [0.14, 0.08, 0.05], peak: 0.06 })),
    N({ kind: "pink", at: 0.02, atk: 0.01, dec: 0.28, peak: 0.55, f: [lp(700)] }),
    T({ at: 0.24, hz: 60, to: 40, over: 0.08, dec: 0.14, peak: 0.4 }),
    N({ kind: "brown", at: 0.24, atk: 0.003, dec: 0.15, peak: 0.4, f: [lp(300)] }),
  ],
});

/** A bad breath: the rattle of someone who is not going to get up. Full: a wet rasp; reduced: just the breath; off: a comic wheeze and a deflating whistle. */
const badBreath = gore({
  peakDb: -13, ref: 8, max: 45, prio: 2, cap: 2, gap: 1, variants: 4, jitter: 0.04,
  layers: (p) => {
    const f0 = 64 + p.variant * 7;
    if (p.key === "off") {
      return [N({ kind: "pink", atk: 0.03, dec: 0.18, peak: 0.6, f: [bp(800, 0.8)] }), T({ hz: 640, to: 280, over: 0.28, atk: 0.02, dec: 0.3, peak: 0.35, vib: [5, 0.03] })];
    }
    const rasp = p.key === "full" ? 1 : 0;
    const out: Layer[] = [
      V({ hz: f0 * 1.15, to: f0 * 0.8, over: 0.5, formants: [[480, 6, 1], [1300, 6, 0.45], [2400, 8, 0.2]], atk: 0.07, dec: 0.6, peak: 0.45, breath: 1.4 }),
      N({ kind: "pink", atk: 0.12, dec: 0.5, peak: 0.45, f: [bp(900, 0.9, 500, 0.5)] }),
      V({ at: 0.75, hz: f0, to: f0 * 0.7, over: 0.45, formants: [[420, 6, 1], [1100, 6, 0.4], [2300, 8, 0.2]], atk: 0.09, dec: 0.5, peak: 0.3, breath: 1.2 }),
    ];
    if (rasp > 0) for (let i = 0; i < 6; i++) out.push(N({ at: 0.1 + i * 0.11 + p.rng.next() * 0.04, dec: 0.02, peak: 0.28, f: [bp(1500 + p.rng.next() * 900, 3)] }));
    return out;
  },
});

// ---- impacts ---------------------------------------------------------------------------------------------------------------------------------------------

const impact = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef => def({ group: "impact", ref: 10, max: 90, reverb: 0.2, prio: 2, cap: 5, gap: 0.02, jitter: 0.1, ...o });

/** Wood splitting: a crack and a spray of splinters. */
const splinter = impact({
  peakDb: -6,
  layers: (p) => [
    T({ type: "triangle", hz: 520 * jit(p, 0.15), to: 230, over: 0.03, atk: 0.001, dec: 0.08, peak: 1 }),
    N({ dec: 0.03, peak: 0.7, f: [hp(2500)] }),
    N({ kind: "pink", dec: 0.09, peak: 0.4, f: [bp(600, 4)] }),
    ...[0, 1, 2, 3, 4].map((i) => N({ at: 0.02 + i * 0.025 + p.rng.next() * 0.02, dec: 0.012 + p.rng.next() * 0.01, peak: 0.3, f: [bp(3500 + p.rng.next() * 3500, 3)] })),
  ],
});

/** A chip of stone or masonry: a hard tick, a bright little ring, grit. */
const chip = impact({
  peakDb: -8,
  layers: (p) => [
    N({ dec: 0.012, peak: 1, f: [hp(4500)] }),
    R({ hz: 2600 * jit(p, 0.1), ratios: [1, 2.76, 5.4], amps: [1, 0.55, 0.25], decs: [0.1, 0.06, 0.04], peak: 0.4 }),
    T({ hz: 230, to: 140, over: 0.03, dec: 0.05, peak: 0.45 }),
    ...[0, 1, 2, 3].map(() => N({ at: 0.02 + p.rng.next() * 0.16, dec: 0.01, peak: 0.25, f: [bp(3000 + p.rng.next() * 3000, 3)] })),
  ],
});

/** Metal struck and left ringing: a pan, a helmet, a lamp. */
const ring = impact({
  peakDb: -5, ref: 14, max: 120, reverb: 0.4, cap: 3, jitter: 0.03,
  layers: (p) => [
    N({ dec: 0.01, peak: 1, f: [hp(3500)] }),
    R({ hz: (700 + p.rng.next() * 260) * jit(p, 0.03), ratios: [1, 2.0, 2.7, 4.1, 5.9], amps: [1, 0.6, 0.45, 0.3, 0.15], decs: [1.3, 0.95, 0.7, 0.45, 0.28], peak: 0.6 }),
    T({ hz: 380, to: 290, over: 0.03, dec: 0.07, peak: 0.3 }),
  ],
});

/** Something dropping or being struck in water: a slap, bubbles, a rush. */
const splash = impact({
  peakDb: -9, reverb: 0.25,
  layers: (p) => [
    N({ kind: "pink", atk: 0.006, dec: 0.32, peak: 1, f: [bp(1100, 0.7, 480, 0.25)] }),
    N({ dec: 0.05, peak: 0.35, f: [hp(3500)] }),
    T({ hz: 90, to: 52, over: 0.07, dec: 0.13, peak: 0.5 }),
    ...[0, 1, 2, 3].map((i) => T({ at: 0.04 + i * 0.05 + p.rng.next() * 0.04, hz: 400 + p.rng.next() * 200, to: 950 + p.rng.next() * 300, over: 0.05, atk: 0.003, dec: 0.06, peak: 0.22 })),
  ],
});

// ---- foley -----------------------------------------------------------------------------------------------------------------------------------------------

const foley = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef => def({ group: "body", ref: 4, max: 32, reverb: 0.08, prio: 0, cap: 3, gap: 0.08, variants: 4, jitter: 0.07, ...o });

const cloth = foley({
  peakDb: -22,
  layers: (p) => [
    N({ kind: "pink", atk: 0.05, dec: 0.2, peak: 0.8, f: [bp(1500 * jit(p, 0.15), 0.6, 900, 0.2)] }),
    N({ at: 0.03, atk: 0.04, dec: 0.1, peak: 0.12, f: [hp(4000)] }),
  ],
});

const gear = foley({
  peakDb: -20, cap: 2, gap: 0.15,
  layers: (p) => [
    N({ kind: "pink", atk: 0.01, dec: 0.09, peak: 0.5, f: [bp(700, 1)] }),
    ...[0, 1, 2].map((i) => R({ at: i * 0.04 + p.rng.next() * 0.03, hz: 2400 + p.rng.next() * 1200, ratios: [1, 2.76, 5.4], amps: [1, 0.4, 0.15], decs: [0.12, 0.07, 0.04], peak: 0.4 })),
    N({ kind: "pink", at: 0.05, atk: 0.03, dec: 0.18, peak: 0.28, f: [bp(300, 1.2, 900, 0.15)] }), // the canteen's slosh
  ],
});

const holster = foley({
  peakDb: -17, cap: 2,
  layers: (p) => [
    N({ kind: "pink", atk: 0.05, dec: 0.12, peak: 0.6, f: [bp(500 * jit(p, 0.1), 1, 1100, 0.12)] }),
    T({ at: 0.13, hz: 150, to: 90, over: 0.04, dec: 0.07, peak: 0.6 }),
    N({ at: 0.13, dec: 0.012, peak: 0.7, f: [bp(1800, 3)] }),
    N({ kind: "brown", at: 0.13, atk: 0.003, dec: 0.08, peak: 0.4, f: [lp(500)] }),
  ],
});

const draw = foley({
  peakDb: -15, cap: 2,
  layers: (p) => [
    N({ kind: "pink", atk: 0.02, dec: 0.07, peak: 0.5, f: [bp(700, 1)] }),
    N({ at: 0.03, atk: 0.09, dec: 0.2, peak: 0.55, f: [hp(1800, 4500, 0.2, 1.4)] }),
    R({ at: 0.17, hz: 2200 * jit(p, 0.05), ratios: [1, 2.4, 3.1], amps: [0.4, 0.2, 0.1], decs: [0.3, 0.18, 0.1], peak: 0.35 }),
  ],
});

const ramrod = foley({
  peakDb: -15, cap: 1, gap: 0.3, variants: 3,
  layers: (p) => [
    ...[0, 0.32].map((at) => N({ at, kind: "pink", atk: 0.02, dec: 0.28, peak: 0.6, f: [bp(900 * jit(p, 0.1), 3, 1400, 0.25)] })),
    T({ at: 0.62, hz: 1200, to: 800, over: 0.02, dec: 0.03, peak: 0.4 }),
    R({ at: 0.62, hz: 1500, ratios: [1, 2.3], amps: [0.4, 0.2], decs: [0.16, 0.1], peak: 0.4 }),
    N({ at: 0.62, dec: 0.015, peak: 0.6, f: [bp(2200, 2)] }),
  ],
});

const powder = foley({
  peakDb: -20, cap: 1, gap: 0.4, variants: 3,
  layers: (p) => [
    N({ atk: 0.03, dec: 0.4, peak: 0.45, f: [hp(3000), lp(9000)] }),
    ...Array.from({ length: 12 }, () => N({ at: p.rng.next() * 0.38, dec: 0.006, peak: 0.3, f: [bp(4000 + p.rng.next() * 3000, 4)] })),
    N({ at: 0.46, dec: 0.012, peak: 0.55, f: [bp(1500, 3)] }),
    T({ at: 0.46, hz: 600, to: 420, over: 0.02, dec: 0.04, peak: 0.25 }),
  ],
});

const cock = foley({
  peakDb: -13, cap: 2, gap: 0.12,
  layers: (p) => [
    N({ dec: 0.01, peak: 0.7, f: [bp(2200, 4)] }),
    R({ hz: 1500 * jit(p, 0.05), ratios: [1, 2.2], amps: [0.4, 0.2], decs: [0.06, 0.04], peak: 0.45 }),
    N({ at: 0.09, dec: 0.01, peak: 0.8, f: [bp(2600, 4)] }),
    R({ at: 0.09, hz: 1750, ratios: [1, 2.2], amps: [0.4, 0.2], decs: [0.06, 0.04], peak: 0.4 }),
    N({ at: 0.17, dec: 0.02, peak: 1, f: [bp(1400, 2)] }),
    T({ at: 0.17, hz: 400, to: 250, over: 0.03, dec: 0.05, peak: 0.45 }),
  ],
});

const shell = foley({
  peakDb: -17, cap: 3, gap: 0.1,
  layers: (p) => [
    R({ hz: 3200 * jit(p, 0.06), ratios: [1, 1.6, 2.5, 3.8], amps: [1, 0.5, 0.3, 0.15], decs: [0.35, 0.2, 0.15, 0.08], peak: 0.5 }),
    R({ at: 0.13, hz: 3300 * jit(p, 0.06), ratios: [1, 1.6, 2.5], amps: [1, 0.5, 0.3], decs: [0.25, 0.14, 0.08], peak: 0.3 }),
    R({ at: 0.21, hz: 3150 * jit(p, 0.06), ratios: [1, 1.6], amps: [1, 0.5], decs: [0.18, 0.1], peak: 0.18 }),
    N({ dec: 0.008, peak: 0.4, f: [hp(4000)] }),
  ],
});

const foot = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef => def({ group: "foot", ref: 3, max: 45, reverb: 0.05, prio: 0, cap: 4, gap: 0.12, variants: 4, jitter: 0.1, ...o });

/** A boot in mud: the thud, the suck as it comes up, a small plop. */
const stepMud = foot({
  peakDb: -15,
  layers: (p) => [
    N({ kind: "brown", atk: 0.008, dec: 0.13, peak: 1, f: [lp(900 * jit(p, 0.15), 300, 0.15)] }),
    N({ kind: "pink", at: 0.05, atk: 0.04, dec: 0.15, peak: 0.45, f: [bp(500, 1.2, 950, 0.15)] }),
    T({ at: 0.09, hz: 250, to: 520, over: 0.05, atk: 0.004, dec: 0.05, peak: 0.28 }),
    T({ hz: 90, to: 55, over: 0.05, dec: 0.1, peak: 0.35 }),
  ],
});

/** A boot in dry sand: a soft crunch and a long hush. */
const stepSand = foot({
  peakDb: -17,
  layers: (p) => [
    N({ kind: "pink", atk: 0.02, dec: 0.15, peak: 1, f: [hp(1200), lp(5000 * jit(p, 0.15))] }),
    N({ at: 0.01, atk: 0.02, dec: 0.07, peak: 0.2, f: [hp(3500)] }),
    T({ hz: 80, to: 55, over: 0.05, dec: 0.06, peak: 0.15 }),
  ],
});

// ---- tails -----------------------------------------------------------------------------------------------------------------------------------------------

/** What comes after the bang: `near` is debris pattering and a crackle over a rumble, `far` is the low roll a long way off with its echo, `cannon` is the hill giving the shot back. */
const tail = def({
  group: "weapon", peakDb: -8, ref: 60, max: 600, reverb: 0.8, prio: 2, cap: 2, gap: 0.3, variants: 2, jitter: 0.03, keys: ["near", "far", "cannon"],
  layers: (p) => {
    if (p.key === "far") {
      return [
        N({ kind: "brown", atk: 0.3, dec: 3.2, peak: 1, f: [lp(260, 110, 2)] }),
        T({ hz: 42, to: 28, over: 2.5, atk: 0.4, dec: 3, peak: 0.5 }),
        N({ kind: "pink", at: 0.9, atk: 0.15, dec: 1.5, peak: 0.35, f: [lp(520, 200, 1.2)] }),
      ];
    }
    if (p.key === "cannon") {
      return [
        N({ kind: "brown", atk: 0.12, dec: 2.2, peak: 1, f: [lp(340, 120, 1.4)] }),
        N({ kind: "pink", at: 0.35, atk: 0.08, dec: 1.4, peak: 0.45, f: [bp(380, 0.6)] }),
        N({ kind: "pink", at: 0.8, atk: 0.1, dec: 1.2, peak: 0.25, f: [lp(600, 220, 1)] }),
        T({ hz: 58, to: 34, over: 1.5, atk: 0.1, dec: 2, peak: 0.45 }),
      ];
    }
    const out: Layer[] = [
      N({ kind: "brown", atk: 0.05, dec: 1.8, peak: 0.9, f: [lp(420, 160, 1.2)] }),
      N({ kind: "pink", at: 0.1, atk: 0.1, dec: 1.0, peak: 0.3, f: [lp(900)] }),
    ];
    for (let i = 0; i < 16; i++) out.push(N({ at: 0.15 + i * 0.1 + p.rng.next() * 0.07, dec: 0.03 + p.rng.next() * 0.07, peak: 0.34 * (1 - i / 20), f: [bp(700 + p.rng.next() * 3200, 1.5)] }));
    for (let i = 0; i < 6; i++) out.push(N({ at: 0.4 + p.rng.next() * 1.2, dec: 0.012, peak: 0.2, f: [bp(3000 + p.rng.next() * 3000, 3)] })); // crackle
    return out;
  },
});

// ---- the regions' own ambience (scheduled by ambienceRegion.ts) --------------------------------------------------------------------------------------------

const amb = (o: Partial<SoundDef> & Pick<SoundDef, "layers" | "peakDb">): SoundDef => def({ group: "ambient", ref: 20, max: 140, reverb: 0.3, prio: 0, cap: 2, gap: 0.5, variants: 2, jitter: 0.05, ...o });

/** The mill wheel turning: timbers working, paddles dropping into the race. */
const mill = amb({
  peakDb: -19, ref: 18, max: 110, gap: 1,
  layers: (p) => [
    N({ kind: "brown", atk: 0.3, dec: 1.5, peak: 0.5, f: [lp(420)] }),
    T({ at: 0.1, type: "sawtooth", hz: 90, to: 112, over: 0.8, atk: 0.2, dec: 0.9, peak: 0.3, f: [lp(420, 320, 0.8, 1.5)], vib: [5, 0.05] }),
    ...[0.2, 0.8, 1.4].map((at) => T({ at: at + p.rng.next() * 0.04, hz: 210, to: 120, over: 0.08, atk: 0.003, dec: 0.12, peak: 0.55 })),
    ...[0.2, 0.8, 1.4].map((at) => N({ at, kind: "pink", dec: 0.1, peak: 0.4, f: [bp(900, 2)] })),
  ],
});

/** Nine lamps ringing softly on their chains: links clinking, a small bell. */
const lampChain = amb({
  peakDb: -20, ref: 22, max: 120, reverb: 0.4, gap: 1.5,
  layers: (p) => [
    N({ kind: "pink", at: 0.05, atk: 0.1, dec: 0.4, peak: 0.2, f: [bp(1800, 1.5)] }),
    ...Array.from({ length: 7 }, (_, i) => R({ at: i * 0.07 + p.rng.next() * 0.05, hz: 2000 + p.rng.next() * 1500, ratios: [1, 2.76, 5.4], amps: [1, 0.4, 0.15], decs: [0.18, 0.1, 0.06], peak: 0.3 })),
    R({ at: 0.12, hz: 880 * jit(p, 0.03), ratios: [1, 2.0, 2.76, 4.2], amps: [1, 0.5, 0.35, 0.15], decs: [1.5, 1.0, 0.7, 0.4], peak: 0.45 }),
  ],
});

/** Herd bells: wooden clonks, a few, uneven. */
const herdBell = amb({
  peakDb: -19, ref: 26, max: 150, gap: 1.5,
  layers: (p) => {
    const base = 410 + p.rng.next() * 90;
    return [0, 0.19, 0.47, 0.71].flatMap((at, i) => [
      T({ at: at + p.rng.next() * 0.03, type: "triangle", hz: base * (1 + i * 0.03), to: base * 0.93, over: 0.04, atk: 0.001, dec: 0.13, peak: 0.5 }),
      R({ at, hz: base * 1.55, ratios: [1, 2.5, 4.1], amps: [1, 0.4, 0.2], decs: [0.28, 0.16, 0.1], peak: 0.28 }),
    ]);
  },
});

/** A horn a long way off, sounded once and held: a call across the grass. */
const farHorn = amb({
  peakDb: -17, ref: 90, max: 700, reverb: 0.7, gap: 8, variants: 2, jitter: 0.02,
  layers: (p) => {
    const f = 118 * jit(p, 0.04);
    return [
      T({ type: "sawtooth", hz: f, atk: 0.8, dec: 1.7, peak: 0.6, f: [lp(600, 1000, 0.8, 1.2)], vib: [4.5, 0.006] }),
      T({ type: "sawtooth", hz: f * 1.5, atk: 0.9, dec: 1.4, peak: 0.25, f: [lp(700, 1100, 0.8)] }),
      N({ kind: "pink", atk: 0.7, dec: 1.4, peak: 0.12, f: [bp(450, 1.2)] }),
      T({ at: 2.0, type: "sawtooth", hz: f * 0.84, atk: 0.4, dec: 1.2, peak: 0.45, f: [lp(560, 400, 1)] }),
    ];
  },
});

/** A drip in a cave or a gorge: the drop and its echo. */
const drip = amb({
  peakDb: -22, ref: 10, max: 60, reverb: 0.55, gap: 0.8, variants: 4, jitter: 0.08,
  layers: (p) => {
    const f = 1500 + p.rng.next() * 500;
    return [
      T({ hz: f, to: f * 0.56, over: 0.025, atk: 0.001, dec: 0.09, peak: 1 }),
      R({ at: 0.01, hz: f * 1.2, ratios: [1, 2.1], amps: [0.2, 0.08], decs: [0.5, 0.3], peak: 0.4 }),
      T({ at: 0.36, hz: f * 0.9, to: f * 0.5, over: 0.025, atk: 0.001, dec: 0.08, peak: 0.28 }),
    ];
  },
});

/** A timber groaning under load: the mine props, the gorge's old scaffolds. */
const timberCreak = amb({
  peakDb: -20, ref: 14, max: 90, reverb: 0.35, gap: 3,
  layers: (p) => [
    T({ type: "sawtooth", hz: 74 * jit(p, 0.1), to: 56, over: 1.2, atk: 0.3, dec: 1.4, peak: 0.5, f: [lp(280, 190, 1.2, 4)], vib: [3, 0.08] }),
    T({ type: "sawtooth", at: 0.5, hz: 128 * jit(p, 0.1), to: 94, over: 0.8, atk: 0.2, dec: 0.8, peak: 0.35, f: [bp(320, 6)], vib: [6, 0.05] }),
    N({ kind: "pink", at: 0.1, atk: 0.4, dec: 0.8, peak: 0.2, f: [bp(520, 3)] }),
  ],
});

/** Halyards slapping a mast in a breeze: uneven clinks and a wooden knock. */
const halyard = amb({
  peakDb: -20, ref: 14, max: 100, gap: 2,
  layers: (p) => {
    const out: Layer[] = [];
    let at = 0;
    const n = 4 + (p.variant % 3);
    for (let i = 0; i < n; i++) {
      out.push(R({ at, hz: 1900 + p.rng.next() * 700, ratios: [1, 2.2], amps: [1, 0.35], decs: [0.14, 0.07], peak: 0.4 }), N({ at, dec: 0.01, peak: 0.4, f: [bp(3500, 3)] }), T({ at, hz: 300, to: 220, over: 0.03, dec: 0.05, peak: 0.25 }));
      at += 0.12 + p.rng.next() * 0.28;
    }
    return out;
  },
});

/** A wind-pump working: a squeak, a clank, the slurp of water, three strokes. */
const windPump = amb({
  peakDb: -19, ref: 16, max: 110, gap: 3, variants: 2,
  layers: (p) =>
    [0, 0.9, 1.8].flatMap((at) => [
      T({ at, type: "sawtooth", hz: 700 * jit(p, 0.05), to: 920, over: 0.25, atk: 0.02, dec: 0.3, peak: 0.3, f: [bp(820, 8)] }),
      R({ at: at + 0.27, hz: 420, ratios: [1, 2.7], amps: [1, 0.4], decs: [0.4, 0.2], peak: 0.5 }),
      N({ at: at + 0.3, kind: "pink", atk: 0.02, dec: 0.18, peak: 0.28, f: [bp(900, 0.7)] }),
    ]),
});

/** A frog, then another: short rattling croaks. */
const frog = amb({
  peakDb: -21, ref: 16, max: 100, gap: 1, variants: 6, jitter: 0.1,
  layers: (p) => {
    const f = 150 + p.rng.next() * 90;
    const out: Layer[] = [];
    const n = 2 + (p.variant % 3);
    for (let i = 0; i < n; i++) out.push(T({ at: i * 0.13, type: "sawtooth", hz: f, to: f * 0.72, over: 0.08, atk: 0.01, dec: 0.1, peak: 0.6, f: [bp(620, 3)], vib: [30, 0.12] }));
    return out;
  },
});

/** A wave coming up a shingle shore and drawing back. */
const surf = amb({
  peakDb: -19, ref: 40, max: 260, reverb: 0.4, gap: 3, variants: 2, jitter: 0.04,
  layers: () => [
    N({ kind: "pink", atk: 1.2, dec: 2.2, peak: 1, f: [bp(300, 0.5, 1000, 1.4)] }),
    N({ at: 0.8, atk: 1.6, dec: 1.8, peak: 0.07, f: [hp(1800), lp(6000)] }),
    N({ kind: "brown", atk: 0.8, dec: 2.2, peak: 0.5, f: [lp(230)] }),
  ],
});

/** Water lapping at a hull or a bank: two or three small slaps. */
const lap = amb({
  peakDb: -22, ref: 10, max: 70, gap: 1.2, variants: 4, jitter: 0.08,
  layers: (p) => [
    ...[0, 0.5, 1.05].map((at) => N({ at: at + p.rng.next() * 0.08, kind: "pink", atk: 0.2, dec: 0.5, peak: 0.5, f: [bp(500, 1.2, 900, 0.3)] })),
    ...[0, 1, 2].map((i) => T({ at: 0.2 + i * 0.4 + p.rng.next() * 0.1, hz: 300, to: 520, over: 0.04, atk: 0.002, dec: 0.05, peak: 0.2 })),
  ],
});

/** A gust: `grass` (a long hiss through seed-heads on the high plain) or `canyon` (a hollow moan between walls). */
const gust = amb({
  peakDb: -19, ref: 30, max: 160, gap: 4, variants: 2, keys: ["grass", "canyon"],
  layers: (p) => {
    if (p.key === "canyon") {
      return [
        N({ kind: "pink", atk: 1.0, dec: 2.2, peak: 0.8, f: [bp(340 * jit(p, 0.1), 3, 240, 2)] }),
        T({ hz: 190, to: 150, over: 2.5, atk: 1.0, dec: 2.2, peak: 0.25, vib: [0.3, 0.02] }),
        N({ at: 0.3, atk: 1.2, dec: 1.4, peak: 0.12, f: [bp(900, 4)] }),
      ];
    }
    return [
      N({ kind: "pink", atk: 0.9, dec: 1.7, peak: 0.6, f: [bp(520, 0.7, 900, 1.6)] }),
      N({ atk: 1.0, dec: 1.3, peak: 0.06, f: [hp(2500), lp(5500)] }),
    ];
  },
});

export const GRIT_SOUNDS: Readonly<Record<string, SoundDef>> = {
  gore_flesh_heavy: fleshHeavy,
  gore_flesh_light: fleshLight,
  gore_bone: bone,
  gore_sever_wet: severWet,
  gore_blood_ground: bloodGround,
  gore_body_fall: bodyFall,
  gore_bad_breath: badBreath,
  impact_splinter: splinter,
  impact_chip: chip,
  impact_ring: ring,
  impact_splash: splash,
  foley_cloth: cloth,
  foley_gear: gear,
  foley_holster: holster,
  foley_draw: draw,
  foley_ramrod: ramrod,
  foley_powder: powder,
  foley_cock: cock,
  foley_shell: shell,
  footstep_mud: stepMud,
  footstep_sand: stepSand,
  explosion_tail: tail,
  amb_mill: mill,
  amb_lamp_chain: lampChain,
  amb_herd_bell: herdBell,
  amb_far_horn: farHorn,
  amb_drip: drip,
  amb_timber_creak: timberCreak,
  amb_halyard: halyard,
  amb_wind_pump: windPump,
  amb_frog: frog,
  amb_surf: surf,
  amb_lap: lap,
  amb_gust: gust,
};

/** Every name this file adds, by family (a test renders and measures each). */
export const GORE_SOUNDS = ["gore_flesh_heavy", "gore_flesh_light", "gore_bone", "gore_sever_wet", "gore_blood_ground", "gore_body_fall", "gore_bad_breath"] as const;
export const IMPACT_SOUNDS = ["impact_splinter", "impact_chip", "impact_ring", "impact_splash"] as const;
export const FOLEY_SOUNDS = ["foley_cloth", "foley_gear", "foley_holster", "foley_draw", "foley_ramrod", "foley_powder", "foley_cock", "foley_shell", "footstep_mud", "footstep_sand"] as const;
export const TAIL_SOUNDS = ["explosion_tail"] as const;
export const REGION_AMBIENT_SOUNDS = ["amb_mill", "amb_lamp_chain", "amb_herd_bell", "amb_far_horn", "amb_drip", "amb_timber_creak", "amb_halyard", "amb_wind_pump", "amb_frog", "amb_surf", "amb_lap", "amb_gust"] as const;
export const GRIT_SOUND_NAMES: readonly string[] = [...GORE_SOUNDS, ...IMPACT_SOUNDS, ...FOLEY_SOUNDS, ...TAIL_SOUNDS, ...REGION_AMBIENT_SOUNDS];
