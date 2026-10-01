import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { BUTTON, FLAG, STEP_DT } from "./constants.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { createRegionWorld, regionSpawn } from "./regions.ts";
import { Rng } from "./rng.ts";
import { LIMB } from "./limbs.ts";
import { ZONE, setWound } from "./wounds.ts";
import { axisToWire, createCharState, stepCharacter, yawToWire, type CharState, type MoveCommand } from "./movement.ts";
import {
  GAIT,
  MOUNT,
  MOUNT_FLAG,
  WAGON,
  gaitOf,
  hitchPoint,
  mountReach,
  regionMountSpots,
  riderBodyLift,
  stepMounted,
  throwDamage,
  throwRisk,
  throwRiskValue,
  throwRoll,
  trailStep,
  wagonToWorld,
  type Trailer,
} from "./mount.ts";

const flat = (obstacles: Obstacle[] = []) => new CollisionWorld({ height: () => 0 }, obstacles, 200);
const cmd = (over: Partial<MoveCommand> = {}): MoveCommand => ({ moveF: 127, moveR: 0, yaw: 0, buttons: 0, ...over });
const rider = (w: CollisionWorld, x = 0, z = 0, facing = 0, extra = 0): CharState => {
  const s = createCharState(x, z, w);
  s.facing = facing;
  s.flags |= MOUNT_FLAG.MOUNTED | extra;
  return s;
};
const run = (s: CharState, c: MoveCommand, seconds: number, w: CollisionWorld): void => {
  for (let i = 0; i < Math.round(seconds / STEP_DT); i++) stepMounted(s, c, STEP_DT, w);
};
const speedOf = (s: CharState): number => Math.hypot(s.vx, s.vz);

/**
 * Bytes allocated per call, as a median over windows, measured from a forced GC. (This engine boxes a double each time one is stored into an object field, so a step that
 * writes state allocates a few hundred bytes whatever it does: the walker's step measures the same. "Allocation-free" here means no objects, arrays or closures per
 * step, which shows as being no worse than the walker.)
 */
function bytesPerCall(call: (i: number) => void): number {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  for (let i = 0; i < 20000; i++) call(i);
  const deltas: number[] = [];
  for (let k = 0; k < 5; k++) {
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) call(i);
    deltas.push((process.memoryUsage().heapUsed - before) / 20000);
  }
  return deltas.sort((a, b) => a - b)[2]!;
}

describe("mount flags", () => {
  it("do not collide with the existing FLAG bits (phase 0 mirrors these values into FLAG)", () => {
    for (const [name, v] of Object.entries(MOUNT_FLAG)) {
      expect(v & (v - 1)).toBe(0); // a single bit
      for (const [other, bit] of Object.entries(FLAG)) if ((bit & v) !== 0) expect(other).toBe(name); // taken only by the same name, once phase 0 has mirrored it
    }
    expect(MOUNT_FLAG).toEqual({ MOUNTED: 4096, HITCHED: 8192, GALLOPING: 16384 });
    expect(Math.max(...Object.values(MOUNT_FLAG))).toBeLessThan(65536); // PlayerState.flags is uint16
  });

  it("are the same bits as FLAG's, and stepCharacter hands a MOUNTED body to stepMounted (one shared step for client and server)", () => {
    expect({ MOUNTED: FLAG.MOUNTED, HITCHED: FLAG.HITCHED, GALLOPING: FLAG.GALLOPING }).toEqual(MOUNT_FLAG);
    const world = createRegionWorld("hollowmere", 7);
    const a = createCharState(0, 30, world);
    const b = createCharState(0, 30, world);
    a.flags |= FLAG.MOUNTED;
    b.flags |= FLAG.MOUNTED;
    const cmd: MoveCommand = { moveF: 127, moveR: 0, yaw: 0, buttons: BUTTON.SPRINT };
    for (let i = 0; i < 60; i++) {
      stepCharacter(a, cmd, STEP_DT, world);
      stepMounted(b, cmd, STEP_DT, world);
    }
    expect(a).toEqual(b);
    expect(Math.hypot(a.vx, a.vz)).toBeGreaterThan(8); // a walker's sprint is 6.6 m/s: this is a gallop
    const walker = createCharState(0, 30, world);
    for (let i = 0; i < 60; i++) stepCharacter(walker, cmd, STEP_DT, world);
    expect(Math.hypot(walker.vx, walker.vz)).toBeLessThan(7);
  });
});

