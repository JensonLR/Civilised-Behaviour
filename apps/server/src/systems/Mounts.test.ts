import { describe, expect, it } from "vitest";
import { BUTTON, CollisionWorld, FLAG, Rng, STEP_DT, setWound, ZONE, type Obstacle } from "@cb/shared";
import { BOLT_SECONDS, CARGO_POUNDS, FIRE_PANIC, MOUNT, MOUNT_CAP, MOUNT_FLAG, MOUNT_PHASE, TRAMPLE, WAGON, wagonToWorld } from "@cb/shared";
import { MountRoom, frame, type FakePlayer } from "../bots/mount.ts";
import { MOUNT_LINES } from "./Mounts.ts";

const flat = (obstacles: Obstacle[] = []) => new CollisionWorld({ height: () => 0 }, obstacles, 300);
const INTERACT = BUTTON.INTERACT;
const press = (room: MountRoom, sid: string): void => {
  room.tick({ [sid]: frame(0, 0, 0, INTERACT) });
  room.tick();
};
const run = (room: MountRoom, sid: string, seconds: number, f = 1, buttons = 0, yaw = 0): void => {
  for (let i = 0; i < Math.round(seconds / STEP_DT); i++) room.tick({ [sid]: frame(f, 0, yaw, buttons) });
};
const speedOf = (p: FakePlayer): number => Math.hypot(p.vx, p.vz);
const mounted = (p: FakePlayer): boolean => (p.flags & MOUNT_FLAG.MOUNTED) !== 0;

/** A room with one rider-to-be beside a horse (the horse a metre away, both facing north). */
function stable(opts: { wall?: boolean } = {}) {
  const world = flat(opts.wall ? [{ kind: "box", x: 0, z: -60, hx: 20, hz: 0.5, yaw: 0, y0: -1, y1: 3 }] : []);
  const room = new MountRoom(world, 7);
  const a = room.addPlayer("a", 0, 40);
  const horse = room.mounts.spawnHorse({ x: 1.2, z: 40, yaw: 0 }, { coat: 5 });
  return { world, room, a, horse };
}

describe("mounting and dismounting", () => {
  it("INTERACT mounts the nearest free horse: the horse goes to the rider, only `flags` moves on the rider", () => {
    const { room, a, horse } = stable();
    a.facing = 0.4;
    const before = { x: a.x, y: a.y, z: a.z, vx: a.vx, vz: a.vz, facing: a.facing, stumble: a.stumble };
    press(room, "a");
    expect(mounted(a)).toBe(true);
    // (+ 0: the mounted step writes -0 for a zero velocity along the facing)
    expect({ x: a.x, y: a.y, z: a.z, vx: a.vx + 0, vz: a.vz + 0, facing: a.facing, stumble: a.stumble }).toEqual(before);
    const row = room.rows.get(horse)!;
    expect(row.rider).toBe("a");
    expect(row.phase).toBe(MOUNT_PHASE.ridden);
    expect(row.x).toBe(a.x);
    expect(row.z).toBe(a.z);
    expect(row.facing).toBe(a.facing);
  });

  it("the ridden horse is a picture of the rider: it follows their state exactly, gait and all", () => {
    const { room, a, horse } = stable();
    press(room, "a");
    run(room, "a", 3, 1, BUTTON.SPRINT);
    const row = room.rows.get(horse)!;
    expect(a.z).toBeLessThan(40 - 20);
    expect(row.z).toBe(a.z);
    expect(row.x).toBe(a.x);
    expect(row.speed).toBeCloseTo(speedOf(a), 9);
    expect(speedOf(a)).toBeGreaterThan(MOUNT.trot); // a gallop, faster than any walker
    expect((a.flags & MOUNT_FLAG.GALLOPING) !== 0).toBe(true);
  });

  it("INTERACT again dismounts: a metre to the left, 40% of the speed, the horse stands where it was", () => {
    const { room, a, horse } = stable();
    press(room, "a");
    run(room, "a", 2.5);
    const px = a.x;
    const pz = a.z;
    const v = speedOf(a);
    room.tick({ a: frame(1, 0, 0, INTERACT) });
    expect(mounted(a)).toBe(false);
    expect(a.flags & MOUNT_FLAG.HITCHED).toBe(0);
    expect(Math.hypot(a.x - px, a.z - pz)).toBeCloseTo(1.0, 1);
    expect(a.x).toBeLessThan(px); // facing north, the left is west
    // (the dismount tick itself moves a walker; the speed it kept is 40% of the horse's, then walking limits apply)
    expect(speedOf(a)).toBeLessThan(v * 0.5 + 0.5);
    const row = room.rows.get(horse)!;
    expect(row.rider).toBe("");
    expect(row.phase).toBe(MOUNT_PHASE.loose);
    run(room, "a", 1, 0);
    expect(room.rows.get(horse)!.speed).toBe(0);
  });

  it("a dismounted rider can remount, and the dismount never puts them inside a wall", () => {
    const world = flat([{ kind: "box", x: -1.4, z: 40, hx: 0.6, hz: 3, yaw: 0, y0: -1, y1: 3 }]);
    const room = new MountRoom(world, 3);
    const a = room.addPlayer("a", 0, 40);
    room.mounts.spawnHorse({ x: 0.8, z: 40, yaw: 0 }, { coat: 1 });
    press(room, "a");
    expect(mounted(a)).toBe(true);
    press(room, "a"); // the left side is a wall: the dismount is pushed out of it
    expect(mounted(a)).toBe(false);
    const probe = { x: a.x, z: a.z };
    expect(world.resolveXZ(probe, a.y, 0.4 - 1e-3, 1.8)).toBe(false);
    press(room, "a");
    expect(mounted(a)).toBe(true);
  });
});

