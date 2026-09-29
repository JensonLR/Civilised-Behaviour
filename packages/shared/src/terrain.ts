import { hashFloat } from "./rng.ts";
import { smoothstep } from "./math.ts";

export interface Terrain {
  /** Ground height in metres at world x/z. Pure, deterministic, allocation-free. */
  height(x: number, z: number): number;
}

export interface TerrainOptions {
  /** Peak-to-peak-ish amplitude of the large undulations, metres. */
  amplitude?: number;
  /** Wavelength of the lowest octave, metres. */
  wavelength?: number;
  /** Radius around the origin that is kept flat (spawn / hub). */
  flatRadius?: number;
  /** Distance over which the flat area blends into the noise. */
  blend?: number;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 2D value noise in [0, 1): the shared building block for terrain height AND painted ground colour. */
export function valueNoise(seed: number, x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const zf = fade(z - zi);
  const a = hashFloat(seed, xi, zi);
  const b = hashFloat(seed, xi + 1, zi);
  const c = hashFloat(seed, xi, zi + 1);
  const d = hashFloat(seed, xi + 1, zi + 1);
  const ab = a + (b - a) * xf;
  const cd = c + (d - c) * xf;
  return ab + (cd - ab) * zf;
}

/**
 * Deterministic fBm height field. The same (seed, options) yields bit-identical heights on
 * client and server, which is what makes client-side movement prediction possible without
 * shipping heightmaps over the wire.
 */
export function createTerrain(seed: number, opts: TerrainOptions = {}): Terrain {
  const amplitude = opts.amplitude ?? 5;
  const wavelength = opts.wavelength ?? 70;
  const flatRadius = opts.flatRadius ?? 14;
  const blend = opts.blend ?? 26;
  const freq = 1 / wavelength;
  return {
    height(x, z) {
      let sum = 0;
      let amp = 1;
      let f = freq;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        sum += (valueNoise(seed + o * 101, x * f, z * f) - 0.5) * 2 * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
      }
      const dist = Math.sqrt(x * x + z * z);
      const mask = smoothstep(flatRadius, flatRadius + blend, dist);
      return (sum / norm) * amplitude * mask;
    },
  };
}
