import { dbToGain } from "./volume.ts";
import type { MusicState } from "./musicLayers.ts";

/**
 * THE MIX RULES (docs/_notes/polish2.md section 6), as pure numbers the engine and the tests share:
 *  - the ambience bed ducks 6 dB while the fight is on (it eases in and out with the drums, so a quiet field has its full wind and birds),
 *  - the combat stems (everything but the jolly bed) duck up to 4 dB for 0.6 s under a cannon or a blast and come straight back, so the drums are never lost under a gun,
 *  - everything ducks to half while a parley is open (the talk is the scene).
 * The jolly bed itself still ducks under loud sounds through the engine's general duck (`duckFor`): it is the thing a cannon is allowed to drown.
 */
export const COMBAT_AMBIENCE_DB = -6;
export const BLAST_STEM_DB = -4;
export const BLAST_HOLD = 0.6;
/** The `duckFor` amount (def.duck x gain) at which the stems take the full blast duck: a cannon or an explosion at close range. */
export const BLAST_FULL_AT = 0.8;

/** Linear gain for the ambience bus's mood stage: -6 dB at full combat drums, times the parley duck. */
export function ambienceMood(st: Pick<MusicState, "gain" | "parleyDuck">): number {
  const fight = Math.min(1, Math.max(0, st.gain.drive));
  return (1 + (dbToGain(COMBAT_AMBIENCE_DB) - 1) * fight) * st.parleyDuck;
}

/** Linear gain the combat stems drop to for a sound that ducks the world by `amount` (0..1): up to -4 dB, none for a whisper. */
export function stemBlastLevel(amount: number): number {
  if (!(amount > 0.08)) return 1;
  return dbToGain(BLAST_STEM_DB * Math.min(1, amount / BLAST_FULL_AT));
}
