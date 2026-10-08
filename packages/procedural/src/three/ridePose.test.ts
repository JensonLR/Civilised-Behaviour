import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { HORSE_SEAT, horseFromSeed } from "../horse.ts";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { buildCharacter } from "./rig.ts";
import { barrelOutside, buildHorse } from "./horse.ts";
import { HorseAnimator } from "./horseAnimator.ts";
import { fitRideLegs, legFk, legIk, newRideInput, rideLegPad, type LegAngles } from "./ridePose.ts";

describe("legIk", () => {
  it("round-trips: the ankle lands where it was asked, whatever the proportions", () => {
    const out: LegAngles = { hx: 0, hz: 0, kx: 0 };
    const p = { x: 0, y: 0, z: 0 };
    for (const [U, L] of [[0.4, 0.42], [0.5, 0.45], [0.3, 0.3], [0.55, 0.4]] as const)
      for (let i = 0; i < 80; i++) {
        const d = (U + L) * (0.64 + 0.33 * ((i * 37) % 100) / 100);
        const az = ((i * 53) % 100) / 100 * 2.4 - 1.2;
        const el = ((i * 29) % 100) / 100 * 1.2 - 0.9;
        const vx = Math.cos(el) * Math.sin(az) * 0.4;
        const vy = -Math.cos(el) * Math.cos(az) * 0.9;
        const vz = Math.sin(el) * 0.6;
        const vl = Math.hypot(vx, vy, vz);
        const tx = (d * vx) / vl;
        const ty = (d * vy) / vl;
        const tz = (d * vz) / vl;
        const resid = legIk(U, L, tx, ty, tz, out);
        legFk(U, L, out, p);
        expect(Number.isFinite(out.hx + out.hz + out.kx)).toBe(true);
        expect(resid).toBeLessThan(2e-3);
        expect(Math.hypot(p.x - tx, p.y - ty, p.z - tz)).toBeLessThan(2e-3);
        expect(out.kx).toBeLessThanOrEqual(1e-9); // the shin goes back
      }
  });

  it("a target beyond reach straightens the leg toward it instead of failing", () => {
    const out: LegAngles = { hx: 0, hz: 0, kx: 0 };
    legIk(0.4, 0.4, 0, -2, -1, out);
    expect(Math.abs(out.kx)).toBeLessThan(0.1);
    expect(Number.isFinite(out.hx)).toBe(true);
  });
});

