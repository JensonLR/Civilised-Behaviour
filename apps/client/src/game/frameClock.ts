/** The simulation never steps more than this per frame (a stalled tab does not leap). */
export const MAX_STEP_S = 0.1;

/**
 * One frame's time, two ways (D-047): `raw` is what was measured (the overlay, the perf capture and the ping clock read it), `step` is what the simulation advances by (clamped).
 * The overlay used to read the clamp, so it could never show a frame slower than 100 ms: every software-GL capture said "10 fps".
 */
export function frameDelta(nowMs: number, lastMs: number): { raw: number; step: number } {
  const raw = Math.max(0, (nowMs - lastMs) / 1000);
  return { raw, step: Math.min(raw, MAX_STEP_S) };
}
