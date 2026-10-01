import { Rng, hash3, type RegionId } from "@cb/shared";
import { engine } from "./engine.ts";
import { beatSeconds, generatePhrase, MODES, type MusicMode, type MusicVoice, type Note } from "./musicScore.ts";
import { MUSIC_LAYERS, type MusicLayerId } from "./musicLayers.ts";
import { BED_GAIN, BED_INST, MUSIC_SEED, stemBar } from "./musicStems.ts";
import { env, noiseBuffers, renderLayers } from "./dsp.ts";

/**
 * Plays the generative score (musicScore.ts) with a few hand-built instruments: a parlour piano (a struck string: a fundamental and
 * a few decaying partials, a soft hammer of filtered noise), a music-box tune, a harp-like pluck and a slow pad. A 120 ms timer schedules
 * bars 0.6 s ahead on the audio clock, so a busy frame never stutters the rhythm. Fades between the menu and the game versions.
 *
 * The game version is LAYERED (D-038): the bed plays as it always did, through its own stem gain, and six more stems (musicStems.ts: pulse, dread, drive, stabs, dirge and the region's colour)
 * are scheduled bar by bar on the same clock into stem gains the mood driver (musicLayers.ts, driven by GameAudio) moves. A stem whose gain is at zero is not scheduled at all.
 */

const SEED = MUSIC_SEED;
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

interface Inst {
  /** Partial ratios and amplitudes. */
  partials: readonly (readonly [number, number])[];
  /** Seconds to fall 40 dB, for a note near middle C; lower notes ring longer. */
  dec: number;
  atk: number;
  type?: OscillatorType;
  hammer?: number;
  /** Detuned twin for a chorus / a piano's beating strings (cents). */
  detune?: number;
  lp?: number;
}

const INST: Record<MusicMode, Partial<Record<MusicVoice, Inst>>> = {
  menu: {
    melody: { partials: [[1, 1], [2, 0.28], [4, 0.1]], dec: 1.1, atk: 0.004, detune: 4 }, // a music box
    bass: { partials: [[1, 1], [2, 0.5], [3, 0.2]], dec: 0.9, atk: 0.006, type: "triangle", hammer: 0.25 },
    chord: { partials: [[1, 1], [2, 0.35], [3, 0.12]], dec: 0.55, atk: 0.004, type: "triangle", hammer: 0.35, detune: 3 },
  },
  game: BED_INST, // shared with the offline measurement of the bed (musicStems.ts), so the two cannot drift apart
};

const GAIN = BED_GAIN;

/** Schedules one note of the score into `out` at audio time `t`. Works on any BaseAudioContext, so an offline render can measure the music. */
export function playNote(ctx: BaseAudioContext, out: AudioNode, mode: MusicMode, t: number, n: Note, beat: number): void {
  const inst = INST[mode][n.voice];
  if (!inst) return;
  const f = hz(n.midi);
  // Lower strings ring longer, higher ones die faster.
  const dec = inst.dec * Math.min(2.2, Math.max(0.5, Math.sqrt(261.6 / f)));
  const peak = (mode === "game" ? 1.0 : 1.4) * n.vel * GAIN[n.voice]; // calibrated offline: about -31 (menu) and -34 (field) dBFS RMS at the default volumes
  const g = ctx.createGain();
  let node: AudioNode = g;
  if (inst.lp) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = inst.lp;
    g.connect(lp);
    node = lp;
  }
  node.connect(out);
  env(g.gain, t, peak, inst.atk, dec);
  const end = t + inst.atk + dec * 1.5;
  const copies = inst.detune ? [0, inst.detune] : [0];
  for (const cents of copies) {
    for (const [ratio, amp] of inst.partials) {
      if (f * ratio > 9000) continue;
      const o = ctx.createOscillator();
      o.type = ratio === 1 ? (inst.type ?? "sine") : "sine";
      o.frequency.value = f * ratio;
      o.detune.value = cents;
      const pg = ctx.createGain();
      pg.gain.value = amp / copies.length;
      o.connect(pg);
      pg.connect(g);
      o.start(t);
      o.stop(end);
    }
  }
  if (inst.hammer) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffers(ctx).pink;
    const bp = ctx.createBiquadFilter();
    bp.type = "lowpass";
    bp.frequency.value = Math.min(4000, f * 5);
    const hg = ctx.createGain();
    env(hg.gain, t, peak * inst.hammer, 0.001, 0.05);
    s.connect(bp);
    bp.connect(hg);
    hg.connect(out);
    s.start(t, (n.midi * 0.137) % 3);
    s.stop(t + 0.09);
  }
}

/** A stem's gain below this is silent: its bars are not scheduled (no nodes are made for what nobody hears). */
const STEM_AUDIBLE = 0.012;

/** The tone filter's cut-off (Hz) for the given stem gains: the game bed is at 3600; the aftermath's dirge closes it to 2400 (darker), and the drums open it a little (brighter). */
export const toneCutoff = (g: Readonly<Record<MusicLayerId, number>>): number => 3600 - 1200 * Math.min(1, g.dirge) + 500 * Math.min(1, g.drive);

