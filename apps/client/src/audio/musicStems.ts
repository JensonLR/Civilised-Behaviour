import { Rng, hash3, type RegionId } from "@cb/shared";
import { N, R, T, bp, lp, type Layer } from "./dsp.ts";
import { MUSIC_LAYERS, REGION_COLOUR, type MusicLayerId } from "./musicLayers.ts";
import { MODES, beatSeconds, chordDegrees, scaleMidi, type MusicVoice, type Note } from "./musicScore.ts";

/**
 * THE LAYERED SCORE (D-038, docs/_notes/polish2.md section 6). The jolly game bed (musicScore.ts + music.ts) never stops; these are the other six stems that `musicLayers.ts` fades in and out.
 * Every stem is a PURE function `stemBar(id, ...)` returning the `Layer`s (dsp.ts: noise bursts, swept tones, rings) of ONE bar, with `at` in seconds from the bar's start, on the same clock
 * (56 bpm, 4/4), the same key (C) and the same chord changes (`chordDegrees`) as the bed, so any mix is in tune and in time. The player (music.ts) renders them with `renderLayers`; the tests
 * render the very same layers offline (offlineRender.ts) and measure them: nothing here touches Web Audio.
 *
 * The comic rule: the bed is major and bright; the stems answer it in the minor, with drums and a dissonant drone, so a fight sounds like the march turned nasty, not like a different game.
 */

export const MUSIC_SEED = 0xc0ffee;
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const INFO = MODES.game;
export const BEAT = beatSeconds("game");
export const BAR = BEAT * INFO.beats;
export const PHRASE_BARS = INFO.bars;

