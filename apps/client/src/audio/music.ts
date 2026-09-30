import { engine } from "./engine.ts";
import { beatSeconds, generatePhrase, MODES, type MusicMode, type MusicVoice, type Note } from "./musicScore.ts";
import { env, noiseBuffers } from "./dsp.ts";

/**
 * Plays the generative score (musicScore.ts) with a few hand-built instruments: a parlour piano (a struck string: a fundamental and
 * a few decaying partials, a soft hammer of filtered noise), a music-box tune, a harp-like pluck and a slow pad. A 120 ms timer schedules
 * bars 0.6 s ahead on the audio clock, so a busy frame never stutters the rhythm. Fades between the menu and the game versions.
 */

const SEED = 0xc0ffee;
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
  game: {
    melody: { partials: [[1, 1], [2.76, 0.07], [5.4, 0.03]], dec: 2.2, atk: 0.01, detune: 3 }, // a soft bell
    bass: { partials: [[1, 1], [2, 0.2]], dec: 2.6, atk: 0.35, lp: 500 },
    pad: { partials: [[1, 1]], dec: 3.5, atk: 1.2, type: "triangle", detune: 9, lp: 1000 },
    arp: { partials: [[1, 1], [2, 0.25]], dec: 1.0, atk: 0.004, type: "triangle", hammer: 0.12 },
  },
};

const GAIN: Record<MusicVoice, number> = { melody: 0.5, bass: 0.55, chord: 0.5, arp: 0.5, pad: 0.4 };

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

class MusicPlayer {
  private wanted: MusicMode | null = null;
  private playing: MusicMode | null = null;
  private out: GainNode | undefined;
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

  private fadeOutCurrent(): void {
    const ctx = engine.ctx;
    const old = this.out;
    if (!ctx || !old) return;
    old.gain.cancelScheduledValues(ctx.currentTime);
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    setTimeout(() => old.disconnect(), 3500);
    this.out = undefined;
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
    tone.connect(engine.duck.music);
    tone.connect(send);
    send.connect(engine.reverbSend.music);
    this.out = out;
    this.playing = mode;
    this.barStart = ctx.currentTime + 0.25;
    this.bar = 0;
    this.phrase = 0;
    this.bars = generatePhrase(mode, SEED, 0);
    this.timer ??= setInterval(() => this.pump(), 120);
  }

  private pump(): void {
    const ctx = engine.ctx;
    const mode = this.playing;
    if (!ctx || !mode || !this.out) return;
    const info = MODES[mode];
    const beat = beatSeconds(mode);
    while (this.barStart < ctx.currentTime + 0.6) {
      const notes = this.bars[this.bar] ?? [];
      for (const n of notes) playNote(ctx, this.out, mode, this.barStart + n.beat * beat, n, beat);
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
