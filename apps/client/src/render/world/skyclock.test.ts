import { describe, expect, it } from "vitest";
import { WEATHER, slotKind, weatherAt, worldHours } from "@cb/shared";
import { SkyClock } from "./skyclock.ts";
import { getAtmosphere, motionScale, setAtmosphere, windGain } from "./atmosphere.ts";

describe("the sky clock: where the hour comes from", () => {
  it("?time= wins over everything, even a room's clock and a pin", () => {
    const c = new SkyClock({ urlHours: 17.5 });
    c.pin(13);
    c.sync(7, 1_000_000, 9, 30, 0);
    c.update(500, 0.016);
    expect(c.hours).toBe(17.5);
  });

  it("&drift=1 lets the URL hour run instead of freezing it", () => {
    const c = new SkyClock({ urlHours: 9, drift: true });
    c.update(0, 0);
    c.update(1000, 60);
    expect(c.hours).toBeGreaterThan(9);
  });

  it("a pinned hour (the menu) holds still until a room's clock arrives, then the room takes over", () => {
    const c = new SkyClock();
    c.pin(13);
    for (let t = 0; t < 5000; t += 100) c.update(t, 0.1);
    expect(c.hours).toBe(13);
    c.sync(7, 0, 9, 30, 5000);
    c.update(5000, 0.1);
    expect(c.hours).toBeCloseTo(9, 6);
    expect(c.inRoom).toBe(true);
  });

  it("in a room the hour and the weather are pure functions of the world's age: two clients agree wherever they joined", () => {
    const a = new SkyClock();
    const b = new SkyClock();
    // A learned the age at its t=1000 (age 60 000); B heard it at its own t=51 000 (age 111 000): the same world instant is age 130 000
    a.sync(42, 60_000, 9, 30, 1000);
    b.sync(42, 111_000, 9, 30, 51_000);
    a.update(1000 + 70_000, 0.03);
    b.update(51_000 + 19_000, 0.03);
    expect(a.worldMs).toBeCloseTo(130_000, 6);
    expect(b.worldMs).toBeCloseTo(130_000, 6);
    expect(a.hours).toBeCloseTo(b.hours, 9);
    expect(a.hours).toBeCloseTo(worldHours(9, 130_000, 30), 9);
    expect(a.weather).toEqual(b.weather);
    expect(a.weather).toEqual(weatherAt(42, 130_000));
  });

  it("extrapolates between the server's refreshes and snaps back when a refresh arrives", () => {
    const c = new SkyClock();
    c.sync(5, 10_000, 9, 30, 0);
    c.update(2500, 0.03);
    expect(c.worldMs).toBeCloseTo(12_500, 6);
    c.sync(5, 12_900, 9, 30, 2500); // the server says 12.9 s: we were 0.4 s slow
    c.update(2500, 0.03);
    expect(c.worldMs).toBeCloseTo(12_900, 6);
    c.update(3500, 0.03);
    expect(c.worldMs).toBeCloseTo(13_900, 6);
  });

  it("a frozen day (0 minutes) freezes the hour at the start hour", () => {
    const c = new SkyClock();
    c.sync(1, 0, 6.5, 0, 0);
    c.update(1e6, 0.03);
    expect(c.hours).toBeCloseTo(6.5, 6);
  });

  it("leaving the room returns to a local sky", () => {
    const c = new SkyClock();
    c.sync(3, 500_000, 9, 30, 0);
    c.update(0, 0);
    expect(c.inRoom).toBe(true);
    c.leave();
    expect(c.inRoom).toBe(false);
  });
});

