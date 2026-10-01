import { CAMP, Rng, type RegionId } from "@cb/shared";
import { engine } from "./engine.ts";
import { ambienceTargets, daylight, newTargets, type AmbienceTargets } from "./ambienceMix.ts";
import { RegionSchedule, stepRegionAmbience } from "./ambienceRegion.ts";
import { readAtmosphere } from "./atmosphereSource.ts";
import { noiseBuffers, type NoiseKind } from "./dsp.ts";
import type { Listener } from "./spatial.ts";

/**
 * The soundscape: continuous beds (wind, rain, crickets, the fire, the stream and waterfall) made from looped noise and oscillators, plus events
 * scheduled from a 10 Hz timer (birdsong, fire pops and snaps, thunder). All of it follows `ambienceTargets`, a pure function of the listener,
 * the weather and the hour. Beds are built by `buildBeds` against any BaseAudioContext so an offline render can measure their levels.
 */

export interface Beds {
  /** Sets every bed toward `t`. `immediate` snaps (offline renders); otherwise gains glide over ~0.6 s. */
  apply(t: AmbienceTargets, now: number, immediate: boolean): void;
  stop(now: number): void;
}

export function buildBeds(ctx: BaseAudioContext, out: AudioNode, opts: { rng: Rng; start?: number }): Beds {
  const noise = noiseBuffers(ctx);
  const t0 = opts.start ?? 0;
  const stoppers: AudioScheduledSourceNode[] = [];
  const loop = (kind: NoiseKind, rate = 1): AudioBufferSourceNode => {
    const s = ctx.createBufferSource();
    s.buffer = noise[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t0, opts.rng.next() * 3);
    stoppers.push(s);
    return s;
  };
  const osc = (type: OscillatorType, hz: number): OscillatorNode => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.start(t0);
    stoppers.push(o);
    return o;
  };
  const gain = (v = 0): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const panner = (): StereoPannerNode => ctx.createStereoPanner();
  const lfo = (hz: number, depth: number, target: AudioParam, type: OscillatorType = "sine"): GainNode => {
    const o = osc(type, hz);
    const d = gain(depth);
    o.connect(d);
    d.connect(target);
    return d;
  };

  // Wind: dull moving air plus a thin whistle that only comes up in a gale.
  const windG = gain();
  const windLp = filt("lowpass", 700, 0.5);
  loop("pink", 0.7).connect(windLp);
  windLp.connect(windG);
  windG.connect(out);
  lfo(0.11, 0.05, windG.gain);
  lfo(0.07, 260, windLp.frequency);
  const whistleG = gain();
  const whistleBp = filt("bandpass", 900, 9);
  loop("white").connect(whistleBp);
  whistleBp.connect(whistleG);
  whistleG.connect(out);
  lfo(0.05, 260, whistleBp.frequency);
  lfo(0.13, 0.02, whistleG.gain);

  // Rain: hiss on leaves and canvas, and a duller drumming underneath.
  const rainG = gain();
  const rainHp = filt("highpass", 900);
  const rainLp = filt("lowpass", 6500);
  loop("white").connect(rainHp);
  rainHp.connect(rainLp);
  rainLp.connect(rainG);
  rainG.connect(out);
  const drumG = gain();
  const drumBp = filt("bandpass", 350, 0.5);
  loop("pink", 1.1).connect(drumBp);
  drumBp.connect(drumG);
  drumG.connect(out);

  // Crickets: three sine voices, each gated into chirps by a fast pulse and a slow phrase.
  const cricketOut = gain();
  cricketOut.connect(out);
  const cricketLp = filt("lowpass", 6200);
  cricketLp.connect(cricketOut);
  const voices: [number, number, number, number][] = [
    [4300, 26, 2.1, -0.7],
    [4650, 29, 2.7, 0.15],
    [5100, 31, 3.3, 0.8],
  ];
  for (const [hz, pulse, phrase, pan] of voices) {
    const o = osc("sine", hz);
    const am = gain(0.5);
    const gate = gain(0.5);
    const p = panner();
    p.pan.value = pan;
    o.connect(am);
    am.connect(gate);
    gate.connect(p);
    p.connect(cricketLp);
    lfo(pulse, 0.5, am.gain);
    lfo(phrase, 0.5, gate.gain);
  }

  // The camp fire: a low roar (positional; the pops come from the scheduler).
  const fireG = gain();
  const fireLp = filt("lowpass", 520, 0.6);
  const fireCut = filt("lowpass", 20000);
  const fireP = panner();
  loop("brown", 1).connect(fireLp);
  fireLp.connect(fireG);
  fireG.connect(fireCut);
  fireCut.connect(fireP);
  fireP.connect(out);
  lfo(3.1, 0.12, fireG.gain);
  const fireHiss = gain();
  const fireHissBp = filt("bandpass", 2600, 0.7);
  loop("white", 0.9).connect(fireHissBp);
  fireHissBp.connect(fireHiss);
  fireHiss.connect(fireCut);

  // The stream: three wandering bands of water noise.
  const streamG = gain();
  const streamP = panner();
  streamG.connect(streamP);
  streamP.connect(out);
  const bands: [number, number, number][] = [
    [620, 4, 0.7],
    [1150, 6, 1.1],
    [2300, 7, 1.7],
  ];
  for (const [hz, q, rate] of bands) {
    const bpf = filt("bandpass", hz, q);
    const g = gain(0.5);
    loop("white", 0.8 + rate * 0.1).connect(bpf);
    bpf.connect(g);
    g.connect(streamG);
    lfo(rate, hz * 0.18, bpf.frequency);
    lfo(rate * 0.6, 0.25, g.gain);
  }
  // The waterfall: a broad rush.
  const fallG = gain();
  const fallP = panner();
  const fallLp = filt("lowpass", 1900, 0.5);
  const fallHp = filt("highpass", 260, 0.5);
  loop("pink", 1.3).connect(fallLp);
  fallLp.connect(fallHp);
  fallHp.connect(fallG);
  fallG.connect(fallP);
  fallP.connect(out);

  const set = (p: AudioParam, v: number, now: number, imm: boolean): void => {
    if (imm) p.setValueAtTime(v, now);
    else p.setTargetAtTime(v, now, 0.6);
  };
  return {
    apply(t, now, imm) {
      set(windG.gain, 0.6 * t.wind, now, imm);
      set(whistleG.gain, 0.05 * t.whistle, now, imm);
      set(rainG.gain, 0.3 * t.rain, now, imm);
      set(drumG.gain, 0.34 * t.rain, now, imm);
      set(cricketOut.gain, 0.09 * t.crickets, now, imm);
      set(fireG.gain, 0.7 * t.fire.gain, now, imm);
      set(fireHiss.gain, 0.05 * t.fire.gain, now, imm);
      set(fireCut.frequency, t.fire.cutoff, now, imm);
      set(fireP.pan, t.fire.pan, now, imm);
      set(streamG.gain, 1.1 * t.stream.gain, now, imm);
      set(streamP.pan, t.stream.pan, now, imm);
      set(fallG.gain, 0.7 * t.falls.gain, now, imm);
      set(fallP.pan, t.falls.pan, now, imm);
    },
    stop(now) {
      for (const s of stoppers) {
        try {
          s.stop(now + 0.05);
        } catch {
          /* not started */
        }
      }
    },
  };
}

