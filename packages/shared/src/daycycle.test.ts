import { describe, expect, it } from "vitest";
import { PALETTE, chroma as hexChroma } from "./palette.ts";
import { CLOCK, WORLD_CLOCK, advanceClock, clockRate, createDayState, dayState, hourOfPhase, parseClock, phaseOfHour, sanitizeDayMinutes, startHourFor, sunElevation, worldHours, wrapHours, type DayState, type Vec3 } from "./daycycle.ts";

const HOURS = Array.from({ length: 24 * 8 }, (_, i) => i / 8);
const colours = (d: DayState) => [d.sun, d.top, d.mid, d.horizon, d.glow, d.hemiSky, d.hemiGround];
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const chroma = (c: { r: number; g: number; b: number }): number => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
/** The most colourful palette entry any keyframe is built from: a convex mix scaled toward black can never exceed it. */
const W = PALETTE.world;
const SOURCES = [PALETTE.sky.top, PALETTE.sky.mid, PALETTE.sky.horizon, PALETTE.light.sun, PALETTE.light.sky, PALETTE.light.bounce, W.skyGlow, W.morningSun, W.morningTop, W.morningMid, W.morningHorizon, W.morningGlow, W.morningSky, W.morningBounce, W.duskSun, W.duskTop, W.duskMid, W.duskHorizon, W.duskGlow, W.duskSky, W.duskBounce, W.nightSun, W.nightTop, W.nightMid, W.nightHorizon, W.nightGlow, W.nightSky, W.nightBounce];
const MAX_CHROMA = Math.max(...SOURCES.map(hexChroma));

