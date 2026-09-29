import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CollisionWorld } from "@cb/shared";
import { CameraRig } from "./CameraRig.ts";
import { FIRST_PERSON, newEyeSample, type EyeSample } from "./firstPerson.ts";

const world = () => new CollisionWorld({ height: () => 0 }, [], 100);
const feet = new Vector3(3, 0, -4);

/** A standing eye sample whose neck is 1.3 m above the feet. */
function standing(over: Partial<EyeSample> = {}): EyeSample {
  const s = newEyeSample();
  s.neck = { x: feet.x, y: 1.3, z: feet.z };
  s.torso = { x: feet.x, y: 1.0, z: feet.z };
  s.eyeUp = 0.4;
  s.eyeReach = 0.3;
  return Object.assign(s, over);
}

function rig(headBob = 1) {
  const camera = new PerspectiveCamera(65, 16 / 9, 0.1, 600);
  const r = new CameraRig(camera, world(), { fov: 65, sensitivity: 0.0022, invertY: false, shake: 0, headBob });
  return { r, camera };
}

const run = (r: CameraRig, seconds: number, eye: () => EyeSample | undefined, aiming = false): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) r.update(feet, 1 / 60, aiming, eye());
};

const lookDir = (camera: PerspectiveCamera): Vector3 => camera.getWorldDirection(new Vector3());

