import { describe, expect, it } from "vitest";
import { FINISHER, HIT_REACT, REACT, aimShake, findFinisherTarget, packReact, reactHolds, reactKind, reactOverrides, reactRight, reactSeconds, reactionFor } from "./hitReaction.ts";
import { LIMB } from "./limbs.ts";
import { WEAPON, WEAPONS, spreadFor } from "./weapons.ts";
import { ZONE, setWound } from "./wounds.ts";

/** D-104: where a blow lands decides what it does to the body. */
describe("D-104: hit reactions", () => {
  it("a heavy leg blow floors the body on that knee, longer the heavier it is; a light one does nothing", () => {
    const r = reactionFor(ZONE.LEG_R, HIT_REACT.legFloor, true);
    expect(reactKind(r)).toBe(REACT.FLOORED);
    expect(reactRight(r)).toBe(true);
    expect(reactSeconds(r)).toBeCloseTo(HIT_REACT.floorS[0], 5);
    const heavy = reactionFor(ZONE.LEG_L, HIT_REACT.legFloor + HIT_REACT.floorHeavy + 50, false);
    expect(reactRight(heavy)).toBe(false);
    expect(reactSeconds(heavy)).toBeCloseTo(HIT_REACT.floorS[1], 5);
    expect(reactionFor(ZONE.LEG_L, HIT_REACT.legFloor - 1, true)).toBe(0);
    expect(reactHolds(r)).toBe(true);
  });

  it("the gut doubles him over, the head reels him; a sound arm hit knocks the weapon away, never bare fists", () => {
    expect(reactKind(reactionFor(ZONE.TORSO, HIT_REACT.torsoDouble, true))).toBe(REACT.DOUBLED);
    expect(reactionFor(ZONE.TORSO, HIT_REACT.torsoDouble - 1, true)).toBe(0);
    expect(reactKind(reactionFor(ZONE.HEAD, HIT_REACT.headReel, true))).toBe(REACT.DOUBLED);
    const arm = reactionFor(ZONE.ARM_R, HIT_REACT.armDisarm, true);
    expect(reactKind(arm)).toBe(REACT.DISARMED);
    expect(reactHolds(arm)).toBe(false); // (he can still walk and put his fists up)
    expect(reactionFor(ZONE.ARM_R, 99, false)).toBe(0);
    expect(reactionFor(ZONE.ARM_L, HIT_REACT.armDisarm - 1, true)).toBe(0);
    expect(reactionFor(ZONE.LEG_L, 0, true)).toBe(0);
    expect(reactionFor(ZONE.LEG_L, Number.NaN, true)).toBe(0);
  });

  it("what the weapons actually do: a pistol ball to the leg floors, to the arm disarms; a fist does neither", () => {
    const pistol = WEAPONS[WEAPON.PISTOL].ranged!;
    expect(reactionFor(ZONE.LEG_L, pistol.damage * pistol.zoneMul[ZONE.LEG_L]!, true)).not.toBe(0);
    expect(reactionFor(ZONE.ARM_L, pistol.damage * pistol.zoneMul[ZONE.ARM_L]!, true)).not.toBe(0);
    const fist = WEAPONS[WEAPON.FISTS].melee!;
    for (const z of [ZONE.HEAD, ZONE.TORSO, ZONE.ARM_L, ZONE.LEG_R] as const) expect(reactionFor(z, fist.damage * fist.zoneMul[z]!, true)).toBe(0);
  });

  it("packs into one byte and back; the length is clamped to what the wire can carry", () => {
    for (const kind of [REACT.FLOORED, REACT.DOUBLED, REACT.DISARMED] as const) {
      for (const right of [false, true]) {
        const b = packReact(kind, right, 1.3);
        expect(b).toBeGreaterThan(0);
        expect(b).toBeLessThan(256);
        expect(reactKind(b)).toBe(kind);
        expect(reactRight(b)).toBe(right);
        expect(reactSeconds(b)).toBeCloseTo(1.3, 5);
      }
    }
    expect(reactSeconds(packReact(REACT.FLOORED, false, 99))).toBeCloseTo(3.1, 5);
    expect(reactSeconds(packReact(REACT.FLOORED, false, 0))).toBeCloseTo(0.1, 5);
    expect(packReact(REACT.NONE, true, 2)).toBe(0);
  });

  it("a lesser blow does not stand a floored man up; a heavier stagger takes over", () => {
    const floored = packReact(REACT.FLOORED, false, 1.5);
    const doubled = packReact(REACT.DOUBLED, false, 1);
    const disarmed = packReact(REACT.DISARMED, true, 0.9);
    expect(reactOverrides(doubled, floored)).toBe(false);
    expect(reactOverrides(disarmed, doubled)).toBe(false);
    expect(reactOverrides(floored, doubled)).toBe(true);
    expect(reactOverrides(floored, floored)).toBe(true);
    expect(reactOverrides(disarmed, 0)).toBe(true);
    expect(reactOverrides(0, floored)).toBe(false);
  });

  it("a wounded or missing arm shakes the aim; the server's cone and the crosshair grow alike", () => {
    expect(aimShake(0, 0)).toBe(1);
    expect(aimShake(setWound(0, ZONE.ARM_R, 1), 0)).toBe(1); // (a scratch does not tremble)
    const gash = aimShake(setWound(0, ZONE.ARM_R, 2), 0);
    const grievous = aimShake(setWound(0, ZONE.ARM_R, 3), 0);
    expect(gash).toBeGreaterThan(1);
    expect(grievous).toBeGreaterThan(gash);
    expect(aimShake(0, LIMB.ARM_L)).toBeGreaterThan(1);
    expect(aimShake(setWound(setWound(0, ZONE.ARM_R, 3), ZONE.ARM_L, 3), LIMB.ARM_L)).toBeLessThanOrEqual(HIT_REACT.shake.max);
    const rifle = WEAPONS[WEAPON.RIFLE].ranged!;
    const steady = spreadFor(rifle, { aiming: true, speed: 0, crouching: false });
    expect(spreadFor(rifle, { aiming: true, speed: 0, crouching: false, shake: 1 })).toBe(steady);
    expect(spreadFor(rifle, { aiming: true, speed: 0, crouching: false, shake: grievous })).toBeCloseTo(steady * grievous, 9);
    expect(spreadFor(rifle, { aiming: true, speed: 0, crouching: false, shake: 0.2 })).toBe(steady); // (nothing steadies a hand past steady)
  });
});