describe("stepMounted: gaits and steering", () => {
  it("walks, trots and gallops by stick and SPRINT, and raises GALLOPING only at speed", () => {
    const w = flat();
    const a = rider(w);
    run(a, cmd({ moveF: 40 }), 3, w);
    expect(speedOf(a)).toBeCloseTo(MOUNT.walk, 1);
    expect(gaitOf(speedOf(a))).toBe(GAIT.walk);
    const b = rider(w);
    run(b, cmd(), 4, w);
    expect(speedOf(b)).toBeCloseTo(MOUNT.trot, 1);
    expect(b.flags & MOUNT_FLAG.GALLOPING).toBe(0);
    run(b, cmd({ buttons: BUTTON.SPRINT }), 4, w);
    expect(speedOf(b)).toBeCloseTo(MOUNT.gallop, 1);
    expect((b.flags & MOUNT_FLAG.GALLOPING) !== 0).toBe(true);
    expect(gaitOf(speedOf(b))).toBe(GAIT.gallop);
    // the horse is faster than a walker's sprint
    expect(MOUNT.gallop).toBeGreaterThan(6.6);
  });

  it("goes along its facing only: velocity never strafes, even right after the stick swings", () => {
    const w = flat();
    const s = rider(w);
    run(s, cmd(), 2, w);
    for (let i = 0; i < 90; i++) {
      stepMounted(s, cmd({ moveF: 0, moveR: 127 }), STEP_DT, w);
      const along = s.vx * -Math.sin(s.facing) + s.vz * -Math.cos(s.facing);
      expect(Math.hypot(s.vx, s.vz) - along).toBeLessThan(1e-6);
    }
  });

  it("an about-turn brakes first, then goes", () => {
    const w = flat();
    const s = rider(w);
    run(s, cmd({ buttons: BUTTON.SPRINT }), 4, w);
    const v0 = speedOf(s);
    // stick straight back (camera still looking north)
    stepMounted(s, cmd({ moveF: -127, buttons: BUTTON.SPRINT }), STEP_DT, w);
    expect(speedOf(s)).toBeLessThan(v0 - 0.5);
    run(s, cmd({ moveF: -127, buttons: BUTTON.SPRINT }), 2.5, w);
    expect(s.vz).toBeGreaterThan(5);
  });

  it("swings wide at a gallop: the turning radius is >= 8 m, and tighter at a walk", () => {
    const w = flat();
    const radiusAt = (button: number, stickMag: number): number => {
      const s = rider(w);
      run(s, cmd({ buttons: button, moveF: stickMag }), 5, w);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 60; i++) {
        // keep the commanded heading 0.5 rad ahead of the facing: full turning, no speed lost to the angle
        const yaw = s.facing + 0.5;
        const f0 = s.facing;
        stepMounted(s, cmd({ yaw: yawToWire(yaw), buttons: button, moveF: stickMag }), STEP_DT, w);
        const dAng = Math.abs(Math.atan2(Math.sin(s.facing - f0), Math.cos(s.facing - f0))) / STEP_DT;
        if (dAng > 0.05) {
          sum += speedOf(s) / dAng;
          n++;
        }
      }
      return sum / n;
    };
    expect(radiusAt(BUTTON.SPRINT, 127)).toBeGreaterThanOrEqual(8);
    expect(radiusAt(0, 40)).toBeLessThan(radiusAt(BUTTON.SPRINT, 127));
  });

  it("a hitched horse is slower and turns slower; a rider with no arms steers at half rate", () => {
    const w = flat();
    const free = rider(w);
    const hitched = rider(w, 0, 0, 0, MOUNT_FLAG.HITCHED);
    run(free, cmd(), 5, w);
    run(hitched, cmd(), 5, w);
    expect(speedOf(hitched)).toBeCloseTo(MOUNT.trot * MOUNT.hitchMul, 1);
    expect(speedOf(hitched)).toBeLessThan(speedOf(free));
    const turn = (s: CharState): number => {
      for (let i = 0; i < 6; i++) stepMounted(s, cmd({ moveF: 0, moveR: 127 }), STEP_DT, w);
      return Math.abs(s.facing);
    };
    const a = rider(w);
    const b = rider(w);
    b.missing = LIMB.ARM_L | LIMB.ARM_R;
    expect(turn(b)).toBeCloseTo(turn(a) * MOUNT.noArmsSteer, 3);
  });

  it("legs are the horse's: lost and grievous legs change nothing; a winded rider cannot ask for the gallop", () => {
    const w = flat();
    const healthy = rider(w);
    const crippled = rider(w);
    crippled.missing = LIMB.LEG_L | LIMB.LEG_R;
    crippled.wounds = setWound(setWound(0, ZONE.LEG_L, 3), ZONE.LEG_R, 3);
    run(healthy, cmd({ buttons: BUTTON.SPRINT }), 6, w);
    run(crippled, cmd({ buttons: BUTTON.SPRINT }), 6, w);
    expect(crippled.z).toBeCloseTo(healthy.z, 6);
    const winded = rider(w);
    winded.wounds = setWound(0, ZONE.TORSO, 3);
    run(winded, cmd({ buttons: BUTTON.SPRINT }), 6, w);
    expect(speedOf(winded)).toBeCloseTo(MOUNT.trot, 1);
  });
});

