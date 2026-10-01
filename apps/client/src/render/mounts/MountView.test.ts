import { Mesh, Scene, type BufferGeometry, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { MOUNT, MOUNT_FLAG, MOUNT_KIND, MOUNT_PHASE, WAGON } from "@cb/shared";
import { MountView, type MountRowLike, type RiderPoseLike } from "./MountView.ts";
import { MOUNT_PROMPTS, mountPrompt, type PromptMe } from "./mountPrompt.ts";
import { MOUNTED_CAMERA, easeMountedCamera, mountedCameraTarget, newMountedCamera } from "./mountCamera.ts";

const row = (over: Partial<MountRowLike> = {}): MountRowLike => ({ kind: MOUNT_KIND.horse, x: 0, y: 0, z: 0, facing: 0, speed: 0, rider: "", hitch: "", coat: 4, phase: MOUNT_PHASE.loose, hp: 100, cargo: 0, ...over });
const rows = (m: Record<string, MountRowLike>) => ({ forEach: (cb: (r: MountRowLike, id: string) => void) => Object.entries(m).forEach(([id, r]) => cb(r, id)) });
const none = (): undefined => undefined;
const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => o instanceof Mesh && out.push(o));
  return out;
};
const run = (v: MountView, m: Record<string, MountRowLike>, riders: (s: string) => RiderPoseLike | undefined, frames = 1, dt = 1 / 30): void => {
  for (let i = 0; i < frames; i++) v.update(dt, rows(m), riders);
};

