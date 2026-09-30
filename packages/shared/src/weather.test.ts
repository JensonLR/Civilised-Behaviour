import { describe, expect, it } from "vitest";
import { PALETTE, chroma as hexChroma } from "./palette.ts";
import { createDayState, dayState, type DayState } from "./daycycle.ts";
import { WEATHER, WEATHER_KINDS, applyWeather, createLightning, createWeather, lightningAt, parseWeatherKind, slotKind, weatherAt, weatherPreset, type Weather } from "./weather.ts";

const NUM: (keyof Weather)[] = ["rain", "overcast", "fog", "wind", "dust", "storm", "wet"];
const MIN = 60_000;

/** A seed and slot where a storm happens (slot >= 2 so there is a lead-in). */
function findStorm(): { seed: number; slot: number } {
  for (let seed = 1; seed < 400; seed++) for (let slot = 2; slot < 30; slot++) if (slotKind(seed, slot) === "storm" && slotKind(seed, slot + 1) !== "storm" && slotKind(seed, slot + 1) !== "drizzle") return { seed, slot };
  throw new Error("no storm found");
}

describe("weather is a pure function of (seed, time)", () => {
  it("is deterministic and allocation-free with an out object", () => {
    const a = weatherAt(7, 5 * MIN);
    const b = weatherAt(7, 5 * MIN);
    expect(a).toEqual(b);
    const out = createWeather();
    expect(weatherAt(7, 5 * MIN, out)).toBe(out);
    expect(out).toEqual(a);
  });

  it("always starts clear: the first slot is fine weather for every seed, and negative or bad times are clamped", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (let t = 0; t < WEATHER.slotMs; t += 15_000) {
        const w = weatherAt(seed, t);
        expect(w.kind, `seed ${seed} t ${t}`).toBe("clear");
        expect(w.rain).toBe(0);
        expect(w.storm).toBe(0);
        expect(w.fog).toBe(0);
      }
    }
    expect(weatherAt(3, -5000)).toEqual(weatherAt(3, 0));
    expect(weatherAt(3, NaN)).toEqual(weatherAt(3, 0));
  });

  it("every value is finite and 0..1 over two hours for many seeds", () => {
    const w = createWeather();
    for (let seed = 1; seed < 40; seed++) {
      for (let t = 0; t < 120 * MIN; t += 7_300) {
        weatherAt(seed, t, w);
        for (const k of NUM) {
          expect(Number.isFinite(w[k] as number), `${k}`).toBe(true);
          expect(w[k] as number, `${k} seed ${seed} t ${t}`).toBeGreaterThanOrEqual(0);
          expect(w[k] as number, `${k} seed ${seed} t ${t}`).toBeLessThanOrEqual(1.0001);
        }
        expect(WEATHER_KINDS).toContain(w.kind);
      }
    }
  }, 30_000);

  it("transitions take 20-40 s: nothing jumps, everything eases (checked every 100 ms across slot boundaries)", () => {
    const a = createWeather();
    const b = createWeather();
    let worst = 0;
    for (let seed = 1; seed < 14; seed++) {
      for (let slot = 1; slot < 14; slot++) {
        const start = slot * WEATHER.slotMs;
        for (let t = start - 2000; t < start + 45_000; t += 100) {
          weatherAt(seed, t, a);
          weatherAt(seed, t + 100, b);
          for (const k of NUM) worst = Math.max(worst, Math.abs((a[k] as number) - (b[k] as number)));
        }
      }
    }
    // smoothstep over >= 20 s: at most 1.5 * 0.1 s / 20 s = 0.0075 per step (wetness is scaled by 1.7)
    expect(worst).toBeLessThan(0.0135);
  }, 30_000);

  it("a state that differs from the last takes at least 20 s to arrive", () => {
    let found = 0;
    for (let seed = 1; seed < 200 && found < 12; seed++) {
      for (let slot = 2; slot < 20; slot++) {
        if (slotKind(seed, slot) === "clear" || slotKind(seed, slot - 1) !== "clear") continue;
        const start = slot * WEATHER.slotMs;
        const early = weatherAt(seed, start + 4000);
        const late = weatherAt(seed, start + WEATHER.blendMaxMs + 1000);
        expect(late.overcast, `seed ${seed} slot ${slot}`).toBeGreaterThan(0.3);
        expect(early.overcast).toBeLessThan(late.overcast * 0.6 + 0.1);
        found++;
        break;
      }
    }
    expect(found).toBeGreaterThan(5);
  });

  it("all six states occur, in roughly the intended proportions", () => {
    const counts: Record<string, number> = {};
    const N = 3000;
    for (let i = 1; i <= N; i++) counts[slotKind(11, i)] = (counts[slotKind(11, i)] ?? 0) + 1;
    for (const k of WEATHER_KINDS) expect(counts[k], k).toBeGreaterThan(20);
    expect(counts.clear! / N).toBeGreaterThan(0.28);
    expect(counts.clear! / N).toBeLessThan(0.4);
    expect(counts.storm! / N).toBeLessThan(0.13);
  });

  it("the ground gets wet in rain and dries again over about a minute and a half", () => {
    const { seed, slot } = findStorm();
    const start = slot * WEATHER.slotMs;
    const wetDuring = weatherAt(seed, start + 60_000).wet;
    expect(wetDuring).toBeGreaterThan(0.9);
    const after = (slot + 1) * WEATHER.slotMs;
    // the next slot is not a storm: rain fades out over 20-40 s, the ground dries over WEATHER.dryMs afterwards
    const soon = weatherAt(seed, after + 10_000);
    const dry = weatherAt(seed, after + WEATHER.blendMaxMs + WEATHER.dryMs + 5000);
    expect(soon.wet).toBeGreaterThan(dry.wet);
    expect(dry.wet).toBeLessThan(0.05);
  });

  it("presets and aliases", () => {
    const s = weatherPreset("storm");
    expect(s.storm).toBe(1);
    expect(s.rain).toBe(1);
    expect(weatherPreset("clear").rain).toBe(0);
    expect(parseWeatherKind("Rain")).toBe("drizzle");
    expect(parseWeatherKind("thunder")).toBe("storm");
    expect(parseWeatherKind("nonsense")).toBeUndefined();
  });
});