describe("the sky clock: the weather", () => {
  it("is clear until a room says otherwise", () => {
    const c = new SkyClock();
    for (let t = 0; t < 60_000; t += 1000) {
      c.update(t, 1);
      expect(c.weather.rain).toBe(0);
      expect(c.lightning.flash).toBe(0);
    }
  });

  it("?weather= forces a state at full strength, and a forced storm strikes", () => {
    const c = new SkyClock({ forcedWeather: "storm" });
    let flashed = 0;
    for (let t = 0; t < 120_000; t += 100) {
      c.update(t, 0.1);
      expect(c.weather.rain).toBe(1);
      expect(c.weather.storm).toBe(1);
      if (c.lightning.flash > 0.3) flashed++;
    }
    expect(flashed).toBeGreaterThan(5);
  });

  it("follows the schedule in a room: rain in a drizzle slot, lightning in a storm slot", () => {
    let seed = 0;
    let slot = 0;
    search: for (let s = 1; s < 500; s++) {
      for (let k = 2; k < 40; k++) {
        if (slotKind(s, k) === "storm") {
          seed = s;
          slot = k;
          break search;
        }
      }
    }
    const c = new SkyClock();
    const t0 = slot * WEATHER.slotMs + WEATHER.blendMaxMs + 5000;
    c.sync(seed, t0, 9, 30, 0);
    let struck = 0;
    for (let t = 0; t < 60_000; t += 100) {
      c.update(t, 0.1);
      expect(c.weather.kind).toBe("storm");
      if (c.lightning.flash > 0.3) struck++;
    }
    expect(struck).toBeGreaterThan(0);
  });
});

describe("atmosphere: what the audio engine reads", () => {
  it("has the stable shape { rain, wind, thunderAt, hour } and is one shared live object", () => {
    const a = getAtmosphere();
    for (const k of ["rain", "wind", "thunderAt", "hour"] as const) expect(k in a, k).toBe(true);
    setAtmosphere({ rain: 0.5, wind: 0.25, thunderAt: 12.5, hour: 18.2 });
    expect(getAtmosphere()).toBe(a);
    expect(a.rain).toBe(0.5);
    expect(a.thunderAt).toBe(12.5);
    setAtmosphere({ rain: 0, wind: 0.2, thunderAt: null, hour: 13 });
    expect(a.thunderAt).toBeNull();
  });

  it("the motion preference: ?motion= overrides, reduced motion is a gentle 0.3, wind amplitude follows it", () => {
    expect(motionScale(new URLSearchParams("motion=0"), false)).toBe(0);
    expect(motionScale(new URLSearchParams("motion=0.5"), true)).toBe(0.5);
    expect(motionScale(new URLSearchParams("motion=1"), true)).toBe(1);
    expect(motionScale(new URLSearchParams("motion=9"), false)).toBe(1);
    expect(motionScale(new URLSearchParams("motion=abc"), true)).toBe(0.3);
    expect(motionScale(new URLSearchParams(""), true)).toBe(0.3);
    expect(motionScale(new URLSearchParams(""), false)).toBe(1);
    expect(windGain(0.5, 0)).toBe(0);
    expect(windGain(1, 0.3)).toBeLessThan(windGain(1, 1) * 0.31);
    expect(windGain(1, 1)).toBeGreaterThan(windGain(0.1, 1) * 2);
    expect(windGain(0.22, 1)).toBeCloseTo(1, 0); // a light breeze is about the old fixed sway
  });
});

describe("the sky shows the contract's weather (D-046)", () => {
  it("a rain complication makes it rain over a clear world; clearing it gives the world back; a forced ?weather= still wins", () => {
    let seed = 1;
    while (weatherAt(seed, 2_000_000).rain > 0 || weatherAt(seed, 2_000_000).fog > 0.2) seed++;
    const c = new SkyClock();
    c.sync(seed, 2_000_000, 9, 30, 0);
    c.update(0, 0);
    expect(c.weather.rain).toBe(0);
    c.setContractWeather("drizzle");
    c.update(0, 0);
    expect(c.weather.rain).toBeGreaterThanOrEqual(0.45);
    expect(c.weather.kind).toBe("drizzle");
    c.setContractWeather(undefined);
    c.update(0, 0);
    expect(c.weather.rain).toBe(0);
    const forced = new SkyClock({ forcedWeather: "clear" });
    forced.setContractWeather("fog");
    forced.update(0, 0);
    expect(forced.weather.fog).toBe(0);
  });
});
