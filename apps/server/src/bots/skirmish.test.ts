import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BUTTON, FLAG, NPC, PlayerState, ROOM_WORLD, TICK_RATE, WEAPON, createCharState, elevToWire, hash3, npcKey, stepCharacter, weaponToWire, yawToWire,
  type CollisionWorld, type MoveCommand, type PlayerStateType, type WeaponId,
} from "@cb/shared";
import { NPC_SIDE, type NpcSpec } from "@cb/shared";
import { npcThink } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { WorldRoom } from "../rooms/WorldRoom.ts";
import { Cast } from "../systems/Cast.ts";
import type { Combat } from "../systems/Combat.ts";

/**
 * The skirmish balance harness (docs/_notes/expedition.md section 2, acceptance 3). A REAL room (real Combat, Casualties, Rapier, the real hit rules)
 * driven by hand at a fixed 30 Hz instead of by the wall clock, so ten seeds of a hundred seconds each take seconds, not minutes; no network.
 * The room's own timer is not started (its fixed-step registration is intercepted), the bots are scripted rows that go through the SAME step and
 * `Combat.onFrame` a player's input frame goes through, and the sentries are the real Cast with the real brain. Four sentries (2 rifle, 2 pistol).
 *
 * What the numbers are: a first pass against scripted bots, NEVER PLAYED BY A HUMAN. They go to docs/BUILD_STATE.md as measured.
 * `forced` here means the whole garrison is downed or routed (stricter than the scenario's own 60%).
 */

const PORT = 2594; // one port per integration test file
const DT = 1 / TICK_RATE;
const SEEDS = Array.from({ length: 10 }, (_, i) => 4001 + i);
const results: Record<string, unknown> = {};

const heading = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };
/** Roughly normal (mean 0, sigma 1) from a hash: the bot's own aim error. */
const gauss = (seed: number, a: number, b: number): number => ((hash3(seed, a, b, 1) + hash3(seed, a, b, 2) + hash3(seed, a, b, 3)) / 4294967296 - 1.5) * 2;

interface Bot {
  id: string;
  p: PlayerStateType;
  prev: number;
  idx: number;
  seed: number;
  downedAt: number;
  lastFire: number;
  /** Seconds the bot has been standing still (a competent shooter plants before the shot). */
  stillFor: number;
  aim: (sim: Sim, b: Bot) => MoveCommand;
}

class Sim {
  readonly world: CollisionWorld;
  readonly combat: Combat;
  readonly cast: Cast;
  readonly bots: Bot[] = [];
  private readonly room: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private readonly physics: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private readonly casualties: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  t = 0;
  tickMs: number[] = [];
  private nextTopUp = 0;

  constructor(room: WorldRoom, readonly seed: number) {
    this.room = room;
    this.world = this.room.world;
    this.combat = this.room.combat;
    this.physics = this.room.physics;
    this.casualties = this.room.casualties;
    this.room.tickDt = DT;
    const sim = this;
    this.cast = new Cast({
      players: this.room.party,
      spawnNpc: (spec) => this.room.spawnNpc(spec),
      removeNpc: (key) => this.room.removeNpc(key),
      stepNpc: (key, cmd) => this.room.stepNpc(key, cmd),
      world: () => this.world,
      worldMs: () => sim.t * 1000,
      seed,
      fear: () => 10,
      brains: { garrison: npcThink },
    });
    // the room asks its scenario about hits and ticks it; here the scenario is the cast
    this.room.scenario = { tick: () => undefined, onDamage: () => undefined, onInteract: () => false, onPick: () => undefined, onParleyClose: () => undefined, dispose: () => undefined };
    // gunfire is heard (Combat's host `noise` hook; the integrator wires the same line)
    this.room.combat.host.noise = (x: number, z: number, r: number, src: string) => this.cast.noise(x, z, r, src);
  }

