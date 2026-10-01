import { describe, expect, it } from "vitest";
import { COMBAT, aimDirection, wrapAngle } from "@cb/shared";
import { AIM, aimSolve, assistLook, blendAim, reticleRadiusPx, type AssistOut } from "./aim.ts";

const dirOf = (yaw: number, pitch: number): { x: number; y: number; z: number } => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });

describe("aimSolve: the shot goes through what the crosshair is on", () => {
  // the character stands at the origin, eye 1.55 up; the camera is 3 m behind, 0.95 m to the right, 1.6 m up, looking along -Z
  const eye = { x: 0, y: 1.55, z: 0 };
  const camPos = { x: 0.95, y: 1.6, z: 3 };
  it("the round from the head meets the point under the crosshair at any range", () => {
    for (const dist of [8, 20, 45]) {
      const camDir = dirOf(0, 0);
      const s = aimSolve(eye, camPos, camDir, dist);
      const target = { x: camPos.x + camDir.x * dist, y: camPos.y + camDir.y * dist, z: camPos.z + camDir.z * dist };
      // walk from the eye along the solved direction to the target's distance from the eye
      const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
      const v = aimDirection(s.yaw, s.elev, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(eye.x + v.x * d - target.x, eye.y + v.y * d - target.y, eye.z + v.z * d - target.z), `range ${dist}`).toBeLessThan(0.02);
      expect(s.clamped).toBe(false);
    }
  });
  it("a shoulder-camera aim at 45 m is almost parallel, at 8 m it converges inward by the shoulder offset", () => {
    const far = aimSolve(eye, camPos, dirOf(0, 0), 45).yaw;
    expect(Math.abs(far)).toBeLessThan(0.03);
    const near = aimSolve(eye, camPos, dirOf(0, 0), 8).yaw;
    expect(near).toBeLessThan(-0.1); // the head is to the left of the camera line: the shot angles right (yaw decreases) to meet it
  });
  it("never leaves the server's yaw slack or elevation limit, however close the thing under the crosshair", () => {
    for (const dist of [0, 0.5, 3, 5]) {
      const s = aimSolve({ x: 0, y: 1.55, z: 0 }, { x: 2.5, y: 1.6, z: 0.2 }, dirOf(0, 0), dist);
      expect(Math.abs(wrapAngle(s.yaw - 0))).toBeLessThanOrEqual(COMBAT.aimYawSlack);
      expect(Math.abs(s.elev)).toBeLessThanOrEqual(COMBAT.aimElevMax);
    }
    const up = aimSolve(eye, { x: 0, y: 1.6, z: 3 }, dirOf(0, 1.3), 3);
    expect(Math.abs(up.elev)).toBeLessThanOrEqual(COMBAT.aimElevMax);
  });
  it("a non-finite hit distance falls back to the far convergence", () => {
    const a = aimSolve(eye, camPos, dirOf(0.4, 0.1), Number.NaN);
    const b = aimSolve(eye, camPos, dirOf(0.4, 0.1), AIM.convergence.far);
    expect(a.yaw).toBeCloseTo(b.yaw, 9);
  });
});

describe("blendAim", () => {
  it("reaches 95 % in the stated time, never overshoots and never goes backward", () => {
    let k = 0;
    let t = 0;
    let prev = 0;
    while (t < AIM.camera.blendIn) {
      k = blendAim(k, true, 1 / 60);
      t += 1 / 60;
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k).toBeLessThanOrEqual(1);
      prev = k;
    }
    expect(k).toBeGreaterThan(0.93);
    for (let i = 0; i < 120; i++) k = blendAim(k, false, 1 / 60);
    expect(k).toBe(0);
    expect(blendAim(0.5, true, -1)).toBe(0.5);
  });
});

describe("pad assist", () => {
  const eye = { x: 0, y: 1.55, z: 0 };
  const out: AssistOut = { dYaw: 0, dElev: 0, slow: 1, id: "" };
  const target = (x: number, z: number) => ({ id: "t", x, y: 1.3, z, r: 0.45 });
  it("is off for the mouse", () => {
    assistLook(eye, 0, 0, [target(0.2, -15)], false, out);
    expect(out).toEqual({ dYaw: 0, dElev: 0, slow: 1, id: "" });
  });
  it("pulls toward a hostile inside the cone and slows the stick, strongest at the centre", () => {
    assistLook(eye, 0, 0, [target(-0.6, -15)], true, out); // the target is a little LEFT of the aim: yaw increases
    expect(out.id).toBe("t");
    expect(out.dYaw).toBeGreaterThan(0);
    expect(out.slow).toBeLessThan(1);
    const centred = { ...out };
    assistLook(eye, 0, 0, [target(-0.05, -15)], true, out);
    expect(Math.abs(out.dYaw)).toBeLessThan(Math.abs(centred.dYaw) + 1);
    expect(out.slow).toBeLessThan(centred.slow);
  });
  it("does nothing outside the cone, for something too close, or too far", () => {
    for (const t of [target(8, -15), target(0, -1), target(0, -80)]) {
      assistLook(eye, 0, 0, [t], true, out);
      expect(out.id).toBe("");
      expect(out.slow).toBe(1);
    }
  });
  it("the correction rate times a frame cannot exceed the drift budget inside the server's slack", () => {
    expect(AIM.assist.maxPull).toBeLessThan(COMBAT.aimYawSlack * 0.5);
    expect(AIM.assist.cone).toBeLessThan(AIM.assist.stickyCone);
  });
});

describe("reticle", () => {
  it("grows with spread, shrinks with a tighter lens and is a dot when aimed and steady", () => {
    const hip = reticleRadiusPx(0.06, 65, 1080);
    expect(reticleRadiusPx(0.12, 65, 1080)).toBeGreaterThan(hip);
    expect(reticleRadiusPx(0.06, 50, 1080)).toBeGreaterThan(hip);
    expect(reticleRadiusPx(0.001, 65, 1080, true)).toBe(AIM.reticle.aimedPx);
    expect(reticleRadiusPx(10, 65, 1080)).toBeLessThanOrEqual(AIM.reticle.hipMaxPx);
    expect(reticleRadiusPx(0, 65, 1080)).toBeGreaterThanOrEqual(AIM.reticle.hipMinPx);
  });
});
