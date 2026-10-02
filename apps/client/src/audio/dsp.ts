import { Rng } from "@cb/shared";

/**
 * Small declarative synthesis kit on top of Web Audio, shared by the offline bake (sound effects) and the live players (music, ambience).
 * A sound is a list of layers: filtered noise bursts, pitch-swept tones, inharmonic "ring" partials (bells, steel, iron) and formant voices.
 * Each layer has an attack and a decay (`dec` = seconds to fall 40 dB); nothing is a sample, everything is arithmetic.
 */

export type NoiseKind = "white" | "pink" | "brown";

export interface Flt {
  t: BiquadFilterType;
  f: number;
  /** Sweep the cut-off to this frequency over `over` seconds (exponential). */
  to?: number;
  over?: number;
  q?: number;
}
export const lp = (f: number, to?: number, over?: number, q = 0.7): Flt => ({ t: "lowpass", f, to, over, q });
export const hp = (f: number, to?: number, over?: number, q = 0.7): Flt => ({ t: "highpass", f, to, over, q });
export const bp = (f: number, q = 1, to?: number, over?: number): Flt => ({ t: "bandpass", f, to, over, q });

interface Timed {
  /** Start offset in seconds. */
  at?: number;
  atk?: number;
  /** Seconds to fall 40 dB after the attack. */
  dec: number;
  peak: number;
  f?: Flt[];
}
export interface NoiseLayer extends Timed {
  k: "n";
  kind?: NoiseKind;
  /** Playback rate of the noise buffer (brighter/duller). */
  rate?: number;
}
export interface ToneLayer extends Timed {
  k: "t";
  type?: OscillatorType;
  /** Note frequency, and an optional sweep target reached over `over` seconds. */
  hz: number;
  to?: number;
  over?: number;
  /** Vibrato: rate (Hz) and depth (fraction of the frequency). */
  vib?: [number, number];
}
export interface RingLayer {
  k: "r";
  at?: number;
  hz: number;
  ratios: number[];
  amps: number[];
  decs: number[];
  peak: number;
}
export interface VoiceLayer {
  k: "v";
  at?: number;
  /** Glottal pitch at the start and at the end of the glide. */
  hz: number;
  to: number;
  over: number;
  /** Formants: [centre Hz, Q, gain]. */
  formants: readonly (readonly [number, number, number])[];
  atk?: number;
  dec: number;
  peak: number;
  breath?: number;
}
export type Layer = NoiseLayer | ToneLayer | RingLayer | VoiceLayer;

export const N = (o: Omit<NoiseLayer, "k">): NoiseLayer => ({ k: "n", ...o });
export const T = (o: Omit<ToneLayer, "k">): ToneLayer => ({ k: "t", ...o });
export const R = (o: Omit<RingLayer, "k">): RingLayer => ({ k: "r", ...o });
export const V = (o: Omit<VoiceLayer, "k">): VoiceLayer => ({ k: "v", ...o });

/** Time after which a layer is inaudible (-60 dB). */
export function layerEnd(l: Layer): number {
  switch (l.k) {
    case "r":
      return (l.at ?? 0) + Math.max(...l.decs) * 1.5;
    default:
      return (l.at ?? 0) + (l.atk ?? 0) + l.dec * 1.5;
  }
}
export const layersEnd = (ls: readonly Layer[]): number => ls.reduce((m, l) => Math.max(m, layerEnd(l)), 0);

// ---- noise ---------------------------------------------------------------------------------------------------------------------------

export const NOISE_SECONDS = 4;
const noiseCache = new Map<number, Record<NoiseKind, AudioBuffer>>();

/** Four seconds each of white, pink and brown noise at `sampleRate`, from a fixed seed (identical on every run and machine). */
export function noiseBuffers(ctx: BaseAudioContext, sampleRate: number = ctx.sampleRate): Record<NoiseKind, AudioBuffer> {
  let set = noiseCache.get(sampleRate);
  if (set) return set;
  const len = Math.floor(NOISE_SECONDS * sampleRate);
  const rng = new Rng(0x5eed);
  const white = ctx.createBuffer(1, len, sampleRate);
  const pink = ctx.createBuffer(1, len, sampleRate);
  const brown = ctx.createBuffer(1, len, sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const x = rng.next() * 2 - 1;
    w[i] = x;
    // Paul Kellet's economy pink filter.
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    // Brown: a leaky integrator of white.
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  // Make each buffer loop without a seam: cross-fade the last 0.05 s into the first.
  for (const c of [w, p, b]) {
    const n = Math.floor(0.05 * sampleRate);
    for (let i = 0; i < n; i++) {
      const a = i / n;
      c[i] = c[i]! * a + c[len - n + i]! * (1 - a);
    }
  }
  set = { white, pink, brown };
  noiseCache.set(sampleRate, set);
  return set;
}

// ---- envelopes and nodes ---------------------------------------------------------------------------------------------------------------

/** Linear attack to `peak`, then an exponential fall (`dec` = time to -40 dB). */
export function env(g: AudioParam, t: number, peak: number, atk: number, dec: number): void {
  g.setValueAtTime(0, t);
  if (atk > 0.0005) g.linearRampToValueAtTime(peak, t + atk);
  else g.setValueAtTime(peak, t + 0.0005);
  g.setTargetAtTime(0, t + Math.max(atk, 0.0005), dec / 4.6);
}

function chain(ctx: BaseAudioContext, from: AudioNode, filters: readonly Flt[] | undefined, t: number, pitch = 1): AudioNode {
  let node = from;
  for (const s of filters ?? []) {
    const f = ctx.createBiquadFilter();
    f.type = s.t;
    f.Q.value = s.q ?? 0.7;
    f.frequency.setValueAtTime(s.f * pitch, t);
    if (s.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, s.to * pitch), t + (s.over ?? 0.2));
    node.connect(f);
    node = f;
  }
  return node;
}