describe("MountView", () => {
  it("builds a rig per row, frees it when the row goes, and frees everything on dispose", () => {
    const scene = new Scene();
    const v = new MountView(scene);
    const m = { h1: row({ x: 3 }), w1: row({ kind: MOUNT_KIND.wagon, x: 10, cargo: 2 }) };
    run(v, m, none);
    expect(v.horseCount).toBe(1);
    expect(v.wagonCount).toBe(1);
    expect(scene.children).toHaveLength(2);
    const geos = new Set<BufferGeometry>();
    for (const c of scene.children) for (const mesh of meshes(c)) geos.add(mesh.geometry);
    let disposed = 0;
    for (const g of geos) g.addEventListener("dispose", () => disposed++);
    delete (m as Record<string, unknown>).h1;
    run(v, m, none);
    expect(v.horseCount).toBe(0);
    expect(scene.children).toHaveLength(1);
    expect(disposed).toBeGreaterThan(20);
    v.dispose();
    expect(scene.children).toHaveLength(0);
    expect(v.wagonCount).toBe(0);
  });

  it("an unridden horse is drawn from its row (smoothed); a ridden one from its rider's predicted state, exactly", () => {
    const scene = new Scene();
    const v = new MountView(scene);
    const m = { h1: row({ x: 0, z: 0 }) };
    run(v, m, none);
    const root = scene.children[0]!;
    m.h1.x = 4;
    run(v, m, none, 1);
    expect(root.position.x).toBeGreaterThan(0);
    expect(root.position.x).toBeLessThan(4); // eased, not snapped
    run(v, m, none, 60);
    expect(root.position.x).toBeCloseTo(4, 2);
    // ridden: the rider's body places it, whatever the row says
    m.h1.rider = "me";
    m.h1.x = 99;
    const pose: RiderPoseLike = { x: 7, y: 0.3, z: -5, facing: 0.8, vx: 0, vz: -9, flags: FLAG.GROUNDED | MOUNT_FLAG.MOUNTED };
    run(v, m, (s) => (s === "me" ? pose : undefined));
    expect(root.position.x).toBe(7);
    expect(root.position.y).toBe(0.3);
    expect(root.position.z).toBe(-5);
    expect(root.rotation.y).toBeCloseTo(0.8, 9);
    // and it follows every frame (a picture of the rider: no lag)
    pose.x = 8.5;
    run(v, m, (s) => (s === "me" ? pose : undefined));
    expect(root.position.x).toBe(8.5);
  });

  it("gives a rider exactly what the animator wants, and nobody else", () => {
    const scene = new Scene();
    const v = new MountView(scene);
    const m = { h1: row({ rider: "me" }) };
    const pose: RiderPoseLike = { x: 0, y: 0, z: 0, facing: 0, vx: 0, vz: -10.5, flags: FLAG.GROUNDED | MOUNT_FLAG.MOUNTED };
    run(v, m, (s) => (s === "me" ? pose : undefined), 40);
    const ride = v.rideInput("me")!;
    expect(ride).toBeDefined();
    expect(ride.speed01).toBeCloseTo(1, 1);
    expect(ride.scale).toBeGreaterThan(0.9);
    expect(Number.isFinite(ride.bob + ride.pitch + ride.roll)).toBe(true);
    expect(v.rideInput("someone else")).toBeUndefined();
    expect(v.horseOf("me")).toBeDefined();
    // a row naming a rider the view cannot find draws as a loose horse and gives nobody a seat
    run(v, { h1: row({ rider: "ghost" }) }, none);
    expect(v.rideInput("ghost")).toBeUndefined();
  });

  it("wagon wheels turn with the distance travelled; cargo crates follow the row; a wreck lists", () => {
    const scene = new Scene();
    const v = new MountView(scene);
    const m = { w1: row({ kind: MOUNT_KIND.wagon, x: 0, z: 0, cargo: 0 }) };
    run(v, m, none);
    const root = scene.children[0]!;
    const wheel = root.getObjectByName("wheelL")!;
    const before = wheel.rotation.x;
    for (let i = 0; i < 90; i++) {
      m.w1.z -= 0.2; // north, the way the wagon faces
      run(v, m, none);
    }
    expect(Math.abs(wheel.rotation.x - before)).toBeGreaterThan(5); // 18 m of road is ~5 revolutions
    const crates = () => [0, 1, 2, 3].filter((i) => root.getObjectByName(`crate${i}`)!.visible).length;
    expect(crates()).toBe(0);
    m.w1.cargo = 3;
    run(v, m, none);
    expect(crates()).toBe(3);
    m.w1.phase = MOUNT_PHASE.wrecked;
    m.w1.hp = 1;
    run(v, m, none, 120);
    expect(root.rotation.z).toBeGreaterThan(0.3);
    // a downed body strapped on is lifted to the rack; a wrecked wagon does not carry it
    expect(v.bodyLift("wagon:w1")).toBe(0);
    m.w1.phase = MOUNT_PHASE.loose;
    run(v, m, none);
    expect(v.bodyLift("wagon:w1")).toBe(WAGON.rack);
    expect(v.bodyLift("p1")).toBe(0);
    expect(v.bodyLift("wagon:nope")).toBe(0);
    expect(v.bodyLift(undefined)).toBe(0);
  });

  it("rebuilds a horse that changes coat or gains a harness, and survives hostile rows without a single NaN transform", () => {
    const scene = new Scene();
    const v = new MountView(scene);
    const m: Record<string, MountRowLike> = { h1: row() };
    run(v, m, none);
    const first = scene.children[0]!;
    m.h1!.hitch = "w1";
    run(v, m, none);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).not.toBe(first); // a collar instead of a saddle: a new rig
    m.h2 = row({ x: NaN });
    m.h3 = row({ kind: MOUNT_KIND.wagon, z: Infinity });
    m.h4 = row({ facing: NaN, speed: NaN });
    run(v, m, none, 3);
    expect(scene.children).toHaveLength(1);
    for (const c of scene.children) {
      c.updateMatrixWorld(true);
      for (const mesh of meshes(c)) for (const e of mesh.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true);
    }
    // a huge or zero dt does nothing bad
    v.update(0, rows(m), none);
    v.update(NaN, rows(m), none);
    v.update(50, rows(m), none);
    expect(scene.children[0]!.position.x).toBeCloseTo(0, 5);
  });

  it("every horse in a herd stays inside the draw budget", () => {
    const scene = new Scene();
    const v = new MountView(scene);
    const m: Record<string, MountRowLike> = {};
    for (let i = 0; i < 6; i++) m[`h${i}`] = row({ x: i * 3, coat: 100 + i });
    m.w1 = row({ kind: MOUNT_KIND.wagon, x: -10, cargo: 4 });
    run(v, m, none);
    let draws = 0;
    for (const c of scene.children) for (const mesh of meshes(c)) if (mesh.visible) draws++;
    expect(draws).toBeLessThan(6 * 34 + 24);
  });
});

const me = (over: Partial<PromptMe> = {}): PromptMe => ({ x: 0, z: 0, facing: 0, flags: FLAG.GROUNDED, missing: 0, sessionId: "me", holding: false, ...over });
const zero = { props: () => 0, bodies: () => 0 };
const L = (m: Record<string, MountRowLike>) => Object.entries(m);