describe("hostile and out-of-order interaction (everything refused, nothing thrown)", () => {
  it("a horse that is ridden cannot be mounted by someone else", () => {
    const { room, a } = stable();
    const b = room.addPlayer("b", 0.4, 40.5);
    press(room, "a");
    press(room, "b");
    expect(mounted(b)).toBe(false);
    expect(mounted(a)).toBe(true);
    expect(room.notices.some((n) => n.sid === "b" && n.text === MOUNT_LINES.taken)).toBe(true);
    expect(room.damages).toHaveLength(0);
  });

  it("from 5 m, while downed, while carrying, with no arms, while dragged or kneeling: refused, flags untouched", () => {
    const { room } = stable();
    const far = room.addPlayer("far", 6.5, 40);
    press(room, "far");
    expect(mounted(far)).toBe(false);
    for (const [name, flags, missing] of [
      ["downed", FLAG.DOWNED, 0],
      ["carrying", FLAG.CARRYING, 0],
      ["noarms", 0, 3],
      ["dragged", FLAG.DOWNED | FLAG.DRAGGED, 0],
      ["reviving", FLAG.REVIVING, 0],
      ["operating", FLAG.OPERATING, 0],
    ] as const) {
      const p = room.addPlayer(name, 1.4, 40.4);
      p.flags |= flags;
      p.missing = missing;
      const before = p.flags;
      press(room, name);
      expect(mounted(p), name).toBe(false);
      expect(p.flags & ~FLAG.GROUNDED, name).toBe(before & ~FLAG.GROUNDED);
      room.players.delete(name);
    }
    expect(room.damages).toHaveLength(0);
  });

  it("loading into a full wagon is refused with a line, no throw, nothing moves", () => {
    const { room } = stable();
    const w = room.mounts.spawnWagon({ x: 10, z: 40, yaw: 0 }, { coat: 2, crates: 2 });
    const p = room.addPlayer("p", 10 + 1.9, 40);
    const crates = [0, 1, 2, 3].map((i) => room.addProp(10 + 3 + i, 40));
    // two bays are taken by the abstract cargo: two real crates fit, the third does not
    for (let i = 0; i < 3; i++) {
      room.give("p", crates[i]!);
      press(room, "p");
    }
    const cargo = room.mounts.cargoOf(w)!;
    expect(cargo.props.filter(Boolean)).toHaveLength(2);
    expect(room.held.get("p")).toBe(crates[2]!.id); // still in hand
    expect(room.notices.filter((n) => n.text === MOUNT_LINES.full)).toHaveLength(1);
    expect(room.damages).toHaveLength(0);
  });

  it("a wagon whose tongue is out of reach is not hitched: INTERACT dismounts instead", () => {
    const { room, a } = stable();
    const w = room.mounts.spawnWagon({ x: 30, z: 40, yaw: 0 }, { coat: 1, crates: 0 });
    press(room, "a");
    expect(mounted(a)).toBe(true);
    press(room, "a");
    expect(mounted(a)).toBe(false);
    expect(room.rows.get(w)!.hitch).toBe("");
  });

  it("INTERACT with nothing to do is not taken (the room goes on to props and stations)", () => {
    const { room } = stable();
    const p = room.addPlayer("p", 80, 80);
    expect(room.mounts.onInteract("p", p, undefined)).toBe(false);
    expect(room.mounts.onInteract("p", p, "999")).toBe(false);
    const empty = new MountRoom(flat(), 1);
    const q = empty.addPlayer("q", 0, 0);
    expect(empty.mounts.onInteract("q", q, undefined)).toBe(false);
  });

  it("a stale MOUNTED flag with no horse is cleared by the next INTERACT instead of trapping the player", () => {
    const { room } = stable();
    const p = room.addPlayer("p", 30, 30);
    p.flags |= MOUNT_FLAG.MOUNTED;
    expect(room.mounts.onInteract("p", p, undefined)).toBe(true);
    expect(mounted(p)).toBe(false);
  });

  it("the cap holds", () => {
    const room = new MountRoom(flat(), 1);
    const ids: string[] = [];
    for (let i = 0; i < MOUNT_CAP + 5; i++) ids.push(room.mounts.spawnHorse({ x: i * 3, z: 0, yaw: 0 }, { coat: i }));
    expect(ids.filter(Boolean)).toHaveLength(MOUNT_CAP);
    expect(room.mounts.spawnWagon({ x: 0, z: 30, yaw: 0 }, { coat: 1, crates: 1, horse: true })).toBe("");
  });
});

