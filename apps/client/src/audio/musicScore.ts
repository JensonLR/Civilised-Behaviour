import { Rng, hash3 } from "@cb/shared";

/**
 * The generative score, as pure functions: a fixed diatonic scale, a handful of hand-picked eight-bar chord progressions and a seeded melody
 * that repeats its rhythm from the first half of a phrase in the second (so it sounds composed, not random). Nothing here touches Web Audio;
 * `music.ts` plays what this returns. `menu` is a parlour waltz in F major (oom-pah-pah with a music-box tune on top); `game` is a calm 4/4 in
 * C major (a slow pad, a harp-like arpeggio, and the occasional long note). Same seed, same phrase number: same music, on every machine.
 */

export type MusicMode = "menu" | "game";
export type MusicVoice = "melody" | "bass" | "chord" | "arp" | "pad";

export interface Note {
  /** Beats from the start of the bar. */
  beat: number;
  midi: number;
  /** Length in beats. */
  dur: number;
  /** 0..1 loudness. */
  vel: number;
  voice: MusicVoice;
}

export interface ModeInfo {
  bpm: number;
  /** Beats per bar. */
  beats: number;
  /** MIDI note of the tonic in the octave above middle C's neighbourhood. */
  root: number;
  bars: number;
}

export const MODES: Readonly<Record<MusicMode, ModeInfo>> = {
  menu: { bpm: 104, beats: 3, root: 65, bars: 8 }, // F4
  game: { bpm: 56, beats: 4, root: 60, bars: 8 }, // C4
};

export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

/** MIDI note of scale index `i` (0 = tonic; 7 = tonic an octave up; negative indices go below). */
export function scaleMidi(root: number, i: number): number {
  const oct = Math.floor(i / 7);
  return root + oct * 12 + MAJOR[((i % 7) + 7) % 7]!;
}

/** True if `midi` is a note of the major scale on `root`. */
export const inScale = (root: number, midi: number): boolean => MAJOR.includes((((midi - root) % 12) + 12) % 12 as never);

/** Chord roots as scale degrees (0 = I), one per bar. */
const PROGRESSIONS: Record<MusicMode, readonly (readonly number[])[]> = {
  menu: [
    [0, 0, 3, 0, 4, 4, 0, 0],
    [0, 5, 3, 4, 0, 5, 4, 0],
    [0, 3, 0, 4, 0, 3, 4, 0],
    [0, 0, 5, 5, 3, 4, 0, 0],
  ],
  game: [
    [0, 5, 3, 4, 0, 5, 3, 4],
    [0, 3, 0, 4, 5, 3, 4, 0],
    [0, 4, 5, 3, 0, 4, 3, 4],
    [5, 3, 0, 4, 5, 3, 4, 0],
  ],
};

/** Rhythm cells for one bar of 3/4 (durations in beats, each summing to 3). */
const CELLS_3: readonly (readonly number[])[] = [[1, 1, 1], [1.5, 0.5, 1], [2, 1], [1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1], [1, 2]];
/** ... and 4/4 (sum 4). Used sparsely by the calm melody. */
const CELLS_4: readonly (readonly number[])[] = [[4], [2, 2], [3, 1], [2, 1, 1], [1.5, 2.5]];

const LOW = -1; // lowest melody scale index relative to the tonic (an octave-ish window)
const HIGH = 7;

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)]!;

