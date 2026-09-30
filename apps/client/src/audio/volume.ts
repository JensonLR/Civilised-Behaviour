/**
 * Volume sliders are 0..1 in the interface and a gain in the graph. A straight linear gain makes the top half of a slider feel dead and the
 * bottom few percent a cliff, so the curve is a square: 0.5 on the slider is about -12 dB, 0.25 is -24 dB, 0 is silence. Pure and shared by the
 * engine and the settings screen (which prints the same number as a percentage).
 */
export type VolumeChannel = "master" | "music" | "sfx" | "ambience";
export const VOLUME_CHANNELS: readonly VolumeChannel[] = ["master", "music", "sfx", "ambience"];

export const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/** Slider position (0..1) to linear gain. */
export const volumeToGain = (v: number): number => {
  const c = clamp01(v);
  return c * c;
};

/** Inverse of {@link volumeToGain}. */
export const gainToVolume = (g: number): number => Math.sqrt(clamp01(g));

export const gainToDb = (g: number): number => (g <= 1e-6 ? -120 : 20 * Math.log10(g));
export const dbToGain = (db: number): number => 10 ** (db / 20);

/** Defaults: the band should sit behind the world, and the master leaves a little headroom above what a limiter would need. */
export const DEFAULT_VOLUMES: Readonly<Record<VolumeChannel, number>> = { master: 0.8, music: 0.6, sfx: 0.9, ambience: 0.8 };