describe("ride pose", () => {
  const rider = (seed: number) => {
    const rig = buildCharacter(generateCharacter(seed), { outline: false });
    const anim = new CharacterAnimator(rig);
    anim.autoBlink = false;
    return { rig, anim };
  };
  const horse = (seed: number) => {
    const rig = buildHorse(horseFromSeed(seed), { outline: false });
    const anim = new HorseAnimator(rig, seed);
    anim.ambient = false;
    return { rig, anim };
  };
  const world = (v: Vector3, rig: { root: { updateMatrixWorld(f: boolean): void } }, local: { localToWorld(v: Vector3): Vector3 }): Vector3 => {
    rig.root.updateMatrixWorld(true);
    return local.localToWorld(v);
  };

  it("puts the ankles where the leg fit says (on the stirrups when the legs reach round the barrel) and the hands on the reins, for riders of every build, at rest and at a gallop", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const speed of [0, 6.4, 10.5, -1]) {
        const { rig, anim } = rider(seed);
        const h = horse(seed);
        const ride = newRideInput();
        for (let i = 0; i < 60; i++) {
          // (speed -1 = rearing in place: the barrel pivots on the hind hooves and the rider goes with it)
          h.anim.update(1 / 30, speed < 0 ? { speed: 0, ridden: true, rear: 1 } : { speed, ridden: true });
          ride.bob = h.anim.motion.bob;
          ride.bodyZ = h.anim.motion.bodyZ;
          ride.pitch = h.anim.motion.pitch;
          ride.roll = h.anim.motion.roll;
          ride.speed01 = Math.max(0, speed) / 10.5;
          ride.scale = h.rig.scale;
          ride.girth = h.rig.girth;
          anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0, ride });
        }
        const P = rig.proportions;
        const fit = fitRideLegs(P.legUpper, P.legLower, P.hipWidth, rideLegPad(P.scale), h.rig.scale, h.rig.girth);
        // a leg long enough to go round the barrel hangs down the flank: the iron (let down to the foot) is below the barrel's middle
        if (P.legUpper + P.legLower >= 0.68) expect(fit.iron.y, `seed ${seed}`).toBeLessThan(0.1);
        for (const side of [-1, 1] as const) {
          const knee = side < 0 ? rig.joints.kneeL : rig.joints.kneeR;
          const ankle = world(new Vector3(0, -P.legLower, 0), rig, knee);
          const s = h.rig.scale;
          // (the stirrup target is in the horse frame; the rider's root coincides with the horse's here)
          // the stirrup hangs from the barrel: where the horse's own body transform puts its body-local point
          h.rig.root.updateMatrixWorld(true);
          const want = h.rig.joints.body.localToWorld(new Vector3(side * HORSE_SEAT.stirrup.x, HORSE_SEAT.stirrup.y - 0.03 - 0.62, HORSE_SEAT.stirrup.z));
          const err = Math.hypot(ankle.x - want.x, ankle.y - want.y, ankle.z - want.z);
          // the ankle is as far from the iron as the fit says, whatever the horse is doing (the fit is in the barrel's frame, and the seat goes with the barrel)
          expect(Math.abs(err - fit.miss), `seed ${seed} speed ${speed} side ${side}`).toBeLessThan(0.03);
          for (const o of [rig.joints.hipL, rig.joints.hipR, rig.joints.kneeL, rig.joints.kneeR, rig.joints.shoulderL, rig.joints.shoulderR, rig.joints.elbowL, rig.joints.elbowR, rig.joints.pelvis, rig.joints.torso]) {
            expect(Number.isFinite(o.rotation.x + o.rotation.y + o.rotation.z + o.position.y)).toBe(true);
          }
        }
        // the pelvis is at the saddle
        const pelvis = world(new Vector3(0, 0, 0), rig, rig.joints.pelvis);
        const seat = h.rig.joints.body.localToWorld(new Vector3(0, HORSE_SEAT.y - 0.62, HORSE_SEAT.z));
        expect(Math.hypot(pelvis.x - seat.x, pelvis.y - seat.y, pelvis.z - seat.z)).toBeLessThan(0.03);
        // hands: within a few centimetres of the rein posts (or as near as the arm reaches)
        for (const side of [-1, 1] as const) {
          const el = side < 0 ? rig.joints.elbowL : rig.joints.elbowR;
          const hand = world(new Vector3(0, -P.armLower, 0), rig, el);
          const s = h.rig.scale;
          const want = h.rig.joints.body.localToWorld(new Vector3(side * HORSE_SEAT.hand.x, HORSE_SEAT.hand.y - 0.62, HORSE_SEAT.hand.z));
          const sh = world(new Vector3(0, 0, 0), rig, side < 0 ? rig.joints.shoulderL : rig.joints.shoulderR);
          const reach = P.armUpper + P.armLower;
          const need = Math.hypot(want.x - sh.x, want.y - sh.y, want.z - sh.z);
          const err = Math.hypot(hand.x - want.x, hand.y - want.y, hand.z - want.z);
          if (need < reach * 0.99) expect(err, `hand seed ${seed} speed ${speed}`).toBeLessThan(speed < 0 ? 0.16 : 0.08); // (a rear tips the shoulders back: the hands follow as far as the arm goes)
        }
      }
    }
  });

  it("the legs go round the barrel, not through it: riders long and short on cobs lean and stout, toes forward", () => {
    // (before the fit, the leg aimed straight from the hip at the iron and ran through a stout cob's barrel: 96 % of these samples lay inside it, up to 0.37 of its section)
    for (const bulk of [0, 128, 255])
      for (let seed = 1; seed <= 16; seed++) {
        const { rig, anim } = rider(seed);
        const hs = { ...horseFromSeed(seed), bulk };
        const hr = buildHorse(hs, { outline: false });
        const ha = new HorseAnimator(hr, seed);
        ha.ambient = false;
        const ride = newRideInput();
        for (let i = 0; i < 40; i++) {
          ha.update(1 / 30, { speed: seed % 2 ? 0 : 8.9, ridden: true });
          Object.assign(ride, { bob: ha.motion.bob, bodyZ: ha.motion.bodyZ, pitch: ha.motion.pitch, roll: ha.motion.roll, speed01: 0, scale: hr.scale, girth: hr.girth });
          anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0, ride });
        }
        rig.root.updateMatrixWorld(true);
        hr.root.updateMatrixWorld(true);
        const P = rig.proportions;
        const pad = rideLegPad(P.scale);
        // the thigh from where it leaves the saddle (the solver's own start), the shin all the way down
        const t0 = Math.min(0.85, Math.max(0.45, 0.13 / P.legUpper));
        for (const [joint, len, from] of [[rig.joints.hipL, P.legUpper, t0], [rig.joints.hipR, P.legUpper, t0], [rig.joints.kneeL, P.legLower, 0], [rig.joints.kneeR, P.legLower, 0]] as const)
          for (let k = 0; k <= 8; k++) {
            const v = hr.joints.body.worldToLocal(joint.localToWorld(new Vector3(0, -len * (from + ((1 - from) * k) / 8), 0)));
            expect(barrelOutside(hr.girth, v.x, v.y, v.z, pad), `bulk ${bulk} seed ${seed}`).toBeGreaterThan(-0.012);
          }
        // the feet point the way the horse faces (a knee folded down over a splayed thigh turns the toes out like wings)
        for (const knee of [rig.joints.kneeL, rig.joints.kneeR]) {
          const toe = hr.joints.body.worldToLocal(knee.localToWorld(new Vector3(0, -P.legLower, -0.2)));
          const heel = hr.joints.body.worldToLocal(knee.localToWorld(new Vector3(0, -P.legLower, 0)));
          const d = toe.sub(heel).normalize();
          expect(-d.z / Math.hypot(d.x, d.z), `toes forward (seen from above), bulk ${bulk} seed ${seed}`).toBeGreaterThan(0.6); // (within ~53 degrees: the rig has no ankle, so the toes follow the shin and turn out where a long leg wraps a stout barrel; the wings this replaced pointed straight out, 0)
        }
        // the irons hang under the boots: the pose wrote where (the ball of the right foot, with the iron's tread under it), and the horse hung them there
        hr.setStirrups(ride.iron);
        const iron = ride.iron!;
        const ball = hr.joints.body.worldToLocal(rig.joints.kneeR.localToWorld(new Vector3(0, -(P.legLower + 0.05 * P.scale), -0.22 * P.footLength)));
        expect(Math.hypot(ball.x - iron.x, ball.y + iron.half * 1.2 - iron.y, ball.z - iron.z), `iron under the boot, bulk ${bulk} seed ${seed}`).toBeLessThan(0.02);
        expect(hr.joints.body.getObjectByName("mesh_stirrups") !== undefined, `stirrups only on a riding saddle, seed ${seed}`).toBe(hs.saddle === 1);
        // and the two legs mirror each other across the horse's centre plane
        const kl = hr.joints.body.worldToLocal(rig.joints.kneeL.localToWorld(new Vector3()));
        const kr = hr.joints.body.worldToLocal(rig.joints.kneeR.localToWorld(new Vector3()));
        expect(kl.x).toBeCloseTo(-kr.x, 1);
        expect(kl.y).toBeCloseTo(kr.y, 1);
      }
  });

  it("blends in and out without a pop", () => {
    const { rig, anim } = rider(2);
    const ride = newRideInput();
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    const standing = rig.joints.pelvis.position.y;
    let last = standing;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0, ride });
      worst = Math.max(worst, Math.abs(rig.joints.pelvis.position.y - last));
      last = rig.joints.pelvis.position.y;
    }
    expect(Math.abs(last - HORSE_SEAT.y)).toBeLessThan(0.05);
    expect(worst).toBeLessThan(0.12);
    // dismount: the blend eases out to the animator's own pose
    for (let i = 0; i < 60; i++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    expect(Math.abs(rig.joints.pelvis.position.y - standing)).toBeLessThan(0.02);
  });

  it("leaves the arms to the animator when the reins are let go (a weapon is up)", () => {
    const { rig, anim } = rider(2);
    const ride = { ...newRideInput(), reins: false };
    const free = rider(2);
    for (let i = 0; i < 40; i++) {
      anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0, ride });
      free.anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    }
    expect(rig.joints.shoulderR.rotation.x).toBeCloseTo(free.rig.joints.shoulderR.rotation.x, 5);
    expect(rig.joints.elbowR.rotation.x).toBeCloseTo(free.rig.joints.elbowR.rotation.x, 5);
  });
});