// ---- runtime ---------------------------------------------------------------------------------------------------------------------------

const targets = newTargets();
const rng = new Rng(0xb1d5);

class AmbiencePlayer {
  private beds: Beds | undefined;
  private wanted = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private birdIn = 2;
  private popIn = 0.3;
  private snapIn = 3;
  private lastThunder: number | null = null;
  private last = 0;
  private region: RegionId = "hollowmere";
  private schedule: RegionSchedule | undefined;

  /** The region the listener is in: its landmark beds and its own voices (ambienceRegion.ts) follow. */
  setRegion(region: RegionId): void {
    if (region === this.region && this.schedule) return;
    this.region = region;
    this.schedule = new RegionSchedule(region, rng);
  }

  private readonly emit = (sound: string, key: string, az: number, dist: number, height: number, volume: number): void => {
    const l = engine.listener;
    engine.play(sound, { x: l.x + Math.cos(az) * dist, y: l.y + height, z: l.z + Math.sin(az) * dist, volume, key: key === "" ? undefined : key, seed: Math.floor(rng.next() * 6) });
  };

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    engine.whenReady(() => this.build());
  }

  stop(): void {
    this.wanted = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const ctx = engine.ctx;
    if (this.beds && ctx) {
      // Fade the whole ambience bus's duck gain out, then drop the nodes.
      const now = ctx.currentTime;
      engine.duck.ambience.gain.cancelScheduledValues(now);
      engine.duck.ambience.gain.setTargetAtTime(0, now, 0.3);
      const beds = this.beds;
      this.beds = undefined;
      setTimeout(() => {
        beds.stop(ctx.currentTime);
        engine.duck.ambience.gain.setValueAtTime(1, ctx.currentTime);
      }, 1500);
    }
  }

  private build(): void {
    const ctx = engine.ctx;
    if (!this.wanted || !ctx || this.beds) return;
    this.beds = buildBeds(ctx, engine.duck.ambience, { rng, start: ctx.currentTime });
    this.last = performance.now();
    this.lastThunder = readAtmosphere().thunderAt;
    this.timer = setInterval(() => this.update(), 100);
    this.update(true);
  }

  private update(immediate = false): void {
    const ctx = engine.ctx;
    if (!this.beds || !ctx) return;
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    const a = readAtmosphere();
    ambienceTargets(engine.listener, a, targets, this.region);
    this.beds.apply(targets, ctx.currentTime, immediate);

    const l: Listener = engine.listener;
    // Birdsong: a phrase every few seconds by day, from a random tree.
    this.birdIn -= dt;
    if (this.birdIn <= 0) {
      const chance = targets.birds;
      this.birdIn = 1.2 + rng.next() * 3.4 + (1 - chance) * 8;
      if (chance > 0.2 && rng.next() < chance) {
        const az = rng.next() * Math.PI * 2;
        const d = 14 + rng.next() * 34;
        engine.play("bird", { x: l.x + Math.cos(az) * d, y: l.y + 4 + rng.next() * 6, z: l.z + Math.sin(az) * d, volume: 0.7 + rng.next() * 0.3, seed: Math.floor(rng.next() * 8) });
      }
    }
    // The region's own voices: surf, lamp chains, herd bells, drips, a wind-pump, frogs...
    this.schedule ??= new RegionSchedule(this.region, rng);
    stepRegionAmbience(this.schedule, dt, daylight(a.hour), a.rain, rng, this.emit);
    // The fire: pops and the odd snap, only when close enough to matter.
    if (targets.fire.gain > 0.02) {
      const f = CAMP.fire;
      this.popIn -= dt;
      if (this.popIn <= 0) {
        this.popIn = 0.06 + rng.next() * rng.next() * 0.5;
        engine.play("fire_pop", { x: f.x + (rng.next() - 0.5) * 0.4, y: l.y, z: f.z + (rng.next() - 0.5) * 0.4, volume: 0.6 + rng.next() * 0.4, seed: Math.floor(rng.next() * 8) });
      }
      this.snapIn -= dt;
      if (this.snapIn <= 0) {
        this.snapIn = 1.5 + rng.next() * 4;
        engine.play("fire_snap", { x: f.x, y: l.y, z: f.z, seed: Math.floor(rng.next() * 4) });
      }
    }
    // Thunder: each new arrival time is one clap; wait until the moment the environment says it arrives.
    if (a.thunderAt !== null && a.thunderAt !== this.lastThunder) {
      const wait = Math.min(12, Math.max(0, a.thunderAt - performance.now() / 1000));
      const seed = Math.floor(rng.next() * 3);
      const volume = 0.6 + 0.4 * Math.min(1, a.rain + 0.3);
      setTimeout(() => engine.play("thunder", { seed, volume }), wait * 1000);
    }
    this.lastThunder = a.thunderAt;
  }
}

export const ambience = new AmbiencePlayer();