/** Soft-clipping curve; `drive` 0.5 is a gentle warmth, 1.5 is crunch. Cached per drive. */
const curves = new Map<number, Float32Array<ArrayBuffer>>();
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  let c = curves.get(drive);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  const k = 1 + drive * 3;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / norm;
  }
  curves.set(drive, c);
  return c;
}

/**
 * Schedules `layers` into `out`, starting at audio-clock time `t0`. `pitch` scales tone and ring frequencies and noise brightness; `drive` adds
 * harmonics to the whole sum (the bigger guns). `rng` picks the start point in the noise, so two plays of one recipe are never the same grains.
 */
export function renderLayers(ctx: BaseAudioContext, out: AudioNode, t0: number, layers: readonly Layer[], opts: { pitch?: number; drive?: number; rng: Rng; noise?: Record<NoiseKind, AudioBuffer> }): void {
  const pitch = opts.pitch ?? 1;
  const noise = opts.noise ?? noiseBuffers(ctx);
  const sum = ctx.createGain();
  if (opts.drive && opts.drive > 0) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(opts.drive);
    sum.connect(ws);
    ws.connect(out);
  } else {
    sum.connect(out);
  }
  for (const l of layers) {
    const t = t0 + (l.at ?? 0);
    switch (l.k) {
      case "n": {
        const src = ctx.createBufferSource();
        src.buffer = noise[l.kind ?? "white"];
        const rate = l.rate ?? 1;
        src.playbackRate.value = rate;
        const g = ctx.createGain();
        const end = (l.atk ?? 0) + l.dec * 1.5;
        chain(ctx, src, l.f, t, 1).connect(g);
        env(g.gain, t, l.peak, l.atk ?? 0, l.dec);
        g.connect(sum);
        const maxOff = Math.max(0, NOISE_SECONDS - end * rate - 0.1);
        src.start(t, opts.rng.next() * maxOff);
        src.stop(t + end);
        break;
      }
      case "t": {
        const osc = ctx.createOscillator();
        osc.type = l.type ?? "sine";
        osc.frequency.setValueAtTime(l.hz * pitch, t);
        if (l.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, l.to * pitch), t + (l.over ?? 0.1));
        const end = (l.atk ?? 0) + l.dec * 1.5;
        if (l.vib) {
          const lfo = ctx.createOscillator();
          const depth = ctx.createGain();
          lfo.frequency.value = l.vib[0];
          depth.gain.value = l.hz * pitch * l.vib[1];
          lfo.connect(depth);
          depth.connect(osc.frequency);
          lfo.start(t);
          lfo.stop(t + end);
        }
        const g = ctx.createGain();
        chain(ctx, osc, l.f, t, 1).connect(g);
        env(g.gain, t, l.peak, l.atk ?? 0, l.dec);
        g.connect(sum);
        osc.start(t);
        osc.stop(t + end);
        break;
      }
      case "r": {
        for (let i = 0; i < l.ratios.length; i++) {
          // a partial above the Nyquist limit is silent aliasing and a console warning on every bell (D-040): it is not made at all
          const hz = l.hz * pitch * l.ratios[i]!;
          if (hz >= ctx.sampleRate * 0.45) continue;
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = hz;
          const g = ctx.createGain();
          const dec = l.decs[i]!;
          env(g.gain, t, l.peak * l.amps[i]!, 0.0008, dec);
          osc.connect(g);
          g.connect(sum);
          osc.start(t);
          osc.stop(t + dec * 1.5);
        }
        break;
      }
      case "v": {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(l.hz * pitch, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, l.to * pitch), t + l.over);
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 5.5;
        lfoGain.gain.value = l.hz * pitch * 0.02;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        const g = ctx.createGain();
        const end = (l.atk ?? 0.01) + l.dec * 1.5;
        for (const [f, q, fg] of l.formants) {
          const b = ctx.createBiquadFilter();
          b.type = "bandpass";
          b.frequency.value = f;
          b.Q.value = q;
          const bg = ctx.createGain();
          bg.gain.value = fg;
          osc.connect(b);
          b.connect(bg);
          bg.connect(g);
        }
        env(g.gain, t, l.peak, l.atk ?? 0.01, l.dec);
        g.connect(sum);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + end);
        lfo.stop(t + end);
        if (l.breath) {
          const src = ctx.createBufferSource();
          src.buffer = noise.white;
          const bpf = ctx.createBiquadFilter();
          bpf.type = "bandpass";
          bpf.frequency.value = l.formants[1]?.[0] ?? 1200;
          bpf.Q.value = 1.2;
          const bg = ctx.createGain();
          env(bg.gain, t, l.peak * l.breath, (l.atk ?? 0.01) * 1.5, l.dec * 1.2);
          src.connect(bpf);
          bpf.connect(bg);
          bg.connect(sum);
          src.start(t, opts.rng.next() * 2);
          src.stop(t + end);
        }
        break;
      }
    }
  }
}
