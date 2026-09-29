import { describe, expect, it } from "vitest";
import { BUTTON, FLAG, MOVEMENT, STEP_DT } from "./constants.ts";
import { CollisionWorld } from "./collision.ts";
import { INJURY, canCarry, carryRefusal, createInjuryMods, dressWound, dressableZone, injuryMods, type InjuryMods } from "./injury.ts";
import { LIMB, prosthesisFor } from "./limbs.ts";
import { createCharState, stepCharacter, type MoveCommand } from "./movement.ts";
import { PROP_DEFS, PropKind } from "./props.ts";
import { WOUND_MAX, ZONE, setWound, woundLevel } from "./wounds.ts";
import { findWoundedTarget, type CasualtyView } from "./casualty.ts";

/** Builds a wound mask from {zone: level} pairs. */
const w = (o: Partial<Record<keyof typeof ZONE, number>>): number => {
  let m = 0;
  for (const [k, v] of Object.entries(o)) m = setWound(m, ZONE[k as keyof typeof ZONE], v);
  return m;
};
const mods = (wounds: number, missing = 0, peg = false): InjuryMods => ({ ...injuryMods(wounds, missing, peg, createInjuryMods()) });
const HEAVY = INJURY.heavyPropMass;
const LIGHT = INJURY.lightPropMass;