describe("lightning", () => {
  it("is pure, and never happens in fine weather", () => {
    for (let seed = 1; seed < 20; seed++) {
      for (let t = 0; t < WEATHER.slotMs; t += 900) {
        const l = lightningAt(seed, t);
        expect(l.flash).toBe(0);
        expect(Number.isNaN(l.thunderMs)).toBe(true);
      }
    }
    expect(lightningAt(5, 123456)).toEqual(lightningAt(5, 123456));
  });

  it("strikes during a storm: a flash that decays within a second or two, with thunder 1.4-7.9 s later", () => {
    const { seed, slot } = findStorm();
    const from = slot * WEATHER.slotMs + WEATHER.blendMaxMs;
    const to = (slot + 1) * WEATHER.slotMs;
    const l = createLightning();
    let strikes = 0;
    let peak = 0;
    let lastStrike = -1;
    for (let t = from; t < to; t += 40) {
      lightningAt(seed, t, l);
      expect(l.flash).toBeGreaterThanOrEqual(0);
      expect(l.flash).toBeLessThanOrEqual(1);
      if (l.lastStrikeMs !== lastStrike && l.lastStrikeMs >= from) {
        strikes++;
        lastStrike = l.lastStrikeMs;
      }
      peak = Math.max(peak, l.flash);
      if (l.lastStrikeMs > -Infinity && t - l.lastStrikeMs > 1500) expect(l.flash, "flash decays").toBeLessThan(0.02);
      if (!Number.isNaN(l.thunderMs)) {
        expect(l.thunderMs).toBeGreaterThanOrEqual(t);
        expect(l.thunderMs - l.lastStrikeMs).toBeLessThanOrEqual(7900 + 1);
        expect(l.thunderMs - l.lastStrikeMs).toBeGreaterThanOrEqual(1400);
      }
    }
    expect(strikes).toBeGreaterThan(3);
    expect(peak).toBeGreaterThan(0.6);
  });

  it("thunder always arrives after its flash", () => {
    const { seed, slot } = findStorm();
    const l = createLightning();
    const from = slot * WEATHER.slotMs + WEATHER.blendMaxMs;
    let checked = 0;
    for (let t = from; t < from + 60_000; t += 100) {
      lightningAt(seed, t, l);
      if (!Number.isNaN(l.thunderMs)) {
        expect(l.lastStrikeMs).toBeLessThanOrEqual(t);
        expect(l.thunderMs).toBeGreaterThan(l.lastStrikeMs);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("applyWeather bends the day", () => {
  const W = PALETTE.world;
  const SOURCES = [PALETTE.sky.top, PALETTE.sky.mid, PALETTE.sky.horizon, PALETTE.light.sun, PALETTE.light.sky, PALETTE.light.bounce, W.skyGlow, W.morningSun, W.morningTop, W.morningMid, W.morningHorizon, W.morningGlow, W.morningSky, W.duskSun, W.duskTop, W.duskMid, W.duskHorizon, W.duskGlow, W.duskSky, W.nightSun, W.nightTop, W.nightMid, W.nightHorizon, W.nightGlow, W.nightSky, W.overcastTop, W.overcastMid, W.overcastHorizon, W.stormTop, W.stormMid, W.stormHorizon, W.mist, W.dustHaze, W.flash];
  const MAX_CHROMA = Math.max(...SOURCES.map(hexChroma));
  const cols = (d: DayState) => [d.sun, d.top, d.mid, d.horizon, d.glow, d.hemiSky, d.hemiGround];

  it("stays in gamut and inside the palette's chroma for every weather, hour and lightning flash", () => {
    const d = createDayState();
    for (const kind of WEATHER_KINDS) {
      const w = weatherPreset(kind);
      for (let h = 0; h < 24; h += 1.5) {
        for (const flash of [0, 0.5, 1]) {
          applyWeather(dayState(h, d), w, flash);
          for (const c of cols(d)) {
            for (const v of [c.r, c.g, c.b]) {
              expect(Number.isFinite(v), `${kind} ${h}`).toBe(true);
              expect(v, `${kind} ${h}`).toBeGreaterThanOrEqual(-1e-9);
              expect(v, `${kind} ${h}`).toBeLessThanOrEqual(1 + 1e-9);
            }
            expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b), `${kind} ${h}`).toBeLessThanOrEqual(MAX_CHROMA + 1e-9);
          }
          for (const n of [d.sunIntensity, d.hemiIntensity, d.fogDensity, d.stars, d.moon, d.cover, d.ambient]) expect(Number.isFinite(n) && n >= 0).toBe(true);
          expect(d.fogDensity).toBeLessThan(0.03);
          expect(d.cover).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("clear weather leaves the day as it was; cloud takes the sun; fog thickens the air; a flash lights the world", () => {
    const base = dayState(13, createDayState());
    const clear = applyWeather(dayState(13, createDayState()), weatherPreset("clear"));
    expect(clear.sunIntensity).toBeGreaterThan(base.sunIntensity * 0.9);
    expect(clear.fogDensity).toBeCloseTo(base.fogDensity, 3);
    const storm = applyWeather(dayState(13, createDayState()), weatherPreset("storm"));
    expect(storm.sunIntensity).toBeLessThan(base.sunIntensity * 0.4);
    expect(storm.cover).toBeGreaterThan(0.95);
    expect(storm.top.b).toBeLessThan(base.top.b);
    const fog = applyWeather(dayState(13, createDayState()), weatherPreset("fog"));
    expect(fog.fogDensity).toBeGreaterThan(base.fogDensity + 0.008);
    const dust = applyWeather(dayState(13, createDayState()), weatherPreset("dust"));
    expect(dust.horizon.r).toBeGreaterThan(dust.horizon.b + 0.05); // ochre haze
    const lit = applyWeather(dayState(13, createDayState()), weatherPreset("storm"), 1);
    expect(lit.hemiIntensity).toBeGreaterThan(storm.hemiIntensity + 2);
    expect(lit.flash).toBe(1);
    // night storms stay dark
    const night = applyWeather(dayState(0, createDayState()), weatherPreset("storm"));
    expect(night.horizon.g).toBeLessThan(0.35);
  });
});