describe("being thrown", () => {
  it("a wall at a gallop throws: flags cleared, 0.6x velocity, a hop and a stumble, bounded damage, the horse bolts", () => {
    const { room, a, horse } = stable({ wall: true });
    press(room, "a");
    let hit = false;
    let vBefore = 0;
    for (let i = 0; i < 400 && !hit; i++) {
      vBefore = speedOf(a);
      room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
      hit = !mounted(a);
    }
    expect(hit).toBe(true);
    expect(vBefore).toBeGreaterThan(9);
    expect(a.flags & (MOUNT_FLAG.MOUNTED | MOUNT_FLAG.HITCHED | MOUNT_FLAG.GALLOPING)).toBe(0);
    expect(a.vy).toBe(MOUNT.thrown.vy);
    expect(a.stumble).toBeCloseTo(MOUNT.thrown.stumble, 5);
    expect(a.flags & FLAG.GROUNDED).toBe(0);
    const dmg = room.damages.reduce((s, d) => s + d.amount, 0);
    expect(dmg).toBeGreaterThan(0);
    expect(dmg).toBeLessThanOrEqual(18);
    expect(room.notices.some((n) => n.sid === "a")).toBe(true);
    const row = room.rows.get(horse)!;
    expect(row.rider).toBe("");
    expect(row.phase).toBe(MOUNT_PHASE.bolting);
  });

  it("a bolting horse runs four seconds, then stands, and can be mounted again", () => {
    const { room, a, horse } = stable({ wall: true });
    press(room, "a");
    for (let i = 0; i < 400 && mounted(a); i++) room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
    const row = room.rows.get(horse)!;
    const z0 = row.z;
    let seconds = 0;
    while (row.phase === MOUNT_PHASE.bolting && seconds < 8) {
      room.tick();
      seconds += STEP_DT;
    }
    expect(seconds).toBeGreaterThan(3.5);
    expect(seconds).toBeLessThan(4.5);
    expect(row.phase).toBe(MOUNT_PHASE.loose);
    expect(Math.hypot(row.z - z0, row.x)).toBeGreaterThan(5); // it ran somewhere (a wall, a turn: not on the spot)
    // the thrown rider has recovered: walk back to it and mount
    a.x = row.x + 1.2;
    a.z = row.z;
    a.stumble = 0;
    press(room, "a");
    expect(mounted(a)).toBe(true);
  });

  it("walking pace and trot nudges do not throw; the same blow can throw on one tick and not another (seeded), never randomly across replays", () => {
    const run1 = (): boolean[] => {
      const { room, a } = stable();
      press(room, "a");
      const out: boolean[] = [];
      for (let k = 0; k < 40; k++) {
        if (!mounted(a)) {
          out.push(true);
          a.flags |= MOUNT_FLAG.MOUNTED;
          const row = [...(room.rows as unknown as Map<string, { rider: string }>).values()][0]!;
          row.rider = "a";
        } else out.push(false);
        a.vx = 0;
        a.vz = -MOUNT.walk;
        room.mounts.onHurt("a", 25); // a 25-point hit: a 4 m/s shove: well under the throw threshold unless the rider is maimed
        room.tick();
      }
      return out;
    };
    const r = run1();
    expect(r).toEqual(run1()); // deterministic
    expect(r.filter(Boolean).length).toBe(0); // 25 damage at a walk is never enough
  });

  it("a heavy blow, a blast, and being put down all unseat; being put down costs no extra damage", () => {
    for (const how of ["blow", "blast", "down"] as const) {
      const { room, a } = stable();
      press(room, "a");
      run(room, "a", 1.2);
      room.damages.length = 0;
      if (how === "blow") room.mounts.onHurt("a", 90);
      else if (how === "blast") room.mounts.onBlast("a", 12);
      else room.mounts.onDown("a");
      expect(mounted(a), how).toBe(false);
      expect(a.stumble, how).toBeGreaterThan(0);
      if (how === "down") expect(room.damages).toHaveLength(0);
    }
  });

  it("grievous arms make the same shove more likely to unseat (the risk table, end to end)", () => {
    const tries = (wounds: number): number => {
      let thrown = 0;
      for (let seed = 0; seed < 300; seed++) {
        const world = flat();
        const room = new MountRoom(world, seed);
        const a = room.addPlayer("a", 0, 40);
        room.mounts.spawnHorse({ x: 1.2, z: 40, yaw: 0 }, { coat: 1 });
        press(room, "a");
        a.wounds = wounds;
        a.vz = -5;
        room.tickNo = seed * 13;
        room.mounts.onBlast("a", 0.5);
        room.mounts.onHurt("a", 33);
        if (!mounted(a)) thrown++;
      }
      return thrown;
    };
    const healthy = tries(0);
    const maimed = tries(setWound(setWound(0, ZONE.ARM_L, 3), ZONE.ARM_R, 3));
    expect(maimed).toBeGreaterThan(healthy);
  });
});

