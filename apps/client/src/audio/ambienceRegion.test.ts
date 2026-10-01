import { CAMP, REGION_IDS, Rng, type RegionId } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { ambienceTargets, newTargets } from "./ambienceMix.ts";
import { REGION_AMBIENCE, RegionSchedule, stepRegionAmbience } from "./ambienceRegion.ts";
import { CAPTIONS } from "./captions.ts";
import { SOUNDS } from "./sounds.ts";

/** Each region has its own voices, scheduled deterministically around the listener; the Hollowmere landmarks stay in Hollowmere. */

interface Ev { sound: string; key: string; az: number; dist: number; height: number; volume: number; at: number }
function run(region: RegionId, seconds: number, daylight: number, rain = 0, seed = 7): Ev[] {
  const rng = new Rng(seed);
  const s = new RegionSchedule(region, rng);
  const out: Ev[] = [];
  let t = 0;
  const emit = (sound: string, key: string, az: number, dist: number, height: number, volume: number): void => {
    out.push({ sound, key, az, dist, height, volume, at: t });
  };
  for (; t < seconds; t += 0.1) stepRegionAmbience(s, 0.1, daylight, rain, rng, emit);
  return out;
}

describe("the tables", () => {
  it("every region has voices, and every voice is a real sound with a caption and, when keyed, a real key", () => {
    for (const r of REGION_IDS) {
      const a = REGION_AMBIENCE[r];
      expect(a.events.length, r).toBeGreaterThanOrEqual(1);
      expect(a.wind, r).toBeGreaterThanOrEqual(0);
      expect(a.wind, r).toBeLessThan(0.5);
      for (const e of a.events) {
        const d = SOUNDS[e.sound];
        expect(d, `${r}/${e.sound}`).toBeDefined();
        expect(CAPTIONS[e.sound], `${r}/${e.sound} caption`).toBeDefined();
        if (e.key !== undefined) expect(d!.keys, `${r}/${e.sound}`).toContain(e.key);
        expect(e.every[0], e.sound).toBeGreaterThan(0.5);
        expect(e.every[1], e.sound).toBeGreaterThanOrEqual(e.every[0]);
        expect(e.dist[1], e.sound).toBeGreaterThanOrEqual(e.dist[0]);
        expect(e.volume[0], e.sound).toBeGreaterThan(0);
        expect(e.volume[1], e.sound).toBeLessThanOrEqual(1);
        expect(e.chance, e.sound).toBeGreaterThan(0);
        // a sound heard at its far distance is still inside its audible range (or it would be scheduled for nothing); the centred `gull` has no distance
        if (!d!.ui) expect(e.dist[1], `${r}/${e.sound} range`).toBeLessThanOrEqual(d!.max);
      }
    }
  });

  it("the regions are different places: the four newer ones share no voice set with each other, and each plays at least three kinds", () => {
    const sets = REGION_IDS.filter((r) => r !== "hollowmere").map((r) => REGION_AMBIENCE[r].events.map((e) => e.sound + ":" + (e.key ?? "")).sort().join("|"));
    expect(new Set(sets).size).toBe(sets.length);
    for (const r of REGION_IDS.filter((x) => x !== "hollowmere")) expect(REGION_AMBIENCE[r].events.length, r).toBeGreaterThanOrEqual(3);
    const has = (r: RegionId, s: string): boolean => REGION_AMBIENCE[r].events.some((e) => e.sound === s);
    expect(has("hollowmere", "amb_mill")).toBe(true);
    expect(has("kessar", "amb_surf") && has("kessar", "amb_lamp_chain") && has("kessar", "gull")).toBe(true);
    expect(has("highmark", "amb_herd_bell") && has("highmark", "amb_far_horn") && has("highmark", "amb_gust")).toBe(true);
    expect(has("vesper", "amb_drip") && has("vesper", "amb_timber_creak") && has("vesper", "amb_gust")).toBe(true);
    expect(has("saltmarket", "amb_lap") && has("saltmarket", "amb_wind_pump") && has("saltmarket", "amb_halyard") && has("saltmarket", "amb_frog")).toBe(true);
  });
});

