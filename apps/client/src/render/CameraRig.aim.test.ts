import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { COMBAT, CollisionWorld, FLAG, aimDirection, newBodyHit, rayBody, wrapAngle, type BodyPose, type Obstacle } from "@cb/shared";
import { AIM, aimSolve, crosshairDistance, type V3 } from "../input/aim.ts";
import { CameraRig } from "./CameraRig.ts";
import { FIRST_PERSON } from "./firstPerson.ts";

/**
 * Third-person aim (D-038, package I): the camera blends in and out without a snap, tightens the lens, puts the shoulder out, keeps off walls and never enters the head, and a shot SOLVED against
 * its crosshair ray from the server's eye meets whatever is under the crosshair at 5 to 45 m, always inside the server's yaw slack.
 */

const flat = (obstacles: Obstacle[] = []) => new CollisionWorld({ height: () => 0 }, obstacles, 200);
const feet = new Vector3(3, 0, -4);

function rig(world = flat(), fov = 65) {
  const camera = new PerspectiveCamera(fov, 16 / 9, 0.1, 600);
  const r = new CameraRig(camera, world, { fov, sensitivity: 0.0022, invertY: false, shake: 0, headBob: 0 });
  return { r, camera };
}
const run = (r: CameraRig, seconds: number, aiming: boolean, at = feet): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) r.update(at, 1 / 60, aiming, undefined);
};
const eyeOf = (at: Vector3): V3 => ({ x: at.x, y: at.y + COMBAT.eyeHeight, z: at.z });

describe("aim camera blend", () => {
  it("is continuous: no frame moves the lens by more than a small step, in or out", () => {
    const { r, camera } = rig();
    run(r, 1, false);
    let last = camera.position.clone();
    let lastFov = camera.fov;
    let worst = 0;
    let worstFov = 0;
    for (let i = 0; i < 120; i++) {
      r.update(feet, 1 / 60, i < 60, undefined);
      worst = Math.max(worst, camera.position.distanceTo(last));
      worstFov = Math.max(worstFov, Math.abs(camera.fov - lastFov));
      last = camera.position.clone();
      lastFov = camera.fov;
    }
    expect(worst).toBeLessThan(0.4);
    expect(worstFov).toBeLessThan(65 * (1 - AIM.camera.fovScale) * 0.3); // never more than a third of the whole zoom in one frame
  });

  it("aimAmount rises toward 1 while aiming and returns to 0 without overshoot", () => {
    const { r } = rig();
    let prev = 0;
    for (let i = 0; i < 90; i++) {
      r.update(feet, 1 / 60, true, undefined);
      expect(r.aimAmount).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(r.aimAmount).toBeLessThanOrEqual(1);
      prev = r.aimAmount;
    }
    expect(prev).toBeCloseTo(1, 1);
    for (let i = 0; i < 120; i++) r.update(feet, 1 / 60, false, undefined);
    expect(r.aimAmount).toBe(0);
  });

  it("tightens the field of view to the aim scale and restores it", () => {
    const { r, camera } = rig(flat(), 70);
    run(r, 1, false);
    expect(camera.fov).toBeCloseTo(70, 3);
    run(r, 1.5, true);
    expect(camera.fov).toBeCloseTo(70 * AIM.camera.fovScale, 1);
    run(r, 1.5, false);
    expect(camera.fov).toBeCloseTo(70, 1);
  });

  it("comes in closer and puts the shoulder out: the wearer's head is left of the middle of the picture and nearer than at the hip", () => {
    const { r, camera } = rig();
    r.yaw = 0.7;
    run(r, 1.5, false);
    const hipDist = camera.position.distanceTo(feet);
    const hipHead = new Vector3(feet.x, 1.55, feet.z).project(camera);
    run(r, 1.5, true);
    const aimDist = camera.position.distanceTo(feet);
    const aimHead = new Vector3(feet.x, 1.55, feet.z).project(camera);
    expect(aimDist).toBeLessThan(hipDist * 0.8);
    expect(aimHead.x).toBeLessThan(hipHead.x);
    expect(aimHead.x).toBeLessThan(-0.05);
    // the lateral offset of the lens from the head line is the aim shoulder
    const off = new Vector3().subVectors(camera.position, new Vector3(feet.x, 1.55, feet.z));
    const right = new Vector3(Math.cos(0.7), 0, -Math.sin(0.7));
    expect(off.dot(right)).toBeCloseTo(AIM.camera.shoulder, 1);
  });
});