describe("D-105: who a blow would finish (the prompt's half; the server decides from the swing)", () => {
  const DOWN = 1;
  const floored = packReact(REACT.FLOORED, false, 1.5);
  type Row = { x: number; z: number; npc: number; flags: number; react: number };
  const find = (me: { x: number; z: number; facing: number }, rows: Record<string, Row>): string | undefined =>
    findFinisherTarget<string>(me, (cb) => Object.entries(rows).forEach(([k, o]) => cb(k, o)), DOWN);

  it("the nearest staggered NPC in reach and in front; never one standing, one already down, one behind, or a player", () => {
    const me = { x: 0, z: 0, facing: 0 }; // (facing 0 looks down -Z)
    expect(find(me, { a: { x: 0, z: -1.5, npc: 1, flags: 0, react: floored } })).toBe("a");
    expect(find(me, { a: { x: 0, z: -1.5, npc: 1, flags: 0, react: 0 } })).toBeUndefined();
    expect(find(me, { a: { x: 0, z: -1.5, npc: 1, flags: DOWN, react: floored } })).toBeUndefined();
    expect(find(me, { a: { x: 0, z: 1.5, npc: 1, flags: 0, react: floored } })).toBeUndefined();
    expect(find(me, { a: { x: 0, z: -(FINISHER.promptReach + 0.2), npc: 1, flags: 0, react: floored } })).toBeUndefined();
    expect(find(me, { a: { x: 0, z: -1.5, npc: 0, flags: 0, react: floored } })).toBeUndefined();
    // disarmed is not staggered: he is on his feet with his fists up
    expect(find(me, { a: { x: 0, z: -1.5, npc: 1, flags: 0, react: packReact(REACT.DISARMED, true, 0.9) } })).toBeUndefined();
    expect(find(me, { far: { x: 0.3, z: -1.9, npc: 1, flags: 0, react: floored }, near: { x: -0.2, z: -1.1, npc: 1, flags: 0, react: packReact(REACT.DOUBLED, false, 1) } })).toBe("near");
  });
});
