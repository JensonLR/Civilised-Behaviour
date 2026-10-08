export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** The length of (x, z). Use this, not Math.hypot, in anything that runs every tick: that builtin boxes both arguments and its result (38 B a call, measured); this is inlined. */
export const hyp = (x: number, z: number): number => Math.sqrt(x * x + z * z);
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Wraps an angle into (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
};

/** Shortest signed difference `to - from` in radians. */
export const angleDelta = (from: number, to: number): number => wrapAngle(to - from);

/** Moves `from` toward `to` by at most `maxStep` (never overshoots). */
export const approach = (from: number, to: number, maxStep: number): number => {
  const d = to - from;
  return Math.abs(d) <= maxStep ? to : from + Math.sign(d) * maxStep;
};

export const approachAngle = (from: number, to: number, maxStep: number): number =>
  wrapAngle(from + clamp(angleDelta(from, to), -maxStep, maxStep));