describe("injuryMods: the one mapping from injuries to abilities", () => {
  // [name, wounds, missing, peg, expected]
  const table: [string, number, number, boolean, Partial<InjuryMods>][] = [
    ["healthy", 0, 0, false, { speedMul: 1, sprintOk: true, jumpOk: true, carryMaxMass: HEAVY, throwMul: 1 }],
    ["scratches everywhere change nothing", w({ HEAD: 1, TORSO: 1, ARM_L: 1, ARM_R: 1, LEG_L: 1, LEG_R: 1 }), 0, false, { speedMul: 1, sprintOk: true, jumpOk: true, carryMaxMass: HEAVY, throwMul: 1 }],
    ["gash on a leg: a little slower, still sprints and jumps", w({ LEG_L: 2 }), 0, false, { speedMul: INJURY.leg.gash, sprintOk: true, jumpOk: true, carryMaxMass: HEAVY }],
    ["grievous leg: slower, no sprint, no jump", w({ LEG_R: 3 }), 0, false, { speedMul: INJURY.leg.grievous, sprintOk: false, jumpOk: false, carryMaxMass: HEAVY }],
    ["two grievous legs compound", w({ LEG_L: 3, LEG_R: 3 }), 0, false, { speedMul: INJURY.leg.grievous ** 2, sprintOk: false, jumpOk: false }],
    ["grievous head: no sprint only", w({ HEAD: 3 }), 0, false, { speedMul: 1, sprintOk: false, jumpOk: true }],
    ["grievous torso: no sprint only", w({ TORSO: 3 }), 0, false, { speedMul: 1, sprintOk: false, jumpOk: true }],
    ["gash head/torso: nothing", w({ HEAD: 2, TORSO: 2 }), 0, false, { sprintOk: true }],
    ["lost left leg (stump is grievous): hobble", w({ LEG_L: 3 }), LIMB.LEG_L, false, { speedMul: INJURY.leg.lost, sprintOk: false, jumpOk: false }],
    ["a dressed stump (2) is the same hobble: the wound on a lost limb is ignored", w({ LEG_L: 2 }), LIMB.LEG_L, false, { speedMul: INJURY.leg.lost, sprintOk: false, jumpOk: false }],
    ["lost leg + peg leg: faster and can jump, never sprints", w({ LEG_L: 3 }), LIMB.LEG_L, true, { speedMul: INJURY.leg.peg, sprintOk: false, jumpOk: true }],
    ["peg on a healthy body is nothing", 0, 0, true, { speedMul: 1, sprintOk: true, jumpOk: true }],
    ["lost leg + peg + gash on the other leg", w({ LEG_R: 2 }), LIMB.LEG_L, true, { speedMul: INJURY.leg.peg * INJURY.leg.gash, sprintOk: false, jumpOk: true }],
    ["lost leg + peg + grievous other leg: no jump", w({ LEG_R: 3 }), LIMB.LEG_L, true, { speedMul: INJURY.leg.peg * INJURY.leg.grievous, jumpOk: false }],
    ["both legs lost: a crawl", 0, LIMB.LEG_L | LIMB.LEG_R, false, { speedMul: INJURY.leg.lost ** 2, sprintOk: false, jumpOk: false }],
    ["both legs lost, one peg: still no jump", 0, LIMB.LEG_L | LIMB.LEG_R, true, { speedMul: INJURY.leg.peg * INJURY.leg.lost, jumpOk: false }],
    ["lost arm: light props only, half-strength throws", 0, LIMB.ARM_R, false, { speedMul: 1, sprintOk: true, jumpOk: true, carryMaxMass: LIGHT, throwMul: 0.5 }],
    ["both arms lost: cannot carry or throw", 0, LIMB.ARM_L | LIMB.ARM_R, false, { carryMaxMass: 0, throwMul: 0 }],
    ["gash on an arm: still two-handed, throws a little weaker", w({ ARM_L: 2 }), 0, false, { carryMaxMass: HEAVY, throwMul: (INJURY.arm.gash + 1) / 2 }],
    ["grievous arm: light props only", w({ ARM_R: 3 }), 0, false, { carryMaxMass: LIGHT, throwMul: (INJURY.arm.grievous + 1) / 2 }],
    ["both arms grievous but present: still a light prop, weak throw", w({ ARM_L: 3, ARM_R: 3 }), 0, false, { carryMaxMass: LIGHT, throwMul: INJURY.arm.grievous }],
    ["one arm lost, other grievous", w({ ARM_L: 3 }), LIMB.ARM_R, false, { carryMaxMass: LIGHT, throwMul: INJURY.arm.grievous / 2 }],
    ["arm and leg injuries are independent", w({ LEG_R: 3 }), LIMB.ARM_L, false, { speedMul: INJURY.leg.grievous, sprintOk: false, jumpOk: false, carryMaxMass: LIGHT, throwMul: 0.5 }],
  ];
  it.each(table)("%s", (_name, wounds, missing, peg, expected) => {
    const m = mods(wounds, missing, peg);
    for (const [k, v] of Object.entries(expected)) {
      if (typeof v === "number") expect(m[k as keyof InjuryMods] as number).toBeCloseTo(v, 9);
      else expect(m[k as keyof InjuryMods]).toBe(v);
    }
  });

  it("is monotone: adding a wound or removing a limb never improves any ability", () => {
    const rank = (m: InjuryMods) => [m.speedMul, +m.sprintOk, +m.jumpOk, m.carryMaxMass, m.throwMul];
    for (let zone = 0; zone < 6; zone++) {
      for (let level = 0; level < WOUND_MAX; level++) {
        const a = rank(mods(setWound(0, zone, level)));
        const b = rank(mods(setWound(0, zone, level + 1)));
        b.forEach((v, i) => expect(v).toBeLessThanOrEqual(a[i]!));
      }
    }
    for (const limb of [LIMB.ARM_L, LIMB.ARM_R, LIMB.LEG_L, LIMB.LEG_R]) {
      for (const peg of [false, true]) {
        const a = rank(mods(0, 0, peg));
        const b = rank(mods(0, limb, peg));
        b.forEach((v, i) => expect(v).toBeLessThanOrEqual(a[i]!));
      }
    }
  });

  it("a wooden leg reduces the hobble but never removes it", () => {
    const bare = mods(0, LIMB.LEG_R);
    const peg = mods(0, LIMB.LEG_R, true);
    expect(peg.speedMul).toBeGreaterThan(bare.speedMul);
    expect(peg.speedMul).toBeLessThan(1);
    expect(peg.sprintOk).toBe(false);
  });

  it("fills the struct it is given and allocates nothing (returns the same object); undefined inputs read as healthy", () => {
    const out = createInjuryMods();
    expect(injuryMods(0, 0, false, out)).toBe(out);
    injuryMods(undefined as never, undefined as never, false, out); // client schema numbers are undefined before first assignment
    expect(out.speedMul).toBe(1);
    expect(out.carryMaxMass).toBe(HEAVY);
  });

  it("carry rule: crates and barrels need two sound arms; bottles and chairs need one arm", () => {
    const heavy = [PropKind.CRATE, PropKind.BARREL].map((k) => PROP_DEFS[k].mass);
    const light = [PropKind.BOTTLE, PropKind.CHAIR].map((k) => PROP_DEFS[k].mass);
    for (const mass of heavy) expect(mass).toBeGreaterThan(LIGHT); // tuning guard: heavy props stay two-handed
    for (const mass of light) expect(mass).toBeLessThanOrEqual(LIGHT);
    const oneArm = mods(0, LIMB.ARM_L);
    const noArms = mods(0, LIMB.ARM_L | LIMB.ARM_R);
    const fine = mods(0);
    for (const mass of heavy) [fine, oneArm, noArms].forEach((m, i) => expect(canCarry(m, mass)).toBe(i === 0));
    for (const mass of light) [fine, oneArm, noArms].forEach((m, i) => expect(canCarry(m, mass)).toBe(i < 2));
    expect(carryRefusal(oneArm)).toMatch(/no state to carry/);
    expect(carryRefusal(noArms)).toMatch(/no arms/);
  });
});

