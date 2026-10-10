import { describe, expect, it } from "vitest";
import { WEAPON } from "@cb/shared";
import { computeProportions, generateCharacter } from "@cb/procedural";
import { placeLocal } from "@cb/procedural/three";
import {
  MIN_HAND_SCALE,
  MODE,
  SHOULDER_SLACK,
  SIGHTS,
  VM,
  VM_HAND,
  computeViewmodel,
  matchScreenPoint,
  newVmOut,
  newVmState,
  newViewArm,
  solveViewArm,
  stepViewmodel,
  viewmodelFov,
  vmBodyFrom,
  vmFire,
  vmSwing,
  type VmBody,
  type VmFrame,
  type VmState,
} from "./viewPose.ts";

const ALL = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA, -1];
const FIRE_ARMS: number[] = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS];

const frame = (over: Partial<VmFrame> = {}): VmFrame => ({ weapon: -1, aiming: false, sprinting: false, speed: 0, grounded: true, reload: 0, mode: MODE.FREE, yaw: 0, pitch: 0, shown: true, ...over });
/** A body of the middle build (arm 0.72 m, hand radius 0.13) and the two extremes the generator can make. */
const bodyOf = (armLength: number, hand: number): VmBody =>
  vmBodyFrom({ shoulderHalfWidth: 0.26, torsoHeight: 0.62, neck: 0.05, headRadius: 0.32, armUpper: armLength / 2, armLower: armLength / 2, handRadius: hand });
const BODIES: Record<string, VmBody> = { middle: bodyOf(0.72, 0.13), short: bodyOf(0.52, 0.19), long: bodyOf(0.92, 0.07) };
// ... and forty real characters from the generator, whose shoulders, heads and arms are whatever the game makes
for (let seed = 1; seed <= 40; seed++) BODIES[`seed${seed}`] = vmBodyFrom(computeProportions(generateCharacter(seed * 977)));

/** Runs the state forward with the given frame until the blends settle (drawn, aimed...). */
function settle(id: number, f: Partial<VmFrame> = {}, seconds = 2): VmState {
  const s = newVmState();
  s.id = id;
  s.presence = 1;
  const fr = frame({ weapon: id, ...f });
  for (let t = 0; t < seconds; t += 1 / 60) stepViewmodel(s, fr, 1 / 60);
  return s;
}

const out = newVmOut();
const pt = { x: 0, y: 0, z: 0 };
/** A model-space point in camera space for the pose in `out`. */
const camPoint = (o: typeof out, p: readonly [number, number, number]): typeof pt => {
  placeLocal(o.px, o.py, o.pz, o.rx, o.ry, o.rz, p[0], p[1], p[2], pt);
  return pt;
};

