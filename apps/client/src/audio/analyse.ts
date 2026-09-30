import { BAKE_RATE, renderVariant, type BakeStats } from "./bake.ts";
import { SOUNDS } from "./sounds.ts";

/**
 * Offline measurement of every baked effect, so levels are numbers, not opinions. It renders each recipe with an OfflineAudioContext (the same
 * path the game uses) and reports peak, RMS, audible length, DC offset, non-finite samples and where the energy sits in frequency. Used by
 * tests/e2e/settings.spec.ts and by hand from a scratch page; nothing in the game imports it.
 */
export interface SoundReport extends BakeStats {
  name: string;
  key: string;
  variant: number;
  /** Spectral centroid of the first two seconds, Hz. */
  centroid: number;
  /** Share of energy (0..1) below 200 Hz, 200 Hz - 2 kHz, above 2 kHz. */
  bands: [number, number, number];
  /** Same measures for the first ~130 ms (the transient a small speaker still plays). */
  attack: { centroid: number; bands: [number, number, number] };
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** IEC A-weighting as a linear power factor relative to 1 kHz: how much a frequency counts to a listener on ordinary speakers. */
const rawA = (f: number): number => {
  const f2 = f * f;
  return (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
};
const A1K = rawA(1000);
export const aWeight = (f: number): number => (rawA(f) / A1K) ** 2;

/** Spectral centroid and 3-band split of the A-weighted power (what is actually audible, not what is merely large). */
export function spectrum(data: Float32Array, sampleRate: number): { centroid: number; bands: [number, number, number] } {
  const N = 2048;
  if (data.length < N + 1) return { centroid: 0, bands: [0, 0, 0] };
  const limit = Math.min(data.length - N, sampleRate * 2);
  const power = new Float64Array(N / 2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s <= limit; s += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = data[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] = power[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
  }
  let total = 0;
  let weighted = 0;
  const b: [number, number, number] = [0, 0, 0];
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sampleRate) / N;
    const p = power[k]! * aWeight(f);
    total += p;
    weighted += p * f;
    b[f < 200 ? 0 : f < 2000 ? 1 : 2] += p;
  }
  if (total <= 0 || frames === 0) return { centroid: 0, bands: [0, 0, 0] };
  return { centroid: weighted / total, bands: [b[0] / total, b[1] / total, b[2] / total] };
}

export async function analyseAll(only?: string[]): Promise<SoundReport[]> {
  const out: SoundReport[] = [];
  const seen = new Set<unknown>();
  for (const [name, def] of Object.entries(SOUNDS)) {
    if (seen.has(def) || (only && !only.includes(name))) continue;
    seen.add(def);
    for (const key of def.keys) {
      for (let v = 0; v < def.variants; v++) {
        const { buffer, stats } = await renderVariant(name, def, key, v);
        const data = buffer.getChannelData(0);
        out.push({ name, key, variant: v, ...stats, ...spectrum(data, BAKE_RATE), attack: spectrum(data.subarray(0, 6000), BAKE_RATE) });
      }
    }
  }
  return out;
}
