/**
 * Where a sound sits relative to the listener, as numbers the engine can hand to a gain, a low-pass and a stereo panner. "HRTF-lite": a real
 * HRTF costs a convolution per voice; the cues that matter for a shooter (which side, how far, in front or behind) are carried by level
 * difference, distance roll-off, air absorption and a duller sound from behind. Pure functions, allocation-free (`out` is reused).
 */

export interface Listener {
  x: number;
  y: number;
  z: number;
  /** Camera yaw (rad). The forward vector is (-sin yaw, -cos yaw) in (x, z), the same convention as CameraRig. */
  yaw: number;
}

export interface SpatialOut {
  /** Linear gain from distance alone (1 inside the reference distance). */
  gain: number;
  /** -1 (left) .. +1 (right). */
  pan: number;
  /** Low-pass cut-off in Hz: air absorption plus the shadow of the head for sounds behind. */
  cutoff: number;
  /** Extra reverb send (0..1): far sounds are wetter. */
  wet: number;
  dist: number;
  /** Bearing relative to where the listener faces: 0 = ahead, +PI/2 = right, +-PI = behind. */
  az: number;
  /** Seconds the sound takes to arrive (capped): the crack of a far gun arrives after the flash. */
  delay: number;
}

export const newSpatial = (): SpatialOut => ({ gain: 1, pan: 0, cutoff: 20000, wet: 0, dist: 0, az: 0, delay: 0 });

const SPEED_OF_SOUND = 343;

/**
 * `ref` is the distance inside which the sound is at full level (a footstep 2 m, a musket 12 m, a cannon 30 m); beyond it the level falls
 * like 1/distance (-6 dB per doubling) and reaches silence at `max`.
 */
export function spatialise(l: Listener, x: number, y: number, z: number, ref: number, max: number, out: SpatialOut): SpatialOut {
  const dx = x - l.x;
  const dy = y - l.y;
  const dz = z - l.z;
  const dist = Math.hypot(dx, dy, dz);
  const sy = Math.sin(l.yaw);
  const cy = Math.cos(l.yaw);
  const fwd = -sy * dx - cy * dz;
  const right = cy * dx - sy * dz;
  const flat = Math.hypot(fwd, right);
  const az = flat < 1e-4 ? 0 : Math.atan2(right, fwd);
  out.dist = dist;
  out.az = az;
  // Pan follows the bearing, but collapses to the centre for sounds right on top of the listener (no hard flips when walking past).
  out.pan = flat < 1e-4 ? 0 : Math.sin(az) * Math.min(1, flat / 1.5) * 0.92;
  const r = ref < 0.5 ? 0.5 : ref;
  let g = dist <= r ? 1 : r / dist;
  // Fade the last stretch to a true zero so a sound never pops out of existence at the cut-off.
  if (dist > max * 0.7) g *= Math.max(0, (max - dist) / (max * 0.3));
  out.gain = dist >= max ? 0 : g;
  const behind = flat < 1e-4 ? 0 : Math.max(0, -fwd / flat);
  const air = 20000 / (1 + dist * 0.045);
  out.cutoff = Math.max(600, air * (1 - 0.72 * behind));
  out.wet = Math.min(0.75, dist / 90);
  out.delay = dist > 20 ? Math.min(0.9, (dist - 20) / SPEED_OF_SOUND) : 0;
  return out;
}

/** Compass word for a bearing. */
export function bearingWord(az: number): "ahead" | "right" | "behind" | "left" {
  const a = Math.abs(az);
  if (a < 0.6) return "ahead";
  if (a > 2.5) return "behind";
  return az > 0 ? "right" : "left";
}