const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  "minor-pentatonic": [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

/** MIDI of index `i` of `scale` over `root` (negative indices fall below the root). */
function stepMidi(root: number, i: number, scale: readonly number[]): number {
  const n = scale.length;
  const oct = Math.floor(i / n);
  return root + oct * 12 + scale[((i % n) + n) % n]!;
}

/** Level of each stem, calibrated offline (stems.test.ts) so the mood mixes sit in their RMS bands. */
export const STEM_TRIM: Readonly<Record<MusicLayerId, number>> = { bed: 1, pulse: 0.55, dread: 0.5, drive: 0.55, stabs: 1.1, dirge: 0.34, colour: 0.5 };

/** Most notes (oscillators and noise sources) any one stem may have sounding at once, and all stems together: the player's budget (stems.test.ts counts them). */
export const STEM_VOICE_CAP: Readonly<Record<MusicLayerId, number>> = { bed: 36, pulse: 10, dread: 20, drive: 12, stabs: 10, dirge: 22, colour: 18 };
export const MUSIC_VOICE_CAP = 110;

const scaled = (ls: Layer[], k: number): Layer[] => {
  for (const l of ls) l.peak *= k;
  return ls;
};

const rngFor = (seed: number, phrase: number, bar: number, id: number): Rng => new Rng(hash3(seed, phrase * 8 + bar, 0x57e0 + id));

// ---- the bed, as layers (the offline stand-in for music.ts `playNote`; the live bed still plays through `playNote`) -------------------------------------------------

export interface Inst {
  partials: readonly (readonly [number, number])[];
  dec: number;
  atk: number;
  type?: OscillatorType;
  hammer?: number;
  detune?: number;
  lp?: number;
}
/** The game bed's instruments (kept in step with music.ts INST.game by a test). */
export const BED_INST: Partial<Record<MusicVoice, Inst>> = {
  melody: { partials: [[1, 1], [2.76, 0.07], [5.4, 0.03]], dec: 2.2, atk: 0.01, detune: 3 },
  bass: { partials: [[1, 1], [2, 0.2]], dec: 2.6, atk: 0.35, lp: 500 },
  pad: { partials: [[1, 1]], dec: 3.5, atk: 1.2, type: "triangle", detune: 9, lp: 1000 },
  arp: { partials: [[1, 1], [2, 0.25]], dec: 1.0, atk: 0.004, type: "triangle", hammer: 0.12 },
};
export const BED_GAIN: Record<MusicVoice, number> = { melody: 0.5, bass: 0.55, chord: 0.5, arp: 0.5, pad: 0.4 };

/** One bed note as layers: the same partials, envelope and level as `playNote` in game mode (detune copies and the low-pass included; a pure-JS stand-in for measurement). */
export function bedLayers(n: Note, at: number): Layer[] {
  const inst = BED_INST[n.voice];
  if (!inst) return [];
  const f = hz(n.midi);
  const dec = inst.dec * Math.min(2.2, Math.max(0.5, Math.sqrt(261.6 / f)));
  const peak = 1.0 * n.vel * BED_GAIN[n.voice];
  const copies = inst.detune ? 2 : 1;
  const out: Layer[] = [];
  for (let c = 0; c < copies; c++) {
    for (const [ratio, amp] of inst.partials) {
      if (f * ratio > 9000) continue;
      out.push(T({ at, hz: f * ratio * (c === 1 ? 2 ** ((inst.detune ?? 0) / 1200) : 1), type: ratio === 1 ? (inst.type ?? "sine") : "sine", atk: inst.atk, dec, peak: (peak * amp) / copies, f: inst.lp ? [lp(inst.lp)] : undefined }));
    }
  }
  if (inst.hammer) out.push(N({ at, kind: "pink", atk: 0.001, dec: 0.05, peak: peak * inst.hammer, f: [lp(Math.min(4000, f * 5))] }));
  return out;
}

// ---- the stems --------------------------------------------------------------------------------------------------------------------------------------------------

/** pulse: a muted ticking ostinato on the eighths and a heartbeat (lub, dub) once a bar. Tension. */
function pulse(rng: Rng, degree: number, bar: number): Layer[] {
  const out: Layer[] = [];
  for (let s = 0; s < 8; s++) {
    if (s % 4 === 3 && rng.next() < 0.5) continue; // a held breath now and then
    const acc = s % 2 === 0 ? 1 : 0.55;
    out.push(N({ at: s * 0.5 * BEAT, atk: 0.001, dec: 0.035, peak: 0.5 * acc, f: [bp(1900 + (s % 4) * 160, 5)] }));
    out.push(T({ at: s * 0.5 * BEAT, type: "triangle", hz: s % 2 === 0 ? 880 : 740, atk: 0.001, dec: 0.03, peak: 0.12 * acc }));
  }
  const lub = (bar % 2) * 0.25; // the beat drifts a little between bars so it never sounds mechanical
  out.push(T({ at: lub, hz: 60, to: 44, over: 0.07, atk: 0.004, dec: 0.28, peak: 0.9 }), T({ at: lub + 0.42, hz: 54, to: 42, over: 0.07, atk: 0.004, dec: 0.22, peak: 0.55 }));
  out.push(T({ at: lub, type: "triangle", hz: 124, to: 88, over: 0.05, atk: 0.003, dec: 0.1, peak: 0.25 }));
  void degree;
  return out;
}

/** dread: a low bowed drone, a close dissonance swelling against it (beating), and a rumble. Under tension and combat. */
function dread(rng: Rng, degree: number, bar: number): Layer[] {
  const root = hz(scaleMidi(INFO.root, degree - 14));
  const out: Layer[] = [
    T({ type: "sawtooth", hz: root, atk: 1.3, dec: 5.2, peak: 0.34, f: [lp(430, 300, 3.5, 1.4)], vib: [0.22, 0.004] }),
    T({ type: "sawtooth", hz: root * 1.0595, atk: 2.2, dec: 4.4, peak: 0.2, f: [lp(380, 280, 3, 1.2)], vib: [0.17, 0.005] }), // a minor second above: the close dissonance
    N({ kind: "brown", atk: 1.0, dec: 3.6, peak: 0.34, f: [lp(190)] }),
  ];
  if (bar % 2 === 1) out.push(T({ type: "sawtooth", hz: root * 1.4142, at: BEAT * 2, atk: 1.2, dec: 3.2, peak: 0.1, f: [lp(520)] })); // the tritone leans in on alternate bars
  if (rng.next() < 0.5) out.push(T({ type: "sine", hz: root * 4.02, at: BEAT, atk: 0.9, dec: 2.2, peak: 0.07, vib: [4.4, 0.02] })); // a thin whine high up
  return out;
}

/** drive: war drums on the beat, a roll into the phrase turn, and a driving bass on the eighths. Combat. */
function drive(rng: Rng, degree: number, bar: number): Layer[] {
  const out: Layer[] = [];
  for (let b = 0; b < INFO.beats; b++) {
    const strong = b % 2 === 0;
    const at = b * BEAT;
    out.push(T({ at, hz: strong ? 118 : 150, to: strong ? 50 : 66, over: 0.12, atk: 0.002, dec: strong ? 0.5 : 0.32, peak: strong ? 0.85 : 0.5 }));
    out.push(N({ at, kind: "brown", atk: 0.003, dec: 0.22, peak: strong ? 0.55 : 0.35, f: [lp(520)] }));
    out.push(N({ at, kind: "pink", atk: 0.001, dec: 0.045, peak: 0.34, f: [bp(1500, 1.2)] }));
  }
  if (bar % 4 === 3) {
    for (let k = 0; k < 6; k++) {
      const at = BEAT * 3 + BEAT * 0.5 + k * BEAT * 0.0833; // a sixteenth-triplet roll into the next bar
      out.push(T({ at, hz: 130, to: 80, over: 0.06, atk: 0.002, dec: 0.12, peak: 0.35 + k * 0.08 }));
    }
  }
  const bass = hz(scaleMidi(INFO.root, degree - 14) + 12);
  const grid = bar % 2 === 0 ? [1, 0.5, 0.7, 0.5, 1, 0.5, 0.7, 0.5] : [1, 0.5, 0.5, 0.8, 1, 0.5, 0.8, 0.6];
  for (let s = 0; s < 8; s++) {
    const m = rng.next() < 0.1 ? 0 : 1;
    if (!m) continue;
    out.push(T({ at: s * 0.5 * BEAT, type: "sawtooth", hz: bass * (s === 7 ? 1.5 : 1), atk: 0.004, dec: 0.26, peak: 0.3 * grid[s]!, f: [lp(360, 240, 0.2, 1)] }));
  }
  return out;
}

/** stabs: a minor chord stabbed by reeds and brass, one a bar (and a short echo on alternate bars). Combat accents. */
function stabs(rng: Rng, degree: number, bar: number): Layer[] {
  const base = scaleMidi(INFO.root, degree - 7);
  const tones = [0, 3, 7]; // the bed's major chord turned minor
  const out: Layer[] = [];
  const stab = (at: number, vel: number, dec: number): void => {
    for (const t of tones) {
      out.push(T({ at, type: "sawtooth", hz: hz(base + t), atk: 0.018, dec, peak: 0.16 * vel, f: [lp(1900, 700, 0.35, 0.9)] }));
    }
    out.push(T({ at, type: "square", hz: hz(base + 12), atk: 0.02, dec: dec * 0.8, peak: 0.07 * vel, f: [lp(1400, 600, 0.3)] }));
    out.push(N({ at, kind: "pink", atk: 0.01, dec: 0.12, peak: 0.12 * vel, f: [bp(2400, 1)] }));
  };
  stab(BEAT * 2, 1, 0.6);
  if (bar % 2 === 1) stab(BEAT * 3.5, 0.6, 0.3);
  if (rng.next() < 0.3) stab(BEAT * 0.5, 0.5, 0.25);
  return out;
}

/** dirge: a slow minor pad and a lone slow line that steps down. Aftermath. */
function dirge(rng: Rng, degree: number, bar: number): Layer[] {
  const base = scaleMidi(INFO.root, degree - 7);
  const out: Layer[] = [];
  for (const t of [0, 3, 7]) out.push(T({ type: "triangle", hz: hz(base + t), atk: 1.5, dec: 5, peak: 0.2, f: [lp(650)] }));
  out.push(T({ type: "sine", hz: hz(base - 12), atk: 1.4, dec: 5.5, peak: 0.2 }));
  // the lone line: natural minor on the tonic of the bar, two notes, falling by steps over the phrase
  const top = 7 - (bar % 4);
  for (let k = 0; k < 2; k++) {
    const idx = Math.max(-1, top - k * (1 + (rng.next() < 0.4 ? 1 : 0)));
    const f = hz(stepMidi(INFO.root, idx, MINOR));
    const at = k * BEAT * 2 + (k === 1 ? 0.15 : 0);
    out.push(T({ at, type: "triangle", hz: f, atk: 0.3, dec: 2.4, peak: 0.34, f: [lp(1100)], vib: [4.6, 0.012] }));
    out.push(T({ at, type: "sine", hz: f * 2, atk: 0.3, dec: 1.4, peak: 0.05 }));
  }
  return out;
}

// ---- the region colour ------------------------------------------------------------------------------------------------------------------------------------------

const TINE = { ratios: [1, 2.76, 5.4], amps: [1, 0.25, 0.08] };
const CHIME = { ratios: [1, 2.32, 4.25, 6.63], amps: [1, 0.6, 0.32, 0.16] };
const BELL = { ratios: [1, 2.0, 3.0, 4.2], amps: [1, 0.5, 0.3, 0.15] };

/** The scale index a chord degree starts from, and the offsets a colour line may pick from, for a scale of `n` notes. */
const baseIndex = (degree: number, n: number): number => Math.round((degree * n) / 7);
const OFFSETS = (n: number): readonly number[] => (n === 5 ? [0, 1, 2, 3, 4] : [0, 2, 4, 1, 3]);

type Colour = (rng: Rng, note: (k: number, octave?: number) => number, bar: number) => Layer[];

/** Each region's own instrument pair; `note(k, oct)` is the Hz of the k-th pick of the bar's scale (octave offset in 12-semitone steps). */
const COLOUR: Record<RegionId, Colour> = {
  // the depot's parlour: a music box and a bright fiddle
  hollowmere: (rng, note, bar) => {
    const out: Layer[] = [];
    for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) {
      if (rng.next() < 0.55) continue;
      out.push(R({ at: s * 0.5 * BEAT, hz: note(Math.floor(rng.next() * 5), 1), ratios: TINE.ratios, amps: TINE.amps, decs: [1.1, 0.5, 0.3], peak: 0.3 }));
    }
    if (bar % 2 === 0) out.push(T({ at: BEAT * 0.5, type: "sawtooth", hz: note(2, 0), atk: 0.14, dec: 1.5, peak: 0.16, f: [lp(2300, 1500, 1), bp(1500, 0.6)], vib: [5.5, 0.012] }));
    return out;
  },
  // a thin reed pipe and the nine lamps ringing on their chains
  kessar: (rng, note, bar) => {
    const out: Layer[] = [];
    const a = note(1, 0);
    out.push(T({ at: 0, type: "square", hz: a, atk: 0.08, dec: 1.3, peak: 0.1, f: [lp(1500, 1100, 1), bp(1100, 0.7)], vib: [5, 0.01] }), N({ at: 0, kind: "pink", atk: 0.08, dec: 0.9, peak: 0.07, f: [bp(1900, 2)] }));
    if (bar % 2 === 1) out.push(T({ at: BEAT * 2, type: "square", hz: note(3, 0), atk: 0.08, dec: 1.0, peak: 0.09, f: [lp(1400), bp(1100, 0.7)], vib: [5.2, 0.01] }));
    for (let k = 0; k < 3; k++) out.push(R({ at: BEAT * (0.5 + k * 1.3) + rng.next() * 0.2, hz: note(k * 2 + 1, 2), ratios: BELL.ratios, amps: BELL.amps, decs: [1.6, 1.0, 0.6, 0.4], peak: 0.2 }));
    return out;
  },
  // a plucked lyre over wooden herd-bells
  highmark: (rng, note, bar) => {
    const out: Layer[] = [];
    const order = [0, 1, 2, 3, 2, 1, 4, 2];
    for (let s = 0; s < 6; s++) {
      if (rng.next() < 0.25) continue;
      out.push(R({ at: s * 0.667 * BEAT * 0.75, hz: note(order[(s + bar) % 8]!, 0), ratios: [1, 2, 3, 4], amps: [1, 0.4, 0.2, 0.1], decs: [0.9, 0.5, 0.3, 0.2], peak: 0.3 }));
    }
    for (const at of bar % 2 === 0 ? [BEAT * 0.5, BEAT * 2.25] : [BEAT * 1.5]) {
      out.push(T({ at, type: "triangle", hz: 392, to: 370, over: 0.04, atk: 0.001, dec: 0.12, peak: 0.28 }), R({ at, hz: 659.25, ratios: [1, 2.5, 4.1], amps: [1, 0.4, 0.2], decs: [0.3, 0.16, 0.1], peak: 0.2 }));
    }
    return out;
  },
  // a bowed saw and copper chimes, funerary and dry
  vesper: (rng, note, bar) => {
    const out: Layer[] = [];
    out.push(T({ at: BEAT * (bar % 2 ? 1 : 0), type: "sawtooth", hz: note(bar % 5, -1), atk: 0.7, dec: 3.6, peak: 0.16, f: [lp(1500, 1000, 2, 1), bp(900, 0.5)], vib: [4.8, 0.02] }));
    for (let k = 0; k < (bar % 2 === 0 ? 2 : 1); k++) out.push(R({ at: BEAT * (1.5 + k * 1.7) + rng.next() * 0.2, hz: note(k + 2, 2), ratios: CHIME.ratios, amps: CHIME.amps, decs: [1.2, 0.8, 0.5, 0.3], peak: 0.2 }));
    return out;
  },
  // a wheezing reed organ and blown bottles: the tide-tally's waltz
  saltmarket: (rng, note, bar) => {
    const out: Layer[] = [];
    for (const [b, k] of [[0, 0], [1.5, 2], [2.5, 1]] as const) {
      if (b > 0 && rng.next() < 0.3) continue;
      const f = note(k, 0);
      out.push(
        T({ at: b * BEAT, type: "sawtooth", hz: f, atk: 0.09, dec: 1.0, peak: 0.1, f: [lp(1300, 900, 1), bp(900, 0.5)] }),
        T({ at: b * BEAT, type: "sawtooth", hz: f * 1.006, atk: 0.09, dec: 1.0, peak: 0.1, f: [lp(1300, 900, 1), bp(900, 0.5)] }),
      );
    }
    for (let k = 0; k < (bar % 2 ? 2 : 1); k++) {
      const f = note(k + 1, 1);
      const at = BEAT * (1 + k * 1.5);
      out.push(T({ at, type: "sine", hz: f, atk: 0.06, dec: 0.6, peak: 0.2 }), N({ at, kind: "pink", atk: 0.05, dec: 0.5, peak: 0.1, f: [bp(f, 9)] }));
    }
    return out;
  },
};

