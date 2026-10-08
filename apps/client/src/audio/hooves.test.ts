import { GAIT, MOUNT, gaitOf } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { BEAT_AT, GAIT_KEYS, HoofCadence, beatsPerMetre, strideMetres } from "./hooves.ts";
import { SOUNDS } from "./sounds.ts";
import { VoicePool } from "./voicePool.ts";

/** Runs a horse at a steady speed for `seconds` of frames; returns the beat times (s) and the distance covered. */
function ride(speed: number, seconds: number, dt = 1 / 60): { beats: number[]; metres: number; gait: number } {
  const c = new HoofCadence();
  const beats: number[] = [];
  let t = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    const n = c.step(dt, speed, true);
    for (let k = 0; k < n; k++) beats.push(t);
  }
  return { beats, metres: speed * t, gait: c.gait };
}

describe("hoofbeats: locked to the gait's cadence", () => {
  const SPEEDS: [string, number, number][] = [["walk", 2.4, GAIT.walk], ["trot", 6.4, GAIT.trot], ["canter", 8.9, GAIT.canter], ["gallop", 10.5, GAIT.gallop]];

  it("each speed is the gait gaitOf says, and its key is the sound's gait key", () => {
    for (const [name, speed, g] of SPEEDS) {
      expect(gaitOf(speed), name).toBe(g);
      expect(GAIT_KEYS[g]).toBe(name);
      expect(SOUNDS.hoof!.keys).toContain(name);
    }
    expect(gaitOf(0)).toBe(GAIT.idle);
  });

  it("beats per metre are the gait's beats over the animator's stride (1.4 + 0.3 v m per cycle), to 2%, at every speed of every gait", () => {
    for (let v = 0.5; v <= 12; v += 0.25) {
      const g = gaitOf(v);
      const r = ride(v, 20);
      expect(r.gait).toBe(g);
      const per = r.beats.length / r.metres;
      expect(per / beatsPerMetre(v), `v=${v}`).toBeGreaterThan(0.97);
      expect(per / beatsPerMetre(v), `v=${v}`).toBeLessThan(1.03);
      expect(beatsPerMetre(v)).toBeCloseTo(BEAT_AT[g]!.length / strideMetres(v), 10);
    }
  });

  it("a trot has two beats a cycle, a walk four, a canter three, a gallop four; the beats fall where the gait's table says", () => {
    for (const [, v, g] of SPEEDS) expect(BEAT_AT[g]!.length).toBe(g === GAIT.trot ? 2 : g === GAIT.canter ? 3 : 4);
    // sample at a fine step: the gaps between beats within one cycle follow the table's spacing
    const dt = 1 / 600;
    const { beats } = ride(6.4, 6, dt);
    const cycle = strideMetres(6.4) / 6.4;
    const gaps = beats.slice(1).map((b, i) => b - beats[i]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(cycle / 2, 1); // trot: evenly two to a cycle
    const gallop = ride(10.5, 6, dt);
    const gc = strideMetres(10.5) / 10.5;
    const gg = gallop.beats.slice(1).map((b, i) => b - gallop.beats[i]!);
    // gallop: pairs (0.1, 0.36, 0.08, then the 0.46 suspension): the longest gap in each cycle is the suspension
    expect(Math.max(...gg) / gc).toBeCloseTo(0.46, 1);
    expect(Math.min(...gg) / gc).toBeCloseTo(0.08, 1);
  });

  it("slowing slows the beats; stopped is silent; airborne is silent and resumes where it left off", () => {
    const c = new HoofCadence();
    const at = (v: number, secs: number): number => {
      let n = 0;
      for (let i = 0; i < secs * 60; i++) n += c.step(1 / 60, v, true);
      return n;
    };
    const fast = at(10.5, 4);
    const slow = at(3, 4);
    expect(fast).toBeGreaterThan(slow * 1.5);
    expect(at(0, 3)).toBe(0);
    expect(c.step(1 / 60, 8, false)).toBe(0);
    expect(c.gait).toBe(gaitOf(8));
    const ph = c.phase;
    for (let i = 0; i < 60; i++) c.step(1 / 60, 8, false);
    expect(c.phase).toBe(ph); // held in the air
  });

  it("a long frame is a few beats, not a roll; hostile input is silent; the loudness rises with speed", () => {
    const c = new HoofCadence();
    expect(c.step(5, 10.5, true)).toBeLessThanOrEqual(3);
    for (const [dt, v] of [[NaN, 5], [1 / 60, NaN], [-1, 5], [1 / 60, Infinity], [0, 5]] as const) {
      const d = new HoofCadence();
      expect(d.step(dt, v, true), `${dt},${v}`).toBe(0);
    }
    const slow = new HoofCadence();
    slow.step(1 / 60, 3, true);
    const fast = new HoofCadence();
    fast.step(1 / 60, 10.5, true);
    expect(fast.loud).toBeGreaterThan(slow.loud);
    expect(fast.loud).toBeLessThanOrEqual(1);
  });
});

describe("hooves in the voice pool", () => {
  it("a gallop's worth of beats never holds more than the sound's cap, and the pool is not eaten", () => {
    const d = SOUNDS.hoof!;
    const pool = new VoicePool(28);
    let now = 0;
    let maxSame = 0;
    for (let i = 0; i < 400; i++) {
      now += 0.11;
      pool.acquire("hoof", d.prio, d.cap, now, now + 0.3, now);
      maxSame = Math.max(maxSame, pool.countOf("hoof", now));
    }
    expect(maxSame).toBeLessThanOrEqual(d.cap);
    expect(d.cap).toBeLessThan(28 / 4);
  });

  it("hooves do not displace a shout: with the pool full of crew shouts, a hoofbeat is dropped, not the shout", () => {
    const pool = new VoicePool(2);
    const shout = SOUNDS.crew_shout!;
    const hoof = SOUNDS.hoof!;
    expect(pool.acquire("crew_shout", shout.prio, 9, 0, 1, 0)).toBeGreaterThanOrEqual(0);
    expect(pool.acquire("other_shout", shout.prio, 9, 0, 1, 0)).toBeGreaterThanOrEqual(0);
    expect(pool.acquire("hoof", hoof.prio, hoof.cap, 0.1, 0.4, 0.1)).toBe(-1);
  });
});

describe("the gait speeds are the mount module's", () => {
  it("MOUNT.gallopFlagAt sits inside the canter: a canter is a 'run' for the flag, a three-beat for the hooves", () => {
    expect(gaitOf(MOUNT.gallopFlagAt + 0.05)).toBe(GAIT.canter);
  });
});