describe("stepMounted: world", () => {
  it("is slower than a walker up a steep slope, and will not climb past its limit", () => {
    // z negative is uphill: height = k * (-z)
    const ramp = (k: number) => new CollisionWorld({ height: (_x: number, z: number) => Math.max(0, -z) * k }, [], 200);
    for (const k of [0.5, 0.7]) {
      const w = ramp(k);
      const h = rider(w);
      const walker = createCharState(0, 0, w);
      for (let i = 0; i < 150; i++) {
        stepMounted(h, cmd(), STEP_DT, w);
        stepCharacter(walker, cmd({ buttons: BUTTON.SPRINT }), STEP_DT, w);
      }
      // (both on a slope: the horse's speed is penalised by the slope it faces, so it is slower than on the flat)
      expect(speedOf(h)).toBeLessThan(MOUNT.trot * (1 - 0.5 * MOUNT.climbPenalty * (k / MOUNT.maxSlope)));
    }
    const steep = ramp(1.0);
    const h = rider(steep);
    const walker = createCharState(0, 0, steep);
    for (let i = 0; i < 150; i++) {
      stepMounted(h, cmd(), STEP_DT, steep);
      stepCharacter(walker, cmd(), STEP_DT, steep);
    }
    expect(walker.z).toBeLessThan(-8); // the walker (limit 1.2) climbs it
    expect(h.z).toBeGreaterThan(-1); // the horse (limit 0.8) does not
  });

  it("walls shed speed (the displacement goes back into the velocity), and the rider stops against them", () => {
    const w = flat([{ kind: "box", x: 0, z: -30, hx: 6, hz: 0.5, yaw: 0, y0: -1, y1: 3 }]);
    const s = rider(w, 0, 40);
    run(s, cmd({ buttons: BUTTON.SPRINT }), 4, w);
    expect(speedOf(s)).toBeGreaterThan(10);
    let shed = 0;
    for (let i = 0; i < 150; i++) {
      const before = speedOf(s);
      stepMounted(s, cmd({ buttons: BUTTON.SPRINT }), STEP_DT, w);
      shed = Math.max(shed, before - speedOf(s));
    }
    expect(shed).toBeGreaterThan(5);
    expect(s.z).toBeGreaterThan(-30 + 0.5 + MOUNT.radius - 0.05);
  });

  it("jumps with a run-up only, clears a 1.1 m wall and not a 1.6 m one", () => {
    const wallAt = (h: number) => flat([{ kind: "box", x: 0, z: -40, hx: 8, hz: 0.25, yaw: 0, y0: -1, y1: h }]);
    /** Rides at the wall and presses JUMP when `lead` metres short of it; returns where the horse ends up (z). */
    const cross = (h: number, button: number, lead: number): number => {
      const w = wallAt(h);
      const s = rider(w, 0, 0, 0);
      let jumped = false;
      for (let i = 0; i < 300; i++) {
        const dist = s.z - -40;
        const jump = !jumped && dist <= lead;
        if (jump) jumped = true;
        stepMounted(s, cmd({ buttons: button | (jump ? BUTTON.JUMP : 0) }), STEP_DT, w);
      }
      return s.z;
    };
    const best = (h: number, button: number): number => {
      let reach = Infinity;
      for (let lead = 1; lead <= 9; lead += 0.25) reach = Math.min(reach, cross(h, button, lead));
      return reach;
    };
    expect(best(1.1, BUTTON.SPRINT)).toBeLessThan(-41);
    expect(best(1.1, 0)).toBeLessThan(-41); // a trot clears it too
    for (const button of [BUTTON.SPRINT, 0]) expect(best(1.6, button)).toBeGreaterThan(-40 + 0.25 + MOUNT.radius - 0.05);
    // no run-up, no jump
    const w = flat();
    const s = rider(w);
    stepMounted(s, cmd({ moveF: 0, buttons: BUTTON.JUMP }), STEP_DT, w);
    expect(s.vy).toBe(0);
    // no air control: the heading and speed are what they were at take-off
    const air = rider(w);
    run(air, cmd(), 3, w);
    stepMounted(air, cmd({ buttons: BUTTON.JUMP }), STEP_DT, w);
    expect(air.vy).toBeCloseTo(MOUNT.jumpSpeed - 22 * STEP_DT, 5);
    const f0 = air.facing;
    const v0 = speedOf(air);
    for (let i = 0; i < 5; i++) stepMounted(air, cmd({ moveF: 0, moveR: 127, buttons: BUTTON.JUMP }), STEP_DT, w);
    expect(air.facing).toBe(f0);
    expect(speedOf(air)).toBeCloseTo(v0, 6);
  });

  it("never ends a step inside an obstacle (fuzz on the real arena and Kessar)", () => {
    for (const [name, w] of [["arena", createRegionWorld("hollowmere", 3)], ["kessar", createRegionWorld("kessar", 3)]] as const) {
      const rng = new Rng(11);
      const at = regionSpawn(name === "arena" ? "hollowmere" : "kessar", 0, 1);
      const s = rider(w, at.x, at.z);
      let cx = 0;
      for (let i = 0; i < 6000; i++) {
        if (i % 40 === 0) cx = rng.range(0, 6.28);
        stepMounted(s, cmd({ moveF: axisToWire(rng.range(0.2, 1)), moveR: axisToWire(rng.range(-1, 1)), yaw: yawToWire(cx + rng.range(-0.3, 0.3)), buttons: (rng.chance(0.5) ? BUTTON.SPRINT : 0) | (rng.chance(0.03) ? BUTTON.JUMP : 0) }), STEP_DT, w);
        const probe = { x: s.x, z: s.z };
        const moved = w.resolveXZ(probe, s.y - MOUNT.stepDrop, MOUNT.radius - 0.02, MOUNT.height + MOUNT.stepDrop);
        expect(moved, `${name} step ${i} at ${s.x.toFixed(2)},${s.z.toFixed(2)}`).toBe(false);
      }
    }
  });

  it("is bit-for-bit deterministic and allocation-free", () => {
    const w = createRegionWorld("hollowmere", 9);
    const make = (): MoveCommand[] => {
      const rng = new Rng(5);
      return Array.from({ length: 900 }, () => ({ moveF: axisToWire(rng.range(-1, 1)), moveR: axisToWire(rng.range(-1, 1)), yaw: yawToWire(rng.range(0, 6.28)), buttons: (rng.chance(0.4) ? BUTTON.SPRINT : 0) | (rng.chance(0.05) ? BUTTON.JUMP : 0) }));
    };
    const play = (): CharState => {
      const s = rider(w, 2, 3);
      for (const c of make()) stepMounted(s, c, STEP_DT, w);
      return s;
    };
    expect(play()).toEqual(play());
    const m = rider(w, 2, 3);
    const k = createCharState(2, 3, w);
    const c = cmd({ buttons: BUTTON.SPRINT });
    const mounted = bytesPerCall((i) => {
      c.yaw = (i * 37) & 0xffff;
      stepMounted(m, c, STEP_DT, w);
    });
    const walker = bytesPerCall((i) => {
      c.yaw = (i * 37) & 0xffff;
      stepCharacter(k, c, STEP_DT, w);
    });
    expect(mounted).toBeLessThanOrEqual(walker * 1.3 + 16);
  });
});

