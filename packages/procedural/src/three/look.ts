import { Color } from "three";
import { PALETTE } from "@cb/shared";
import type { CharacterSpec } from "../spec.ts";

/** A hair colour turned toward grey by the spec's greying (used for brows, moustaches and beards; the scalp uses `greyTint` so it can grey at the temples only). */
export function greyed(hair: number, spec: CharacterSpec, amount = 1): number {
  const k = [0, 0.35, 0.55, 0.9][spec.greying] ?? 0;
  if (k === 0) return hair;
  return new Color(hair).lerp(new Color(PALETTE.hair[6]!), k * amount).getHex();
}

/** How grey the scalp hair is at a place on the head: 0 none .. 1 fully grey. Temples grey first, streaks run back from the brow, silver is all over. */
export function greyAmount(spec: CharacterSpec, az: number, y: number): number {
  switch (spec.greying) {
    case 1: // temples
      return Math.max(0, 1 - Math.abs(az - 1.15) / 0.5) * Math.max(0, 1 - Math.abs(y - 0.25) / 0.45) * 0.85;
    case 2: // streaks: a couple of grey bands running front to back
      {
      const t = Math.sin(az * 4 + y * 2.5);
      const k = Math.max(0, Math.min(1, (t - 0.25) / 0.6));
      return 0.1 + 0.65 * k * k * (3 - 2 * k);
    }
    case 3:
      return 0.9;
    default:
      return 0;
  }
}
