import { describe, expect, it } from "vitest";
import { generateCharacter } from "@cb/procedural";
import { buildCharacter } from "@cb/procedural/three";
import {
  FIRST_PERSON,
  advanceBob,
  bobOffset,
  downedPitch,
  ease,
  eyeFollowRate,
  eyePosition,
  headHidden,
  newEyeSample,
  pitchRange,
  restEyeHeight,
  transitionStep,
} from "./firstPerson.ts";

describe("eye height from proportions", () => {
  it("matches the built rig's head joint and eye placement for a range of characters", () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const rig = buildCharacter(generateCharacter(seed), { outline: false });
      // The formula describes the animator's rest pose: no posture lean, no head tilt.
      rig.joints.torso.rotation.x = 0;
      rig.joints.head.rotation.set(0, 0, 0);
      rig.root.updateMatrixWorld(true);
      const P = rig.proportions;
      const neckY = rig.joints.head.matrixWorld.elements[13]!;
      // The rig places the pelvis at foot + legs and the animator adds 0.05*scale: the rig builds with the same numbers.
      const expected = restEyeHeight(P, rig.face.eyeL.position.y);
      expect(neckY + P.headRadius + rig.face.eyeL.position.y).toBeCloseTo(expected, 5);
      // Sanity: eyes sit below the crown of the head and above the shoulders.
      expect(expected).toBeLessThan(P.totalHeight);
      expect(expected).toBeGreaterThan(P.legUpper + P.legLower + P.torsoHeight);
      rig.dispose();
    }
  });

  it("taller legs and bigger heads raise the eyes", () => {
    const base = { scale: 1, legUpper: 0.4, legLower: 0.4, torsoHeight: 0.6, neck: 0.05, headRadius: 0.3 };
    expect(restEyeHeight({ ...base, legUpper: 0.5, legLower: 0.5 }, 0.03)).toBeGreaterThan(restEyeHeight(base, 0.03));
    expect(restEyeHeight({ ...base, headRadius: 0.4 }, 0.03)).toBeGreaterThan(restEyeHeight(base, 0.03));
  });
});

describe("view transition", () => {
  it("takes the configured time, never overshoots and can reverse midway", () => {
    let t = 0;
    let frames = 0;
    while (t < 1 && frames < 1000) {
      t = transitionStep(t, 1, 1 / 60);
      expect(t).toBeLessThanOrEqual(1);
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(Math.floor(FIRST_PERSON.transitionSeconds * 60));
    expect(frames).toBeLessThanOrEqual(Math.ceil(FIRST_PERSON.transitionSeconds * 60) + 1);
    t = transitionStep(0.5, 0, 0.05);
    expect(t).toBeCloseTo(0.5 - 0.05 / FIRST_PERSON.transitionSeconds);
    expect(transitionStep(1, 1, 0.016)).toBe(1);
    expect(transitionStep(0, 0, 0.016)).toBe(0);
  });

  it("ignores a negative first-frame dt instead of running backwards or past the ends", () => {
    expect(transitionStep(1, 0, -0.5)).toBe(1);
    expect(transitionStep(0.4, 1, -0.5)).toBe(0.4);
  });

  it("eases both ends and hides the head only when the camera is nearly there", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(-3)).toBe(0);
    expect(ease(3)).toBe(1);
    expect(headHidden(0)).toBe(false);
    expect(headHidden(0.3)).toBe(false);
    expect(headHidden(1)).toBe(true);
  });

  it("first person may look nearly straight up and down; the follow camera may not", () => {
    const [flo, fhi] = pitchRange(true);
    const [tlo, thi] = pitchRange(false);
    expect(flo).toBeLessThan(tlo);
    expect(fhi).toBeGreaterThan(thi);
    expect(fhi).toBeLessThan(Math.PI / 2);
  });
});