describe("the day cycle", () => {
  it("is finite, in gamut and inside the palette's chroma rules at every hour of the day", () => {
    const d = createDayState();
    for (const h of HOURS) {
      dayState(h, d);
      for (const c of colours(d)) {
        for (const v of [c.r, c.g, c.b]) {
          expect(Number.isFinite(v), `h ${h}`).toBe(true);
          expect(v, `h ${h}`).toBeGreaterThanOrEqual(0);
          expect(v, `h ${h}`).toBeLessThanOrEqual(1);
        }
        // every colour is a convex mix of palette entries scaled toward black, so it can never be more colourful than they are
        expect(chroma(c), `h ${h}`).toBeLessThanOrEqual(MAX_CHROMA + 1e-9);
      }
      for (const n of [d.sunIntensity, d.hemiIntensity, d.fogDensity, d.night, d.dusk, d.stars, d.moon, d.exposure, d.fire, d.ambient]) expect(Number.isFinite(n), `h ${h}`).toBe(true);
      for (const n of [d.night, d.dusk, d.stars, d.moon, d.exposure, d.fire, d.ambient]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1.0001);
      }
      expect(d.fogDensity).toBeGreaterThan(0.005);
      expect(d.fogDensity).toBeLessThan(0.02);
    }
  });

  it("the directional light is a unit vector that never dips below ~9 degrees, so shadows stay sane at any hour", () => {
    const d = createDayState();
    for (const h of HOURS) {
      dayState(h, d);
      expect(len(d.lightDir), `h ${h}`).toBeCloseTo(1, 5);
      expect(d.lightDir.y, `h ${h}`).toBeGreaterThan(Math.sin((9 * Math.PI) / 180));
      expect(len(d.sunDir)).toBeCloseTo(1, 5);
      expect(len(d.moonDir)).toBeCloseTo(1, 5);
    }
  });

  it("noon is bright and starless; midnight is dark, starry and moonlit with the fire and lanterns at full", () => {
    const d = createDayState();
    dayState(13, d);
    expect(d.night).toBe(0);
    expect(d.stars).toBe(0);
    expect(d.fire).toBeLessThan(0.1);
    expect(d.sunIntensity).toBeGreaterThan(2.5);
    expect(d.lightDir.y).toBeGreaterThan(0.7);
    const noon = { ...d };
    dayState(0, d);
    expect(d.night).toBeCloseTo(1, 3);
    expect(d.stars).toBe(1);
    expect(d.moon).toBeGreaterThan(0.9);
    expect(d.fire).toBe(1);
    expect(d.sunIntensity).toBeLessThan(noon.sunIntensity * 0.5);
    expect(d.sunDir.y).toBeLessThan(0); // the sun is below the horizon
  });

  it("D-041: a night stays readable: at midnight the moon and the sky's fill keep a floor (people went black against the ground under a new moon at 0.95 and 0.62)", () => {
    const d = createDayState();
    dayState(0, d);
    expect(d.hemiIntensity).toBeGreaterThanOrEqual(1.2);
    expect(d.sunIntensity).toBeGreaterThanOrEqual(1.2);
    const noon = createDayState();
    dayState(13, noon);
    expect(d.hemiIntensity).toBeLessThan(noon.hemiIntensity * 1.5); // (still night: the colour and the dark sky say so)
  });

  it("dusk glows: the horizon warms and the fire strengthens toward sunset, then fades toward morning", () => {
    const a = createDayState();
    const b = createDayState();
    dayState(13, a);
    dayState(18.6, b);
    expect(b.dusk).toBeGreaterThan(0.5);
    expect(b.fire).toBeGreaterThan(a.fire + 0.4);
    expect(b.glow.r).toBeGreaterThan(b.glow.b); // warm
    dayState(8, a);
    expect(a.fire).toBeLessThan(b.fire);
  });

  it("the golden hour: an hour before dusk the top of the sky is still mostly day-blue while the horizon and the sun have already warmed", () => {
    const noon = dayState(13, createDayState());
    const gold = dayState(16.6, createDayState());
    const dusk = dayState(18.6, createDayState());
    const blueness = (c: { r: number; g: number; b: number }): number => c.b - c.r;
    // the top: the blue-minus-red of the gold stop is closer to noon's than to dusk's (a straight fade would put it 60% of the way to violet)
    expect(Math.abs(blueness(gold.top) - blueness(noon.top))).toBeLessThan(Math.abs(blueness(gold.top) - blueness(dusk.top)));
    // the horizon and the sun: warmer (redder relative to blue) than noon's
    expect(gold.horizon.r - gold.horizon.b).toBeGreaterThan(noon.horizon.r - noon.horizon.b);
    expect(gold.sun.r - gold.sun.b).toBeGreaterThan(noon.sun.r - noon.sun.b);
    // and dusk goes on from there: the fire is stronger, the sun lower
    expect(dusk.fire).toBeGreaterThan(gold.fire);
    expect(gold.lightDir.y).toBeGreaterThan(dusk.lightDir.y);
  });

  it("changes smoothly: no colour, intensity or light direction jumps between neighbouring minutes, including across midnight", () => {
    const a = createDayState();
    const b = createDayState();
    let worstColour = 0;
    let worstDir = 0;
    let worstLitDir = 0;
    let worstIntensity = 0;
    for (let h = 0; h < 24; h += 1 / 60) {
      dayState(h, a);
      dayState(h + 1 / 60, b);
      const ca = colours(a);
      const cb = colours(b);
      ca.forEach((c, i) => {
        worstColour = Math.max(worstColour, Math.abs(c.r - cb[i]!.r), Math.abs(c.g - cb[i]!.g), Math.abs(c.b - cb[i]!.b));
      });
      const dd = Math.max(Math.abs(a.lightDir.x - b.lightDir.x), Math.abs(a.lightDir.y - b.lightDir.y), Math.abs(a.lightDir.z - b.lightDir.z));
      worstDir = Math.max(worstDir, dd);
      if (Math.min(a.sunIntensity, b.sunIntensity) > 0.3) worstLitDir = Math.max(worstLitDir, dd);
      worstIntensity = Math.max(worstIntensity, Math.abs(a.sunIntensity - b.sunIntensity));
    }
    expect(worstColour).toBeLessThan(0.03);
    expect(worstIntensity).toBeLessThan(0.1);
    // while there is real light on the ground the shadows crawl; they only swing fast when the light is nearly out (twilight)
    expect(worstLitDir).toBeLessThan(0.02);
    expect(worstDir).toBeLessThan(0.15);
    dayState(23.999, a);
    dayState(0.001, b);
    expect(Math.abs(a.top.r - b.top.r)).toBeLessThan(0.01);
    expect(Math.abs(a.lightDir.y - b.lightDir.y)).toBeLessThan(0.01);
  });

  it("is a pure function of the hour: same hour, same sky, any number of calls, any wrap", () => {
    const a = createDayState();
    const b = createDayState();
    dayState(17.3, a);
    dayState(17.3 + 24 * 3, b);
    expect(b).toEqual(a);
    dayState(17.3, b);
    expect(b).toEqual(a);
  });

  it("the sun rises in the east-ish, peaks at midday and sets before nightfall", () => {
    expect(sunElevation(6)).toBeCloseTo(0, 5);
    expect(sunElevation(12.5)).toBeGreaterThan((50 * Math.PI) / 180);
    expect(sunElevation(19)).toBeCloseTo(0, 5);
    expect(sunElevation(23)).toBeLessThan(0);
  });
});

