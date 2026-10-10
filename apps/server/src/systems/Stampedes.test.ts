import { describe, expect, it } from "vitest";
import { CollisionWorld, FLAG, STAMPEDE, decodeHerdRuns, herdAnimalAt, herdPlan, type HerdRun, type PlayerStateType } from "@cb/shared";
import { Stampedes } from "./Stampedes.ts";

/** D-114: the herds run from reports and fire, as far as the way is open, and trample whoever is in the way, credited to whoever set them running. */
function rig(o: { water?: (x: number, z: number) => number } = {}) {
  const terrain = { height: () => 0, waterDepth: o.water };
  const world = new CollisionWorld(terrain, [], 400);
  const rows = new Map<string, PlayerStateType>();
  const struck: { by: string; key: string; speed: number }[] = [];
  let published = "";
  let now = 100;
  let fire: { x: number; z: number } | undefined;
  const s = new Stampedes({
    players: { forEach: (cb) => rows.forEach((p, k) => cb(p, k)) },
    world: () => world,
    nowSec: () => now,
    trample: (by, key, speed) => void struck.push({ by, key, speed }),
    publish: (e) => void (published = e),
    fireNear: (x, z, r, out) => {
      if (!fire || Math.hypot(fire.x - x, fire.z - z) > r) return false;
      out.x = fire.x;
      out.z = fire.z;
      return true;
    },
  });
  const plan = herdPlan(7);
  s.begin(plan);
  const centre = (k: number): { x: number; z: number } => {
    let first = 0;
    for (let q = 0; q < k; q++) first += plan.herds[q]!.n;
    const a = { x: 0, z: 0, yaw: 0, speed: 0 };
    let x = 0, z = 0;
    for (let i = first; i < first + plan.herds[k]!.n; i++) {
      herdAnimalAt(plan, i, now, s.current, a);
      x += a.x;
      z += a.z;
    }
    return { x: x / plan.herds[k]!.n, z: z / plan.herds[k]!.n };
  };
  const advance = (sec: number): void => {
    for (let t = 0; t < sec; t += 0.05) {
      now += 0.05;
      s.tick();
    }
  };
  return { s, rows, struck, plan, centre, advance, pub: () => published, setFire: (f: { x: number; z: number }) => void (fire = f), now: () => now };
}

describe("D-114: the stampede", () => {
  it("a report near a herd sets it running away from it, published for the clients; a far one, or one during its rest, does not", () => {
    const r = rig();
    const c = r.centre(0);
    r.s.onNoise(c.x + 200, c.z, 80, "ada"); // (too far)
    expect(r.s.current[0]).toBeUndefined();
    r.s.onNoise(c.x - 20, c.z, 60, "ada"); // (20 m west of it)
    const run = r.s.current[0]!;
    expect(run.fx).toBeGreaterThan(0.95); // (it runs east)
    expect(run.dist).toBe(STAMPEDE.maxRun - (STAMPEDE.maxRun % 3)); // (open grass: as far as it ever runs)
    expect(decodeHerdRuns(r.pub(), r.plan.herds.length)[0]).toMatchObject({ k: 0, fx: run.fx });
    r.s.onNoise(c.x + 20, c.z, 60, "bram"); // (a second report while it runs: it keeps going)
    expect(r.s.current[0]).toBe(run);
  });

  it("whoever stands in its way is ridden down once, credited to the one who set it running; the downed and the riders are not", () => {
    const r = rig();
    const c = r.centre(0);
    const row = (x: number, z: number, flags: number = FLAG.GROUNDED): PlayerStateType => ({ x, y: 0, z, flags, npc: 1 }) as PlayerStateType;
    r.rows.set("npc:s1", row(c.x + 20, c.z));
    r.rows.set("npc:down", row(c.x + 21, c.z + 0.5, FLAG.DOWNED));
    r.rows.set("npc:rider", row(c.x + 21, c.z - 0.5, FLAG.GROUNDED | FLAG.MOUNTED));
    r.s.onNoise(c.x - 20, c.z, 60, "ada");
    r.advance(8);
    const s1 = r.struck.filter((x) => x.key === "npc:s1");
    expect(s1.length).toBeGreaterThanOrEqual(1);
    expect(s1.every((x) => x.by === "ada")).toBe(true);
    expect(r.struck.some((x) => x.key === "npc:down" || x.key === "npc:rider")).toBe(false);
    // (one herd running past is a few animals, each spaced by the cooldown, never a hit every tick)
    expect(s1.length).toBeLessThanOrEqual(Math.ceil(8 / STAMPEDE.cooldownS));
  });

  it("water stops it short or turns it; burning grass beside it sets it running too, nobody's hand", () => {
    const wet = rig({ water: (x) => (x > 0 ? 1 : 0) }); // (everything east of x = 0 is river)
    const c = wet.centre(0);
    wet.s.onNoise(c.x - 20, c.z, 60, "ada");
    const run: HerdRun | undefined = wet.s.current[0];
    expect(run).toBeDefined();
    expect(c.x + run!.fx * run!.dist).toBeLessThanOrEqual(0.5); // (it stops on the bank)
    expect(run!.dist).toBeLessThan(STAMPEDE.maxRun - 6);
    const hot = rig();
    const hc = hot.centre(1);
    hot.setFire({ x: hc.x, z: hc.z + 8 });
    hot.advance(1);
    expect(hot.s.current[1]).toBeDefined();
    expect(hot.s.current[1]!.fz).toBeLessThan(-0.9); // (north, away from the fire)
  });
});
