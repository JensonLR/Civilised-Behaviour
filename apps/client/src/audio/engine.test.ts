import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundBank } from "./bake.ts";
import { Engine, makeImpulse, type Ctor } from "./engine.ts";
import { SOUNDS } from "./sounds.ts";
import { Rng } from "@cb/shared";

/**
 * A stand-in for Web Audio: every node records what was connected and every AudioParam accepts scheduling calls. Enough to run the engine and
 * the offline renderer end to end in Node and to count what they create.
 */
class Param {
  value = 0;
  calls = 0;
  setValueAtTime(v: number) {
    this.value = v;
    this.calls++;
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
  targets: number[] = [];
  setTargetAtTime(v: number) {
    this.value = v;
    this.targets.push(v);
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
const created = { sources: 0, oscillators: 0, nodes: 0, starts: [] as number[] };
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  detune = new Param();
  pan = new Param();
  playbackRate = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  buffer: FakeBuffer | null = null;
  loop = false;
  type = "";
  curve: unknown = null;
  connected: unknown[] = [];
  stopped = false;
  constructor(kind = "") {
    created.nodes++;
    if (kind === "source") created.sources++;
    if (kind === "osc") created.oscillators++;
  }
  connect(n: unknown) {
    this.connected.push(n);
    return n;
  }
  disconnect() {
    this.connected = [];
  }
  start(t = 0) {
    created.starts.push(t);
  }
  stop() {
    this.stopped = true;
  }
}
class FakeBuffer {
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  private data: Float32Array[] = [];
  getChannelData(ch = 0) {
    return (this.data[ch] ??= new Float32Array(this.length));
  }
}
class FakeCtx {
  currentTime = 0;
  sampleRate = 44100;
  state = "running";
  destination = new Node();
  listener = {};
  createGain = () => new Node();
  createBiquadFilter = () => new Node();
  createStereoPanner = () => new Node();
  createDynamicsCompressor = () => new Node();
  createConvolver = () => new Node();
  createWaveShaper = () => new Node();
  createBufferSource = () => new Node(this instanceof FakeOffline ? "offline" : "source"); // only live (playing) sources are counted
  createOscillator = () => new Node("osc");
  createBuffer = (c: number, l: number, sr: number) => new FakeBuffer(c, l, sr);
  resume = () => Promise.resolve();
  suspend = () => Promise.resolve();
  close = () => Promise.resolve();
  addEventListener() {}
}
class FakeOffline extends FakeCtx {
  constructor(readonly channels: number, readonly length: number, sampleRate: number) {
    super();
    this.sampleRate = sampleRate;
  }
  startRendering() {
    return Promise.resolve(new FakeBuffer(1, this.length, this.sampleRate));
  }
}
const OfflineCtor = FakeOffline as unknown as ConstructorParameters<typeof SoundBank>[0];
const Ctor = FakeCtx as unknown as Ctor;

async function ready(names: string[] = Object.keys(SOUNDS)): Promise<Engine> {
  const e = new Engine();
  e.bank = new SoundBank(OfflineCtor);
  expect(e.init(Ctor)).toBe(true);
  await e.bakeAll(); // init started this in the background; wait for it so no baking is still counted as "playing" later
  for (const n of names) await e.bank.ensure(n);
  return e;
}

afterEach(() => vi.restoreAllMocks());

describe("no AudioContext at all (tests, headless, locked-down browsers)", () => {
  it("every entry point is a silent no-op, and init reports unavailable", () => {
    const e = new Engine();
    expect(e.state).toBe("unsupported");
    expect(e.ready).toBe(false);
    expect(e.init()).toBe(false);
    expect(() => {
      e.play("musket_shot", { x: 3, y: 0, z: 3 });
      e.play("no_such_sound");
      e.stop("revive_hold");
      e.setVolume("master", 0.3);
      e.setFocused(false);
      e.tick();
      e.duckFor(0.5, 1, 0);
      e.resumeOnGesture();
      e.whenReady(() => undefined);
    }).not.toThrow();
    expect(e.voices).toBe(0);
  });

  it("captions still appear when there is no sound, so a player on mute or without audio still gets them", () => {
    const e = new Engine();
    const lines: string[] = [];
    e.captionsOn = true;
    e.captionSinks.push((t) => lines.push(t));
    e.play("musket_shot", { x: -10, y: 0, z: 0 });
    e.play("cannon_shot", { x: 0, y: 0, z: -50 });
    e.play("footstep_grass", { x: 1, y: 0, z: 0 });
    expect(lines).toEqual(["[musket shot, left]", "[cannon fire, ahead]"]);
  });

  it("captions are off unless asked for", () => {
    const e = new Engine();
    const lines: string[] = [];
    e.captionSinks.push((t) => lines.push(t));
    e.play("musket_shot", { x: -10, y: 0, z: 0 });
    expect(lines).toEqual([]);
  });

  it("a constructor that throws (blocked audio) leaves the engine unsupported, not broken", () => {
    const e = new Engine();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const Boom = class {
      constructor() {
        throw new Error("NotAllowedError");
      }
    } as unknown as Ctor;
    expect(e.init(Boom)).toBe(false);
    expect(e.state).toBe("unsupported");
    expect(() => e.play("musket_shot")).not.toThrow();
  });

  it("the public API in index.ts never throws without audio", async () => {
    vi.resetModules();
    vi.stubGlobal("location", { search: "" });
    const a = await import("./index.ts");
    expect(() => {
      a.playSfx("musket_shot", { x: 1, y: 0, z: 1 });
      a.playSfx("limb_sever");
      a.stopSfx("revive_hold");
      a.setListener({ x: 1, y: 2, z: 3 }, 0.5);
      a.setMasterVolume(0.5);
      a.setChannelVolume("music", 0.2);
      a.startAmbience();
      a.stopAmbience();
      a.startMusic("menu");
      a.stopMusic();
      a.resumeOnGesture();
      a.footstep("grass", 3);
      a.previewCaption("[test]");
    }).not.toThrow();
    expect(a.audioState()).toBe("unsupported");
    const off = a.onCaption(() => undefined);
    off();
    vi.unstubAllGlobals();
  });
});

describe("with a (fake) AudioContext", () => {
  it("bakes every sound without error, all variants, and the buffers are the right length", async () => {
    const e = await ready();
    for (const [name, def] of Object.entries(SOUNDS)) {
      const baked = e.bank.get(name);
      expect(baked, name).toBeDefined();
      for (const key of def.keys) expect(baked!.buffers.get(key)!.length, `${name}/${key}`).toBe(def.variants);
    }
    expect(e.bank.pick("musket_shot")).toBeDefined();
    e.dispose();
  });

  it("aliases share one baked set instead of baking twice", async () => {
    const bank = new SoundBank(OfflineCtor);
    await bank.ensure("notice");
    await bank.ensure("telegram_bell");
    expect(bank.bakedCount).toBe(1);
    expect(bank.get("notice")).toBe(bank.get("telegram_bell"));
    expect(bank.has("telegram_bell")).toBe(true);
  });

  it("playing makes one source node; a sound that has not been baked yet is skipped and requested", async () => {
    const e = new Engine();
    e.bank = new SoundBank(OfflineCtor);
    e.bakeAll = async () => undefined; // nothing baked in the background: only what the test asks for
    e.init(Ctor);
    await e.bank.ensure("ui_click");
    const before = created.sources;
    e.play("ui_click");
    expect(created.sources - before).toBe(1);
    e.play("musket_shot", { x: 1, y: 0, z: 1 }); // not baked yet: skipped
    expect(created.sources - before).toBe(1);
    await Promise.resolve();
    await e.bank.ensure("musket_shot");
    expect(e.bank.has("musket_shot")).toBe(true); // ...and the miss asked for it to be baked
    e.dispose();
  });

  it("polyphony is capped per sound and overall, however hard the game hammers it", async () => {
    const e = await ready(["footstep_grass", "musket_shot", "impact_wood", "ui_click", "hurt", "down", "jump", "land", "pickup", "drop", "throw", "pistol_shot"]);
    const ctx = e.ctx as unknown as FakeCtx;
    for (let i = 0; i < 200; i++) {
      ctx.currentTime += 0.005;
      e.play("footstep_grass", { x: 1, y: 0, z: 1 });
      e.play("musket_shot", { x: 2, y: 0, z: 2 });
    }
    expect(e.sfx.pool.countOf("footstep_grass", ctx.currentTime)).toBeLessThanOrEqual(SOUNDS.footstep_grass!.cap);
    expect(e.sfx.pool.countOf("musket_shot", ctx.currentTime)).toBeLessThanOrEqual(SOUNDS.musket_shot!.cap);
    for (let i = 0; i < 300; i++) {
      ctx.currentTime += 0.031;
      for (const n of ["impact_wood", "ui_click", "hurt", "down", "jump", "land", "pickup", "drop", "throw", "pistol_shot"]) e.play(n, { x: (i % 7) - 3, y: 0, z: 1 });
      expect(e.voices).toBeLessThanOrEqual(28 + 10);
      expect(e.sfx.pool.count(ctx.currentTime)).toBeLessThanOrEqual(28);
    }
    e.dispose();
  });

  it("sounds beyond their audible range are never started", async () => {
    const e = await ready(["footstep_grass", "musket_shot"]);
    const before = created.sources;
    e.play("footstep_grass", { x: 500, y: 0, z: 0 });
    e.play("musket_shot", { x: 5000, y: 0, z: 0 });
    expect(created.sources).toBe(before);
    e.play("footstep_grass", { x: 5, y: 0, z: 0 });
    expect(created.sources).toBe(before + 1);
    e.dispose();
  });

  it("the minimum gap between repeats of a sound is honoured", async () => {
    const e = await ready(["musket_shot"]);
    const ctx = e.ctx as unknown as FakeCtx;
    const before = created.sources;
    e.play("musket_shot");
    e.play("musket_shot"); // same instant: inside the 30 ms gap
    ctx.currentTime += 0.05;
    e.play("musket_shot");
    expect(created.sources - before).toBe(2);
    e.dispose();
  });

  it("the revive loop is one voice kept alive by calls, and fades when they stop", async () => {
    const e = await ready(["revive_hold"]);
    const ctx = e.ctx as unknown as FakeCtx;
    const before = created.sources;
    for (let i = 0; i < 30; i++) {
      ctx.currentTime += 0.05;
      e.play("revive_hold", { pitch: 0.9 + i / 100 });
      e.tick();
    }
    expect(created.sources - before).toBe(1);
    expect(e.loops.size).toBe(1);
    ctx.currentTime += 1;
    e.tick();
    expect(e.loops.size).toBe(0);
    e.dispose();
  });

  it("stop() ends a loop at once", async () => {
    const e = await ready(["revive_hold"]);
    e.play("revive_hold");
    expect(e.loops.size).toBe(1);
    e.stop("revive_hold");
    expect(e.loops.size).toBe(0);
    e.dispose();
  });

  it("volumes go to the buses through the squared curve, and unfocused mutes the master", async () => {
    const e = await ready([]);
    e.setVolume("master", 0.5);
    e.setVolume("music", 0.2);
    expect((e.master.gain as unknown as Param).value).toBeCloseTo(0.25, 6);
    expect((e.buses.music.gain as unknown as Param).value).toBeCloseTo(0.04, 6);
    e.setFocused(false);
    expect((e.master.gain as unknown as Param).value).toBe(0);
    e.muteUnfocused = false;
    e.setFocused(false);
    expect((e.master.gain as unknown as Param).value).toBeCloseTo(0.25, 6);
    e.dispose();
  });

  it("loud sounds push the music and ambience down and then let them back up; quiet ones leave them alone", async () => {
    const e = await ready(["cannon_shot", "footstep_grass"]);
    const music = e.duck.music.gain as unknown as Param;
    e.play("footstep_grass", { x: 1, y: 0, z: 0 });
    expect(music.targets).toEqual([]);
    e.play("cannon_shot", { x: 3, y: 0, z: 0 });
    expect(music.targets.length).toBe(2);
    expect(music.targets[0]).toBeLessThan(0.5); // down hard...
    expect(music.targets[1]).toBe(1); // ...then back to full
    e.dispose();
  });

  it("gore level picks the version of the limb sound, and unknown keys fall back", async () => {
    const e = await ready(["limb_sever"]);
    for (const key of ["full", "reduced", "off", "bogus"]) expect(e.bank.pick("limb_sever", key)).toBeDefined();
    expect(e.bank.pick("limb_sever", "off")).not.toBe(e.bank.pick("limb_sever", "full"));
    e.dispose();
  });

  it("a seed picks the same hurt voice every time, different seeds differ", async () => {
    const e = await ready(["hurt"]);
    expect(e.bank.pick("hurt", "", 5)).toBe(e.bank.pick("hurt", "", 5));
    expect(e.bank.pick("hurt", "", 5)).not.toBe(e.bank.pick("hurt", "", 6));
    expect(e.bank.pick("hurt", "", 17)).toBe(e.bank.pick("hurt", "", 5)); // 17 % 12
    e.dispose();
  });
});

describe("reverb impulse", () => {
  it("is stereo, decays to near silence, and is finite", () => {
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const ir = makeImpulse(ctx, 2.4, new Rng(1));
    expect(ir.numberOfChannels).toBe(2);
    const d = ir.getChannelData(0);
    let early = 0;
    let late = 0;
    for (let i = 0; i < d.length; i++) {
      expect(Number.isFinite(d[i]!)).toBe(true);
      if (i < d.length / 4) early += d[i]! * d[i]!;
      if (i > (d.length * 3) / 4) late += d[i]! * d[i]!;
    }
    expect(late).toBeLessThan(early * 0.05);
    expect(ir.getChannelData(0)).not.toEqual(ir.getChannelData(1));
  });
});

describe("the expedition's world sounds through the engine (D-035)", () => {
  it("a gallop's beats and a bell's tolls stay inside their caps and the pool, and keys pick different buffers", async () => {
    const e = await ready(["hoof", "bell", "crew_shout", "tack_jingle"]);
    const ctx = e.ctx as unknown as FakeCtx;
    for (let i = 0; i < 400; i++) {
      ctx.currentTime += 0.05;
      e.play("hoof", { x: 3, y: 0, z: 2, key: "gallop" });
      e.play("tack_jingle", { x: 3, y: 1, z: 2 });
      if (i % 20 === 0) e.play("bell", { x: 10, y: 4, z: 0, key: i % 40 === 0 ? "hq" : "outpost" });
      expect(e.sfx.pool.countOf("hoof", ctx.currentTime)).toBeLessThanOrEqual(SOUNDS.hoof!.cap);
      expect(e.sfx.pool.count(ctx.currentTime)).toBeLessThanOrEqual(28);
    }
    expect(e.bank.pick("hoof", "gallop", 0)).not.toBe(e.bank.pick("hoof", "walk", 0));
    expect(e.bank.pick("bell", "hq", 0)).not.toBe(e.bank.pick("bell", "outpost", 0));
    expect(e.bank.pick("crew_shout", "fire", 0)).not.toBe(e.bank.pick("crew_shout", "loading", 0));
    e.dispose();
  });

  it("the sailing creak is one voice kept alive by calls (never positional), fades when they stop; the parley stamp is heard in the centre at full pan", async () => {
    const e = await ready(["sail_creak", "parley_stamp", "gull"]);
    const ctx = e.ctx as unknown as FakeCtx;
    const before = created.sources;
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.05;
      e.play("sail_creak", { volume: 0.85 });
      e.tick();
    }
    expect(created.sources - before).toBe(1);
    expect(e.loops.has("sail_creak")).toBe(true);
    ctx.currentTime += 1;
    e.tick();
    expect(e.loops.has("sail_creak")).toBe(false);
    e.play("parley_stamp", { x: 90, y: 0, z: 90 }); // a UI sound ignores where it is said to be
    e.play("gull", { x: 400, y: 0, z: 0, seed: 3 }); // ambient and non-positional too
    expect(created.sources - before).toBe(3);
    e.dispose();
  });

  it("keyed captions reach the player with the bearing, once, through the engine", () => {
    const e = new Engine();
    const lines: string[] = [];
    e.captionsOn = true;
    e.captionSinks.push((t) => lines.push(t));
    e.play("crew_shout", { x: -12, y: 0, z: 0, key: "fire" });
    e.play("crew_shout", { x: -12, y: 0, z: 0, key: "fire" }); // inside the gap: no second line
    e.play("bell", { x: 0, y: 0, z: -40, key: "hq" });
    e.play("parley_stamp");
    e.play("hoof", { x: 5, y: 0, z: 0, key: "trot" });
    expect(lines).toEqual(['[the gun crew: "Fire!", left]', "[the day bell tolls at camp, ahead]", "[a rubber stamp falls]", "[hoofbeats, right]"]);
  });
});