function colour(region: RegionId, seed: number, phrase: number, bar: number, degree: number): Layer[] {
  const scale = SCALES[REGION_COLOUR[region].scale];
  const n = scale.length;
  const offs = OFFSETS(n);
  const rng = rngFor(seed, phrase, bar, 7 + REGION_ORDER.indexOf(region));
  const bi = baseIndex(degree, n);
  const note = (k: number, octave = 0): number => hz(stepMidi(INFO.root + 12 * octave, bi + offs[((k % offs.length) + offs.length) % offs.length]!, scale));
  return COLOUR[region](rng, note, bar);
}
const REGION_ORDER: readonly RegionId[] = ["hollowmere", "kessar", "highmark", "vesper", "saltmarket"];

// ---- the public face --------------------------------------------------------------------------------------------------------------------------------------------

const MAKERS: Record<Exclude<MusicLayerId, "bed" | "colour">, (rng: Rng, degree: number, bar: number) => Layer[]> = { pulse, dread, drive, stabs, dirge };

/** The layers of stem `id` for bar `bar` (0..7) of phrase `phrase`, `at` in seconds from the bar's start. `bed` is the notes of `generatePhrase` (see `bedBarLayers`). Pure and deterministic. */
export function stemBar(id: Exclude<MusicLayerId, "bed">, region: RegionId, phrase: number, bar: number, seed = MUSIC_SEED): Layer[] {
  const degree = chordDegrees("game", seed, phrase)[bar % PHRASE_BARS]!;
  const layers = id === "colour" ? colour(region, seed, phrase, bar, degree) : MAKERS[id](rngFor(seed, phrase, bar, MUSIC_LAYERS.indexOf(id)), degree, bar);
  return scaled(layers, STEM_TRIM[id]);
}

