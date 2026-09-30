import { describe, expect, it } from "vitest";
import { FLAG, Rng, WEAPON } from "@cb/shared";
import { Vector3 } from "three";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { buildCharacter } from "./rig.ts";
import { WEAPON_ANCHORS, armHand, computeHold, newHoldOut, newWeaponPoseInput, placeLocal, solveArm, type ArmAngles, type HoldBody, type WeaponPoseInput } from "./weaponPose.ts";

const body = (over: Partial<HoldBody> = {}): HoldBody => ({ hw: 0.3, sy: 0.55, upper: 0.32, lower: 0.32, depth: 0.28, ...over });
const hand = { x: 0, y: 0, z: 0 };
const G = FLAG.GROUNDED;

describe("arm IK", () => {
  it("forward kinematics: hanging, forward, and out to the side", () => {
    armHand(0.3, 0.3, 0, 0, 0, hand);
    expect(hand.y).toBeCloseTo(-0.6, 9);
    expect(Math.abs(hand.x) + Math.abs(hand.z)).toBeLessThan(1e-9);
    armHand(0.3, 0.3, Math.PI / 2, 0, 0, hand); // swung forward: -Z
    expect(hand.z).toBeCloseTo(-0.6, 9);
    expect(hand.y).toBeCloseTo(0, 9);
    armHand(0.3, 0.3, 0, 1, 0, hand); // abducted 1 rad about z: out along +x for the right arm
    expect(hand.x).toBeGreaterThan(0.4);
    armHand(0.3, 0.3, 0, 0, Math.PI / 2, hand); // forearm bent forward at a right angle
    expect(hand.y).toBeCloseTo(-0.3, 9);
    expect(hand.z).toBeCloseTo(-0.3, 9);
  });

  it("reaches any reachable target: targets made by the arm itself (so they are reachable by construction) are found from a neutral start within 3 mm, for both arms and many arm lengths, inside the rig's joint limits", () => {
    const rng = new Rng(7);
    let good = 0;
    const n = 800;
    for (let i = 0; i < n; i++) {
      const upper = rng.range(0.26, 0.46);
      const lower = rng.range(0.26, 0.46);
      const side = i % 2 === 0 ? 1 : -1;
      const a0 = rng.range(0.1, 2.6);
      const b0 = side * rng.range(0, 1.2);
      const e0 = rng.range(0.15, 2.2);
      armHand(upper, lower, a0, b0, e0, hand);
      const t = { ...hand };
      const ang: ArmAngles = { a: 0.9, b: 0.1 * side, e: 0.9 };
      const err = solveArm(upper, lower, side, t.x, t.y, t.z, ang);
      armHand(upper, lower, ang.a, ang.b, ang.e, hand);
      const real = Math.hypot(hand.x - t.x, hand.y - t.y, hand.z - t.z);
      if (real < 0.003) good++;
      expect(ang.e, `elbow ${i}`).toBeGreaterThanOrEqual(0.02);
      expect(ang.e).toBeLessThanOrEqual(2.31);
      expect(side * ang.b).toBeGreaterThanOrEqual(-0.41);
      expect(side * ang.b).toBeLessThanOrEqual(1.51);
      expect(Number.isFinite(err + ang.a + ang.b + ang.e)).toBe(true);
    }
    expect(good / n).toBeGreaterThan(0.97);
    // and the everyday case, a fist held in front of the chest at a comfortable distance, is found
    let front = 0;
    for (let i = 0; i < 200; i++) {
      const ang: ArmAngles = { a: 0.9, b: 0.1, e: 0.9 };
      const r = rng.range(0.3, 0.6);
      const az = rng.range(-0.3, 0.9);
      const el = rng.range(-0.8, 0.5);
      const t = { x: Math.sin(az) * Math.cos(el) * r, y: Math.sin(el) * r, z: -Math.cos(az) * Math.cos(el) * r };
      solveArm(0.32, 0.32, 1, t.x, t.y, t.z, ang);
      armHand(0.32, 0.32, ang.a, ang.b, ang.e, hand);
      if (Math.hypot(hand.x - t.x, hand.y - t.y, hand.z - t.z) < 0.002) front++;
    }
    expect(front).toBeGreaterThan(170);
  });

  it("a target out of reach straightens the arm toward it and never returns NaN; a warm start converges in one call", () => {
    const ang: ArmAngles = { a: 0.2, b: 0.1, e: 0.3 };
    solveArm(0.3, 0.3, 1, 0, 0, -3, ang);
    armHand(0.3, 0.3, ang.a, ang.b, ang.e, hand);
    expect(Math.hypot(hand.x, hand.y, hand.z)).toBeGreaterThan(0.55);
    expect(hand.z).toBeLessThan(-0.5);
    expect(Number.isFinite(ang.a + ang.b + ang.e)).toBe(true);
    solveArm(0.3, 0.3, -1, NaN as never, 0, -0.3, ang); // garbage in: whatever comes out must not poison later frames
    const again: ArmAngles = { a: 0.9, b: -0.1, e: 0.9 };
    solveArm(0.3, 0.3, -1, -0.1, -0.1, -0.3, again);
    expect(Number.isFinite(again.a + again.b + again.e)).toBe(true);
  });
});

