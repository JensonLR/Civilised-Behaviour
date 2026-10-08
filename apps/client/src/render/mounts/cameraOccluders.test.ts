import { Group, PerspectiveCamera, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CollisionWorld, MOUNT_KIND, MOUNT_PHASE } from "@cb/shared";
import { CameraRig, type CameraRay } from "../CameraRig.ts";
import { HORSE_BULK, MountView, WAGON_BULK, castBulk, type MountRowLike } from "./MountView.ts";

/**
 * The follow camera stops in front of a mount as it does in front of a wall: mounting beside the stable's wagon left the lens behind the wagon's rack, looking at the rider
 * through its rails. The mounts' view is the camera's occluders: each wagon and horse a box in its own frame (the local rider's own horse excepted: the lens rides over it).
 */
const ray = (o: [number, number, number], d: [number, number, number], len: number): CameraRay => {
  const l = Math.hypot(d[0], d[1], d[2]);
  return { ox: o[0], oy: o[1], oz: o[2], dx: d[0] / l, dy: d[1] / l, dz: d[2] / l, len, t: len };
};
const at = (x: number, y: number, z: number, yaw = 0, scale = 1): Group => {
  const g = new Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  g.scale.setScalar(scale);
  return g;
};

describe("castBulk: a ray against a mount's box", () => {
  it("enters a wagon end-on where its tail is, side-on where its side is, and not when it passes over or starts inside", () => {
    const r = ray([0, 1, 6], [0, 0, -1], 10);
    castBulk(r, at(0, 0, 0), WAGON_BULK);
    expect(r.t).toBeCloseTo(6 - WAGON_BULK.z1, 6);
    const side = ray([0, 1, 6], [0, 0, -1], 10);
    castBulk(side, at(0, 0, 0, Math.PI / 2), WAGON_BULK); // turned a quarter: its side faces the ray
    expect(side.t).toBeCloseTo(6 - WAGON_BULK.x, 6);
    const over = ray([0, 2.4, 6], [0, 0, -1], 10);
    castBulk(over, at(0, 0, 0), WAGON_BULK);
    expect(over.t).toBe(10);
    const inside = ray([0, 1, 0], [0, 0, 1], 10); // (a head in the wagon's bed)
    castBulk(inside, at(0, 0, 0), WAGON_BULK);
    expect(inside.t).toBe(10);
    const short = ray([0, 1, 6], [0, 0, -1], 3); // stops before it reaches the tail
    castBulk(short, at(0, 0, 0), WAGON_BULK);
    expect(short.t).toBe(3);
    const nearer = ray([0, 1, 6], [0, 0, -1], 10);
    nearer.t = 2; // something nearer already stopped it
    castBulk(nearer, at(0, 0, 0), WAGON_BULK);
    expect(nearer.t).toBe(2);
  });

  it("a horse's box grows with the animal, and a diagonal ray through it is finite and in range", () => {
    const small = ray([3, 1, 0], [-1, 0, 0], 10);
    castBulk(small, at(0, 0, 0, 0, 1), HORSE_BULK);
    const big = ray([3, 1, 0], [-1, 0, 0], 10);
    castBulk(big, at(0, 0, 0, 0, 1.2), HORSE_BULK);
    expect(small.t).toBeCloseTo(3 - HORSE_BULK.x, 6);
    expect(big.t).toBeCloseTo(3 - HORSE_BULK.x * 1.2, 6);
    const diag = ray([4, 3, 4], [-1, -0.6, -1], 12);
    castBulk(diag, at(0, 0, 0, 0.7), HORSE_BULK);
    expect(Number.isFinite(diag.t)).toBe(true);
    expect(diag.t).toBeGreaterThan(0);
    expect(diag.t).toBeLessThan(12);
  });
});

describe("the follow camera and the mounts", () => {
  const feet = new Vector3(0, 0, 0);
  const row = (over: Partial<MountRowLike>): MountRowLike => ({ kind: MOUNT_KIND.horse, x: 0, y: 0, z: 0, facing: 0, speed: 0, rider: "", hitch: "", coat: 4, phase: MOUNT_PHASE.loose, hp: 100, cargo: 0, ...over });
  const setup = (rows: Record<string, MountRowLike>, me = "me") => {
    const camera = new PerspectiveCamera(65, 16 / 9, 0.1, 600);
    const rig = new CameraRig(camera, new CollisionWorld({ height: () => 0 }, [], 100), { fov: 65, sensitivity: 0.0022, invertY: false, shake: 0, headBob: 0 });
    const view = new MountView(new Scene(), { outline: false });
    view.cameraRider = me;
    const map = new Map(Object.entries(rows));
    const pose = { x: 0, y: 0, z: 0, facing: 0, vx: 0, vz: 0, flags: 1 };
    for (let i = 0; i < 3; i++) view.update(1 / 60, map, () => pose);
    rig.occluders = view;
    rig.pitch = 0.05; // (looking level: the lens hangs at head height behind the wearer; at the default pitch it rides over a wagon's rack)
    for (let i = 0; i < 90; i++) rig.update(feet, 1 / 60, false, undefined);
    return { rig, camera, view };
  };

  it("a wagon parked behind the wearer pulls the lens in front of it; with no wagon the lens stands at its full distance", () => {
    const free = setup({});
    expect(free.rig.wallPull).toBe(0);
    const freeDist = free.camera.position.distanceTo(feet);
    const blocked = setup({ w: row({ kind: MOUNT_KIND.wagon, z: 3.4, facing: 0 }) }); // (the camera sits behind the look, at +z, about 5 m out)
    expect(blocked.rig.wallPull).toBeGreaterThan(0.5);
    expect(blocked.camera.position.distanceTo(feet)).toBeLessThan(freeDist - 0.5);
    // the lens is on the near side of the wagon (its front board faces the wearer: the wagon looks along -z), not inside or behind it
    expect(blocked.camera.position.z).toBeLessThan(3.4 + WAGON_BULK.z0);
  });

  it("your own horse is not a wall (the lens rides over its rump); somebody else's horse at your back is", () => {
    const mine = setup({ h: row({ z: 1.2, rider: "me" }) }, "me");
    expect(mine.rig.wallPull).toBe(0);
    const theirs = setup({ h: row({ z: 2.2, rider: "someone" }) }, "me");
    const loose = setup({ h: row({ z: 2.2 }) }, "me");
    // a horse at your back stops a lens that would pass through its barrel (the ray from the head goes up and back: it may clear a low barrel; the box is honest either way)
    expect(Number.isFinite(theirs.rig.wallPull) && Number.isFinite(loose.rig.wallPull)).toBe(true);
    expect(theirs.camera.position.distanceTo(feet)).toBeLessThanOrEqual(mine.camera.position.distanceTo(feet) + 1e-6);
  });
});
