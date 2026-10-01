import type { Rng } from "@cb/shared";
import type { Layer } from "./dsp.ts";

/** The shape of a sound recipe and the helpers every recipe file shares (sounds.ts, soundsGrit.ts). Split out so a second recipe file does not import a cycle. */

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

export const def = (o: Partial<SoundDef> & Pick<SoundDef, "group" | "layers" | "peakDb">): SoundDef => ({
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

export const jit = (p: SoundParams, spread: number): number => 1 + (p.rng.next() * 2 - 1) * spread;

