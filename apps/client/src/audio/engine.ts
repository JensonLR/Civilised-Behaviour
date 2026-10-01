import { Rng } from "@cb/shared";
import { SoundBank } from "./bake.ts";
import { CaptionGate, captionFor } from "./captions.ts";
import { noiseBuffers } from "./dsp.ts";
import { SOUNDS, type SoundDef } from "./sounds.ts";
import { newSpatial, spatialise, type Listener } from "./spatial.ts";
import { VoicePool } from "./voicePool.ts";
import { VOLUME_CHANNELS, clamp01, volumeToGain, type VolumeChannel } from "./volume.ts";

/**
 * The Web Audio graph and the player of baked effects.
 *
 *   effect voice (pooled chain) -> sfx bus ----+
 *   ambient voice (pooled chain) -> ambience bus (ducked) ---+--> master --> limiter --> speakers
 *   music, ambience beds ------------------------------------+
 *   every bus has a send into one shared convolution reverb (a generated room impulse), scaled by that bus's volume
 *
 * Everything is created lazily after the first user gesture (browsers refuse to start audio earlier) and everything is a safe no-op when
 * there is no AudioContext (tests, a locked-down browser): the public functions never throw and captions still work.
 */

export interface PlayOpts {
  /** World position of the sound. Omit for a non-positional (interface / own-body) sound. */
  x?: number;
  y?: number;
  z?: number;
  /** 0..1 gain multiplier (default 1). */
  volume?: number;
  /** Frequency multiplier (default 1). For loops, this can be changed while playing (a rising revive tone). */
  pitch?: number;
  /** A number that picks a variant deterministically: a look hash makes `hurt` sound like the same person each time. */
  seed?: number;
  /** Named version of the sound (`limb_sever`: full | reduced | off). */
  key?: string;
}

export type AudioState = "unsupported" | "idle" | "running" | "suspended";

interface Chain {
  gain: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
  send: GainNode;
  src: AudioBufferSourceNode | null;
  loopName: string;
}

interface Lane {
  pool: VoicePool;
  chains: Chain[];
}

const SFX_VOICES = 28;
const AMB_VOICES = 10;

export type Ctor = new (opts?: AudioContextOptions) => AudioContext;

/** Context state changes return promises that can reject (a locked-down browser, an offline context); nothing here needs the result. */
const settle = (p: Promise<void> | undefined): void => {
  void Promise.resolve(p).catch(() => undefined);
};

