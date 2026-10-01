import { Rng } from "@cb/shared";
import { finishBuffer, variantSeed, type BakeStats } from "./bake.ts";
import { NOISE_SECONDS, layersEnd, noiseBuffers, type Flt, type Layer, type NoiseKind } from "./dsp.ts";
import type { SoundDef } from "./sounds.ts";

/**
 * A pure-JavaScript stand-in for `renderLayers` + an OfflineAudioContext (bake.ts renders the same recipes in the browser). Node has no Web Audio, so tests that must MEASURE a recipe
 * (peak, RMS, where the energy sits) render it here: the same layers, the same envelopes (linear attack, then an exponential fall with time constant `dec / 4.6`), biquads from the Web
 * Audio cookbook (a bandpass at unity peak, low/high-pass Q in dB), the same noise tables and the same waveshaper. Oscillators are naive (not band-limited), which matters only for
 * bright saw and square tones: measured centroids are an upper bound there. Not used by the game.
 */

export const RATE = 44100;

type Kind = "lowpass" | "highpass" | "bandpass";

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly kind: Kind, private readonly q: number) {}

  set(freq: number): void {
    const f = Math.min(Math.max(freq, 10), RATE / 2 - 100);
    const w0 = (2 * Math.PI * f) / RATE;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    let b0: number, b1: number, b2: number, alpha: number;
    if (this.kind === "bandpass") {
      alpha = sin / (2 * Math.max(this.q, 1e-3));
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    } else {
      alpha = sin / (2 * 10 ** (this.q / 20));
      if (this.kind === "lowpass") {
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = (1 - cos) / 2;
      } else {
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = (1 + cos) / 2;
      }
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const KIND: Record<string, Kind> = { lowpass: "lowpass", highpass: "highpass", bandpass: "bandpass" };

/** The filter chain of a layer, run sample by sample with the cut-off swept exponentially, as the context does. */
function runFilters(buf: Float32Array, filters: readonly Flt[] | undefined, pitch: number): void {
  for (const s of filters ?? []) {
    const bq = new Biquad(KIND[s.t]!, s.q ?? 0.7);
    const f0 = s.f * pitch;
    const f1 = s.to !== undefined ? Math.max(20, s.to * pitch) : f0;
    const over = Math.max(1, Math.floor((s.over ?? 0.2) * RATE));
    for (let i = 0; i < buf.length; i++) {
      if ((i & 15) === 0) bq.set(i >= over ? f1 : f0 * (f1 / f0) ** (i / over));
      buf[i] = bq.run(buf[i]!);
    }
  }
}

/** Linear attack to `peak` then an exponential fall, as `env()` schedules it. */
function envelope(n: number, peak: number, atk: number, dec: number): Float32Array {
  const e = new Float32Array(n);
  const ta = atk > 0.0005 ? atk : 0.0005;
  const tc = dec / 4.6;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    e[i] = t < ta ? (atk > 0.0005 ? peak * (t / atk) : 0) : peak * Math.exp(-(t - ta) / tc);
  }
  return e;
}

const wave = (type: string, ph: number): number => {
  const x = ph - Math.floor(ph);
  switch (type) {
    case "square":
      return x < 0.5 ? 1 : -1;
    case "sawtooth":
      return 2 * x - 1;
    case "triangle":
      return 1 - 4 * Math.abs(x - 0.5);
    default:
      return Math.sin(2 * Math.PI * x);
  }
};

/** The instantaneous frequency of a sweep from `hz` to `to` over `over` seconds (exponential), held after. */
const sweep = (hz: number, to: number | undefined, over: number, t: number): number => (to === undefined || t >= over ? (to ?? hz) : hz * (Math.max(10, to) / hz) ** (t / over));

export interface RenderOpts {
  pitch?: number;
  drive?: number;
  rng: Rng;
  /** Length in seconds (default: the layers' end + 30 ms, as bake.ts does). */
  seconds: number;
}

let tables: Record<NoiseKind, Float32Array> | undefined;
/** The same four-second noise tables the context uses (built once through `noiseBuffers` with a stand-in for `createBuffer`). */
function noise(): Record<NoiseKind, Float32Array> {
  if (tables) return tables;
  const made: Float32Array[] = [];
  const ctx = {
    sampleRate: RATE,
    createBuffer: (_c: number, len: number) => {
      const a = new Float32Array(len);
      made.push(a);
      return { getChannelData: () => a };
    },
  } as unknown as BaseAudioContext;
  noiseBuffers(ctx, RATE);
  tables = { white: made[0]!, pink: made[1]!, brown: made[2]! };
  return tables;
}

/** Renders `layers` the way `renderLayers` schedules them and returns mono samples (unnormalised; run `finishBuffer` for the level). */
export function renderLayersToArray(layers: readonly Layer[], o: RenderOpts): Float32Array {
  const pitch = o.pitch ?? 1;
  const out = new Float32Array(Math.ceil(o.seconds * RATE));
  const nz = noise();
  const add = (buf: Float32Array, at: number): void => {
    const s0 = Math.floor(at * RATE);
    for (let i = 0; i < buf.length && s0 + i < out.length; i++) if (s0 + i >= 0) out[s0 + i] = out[s0 + i]! + buf[i]!;
  };
  for (const l of layers) {
    const at = l.at ?? 0;
    switch (l.k) {
      case "n": {
        const end = (l.atk ?? 0) + l.dec * 1.5;
        const n = Math.ceil(end * RATE);
        const rate = l.rate ?? 1;
        const table = nz[l.kind ?? "white"];
        const maxOff = Math.max(0, NOISE_SECONDS - end * rate - 0.1);
        const off = o.rng.next() * maxOff;
        const buf = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const pos = (off * RATE + i * rate) % table.length;
          const i0 = Math.floor(pos);
          const fr = pos - i0;
          buf[i] = table[i0]! * (1 - fr) + table[(i0 + 1) % table.length]! * fr;
        }
        runFilters(buf, l.f, 1);
        const e = envelope(n, l.peak, l.atk ?? 0, l.dec);
        for (let i = 0; i < n; i++) buf[i] = buf[i]! * e[i]!;
        add(buf, at);
        break;
      }
      case "t": {
        const end = (l.atk ?? 0) + l.dec * 1.5;
        const n = Math.ceil(end * RATE);
        const buf = new Float32Array(n);
        let ph = 0;
        let lph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / RATE;
          let f = sweep(l.hz * pitch, l.to === undefined ? undefined : l.to * pitch, l.over ?? 0.1, t);
          if (l.vib) {
            lph += l.vib[0] / RATE;
            f += l.hz * pitch * l.vib[1] * Math.sin(2 * Math.PI * lph);
          }
          ph += f / RATE;
          buf[i] = wave(l.type ?? "sine", ph);
        }
        runFilters(buf, l.f, 1);
        const e = envelope(n, l.peak, l.atk ?? 0, l.dec);
        for (let i = 0; i < n; i++) buf[i] = buf[i]! * e[i]!;
        add(buf, at);
        break;
      }
      case "r": {
        for (let k = 0; k < l.ratios.length; k++) {
          const dec = l.decs[k]!;
          const n = Math.ceil(dec * 1.5 * RATE);
          const e = envelope(n, l.peak * l.amps[k]!, 0.0008, dec);
          const w = (2 * Math.PI * l.hz * pitch * l.ratios[k]!) / RATE;
          const buf = new Float32Array(n);
          for (let i = 0; i < n; i++) buf[i] = Math.sin(w * i) * e[i]!;
          add(buf, at);
        }
        break;
      }
      case "v": {
        const atk = l.atk ?? 0.01;
        const end = atk + l.dec * 1.5;
        const n = Math.ceil(end * RATE);
        const src = new Float32Array(n);
        let ph = 0;
        let lph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / RATE;
          lph += 5.5 / RATE;
          const f = sweep(l.hz * pitch, l.to * pitch, l.over, t) + l.hz * pitch * 0.02 * Math.sin(2 * Math.PI * lph);
          ph += f / RATE;
          src[i] = wave("sawtooth", ph);
        }
        const mix = new Float32Array(n);
        for (const [f, q, g] of l.formants) {
          const b = Float32Array.from(src);
          runFilters(b, [{ t: "bandpass", f, q }], 1);
          for (let i = 0; i < n; i++) mix[i] = mix[i]! + b[i]! * g;
        }
        const e = envelope(n, l.peak, atk, l.dec);
        for (let i = 0; i < n; i++) mix[i] = mix[i]! * e[i]!;
        add(mix, at);
        if (l.breath) {
          const off = o.rng.next() * 2;
          const b = new Float32Array(n);
          for (let i = 0; i < n; i++) b[i] = nz.white[(Math.floor(off * RATE) + i) % nz.white.length]!;
          runFilters(b, [{ t: "bandpass", f: l.formants[1]?.[0] ?? 1200, q: 1.2 }], 1);
          const eb = envelope(n, l.peak * l.breath, atk * 1.5, l.dec * 1.2);
          for (let i = 0; i < n; i++) b[i] = b[i]! * eb[i]!;
          add(b, at);
        }
        break;
      }
    }
  }
  if (o.drive && o.drive > 0) {
    const k = 1 + o.drive * 3;
    const norm = Math.tanh(k);
    for (let i = 0; i < out.length; i++) {
      const x = Math.max(-1, Math.min(1, out[i]!));
      out[i] = Math.tanh(x * k) / norm;
    }
  }
  return out;
}

/** What `bake.ts` `renderVariant` does, in Node: the recipe's layers from the seeded rng, rendered with the same rng, normalised to the sound's `peakDb`. */
export function renderVariantOffline(name: string, def: SoundDef, key: string, variant: number): { data: Float32Array; stats: BakeStats } {
  const rng = new Rng(variantSeed(name, key, variant));
  const layers = def.layers({ pitch: 1, rng, key, variant });
  const seconds = def.loop > 0 ? def.loop : Math.min(8, layersEnd(layers) + 0.03);
  const data = renderLayersToArray(layers, { pitch: 1, drive: def.drive, rng, seconds });
  const stats = finishBuffer(data, RATE, def.peakDb, def.loop > 0);
  return { data, stats };
}