describe("wall clearance and the head", () => {
  it("a wall behind the character pulls the aim camera in front of it, and the lens never goes inside the head", () => {
    // yaw 0 looks down -Z: the camera sits behind, at +Z. A wall 1.6 m behind the feet.
    const wall: Obstacle = { kind: "box", x: feet.x, z: feet.z + 1.6, hx: 6, hz: 0.3, yaw: 0, y0: 0, y1: 6 };
    const { r, camera } = rig(flat([wall]));
    run(r, 2, true);
    expect(r.wallPull).toBeGreaterThan(0);
    // in front of the wall's near face (z = feet.z + 1.3), with the clearance to spare
    expect(camera.position.z).toBeLessThan(feet.z + 1.3 - AIM.camera.wallClearance * 0.5);
    const head = new Vector3(feet.x, 1.55, feet.z);
    expect(camera.position.distanceTo(head)).toBeGreaterThan(0.8);
  });

  it("with the wall pressed against the back, the lens still keeps its distance from the head", () => {
    const wall: Obstacle = { kind: "box", x: feet.x, z: feet.z + 0.5, hx: 6, hz: 0.3, yaw: 0, y0: 0, y1: 6 };
    const { r, camera } = rig(flat([wall]));
    run(r, 2, true);
    const head = new Vector3(feet.x, 1.55, feet.z);
    expect(camera.position.distanceTo(head)).toBeGreaterThan(0.8);
  });

  it("an open field pulls nothing", () => {
    const { r } = rig();
    run(r, 2, true);
    expect(r.wallPull).toBe(0);
  });
});

const pose = (x: number, z: number): BodyPose => ({ x, y: 0, z, facing: 0, flags: 0 });
const dummy = (eye: V3, yaw: number, d: number): BodyPose => pose(eye.x - Math.sin(yaw) * d, eye.z - Math.cos(yaw) * d);

describe("the solved shot meets the crosshair", () => {
  for (const dist of [5, 15, 30, 45]) {
    it(`a body ${dist} m down the crosshair is struck by the solved shot, inside the slack`, () => {
      const { r } = rig();
      r.yaw = 0.4;
      r.pitch = 0;
      run(r, 1.5, true);
      const o: V3 = { x: 0, y: 0, z: 0 };
      const d: V3 = { x: 0, y: 0, z: 0 };
      r.crosshairRay(o, d);
      // put a dummy exactly under the crosshair, at `dist` along the ray from the lens, with its chest at the ray's height
      const px = o.x + d.x * dist;
      const pz = o.z + d.z * dist;
      const py = o.y + d.y * dist;
      const body: BodyPose = { x: px, y: py - 1.1, z: pz, facing: 0, flags: 0 };
      const hitDist = crosshairDistance(flat(), o, d, [body]);
      expect(hitDist).toBeGreaterThan(dist - 1.2);
      expect(hitDist).toBeLessThan(dist + 0.2);
      const eye = eyeOf(feet);
      const sol = aimSolve(eye, o, d, hitDist);
      // inside the server's slack of the camera's own yaw
      const camYaw = Math.atan2(-d.x, -d.z);
      expect(Math.abs(wrapAngle(sol.yaw - camYaw))).toBeLessThanOrEqual(COMBAT.aimYawSlack);
      expect(sol.clamped).toBe(false);
      // fire it from the eye like the server does and test the body
      const dir = aimDirection(sol.yaw, sol.elev, { x: 0, y: 0, z: 0 });
      const out = newBodyHit();
      const hit = rayBody(body, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 80, 0, out);
      expect(hit, `at ${dist} m`).toBe(true);
    });
  }

  it("with a wall far behind the target, the target still decides the convergence (the parallax trap)", () => {
    const { r } = rig();
    r.yaw = 0;
    r.pitch = 0;
    run(r, 1.5, true);
    const o: V3 = { x: 0, y: 0, z: 0 };
    const d: V3 = { x: 0, y: 0, z: 0 };
    r.crosshairRay(o, d);
    const body: BodyPose = { x: o.x + d.x * 6, y: 0, z: o.z + d.z * 6, facing: 0, flags: 0 };
    const wall: Obstacle = { kind: "box", x: o.x + d.x * 40, z: o.z + d.z * 40, hx: 20, hz: 0.5, yaw: 0, y0: 0, y1: 20 };
    const world = flat([wall]);
    const withBody = crosshairDistance(world, o, d, [body]);
    const without = crosshairDistance(world, o, d, []);
    expect(withBody).toBeLessThan(without - 20);
    const eye = eyeOf(feet);
    const solve = (hd: number) => {
      const s = aimSolve(eye, o, d, hd);
      const dir = aimDirection(s.yaw, s.elev, { x: 0, y: 0, z: 0 });
      return rayBody(body, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 80, 0, newBodyHit());
    };
    expect(solve(withBody)).toBe(true);
    expect(solve(without)).toBe(false); // the old way (converge on the far wall) misses the man at 6 m by most of a metre
  });

  it("nothing under the crosshair converges at the far distance, and a standing body in the way is found", () => {
    const { r } = rig();
    r.pitch = 0;
    run(r, 1.5, true);
    const o: V3 = { x: 0, y: 0, z: 0 };
    const d: V3 = { x: 0, y: 0, z: 0 };
    r.crosshairRay(o, d);
    expect(crosshairDistance(flat(), o, d, [])).toBeGreaterThanOrEqual(AIM.convergence.far - 1e-9);
    const standing: BodyPose = { x: o.x + d.x * 12, y: o.y - 1.1, z: o.z + d.z * 12, facing: 0, flags: 0 };
    expect(crosshairDistance(flat(), o, d, [standing])).toBeLessThan(AIM.convergence.far);
    const bad: BodyPose = { x: Number.NaN, y: 0, z: 0, facing: 0, flags: FLAG.DOWNED };
    expect(Number.isFinite(crosshairDistance(flat(), o, d, [bad]))).toBe(true);
  });
});