describe("prosthesisFor: a wooden leg only counts where a leg is missing", () => {
  it.each([
    [1, LIMB.LEG_L, true],
    [2, LIMB.LEG_R, true],
    [1, LIMB.LEG_R, false],
    [2, LIMB.LEG_L, false],
    [1, 0, false],
    [0, LIMB.LEG_L | LIMB.LEG_R, false],
    [2, LIMB.LEG_L | LIMB.LEG_R, true],
    [1, LIMB.ARM_L, false],
  ])("wooden leg %i, missing %i -> %s", (leg, missing, expected) => expect(prosthesisFor(leg, missing)).toBe(expected));
});

describe("injuries inside the shared movement step", () => {
  const flat = new CollisionWorld({ height: () => 0 }, [], 100);
  const fwd = (over: Partial<MoveCommand> = {}): MoveCommand => ({ moveF: 127, moveR: 0, yaw: 0, buttons: 0, ...over });
  const run = (wounds: number, missing: number, cmd: MoveCommand, flags = 0, steps = 45) => {
    const s = createCharState(0, 0, flat);
    s.wounds = wounds;
    s.missing = missing;
    s.flags |= flags;
    let peakY = 0;
    for (let i = 0; i < steps; i++) {
      stepCharacter(s, cmd, STEP_DT, flat);
      peakY = Math.max(peakY, s.y);
    }
    return { speed: Math.hypot(s.vx, s.vz), peakY, s };
  };
  const SPRINT_JUMP = fwd({ buttons: BUTTON.SPRINT | BUTTON.JUMP });

  it("the healthy baseline sprints and jumps", () => {
    const r = run(0, 0, SPRINT_JUMP);
    expect(r.speed).toBeCloseTo(MOVEMENT.sprintSpeed, 1);
    expect(r.peakY).toBeGreaterThan(0.5);
  });
  it("a grievous leg forbids sprinting and jumping and slows walking", () => {
    const r = run(w({ LEG_L: 3 }), 0, SPRINT_JUMP);
    expect(r.speed).toBeCloseTo(MOVEMENT.runSpeed * INJURY.leg.grievous, 1);
    expect(r.peakY).toBe(0);
    expect(run(w({ LEG_L: 3 }), 0, fwd()).speed).toBeCloseTo(MOVEMENT.runSpeed * INJURY.leg.grievous, 1);
  });
  it("a lost leg is a hobble; a peg leg softens it and gives back the jump but never the sprint", () => {
    const bare = run(0, LIMB.LEG_R, SPRINT_JUMP);
    expect(bare.speed).toBeCloseTo(MOVEMENT.runSpeed * INJURY.leg.lost, 1);
    expect(bare.peakY).toBe(0);
    const peg = run(0, LIMB.LEG_R, SPRINT_JUMP, FLAG.PEG_LEG);
    expect(peg.speed).toBeCloseTo(MOVEMENT.runSpeed * INJURY.leg.peg, 1);
    expect(peg.speed).toBeLessThan(MOVEMENT.runSpeed);
    expect(peg.peakY).toBeGreaterThan(0.5);
  });
  it("a peg flag with no missing leg does nothing", () => {
    expect(run(0, 0, SPRINT_JUMP, FLAG.PEG_LEG).speed).toBeCloseTo(MOVEMENT.sprintSpeed, 1);
  });
  it("a grievous head or torso only costs the sprint", () => {
    for (const z of ["HEAD", "TORSO"] as const) expect(run(w({ [z]: 3 }), 0, SPRINT_JUMP).speed).toBeCloseTo(MOVEMENT.runSpeed, 1);
  });
  it("arm injuries do not slow walking (they gate carrying, on the server)", () => {
    expect(run(0, LIMB.ARM_L | LIMB.ARM_R, SPRINT_JUMP).speed).toBeCloseTo(MOVEMENT.sprintSpeed, 1);
  });
  it("a downed body crawls at the crawl speed whatever it lost", () => {
    expect(run(w({ LEG_L: 3 }), LIMB.LEG_L | LIMB.LEG_R, fwd(), FLAG.DOWNED).speed).toBeCloseTo(MOVEMENT.crawlSpeed, 1);
  });
  it("injuries do not touch the step's determinism, and the step never writes them", () => {
    const a = run(w({ LEG_L: 3 }), LIMB.ARM_R, SPRINT_JUMP).s;
    const b = run(w({ LEG_L: 3 }), LIMB.ARM_R, SPRINT_JUMP).s;
    expect(a).toEqual(b);
    expect(a.wounds).toBe(w({ LEG_L: 3 }));
    expect(a.missing).toBe(LIMB.ARM_R);
  });
  it("a wound landing mid-run only bends the velocity: no position jump", () => {
    const s = createCharState(0, 0, flat);
    let prev = 0;
    let worstStep = 0;
    for (let i = 0; i < 90; i++) {
      if (i === 45) s.wounds = w({ LEG_L: 3, LEG_R: 3 });
      stepCharacter(s, fwd({ buttons: BUTTON.SPRINT }), STEP_DT, flat);
      worstStep = Math.max(worstStep, Math.abs(s.z - prev));
      prev = s.z;
    }
    expect(worstStep).toBeLessThan(MOVEMENT.sprintSpeed * STEP_DT + 1e-6);
  });
});

