/**
 * What state of health the picture should show: none, shaken, critical, down. The gauge already shows a needle and a number; this adds the
 * ink hatching that closes in from the edges of the picture (a pattern, not just a colour) and the words on the gauge's label.
 */
export type VitalsLevel = 0 | 1 | 2 | 3;

/** `healthPct` is 0..100 of full health. Shaken from 55%, critical from 35% (the gauge's red zone), down at zero. */
export function vitalsLevel(healthPct: number, down: boolean): VitalsLevel {
  if (down || healthPct <= 0) return 3;
  if (!Number.isFinite(healthPct)) return 0;
  return healthPct <= 35 ? 2 : healthPct <= 55 ? 1 : 0;
}

/** The gauge's label under the dial for each level. */
export const VITALS_LABEL = ["Vitality", "Vitality", "Critical!", "Down ✚"] as const;