describe("the throw table", () => {
  it("a wall at a gallop throws; a trot nudge does not", () => {
    for (const roll of [0, 0.5, 0.99]) expect(throwRisk(MOUNT.gallop, 0, 0, 0, roll)).toBe(true);
    for (const roll of [0, 0.5, 0.99]) expect(throwRisk(MOUNT.trot, MOUNT.trot - 1.4, 0, 0, roll)).toBe(false);
    expect(throwRiskValue(MOUNT.trot, 0, 0, 0)).toBeGreaterThan(0.3); // a trot into a wall is a coin toss
    expect(throwRiskValue(MOUNT.walk, 0, 0, 0)).toBe(0); // a walk never is
  });

  it("grievous arms and lost arms raise the risk, but only when something actually hits", () => {
    const grievous = setWound(setWound(0, ZONE.ARM_L, 3), ZONE.ARM_R, 3);
    const base = throwRiskValue(7, 3, 0, 0);
    expect(throwRiskValue(7, 3, 0, grievous)).toBeGreaterThan(base);
    expect(throwRiskValue(7, 3, 0, 0, LIMB.ARM_L | LIMB.ARM_R)).toBeGreaterThan(throwRiskValue(7, 3, 0, grievous));
    expect(throwRiskValue(5, 5, 0, grievous, LIMB.ARM_L | LIMB.ARM_R)).toBe(0); // no impact, no throw, however maimed
    expect(throwRiskValue(5, 5, 1, grievous)).toBeLessThan(0.1);
  });

  it("a blast's push counts as impact", () => {
    expect(throwRiskValue(MOUNT.walk, MOUNT.walk, 9, 0)).toBeGreaterThan(0.5);
  });

  it("the roll is deterministic and uniform enough; damage is bounded", () => {
    expect(throwRoll(5, 100, 1)).toBe(throwRoll(5, 100, 1));
    expect(throwRoll(5, 100, 1)).not.toBe(throwRoll(5, 101, 1));
    let low = 0;
    for (let i = 0; i < 1000; i++) if (throwRoll(77, i, 2) < 0.5) low++;
    expect(low).toBeGreaterThan(420);
    expect(low).toBeLessThan(580);
    expect(throwDamage(0)).toBe(0);
    expect(throwDamage(MOUNT.gallop)).toBeGreaterThan(8);
    expect(throwDamage(1000)).toBe(18);
  });
});