describe("downed pose", () => {
  it("looks up at the sky when lying, and is untouched when upright", () => {
    expect(downedPitch(0.3, 0)).toBe(0.3);
    const lying = downedPitch(0.3, 1);
    expect(lying).toBeLessThan(-0.8); // steeply up (negative = up)
    expect(lying).toBeGreaterThan(-1.45);
    // the mouse still nudges it, within limits
    expect(downedPitch(-0.5, 1)).toBeLessThan(downedPitch(0.8, 1));
    expect(downedPitch(0.3, 0.5)).toBeGreaterThan(lying);
    expect(downedPitch(0.3, 0.5)).toBeLessThan(0.3);
  });

  it("puts the lens straight above the neck when upright and on the head's own axes when lying", () => {
    const out = { x: 0, y: 0, z: 0 };
    const neck = { x: 1, y: 1.4, z: 2 };
    const upright = eyePosition(out, neck, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 0, 0.4, 0.3, 0);
    expect(upright.x).toBeCloseTo(1);
    expect(upright.y).toBeCloseTo(1.8);
    expect(upright.z).toBeCloseTo(2 - 0.3 * FIRST_PERSON.eyeForwardFraction); // yaw 0 looks down -Z
    // Yawing 90 degrees left pushes the lens toward -X instead.
    eyePosition(out, neck, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, Math.PI / 2, 0.4, 0.3, 0);
    expect(out.x).toBeCloseTo(1 - 0.3 * FIRST_PERSON.eyeForwardFraction);
    expect(out.z).toBeCloseTo(2, 5);
    // Lying on the back: the head's up axis points along the ground (toward +Z, behind), its face points at the sky.
    const lying = eyePosition(out, { x: 0, y: 0.3, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, 0, 0.4, 0.3, 1);
    expect(lying.z).toBeCloseTo(0.4);
    expect(lying.y).toBeCloseTo(0.3 + 0.3 * FIRST_PERSON.eyeForwardFraction);
    expect(lying.y).toBeLessThan(0.6); // low, near the ground
  });
});

describe("head bob", () => {
  const out = { y: 0, side: 0 };

  it("is exactly zero when disabled, for any speed and phase", () => {
    for (const speed of [0, 1, 4.4, 9]) {
      for (const phase of [0, 0.7, 2, 5]) {
        bobOffset(out, phase, speed, 0);
        expect(out.y).toBe(0);
        expect(out.side).toBe(0);
      }
    }
  });

  it("is zero standing still, subtle when walking and grows with speed and the setting", () => {
    bobOffset(out, 1.2, 0, 1);
    expect(out.y).toBe(0);
    bobOffset(out, Math.PI / 2, 4.4, 1);
    const full = Math.abs(out.y);
    expect(full).toBeGreaterThan(0.005);
    expect(full).toBeLessThanOrEqual(FIRST_PERSON.bobVertical * 1.4 + 1e-9);
    bobOffset(out, Math.PI / 2, 2.2, 1);
    expect(Math.abs(out.y)).toBeLessThan(full);
    bobOffset(out, Math.PI / 2, 4.4, 0.5);
    expect(Math.abs(out.y)).toBeCloseTo(full / 2);
  });

  it("fades out while lying down", () => {
    bobOffset(out, Math.PI / 2, 4.4, 1, 1);
    expect(out.y).toBe(0);
    expect(out.side).toBe(0);
  });

  it("only advances with distance on the ground", () => {
    expect(advanceBob(1, 4, 0.1, false)).toBe(1);
    expect(advanceBob(1, 0, 0.1, true)).toBe(1);
    expect(advanceBob(1, 4, 0.1, true)).toBeGreaterThan(1);
  });

  it("filters the gait's own sway harder when bob is off", () => {
    expect(eyeFollowRate(0)).toBeLessThan(eyeFollowRate(1));
    expect(eyeFollowRate(-3)).toBe(eyeFollowRate(0));
    expect(eyeFollowRate(9)).toBe(eyeFollowRate(1));
  });
});

describe("EyeSample", () => {
  it("starts upright and standing", () => {
    const s = newEyeSample();
    expect(s.up).toEqual({ x: 0, y: 1, z: 0 });
    expect(s.lying).toBe(false);
    expect(s.ragdolled).toBe(false);
  });
});