describe("D-110: horses and fire", () => {
  const ticks = (room: MountRoom, seconds: number, frames: () => Record<string, ReturnType<typeof frame>> = () => ({})): void => {
    for (let i = 0; i < Math.round(seconds / STEP_DT); i++) room.tick(frames());
  };

  it("a loose horse bolts directly away from burning ground within reach, and stands again once it has run itself out; one further off grazes on", () => {
    const { room, horse } = stable();
    const row = room.rows.get(horse)!;
    room.fires.push({ x: row.x, z: row.z - FIRE_PANIC.scareR - 2 }); // (north, out of reach)
    ticks(room, 1);
    expect(row.phase).toBe(MOUNT_PHASE.loose);
    room.fires.length = 0;
    room.fires.push({ x: row.x, z: row.z - 5 });
    const z0 = row.z;
    ticks(room, 1);
    expect(row.phase).toBe(MOUNT_PHASE.bolting);
    expect(room.mounts.stats.firePanics).toBe(1);
    ticks(room, BOLT_SECONDS);
    expect(row.phase).toBe(MOUNT_PHASE.loose);
    expect(row.z - z0).toBeGreaterThan(10); // (south, away from the flames)
    expect(Math.abs(row.x - 1.2)).toBeLessThan((row.z - z0) * 0.5);
  });

  it("a rider keeps the horse in hand at the edge of the fire, but closer it rears and puts them down with the fire's own line; the horse runs from the flames", () => {
    const { room, a, horse } = stable();
    press(room, "a");
    expect(mounted(a)).toBe(true);
    const row = room.rows.get(horse)!;
    room.fires.push({ x: a.x, z: a.z - 6 }); // (in the horse's fright, beyond its throw)
    ticks(room, 1);
    expect(mounted(a)).toBe(true);
    // she rides on toward it, at a walk
    for (let i = 0; i < 200 && mounted(a); i++) room.tick({ a: frame(0.35, 0, 0) });
    expect(mounted(a)).toBe(false);
    expect(room.mounts.stats.fireThrows).toBe(1);
    expect(Math.hypot(a.x - room.fires[0]!.x, a.z - room.fires[0]!.z)).toBeLessThanOrEqual(FIRE_PANIC.throwR + 0.5);
    expect(room.notices.some((n) => n.sid === "a" && (MOUNT_LINES.throwFire as readonly string[]).includes(n.text))).toBe(true);
    expect(row.rider).toBe("");
    expect(row.phase).toBe(MOUNT_PHASE.bolting);
    const z0 = row.z;
    ticks(room, 2);
    expect(row.z).toBeGreaterThan(z0 + 4); // (back the way it came, away from the fire)
  });

  it("a caravan the fire scatters re-forms: the horse runs, then goes back to its road and walks it to the end", () => {
    const room = new MountRoom(flat(), 4);
    room.routes.set("convoy", [{ x: 0, z: 0 }, { x: 0, z: -20 }]);
    const w = room.mounts.spawnWagon({ x: 0, z: 14, yaw: 0 }, { coat: 3, crates: 3, horse: true });
    room.mounts.route(w, "convoy");
    const horse = [...room.rows.values()].find((r) => r.kind === 0)!;
    ticks(room, 1);
    room.fires.push({ x: horse.x + 3, z: horse.z - 3 });
    ticks(room, 1);
    expect(horse.phase).toBe(MOUNT_PHASE.bolting);
    room.fires.length = 0; // (grass burns out)
    ticks(room, BOLT_SECONDS);
    expect(horse.phase).toBe(MOUNT_PHASE.led);
    for (let i = 0; i < 90 * 30 && !room.mounts.routeDone(w); i++) room.tick();
    expect(room.mounts.routeDone(w)).toBe(true);
  });
});

describe("D-111: ridden down", () => {
  /** Ada mounted and moving north at `buttons`' pace; a man (an NPC row) stands in her path 15 m ahead. */
  const charge = (f: number, buttons: number) => {
    const { room, a } = stable();
    press(room, "a");
    const man = room.addPlayer("npc:s1", a.x, a.z - 15);
    man.npc = 1;
    run(room, "a", 0.8, f, buttons);
    return { room, a, man };
  };

  it("a galloping horse rides down the man in its path, once, heading his way, and loses some pace for it", () => {
    const { room, a, man } = charge(1, BUTTON.SPRINT);
    let before = 0;
    for (let i = 0; i < 120 && room.trampled.length === 0; i++) {
      before = speedOf(a);
      room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
    }
    expect(room.trampled).toHaveLength(1);
    const t = room.trampled[0]!;
    expect(t).toMatchObject({ rider: "a", key: "npc:s1" });
    expect(t.speed).toBeGreaterThan(TRAMPLE.minSpeed);
    expect(t.fz).toBeLessThan(-0.9); // (north)
    expect(speedOf(a)).toBeLessThan(before * 0.95);
    expect(room.mounts.stats.tramples).toBe(1);
    // she rides on through him (the hook does not move him here): struck once a pass, not every tick he is under the horse
    for (let i = 0; i < 10; i++) room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
    expect(room.trampled).toHaveLength(1);
    void man;
  });

  it("at a walk nobody is ridden down; nor, at a gallop, a man already down, a hand of the party or a player", () => {
    const walk = charge(0.35, 0);
    for (let i = 0; i < 300; i++) walk.room.tick({ a: frame(0.35, 0, 0) });
    expect(walk.room.trampled).toHaveLength(0);
    const down = charge(1, BUTTON.SPRINT);
    down.man.flags |= FLAG.DOWNED;
    for (let i = 0; i < 120; i++) down.room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
    expect(down.room.trampled).toHaveLength(0);
    const hand = charge(1, BUTTON.SPRINT);
    hand.room.spared.add("npc:s1");
    for (let i = 0; i < 120; i++) hand.room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
    expect(hand.room.trampled).toHaveLength(0);
    expect(hand.room.mounts.stats.tramples).toBe(0);
    const friend = charge(1, BUTTON.SPRINT);
    friend.man.npc = 0;
    for (let i = 0; i < 120; i++) friend.room.tick({ a: frame(1, 0, 0, BUTTON.SPRINT) });
    expect(friend.room.trampled).toHaveLength(0);
  });
});