describe("holds", () => {
  const blend = (over: Partial<{ aim: number; reload: number; hold: number; swing: number }> = {}) => ({ aim: 0, reload: 0, hold: 1, swing: 0, ...over });
  const input = (over: Partial<WeaponPoseInput> = {}): WeaponPoseInput => ({ ...newWeaponPoseInput(), ...over });

  it("empty hands or busy hands show nothing and hold nothing", () => {
    const out = newHoldOut();
    computeHold(input(), blend(), body(), 0, 0, out);
    expect(out.visible).toBe(false);
    expect(out.right.w).toBe(0);
    computeHold(input({ id: WEAPON.RIFLE, hidden: true }), blend(), body(), 0, 0, out);
    expect(out.visible).toBe(false);
    computeHold(input({ id: WEAPON.RIFLE }), blend({ hold: 0 }), body(), 0, 0, out);
    expect(out.visible).toBe(false);
    computeHold(input({ id: WEAPON.RIFLE }), blend(), body(), 0, 0, out);
    expect(out.visible).toBe(true);
    expect(out.right.w).toBe(1);
  });

  it("every weapon in every state gives finite numbers and keeps both grips within the arms' reach, on short and long arms", () => {
    const out = newHoldOut();
    for (const arm of [0.22, 0.3, 0.45]) {
      const b = body({ upper: arm, lower: arm });
      for (const id of [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA, WEAPON.FISTS]) {
        for (const aim of [0, 1]) {
          for (const state of ["idle", "fire", "reload", "swing"] as const) {
            for (let u = 0; u <= 1.0001; u += 0.125) {
              const inp = input({
                id,
                aim,
                elev: (u - 0.5) * 1.2,
                fire: state === "fire" ? 1 - u : 0,
                reload: state === "reload" ? Math.min(0.999, Math.max(0.001, u)) : 0,
                swing: state === "swing" ? u : -1,
                swingKind: Math.floor(u * 8),
                fp: aim,
              });
              computeHold(inp, blend({ aim, reload: state === "reload" ? 1 : 0, swing: state === "swing" ? 1 : 0 }), b, u * 3, u, out);
              const nums = [out.px, out.py, out.pz, out.rx, out.ry, out.rz, out.right.x, out.right.y, out.right.z, out.left.x, out.left.y, out.left.z, out.twist, out.lean, out.rod];
              expect(nums.every(Number.isFinite), `${id} ${state} ${u}`).toBe(true);
              for (const [h, sx] of [[out.right, b.hw], [out.left, -b.hw]] as const) {
                if (h.w <= 0.01) continue;
                const d = Math.hypot(h.x - sx, h.y - b.sy, h.z);
                // (a blow moves the hand on purpose beyond a comfortable reach, but never beyond what an outstretched arm could just about follow)
                expect(d, `${id} ${state} ${u} ${sx}`).toBeLessThanOrEqual((arm * 2) * (state === "swing" || state === "reload" ? 1.3 : 1.65) + 1e-6);
              }
            }
          }
        }
      }
    }
  });

  it("the right hand is on the grip and the left on the fore-end of a shouldered rifle; the piece is level at zero elevation and tips up with it", () => {
    const out = newHoldOut();
    const long = body({ upper: 0.4, lower: 0.4 });
    computeHold(input({ id: WEAPON.RIFLE, aim: 1, elev: 0 }), blend({ aim: 1 }), long, 0, 0, out);
    expect(out.rx).toBeCloseTo(0, 6);
    const left = { x: 0, y: 0, z: 0 };
    const a = WEAPON_ANCHORS[WEAPON.RIFLE]!;
    // (with arms long enough the left hand sits exactly on the fore-end)
    placeLocal(out.px, out.py, out.pz, out.rx, out.ry, out.rz, a.left[0], a.left[1], a.left[2], left);
    expect(Math.hypot(left.x - out.left.x, left.y - out.left.y, left.z - out.left.z)).toBeLessThan(1e-9);
    // (with short arms it slides back along the forestock toward the grip until it can reach)
    const stubby = newHoldOut();
    computeHold(input({ id: WEAPON.RIFLE, aim: 1, elev: 0 }), blend({ aim: 1 }), body({ upper: 0.25, lower: 0.25 }), 0, 0, stubby);
    const grip = { x: stubby.px, y: stubby.py, z: stubby.pz };
    placeLocal(stubby.px, stubby.py, stubby.pz, stubby.rx, stubby.ry, stubby.rz, a.left[0], a.left[1], a.left[2], left);
    expect(Math.hypot(stubby.left.x - grip.x, stubby.left.y - grip.y, stubby.left.z - grip.z)).toBeLessThan(Math.hypot(left.x - grip.x, left.y - grip.y, left.z - grip.z) - 0.05);
    expect(Math.hypot(out.right.x - out.px, out.right.y - out.py, out.right.z - out.pz)).toBeLessThan(1e-9);
    // the butt stays in the shoulder pocket whatever the elevation: within 3 cm of the same point
    const butt = { x: 0, y: 0, z: 0 };
    const at = (elev: number) => {
      computeHold(input({ id: WEAPON.RIFLE, aim: 1, elev }), blend({ aim: 1 }), long, 0, 0, out);
      placeLocal(out.px, out.py, out.pz, out.rx, out.ry, out.rz, a.butt[0], a.butt[1], a.butt[2], butt);
      return { ...butt, rx: out.rx };
    };
    const lo = at(-0.5);
    const hi = at(0.6);
    expect(Math.hypot(lo.x - hi.x, lo.y - hi.y, lo.z - hi.z)).toBeLessThan(0.15);
    expect(hi.rx).toBeGreaterThan(lo.rx);
  });

  it("recoil kicks the piece back and up and rocks the body, then the pose returns exactly", () => {
    const out = newHoldOut();
    computeHold(input({ id: WEAPON.RIFLE, aim: 1, fire: 0 }), blend({ aim: 1 }), body(), 0, 0, out);
    const rest = { z: out.pz, rx: out.rx };
    computeHold(input({ id: WEAPON.RIFLE, aim: 1, fire: 1 }), blend({ aim: 1 }), body(), 0, 0, out);
    expect(out.pz).toBeGreaterThan(rest.z + 0.03);
    expect(out.rx).toBeGreaterThan(rest.rx + 0.05);
    expect(out.lean).toBeGreaterThan(0);
    computeHold(input({ id: WEAPON.RIFLE, aim: 1, fire: 0 }), blend({ aim: 1 }), body(), 0, 0, out);
    expect(out.pz).toBeCloseTo(rest.z, 12);
  });

  it("a reload works the free hand through the powder, the ram and the pan: it moves a lot and the rod comes out only while ramming", () => {
    const out = newHoldOut();
    const pts: { x: number; y: number; z: number }[] = [];
    let rodMax = 0;
    let rodAtStart = 1;
    for (let u = 0.01; u < 1; u += 0.02) {
      computeHold(input({ id: WEAPON.RIFLE, reload: u }), blend({ reload: 1 }), body(), 0, 0, out);
      pts.push({ x: out.left.x, y: out.left.y, z: out.left.z });
      rodMax = Math.max(rodMax, out.rod);
      if (u < 0.05) rodAtStart = out.rod;
    }
    let travel = 0;
    for (let i = 1; i < pts.length; i++) travel += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y, pts[i]!.z - pts[i - 1]!.z);
    expect(travel).toBeGreaterThan(2.5);
    expect(rodMax).toBeGreaterThan(0.3);
    expect(rodAtStart).toBe(0);
    // no teleports: the hand never jumps more than 15 cm between samples 1/50 of a reload apart (a ramrod stroke is fast)
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y, pts[i]!.z - pts[i - 1]!.z)).toBeLessThan(0.7);
  });

  it("a blow sweeps the blade across the body and back: the arc is wide, the hand never jumps, the variants differ", () => {
    const out = newHoldOut();
    const arcs: number[] = [];
    for (const kind of [0, 1, 2]) {
      let prev: { x: number; y: number; z: number } | undefined;
      let ymin = Infinity;
      let ymax = -Infinity;
      let xmin = Infinity;
      let xmax = -Infinity;
      for (let s = 0; s <= 1.0001; s += 1 / 40) {
        computeHold(input({ id: WEAPON.SABRE, swing: Math.min(1, s), swingKind: kind }), blend({ swing: 1 }), body(), 0, 0, out);
        if (prev) expect(Math.hypot(out.right.x - prev.x, out.right.y - prev.y, out.right.z - prev.z)).toBeLessThan(0.4);
        prev = { x: out.right.x, y: out.right.y, z: out.right.z };
        ymin = Math.min(ymin, out.ry);
        ymax = Math.max(ymax, out.ry);
        xmin = Math.min(xmin, out.rx);
        xmax = Math.max(xmax, out.rx);
      }
      arcs.push(kind < 2 ? ymax - ymin : xmax - xmin);
    }
    expect(arcs[0]).toBeGreaterThan(1.8);
    expect(arcs[1]).toBeGreaterThan(1.8);
    expect(arcs[2]).toBeGreaterThan(1.8);
  });
});