  addBot(id: string, x: number, z: number, idx: number, aim: Bot["aim"]): Bot {
    const p = new PlayerState();
    p.name = id;
    p.slot = idx;
    p.connected = true;
    p.look = "";
    p.title = "";
    p.health = 100;
    p.wounds = 0;
    p.missing = 0;
    p.reviveProgress = 0;
    p.reviver = "";
    p.dragger = "";
    Object.assign(p, createCharState(x, z, this.world));
    this.room.state.players.set(id, p);
    p.shots = 0;
    p.aim = 0;
    p.npc = 0;
    this.combat.onJoin(id, p);
    const bot: Bot = { id, p, prev: 0, idx, seed: hash3(this.seed, idx, 0xb07), downedAt: -1, lastFire: -99, stillFor: 0, aim };
    this.bots.push(bot);
    return bot;
  }

  spawnSentries(post: (i: number) => { x: number; z: number }): NpcSpec[] {
    const arms: WeaponId[] = [WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.PISTOL];
    const specs: NpcSpec[] = arms.map((weapon, i) => ({
      id: `sentry-${i}`, role: NPC.SENTRY, faction: "ward", side: NPC_SIDE[NPC.SENTRY]!, group: "ward", post: post(i), weapon, lookSeed: hash3(this.seed, i, NPC.SENTRY), name: `Sentry ${i}`,
      skill: 42 + (hash3(this.seed, i, 0x5ca1) % 24), bravery: 46 + (hash3(this.seed, i, 0xb4a7) % 24), brain: "garrison",
    }));
    expect(this.cast.spawn(specs)).toBe(4);
    this.cast.order("ward", { o: "alert" });
    return specs;
  }

  sentry(i: number): PlayerStateType | undefined {
    return this.cast.row(`sentry-${i}`);
  }

