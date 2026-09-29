import { describe, expect, it } from "vitest";
import { Rng } from "./rng.ts";
import {
  WOUND_MAX,
  WOUNDS,
  ZONE,
  ZONE_COUNT,
  addWound,
  capWounds,
  pickZone,
  sanitizeWounds,
  setWound,
  severityForDamage,
  woundLevel,
  woundedZoneCount,
  worstWound,
} from "./wounds.ts";

describe("wound mask", () => {
  it("stores each zone independently in 2 bits and fits uint16", () => {
    let m = 0;
    for (let z = 0; z < ZONE_COUNT; z++) m = setWound(m, z, (z % 3) + 1);
    for (let z = 0; z < ZONE_COUNT; z++) expect(woundLevel(m, z)).toBe((z % 3) + 1);
    expect(m).toBeLessThanOrEqual(0xffff);
    expect(m).toBeLessThan(1 << 12);
  });
  it("setWound clamps and only touches its own zone", () => {
    const m = setWound(setWound(0, ZONE.HEAD, 2), ZONE.LEG_R, 99);
    expect(woundLevel(m, ZONE.LEG_R)).toBe(WOUND_MAX);
    expect(woundLevel(m, ZONE.HEAD)).toBe(2);
    expect(woundLevel(setWound(m, ZONE.HEAD, -4), ZONE.HEAD)).toBe(0);
    expect(woundLevel(setWound(m, ZONE.HEAD, 0), ZONE.LEG_R)).toBe(WOUND_MAX);
  });
  it("damage tiers map to severities and small hits leave nothing", () => {
    expect(severityForDamage(WOUNDS.minDamage - 1)).toBe(0);
    expect(severityForDamage(WOUNDS.tier[0])).toBe(1);
    expect(severityForDamage(WOUNDS.tier[1])).toBe(2);
    expect(severityForDamage(WOUNDS.tier[2])).toBe(3);
    expect(severityForDamage(1e9)).toBe(3);
  });
  it("repeat hits on one zone keep getting worse, up to the cap", () => {
    let m = 0;
    m = addWound(m, ZONE.TORSO, 1);
    expect(woundLevel(m, ZONE.TORSO)).toBe(1);
    m = addWound(m, ZONE.TORSO, 1);
    expect(woundLevel(m, ZONE.TORSO)).toBe(2);
    m = addWound(m, ZONE.TORSO, 1);
    m = addWound(m, ZONE.TORSO, 1);
    expect(woundLevel(m, ZONE.TORSO)).toBe(WOUND_MAX);
    expect(addWound(m, ZONE.HEAD, 0)).toBe(m); // a bruise adds nothing
  });
  it("a worse single hit wins over a lighter existing wound", () => {
    expect(woundLevel(addWound(setWound(0, ZONE.ARM_L, 1), ZONE.ARM_L, 3), ZONE.ARM_L)).toBe(3);
  });
  it("capWounds patches everything down to the cap and leaves lighter wounds alone", () => {
    const m = setWound(setWound(setWound(0, ZONE.HEAD, 3), ZONE.TORSO, 2), ZONE.LEG_L, 1);
    const c = capWounds(m, WOUNDS.revivedCap);
    expect(woundLevel(c, ZONE.HEAD)).toBe(WOUNDS.revivedCap);
    expect(woundLevel(c, ZONE.TORSO)).toBe(2);
    expect(woundLevel(c, ZONE.LEG_L)).toBe(1);
    expect(worstWound(c)).toBe(WOUNDS.revivedCap);
    expect(woundedZoneCount(c)).toBe(3);
  });
  it("sanitizeWounds masks untrusted input to 12 bits", () => {
    expect(sanitizeWounds(0xffffffff)).toBe(0xfff);
    expect(sanitizeWounds(NaN)).toBe(0);
    expect(sanitizeWounds("x")).toBe(0);
  });
});

describe("pickZone", () => {
  it("is deterministic per seed and follows the weights", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 50; i++) expect(pickZone(a)).toBe(pickZone(b));
    const rng = new Rng(1);
    const counts = new Array(ZONE_COUNT).fill(0) as number[];
    for (let i = 0; i < 20000; i++) counts[pickZone(rng)]!++;
    expect(counts[ZONE.TORSO]!).toBeGreaterThan(counts[ZONE.HEAD]! * 3);
    for (const c of counts) expect(c).toBeGreaterThan(0);
    expect(counts[ZONE.TORSO]! / 20000).toBeCloseTo(0.34, 1);
  });
});
