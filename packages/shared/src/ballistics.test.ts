import { describe, expect, it } from "vitest";
import {
  SURFACE,
  blastDistance,
  bodyCentre,
  meleeFan,
  newBodyHit,
  newWorldHit,
  rayBody,
  rayEllipsoid,
  rayWorld,
  stepBallistic,
  surfaceOfTag,
  type Ballistic,
  type BodyPose,
} from "./ballistics.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";
import { createArena } from "./arena.ts";
import { FLAG } from "./constants.ts";
import { Rng } from "./rng.ts";
import { ZONE } from "./wounds.ts";

const stand = (over: Partial<BodyPose> = {}): BodyPose => ({ x: 0, y: 0, z: 0, facing: 0, flags: FLAG.GROUNDED, ...over });
const hit = newBodyHit();
/** A ray from (ox,oy,oz) at the point (tx,ty,tz), unit direction, 50 m. */
const at = (pose: BodyPose, o: [number, number, number], t: [number, number, number], inflate = 0, maxT = 50): boolean => {
  const dx = t[0] - o[0];
  const dy = t[1] - o[1];
  const dz = t[2] - o[2];
  const l = Math.hypot(dx, dy, dz);
  return rayBody(pose, o[0], o[1], o[2], dx / l, dy / l, dz / l, maxT, inflate, hit);
};

describe("rayEllipsoid", () => {
  it("hits a sphere head-on at the near surface, misses when wide, starts inside as t = 0, and ignores things behind", () => {
    expect(rayEllipsoid(0, 0, -5, 0, 0, 1, 0, 0, 0, 1, 1, 1)).toBeCloseTo(4, 9);
    expect(rayEllipsoid(0, 1.5, -5, 0, 0, 1, 0, 0, 0, 1, 1, 1)).toBe(-1);
    expect(rayEllipsoid(0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1)).toBe(0);
    expect(rayEllipsoid(0, 0, 5, 0, 0, 1, 0, 0, 0, 1, 1, 1)).toBe(-1);
    expect(rayEllipsoid(0, 0, -5, 0, 0, 0, 0, 0, 0, 1, 1, 1)).toBe(-1); // a zero direction never hits
  });
  it("respects the radii of a squashed ellipsoid", () => {
    expect(rayEllipsoid(0, 0.9, -5, 0, 0, 1, 0, 0, 0, 1, 0.5, 1)).toBe(-1);
    expect(rayEllipsoid(0, 0.45, -5, 0, 0, 1, 0, 0, 0, 1, 0.5, 1)).toBeGreaterThan(0);
  });
});