  /** Nearest sentry still standing (not downed). */
  nearestSentry(x: number, z: number): PlayerStateType | undefined {
    let best: PlayerStateType | undefined;
    let bd = Infinity;
    for (let i = 0; i < 4; i++) {
      const s = this.sentry(i);
      if (!s || (s.flags & FLAG.DOWNED) !== 0) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  stepBot(b: Bot, cmd: MoveCommand): void {
    stepCharacter(b.p, cmd, DT, this.world);
    this.combat.onFrame(b.id, b.p, cmd, cmd.buttons & ~b.prev);
    b.prev = cmd.buttons;
    this.physics.syncPlayer(b.id, b.p.x, b.p.y, b.p.z, (b.p.flags & (FLAG.CROUCHING | FLAG.DOWNED)) !== 0);
  }

  tick(): void {
    const t0 = performance.now();
    this.t += DT;
    for (const b of this.bots) {
      const down = (b.p.flags & FLAG.DOWNED) !== 0;
      if (down && b.downedAt < 0) b.downedAt = this.t;
      b.stillFor = Math.hypot(b.p.vx, b.p.vz) < 0.3 ? b.stillFor + DT : 0;
      this.stepBot(b, down ? { moveF: 0, moveR: 0, yaw: 0, buttons: 0 } : b.aim(this, b));
    }
    this.cast.tick(DT);
    if (this.t >= this.nextTopUp) {
      // the integrator's job in the real room: NPC magazines are not the player's problem (a reserve of 12 would run dry in a long fight)
      this.nextTopUp = this.t + 2;
      for (let i = 0; i < 4; i++) {
        const row = this.sentry(i);
        if (row && row.reserve < 4) this.combat.give(npcKey(`sentry-${i}`), [WEAPON.RIFLE, WEAPON.PISTOL][i % 2]!);
      }
      for (const b of this.bots) if (b.p.reserve < 4) this.combat.give(b.id, WEAPON.RIFLE);
    }
    this.casualties.tick(DT);
    this.combat.tick(DT);
    this.physics.step(DT);
    this.tickMs.push(performance.now() - t0);
  }

  garrisonDone(): boolean {
    const c = this.cast.count("ward");
    return c.down + c.routed >= c.total;
  }
}

// ---- scripted bots ----------------------------------------------------------------------------------------------------------------------

/** Stick values that walk toward (tx, tz) when the camera looks along `yaw`. */
function stick(p: PlayerStateType, tx: number, tz: number, yaw: number, run = 1): { moveF: number; moveR: number } {
  const dx = tx - p.x, dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) return { moveF: 0, moveR: 0 };
  const f = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d;
  const r = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / d;
  return { moveF: Math.round(f * 127 * run), moveR: Math.round(r * 127 * run) };
}

/** The shot a competent player takes: aim at the chest of `t` with a small human error, from a standing start. */
function shoot(sim: Sim, b: Bot, t: PlayerStateType, c: MoveCommand, sigma = 0.02): void {
  const d = Math.hypot(t.x - b.p.x, t.z - b.p.z);
  const yaw = heading(b.p.x, b.p.z, t.x, t.z);
  c.yaw = yawToWire(yaw);
  c.aimYaw = yawToWire(yaw + gauss(b.seed, Math.floor(sim.t * 2), 5) * sigma);
  c.aimElev = elevToWire(Math.atan2(t.y + 1.1 - (b.p.y + 1.55), d));
  c.buttons |= BUTTON.AIM;
  if (b.p.ammo > 0 && sim.t > 1.5 && sim.t - b.lastFire > 0.9 && b.stillFor > 0.6) {
    c.buttons |= BUTTON.FIRE;
    b.lastFire = sim.t;
  } else if (b.p.ammo <= 0) c.buttons |= BUTTON.RELOAD;
}

const baseCmd = (): MoveCommand => ({ moveF: 0, moveR: 0, yaw: 0, buttons: 0, aimYaw: 0, aimElev: 0, weapon: weaponToWire(WEAPON.RIFLE) });

/** A bot that stands in the open and does nothing. */
const still: Bot["aim"] = (sim, b) => {
  const c = baseCmd();
  const t = sim.nearestSentry(b.p.x, b.p.z);
  if (t) c.yaw = yawToWire(heading(b.p.x, b.p.z, t.x, t.z));
  return c;
};

/** Stands behind a rock, steps out to one side for a second, fires one aimed shot, steps back. */
function behindCover(cover: { x: number; z: number; r: number; dirx: number; dirz: number }): Bot["aim"] {
  const hide = { x: cover.x - cover.dirx * (cover.r + 1.2), z: cover.z - cover.dirz * (cover.r + 1.2) };
  const px = -cover.dirz, pz = cover.dirx; // perpendicular to the line of fire
  const peek = { x: hide.x + px * (cover.r + 2.4), z: hide.z + pz * (cover.r + 2.4) }; // (the sentries see on a 2 m grid: a peek has to clear the rock by more than a cell)
  return (sim, b) => {
    const c = baseCmd();
    const phase = (sim.t + b.idx * 0.7) % 3.6;
    const t = sim.nearestSentry(b.p.x, b.p.z);
    const out = phase >= 2.0;
    const goal = out ? peek : hide;
    const yaw = t ? heading(b.p.x, b.p.z, t.x, t.z) : heading(b.p.x, b.p.z, cover.x + cover.dirx * 20, cover.z + cover.dirz * 20);
    c.yaw = yawToWire(yaw);
    const s = stick(b.p, goal.x, goal.z, yaw);
    c.moveF = s.moveF;
    c.moveR = s.moveR;
    if (out && t && Math.hypot(b.p.x - peek.x, b.p.z - peek.z) < 0.8 && Math.hypot(b.p.vx, b.p.vz) < 1.2) {
      // out in the open for a moment: take the shot
      shoot(sim, b, t, c);
      if (!(c.buttons & BUTTON.FIRE)) c.buttons &= ~BUTTON.RELOAD;
    } else if (b.p.ammo <= 0) c.buttons |= BUTTON.RELOAD;
    return c;
  };
}

/** A competent rifleman: strafe while the rifle reloads, plant, aim, fire, repeat; fights the nearest sentry. */
const rifleman: Bot["aim"] = (sim, b) => {
  const c = baseCmd();
  const t = sim.nearestSentry(b.p.x, b.p.z);
  if (!t) return c;
  const yaw = heading(b.p.x, b.p.z, t.x, t.z);
  c.yaw = yawToWire(yaw);
  const ready = b.p.ammo > 0 && b.p.reload === 0 && sim.t - b.lastFire > 1.0;
  if (ready && sim.t > 1.5) {
    shoot(sim, b, t, c); // (plants first: no stick, then the shot once it has stood still for a moment)
  } else {
    // strafe: switch side every 1.1 s, a different phase per bot
    const side = Math.floor((sim.t + b.idx * 0.37) / 1.1) % 2 === 0 ? 1 : -1;
    c.moveR = 127 * side;
    if (b.p.ammo <= 0) c.buttons |= BUTTON.RELOAD;
  }
  return c;
};

// ---- terrain for the scenarios ----------------------------------------------------------------------------------------------------------

function openAt(world: CollisionWorld, x: number, z: number, gap = 1.2): boolean {
  if (Math.hypot(x, z) > 74) return false;
  let ok = true;
  world.forEachNear(x, z, (o) => {
    const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
    if (Math.hypot(o.x - x, o.z - z) < r + gap) ok = false;
  });
  return ok;
}

/** A band of open, level ground `len` long and `2*half` wide: where a still bot and four sentries stand 25 m apart. */
function openBand(world: CollisionWorld, len: number, half: number): { x: number; z: number; ax: number; az: number } {
  for (let x = -60; x <= 60; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      for (let deg = 0; deg < 360; deg += 15) {
        const ax = Math.cos((deg * Math.PI) / 180), az = Math.sin((deg * Math.PI) / 180);
        let ok = true;
        for (let u = -3; u <= len + 3 && ok; u += 2) {
          for (let v = -half - 2; v <= half + 2 && ok; v += 2) {
            const px = x + ax * u - az * v, pz = z + az * u + ax * v;
            if (!openAt(world, px, pz) || Math.abs(world.terrainHeight(px, pz) - world.terrainHeight(x, z)) > 1.2) ok = false;
          }
        }
        if (ok) return { x, z, ax, az };
      }
    }
  }
  throw new Error("no open band");
}