describe("led horses, routes and the wagon", () => {
  it("a led horse follows its leader and stops 1.8 m short; a route is walked to its end", () => {
    const room = new MountRoom(flat(), 4);
    const driver = room.addPlayer("npc:driver", 0, 0);
    driver.npc = 7;
    const w = room.mounts.spawnWagon({ x: 0, z: 14, yaw: 0 }, { coat: 3, crates: 3, horse: true });
    room.mounts.lead(w, "npc:driver");
    for (let i = 0; i < 20 * 30; i++) {
      driver.z = Math.max(-60, driver.z - 4 * STEP_DT);
      room.tick();
    }
    const horse = [...room.rows.entries()].find(([, r]) => r.kind === 0)![1];
    expect(Math.hypot(horse.x - driver.x, horse.z - driver.z)).toBeLessThan(6);
    // standing leader: the horse closes to ~1.8 m and stops
    for (let i = 0; i < 20 * 30; i++) room.tick();
    expect(Math.hypot(horse.x - driver.x, horse.z - driver.z)).toBeGreaterThan(1.2);
    expect(Math.hypot(horse.x - driver.x, horse.z - driver.z)).toBeLessThan(3.2);
    expect(horse.speed).toBeLessThan(0.5);

    const r2 = new MountRoom(flat(), 4);
    r2.routes.set("convoy", [{ x: 0, z: 0 }, { x: 0, z: -20 }, { x: 15, z: -30 }]);
    const w2 = r2.mounts.spawnWagon({ x: 0, z: 14, yaw: 0 }, { coat: 3, crates: 3, horse: true });
    r2.mounts.route(w2, "convoy");
    let top = 0;
    for (let i = 0; i < 60 * 30 && !r2.mounts.routeDone(w2); i++) {
      r2.tick();
      const h = [...r2.rows.values()].find((r) => r.kind === 0)!;
      top = Math.max(top, h.speed);
    }
    expect(r2.mounts.routeDone(w2)).toBe(true);
    expect(top).toBeLessThan(MOUNT.walk + 0.5); // a convoy walks
    const p = r2.mounts.pos(w2)!;
    expect(Math.hypot(p.x - 15, p.z + 30)).toBeLessThan(WAGON.len + 4.5);
  });

  it("a wagon trails its horse; a hitched horse is slower and turns slower; unhitch (INTERACT) frees it; the tongue hitches again", () => {
    const room = new MountRoom(flat(), 2);
    const a = room.addPlayer("a", 0, 40);
    const wid = room.mounts.spawnWagon({ x: 0, z: 60, yaw: 0 }, { coat: 1, crates: 0, horse: true });
    const horse = [...room.rows.entries()].find(([, r]) => r.kind === 0)!;
    a.x = horse[1].x + 1.2;
    a.z = horse[1].z;
    press(room, "a");
    expect(mounted(a)).toBe(true);
    expect((a.flags & MOUNT_FLAG.HITCHED) !== 0).toBe(true);
    run(room, "a", 5);
    expect(speedOf(a)).toBeCloseTo(MOUNT.trot * MOUNT.hitchMul, 1);
    const wr = room.rows.get(wid)!;
    // the wagon is `len` behind the collar and faces the way the horse does
    expect(Math.hypot(wr.x - a.x, wr.z - (a.z + WAGON.hitchBack))).toBeCloseTo(WAGON.len, 0);
    expect(wr.facing).toBeCloseTo(a.facing, 1);
    // unhitch: faster; the wagon stays where it was dropped (a second press right away dismounts instead of hitching again)
    run(room, "a", 1.2, 0); // (stopped: a rider halted by teleport would be thrown by the sudden loss of speed)
    press(room, "a");
    expect(mounted(a)).toBe(true);
    expect(a.flags & MOUNT_FLAG.HITCHED).toBe(0);
    expect(wr.hitch).toBe("");
    const wx = wr.x;
    const wz = wr.z;
    run(room, "a", 4);
    expect(speedOf(a)).toBeCloseTo(MOUNT.trot, 1);
    expect(wr.x).toBe(wx);
    expect(wr.z).toBe(wz);
    // ride back beside the tongue and hitch: INTERACT beside it
    run(room, "a", 1.5, 0);
    a.x = wr.x;
    a.z = wr.z - WAGON.len - WAGON.hitchBack + 0.5;
    a.facing = 0;
    room.tick();
    press(room, "a");
    expect(wr.hitch).not.toBe("");
    expect((a.flags & MOUNT_FLAG.HITCHED) !== 0).toBe(true);
  });
});

