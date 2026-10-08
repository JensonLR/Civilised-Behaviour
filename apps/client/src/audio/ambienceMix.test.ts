import { CAMP, RIVER } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { ambienceTargets, daylight, newTargets } from "./ambienceMix.ts";

const atm = (o: Partial<{ rain: number; wind: number; hour: number }> = {}) => ({ rain: 0, wind: 0.2, thunderAt: null, hour: 13, ...o });
const stand = (x: number, z: number) => ({ x, y: 0, z, yaw: 0 });

describe("ambience targets", () => {
  it("birds by day, crickets by night, neither in the rain", () => {
    const noon = ambienceTargets(stand(0, 0), atm({ hour: 13 }));
    expect(noon.birds).toBeGreaterThan(0.9);
    expect(noon.crickets).toBeLessThan(0.05);
    const night = ambienceTargets(stand(0, 0), atm({ hour: 1 }));
    expect(night.birds).toBe(0);
    expect(night.crickets).toBeGreaterThan(0.9);
    const stormNight = ambienceTargets(stand(0, 0), atm({ hour: 1, rain: 1 }));
    expect(stormNight.crickets).toBe(0);
    expect(ambienceTargets(stand(0, 0), atm({ hour: 13, rain: 1 })).birds).toBe(0);
  });

  it("dusk and dawn are transitions, not switches", () => {
    let prev = daylight(3);
    for (let h = 3.1; h <= 8; h += 0.1) {
      const d = daylight(h);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
    expect(daylight(6)).toBeGreaterThan(0);
    expect(daylight(6)).toBeLessThan(1);
    expect(daylight(19)).toBeGreaterThan(0);
    expect(daylight(19)).toBeLessThan(1);
    expect(daylight(25)).toBe(daylight(1)); // the clock wraps
  });

  it("rain and wind follow the weather", () => {
    const calm = ambienceTargets(stand(0, 0), atm({ wind: 0, rain: 0 }));
    const storm = ambienceTargets(stand(0, 0), atm({ wind: 1, rain: 1 }));
    expect(calm.rain).toBe(0);
    expect(storm.rain).toBe(1);
    expect(storm.wind).toBeGreaterThan(calm.wind * 3);
    expect(storm.whistle).toBeGreaterThan(0.8);
    expect(calm.whistle).toBe(0);
  });

  it("the fire is loud beside it, faint at the edge of the clearing and silent far away, and pans toward it", () => {
    const f = CAMP.fire;
    const beside = ambienceTargets(stand(f.x - 1.5, f.z), atm());
    const across = ambienceTargets(stand(f.x - 15, f.z), atm());
    const far = ambienceTargets(stand(f.x - 120, f.z), atm());
    expect(beside.fire.gain).toBeGreaterThan(0.8);
    expect(across.fire.gain).toBeLessThan(beside.fire.gain);
    expect(across.fire.gain).toBeGreaterThan(0);
    expect(far.fire.gain).toBe(0);
    expect(beside.fire.pan).toBeGreaterThan(0.5); // standing west of the fire facing north: it is on the right
    expect(across.fire.cutoff).toBeLessThan(beside.fire.cutoff);
    // a downpour beats the fire down: its roar too (the embers' sizzle is fireVoices.ts)
    const wet = ambienceTargets(stand(f.x - 1.5, f.z), atm({ rain: 1 }));
    expect(wet.fire.gain).toBeLessThan(beside.fire.gain * 0.7);
    expect(wet.fire.gain).toBeGreaterThan(beside.fire.gain * 0.5);
  });

  it("the stream and the waterfall are heard near their water and not in the middle of the camp's far side", () => {
    const atSource = ambienceTargets(stand(RIVER.a.x + 2, RIVER.a.z + 2), atm());
    const atPond = ambienceTargets(stand(RIVER.b.x, RIVER.b.z), atm());
    const away = ambienceTargets(stand(-140, 140), atm());
    expect(atSource.falls.gain).toBeGreaterThan(0.9);
    expect(atPond.stream.gain).toBeGreaterThan(0.5);
    expect(away.stream.gain).toBe(0);
    expect(away.falls.gain).toBe(0);
  });

  it("reuses the record it is given", () => {
    const out = newTargets();
    expect(ambienceTargets(stand(0, 0), atm(), out)).toBe(out);
  });
});