describe("gaits and reach", () => {
  it("gaitOf walks through the gaits in order", () => {
    const seq = [0, 1, 3, 5, 6.4, 8, 9.5, 10.5].map(gaitOf);
    expect(seq).toEqual([...seq].sort());
    expect(gaitOf(0)).toBe(GAIT.idle);
    expect(gaitOf(MOUNT.gallop)).toBe(GAIT.gallop);
    expect(gaitOf(MOUNT.trot)).toBe(GAIT.trot);
  });
  it("reach is a plain horizontal radius", () => {
    expect(mountReach(0, 0, 2.3, 0)).toBe(true);
    expect(mountReach(0, 0, 2.5, 0)).toBe(false);
    expect(mountReach(0, 0, 5, 0)).toBe(false);
  });
});

describe("trailStep", () => {
  const hitch = { x: 0, z: 0 };
  it("holds the axle `len` behind the hitch and faces the horse", () => {
    const w = flat();
    const t: Trailer = { x: 0, z: 5, facing: 0 };
    trailStep(t, 0, 0, STEP_DT, w);
    expect(Math.hypot(t.x, t.z)).toBeCloseTo(WAGON.len, 6);
    expect(t.facing).toBeCloseTo(0, 6); // axle south of the hitch: it faces north
    trailStep(t, 4, 0, STEP_DT, w); // the horse jumps east: the wagon swings round behind it
    expect(Math.hypot(t.x - 4, t.z)).toBeCloseTo(WAGON.len, 6);
    expect(t.facing).toBeCloseTo(Math.atan2(-(4 - t.x), -(0 - t.z)), 6);
    // a wagon laid exactly on its hitch falls behind it
    const u: Trailer = { x: 1, z: 1, facing: Math.PI / 2 };
    trailStep(u, 1, 1, STEP_DT, w);
    expect(Math.hypot(u.x - 1, u.z - 1)).toBeCloseTo(WAGON.len, 6);
  });

  it("never penetrates an obstacle while a horse drags it round the arena and through Kessar", () => {
    for (const [name, w, x0, z0] of [["arena", createRegionWorld("hollowmere", 4), 4, 6], ["kessar", createRegionWorld("kessar", 4), 0, 80]] as const) {
      const rng = new Rng(3);
      const horse = rider(w, x0, z0, 0, MOUNT_FLAG.HITCHED);
      const wagon: Trailer = { x: x0, z: z0 + 3, facing: 0 };
      let heading = 0;
      let travelled = 0;
      let lastX = wagon.x;
      let lastZ = wagon.z;
      for (let i = 0; i < 4000; i++) {
        if (i % 60 === 0) heading = rng.range(0, 6.28);
        stepMounted(horse, cmd({ yaw: yawToWire(heading), buttons: BUTTON.SPRINT }), STEP_DT, w);
        hitchPoint(horse.x, horse.z, horse.facing, hitch);
        trailStep(wagon, hitch.x, hitch.z, STEP_DT, w);
        travelled += Math.hypot(wagon.x - lastX, wagon.z - lastZ);
        lastX = wagon.x;
        lastZ = wagon.z;
        const probe = { x: wagon.x, z: wagon.z };
        expect(w.resolveXZ(probe, w.terrainHeight(wagon.x, wagon.z) + 0.3 - MOUNT.stepDrop, WAGON.radius - 0.02, WAGON.height + MOUNT.stepDrop), `${name} step ${i}`).toBe(false);
      }
      expect(travelled, `${name}: the wagon did follow`).toBeGreaterThan(40);
    }
  });

  it("is allocation-free (no worse than the walker's step)", () => {
    const w = createRegionWorld("hollowmere", 4);
    const t: Trailer = { x: 0, z: 3, facing: 0 };
    const k = createCharState(2, 3, w);
    const c = cmd({ buttons: BUTTON.SPRINT });
    const walker = bytesPerCall((i) => {
      c.yaw = (i * 37) & 0xffff;
      stepCharacter(k, c, STEP_DT, w);
    });
    // (integer arguments: a double passed to a function that is not inlined is boxed by the engine, which would be the test allocating, not the step)
    const trail = bytesPerCall((i) => {
      trailStep(t, (i >> 2) & 7, (i >> 5) & 7, STEP_DT, w);
    });
    expect(trail).toBeLessThanOrEqual(walker + 16);
  });

  it("the wagon frame maps bays to the world with the wagon's facing", () => {
    const out = { x: 0, z: 0 };
    wagonToWorld({ x: 10, z: 10, facing: 0 }, 1, 0, out); // right of a north-facing wagon is east
    expect(out.x).toBeCloseTo(11, 6);
    expect(out.z).toBeCloseTo(10, 6);
    wagonToWorld({ x: 10, z: 10, facing: 0 }, 0, 1, out); // behind it is south
    expect(out.z).toBeCloseTo(11, 6);
    wagonToWorld({ x: 10, z: 10, facing: Math.PI / 2 }, 0, 1, out); // facing west, behind it is east
    expect(out.x).toBeCloseTo(11, 6);
    expect(WAGON.bays).toHaveLength(4);
    expect(WAGON.bodyBays).toHaveLength(2);
  });
});