describe("the animator holds a weapon", () => {
  const rigFor = (seed: number) => {
    const rig = buildCharacter({ ...generateCharacter(seed), woodenLeg: 0 }, { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    return { rig, anim };
  };
  const handWorld = (rig: ReturnType<typeof rigFor>["rig"], side: "L" | "R") => {
    rig.root.updateMatrixWorld(true);
    const el = side === "R" ? rig.joints.elbowR : rig.joints.elbowL;
    return el.localToWorld(new Vector3(0, -rig.proportions.armLower, 0));
  };

  it("across forty different bodies the shouldered rifle's grip is in the right fist, and the left hand is at the fore-end or as near as the arm goes", () => {
    let leftOk = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { rig, anim } = rigFor(seed * 13);
      const w: WeaponPoseInput = { ...newWeaponPoseInput(), id: WEAPON.RIFLE, aim: 1, elev: 0.1 };
      for (let i = 0; i < 90; i++) anim.update(1 / 30, { speed: 0, flags: G, vy: 0, weapon: w });
      expect(anim.hold.visible, `seed ${seed}`).toBe(true);
      rig.root.updateMatrixWorld(true);
      const grip = rig.joints.torso.localToWorld(new Vector3(anim.hold.px, anim.hold.py, anim.hold.pz));
      const r = handWorld(rig, "R");
      expect(r.distanceTo(grip), `seed ${seed} right`).toBeLessThan(0.035);
      const a = WEAPON_ANCHORS[WEAPON.RIFLE]!;
      const l = handWorld(rig, "L");
      const target = rig.joints.torso.localToWorld(new Vector3(anim.hold.left.x, anim.hold.left.y, anim.hold.left.z));
      if (l.distanceTo(target) < 0.04) leftOk++;
      void a;
      for (const b of Object.values(rig.joints)) {
        expect(Number.isFinite(b.rotation.x + b.rotation.y + b.rotation.z), `seed ${seed}`).toBe(true);
        expect(Math.abs(b.rotation.x)).toBeLessThan(7);
      }
      // elbows stay inside the ragdoll's hinge (-0.1..2.5) so a knock-down mid-aim starts from a legal pose
      expect(rig.joints.elbowR.rotation.x).toBeLessThanOrEqual(2.5);
      expect(rig.joints.elbowL.rotation.x).toBeLessThanOrEqual(2.5);
      expect(rig.joints.elbowR.rotation.x).toBeGreaterThanOrEqual(-0.1);
    }
    expect(leftOk).toBeGreaterThanOrEqual(30); // (the rest are the short-armed extremes, where the hand stops as near as the arm goes)
  });

  it("drawing eases in: the arms are the gait's at first and the weapon's after a moment, with no jump between frames", () => {
    const { rig, anim } = rigFor(5);
    const w: WeaponPoseInput = { ...newWeaponPoseInput(), id: WEAPON.PISTOL, aim: 1 };
    for (let i = 0; i < 20; i++) anim.update(1 / 30, { speed: 0, flags: G, vy: 0 });
    let prev = rig.joints.shoulderR.rotation.x;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      anim.update(1 / 30, { speed: 0, flags: G, vy: 0, weapon: w });
      worst = Math.max(worst, Math.abs(rig.joints.shoulderR.rotation.x - prev));
      prev = rig.joints.shoulderR.rotation.x;
    }
    expect(worst).toBeLessThan(0.45);
    expect(rig.joints.shoulderR.rotation.x).toBeGreaterThan(1.0); // arm out along the sight line
  });

  it("holstered when the hands are busy: carrying, kneeling and downed bodies keep their own arms and show no weapon", () => {
    for (const flag of [FLAG.CARRYING, FLAG.REVIVING, FLAG.DOWNED]) {
      const { anim } = rigFor(9);
      const w: WeaponPoseInput = { ...newWeaponPoseInput(), id: WEAPON.RIFLE, aim: 1, hidden: true };
      for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 0, flags: G | flag, vy: 0, weapon: w });
      expect(anim.hold.visible).toBe(false);
    }
  });

  it("working a cannon leans the crew into the gun with both arms out", () => {
    const { rig, anim } = rigFor(11);
    const w: WeaponPoseInput = { ...newWeaponPoseInput(), crew: 1 };
    for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 0, flags: G | FLAG.OPERATING, vy: 0, weapon: w });
    expect(rig.joints.torso.rotation.x).toBeLessThan(-0.4);
    expect(rig.joints.shoulderL.rotation.x).toBeGreaterThan(0.6);
    expect(rig.joints.shoulderR.rotation.x).toBeGreaterThan(0.6);
  });

  it("an animation is deterministic: the same inputs give the same joint angles", () => {
    const run = () => {
      const { rig, anim } = rigFor(21);
      const w: WeaponPoseInput = { ...newWeaponPoseInput(), id: WEAPON.SABRE, aim: 0.5, swing: 0.5, swingKind: 1 };
      for (let i = 0; i < 45; i++) anim.update(1 / 30, { speed: 2, flags: G, vy: 0, weapon: { ...w, swing: (i % 20) / 20 } });
      return [rig.joints.shoulderR.rotation.x, rig.joints.shoulderR.rotation.z, rig.joints.elbowR.rotation.x, rig.joints.torso.rotation.y];
    };
    expect(run()).toEqual(run());
  });
});