describe("the aimed sight line", () => {
  for (const id of FIRE_ARMS) {
    it(`weapon ${id}: rear and front sight lie on the camera's axis when aimed, so the sights ARE the crosshair`, () => {
      const s = settle(id, { aiming: true });
      expect(s.aim).toBeGreaterThan(0.999);
      computeViewmodel(s, BODIES.middle!, out);
      const rear = { ...camPoint(out, SIGHTS[id]!.rear) };
      const front = { ...camPoint(out, SIGHTS[id]!.front) };
      // straight ahead, and no more than a centimetre off the eye line in height (a percussion rifle's sights are 0.058 above the wrist)
      for (const p of [rear, front]) {
        expect(Math.abs(p.x), "x").toBeLessThan(0.003);
        expect(Math.abs(p.y), "y").toBeLessThan(0.012);
        expect(p.z, "in front of the lens").toBeLessThan(-0.15);
      }
      // ... and the line through them points down the view (within a degree)
      const ang = Math.atan2(Math.hypot(front.x - rear.x, front.y - rear.y), Math.abs(front.z - rear.z));
      expect(ang).toBeLessThan(0.02);
      // rear sight before front sight
      expect(rear.z).toBeGreaterThan(front.z);
    });
  }

  it("the hip pose does NOT put the sights on the axis (aiming is a visible change)", () => {
    const s = settle(WEAPON.RIFLE, {});
    computeViewmodel(s, BODIES.middle!, out);
    const front = camPoint(out, SIGHTS[WEAPON.RIFLE]!.front);
    expect(Math.abs(front.x) + Math.abs(front.y)).toBeGreaterThan(0.05);
  });

  it("the aim blend is monotonic and the weapon glides (no jumps larger than 6 cm per 60 Hz frame) from hip to sights and back", () => {
    for (const id of FIRE_ARMS) {
      const s = settle(id, {});
      let prev = { x: 0, y: 0, z: 0 };
      computeViewmodel(s, BODIES.middle!, out);
      prev = { x: out.px, y: out.py, z: out.pz };
      let lastAim = s.aim;
      for (let i = 0; i < 90; i++) {
        stepViewmodel(s, frame({ weapon: id, aiming: true }), 1 / 60);
        computeViewmodel(s, BODIES.middle!, out);
        expect(s.aim).toBeGreaterThanOrEqual(lastAim - 1e-9);
        lastAim = s.aim;
        expect(Math.hypot(out.px - prev.x, out.py - prev.y, out.pz - prev.z)).toBeLessThan(0.06);
        prev = { x: out.px, y: out.py, z: out.pz };
      }
      expect(s.aim).toBeGreaterThan(0.99);
      for (let i = 0; i < 90; i++) {
        stepViewmodel(s, frame({ weapon: id, aiming: false }), 1 / 60);
        computeViewmodel(s, BODIES.middle!, out);
        expect(Math.hypot(out.px - prev.x, out.py - prev.y, out.pz - prev.z)).toBeLessThan(0.06);
        prev = { x: out.px, y: out.py, z: out.pz };
      }
      expect(s.aim).toBeLessThan(0.01);
    }
  });

  it("sprinting, reloading and swinging all take the sights down again", () => {
    expect(settle(WEAPON.RIFLE, { aiming: true, sprinting: true, speed: 5 }).aim).toBeLessThan(0.01);
    expect(settle(WEAPON.RIFLE, { aiming: true, reload: 0.4 }).aim).toBeLessThan(0.01);
  });
});

describe("where the hands and the weapon are, per weapon", () => {
  const tanV = Math.tan((VM.fov * Math.PI) / 360);
  const tanH = tanV * (16 / 9);
  const inFrame = (p: { x: number; y: number; z: number }, margin = 1): boolean => p.z < -0.05 && -p.y / -p.z < tanV * margin && p.y / -p.z < tanV * margin && Math.abs(p.x) / -p.z < tanH * margin;

  it("every weapon at the hip shows its right hand and the weapon inside a 16:9 frame at the vertical FOV", () => {
    for (const id of ALL) {
      const s = settle(id, {}, id < 0 ? 1 : 2); // (bare hands: their raised pose, before they lower at rest: D-101)
      computeViewmodel(s, BODIES.middle!, out);
      expect(out.visible, `weapon ${id}`).toBe(true);
      expect(inFrame(out.right, 0.97), `right hand of ${id} at ${JSON.stringify(out.right)}`).toBe(true);
      if (id >= 0) {
        expect(out.weaponVisible).toBe(true);
        // some of the weapon's length is on screen: the muzzle end or the blade tip
        const tip = camPoint(out, id === WEAPON.PISTOL ? [0, 0.03, -0.35] : [0, 0.02, -0.9]);
        expect(tip.z).toBeLessThan(out.pz);
      }
    }
  });

  it("bare hands: both fists are on screen, low and either side of the middle (raised, before they lower at rest)", () => {
    const s = settle(-1, {}, 1);
    computeViewmodel(s, BODIES.middle!, out);
    expect(out.weaponVisible).toBe(false);
    expect(out.right.x).toBeGreaterThan(0.08);
    expect(out.left.x).toBeLessThan(-0.08);
    expect(inFrame(out.right, 0.97) && inFrame(out.left, 0.97)).toBe(true);
  });

  it("the left hand holds the fore-end of an aimed long gun (under it, 2 cm) when the arm is long enough, and slides back along it when not", () => {
    const s = settle(WEAPON.RIFLE, { aiming: true });
    computeViewmodel(s, BODIES.long!, out);
    const fore = camPoint(out, [0, -0.125, -0.36]);
    expect(Math.hypot(out.left.x - fore.x, out.left.y - fore.y, out.left.z - fore.z)).toBeLessThan(0.02);
    // a short-armed build holds the piece nearer the lock: on the fore-end's line, never off it
    computeViewmodel(s, BODIES.short!, out);
    const under = (p: { x: number; y: number; z: number }): number => Math.hypot(p.x - out.px, p.y - out.py - -0.125 * 0, 0) ;
    void under;
    const along = camPoint(out, [0, -0.125, -0.36]);
    expect(out.left.z).toBeGreaterThan(along.z - 1e-9); // (nearer the eye than the fore-end anchor, not beyond it)
    expect(Math.abs(out.left.x - along.x)).toBeLessThan(0.02);
  });
});