describe("mountPrompt (the same rules, in the same order, as the server)", () => {
  it("mount, dismount, hitch, unhitch", () => {
    expect(mountPrompt(me(), L({ h: row({ x: 1.5 }) }), zero)).toBe(MOUNT_PROMPTS.mount);
    expect(mountPrompt(me(), L({ h: row({ x: 5 }) }), zero)).toBeUndefined();
    expect(mountPrompt(me(), L({ h: row({ x: 1.5, rider: "other" }) }), zero)).toBeUndefined();
    const on = me({ flags: FLAG.GROUNDED | MOUNT_FLAG.MOUNTED });
    expect(mountPrompt(on, L({ h: row({ rider: "me" }) }), zero)).toBe(MOUNT_PROMPTS.dismount);
    expect(mountPrompt(on, L({ h: row({ rider: "me", hitch: "w" }) }), zero)).toBe(MOUNT_PROMPTS.unhitch);
    // beside a free tongue: the wagon's tongue is `len` ahead of its axle; the horse's collar is behind the horse
    const wagon = row({ kind: MOUNT_KIND.wagon, x: 0, z: 2.6 + 1.4 });
    expect(mountPrompt(on, L({ h: row({ rider: "me" }), w: wagon }), zero)).toBe(MOUNT_PROMPTS.hitch);
    expect(mountPrompt(on, L({ h: row({ rider: "me" }), w: { ...wagon, hitch: "other" } }), zero)).toBe(MOUNT_PROMPTS.dismount);
  });

  it("refuses to promise what the server would refuse: busy hands, no arms, downed, dragged", () => {
    const h = L({ h: row({ x: 1.5 }) });
    expect(mountPrompt(me({ flags: FLAG.GROUNDED | FLAG.CARRYING }), h, zero)).toBeUndefined();
    expect(mountPrompt(me({ missing: 3 }), h, zero)).toBeUndefined();
    expect(mountPrompt(me({ flags: FLAG.DOWNED }), h, zero)).toBeUndefined();
    expect(mountPrompt(me({ flags: FLAG.DOWNED | FLAG.DRAGGED }), h, zero)).toBeUndefined();
    expect(mountPrompt(me({ missing: 1 }), h, zero)).toBe(MOUNT_PROMPTS.mount); // one arm is enough for reins
  });

  it("load, full, load a body, unload", () => {
    const w = row({ kind: MOUNT_KIND.wagon, x: 1.8, cargo: 1 });
    expect(mountPrompt(me({ holding: true }), L({ w }), zero)).toBe(MOUNT_PROMPTS.load);
    expect(mountPrompt(me({ holding: true }), L({ w }), { props: () => 3, bodies: () => 0 })).toBe(MOUNT_PROMPTS.full);
    expect(mountPrompt(me({ holding: true }), L({ w: { ...w, x: 30 } }), zero)).toBeUndefined();
    expect(mountPrompt(me({ flags: FLAG.GROUNDED | FLAG.DRAGGING }), L({ w }), zero)).toBe(MOUNT_PROMPTS.loadBody);
    expect(mountPrompt(me({ flags: FLAG.GROUNDED | FLAG.DRAGGING }), L({ w }), { props: () => 0, bodies: () => 2 })).toBe(MOUNT_PROMPTS.full);
    expect(mountPrompt(me(), L({ w }), { props: () => 1, bodies: () => 0 })).toBe(MOUNT_PROMPTS.unload);
    expect(mountPrompt(me(), L({ w: { ...w, phase: MOUNT_PHASE.wrecked } }), { props: () => 1, bodies: () => 0 })).toBeUndefined();
  });

  it("every prompt is a plain short line", () => {
    for (const t of Object.values(MOUNT_PROMPTS)) {
      expect(t.length).toBeGreaterThan(4);
      expect(t.length).toBeLessThan(60);
    }
    expect(MOUNT.reach).toBeGreaterThan(2);
  });
});

describe("mounted camera", () => {
  it("is zero on foot, pulls back and up when mounted and more at a gallop, and never overshoots", () => {
    const t = newMountedCamera();
    expect(mountedCameraTarget(false, 1, t)).toEqual({ pull: 0, rise: 0, fov: 0 });
    const rest = { ...mountedCameraTarget(true, 0, t) };
    const gallop = { ...mountedCameraTarget(true, 1, t) };
    expect(rest.pull).toBe(MOUNTED_CAMERA.pull);
    expect(gallop.pull).toBeGreaterThan(rest.pull);
    expect(gallop.fov).toBeGreaterThan(rest.fov);
    expect(mountedCameraTarget(true, NaN, t).pull).toBe(MOUNTED_CAMERA.pull);
    expect(mountedCameraTarget(true, 99, t).pull).toBe(gallop.pull);
    const s = newMountedCamera();
    let last = 0;
    for (let i = 0; i < 300; i++) {
      easeMountedCamera(s, 1 / 30, true, 1);
      expect(s.pull).toBeGreaterThanOrEqual(last);
      expect(s.pull).toBeLessThanOrEqual(gallop.pull + 1e-9);
      last = s.pull;
    }
    expect(s.pull).toBeCloseTo(gallop.pull, 2);
    for (let i = 0; i < 300; i++) easeMountedCamera(s, 1 / 30, false, 0);
    expect(s.pull).toBeCloseTo(0, 2);
    const before = { ...s };
    easeMountedCamera(s, NaN, true, 1);
    easeMountedCamera(s, -1, true, 1);
    expect(s).toEqual(before);
  });
});