describe("first person is untouched", () => {
  it("the aim lens does not stack on the first-person lens", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    for (let i = 0; i < 120; i++) {
      r.update(feet, 1 / 60, true, {
        neck: { x: feet.x, y: 1.3, z: feet.z }, torso: { x: feet.x, y: 1, z: feet.z }, eyeUp: 0.4, eyeReach: 0.3, up: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: -1 },
        speed: 0, grounded: true, ragdolled: false, lying: false, lie: 0,
      } as never);
    }
    expect(camera.fov).toBeCloseTo(FIRST_PERSON.fov * FIRST_PERSON.aimFovScale, 1);
  });
});

describe("the ready view (D-040: a firearm in hand, aim not held)", () => {
  it("the crosshair is clear of the wearer: the head and the right shoulder stand left of the middle of the picture, at most a little closer than the hip", () => {
    for (const yaw of [0, 0.7, -2.1, 3]) {
      const { r, camera } = rig();
      r.yaw = yaw;
      run(r, 1.5, false);
      const hipDist = camera.position.distanceTo(feet);
      // the playtest's complaint: at the hip with a gun drawn, the crosshair sat on the player's own head
      const hipHead = new Vector3(feet.x, 1.55, feet.z).project(camera);
      expect(Math.abs(hipHead.x)).toBeLessThan(0.12);
      r.ready = true;
      run(r, 1.5, false);
      // the right shoulder is 0.3 m to the wearer's right of the head (right of the look direction: (cos yaw, -sin yaw))
      const right = new Vector3(feet.x + Math.cos(yaw) * 0.3, 1.45, feet.z - Math.sin(yaw) * 0.3).project(camera);
      const head = new Vector3(feet.x, 1.55, feet.z).project(camera);
      expect(head.x).toBeLessThan(-0.08);
      expect(right.x).toBeLessThan(-0.02);
      expect(Math.abs(head.y)).toBeLessThan(0.1); // on the crosshair's horizon: the line the shot travels
      expect(camera.position.distanceTo(feet)).toBeGreaterThan(hipDist * 0.75);
      expect(r.aimAmount).toBe(0); // (not the aim view: the lens and the walk are unchanged)
      // aiming from ready goes further in, as before; releasing everything returns to the hip
      run(r, 1.5, true);
      expect(new Vector3(feet.x, 1.55, feet.z).project(camera).x).toBeLessThan(-0.05);
      r.ready = false;
      run(r, 2, false);
      expect(Math.abs(new Vector3(feet.x, 1.55, feet.z).project(camera).x)).toBeLessThan(0.12);
    }
  });

  it("drawing and holstering never jumps the lens", () => {
    const { r, camera } = rig();
    run(r, 1, false);
    let last = camera.position.clone();
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      r.ready = i < 60;
      r.update(feet, 1 / 60, false, undefined);
      worst = Math.max(worst, camera.position.distanceTo(last));
      last = camera.position.clone();
    }
    expect(worst).toBeLessThan(0.3);
  });
});