/** Nearest chord tone (root/third/fifth of the triad on `degree`, in any octave) to scale index `near`. */
function nearestChordTone(degree: number, near: number): number {
  let best = degree;
  let bestD = Infinity;
  for (let oct = -1; oct <= 2; oct++) {
    for (const off of [0, 2, 4]) {
      const idx = degree + off + oct * 7;
      const d = Math.abs(idx - near);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
  }
  return best;
}

/** The chord root (scale degree, 0 = I) of each bar of phrase `phrase`: what `generatePhrase` plays, so the layered stems (musicStems.ts) sit on the same changes. */
export function chordDegrees(mode: MusicMode, seed: number, phrase: number): readonly number[] {
  const variant = phrase % 4 === 3 ? 0 : phrase;
  return PROGRESSIONS[mode][hash3(seed, variant >> 1, 11) % PROGRESSIONS[mode].length]!;
}

/**
 * One eight-bar phrase: an array of bars, each an array of notes. `phrase` counts phrases since the music began; every fourth phrase repeats
 * the first so the ear can hold on to something.
 */
export function generatePhrase(mode: MusicMode, seed: number, phrase: number): Note[][] {
  const info = MODES[mode];
  const variant = phrase % 4 === 3 ? 0 : phrase; // the tune comes home
  const prog = chordDegrees(mode, seed, phrase);
  const rng = new Rng(hash3(seed, variant, 7));
  const bars: Note[][] = [];
  const cells = info.beats === 3 ? CELLS_3 : CELLS_4;
  // The rhythm of bars 0-3 comes back in bars 4-6 (bar 7 is the cadence).
  const rhythm: (readonly number[])[] = [];
  for (let b = 0; b < 4; b++) rhythm.push(pick(rng, cells));
  let prev = 2; // scale index of the last melody note
  for (let bar = 0; bar < info.bars; bar++) {
    const degree = prog[bar]!;
    const notes: Note[] = [];
    const root = info.root;
    const chordIdx = [degree, degree + 2, degree + 4];
    if (mode === "menu") {
      // Oom-pah-pah: the bass on 1 (root, or the fifth on alternate bars), the chord on 2 and 3.
      notes.push({ beat: 0, midi: scaleMidi(root, chordIdx[bar % 2 ? 2 : 0]! - 14), dur: 1, vel: 0.62, voice: "bass" });
      for (const beat of [1, 2]) for (const ci of chordIdx) notes.push({ beat, midi: scaleMidi(root, ci - 7), dur: 0.9, vel: 0.28, voice: "chord" });
    } else {
      notes.push({ beat: 0, midi: scaleMidi(root, degree - 14), dur: 4, vel: 0.5, voice: "bass" });
      for (const ci of chordIdx) notes.push({ beat: 0, midi: scaleMidi(root, ci - 7), dur: 4, vel: 0.22, voice: "pad" });
      // A harp-like arpeggio in eighths that skips some steps.
      const order = [0, 1, 2, 1];
      for (let s = 0; s < 8; s++) {
        if (rng.next() < 0.22) continue;
        notes.push({ beat: s * 0.5, midi: scaleMidi(root, chordIdx[order[s % 4]!]!), dur: 1.5, vel: 0.2 + 0.08 * (s % 2 === 0 ? 1 : 0), voice: "arp" });
      }
    }
    // Melody
    const cell = bar < 4 ? rhythm[bar]! : bar < 7 ? rhythm[bar - 4]! : mode === "menu" ? [1, 2] : [4];
    let t = 0;
    let idx = prev;
    const sparse = mode === "game";
    for (let n = 0; n < cell.length; n++) {
      const dur = cell[n]!;
      const strong = t === 0 || (info.beats === 3 && t === 1.5) || t === 2;
      const rest = sparse && n > 0 && rng.next() < 0.45;
      if (!rest) {
        const r = rng.next();
        idx = r < 0.68 ? idx + (rng.next() < 0.5 ? -1 : 1) : r < 0.88 ? idx + (rng.next() < 0.5 ? -2 : 2) : idx;
        if (strong) idx = nearestChordTone(degree, idx);
        if (bar === info.bars - 1 && n === cell.length - 1) idx = 0 + (idx > 4 ? 7 : 0); // land on the tonic
        idx = Math.max(LOW, Math.min(HIGH, idx));
        notes.push({ beat: t, midi: scaleMidi(root + 12, idx), dur: dur * 0.95, vel: sparse ? 0.42 : 0.55, voice: "melody" });
      }
      t += dur;
    }
    prev = idx;
    bars.push(notes);
  }
  return bars;
}

/** Seconds per beat. */
export const beatSeconds = (mode: MusicMode): number => 60 / MODES[mode].bpm;