describe("cargo: crates, casualties, delivery", () => {
  /** A wagon at rest with a person beside its crate bays. */
  function dock() {
    const room = new MountRoom(flat(), 9);
    const w = room.mounts.spawnWagon({ x: 20, z: 20, yaw: 0 }, { coat: 1, crates: 0 });
    const p = room.addPlayer("p", 20 + 1.9, 20);
    return { room, w, p };
  }

  it("four crates load into four different bays, unload on INTERACT beside a bay, and the wagon carries them", () => {
    const { room, w, p } = dock();
    const crates = [0, 1, 2, 3].map((i) => room.addProp(25 + i, 20));
    const bayOfCrate = new Set<number>();
    for (const c of crates) {
      room.give("p", c);
      press(room, "p");
      expect(c.holder).toBe(`wagon:${w}`);
      expect(room.held.has("p")).toBe(false);
      expect((p.flags & FLAG.CARRYING) !== 0).toBe(false);
    }
    const cargo = room.mounts.cargoOf(w)!;
    cargo.props.forEach((id, i) => {
      expect(id).toBeDefined();
      bayOfCrate.add(i);
    });
    expect(bayOfCrate.size).toBe(4);
    // each crate sits at its bay in world space, and follows when the wagon moves
    room.tick();
    const wr = room.rows.get(w)!;
    const out = { x: 0, z: 0 };
    cargo.props.forEach((id, i) => {
      wagonToWorld({ x: wr.x, z: wr.z, facing: wr.facing }, WAGON.bays[i]!.x, WAGON.bays[i]!.z, out);
      const prop = room.props.get(id!)!;
      expect(prop.x).toBeCloseTo(out.x, 5);
      expect(prop.z).toBeCloseTo(out.z, 5);
      expect(prop.y).toBeCloseTo(wr.y + WAGON.bays[i]!.y, 5);
    });
    // unload the nearest bay: its crate is free beside the wagon, the bay is free again
    press(room, "p");
    const after = room.mounts.cargoOf(w)!;
    expect(after.props.filter(Boolean)).toHaveLength(3);
    const freed = crates.find((c) => c.holder === "")!;
    expect(freed).toBeDefined();
    expect(Math.hypot(freed.x - p.x, freed.z - p.z)).toBeLessThan(1.5);
    // load another into the freed bay
    room.give("p", freed);
    press(room, "p");
    expect(room.mounts.cargoOf(w)!.props.filter(Boolean)).toHaveLength(4);
  });

  it("two casualties are dragged to the wagon and loaded, travel with it, and are delivered", () => {
    const { room, w, p } = dock();
    const downs = ["d1", "d2", "d3"].map((id, i) => {
      const d = room.addPlayer(id, 20 + 2 + i * 0.5, 22);
      d.flags |= FLAG.DOWNED;
      return d;
    });
    for (let i = 0; i < 2; i++) {
      room.drag("p", `d${i + 1}`);
      press(room, "p");
      expect(downs[i]!.dragger).toBe(`wagon:${w}`);
      expect((p.flags & FLAG.DRAGGING) !== 0).toBe(false);
      expect((downs[i]!.flags & FLAG.DRAGGED) !== 0).toBe(true);
    }
    // a third has no bay
    room.drag("p", "d3");
    press(room, "p");
    expect(downs[2]!.dragger).toBe("p");
    expect(room.notices.filter((n) => n.text === MOUNT_LINES.full)).toHaveLength(1);
    room.players.get("p")!.flags &= ~FLAG.DRAGGING;
    downs[2]!.flags &= ~FLAG.DRAGGED;
    downs[2]!.dragger = "";
    // drive the wagon: a horse takes it 30 m; the casualties ride (their rows follow the wagon through the drag's own velocity steering)
    const h = room.mounts.spawnHorse({ x: 20, z: 20 - (WAGON.len + WAGON.hitchBack), yaw: 0 }, { coat: 2 });
    expect(h).not.toBe("");
    const dest = { x: 20, z: -20 };
    const wr = room.rows.get(w)!;
    // (hitch by hand through a rider: mount, hitch beside the tongue)
    const rider = room.addPlayer("r", 21.2, 20 - (WAGON.len + WAGON.hitchBack));
    press(room, "r");
    expect(mounted(rider)).toBe(true);
    press(room, "r");
    expect(wr.hitch).toBe(h);
    for (let i = 0; i < 20 * 30 && rider.z > dest.z + 3; i++) room.tick({ r: frame(1, 0, 0) });
    const out = { x: 0, z: 0 };
    for (let i = 0; i < 2; i++) {
      wagonToWorld({ x: wr.x, z: wr.z, facing: wr.facing }, WAGON.bodyBays[i]!.x, WAGON.bodyBays[i]!.z, out);
      expect(Math.hypot(downs[i]!.x - out.x, downs[i]!.z - out.z), `body ${i}`).toBeLessThan(1.2);
    }
    expect(wr.z).toBeLessThan(0);
    // delivered: stop, dismount, stand beside the wagon, unload both
    run(room, "r", 1, 0);
    press(room, "r"); // unhitch
    press(room, "r"); // dismount (right away: the second press does not hitch again)
    expect(mounted(rider)).toBe(false);
    p.x = wr.x + 1.2;
    p.z = wr.z;
    room.tick();
    press(room, "p");
    press(room, "p");
    for (let i = 0; i < 2; i++) {
      expect(downs[i]!.dragger).toBe("");
      expect((downs[i]!.flags & FLAG.DRAGGED) !== 0).toBe(false);
      expect((downs[i]!.flags & FLAG.DOWNED) !== 0).toBe(true); // still down: carried home, not healed
    }
    expect(room.mounts.cargoOf(w)!.bodies.filter(Boolean)).toHaveLength(0);
  });

  it("a revived body leaves its bay by itself; leaving the room sets a loaded body down; removing a wagon drops its cargo", () => {
    const { room, w, p } = dock();
    const crate = room.addProp(25, 20);
    room.give("p", crate);
    press(room, "p");
    const d = room.addPlayer("d", 22, 22);
    d.flags |= FLAG.DOWNED;
    room.drag("p", "d");
    press(room, "p");
    expect(room.mounts.cargoOf(w)!.bodies.filter(Boolean)).toHaveLength(1);
    // revived elsewhere: DOWNED and DRAGGED go together (Casualties.revive)
    d.flags &= ~(FLAG.DOWNED | FLAG.DRAGGED);
    room.tick();
    expect(room.mounts.cargoOf(w)!.bodies.filter(Boolean)).toHaveLength(0);
    // a body loaded again, then its owner leaves the room
    d.flags |= FLAG.DOWNED;
    room.drag("p", "d");
    press(room, "p");
    expect(d.dragger).toBe(`wagon:${w}`);
    room.mounts.onLeave("d");
    expect(d.dragger).toBe("");
    expect(d.flags & FLAG.DRAGGED).toBe(0);
    expect(room.mounts.cargoOf(w)!.bodies.filter(Boolean)).toHaveLength(0);
    // the wagon goes: its crate is released
    expect(crate.holder).toBe(`wagon:${w}`);
    room.mounts.remove(w);
    expect(crate.holder).toBe("");
    expect(room.rows.get(w)).toBeUndefined();
  });

  it("a crate the scenario consumes frees its bay", () => {
    const { room, w } = dock();
    const crate = room.addProp(25, 20);
    room.give("p", crate);
    press(room, "p");
    expect(room.mounts.cargoOf(w)!.props.filter(Boolean)).toHaveLength(1);
    room.props.delete(crate.id);
    room.tick();
    expect(room.mounts.cargoOf(w)!.props.filter(Boolean)).toHaveLength(0);
  });
});