class MusicPlayer {
  private wanted: MusicMode | null = null;
  private playing: MusicMode | null = null;
  private out: GainNode | undefined;
  private tone: BiquadFilterNode | undefined;
  /** Game mode: the fade gain of the combat stems (the bed has `out`) and their own tone filter, which feeds `engine.duck.stems`, not the bed's heavy duck. */
  private outStems: GainNode | undefined;
  private stemTone: BiquadFilterNode | undefined;
  /** Per-stem output gains (game mode only), and the targets the mood driver last asked for. */
  private stem: Record<MusicLayerId, GainNode> | undefined;
  private readonly want: Record<MusicLayerId, number> = { bed: 1, pulse: 0, dread: 0, drive: 0, stabs: 0, dirge: 0, colour: 0 };
  private duck = 1;
  private region: RegionId = "hollowmere";
  private timer: ReturnType<typeof setInterval> | undefined;
  private barStart = 0;
  private bar = 0;
  private phrase = 0;
  private bars: Note[][] = [];

  start(mode: MusicMode): void {
    this.wanted = mode;
    engine.whenReady(() => this.switchTo(mode));
  }

  stop(): void {
    this.wanted = null;
    this.fadeOutCurrent();
    this.playing = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get mode(): MusicMode | null {
    return this.wanted;
  }

  /** The region whose colour stem plays (takes effect from the next bar). */
  setRegion(region: RegionId): void {
    this.region = region;
  }

  /**
   * The mood driver's live gains (0..1 per stem) and the parley duck (0..1 on everything). Safe to call every frame and before the music has started: the
   * values are kept and applied the moment the game version begins.
   */
  setMix(gain: Readonly<Record<MusicLayerId, number>>, duck = 1): void {
    this.duck = duck;
    for (const id of MUSIC_LAYERS) this.want[id] = gain[id];
    this.applyMix();
    const ctx = engine.ctx;
    if (this.stemTone && ctx) this.stemTone.frequency.setTargetAtTime(toneCutoff(gain), ctx.currentTime, 0.8);
  }

  private applyMix(): void {
    const ctx = engine.ctx;
    if (!ctx || !this.stem) return;
    for (const id of MUSIC_LAYERS) this.stem[id].gain.setTargetAtTime(this.want[id] * this.duck, ctx.currentTime, 0.25);
  }

  private fadeOutCurrent(): void {
    const ctx = engine.ctx;
    const old = this.out;
    if (!ctx || !old) return;
    for (const g of [old, this.outStems]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => g.disconnect(), 3500);
    }
    this.out = undefined;
    this.outStems = undefined;
    this.tone = undefined;
    this.stemTone = undefined;
    this.stem = undefined;
  }

  private switchTo(mode: MusicMode): void {
    const ctx = engine.ctx;
    if (!ctx || this.wanted !== mode || this.playing === mode) return;
    this.fadeOutCurrent();
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.7);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = mode === "menu" ? 5200 : 3600;
    const send = ctx.createGain();
    send.gain.value = mode === "menu" ? 0.3 : 0.55;
    out.connect(tone);
    this.tone = tone;
    tone.connect(engine.duck.music);
    tone.connect(send);
    send.connect(engine.reverbSend.music);
    if (mode === "game") {
      // The stems fade in with the bed but travel their own way: a lighter blast duck (mixDuck.ts) and a tone filter the mood closes (the dirge) or opens (the drums).
      const outStems = ctx.createGain();
      outStems.gain.value = 0;
      outStems.gain.setTargetAtTime(1, ctx.currentTime, 0.7);
      const stemTone = ctx.createBiquadFilter();
      stemTone.type = "lowpass";
      stemTone.frequency.value = toneCutoff(this.want);
      outStems.connect(stemTone);
      stemTone.connect(engine.duck.stems);
      stemTone.connect(send);
      const stem = {} as Record<MusicLayerId, GainNode>;
      for (const id of MUSIC_LAYERS) {
        const g = ctx.createGain();
        g.gain.value = this.want[id] * this.duck;
        g.connect(id === "bed" ? out : outStems);
        stem[id] = g;
      }
      this.outStems = outStems;
      this.stemTone = stemTone;
      this.stem = stem;
    }
    this.out = out;
    this.playing = mode;
    this.barStart = ctx.currentTime + 0.25;
    this.bar = 0;
    this.phrase = 0;
    this.bars = generatePhrase(mode, SEED, 0);
    this.timer ??= setInterval(() => this.pump(), 120);
  }

  /** Renders this bar of every audible stem (the same layers the offline tests measure) into its gain. */
  private scheduleStems(ctx: AudioContext, stem: Record<MusicLayerId, GainNode>): void {
    for (const id of MUSIC_LAYERS) {
      if (id === "bed" || this.want[id] * this.duck < STEM_AUDIBLE) continue;
      const rng = new Rng(hash3(SEED, this.phrase * 8 + this.bar, 0x7a11 + MUSIC_LAYERS.indexOf(id)));
      renderLayers(ctx, stem[id], this.barStart, stemBar(id, this.region, this.phrase, this.bar), { rng });
    }
  }

  private pump(): void {
    const ctx = engine.ctx;
    const mode = this.playing;
    if (!ctx || !mode || !this.out) return;
    const info = MODES[mode];
    const beat = beatSeconds(mode);
    while (this.barStart < ctx.currentTime + 0.6) {
      const notes = this.bars[this.bar] ?? [];
      const bedOut = this.stem ? this.stem.bed : this.out;
      if (!this.stem || this.want.bed * this.duck >= STEM_AUDIBLE) for (const n of notes) playNote(ctx, bedOut, mode, this.barStart + n.beat * beat, n, beat);
      if (this.stem) this.scheduleStems(ctx, this.stem);
      this.barStart += info.beats * beat;
      if (++this.bar >= info.bars) {
        this.bar = 0;
        this.phrase++;
        this.bars = generatePhrase(mode, SEED, this.phrase);
      }
    }
  }
}

export const music = new MusicPlayer();
