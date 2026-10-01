import { describe, expect, it } from "vitest";
import { Engine, type Ctor } from "./engine.ts";
import { LAYER_TARGET, MUSIC_LAYERS, newMusicState, stepMusic } from "./musicLayers.ts";
import { toneCutoff } from "./music.ts";
import { BLAST_FULL_AT, BLAST_HOLD, BLAST_STEM_DB, COMBAT_AMBIENCE_DB, ambienceMood, stemBlastLevel } from "./mixDuck.ts";
import { dbToGain, gainToDb } from "./volume.ts";

/** The mix rules: the ambience -6 dB in a fight, the stems -4 dB for 0.6 s under a blast, everything half under a parley; each as a pure number, then through the engine's graph. */

describe("the numbers", () => {
  it("the ambience is untouched on a quiet field and -6 dB at full combat drums, easing between", () => {
    const st = newMusicState();
    expect(ambienceMood(st)).toBeCloseTo(1, 6);
    st.gain.drive = LAYER_TARGET.combat.drive;
    expect(gainToDb(ambienceMood(st))).toBeCloseTo(COMBAT_AMBIENCE_DB, 3);
    st.gain.drive = 0.5;
    expect(gainToDb(ambienceMood(st))).toBeGreaterThan(COMBAT_AMBIENCE_DB);
    expect(gainToDb(ambienceMood(st))).toBeLessThan(0);
  });

  it("a parley halves everything on top of the mood", () => {
    const st = newMusicState();
    st.parleyDuck = 0.5;
    expect(ambienceMood(st)).toBeCloseTo(0.5, 6);
    st.gain.drive = 1;
    expect(ambienceMood(st)).toBeCloseTo(0.5 * dbToGain(COMBAT_AMBIENCE_DB), 6);
  });

  it("the blast duck is up to 4 dB for 0.6 s: none for a whisper, monotone, never deeper than -4 dB", () => {
    expect(BLAST_STEM_DB).toBe(-4);
    expect(BLAST_HOLD).toBeCloseTo(0.6, 6);
    expect(stemBlastLevel(0)).toBe(1);
    expect(stemBlastLevel(0.05)).toBe(1);
    let prev = 1;
    for (let a = 0.1; a <= 1.5; a += 0.1) {
      const l = stemBlastLevel(a);
      expect(l).toBeLessThanOrEqual(prev + 1e-12);
      expect(gainToDb(l)).toBeGreaterThanOrEqual(BLAST_STEM_DB - 1e-6);
      prev = l;
    }
    expect(gainToDb(stemBlastLevel(BLAST_FULL_AT))).toBeCloseTo(BLAST_STEM_DB, 3);
    expect(gainToDb(stemBlastLevel(3))).toBeCloseTo(BLAST_STEM_DB, 3);
  });

  it("the driver's duck under a parley reaches half and returns (the music side of 'everything ducks to half')", () => {
    const st = newMusicState();
    for (let t = 0; t < 3; t += 1 / 30) stepMusic(st, { ...sig(), parley: true }, 1 / 30);
    expect(st.parleyDuck).toBeCloseTo(0.5, 1);
    expect(ambienceMood(st)).toBeCloseTo(0.5, 1);
    for (let t = 0; t < 3; t += 1 / 30) stepMusic(st, sig(), 1 / 30);
    expect(ambienceMood(st)).toBeGreaterThan(0.95);
  });

  it("the tone filter: the dirge closes it, the drums open it, and it never leaves the audible band", () => {
    const calm = toneCutoff(LAYER_TARGET.calm);
    expect(toneCutoff(LAYER_TARGET.aftermath)).toBeLessThan(calm);
    expect(toneCutoff(LAYER_TARGET.combat)).toBeGreaterThan(calm);
    for (const m of Object.values(LAYER_TARGET)) {
      expect(toneCutoff(m)).toBeGreaterThan(1500);
      expect(toneCutoff(m)).toBeLessThan(6000);
    }
    expect(MUSIC_LAYERS.length).toBe(7);
  });
});

const sig = () => ({ region: "hollowmere" as const, frozen: false, hostilesAware: 0, hostilesNear: 0, shotsHeard: 0, selfDowned: false, alliesDowned: 0, deathsNear: 0, scenario: "idle" as const, parley: false });

// ---- through the engine's graph ----------------------------------------------------------------------------------------------------------

class Param {
  value = 0;
  targets: number[] = [];
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    this.targets.push(v);
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  pan = new Param();
  playbackRate = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  curve: unknown = null;
  connected: unknown[] = [];
  connect(n: unknown) {
    this.connected.push(n);
    return n;
  }
  disconnect() {
    this.connected = [];
  }
}
class Buf {
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {}
  getChannelData() {
    return new Float32Array(this.length);
  }
}
class Ctx {
  currentTime = 1;
  sampleRate = 8000;
  state = "running";
  destination = new Node();
  createGain = () => new Node();
  createBiquadFilter = () => new Node();
  createStereoPanner = () => new Node();
  createDynamicsCompressor = () => new Node();
  createConvolver = () => new Node();
  createWaveShaper = () => new Node();
  createBufferSource = () => new Node();
  createOscillator = () => new Node();
  createBuffer = (c: number, l: number, sr: number) => new Buf(c, l, sr);
  resume = () => Promise.resolve();
  suspend = () => Promise.resolve();
  close = () => Promise.resolve();
  addEventListener() {}
}

describe("in the engine's graph", () => {
  const make = (): Engine => {
    const e = new Engine();
    expect(e.init(Ctx as unknown as Ctor)).toBe(true);
    return e;
  };

  it("a cannon takes 4 dB off the combat stems for 0.6 s and puts them straight back; the bed's own duck is the engine's general one", () => {
    const e = make();
    const stems = e.duck.stems.gain as unknown as Param;
    e.duckFor(0.8, 2, 1);
    expect(stems.targets.length).toBe(2);
    expect(gainToDb(stems.targets[0]!)).toBeCloseTo(BLAST_STEM_DB, 2);
    expect(stems.targets[1]).toBe(1);
    const music = e.duck.music.gain as unknown as Param;
    expect(music.targets[0]).toBeLessThan(0.3); // the jolly bed still ducks hard under a cannon: it is the thing a gun may drown
    e.dispose();
  });

  it("a musket barely touches the stems", () => {
    const e = make();
    const stems = e.duck.stems.gain as unknown as Param;
    e.duckFor(0.2, 0.3, 1);
    expect(gainToDb(stems.targets[0]!)).toBeGreaterThan(-1.5);
    e.dispose();
  });

  it("the ambience mood stage sits in series after the duck and is set within 0..1; with no context it is a silent no-op", () => {
    const e = make();
    const mood = e.mood.ambience.gain as unknown as Param;
    e.setAmbienceMood(0.5);
    e.setAmbienceMood(7);
    e.setAmbienceMood(-3);
    expect(mood.targets).toEqual([0.5, 1, 0]);
    const wired = (n: GainNode): unknown[] => (n as unknown as Node).connected;
    expect(wired(e.duck.ambience)).toContain(e.mood.ambience);
    expect(wired(e.mood.ambience)).toContain(e.buses.ambience);
    expect(wired(e.duck.stems)).toContain(e.buses.music);
    e.dispose();
    expect(() => new Engine().setAmbienceMood(0.5)).not.toThrow();
  });
});
