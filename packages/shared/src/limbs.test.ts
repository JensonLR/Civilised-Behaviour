import { describe, expect, it } from "vitest";
import { BEHEAD, HEAD, LIMB, LIMB_LIST, SEVER, beheads, hasLimbLoss, isHeadless, isLimb, limbBits, limbZone, limbsLost, sanitizeMissing, severChance, zoneLimb } from "./limbs.ts";
import { FINISHER } from "./hitReaction.ts";
import { WEAPON, WEAPONS } from "./weapons.ts";
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
    expect(sanitizeMissing(0xffff)).toBe(31); // (D-118: the four limbs and the head)
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
  it("D-118: the head is its own bit, not a limb (the limb lists, tallies and stumps stay the four)", () => {
    expect(LIMB_LIST.includes(HEAD as never)).toBe(false);
    expect(isLimb(HEAD)).toBe(false);
    expect(LIMB_LIST.reduce((a, b) => a | b, 0) & HEAD).toBe(0);
    expect(isHeadless(HEAD | LIMB.ARM_L)).toBe(true);
    expect(isHeadless(15)).toBe(false);
    expect(limbBits(HEAD | LIMB.LEG_R)).toBe(LIMB.LEG_R);
  });
  it("D-118: a sabre's coup de grâce on the head takes it, no other coup de grâce does, and only a very heavy blow otherwise", () => {
    const sabre = WEAPONS[WEAPON.SABRE];
    const fin = sabre.severBias * FINISHER.severMul;
    expect(beheads(ZONE.HEAD, 30, fin, true, true)).toBe(true);
    expect(beheads(ZONE.TORSO, 300, fin, true, true)).toBe(false);
    expect(beheads(ZONE.HEAD, 200, WEAPONS[WEAPON.RIFLE].severBias * FINISHER.severMul, true, false)).toBe(false); // (a gun's butt)
    expect(beheads(ZONE.HEAD, 36 * 1.5, sabre.severBias, false, true)).toBe(false); // (a sabre's ordinary cut: 97)
    expect(beheads(ZONE.HEAD, 70 * 2.2, WEAPONS[WEAPON.RIFLE].severBias, false, false)).toBe(false); // (a rifle ball: 154)
    expect(beheads(ZONE.HEAD, 160, WEAPONS[WEAPON.CANNON].severBias, false, false)).toBe(true); // (a cannonball: 352)
    expect(beheads(ZONE.HEAD, BEHEAD.heavy, 1, false, false)).toBe(true);
    expect(beheads(ZONE.HEAD, NaN, 9, false, false)).toBe(false);
  });
});