describe("the scheduler", () => {
  it("is deterministic in the seed, and different seeds play differently", () => {
    expect(JSON.stringify(run("saltmarket", 300, 1))).toBe(JSON.stringify(run("saltmarket", 300, 1)));
    expect(JSON.stringify(run("saltmarket", 300, 1, 0, 8))).not.toBe(JSON.stringify(run("saltmarket", 300, 1, 0, 7)));
  });

  it("each voice plays at its own pace, within its distance, height and volume ranges, from every direction", () => {
    for (const r of REGION_IDS) {
      const evs = run(r, 1800, 1);
      const night = run(r, 1800, 0);
      for (const spec of REGION_AMBIENCE[r].events) {
        const mine = (spec.when === "night" ? night : evs).filter((e) => e.sound === spec.sound && e.key === (spec.key ?? ""));
        // expected plays: between 1800/every.max*chance*0.5 and 1800/every.min (a generous band: the first play is staggered, a chance thins it)
        const hi = 1800 / spec.every[0] + 2;
        const lo = (1800 / spec.every[1]) * spec.chance * 0.5 - 1;
        expect(mine.length, `${r}/${spec.sound} plays ${mine.length}`).toBeLessThanOrEqual(hi);
        expect(mine.length, `${r}/${spec.sound} plays ${mine.length}`).toBeGreaterThanOrEqual(Math.max(0, lo));
        for (const e of mine) {
          expect(e.dist).toBeGreaterThanOrEqual(spec.dist[0] - 1e-9);
          expect(e.dist).toBeLessThanOrEqual(spec.dist[1] + 1e-9);
          expect(e.volume).toBeGreaterThanOrEqual(spec.volume[0] - 1e-9);
          expect(e.volume).toBeLessThanOrEqual(spec.volume[1] + 1e-9);
          expect(e.height).toBe(spec.height);
          expect(e.az).toBeGreaterThanOrEqual(0);
          expect(e.az).toBeLessThan(Math.PI * 2);
        }
        if (mine.length > 8) expect(new Set(mine.map((e) => e.az.toFixed(3))).size).toBeGreaterThan(mine.length / 2);
      }
    }
  });

  it("frogs are for the night, the mill and the far horn for the day, and a downpour silences what cannot carry through it", () => {
    const day = run("saltmarket", 1200, 1);
    const night = run("saltmarket", 1200, 0);
    expect(day.some((e) => e.sound === "amb_frog")).toBe(false);
    expect(night.filter((e) => e.sound === "amb_frog").length).toBeGreaterThan(20);
    expect(run("hollowmere", 1200, 0).some((e) => e.sound === "amb_mill")).toBe(false);
    expect(run("hollowmere", 1200, 1).filter((e) => e.sound === "amb_mill").length).toBeGreaterThan(40);
    expect(run("highmark", 3000, 1).some((e) => e.sound === "amb_far_horn")).toBe(true);
    expect(run("highmark", 3000, 1, 1).some((e) => e.sound === "amb_far_horn")).toBe(false);
    expect(run("kessar", 1200, 1, 1).some((e) => e.sound === "gull")).toBe(false);
    expect(run("kessar", 1200, 1, 0).some((e) => e.sound === "gull")).toBe(true);
  });

  it("a zero or negative step plays nothing and changes nothing", () => {
    const rng = new Rng(1);
    const s = new RegionSchedule("vesper", rng);
    const before = Array.from(s.due);
    let n = 0;
    stepRegionAmbience(s, 0, 1, 0, rng, () => n++);
    stepRegionAmbience(s, -5, 1, 0, rng, () => n++);
    expect(n).toBe(0);
    expect(Array.from(s.due)).toEqual(before);
  });
});

describe("the weather beds follow the region", () => {
  const atm = { rain: 0, wind: 0.2, thunderAt: null, hour: 13 };
  const at = (x: number, z: number) => ({ x, y: 0, z, yaw: 0 });
  it("the camp fire, the stream and the waterfall are Hollowmere's: standing on their coordinates in another region is silent", () => {
    const beside = at(CAMP.fire.x + 1, CAMP.fire.z);
    const home = ambienceTargets(beside, atm, newTargets(), "hollowmere");
    expect(home.fire.gain, "the fire is heard beside it in Hollowmere").toBeGreaterThan(0.3);
    for (const r of REGION_IDS.filter((x) => x !== "hollowmere")) {
      const t = ambienceTargets(beside, atm, newTargets(), r);
      expect(t.fire.gain, r).toBe(0);
      expect(t.stream.gain, r).toBe(0);
      expect(t.falls.gain, r).toBe(0);
    }
  });

  it("each region leans the wind: the plain breezes more than the hollow, the gorge more than the depot", () => {
    const wind = (r: RegionId): number => ambienceTargets(at(0, 0), atm, newTargets(), r).wind;
    expect(wind("highmark")).toBeGreaterThan(wind("hollowmere"));
    expect(wind("vesper")).toBeGreaterThan(wind("hollowmere"));
    expect(wind("hollowmere")).toBeCloseTo(ambienceTargets(at(0, 0), atm).wind, 9); // the default region is Hollowmere: nothing existing moves
    for (const r of REGION_IDS) expect(wind(r)).toBeLessThanOrEqual(1);
  });
});
