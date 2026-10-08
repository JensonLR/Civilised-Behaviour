import { BABBLE_KEYS, type BabbleKey, type Rng } from "@cb/shared";
import { N, V, bp, type Layer } from "./dsp.ts";
import { def, type SoundParams } from "./soundKit.ts";

/**
 * D-087: the Society's voice, as pompous gibberish. A line of babble is a run of syllables, each a breath of consonant (a plosive tick, a hiss or a hum) and a vowel
 * in the same formant tract as the gun crew's shouts, sung on the intonation of what is being said: a BOAST rises to its stressed word and swoops down to a drawl,
 * an EXCLAMATION is short, high and falling, a QUESTION rises at the end, a MUTTER keeps low and breathy, a HARRUMPH is a harrumph. The vowels lean round and back
 * ("aw", "oh", "ah": no hurry, a club in Pall Mall). Four voices, each a different glottis and tract; the player's look picks the voice and nudges its pitch, so a
 * character always sounds like themselves. No recording, no model: rendered from these numbers when first spoken (bake.ts).
 */

type Tract = readonly (readonly [number, number, number])[];
const AH: Tract = [[700, 9, 1], [1220, 10, 0.5], [2600, 12, 0.2]];
const AW: Tract = [[570, 9, 1], [840, 10, 0.7], [2410, 12, 0.2]];
const OH: Tract = [[520, 9, 1], [920, 10, 0.7], [2500, 12, 0.25]];
const OO: Tract = [[320, 9, 1], [870, 10, 0.5], [2240, 12, 0.15]];
const ER: Tract = [[490, 9, 1], [1350, 10, 0.55], [1690, 12, 0.3]];
const EH: Tract = [[530, 9, 1], [1840, 10, 0.5], [2480, 12, 0.25]];
const IH: Tract = [[400, 9, 1], [1900, 10, 0.5], [2600, 12, 0.3]];
const NASAL: Tract = [[260, 8, 1], [1100, 8, 0.15], [2400, 10, 0.05]];
/** Round and back vowels lead, as a gentleman's do. */
const VOWELS: readonly Tract[] = [AW, AW, OH, OH, AH, AH, ER, EH, OO, IH];

/** The four voices: glottal pitch (Hz) and how the tract scales (a smaller tract, higher formants). */
export const BABBLE_VOICES: readonly { f0: number; k: number }[] = [
  { f0: 96, k: 0.94 },
  { f0: 114, k: 0.98 },
  { f0: 134, k: 1.04 },
  { f0: 198, k: 1.16 },
];

interface Shape {
  /** Syllables, inclusive range. */
  n: readonly [number, number];
  /** The pitch (times the voice's) of syllable i of n. */
  contour: (i: number, n: number) => number;
  /** Seconds per unstressed syllable, a range. */
  len: readonly [number, number];
  peak: number;
  breath: number;
  /** Which syllable carries the stress (longer, louder, a bigger glide). */
  stress: (n: number) => number;
}

const SHAPES: Readonly<Record<BabbleKey, Shape>> = {
  boast: {
    n: [5, 7],
    contour: (i, n) => (i === 1 ? 1.32 : i === n - 2 ? 1.12 : i === n - 1 ? 0.8 : 1.04 - (0.12 * i) / n),
    len: [0.085, 0.13], peak: 0.85, breath: 0.12, stress: () => 1,
  },
  exclaim: {
    n: [2, 3],
    contour: (i, n) => 1.6 - (0.45 * i) / Math.max(1, n - 1),
    len: [0.1, 0.15], peak: 1, breath: 0.1, stress: () => 0,
  },
  question: {
    n: [4, 5],
    contour: (i, n) => (i === n - 1 ? 1.4 : 1.0 - 0.04 * i),
    len: [0.08, 0.12], peak: 0.8, breath: 0.12, stress: (n) => n - 1,
  },
  mutter: {
    n: [4, 6],
    contour: (i) => 0.88 - 0.03 * (i % 2),
    len: [0.06, 0.09], peak: 0.55, breath: 0.35, stress: () => -1,
  },
  harrumph: {
    n: [2, 2],
    contour: (i) => (i === 0 ? 0.82 : 0.9),
    len: [0.12, 0.16], peak: 0.9, breath: 0.25, stress: () => 1,
  },
};

const scaled = (f: Tract, k: number): Tract => f.map(([hz, q, g]) => [hz * k, q, g] as const);
const between = (rng: Rng, [a, b]: readonly [number, number]): number => a + rng.next() * (b - a);

/** The layers of one line of babble in voice `voice` (deterministic in `rng`). */
export function babbleLayers(key: BabbleKey, voice: { f0: number; k: number }, rng: Rng): Layer[] {
  const s = SHAPES[key] ?? SHAPES.boast;
  const n = Math.round(between(rng, [s.n[0], s.n[1] + 0.49]));
  const stressed = s.stress(n);
  const out: Layer[] = [];
  let t = 0;
  if (key === "harrumph") {
    // the throat cleared first: a breathy "h" through the nose
    out.push(N({ atk: 0.02, dec: 0.08, peak: 0.35, f: [bp(1200 * voice.k, 0.9)] }));
    t = 0.09;
  }
  for (let i = 0; i < n; i++) {
    const stress = i === stressed;
    const last = i === n - 1;
    const len = between(rng, s.len) * (stress ? 1.6 : 1) * (last && key !== "exclaim" ? 1.45 : 1);
    // the consonant: a plosive tick, a hiss, a hum, or straight into the vowel
    const c = rng.next();
    if (c < 0.32) {
      out.push(N({ at: t, dec: 0.012, peak: 0.4, f: [bp(1600 + rng.next() * 2200, 1.4)] }));
      t += 0.022;
    } else if (c < 0.5) {
      out.push(N({ at: t, atk: 0.01, dec: 0.035, peak: 0.2, f: [bp(4600 + rng.next() * 1800, 2)] }));
      t += 0.045;
    } else if (c < 0.68) {
      out.push(V({ at: t, hz: voice.f0 * s.contour(i, n), to: voice.f0 * s.contour(i, n), over: 0.04, formants: scaled(NASAL, voice.k), atk: 0.008, dec: 0.025, peak: s.peak * 0.45 }));
      t += 0.04;
    }
    const p = voice.f0 * s.contour(i, n);
    const glide = stress ? 1.12 : key === "question" && last ? 1.18 : 0.97;
    // a harrumph ends in "mph": the second syllable is the nose's
    const tract = key === "harrumph" && last ? NASAL : VOWELS[Math.floor(rng.next() * VOWELS.length)]!;
    out.push(V({ at: t, hz: p, to: p * glide, over: len, formants: scaled(tract, voice.k), atk: 0.014, dec: len * 0.62, peak: s.peak * (stress ? 1 : 0.82), breath: s.breath }));
    t += len + 0.018 + (rng.next() < 0.15 ? 0.05 : 0); // (now and then a gentleman pauses for effect)
  }
  return out;
}

export const babble = def({
  group: "body", peakDb: -11, ref: 10, max: 55, reverb: 0.2, prio: 2, cap: 3, gap: 0.12, variants: BABBLE_VOICES.length, jitter: 0.03, duck: 0.06, keys: BABBLE_KEYS,
  layers: (p: SoundParams) => babbleLayers(p.key as BabbleKey, BABBLE_VOICES[p.variant % BABBLE_VOICES.length]!, p.rng),
});