/** The bed's bar as layers (for the offline measurement; the player uses `playNote`). */
export function bedBarLayers(notes: readonly Note[]): Layer[] {
  const out: Layer[] = [];
  for (const n of notes) out.push(...bedLayers(n, n.beat * BEAT));
  return out;
}

/** How many notes sound at once in `layers` (every oscillator or noise source counts), by sweeping their audible spans: the player's voice budget. */
export function peakVoices(layers: readonly { at: number; end: number; voices: number }[]): number {
  const ev: [number, number][] = [];
  for (const l of layers) ev.push([l.at, l.voices], [l.end, -l.voices]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 0;
  for (const [, d] of ev) {
    cur += d;
    if (cur > best) best = cur;
  }
  return best;
}

/** One layer's span and how many sources it costs in the graph (a ring is one oscillator per partial; a vibrato adds a second). */
export function layerSpan(l: Layer): { at: number; end: number; voices: number } {
  const at = l.at ?? 0;
  if (l.k === "r") return { at, end: at + Math.max(...l.decs) * 1.5, voices: l.ratios.length };
  const end = at + (l.atk ?? (l.k === "v" ? 0.01 : 0)) + l.dec * 1.5;
  return { at, end, voices: l.k === "t" && l.vib ? 2 : 1 };
}