describe("CameraRig views", () => {
  it("defaults to third person, behind and above the player", () => {
    const { r, camera } = rig();
    run(r, 1, () => undefined);
    expect(r.mode).toBe("third");
    expect(r.firstPersonAmount).toBe(0);
    expect(camera.position.distanceTo(feet)).toBeGreaterThan(4);
    expect(camera.fov).toBe(65);
  });

  it("first person puts the lens at the eyes, with a wide FOV and a small near plane", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    run(r, 0.5, () => standing());
    // yaw 0 looks down -Z: the lens is a little ahead of the neck, straight above it.
    expect(camera.position.x).toBeCloseTo(feet.x, 2);
    expect(camera.position.y).toBeCloseTo(1.3 + 0.4, 2);
    expect(camera.position.z).toBeLessThan(feet.z);
    expect(camera.position.z).toBeGreaterThan(feet.z - 0.3);
    expect(camera.fov).toBeCloseTo(FIRST_PERSON.fov);
    expect(camera.near).toBe(FIRST_PERSON.near);
    expect(r.headHidden).toBe(true);
  });

  it("follows yaw and pitch exactly: W moves along the view direction", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    r.yaw = 0.6;
    r.pitch = 0;
    run(r, 0.2, () => standing());
    const d = lookDir(camera);
    // Shared movement: forward = (-sin yaw, -cos yaw).
    expect(d.x).toBeCloseTo(-Math.sin(0.6), 3);
    expect(d.z).toBeCloseTo(-Math.cos(0.6), 3);
    expect(d.y).toBeCloseTo(0, 3);
    r.pitch = 0.5; // + = down
    run(r, 0.2, () => standing());
    expect(lookDir(camera).y).toBeLessThan(-0.4);
  });

  it("blends over about a quarter of a second without snapping, and back again", () => {
    const { r, camera } = rig();
    run(r, 1, () => standing());
    const far = camera.position.clone();
    r.toggleView();
    expect(r.mode).toBe("first");
    const positions: Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      r.update(feet, 1 / 60, false, standing());
      positions.push(camera.position.clone());
    }
    // No frame jumps more than a third of the total travel: it is a glide, not a cut.
    const total = far.distanceTo(positions.at(-1)!);
    for (let i = 1; i < positions.length; i++) expect(positions[i]!.distanceTo(positions[i - 1]!)).toBeLessThan(total / 3);
    expect(r.firstPersonAmount).toBe(1);
    expect(r.headHidden).toBe(true);
    // ...and back.
    r.toggleView();
    run(r, 0.1, () => standing());
    expect(r.firstPersonAmount).toBeGreaterThan(0);
    expect(r.firstPersonAmount).toBeLessThan(1);
    run(r, 1, () => standing());
    expect(r.firstPersonAmount).toBe(0);
    expect(r.headHidden).toBe(false);
    expect(camera.fov).toBeCloseTo(65);
    expect(camera.near).toBe(FIRST_PERSON.nearThird);
    expect(camera.position.distanceTo(far)).toBeLessThan(0.05);
  });

  it("stays in third person (and never throws) while there is no body to sample", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    expect(() => run(r, 0.5, () => undefined)).not.toThrow();
    expect(r.firstPersonAmount).toBe(0);
    expect(camera.position.distanceTo(feet)).toBeGreaterThan(4);
  });

  it("clamps pitch to the follow camera's range when leaving first person", () => {
    const { r } = rig();
    r.setView("first", true);
    r.pitch = -1.3;
    expect(r.pitch).toBe(-1.3);
    r.setView("third");
    expect(r.pitch).toBeGreaterThanOrEqual(-0.35);
    r.setView("first");
    r.look(0, 100000);
    expect(r.pitch).toBe(FIRST_PERSON.pitchMax);
  });

  it("crouching and kneeling lower the lens (the head joint drops, the camera follows)", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    run(r, 0.5, () => standing());
    const y0 = camera.position.y;
    run(r, 1, () => standing({ neck: { x: feet.x, y: 0.8, z: feet.z } }));
    expect(camera.position.y).toBeLessThan(y0 - 0.4);
  });

  it("a downed body lies low and the view swings up to the sky", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    r.pitch = 0.1;
    run(r, 0.5, () => standing());
    expect(lookDir(camera).y).toBeLessThan(0.05);
    const lying = () =>
      standing({ lying: true, neck: { x: feet.x, y: 0.3, z: feet.z + 0.5 }, up: { x: 0, y: 0, z: 1 }, forward: { x: 0, y: 1, z: 0 } });
    run(r, 2, lying);
    expect(lookDir(camera).y).toBeGreaterThan(0.7);
    expect(camera.position.y).toBeLessThan(0.7);
    expect(camera.position.y).toBeGreaterThanOrEqual(0.12); // never under the ground
  });

  it("getting up: the lens tracks the rising head tightly (never left behind inside the torso) and the view eases down", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    const at = (lie: number) =>
      standing({ lie, lying: lie > 0, neck: { x: feet.x, y: 0.3 + 1.0 * (1 - lie), z: feet.z + 0.5 * lie }, up: { x: 0, y: 1 - lie, z: lie }, forward: { x: 0, y: lie, z: -(1 - lie) } });
    run(r, 1, () => at(1));
    let worst = 0;
    for (let i = 0; i <= 30; i++) {
      const lie = 1 - i / 30; // rises over half a second
      const eye = at(lie);
      r.update(feet, 1 / 60, false, eye);
      // camera height vs where the head actually is: a lagging low-pass would sit far below the rising neck
      worst = Math.max(worst, eye.neck.y + 0.4 * eye.up.y - camera.position.y);
    }
    expect(worst).toBeLessThan(0.12);
    run(r, 1, () => at(0));
    expect(lookDir(camera).y).toBeLessThan(0.05);
  });

  it("a ragdoll follows the torso, not the flopping head", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    run(r, 0.5, () => standing());
    // The head is flung 3 m away; the torso stays put.
    const flung = () => standing({ lying: true, ragdolled: true, neck: { x: feet.x + 3, y: 2.5, z: feet.z }, torso: { x: feet.x, y: 0.4, z: feet.z } });
    run(r, 3, flung);
    expect(Math.hypot(camera.position.x - feet.x, camera.position.z - feet.z)).toBeLessThan(0.5);
    expect(camera.position.y).toBeLessThan(1);
    expect(lookDir(camera).y).toBeGreaterThan(0.5);
  });

  it("head bob: none when disabled, present when enabled", () => {
    const heights = (bob: number): number[] => {
      const { r, camera } = rig(bob);
      r.setView("first", true);
      run(r, 0.3, () => standing());
      const ys: number[] = [];
      for (let i = 0; i < 120; i++) {
        r.update(feet, 1 / 60, false, standing({ speed: 4.4 }));
        ys.push(camera.position.y);
      }
      return ys;
    };
    const range = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(range(heights(0))).toBeLessThan(1e-9);
    const on = range(heights(1));
    expect(on).toBeGreaterThan(0.005);
    expect(on).toBeLessThan(0.05); // subtle
  });

  it("keeps the landing / knock shake in first person", () => {
    const { r, camera } = rig();
    r.settings.shake = 1;
    r.setView("first", true);
    run(r, 0.3, () => standing());
    const base = camera.position.clone();
    r.addShake(1);
    let moved = 0;
    for (let i = 0; i < 10; i++) {
      r.update(feet, 1 / 60, false, standing());
      moved = Math.max(moved, camera.position.distanceTo(base));
    }
    expect(moved).toBeGreaterThan(0.001);
    run(r, 2, () => standing());
    expect(camera.position.distanceTo(base)).toBeLessThan(1e-6);
  });

  it("aiming narrows the first-person field of view a little", () => {
    const { r, camera } = rig();
    r.setView("first", true);
    run(r, 1, () => standing(), true);
    expect(camera.fov).toBeCloseTo(FIRST_PERSON.fov * FIRST_PERSON.aimFovScale, 1);
  });
});