describe("regionMountSpots", () => {
  for (const [id, bridge] of [["hollowmere", "intact"], ["kessar", "intact"], ["kessar", "collapsed"]] as const) {
    it(`every spot is open under the real step in ${id} (${bridge}) across seeds`, () => {
      const spots = regionMountSpots(id);
      expect(spots.horses).toHaveLength(2);
      for (let seed = 1; seed <= 24; seed++) {
        const w = createRegionWorld(id, seed, { bridge });
        for (const [kind, sp, radius, h] of [
          ["horse", spots.horses[0]!, MOUNT.radius, MOUNT.height],
          ["horse", spots.horses[1]!, MOUNT.radius, MOUNT.height],
          ["wagon", spots.wagon, WAGON.radius, WAGON.height],
        ] as const) {
          const probe = { x: sp.x, z: sp.z };
          const y = w.groundHeight(sp.x, sp.z, 1e6);
          expect(w.resolveXZ(probe, y - MOUNT.stepDrop, radius, h + MOUNT.stepDrop), `${id} seed ${seed} ${kind} at ${sp.x},${sp.z}`).toBe(false);
          if (id === "kessar") expect(sp.z).toBeLessThanOrEqual(82);
        }
        // a rider set down on each horse spot can gallop away: not boxed in
        const s = rider(w, spots.horses[0]!.x, spots.horses[0]!.z, spots.horses[0]!.yaw);
        const x0 = s.x;
        const z0 = s.z;
        let far = 0;
        for (const yaw of [0, 1.57, 3.14, -1.57]) {
          const t = { ...s };
          for (let i = 0; i < 45; i++) stepMounted(t, cmd({ yaw: yawToWire(yaw) }), STEP_DT, w);
          far = Math.max(far, Math.hypot(t.x - x0, t.z - z0));
        }
        expect(far, `${id} seed ${seed}`).toBeGreaterThan(6);
      }
    });
  }
  it("spots keep their distance from each other", () => {
    for (const id of ["hollowmere", "kessar"] as const) {
      const s = regionMountSpots(id);
      const pts = [...s.horses, s.wagon];
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(2.2);
    }
  });
});

describe("seat", () => {
  it("riderBodyLift lifts a standing body's zones to the saddle, never down", () => {
    expect(riderBodyLift(0.9)).toBeCloseTo(MOUNT.seatHeight - 0.9, 9);
    expect(riderBodyLift(1.5)).toBe(0);
    expect(riderBodyLift(NaN)).toBeCloseTo(MOUNT.seatHeight - 0.9, 9);
  });
});