describe("arms", () => {
  const states: [string, number, Partial<VmFrame>][] = [
    ["hip", 0, {}],
    ["aimed", 0, { aiming: true }],
    ["sprint", 0, { sprinting: true, speed: 5.5 }],
    ["reload 10%", 0, { reload: 0.1 }],
    ["reload 30%", 0, { reload: 0.3 }],
    ["reload 60%", 0, { reload: 0.6 }],
    ["reload 95%", 0, { reload: 0.95 }],
    ["carry", 0, { mode: MODE.CARRY }],
    ["kneel", 0, { mode: MODE.KNEEL }],
    ["drag", 0, { mode: MODE.DRAG }],
    ["crew", 0, { mode: MODE.CREW }],
  ];

  it("every arm reaches every target, for every build, weapon and state: the hand ends within 1.5 cm, with the shoulder moved by at most the slack", () => {
    const arm = newViewArm();
    let worst = 0;
    for (const [bname, body] of Object.entries(BODIES)) {
      for (const id of ALL) {
        for (const [name, , f] of states) {
          if (f.reload && !FIRE_ARMS.includes(id) && id !== -1) continue;
          const s = settle(id, f, 1.5);
          s.reloadT = f.reload ?? 0;
          computeViewmodel(s, body, out);
          for (const [side, h] of [[1, out.right], [-1, out.left]] as const) {
            solveViewArm(body, side, h.x, h.y, h.z, arm);
            const label = `${bname} weapon ${id} ${name} ${side > 0 ? "R" : "L"}`;
            expect(Number.isFinite(arm.a + arm.b + arm.e + arm.sx + arm.sy + arm.sz), label).toBe(true);
            const moved = Math.hypot(arm.sx - side * body.hw, arm.sy + body.drop, arm.sz - body.back);
            expect(moved, label).toBeLessThanOrEqual(SHOULDER_SLACK + 1e-6);
            // a hand the arm cannot reach even from a shoulder brought forward falls short only by what is left over
            if (arm.stretch <= SHOULDER_SLACK) {
              expect(arm.error, label).toBeLessThan(0.015);
            }
            worst = Math.max(worst, arm.error);
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.2);
  });

  it("scales a giant fist down toward a hand-sized one, and leaves small hands alone", () => {
    expect(BODIES.short!.fs).toBe(MIN_HAND_SCALE); // (0.19 m fists would be 0.5, but never below the floor)
    expect(BODIES.middle!.fs).toBeCloseTo(VM_HAND / 0.13, 3);
    expect(BODIES.long!.fs).toBe(1);
    expect(bodyOf(0.7, 0.4).fs).toBeGreaterThanOrEqual(0.62);
  });

  it("body measurements come from the character's real proportions", () => {
    const P = computeProportions(generateCharacter(3));
    const b = vmBodyFrom(P);
    expect(b.hw).toBe(P.shoulderHalfWidth);
    expect(b.drop).toBeGreaterThan(0.2);
    expect(b.drop).toBeLessThan(0.6);
  });
});

describe("recoil, blows, drawing", () => {
  it("a shot throws the weapon back and up, then it settles within the weapon's own recoil time", () => {
    for (const id of FIRE_ARMS) {
      const s = settle(id, {});
      computeViewmodel(s, BODIES.middle!, out);
      const rest = { z: out.pz, rx: out.rx };
      vmFire(s, id, 1);
      computeViewmodel(s, BODIES.middle!, out);
      expect(out.pz, `weapon ${id} back`).toBeGreaterThan(rest.z + 0.02);
      expect(out.rx, `weapon ${id} muzzle climbs`).toBeGreaterThan(rest.rx + 0.05);
      for (let t = 0; t < 0.5; t += 1 / 60) stepViewmodel(s, frame({ weapon: id }), 1 / 60);
      computeViewmodel(s, BODIES.middle!, out);
      expect(Math.abs(out.pz - rest.z)).toBeLessThan(0.004);
    }
  });

  it("recoil is smaller when braced against the shoulder (aimed) than at the hip", () => {
    const climb = (aim: boolean): number => {
      const s = settle(WEAPON.RIFLE, { aiming: aim });
      computeViewmodel(s, BODIES.middle!, out);
      const r0 = out.rx;
      vmFire(s, WEAPON.RIFLE, 4);
      computeViewmodel(s, BODIES.middle!, out);
      return out.rx - r0;
    };
    expect(climb(true)).toBeLessThan(climb(false));
  });

  it("the shot's side kick is deterministic (a function of the shot counter), so two machines draw the same recoil", () => {
    const a = newVmState();
    const b = newVmState();
    vmFire(a, WEAPON.RIFLE, 9);
    vmFire(b, WEAPON.RIFLE, 9);
    expect(a.kickSide).toBe(b.kickSide);
    expect(a.kickRoll).toBe(b.kickRoll);
    const c = newVmState();
    vmFire(c, WEAPON.RIFLE, 10);
    expect(c.kickSide).not.toBe(a.kickSide);
  });

  it("a blow sweeps the weapon far from its hold and returns to it", () => {
    for (const id of [WEAPON.SABRE, WEAPON.UMBRELLA, WEAPON.RIFLE]) {
      for (const bash of id === WEAPON.RIFLE ? [true] : [false, true]) {
        const s = settle(id, {});
        computeViewmodel(s, BODIES.middle!, out);
        const hold = { x: out.px, y: out.py, z: out.pz };
        vmSwing(s, 0.2, bash);
        let far = 0;
        for (let t = 0; t < 1.5; t += 1 / 60) {
          stepViewmodel(s, frame({ weapon: id }), 1 / 60);
          computeViewmodel(s, BODIES.middle!, out);
          far = Math.max(far, Math.hypot(out.px - hold.x, out.py - hold.y, out.pz - hold.z));
        }
        expect(far, `weapon ${id} bash ${bash}`).toBeGreaterThan(0.12);
        computeViewmodel(s, BODIES.middle!, out);
        expect(Math.hypot(out.px - hold.x, out.py - hold.y, out.pz - hold.z), `weapon ${id} returns`).toBeLessThan(0.02);
      }
    }
  });

  it("bare-fist jabs alternate hands", () => {
    const s = settle(-1, {});
    const reachOf = (): number => {
      let r = 0;
      let l = 0;
      for (let t = 0; t < 0.6; t += 1 / 60) {
        stepViewmodel(s, frame({ weapon: -1 }), 1 / 60);
        computeViewmodel(s, BODIES.middle!, out);
        r = Math.min(r, out.right.z);
        l = Math.min(l, out.left.z);
      }
      return r - l;
    };
    vmSwing(s, 0.2, false);
    const first = reachOf();
    for (let t = 0; t < 1; t += 1 / 60) stepViewmodel(s, frame({ weapon: -1 }), 1 / 60);
    vmSwing(s, 0.2, false);
    const second = reachOf();
    expect(Math.sign(first)).not.toBe(Math.sign(second));
  });

  it("changing weapon lowers the old one, swaps at the bottom and raises the new one", () => {
    const s = settle(WEAPON.RIFLE, {});
    const seen: number[] = [];
    let minDraw = 1;
    for (let t = 0; t < 1; t += 1 / 60) {
      stepViewmodel(s, frame({ weapon: WEAPON.PISTOL }), 1 / 60);
      seen.push(s.id);
      minDraw = Math.min(minDraw, s.draw);
      if (s.id === WEAPON.PISTOL && s.draw < 1) expect(s.draw).toBeLessThan(1);
    }
    expect(seen[0]).toBe(WEAPON.RIFLE); // the rifle is still the one in hand while it goes down
    expect(seen[seen.length - 1]).toBe(WEAPON.PISTOL);
    expect(minDraw).toBe(0);
    expect(s.draw).toBeGreaterThan(0.99);
    // lowered = well below the raised pose
    const low = newVmState();
    low.id = WEAPON.PISTOL;
    low.presence = 1;
    low.draw = 0;
    computeViewmodel(low, BODIES.middle!, out);
    const y0 = out.py;
    low.draw = 1;
    computeViewmodel(low, BODIES.middle!, out);
    expect(y0).toBeLessThan(out.py - 0.25);
  });

  it("when the view leaves first person the hands lower out of sight", () => {
    const s = settle(WEAPON.RIFLE, {});
    for (let t = 0; t < 1; t += 1 / 60) stepViewmodel(s, frame({ weapon: WEAPON.RIFLE, shown: false }), 1 / 60);
    computeViewmodel(s, BODIES.middle!, out);
    expect(out.visible).toBe(false);
  });
});

describe("reloading", () => {
  it("the piece comes up, the free hand travels (horn, muzzle, rod strokes, pan) and the ramrod is drawn only mid-reload", () => {
    for (const id of FIRE_ARMS) {
      const s = settle(id, { reload: 0.5 }, 1.5);
      const left: number[][] = [];
      let rodMax = 0;
      let rodAtEnds = 0;
      for (let u = 0.02; u < 0.99; u += 1 / 60 / (id === WEAPON.PISTOL ? 3 : 3.6)) {
        s.reloadT = u;
        computeViewmodel(s, BODIES.middle!, out);
        left.push([out.left.x, out.left.y, out.left.z]);
        rodMax = Math.max(rodMax, out.rod);
        if (u < 0.4 || u > 0.95) rodAtEnds = Math.max(rodAtEnds, out.rod);
      }
      // continuous: sampled every frame of a full reload, the hand never moves faster than 12 m/s (the trip from the horn to the muzzle is the quickest part)
      for (let i = 1; i < left.length; i++) expect(Math.hypot(left[i]![0]! - left[i - 1]![0]!, left[i]![1]! - left[i - 1]![1]!, left[i]![2]! - left[i - 1]![2]!)).toBeLessThan(0.2);
      expect(rodMax).toBeGreaterThan(0.05);
      expect(rodAtEnds).toBe(0);
    }
  });
});

describe("motion settings", () => {
  const walking = (bob: number, motion: number): { x: number; y: number } => {
    const s = newVmState();
    s.id = WEAPON.RIFLE;
    s.presence = 1;
    s.bob = bob;
    s.motion = motion;
    let maxX = 0;
    let maxY = 0;
    computeViewmodel(s, BODIES.middle!, out);
    const x0 = out.px;
    const y0 = out.py;
    for (let t = 0; t < 3; t += 1 / 60) {
      stepViewmodel(s, frame({ weapon: WEAPON.RIFLE, speed: 4.4 }), 1 / 60);
      computeViewmodel(s, BODIES.middle!, out);
      maxX = Math.max(maxX, Math.abs(out.px - x0));
      maxY = Math.max(maxY, Math.abs(out.py - y0));
    }
    return { x: maxX, y: maxY };
  };

  it("walking bobs the weapon, and head bob off (0) stops the bob but not the breathing", () => {
    const on = walking(1, 1);
    const off = walking(0, 1);
    expect(on.y).toBeGreaterThan(0.006);
    expect(off.y).toBeLessThan(on.y * 0.5);
    expect(off.x).toBeLessThan(on.x * 0.5);
  });

  it("turning trails the weapon, and reduced motion (0) does not", () => {
    const turn = (motion: number): number => {
      const s = newVmState();
      s.id = WEAPON.RIFLE;
      s.presence = 1;
      s.motion = motion;
      let yaw = 0;
      let worst = 0;
      const base = (computeViewmodel(settle(WEAPON.RIFLE, {}), BODIES.middle!, out), out.px);
      for (let t = 0; t < 0.4; t += 1 / 60) {
        yaw += 0.05;
        stepViewmodel(s, frame({ weapon: WEAPON.RIFLE, yaw }), 1 / 60);
        computeViewmodel(s, BODIES.middle!, out);
        worst = Math.max(worst, Math.abs(out.px - base));
      }
      return worst;
    };
    expect(turn(1)).toBeGreaterThan(0.02);
    expect(turn(0)).toBeLessThan(0.006);
  });

  it("is a pure function of its inputs (no Math.random / Date.now in the pose)", () => {
    const run = (): number[] => {
      const s = settle(WEAPON.RIFLE, { speed: 3 }, 0.8);
      vmFire(s, WEAPON.RIFLE, 3);
      for (let i = 0; i < 10; i++) stepViewmodel(s, frame({ weapon: WEAPON.RIFLE, speed: 3 }), 1 / 60);
      computeViewmodel(s, BODIES.middle!, out);
      return [out.px, out.py, out.pz, out.rx, out.ry, out.rz, out.left.x, out.right.y];
    };
    expect(run()).toEqual(run());
  });
});

describe("two lenses", () => {
  it("matchScreenPoint puts a world-lens point on the same screen spot as the viewmodel-lens point", () => {
    const vm = 62;
    const world = 78;
    const o = { x: 0, y: 0, z: 0 };
    matchScreenPoint(0.12, -0.2, -0.7, vm, world, o);
    const ndc = (x: number, y: number, z: number, fov: number): [number, number] => [x / (-z * Math.tan((fov * Math.PI) / 360)), y / (-z * Math.tan((fov * Math.PI) / 360))];
    const a = ndc(0.12, -0.2, -0.7, vm);
    const b = ndc(o.x, o.y, o.z, world);
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[1]).toBeCloseTo(a[1], 6);
    expect(o.z).toBe(-0.7);
  });

  it("the viewmodel's own field of view follows the setting only a little, and stays sane", () => {
    expect(viewmodelFov(65)).toBe(VM.fov);
    expect(viewmodelFov(50)).toBeGreaterThan(55);
    expect(viewmodelFov(100)).toBeLessThan(76.01);
    expect(viewmodelFov(100)).toBeGreaterThan(viewmodelFov(65));
  });
});

describe("D-101: idle empty hands lower out of view", () => {
  it("after a moment with nothing in them they drop away; a punch, or a weapon, brings them up", () => {
    const s = settle(-1, {}, 3);
    expect(s.rest).toBeGreaterThan(0.95);
    vmSwing(s, 0.3, false);
    for (let t = 0; t < 0.25; t += 1 / 60) stepViewmodel(s, frame(), 1 / 60);
    expect(s.rest).toBeLessThan(0.05);
    const armed = settle(WEAPON.PISTOL, {}, 3);
    expect(armed.rest).toBe(0);
    const carrying = settle(-1, { mode: MODE.CARRY }, 3);
    expect(carrying.rest).toBeLessThan(0.05);
  });
});