/** A rock or ruined pillar (>= 1.4 m radius, >= 1.6 m tall) with open ground on one side for 24 m: cover for the bot; the sentries stand on the open side. Looser rules on a second pass. */
function coverSpot(world: CollisionWorld): { x: number; z: number; r: number; dirx: number; dirz: number } {
  for (const [minR, lateral, gap] of [[1.4, 4, 1.2], [1.2, 3, 1.0], [1.0, 2, 0.8], [0.9, 1.5, 0.6]] as const) {
    for (const o of world.obstacles) {
      if (o.kind !== "circle" || (o.tag !== "rock" && o.tag !== "ruin") || o.r < minR || o.y1 - world.terrainHeight(o.x, o.z) < 1.6) continue;
      for (let deg = 0; deg < 360; deg += 20) {
        const dirx = Math.cos((deg * Math.PI) / 180), dirz = Math.sin((deg * Math.PI) / 180);
        let ok = true;
        for (let u = o.r + 2; u <= 24 && ok; u += 2) for (let v = -lateral; v <= lateral && ok; v += lateral) if (!openAt(world, o.x + dirx * u - dirz * v, o.z + dirz * u + dirx * v, gap)) ok = false;
        // and room behind the rock for the bot to stand and peek
        for (let u = -(o.r + 3.2); u <= -(o.r + 1.0) && ok; u += 1.1) for (let v = -2.5; v <= 2.5 && ok; v += 2.5) if (!openAt(world, o.x + dirx * u - dirz * v, o.z + dirz * u + dirx * v, 0.7)) ok = false;
        if (ok) return { x: o.x, z: o.z, r: o.r, dirx, dirz };
      }
    }
  }
  throw new Error("no cover spot");
}

// ---- the tests ---------------------------------------------------------------------------------------------------------------------------

