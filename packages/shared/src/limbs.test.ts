import { describe, expect, it } from "vitest";
import { LIMB, LIMB_LIST, SEVER, hasLimbLoss, isLimb, limbZone, limbsLost, sanitizeMissing, severChance, zoneLimb } from "./limbs.ts";
import { ZONE, ZONE_COUNT } from "./wounds.ts";

describe("limbs", () => {
  it("limb bits are distinct and fit a nibble", () => {
    expect(new Set(LIMB_LIST).size).toBe(4);
    expect(LIMB_LIST.reduce((a, b) => a | b, 0)).toBe(15);
  });
  it("zones map to limbs and back; head and torso have none", () => {
    for (const l of LIMB_LIST) expect(zoneLimb(limbZone(l))).toBe(l);
    expect(zoneLimb(ZONE.HEAD)).toBeUndefined();
    expect(zoneLimb(ZONE.TORSO)).toBeUndefined();
    let limbZones = 0;
    for (let z = 0; z < ZONE_COUNT; z++) if (zoneLimb(z) !== undefined) limbZones++;
    expect(limbZones).toBe(4);
  });
  it("mask helpers and sanitising", () => {
    expect(hasLimbLoss(LIMB.LEG_L | LIMB.ARM_R, LIMB.LEG_L)).toBe(true);
    expect(hasLimbLoss(LIMB.LEG_L, LIMB.LEG_R)).toBe(false);
    expect(limbsLost(0b1011)).toBe(3);
    expect(sanitizeMissing(0xffff)).toBe(15);
    expect(sanitizeMissing(NaN)).toBe(0);
    expect(isLimb(4)).toBe(true);
    expect(isLimb(3)).toBe(false);
    expect(isLimb("4")).toBe(false);
  });
  it("sever chance: none below the threshold, certain above, rising in between, helped by existing wounds", () => {
    expect(severChance(SEVER.minDamage - 1, 3)).toBe(0);
    expect(severChance(NaN, 3)).toBe(0);
    expect(severChance(SEVER.certainDamage, 0)).toBe(1);
    expect(severChance(1000, 0)).toBe(1);
    const a = severChance(60, 0);
    const b = severChance(80, 0);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(severChance(60, 3)).toBeGreaterThan(a);
    expect(severChance(60, 3)).toBeLessThanOrEqual(1);
  });
});