describe("the clock", () => {
  it("parses ?time= as hours, h:mm and names, and rejects nonsense", () => {
    expect(parseClock("17.5")).toBe(17.5);
    expect(parseClock("17:30")).toBe(17.5);
    expect(parseClock("dusk")).toBeCloseTo(18.6, 5);
    expect(parseClock("Noon")).toBe(13);
    expect(parseClock("25")).toBe(1);
    expect(parseClock("-1")).toBe(23);
    expect(parseClock("banana")).toBeUndefined();
    expect(parseClock("")).toBeUndefined();
    expect(parseClock(null)).toBeUndefined();
  });

  it("drifts slowly (about 80 s per game hour by day) and quickly through the dark, and wraps at 24", () => {
    expect(clockRate(12)).toBeCloseTo(CLOCK.hoursPerSecond, 8);
    expect(clockRate(2)).toBeCloseTo(CLOCK.hoursPerSecond * CLOCK.nightSpeedup, 8);
    expect(advanceClock(12, 80)).toBeCloseTo(13, 5);
    expect(advanceClock(23.99, 1000)).toBeLessThan(24);
    expect(wrapHours(-1)).toBe(23);
    expect(wrapHours(49)).toBe(1);
    // a whole day takes a bounded, finite time
    let h = 5.2;
    let t = 0;
    while (t < 5000 && !(h > 5.2 && h < 5.25 && t > 100)) {
      h = advanceClock(h, 1);
      t++;
    }
    expect(t).toBeLessThan(2000);
  });
});

describe("the world clock (server-owned)", () => {
  it("phase and hour are inverses", () => {
    for (let h = 0; h < 24; h += 0.05) {
      const back = hourOfPhase(phaseOfHour(h));
      const d = Math.abs(back - h);
      expect(Math.min(d, 24 - d), `h ${h}`).toBeLessThan(1e-9);
    }
  });

  it("starts at the start hour and comes round after exactly one day length", () => {
    for (const start of [0, 5.2, 9, 13, 20.6, 23.9]) {
      for (const minutes of [1, 30, 90]) {
        expect(worldHours(start, 0, minutes)).toBeCloseTo(wrapHours(start), 9);
        const full = worldHours(start, minutes * 60_000, minutes);
        const d = Math.abs(full - wrapHours(start));
        expect(Math.min(d, 24 - d), `${start}/${minutes}`).toBeLessThan(1e-6);
      }
    }
  });

  it("only moves forward, continuously, and the dark hours go by three times faster", () => {
    let prev = worldHours(9, 0, 30);
    let dayTicks = 0;
    let darkTicks = 0;
    let travelled = 0;
    for (let t = 1000; t <= 30 * 60_000; t += 1000) {
      const h = worldHours(9, t, 30);
      let dh = h - prev;
      if (dh < -12) dh += 24;
      expect(dh, `t ${t}`).toBeGreaterThan(0);
      expect(dh, `t ${t}`).toBeLessThan(0.1);
      travelled += dh;
      const dark = prev < DARK_TO_TEST || prev > DARK_FROM_TEST;
      if (dark) darkTicks += dh;
      else dayTicks += dh;
      prev = h;
    }
    expect(travelled).toBeCloseTo(24, 3);
    expect(darkTicks + dayTicks).toBeCloseTo(24, 3);
    // default day: ~98 s per daylight hour, ~33 s per dark hour
    const dayRate = (worldHours(9, 60_000, 30) - 9) * 1; // hours advanced in one real minute of daylight
    expect(dayRate).toBeGreaterThan(0.55);
    expect(dayRate).toBeLessThan(0.7);
  });

  it("every client computes the same hour from the same world time (a pure function)", () => {
    for (const t of [0, 1234, 999_999, 5_000_000]) expect(worldHours(WORLD_CLOCK.defaultStartHour, t, WORLD_CLOCK.defaultDayMinutes)).toBe(worldHours(WORLD_CLOCK.defaultStartHour, t, WORLD_CLOCK.defaultDayMinutes));
  });

  it("a zero, negative or broken day length freezes the clock; configured lengths are clamped", () => {
    expect(worldHours(9, 1e9, 0)).toBe(9);
    expect(worldHours(9, 1e9, -3)).toBe(9);
    expect(worldHours(9, Number.NaN, 30)).toBe(9);
    expect(sanitizeDayMinutes(0)).toBe(WORLD_CLOCK.minDayMinutes);
    expect(sanitizeDayMinutes(1e9)).toBe(WORLD_CLOCK.maxDayMinutes);
    expect(sanitizeDayMinutes(Number.NaN)).toBe(WORLD_CLOCK.defaultDayMinutes);
  });
});

const DARK_TO_TEST = 5.2;
const DARK_FROM_TEST = 20.6;

describe("startHourFor (the QA hour: command)", () => {
  it("inverts worldHours: whatever the world's age and day length, the clock then reads the asked hour", () => {
    for (const minutes of [12, 24, 48])
      for (const ageMs of [0, 61_000, 3_600_000, 9_000_000])
        for (const h of [0, 5.2, 9, 13.5, 18.6, 21, 23.9]) {
          const d = Math.abs(worldHours(startHourFor(h, ageMs, minutes), ageMs, minutes) - h);
          expect(Math.min(d, 24 - d)).toBeLessThan(1e-6); // (on the clock face: 23.999... is midnight)
        }
  });
});