describe("skirmish balance (real room, scripted bots, fixed 30 Hz, 10 seeds, 4 sentries: 2 rifle, 2 pistol)", () => {
  let colyseus: ColyseusTestServer;
  const ticks: unknown[] = [];
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    // the room's own timer must not run: this file drives its systems by hand (see the header)
    vi.spyOn(WorldRoom.prototype as unknown as { setFixedTimestep(fn: unknown): void }, "setFixedTimestep").mockImplementation((fn: unknown) => { ticks.push(fn as never); });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    mkdirSync("../../test-results", { recursive: true });
    writeFileSync("../../test-results/skirmish.json", JSON.stringify(results, null, 2));
    await colyseus.shutdown();
  });
  afterEach(async () => {
    await colyseus.cleanup();
  });

  const make = async (seed: number): Promise<Sim> => new Sim((await colyseus.createRoom(ROOM_WORLD, { seed })) as unknown as WorldRoom, seed);

  it("a bot standing still in the open at 25 m is downed in a median of at least 8 s", async () => {
    const times: number[] = [];
    for (const seed of SEEDS) {
      const sim = await make(seed);
      const band = openBand(sim.world, 32, 5);
      const bot = sim.addBot("still", band.x, band.z, 0, still);
      const lat = [-3, -1, 1, 3];
      sim.spawnSentries((i) => ({ x: band.x + band.ax * 25 - band.az * lat[i]!, z: band.z + band.az * 25 + band.ax * lat[i]! }));
      for (let i = 0; i < 90 * TICK_RATE && bot.downedAt < 0; i++) sim.tick();
      times.push(bot.downedAt < 0 ? 90 : bot.downedAt);
    }
    results.stillAt25m = { seconds: times, median: median(times) };
    expect(median(times)).toBeGreaterThanOrEqual(8);
  }, 300_000);

  it("a bot that strafes out from behind cover, fires and steps back survives a median of at least 30 s", async () => {
    const times: number[] = [];
    for (const seed of SEEDS) {
      const sim = await make(seed);
      const cs = coverSpot(sim.world);
      const bot = sim.addBot("cover", cs.x - cs.dirx * (cs.r + 1.2), cs.z - cs.dirz * (cs.r + 1.2), 0, behindCover(cs));
      const lat = [-3, -1, 1, 3];
      sim.spawnSentries((i) => ({ x: cs.x + cs.dirx * 20 - cs.dirz * lat[i]!, z: cs.z + cs.dirz * 20 + cs.dirx * lat[i]! }));
      for (let i = 0; i < 90 * TICK_RATE && bot.downedAt < 0; i++) sim.tick();
      times.push(bot.downedAt < 0 ? 90 : bot.downedAt);
    }
    results.coverStrafe = { seconds: times, median: median(times) };
    expect(median(times)).toBeGreaterThanOrEqual(30);
  }, 300_000);

  it("three rifle bots beat the four sentries (garrison downed or routed) within 150 s in at least 70% of seeds, with at most one bot downed", async () => {
    const runs: { seed: number; sentryShots: number; botHealthLeft: number[]; won: boolean; seconds: number; botsDown: number; sentriesDown: number; routed: number }[] = [];
    const tickMs: number[] = [];
    for (const seed of SEEDS) {
      const sim = await make(seed);
      const band = openBand(sim.world, 32, 6);
      const lat = [-4, 0, 4];
      for (let i = 0; i < 3; i++) sim.addBot(`rifle${i}`, band.x - band.az * lat[i]!, band.z + band.ax * lat[i]!, i, rifleman);
      const lat4 = [-3, -1, 1, 3];
      sim.spawnSentries((i) => ({ x: band.x + band.ax * 26 - band.az * lat4[i]!, z: band.z + band.az * 26 + band.ax * lat4[i]! }));
      let seconds = 150;
      for (let i = 0; i < 150 * TICK_RATE; i++) {
        sim.tick();
        if (sim.garrisonDone() || sim.bots.every((b) => b.downedAt >= 0)) { seconds = sim.t; break; }
      }
      const c = sim.cast.count("ward");
      tickMs.push(...sim.tickMs);
      runs.push({ seed, sentryShots: sim.cast.stats.shots, botHealthLeft: sim.bots.map((b) => b.p.health), won: sim.garrisonDone(), seconds, botsDown: sim.bots.filter((b) => b.downedAt >= 0).length, sentriesDown: c.down, routed: c.routed });
    }
    const wins = runs.filter((r) => r.won && r.botsDown <= 1 && r.seconds <= 150);
    tickMs.sort((a, b) => a - b);
    results.threeRifles = { runs, winsWithAtMostOneDown: wins.length, of: runs.length, tickMsP50: tickMs[Math.floor(tickMs.length * 0.5)], tickMsP95: tickMs[Math.floor(tickMs.length * 0.95)] };
    expect(wins.length).toBeGreaterThanOrEqual(7);
    // (4) p95 of the whole tick (Cast + 4 NPC steps + 3 bots + Combat + physics) stays far under the 33 ms budget, 16 ms with 20 NPCs
    expect(tickMs[Math.floor(tickMs.length * 0.95)]!).toBeLessThan(16);
  }, 600_000);
});