describe("seize and wreck", () => {
  it("seize pays the crates' value once; wreck smashes or burns a wagon out, drops the cargo and makes its horse bolt", () => {
    const room = new MountRoom(flat(), 6);
    const w = room.mounts.spawnWagon({ x: 0, z: 30, yaw: 0 }, { coat: 2, crates: 3, horse: true });
    const crate = room.addProp(5, 5);
    const p = room.addPlayer("p", 1.9, 30);
    room.give("p", crate);
    press(room, "p");
    expect(room.mounts.cargoOf(w)!.props.filter(Boolean)).toHaveLength(1);
    expect(room.mounts.seize(w, "p")).toBe(3 * CARGO_POUNDS);
    expect(room.mounts.seize(w, "p")).toBe(0);
    expect(room.rows.get(w)!.cargo).toBe(0);
    expect(p).toBeDefined();
    room.mounts.wreck(w, true);
    const wr = room.rows.get(w)!;
    expect(wr.phase).toBe(MOUNT_PHASE.wrecked);
    expect(wr.hp).toBe(1);
    expect(wr.hitch).toBe("");
    expect(crate.holder).toBe("");
    expect(room.mounts.seize(w, "p")).toBe(0);
    const horse = [...room.rows.values()].find((r) => r.kind === 0)!;
    expect(horse.phase).toBe(MOUNT_PHASE.bolting);
    expect(horse.hitch).toBe("");
    room.mounts.wreck(w, false); // a second wreck changes nothing
    expect(wr.hp).toBe(1);
  });
});

describe("room lifecycle", () => {
  it("dispose with a rider and a wagon: rows gone, no stale MOUNTED / HITCHED / GALLOPING flag, cargo and casualties released", () => {
    const room = new MountRoom(flat(), 8);
    const w = room.mounts.spawnWagon({ x: 0, z: 40, yaw: 0 }, { coat: 1, crates: 0, horse: true });
    const horse = [...room.rows.entries()].find(([, r]) => r.kind === 0)!;
    const a = room.addPlayer("a", horse[1].x + 1.2, horse[1].z);
    press(room, "a");
    run(room, "a", 3, 1, BUTTON.SPRINT);
    const d = room.addPlayer("d", 3, 38);
    d.flags |= FLAG.DOWNED;
    room.mounts.onLeave("zz");
    room.mounts.dispose();
    expect(room.rows.size).toBe(0);
    expect(room.mounts.count).toBe(0);
    expect(a.flags & (MOUNT_FLAG.MOUNTED | MOUNT_FLAG.HITCHED | MOUNT_FLAG.GALLOPING)).toBe(0);
    expect(w).toBeTruthy();
    // a new region's spawns are clean
    const h2 = room.mounts.spawnHorse({ x: 0, z: 0, yaw: 0 }, { coat: 1 });
    expect(room.rows.get(h2)!.rider).toBe("");
  });

  it("a rider who leaves the room is dismounted where they are and the horse stands", () => {
    const { room, a, horse } = stable();
    press(room, "a");
    run(room, "a", 1.5);
    room.mounts.onLeave("a");
    expect(mounted(a)).toBe(false);
    expect(room.rows.get(horse)!.rider).toBe("");
  });

  it("a rider whose MOUNTED flag vanishes under them (teleport, region change) frees the horse on the next tick", () => {
    const { room, a, horse } = stable();
    press(room, "a");
    a.flags &= ~MOUNT_FLAG.MOUNTED;
    room.tick();
    expect(room.rows.get(horse)!.rider).toBe("");
    expect(room.rows.get(horse)!.phase).toBe(MOUNT_PHASE.loose);
  });
});