class Engine {
  ctx: AudioContext | undefined;
  state: AudioState = "idle";
  master!: GainNode;
  buses = {} as Record<"sfx" | "music" | "ambience", GainNode>;
  /** Duck gains sit between the music/ambience sources and their buses. */
  duck = {} as Record<"music" | "ambience", GainNode>;
  reverbIn!: GainNode;
  reverbSend = {} as Record<"sfx" | "music" | "ambience", GainNode>;
  sfx!: Lane;
  amb!: Lane;
  bank = new SoundBank();
  listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 };
  volumes: Record<VolumeChannel, number> = { master: 0.8, music: 0.6, sfx: 0.9, ambience: 0.8 };
  muteUnfocused = true;
  focused = true;
  readonly sp = newSpatial();
  readonly rng = new Rng(0xa0d10);
  readonly lastPlayed = new Map<string, number>();
  readonly loops = new Map<string, { chain: Chain; lane: Lane; slot: number; last: number }>();
  readonly gate = new CaptionGate();
  captionsOn = false;
  captionSinks: ((text: string) => void)[] = [];
  readyCallbacks: (() => void)[] = [];
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private gestureBound = false;
  ctor: Ctor | undefined;
  private duckedUntil = 0;

  constructor() {
    const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    this.ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!this.ctor) this.state = "unsupported";
  }

  get ready(): boolean {
    return this.ctx !== undefined && this.state === "running";
  }

  /** Creates the context and graph. Called from a user gesture; returns false when audio is unavailable. */
  init(ctor: Ctor | undefined = this.ctor): boolean {
    if (this.ctx) return true;
    if (!ctor) {
      this.state = "unsupported";
      return false;
    }
    try {
      const ctx = new ctor({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.build(ctx);
      this.state = ctx.state === "running" ? "running" : "suspended";
      settle(ctx.resume?.());
      ctx.addEventListener?.("statechange", () => {
        this.state = ctx.state === "running" ? "running" : "suspended";
        if (this.state === "running") this.fireReady();
      });
      this.tickTimer = setInterval(() => this.tick(), 100);
      if (this.state === "running") this.fireReady();
      void this.bakeAll();
      return true;
    } catch (e) {
      console.warn("audio: unavailable", e);
      this.ctx = undefined;
      this.state = "unsupported";
      return false;
    }
  }

  private fireReady(): void {
    const cbs = this.readyCallbacks;
    this.readyCallbacks = [];
    for (const cb of cbs) cb();
  }

  /** Runs `cb` as soon as the context is running (immediately if it already is). Used by ambience and music to start on the first gesture. */
  whenReady(cb: () => void): void {
    if (this.ready) cb();
    else if (this.state !== "unsupported") this.readyCallbacks.push(cb);
  }

  private build(ctx: AudioContext): void {
    const g = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 10;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.14;
    this.master = g(0);
    this.master.connect(limiter);
    // Last line of defence: a soft clipper that can never exceed full scale, however many cannons the sum of a battle adds up to.
    const safety = ctx.createWaveShaper();
    safety.curve = safetyCurve();
    limiter.connect(safety);
    safety.connect(ctx.destination);

    for (const b of ["sfx", "music", "ambience"] as const) {
      this.buses[b] = g(0);
      this.buses[b].connect(this.master);
    }
    // Music and ambience pass through a duck gain first, so a cannon can push the world down for a moment.
    this.duck.music = g(1);
    this.duck.music.connect(this.buses.music);
    this.duck.ambience = g(1);
    this.duck.ambience.connect(this.buses.ambience);

    // Shared reverb: sends are taken after each bus's own volume, so turning a channel down turns its reverb down too.
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.4, this.rng);
    this.reverbIn = g(1);
    const revOut = g(0.5);
    this.reverbIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(this.master);
    for (const b of ["sfx", "music", "ambience"] as const) {
      this.reverbSend[b] = g(0);
      this.reverbSend[b].connect(this.reverbIn);
    }

    this.sfx = this.makeLane(ctx, SFX_VOICES, this.buses.sfx, this.reverbSend.sfx);
    this.amb = this.makeLane(ctx, AMB_VOICES, this.duck.ambience, this.reverbSend.ambience);
    this.applyVolumes();
  }

  private makeLane(ctx: AudioContext, n: number, bus: AudioNode, rev: AudioNode): Lane {
    const chains: Chain[] = [];
    for (let i = 0; i < n; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 20000;
      lp.Q.value = 0.5;
      const pan = ctx.createStereoPanner();
      const send = ctx.createGain();
      send.gain.value = 0;
      gain.connect(lp);
      lp.connect(pan);
      pan.connect(bus);
      lp.connect(send);
      send.connect(rev);
      chains.push({ gain, lp, pan, send, src: null, loopName: "" });
    }
    return { pool: new VoicePool(n), chains };
  }

  // ---- volumes ---------------------------------------------------------------------------------------------------------------------

  setVolume(ch: VolumeChannel, v: number): void {
    this.volumes[ch] = clamp01(v);
    this.applyVolumes();
  }

  setFocused(f: boolean): void {
    this.focused = f;
    this.applyVolumes();
  }

  applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const silent = this.muteUnfocused && !this.focused;
    this.master.gain.setTargetAtTime(silent ? 0 : volumeToGain(this.volumes.master), t, 0.04);
    for (const b of ["sfx", "music", "ambience"] as const) {
      const g = volumeToGain(this.volumes[b]);
      this.buses[b].gain.setTargetAtTime(g, t, 0.04);
      this.reverbSend[b].gain.setTargetAtTime(g, t, 0.04);
    }
    // Free the audio thread while the window is in the background and muted.
    if (silent) settle(ctx.suspend?.());
    else if (ctx.state === "suspended" && this.focused) settle(ctx.resume?.());
  }

  // ---- baking ------------------------------------------------------------------------------------------------------------------------

  /** Bakes every effect, most needed first, one at a time so a slow machine never stalls a frame. */
  async bakeAll(): Promise<void> {
    const order = ["ui", "foot", "body", "weapon", "impact", "world", "ambient"];
    const names = Object.keys(SOUNDS).sort((a, b) => order.indexOf(SOUNDS[a]!.group) - order.indexOf(SOUNDS[b]!.group));
    for (const n of names) await this.bank.ensure(n);
  }

  // ---- captions ----------------------------------------------------------------------------------------------------------------------

  private caption(name: string, o: PlayOpts, def: SoundDef): void {
    if (!this.captionsOn || this.captionSinks.length === 0) return;
    const now = performance.now() / 1000;
    if (!this.gate.accept(name, now, o.key)) return;
    const positional = o.x !== undefined && !def.ui;
    const text = captionFor(name, positional ? spatialise(this.listener, o.x!, o.y ?? this.listener.y, o.z ?? this.listener.z, def.ref, def.max, this.sp) : null, o.key);
    if (text) for (const s of this.captionSinks) s(text);
  }

  // ---- playing -----------------------------------------------------------------------------------------------------------------------

  play(name: string, o: PlayOpts = {}): void {
    const def = SOUNDS[name];
    if (!def) return;
    try {
      this.caption(name, o, def);
      if (!this.ready || !this.ctx) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const last = this.lastPlayed.get(name);
      if (def.gap > 0 && last !== undefined && now - last < def.gap) return;

      const key = o.key ?? def.keys[0]!;
      const variant = o.seed !== undefined && def.variants > 1 ? Math.abs(Math.floor(o.seed)) % def.variants : -1;
      const buf = this.bank.pick(name, key, variant);
      if (!buf) {
        void this.bank.ensure(name);
        return;
      }
      const lane = def.group === "ambient" ? this.amb : this.sfx;

      // Loops are kept alive by repeated calls and fade when the calls stop.
      if (def.loop > 0) {
        this.playLoop(name, def, lane, buf, o, now);
        return;
      }

      let gain = clamp01(o.volume ?? 1);
      let pan = 0;
      let cutoff = 20000;
      let wet = def.reverb;
      let delay = 0;
      if (o.x !== undefined && !def.ui) {
        const s = spatialise(this.listener, o.x, o.y ?? this.listener.y, o.z ?? this.listener.z, def.ref, def.max, this.sp);
        gain *= s.gain;
        pan = s.pan;
        cutoff = s.cutoff;
        wet = Math.min(0.9, def.reverb + s.wet * 0.6);
        delay = def.prio >= 3 ? s.delay : 0;
      }
      if (gain < 0.004) return;

      const rate = (o.pitch ?? 1) * (1 + (this.rng.next() * 2 - 1) * def.jitter);
      const start = now + delay;
      const end = start + buf.duration / rate;
      const slot = lane.pool.acquire(name, def.prio, def.cap, start, end, now);
      if (slot < 0) return;
      this.lastPlayed.set(name, now);
      const c = lane.chains[slot]!;
      let t0 = start;
      if (lane.pool.stolen === slot) {
        // Fade out whatever was on this chain, then begin the new voice a hair later so nothing clicks.
        c.gain.gain.cancelScheduledValues(now);
        c.gain.gain.setTargetAtTime(0, now, 0.004);
        try {
          c.src?.stop(now + 0.03);
        } catch {
          /* already stopped */
        }
        t0 = Math.max(start, now + 0.03);
      }
      c.src?.disconnect();
      c.gain.gain.cancelScheduledValues(t0);
      c.gain.gain.setValueAtTime(gain, t0);
      c.lp.frequency.setValueAtTime(cutoff, t0);
      c.pan.pan.setValueAtTime(pan, t0);
      c.send.gain.setValueAtTime(wet, t0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(c.gain);
      src.start(t0);
      c.src = src;
      lane.pool.setEnd(slot, t0 + buf.duration / rate);
      if (def.duck > 0) this.duckFor(def.duck * Math.min(1, gain * 1.5), buf.duration * 0.5, now);
    } catch (e) {
      console.warn("audio: play failed", name, e);
    }
  }

  private playLoop(name: string, def: SoundDef, lane: Lane, buf: AudioBuffer, o: PlayOpts, now: number): void {
    const ctx = this.ctx!;
    const live = this.loops.get(name);
    const gain = clamp01(o.volume ?? 1);
    if (live) {
      live.last = now;
      if (o.pitch !== undefined && live.chain.src) live.chain.src.playbackRate.setTargetAtTime(o.pitch, now, 0.05);
      live.chain.gain.gain.setTargetAtTime(gain, now, 0.05);
      return;
    }
    const slot = lane.pool.acquire(name, def.prio, def.cap, now, Infinity, now);
    if (slot < 0) return;
    const c = lane.chains[slot]!;
    c.src?.disconnect();
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(0, now);
    c.gain.gain.linearRampToValueAtTime(gain, now + 0.08);
    c.lp.frequency.setValueAtTime(20000, now);
    c.pan.pan.setValueAtTime(0, now);
    c.send.gain.setValueAtTime(def.reverb, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = o.pitch ?? 1;
    src.connect(c.gain);
    src.start(now);
    c.src = src;
    c.loopName = name;
    this.loops.set(name, { chain: c, lane, slot, last: now });
  }

  stop(name: string): void {
    const ctx = this.ctx;
    const l = this.loops.get(name);
    if (!ctx || !l) return;
    const now = ctx.currentTime;
    l.chain.gain.gain.cancelScheduledValues(now);
    l.chain.gain.gain.setTargetAtTime(0, now, 0.04);
    try {
      l.chain.src?.stop(now + 0.25);
    } catch {
      /* already stopped */
    }
    l.lane.pool.setEnd(l.slot, now + 0.25);
    this.loops.delete(name);
  }

  /** Pushes music and ambience down by `amount` (0..1) for `hold` seconds, then lets them back up slowly. */
  duckFor(amount: number, hold: number, now: number): void {
    if (!this.ctx) return;
    const level = 1 - Math.min(0.85, amount);
    for (const d of [this.duck.music, this.duck.ambience]) {
      d.gain.cancelScheduledValues(now);
      d.gain.setTargetAtTime(level, now, 0.02);
      d.gain.setTargetAtTime(1, now + Math.max(0.15, hold), 0.5);
    }
    this.duckedUntil = now + hold + 1.5;
  }

  /** Housekeeping at 10 Hz: frees finished voices' nodes and lets loops that stopped being refreshed fade. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const lane of [this.sfx, this.amb]) {
      if (!lane) continue;
      lane.pool.reap(now);
      for (let i = 0; i < lane.chains.length; i++) {
        const c = lane.chains[i]!;
        if (c.src && !lane.pool.isUsed(i)) {
          c.src.disconnect();
          c.src = null;
          c.loopName = "";
        }
      }
    }
    for (const [name, l] of this.loops) if (now - l.last > 0.4) this.stop(name);
  }

  /** Live voices (for tests and the debug overlay). */
  get voices(): number {
    return this.ctx && this.sfx ? this.sfx.pool.count(this.ctx.currentTime) + this.amb.pool.count(this.ctx.currentTime) : 0;
  }

  // ---- gesture -----------------------------------------------------------------------------------------------------------------------

  /** Installs one-shot listeners so the first click/key/touch creates and resumes the context (browsers require a gesture). */
  resumeOnGesture(): void {
    if (this.gestureBound || typeof window === "undefined" || this.state === "unsupported") return;
    this.gestureBound = true;
    const go = (): void => {
      if (!this.init()) return;
      if (this.ctx?.state === "suspended") settle(this.ctx.resume());
      if (this.ctx?.state === "running") {
        for (const ev of ["pointerdown", "keydown", "touchstart", "click"]) window.removeEventListener(ev, go, true);
      }
    };
    for (const ev of ["pointerdown", "keydown", "touchstart", "click"]) window.addEventListener(ev, go, true);
    // Mute-when-unfocused follows the window, not just the tab.
    window.addEventListener("blur", () => this.setFocused(false));
    window.addEventListener("focus", () => this.setFocused(true));
    document.addEventListener("visibilitychange", () => this.setFocused(!document.hidden && document.hasFocus()));
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    settle(this.ctx?.close?.());
    this.ctx = undefined;
  }

  get noise(): ReturnType<typeof noiseBuffers> | undefined {
    return this.ctx ? noiseBuffers(this.ctx) : undefined;
  }

  get channels(): readonly VolumeChannel[] {
    return VOLUME_CHANNELS;
  }
}

/** Transparent below 0.75 of full scale; above it a smooth knee that approaches but never reaches 1. */
export function safetyCurve(n = 2049): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a < 0.75 ? x : Math.sign(x) * (0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25));
  }
  return c;
}

/** A generated room: stereo noise under an exponential decay that gets darker as it dies away, after a short pre-delay. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(0.018 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lpState = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const decay = Math.exp((-6.9 * t) / seconds);
      // One-pole low-pass whose coefficient grows with time: high frequencies are absorbed first, like a real room.
      const a = 0.25 + 0.7 * Math.min(1, t / (seconds * 0.8));
      lpState = lpState * a + (rng.next() * 2 - 1) * (1 - a);
      d[i] = lpState * decay * 2.2;
    }
  }
  return buf;
}

export const engine = new Engine();
export { Engine };