describe("rayBody: zones as stacked ellipsoids on the capsule", () => {
  it("shooting at the head, chest and shin from the front lands in head, torso and leg", () => {
    expect(at(stand(), [0, 1.62, -8], [0, 1.62, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.HEAD);
    expect(at(stand(), [0, 1.15, -8], [0, 1.15, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.TORSO);
    expect(at(stand(), [0.13, 0.3, -8], [0.13, 0.3, 0])).toBe(true);
    expect([ZONE.LEG_R]).toContain(hit.zone);
    expect(at(stand(), [-0.13, 0.3, -8], [-0.13, 0.3, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.LEG_L);
  });

  it("the hit point lies on the surface the ray entered, at the reported distance", () => {
    expect(at(stand(), [0, 1.14, -8], [0, 1.14, 0])).toBe(true);
    expect(hit.t).toBeCloseTo(8 - 0.21, 6); // torso half depth 0.21
    expect(hit.z).toBeCloseTo(-0.21, 6);
    expect(hit.x).toBeCloseTo(0, 9);
  });

  it("from the side the arms are hit first: right of a character facing -Z is +X, and it follows the heading", () => {
    expect(at(stand(), [8, 1.1, 0], [0, 1.1, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.ARM_R);
    expect(at(stand(), [-8, 1.1, 0], [0, 1.1, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.ARM_L);
    // turned a quarter (facing -X): their right hand is toward -Z
    const quarter = stand({ facing: Math.PI / 2 });
    expect(at(quarter, [0, 1.1, -8], [0, 1.1, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.ARM_R);
    expect(at(quarter, [0, 1.1, 8], [0, 1.1, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.ARM_L);
  });

  it("misses over the head, under the feet, beside the shoulder and beyond max range", () => {
    expect(at(stand(), [0, 2.2, -8], [0, 2.2, 0])).toBe(false);
    expect(at(stand(), [0, -0.3, -8], [0, -0.3, 0])).toBe(false);
    expect(at(stand(), [0.8, 1.1, -8], [0.8, 1.1, 0])).toBe(false);
    expect(at(stand(), [0, 1.15, -8], [0, 1.15, 0], 0, 7)).toBe(false);
    expect(at(stand(), [0, 1.15, -8], [0, 1.15, 0], 0, 8)).toBe(true);
    // pointing away
    expect(rayBody(stand(), 0, 1.15, -8, 0, 0, -1, 50, 0, hit)).toBe(false);
  });

  it("a wider ball catches a graze a needle misses", () => {
    expect(at(stand(), [0.36, 1.1, -8], [0.36, 1.1, 0])).toBe(true); // the arm is there
    expect(at(stand(), [0.56, 1.1, -8], [0.56, 1.1, 0], 0)).toBe(false);
    expect(at(stand(), [0.56, 1.1, -8], [0.56, 1.1, 0], 0.1)).toBe(true);
  });

  it("crouching lowers the target: a shot at standing head height flies over, one at the crouched chest hits", () => {
    const crouch = stand({ flags: FLAG.GROUNDED | FLAG.CROUCHING });
    expect(at(crouch, [0, 1.6, -8], [0, 1.6, 0])).toBe(false);
    expect(at(crouch, [0, 0.8, -8], [0, 0.8, 0])).toBe(true);
    expect(hit.zone).toBe(ZONE.TORSO);
    expect(at(crouch, [0, 1.0, -8], [0, 1.0, 0])).toBe(true);
  });

  it("a downed body lies on its back: head behind the feet, a standing-height shot flies over, a shot from above finds the head", () => {
    const down = stand({ flags: FLAG.GROUNDED | FLAG.DOWNED });
    expect(at(down, [0, 1.6, -8], [0, 1.6, 0])).toBe(false);
    // head end is behind them (+Z when facing -Z) about 1.6 m from the feet
    expect(rayBody(down, 0, 4, 1.58, 0, -1, 0, 10, 0, hit)).toBe(true);
    expect(hit.zone).toBe(ZONE.HEAD);
    expect(rayBody(down, 0.13, 4, 0.5, 0, -1, 0, 10, 0, hit)).toBe(true);
    expect([ZONE.LEG_L, ZONE.LEG_R, ZONE.TORSO]).toContain(hit.zone);
    // a low grazing shot along the ground level hits the lying body
    expect(at(down, [0, 0.35, 8], [0, 0.35, 0.8])).toBe(true);
  });

  it("every ray aimed at the chest from random directions and distances hits (no holes in the middle), and none aimed 1.5 m wide do", () => {
    const rng = new Rng(4242);
    let holes = 0;
    for (let i = 0; i < 3000; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(2, 60);
      const h = rng.range(0.4, 3);
      const facing = rng.range(-Math.PI, Math.PI);
      const pose = stand({ facing, x: rng.range(-30, 30), z: rng.range(-30, 30), y: rng.range(0, 3) });
      const o: [number, number, number] = [pose.x + Math.cos(a) * d, pose.y + h, pose.z + Math.sin(a) * d];
      if (!at(pose, o, [pose.x, pose.y + 1.14, pose.z], 0, 200)) holes++;
      // aimed 1.5 m to the side of the axis: always a miss
      const off = 1.5;
      const px = -Math.sin(a) * off;
      const pz = Math.cos(a) * off;
      expect(at(pose, o, [pose.x + px, pose.y + 1.14, pose.z + pz], 0, 200), "wide shot must miss").toBe(false);
    }
    expect(holes).toBe(0);
  });

  it("is deterministic and leaves the caller's numbers alone", () => {
    const p = stand({ x: 3, z: -2, facing: 0.7 });
    const a = rayBody(p, 3, 1.2, 4, 0, 0, -1, 20, 0, newBodyHit());
    const h1 = newBodyHit();
    const h2 = newBodyHit();
    rayBody(p, 3, 1.2, 4, 0, 0, -1, 20, 0, h1);
    rayBody(p, 3, 1.2, 4, 0, 0, -1, 20, 0, h2);
    expect(a).toBe(true);
    expect(h1).toEqual(h2);
    expect(p).toEqual(stand({ x: 3, z: -2, facing: 0.7 }));
  });
});

describe("ballistic stepping", () => {
  const fresh = (): Ballistic => ({ x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: -100 });

  it("gravity bends the path down: after one second a ball has dropped about g/2 (semi-implicit Euler at 30 Hz is within 2%)", () => {
    const b = fresh();
    for (let i = 0; i < 30; i++) stepBallistic(b, 1 / 30, 9.81);
    expect(b.z).toBeCloseTo(-100, 6);
    expect(2 - b.y).toBeGreaterThan(0.5 * 9.81 * 0.98);
    expect(2 - b.y).toBeLessThan(0.5 * 9.81 * 1.06);
  });

  it("no gravity and no drag is a straight line at constant speed", () => {
    const b = fresh();
    for (let i = 0; i < 10; i++) stepBallistic(b, 1 / 30, 0);
    expect(b.y).toBe(2);
    expect(b.vz).toBe(-100);
    expect(b.z).toBeCloseTo(-100 / 3, 9);
  });

  it("drag only ever slows a ball, and identical inputs give identical paths", () => {
    const a = fresh();
    const b = fresh();
    const c = fresh();
    for (let i = 0; i < 20; i++) {
      stepBallistic(a, 1 / 30, 9.81, 0.4);
      stepBallistic(b, 1 / 30, 9.81, 0.4);
      stepBallistic(c, 1 / 30, 9.81, 0);
    }
    expect(a).toEqual(b);
    expect(Math.hypot(a.vx, a.vy, a.vz)).toBeLessThan(Math.hypot(c.vx, c.vy, c.vz));
    expect(a.z).toBeGreaterThan(c.z);
  });
});

describe("rays against the static world", () => {
  const flat = (obstacles: Obstacle[] = []): CollisionWorld => new CollisionWorld({ height: () => 0 }, obstacles, 200);
  const out = newWorldHit();

  it("hits flat ground at the right distance with an upward normal; misses when aimed at the sky or too short", () => {
    const w = flat();
    const d = { x: 0, y: -0.5, z: -Math.sqrt(0.75) };
    expect(rayWorld(w, 0, 1.5, 0, d.x, d.y, d.z, 100, out)).toBe(true);
    expect(out.t).toBeCloseTo(3, 3); // 1.5 / 0.5
    expect(out.ny).toBeCloseTo(1, 3);
    expect(out.surface).toBe(SURFACE.EARTH);
    expect(rayWorld(w, 0, 1.5, 0, 0, 0.6, -0.8, 500, out)).toBe(false);
    expect(rayWorld(w, 0, 1.5, 0, d.x, d.y, d.z, 2.9, out)).toBe(false);
  });

  it("follows the real terrain: a ray skimming a hill stops on its slope", () => {
    const w = new CollisionWorld({ height: (x) => Math.max(0, x * 0.2) }, [], 200); // a ramp rising along +x
    expect(rayWorld(w, 0, 1, 0, 1, 0, 0, 100, out)).toBe(true);
    expect(out.t).toBeCloseTo(1 / 0.2, 1);
    expect(out.nx).toBeLessThan(0); // the slope faces back toward the shooter
  });

  it("a circle obstacle stops a ray at its near face with a radial normal and the surface of its tag; over the top passes", () => {
    const w = flat([{ kind: "circle", tag: "tree", x: 0, z: -10, r: 0.5, y0: -1, y1: 6 }]);
    expect(rayWorld(w, 0, 1.5, 0, 0, 0, -1, 50, out)).toBe(true);
    expect(out.t).toBeCloseTo(9.5, 6);
    expect(out.nz).toBeCloseTo(1, 6);
    expect(out.surface).toBe(SURFACE.WOOD);
    expect(rayWorld(w, 0, 7, 0, 0, 0, -1, 50, out)).toBe(false);
    expect(rayWorld(w, 0.6, 1.5, 0, 0, 0, -1, 50, out)).toBe(false); // just wide
    // from above: lands on the top cap
    expect(rayWorld(w, 0, 9, -10, 0, -1, 0, 50, out)).toBe(true);
    expect(out.t).toBeCloseTo(3, 6);
    expect(out.ny).toBeCloseTo(1, 6);
  });

  it("an oriented box respects its yaw; stone for a wall, cloth for a tent", () => {
    const w = flat([{ kind: "box", tag: "wall", x: 0, z: -10, hx: 6, hz: 0.4, yaw: 0, y0: -1, y1: 2.2 }, { kind: "box", tag: "tent", x: 20, z: 0, hx: 2, hz: 1, yaw: Math.PI / 2, y0: -1, y1: 2 }]);
    expect(rayWorld(w, 0, 1.5, 0, 0, 0, -1, 50, out)).toBe(true);
    expect(out.t).toBeCloseTo(9.6, 6);
    expect(out.surface).toBe(SURFACE.STONE);
    // tent: hx=2 along its local x, which yaw pi/2 turns to the world z axis; so from +x we see the hz=1 face at x = 20-1
    expect(rayWorld(w, 0, 1.5, 0, 1, 0, 0, 50, out)).toBe(true);
    expect(out.t).toBeCloseTo(19, 6);
    expect(out.surface).toBe(SURFACE.CLOTH);
    expect(out.nx).toBeCloseTo(-1, 6);
    // over the wall
    expect(rayWorld(w, 0, 3, 0, 0, 0, -1, 50, out)).toBe(false);
  });

  it("returns the nearest of several, across grid cells, however the ray is pointed", () => {
    const w = flat([
      { kind: "circle", tag: "rock", x: 40, z: 0, r: 1, y0: -1, y1: 3 },
      { kind: "circle", tag: "tree", x: 25, z: 0.2, r: 0.4, y0: -1, y1: 6 },
      { kind: "circle", tag: "rock", x: 10, z: 30, r: 1, y0: -1, y1: 3 },
    ]);
    expect(rayWorld(w, 0, 1.5, 0, 1, 0, 0, 200, out)).toBe(true);
    expect(out.t).toBeCloseTo(24.6 + 0.0, 0); // the tree, not the rock behind it
    expect(out.surface).toBe(SURFACE.WOOD);
    // diagonal through several cells at the rock at (10, 30)
    const l = Math.hypot(10, 30);
    expect(rayWorld(w, 0, 1.5, 0, 10 / l, 0, 30 / l, 100, out)).toBe(true);
    expect(out.t).toBeCloseTo(l - 1, 1);
    // a ray pointing straight down through a circle's footprint from above lands on it
    expect(rayWorld(w, 40, 10, 0, 0, -1, 0, 50, out)).toBe(true);
    expect(out.t).toBeCloseTo(7, 6);
  });

  it("a shot from inside a solid stops at once; a vertical ray is fine", () => {
    const w = flat([{ kind: "circle", tag: "rock", x: 0, z: 0, r: 2, y0: -1, y1: 3 }]);
    expect(rayWorld(w, 0, 1, 0, 0, 0, -1, 50, out)).toBe(true);
    expect(out.t).toBe(0);
    expect(rayWorld(w, 5, 1, 5, 0, 1, 0, 50, out)).toBe(false);
  });

  it("the real arena: the camp wall stops a shot north from the spawn; the ruin walls are stone; every tag maps to a surface", () => {
    const w = createArena(3);
    expect(rayWorld(w, 0, 1.5, 0, 0, 0, -1, 100, out)).toBe(true);
    expect(out.t).toBeGreaterThan(8);
    expect(out.t).toBeLessThan(12);
    expect(out.surface).toBe(SURFACE.STONE);
    for (const o of w.obstacles) expect(surfaceOfTag(o.tag)).toBeGreaterThanOrEqual(0);
    expect(surfaceOfTag(undefined)).toBe(SURFACE.STONE);
    expect(surfaceOfTag("no-such-tag")).toBe(SURFACE.STONE);
  });

  it("agrees with brute-force sampling on the real arena for many random rays", () => {
    const w = createArena(11);
    const rng = new Rng(9);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const ox = rng.range(-40, 40);
      const oz = rng.range(-40, 40);
      const oy = w.terrainHeight(ox, oz) + 1.5;
      const yaw = rng.range(0, Math.PI * 2);
      const el = rng.range(-0.25, 0.1);
      const dx = -Math.sin(yaw) * Math.cos(el);
      const dy = Math.sin(el);
      const dz = -Math.cos(yaw) * Math.cos(el);
      const got = rayWorld(w, ox, oy, oz, dx, dy, dz, 80, out);
      // brute force: walk in 2 cm steps and look for the first sample inside an obstacle or under the ground
      let ref = -1;
      for (let t = 0.02; t <= 80; t += 0.02) {
        const x = ox + dx * t;
        const y = oy + dy * t;
        const z = oz + dz * t;
        if (y < w.terrainHeight(x, z)) {
          ref = t;
          break;
        }
        let inside = false;
        w.forEachNear(x, z, (o) => {
          if (y < o.y0 || y > o.y1) return;
          if (o.kind === "circle" ? Math.hypot(x - o.x, z - o.z) <= o.r : Math.abs((x - o.x) * Math.cos(o.yaw) + (z - o.z) * Math.sin(o.yaw)) <= o.hx && Math.abs(-(x - o.x) * Math.sin(o.yaw) + (z - o.z) * Math.cos(o.yaw)) <= o.hz) inside = true;
        });
        if (inside) {
          ref = t;
          break;
        }
      }
      if (ref < 0) expect(got, `ray ${i}`).toBe(false);
      else {
        expect(got, `ray ${i}`).toBe(true);
        expect(Math.abs(out.t - ref), `ray ${i}`).toBeLessThan(0.08);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe("explosions and melee geometry", () => {
  it("blast distance: zero inside the body, grows with range, measured to the nearest part (chest line minus girth)", () => {
    const p = stand();
    expect(blastDistance(p, 0, 1, 0)).toBe(0);
    expect(blastDistance(p, 3, 1, 0)).toBeCloseTo(3 - 0.28, 9);
    expect(blastDistance(p, 0, 5, 0)).toBeCloseTo(5 - 1.55 - 0.28, 9);
    const lying = stand({ flags: FLAG.DOWNED });
    expect(blastDistance(lying, 2, 0.3, 0)).toBeCloseTo(1.5, 9);
  });

  it("bodyCentre is the chest standing, lower crouched, and near the ground when downed", () => {
    const c = { x: 0, y: 0, z: 0 };
    bodyCentre(stand(), c);
    expect(c.y).toBeCloseTo(1.1, 9);
    bodyCentre(stand({ flags: FLAG.CROUCHING }), c);
    expect(c.y).toBeLessThan(0.8);
    bodyCentre(stand({ flags: FLAG.DOWNED }), c);
    expect(c.y).toBeLessThan(0.5);
  });

  it("a swing fan reaches someone 1.5 m ahead, even a little off to one side, but not behind, not beyond reach, not far off the arc", () => {
    const at2 = (x: number, z: number, reach = 1.9, arc = 0.8, yaw = 0): boolean => meleeFan(stand({ x, z }), 0, 1.2, 0, yaw, 0, reach, arc, 0.08, hit);
    expect(at2(0, -1.5)).toBe(true);
    expect(at2(0.7, -1.4)).toBe(true); // ~27 degrees off
    expect(at2(0, 1.5)).toBe(false); // behind
    expect(at2(0, -3.2)).toBe(false); // out of reach
    expect(at2(1.9, -0.3)).toBe(false); // almost at right angles
    expect(at2(0, -2.0, 1.4)).toBe(false); // a shorter weapon
    // turning the swing turns the arc
    expect(at2(-1.5, 0, 1.9, 0.8, Math.PI / 2)).toBe(true);
  });

  it("a low swing catches legs and a high one the head", () => {
    meleeFan(stand({ z: -1.4 }), 0, 1.2, 0, 0, -0.5, 1.9, 0.6, 0.08, hit);
    expect([ZONE.LEG_L, ZONE.LEG_R, ZONE.TORSO]).toContain(hit.zone);
    expect(meleeFan(stand({ z: -1.4 }), 0, 1.2, 0, 0, 0.2, 1.9, 0.3, 0.08, hit)).toBe(true);
    expect(hit.t).toBeGreaterThan(0.5);
  });
});