describe("fuzz: random pressing, riding, dragging and leaving never breaks the books", () => {
  it("3000 random actions keep every flag, rider, bay and holder consistent", () => {
    const rng = new Rng(99);
    const room = new MountRoom(flat([{ kind: "box", x: 0, z: -30, hx: 30, hz: 0.5, yaw: 0, y0: -1, y1: 3 }]), 12);
    const ids = ["a", "b", "c", "d"];
    ids.forEach((id, i) => room.addPlayer(id, i * 1.5, 20));
    room.mounts.spawnHorse({ x: 3, z: 22, yaw: 0 }, { coat: 1 });
    room.mounts.spawnHorse({ x: -3, z: 22, yaw: 0 }, { coat: 2 });
    room.mounts.spawnWagon({ x: 10, z: 25, yaw: 0 }, { coat: 3, crates: 1, horse: true });
    const props = [0, 1, 2, 3, 4, 5].map((i) => room.addProp(6 + i, 18));
    const check = (): void => {
      const riders = new Map<string, number>();
      room.rows.forEach((row) => {
        if (row.rider) {
          riders.set(row.rider, (riders.get(row.rider) ?? 0) + 1);
          expect(mounted(room.players.get(row.rider)!)).toBe(true);
        }
      });
      for (const [id, p] of room.players) {
        if (mounted(p)) expect(riders.get(id), `mounted ${id} has exactly one horse`).toBe(1);
        else expect(riders.get(id)).toBeUndefined();
        expect(Number.isFinite(p.x + p.y + p.z + p.vx + p.vz)).toBe(true);
        if (p.dragger.startsWith("wagon:")) expect(p.flags & FLAG.DRAGGED).toBe(FLAG.DRAGGED);
      }
      for (const id of ["w3"]) {
        const c = room.mounts.cargoOf(id);
        if (c) {
          for (const pid of c.props) if (pid) expect(room.props.get(pid)?.holder).toBe(`wagon:${id}`);
          for (const b of c.bodies) if (b) expect(room.players.get(b)?.dragger).toBe(`wagon:${id}`);
        }
      }
    };
    for (let n = 0; n < 3000; n++) {
      const sid = ids[rng.int(0, 3)]!;
      const p = room.players.get(sid)!;
      const roll = rng.next();
      if (roll < 0.35) room.tick({ [sid]: frame(rng.range(-1, 1), rng.range(-1, 1), rng.range(0, 6.28), (rng.chance(0.3) ? INTERACT : 0) | (rng.chance(0.4) ? BUTTON.SPRINT : 0) | (rng.chance(0.05) ? BUTTON.JUMP : 0)) });
      else if (roll < 0.45) room.tick();
      else if (roll < 0.52) {
        if (!room.held.has(sid) && (p.flags & (FLAG.DOWNED | MOUNT_FLAG.MOUNTED)) === 0) {
          const free = props.find((q) => q.holder === "");
          if (free) {
            free.x = p.x + 0.5;
            free.z = p.z;
            room.give(sid, free);
          }
        }
      } else if (roll < 0.57) room.mounts.onHurt(sid, rng.range(1, 100));
      else if (roll < 0.6) room.mounts.onBlast(sid, rng.range(0, 14));
      else if (roll < 0.62) {
        p.flags |= FLAG.DOWNED;
        room.mounts.onDown(sid);
      } else if (roll < 0.66) p.flags &= ~FLAG.DOWNED;
      else if (roll < 0.7) {
        const other = ids[rng.int(0, 3)]!;
        const o = room.players.get(other)!;
        if (other !== sid && (o.flags & FLAG.DOWNED) !== 0 && (o.flags & FLAG.DRAGGED) === 0 && (p.flags & (FLAG.DOWNED | MOUNT_FLAG.MOUNTED | FLAG.CARRYING)) === 0) room.drag(sid, other);
      } else if (roll < 0.72) room.mounts.onLeave(sid);
      else if (roll < 0.76) {
        p.x = rng.range(-5, 20);
        p.z = rng.range(15, 30);
      } else room.tick({ [sid]: frame(0, 0, 0, INTERACT) });
      if (n % 7 === 0) check();
    }
    check();
  });
});