describe("field dressing rule", () => {
  it("dresses the worst dressable zone, one level, legs before arms before torso before head on ties", () => {
    expect(dressableZone(0, 0)).toBe(-1);
    expect(dressableZone(w({ HEAD: 2, TORSO: 2, ARM_R: 2, LEG_R: 2 }), 0)).toBe(ZONE.LEG_R);
    expect(dressableZone(w({ HEAD: 2, TORSO: 2 }), 0)).toBe(ZONE.TORSO);
    expect(dressableZone(w({ HEAD: 3, LEG_L: 2 }), 0)).toBe(ZONE.HEAD);
    const next = dressWound(w({ HEAD: 3, LEG_L: 2 }), 0);
    expect(woundLevel(next, ZONE.HEAD)).toBe(2);
    expect(woundLevel(next, ZONE.LEG_L)).toBe(2);
  });
  it("is capped: a scratch stays a scratch and a stump stays at a dressed stump, so healing is finite", () => {
    expect(dressableZone(w({ HEAD: 1, LEG_L: 1 }), 0)).toBe(-1);
    expect(dressWound(w({ HEAD: 1 }), 0)).toBe(w({ HEAD: 1 }));
    const stump = w({ ARM_L: 3 });
    const once = dressWound(stump, LIMB.ARM_L);
    expect(woundLevel(once, ZONE.ARM_L)).toBe(2);
    expect(dressWound(once, LIMB.ARM_L)).toBe(once);
    // Whatever the start, repeated dressing terminates within (zones * levels) steps and never drops below the floors.
    let mask = w({ HEAD: 3, TORSO: 3, ARM_L: 3, ARM_R: 3, LEG_L: 3, LEG_R: 3 });
    const missing = LIMB.ARM_L | LIMB.LEG_R;
    let n = 0;
    while (dressableZone(mask, missing) >= 0) {
      mask = dressWound(mask, missing);
      expect(++n).toBeLessThan(13);
    }
    expect(n).toBe(2 + 2 + 1 + 2 + 2 + 1); // head 3->1, torso 3->1, ARM_L stump 3->2, ARM_R 3->1, LEG_L 3->1, LEG_R stump 3->2
    expect(woundLevel(mask, ZONE.ARM_L)).toBe(INJURY.stumpFloor);
    expect(woundLevel(mask, ZONE.HEAD)).toBe(INJURY.dressFloor);
  });
  it("findWoundedTarget picks standing, wounded, in-reach comrades only", () => {
    const self: CasualtyView = { x: 0, y: 0, z: 0, facing: 0, flags: 0 };
    const at = (z: number, wounds: number, flags = 0): CasualtyView => ({ x: 0, y: 0, z, facing: 0, flags, wounds, missing: 0 });
    const cast = [at(-1, w({ LEG_L: 2 })), at(-1.2, 0), at(-0.8, w({ ARM_L: 3 }), FLAG.DOWNED), at(-5, w({ TORSO: 3 })), at(-1.5, w({ HEAD: 1 }))];
    const found = findWoundedTarget<number>(self, 1.8, (cb) => cast.forEach((o, i) => cb(i, o)));
    expect(found).toBe(0);
    expect(findWoundedTarget<number>(self, 1.8, (cb) => [cast[1]!, cast[2]!, cast[3]!, cast[4]!].forEach((o, i) => cb(i, o)))).toBeUndefined();
  });
});
