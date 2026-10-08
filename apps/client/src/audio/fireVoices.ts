import type { Rng } from "@cb/shared";

/**
 * The camp fire's events (the continuous roar is a bed in ambience.ts): pops, the odd snap, and in rain the sizzle of drops flashing to steam on the embers. A downpour thins
 * the crackle out and quietens it (the wet wood hisses instead). Pure scheduling: the caller places and plays what is emitted. Allocation-free.
 */

export interface FireVoices {
  popIn: number;
  snapIn: number;
  sizzleIn: number;
}

export const newFireVoices = (): FireVoices => ({ popIn: 0.3, snapIn: 3, sizzleIn: 1 });

/** What to play: the sound, an offset from the fire's centre (m), a volume and a variant seed. */
export type FireEmit = (sound: "fire_pop" | "fire_snap" | "fire_sizzle", dx: number, dz: number, volume: number, seed: number) => void;

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/** Advances the fire's schedule by `dt` seconds under `rain` (0..1) and emits what lands. */
export function stepFireVoices(s: FireVoices, dt: number, rain: number, rng: Rng, emit: FireEmit): void {
  if (!(dt > 0)) return;
  const wet = Number.isFinite(rain) ? clamp01(rain) : 0;
  s.popIn -= dt;
  if (s.popIn <= 0) {
    s.popIn = (0.06 + rng.next() * rng.next() * 0.5) * (1 + 2 * wet);
    emit("fire_pop", (rng.next() - 0.5) * 0.4, (rng.next() - 0.5) * 0.4, (0.6 + rng.next() * 0.4) * (1 - 0.4 * wet), Math.floor(rng.next() * 8));
  }
  s.snapIn -= dt;
  if (s.snapIn <= 0) {
    s.snapIn = (1.5 + rng.next() * 4) * (1 + 2 * wet);
    emit("fire_snap", 0, 0, 1 - 0.4 * wet, Math.floor(rng.next() * 4));
  }
  if (wet > 0.05) {
    s.sizzleIn -= dt;
    if (s.sizzleIn <= 0) {
      s.sizzleIn = (0.2 + rng.next() * 0.8) / wet;
      emit("fire_sizzle", (rng.next() - 0.5) * 0.5, (rng.next() - 0.5) * 0.5, 0.5 + 0.5 * wet * rng.next(), Math.floor(rng.next() * 6));
    }
  } else if (s.sizzleIn < 0.2) s.sizzleIn = 0.2 + rng.next() * 0.8; // (dry: the next shower starts afresh, not with a backlog)
}
