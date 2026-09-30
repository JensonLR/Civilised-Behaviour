import { Rng, seedFromString } from "@cb/shared";
import { layersEnd, noiseBuffers, renderLayers } from "./dsp.ts";
import { SOUNDS, type SoundDef, type SoundParams } from "./sounds.ts";
import { dbToGain } from "./volume.ts";

/**
 * Sound effects are rendered once, offline, into AudioBuffers (see sounds.ts) and then only played. This file is the renderer and the
 * normaliser; `SoundBank` owns the results. Every buffer is deterministic: the noise, the variant and the recipe's random choices are seeded
 * from the sound's name, so two machines bake identical samples and a level measured in a test is the level the player hears.
 */

/** Bake rate. Effects have nothing above ~16 kHz worth keeping, and 44.1 kHz keeps 170 buffers to a few tens of MB. */
export const BAKE_RATE = 44100;
const FADE_IN = 0.0005;
const FADE_OUT = 0.015;

export interface BakeStats {
  /** Peak before normalisation, dBFS. */
  rawPeakDb: number;
  /** Peak after normalisation, dBFS (should equal the definition's target). */
  peakDb: number;
  rmsDb: number;
  seconds: number;
  /** Seconds until the sound falls below -60 dB of its peak (its audible length). */
  audibleSeconds: number;
  /** Mean of the raw render relative to its peak (removed before use; a large value means the recipe wanders and is worth a look). */
  dc: number;
  nonFinite: number;
}

/** Normalises in place: DC removal, click-free edges, then a gain that puts the peak at `peakDb`. Returns the measurements. */
export function finishBuffer(data: Float32Array, sampleRate: number, peakDb: number, loop: boolean): BakeStats {
  const n = data.length;
  let nonFinite = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(data[i]!)) {
      data[i] = 0;
      nonFinite++;
    }
    sum += data[i]!;
  }
  const mean = n ? sum / n : 0;
  let rawPeak = 0;
  for (let i = 0; i < n; i++) {
    data[i] = data[i]! - mean;
    const a = Math.abs(data[i]!);
    if (a > rawPeak) rawPeak = a;
  }
  const fi = Math.floor(FADE_IN * sampleRate);
  const fo = Math.floor(FADE_OUT * sampleRate);
  if (!loop) {
    for (let i = 0; i < fi && i < n; i++) data[i] = data[i]! * (i / fi);
    for (let i = 0; i < fo && i < n; i++) data[n - 1 - i] = data[n - 1 - i]! * (i / fo);
  }
  const target = dbToGain(peakDb);
  const scale = rawPeak > 1e-9 ? target / rawPeak : 0;
  let sq = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i]! * scale;
    data[i] = v;
    sq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  let last = 0;
  const floor = peak * 0.001;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(data[i]!) > floor) {
      last = i;
      break;
    }
  }
  const db = (x: number): number => (x <= 1e-9 ? -180 : 20 * Math.log10(x));
  return { dc: rawPeak > 1e-9 ? mean / rawPeak : 0, rawPeakDb: db(rawPeak), peakDb: db(peak), rmsDb: db(Math.sqrt(sq / Math.max(1, n))), seconds: n / sampleRate, audibleSeconds: last / sampleRate, nonFinite };
}

export const variantSeed = (name: string, key: string, variant: number): number => (seedFromString(`${name}/${key}`) ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
export const offlineContextCtor = (): OfflineCtor | undefined => {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
};

/** Renders one variant of one recipe. `Ctor` is injectable so a page can bake in a worker or a test can substitute. */
export async function renderVariant(name: string, def: SoundDef, key: string, variant: number, Ctor: OfflineCtor = offlineContextCtor()!): Promise<{ buffer: AudioBuffer; stats: BakeStats }> {
  const rng = new Rng(variantSeed(name, key, variant));
  const p: SoundParams = { pitch: 1, rng, key, variant };
  const layers = def.layers(p);
  const seconds = def.loop > 0 ? def.loop : Math.min(8, layersEnd(layers) + 0.03);
  const ctx = new Ctor(1, Math.ceil(seconds * BAKE_RATE), BAKE_RATE);
  renderLayers(ctx, ctx.destination, 0, layers, { pitch: 1, drive: def.drive, rng, noise: noiseBuffers(ctx, BAKE_RATE) });
  const buffer = await ctx.startRendering();
  const stats = finishBuffer(buffer.getChannelData(0), BAKE_RATE, def.peakDb, def.loop > 0);
  return { buffer, stats };
}

export interface BakedSound {
  def: SoundDef;
  /** By key, then variant. */
  buffers: Map<string, AudioBuffer[]>;
  stats: Map<string, BakeStats[]>;
  /** Round-robin cursors so one sound never plays the same variant twice running. */
  cursor: Map<string, number>;
}

/** The bank of baked effects. Baking is asynchronous and incremental; `pick` returns undefined until a sound is ready (the play is skipped). */
export class SoundBank {
  private readonly baked = new Map<SoundDef, BakedSound>();
  private readonly pending = new Map<SoundDef, Promise<BakedSound | undefined>>();
  bakedCount = 0;

  constructor(private readonly Ctor: OfflineCtor | undefined = offlineContextCtor()) {}

  get available(): boolean {
    return this.Ctor !== undefined;
  }

  /** Bakes `name` (once). Aliases that share a definition share the buffers. */
  ensure(name: string): Promise<BakedSound | undefined> {
    const def = SOUNDS[name];
    if (!def || !this.Ctor) return Promise.resolve(undefined);
    const done = this.baked.get(def);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(def);
    if (!p) {
      p = this.bake(name, def).catch((e) => {
        console.warn(`audio: could not bake ${name}`, e);
        return undefined;
      });
      this.pending.set(def, p);
    }
    return p;
  }

  private async bake(name: string, def: SoundDef): Promise<BakedSound> {
    const out: BakedSound = { def, buffers: new Map(), stats: new Map(), cursor: new Map() };
    for (const key of def.keys) {
      const bufs: AudioBuffer[] = [];
      const stats: BakeStats[] = [];
      for (let v = 0; v < def.variants; v++) {
        const r = await renderVariant(name, def, key, v, this.Ctor);
        bufs.push(r.buffer);
        stats.push(r.stats);
      }
      out.buffers.set(key, bufs);
      out.stats.set(key, stats);
    }
    this.baked.set(def, out);
    this.bakedCount++;
    return out;
  }

  /** Next variant for `name`/`key` (round-robin, offset by `pick` so a voice-specific sound like `hurt` selects its character). */
  pick(name: string, key = "", variant = -1): AudioBuffer | undefined {
    const def = SOUNDS[name];
    const b = def ? this.baked.get(def) : undefined;
    if (!b) return undefined;
    const list = b.buffers.get(b.buffers.has(key) ? key : b.def.keys[0]!);
    if (!list || list.length === 0) return undefined;
    if (variant >= 0) return list[variant % list.length];
    const ck = `${name}/${key}`;
    const i = ((b.cursor.get(ck) ?? -1) + 1) % list.length;
    b.cursor.set(ck, i);
    return list[i];
  }

  has(name: string): boolean {
    const def = SOUNDS[name];
    return def !== undefined && this.baked.has(def);
  }

  get(name: string): BakedSound | undefined {
    const def = SOUNDS[name];
    return def ? this.baked.get(def) : undefined;
  }
}
