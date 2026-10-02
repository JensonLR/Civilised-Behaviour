import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, COMBAT, ROOM_WORLD, WEAPON, createArena, type CollisionWorld, type WeaponId } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "../rooms/WorldRoom.ts";
import type { Combat } from "../systems/Combat.ts";
import { Bot, aimAt, circleWalker, type Behaviour } from "./Bot.ts";

const PORT = 2582; // one port per integration test file
const URL = `ws://127.0.0.1:${PORT}`;
const SEED = 4242;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown> = {};

/** A rectangle of open ground (no obstacle, gentle slope) `len` long and `2*half` wide, starting at (x, z) and running along `heading` (radians, ground plane). */
function openBand(world: CollisionWorld, len: number, half: number): { x: number; z: number; ax: number; az: number } {
  for (let x = -60; x <= 60; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      for (let deg = 0; deg < 360; deg += 15) {
        const ax = Math.cos((deg * Math.PI) / 180);
        const az = Math.sin((deg * Math.PI) / 180);
        let ok = true;
        for (let u = -4; u <= len + 4 && ok; u += 2) {
          for (let v = -half - 2; v <= half + 2 && ok; v += 2) {
            const px = x + ax * u - az * v;
            const pz = z + az * u + ax * v;
            if (Math.hypot(px, pz) > 78) ok = false;
            world.forEachNear(px, pz, (o) => {
              const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
              if (Math.hypot(o.x - px, o.z - pz) < r + 1.5) ok = false;
            });
            if (Math.abs(world.terrainHeight(px, pz) - world.terrainHeight(x, z)) > 1.2) ok = false;
          }
        }
        if (ok) return { x, z, ax, az };
      }
    }
  }
  throw new Error("no open band");
}

describe("lag compensation and prediction under fire (headless bots against a real server)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    mkdirSync("../../test-results", { recursive: true });
    writeFileSync("../../test-results/combat.json", JSON.stringify(results, null, 2));
    await colyseus.shutdown();
  });
  afterEach(async () => {
    colyseus.server.simulateLatency(0);
    await colyseus.cleanup();
  });

  /**
   * A rifleman stands still and shoots at the place he SEES a strafing target (the bot's rendered, interpolated position, chest high);
   * `offset` moves the aim sideways (a control: a shot 1.2 m off must miss). Returns how many of his rounds found the target.
   */
  async function duel(rttMs: number, opts: { lagComp: boolean; offset?: number; shots?: number; range?: number; weapon?: WeaponId }) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED })) as unknown as WorldRoom;
    const combat = (room as unknown as { combat: Combat }).combat;
    combat.lagCompensation = opts.lagComp;
    // The rewind each of the shooter's rounds was judged with (only rounds that are rewound report here).
    const lags: number[] = [];
    combat.diag = (d) => lags.push(d.lagMs);
    colyseus.server.simulateLatency(rttMs);
    const world = createArena(SEED);
    const range = opts.range ?? 22;
    const band = openBand(world, range + 8, 7);
    const marks: number[] = [];
    const shots: number[] = [];
    const yawAxis = Math.atan2(-band.ax, -band.az);
    // Both are teleported onto the band once they exist: the shooter at its start, the target `range` metres down it.
    const target: Behaviour = (tick) => ({ moveF: 0, moveR: [1, -1, -1, 1][Math.floor(tick / 30) % 4]!, yaw: yawAxis, buttons: 0 });
    const shooter: Behaviour = (_tick, _self, bot) => {
      const me = bot.predicted;
      const other = bot.others()[0];
      if (!me || !other) return { moveF: 0, moveR: 0, yaw: yawAxis, buttons: 0, weapon: opts.weapon ?? WEAPON.RIFLE };
      const r = bot.rendered(other[1]);
      const side = opts.offset ?? 0;
      const a = aimAt(me, { x: r.x - Math.sin(yawAxis + Math.PI / 2) * side * -1, y: r.y + 1.14, z: r.z - Math.cos(yawAxis + Math.PI / 2) * side * -1 });
      return { moveF: 0, moveR: 0, yaw: a.aimYaw, aimYaw: a.aimYaw, aimElev: a.aimElev, buttons: BUTTON.AIM | (fireNow ? BUTTON.FIRE : 0), weapon: opts.weapon ?? WEAPON.RIFLE };
    };
    let fireNow = false;
    const S = await Bot.joinById(URL, room.roomId, "S", shooter);
    const T = await Bot.joinById(URL, room.roomId, "T", target);
    S.room.onMessage("hitmark", () => marks.push(Date.now()));
    S.room.onMessage("shot", (e: { id: string }) => e.id === S.room.sessionId && shots.push(Date.now()));
    for (const b of [S, T]) {
      b.room.onMessage("hit", () => undefined);
      b.room.onMessage("sever", () => undefined);
      b.room.onMessage("impact", () => undefined);
      b.room.onMessage("boom", () => undefined);
      b.room.onMessage("notice", () => undefined);
      if (b === T) b.room.onMessage("shot", () => undefined);
    }
    const ps = room.state.players.get(S.room.sessionId)!;
    const pt = room.state.players.get(T.room.sessionId)!;
    const setup = () => {
      ps.x = band.x;
      ps.z = band.z;
      ps.y = world.terrainHeight(ps.x, ps.z);
      ps.vx = ps.vz = 0;
      pt.x = band.x + band.ax * range;
      pt.z = band.z + band.az * range;
      pt.y = world.terrainHeight(pt.x, pt.z);
      pt.vx = pt.vz = 0;
    };
    S.start();
    T.start();
    setup();
    await sleep(2200); // teleport snap and interpolation buffers settle
    const wantShots = opts.shots ?? 14;
    const t0 = Date.now();
    while (shots.length < wantShots && Date.now() - t0 < wantShots * 1500 + 6000) {
      // one trigger pull a second, on a fresh magazine (the rifle reloads in 3.6 s; the duel is about aim, not about patience)
      fireNow = true;
      await sleep(70);
      fireNow = false;
      combat.give(S.room.sessionId, opts.weapon ?? WEAPON.RIFLE);
      await sleep(180);
      pt.health = 100;
      pt.wounds = 0;
      pt.flags &= ~16;
      // keep the target on its strafing line: the band is finite
      if (Math.hypot(pt.x - (band.x + band.ax * range), pt.z - (band.z + band.az * range)) > 8) {
        setup();
        await sleep(1000);
      }
      await sleep(750);
    }
    const stats = {
      shots: shots.length,
      hits: marks.length,
      rate: shots.length ? marks.length / shots.length : 0,
      lagMs: lags.length ? [Math.round(Math.min(...lags)), Math.round(Math.max(...lags))] : [],
      clamped: lags.filter((l) => l >= COMBAT.rewindMaxMs).length,
    };
    await S.stop();
    await T.stop();
    return stats;
  }

  for (const rtt of [0, 100, 200]) {
    it(`hitscan at ${rtt} ms RTT: shots aimed at where the target is SEEN land (lag compensation on)`, async () => {
      const r = await duel(rtt, { lagComp: true });
      results[`hitscan_rtt${rtt}_on`] = r;
      expect(r.shots).toBeGreaterThanOrEqual(10);
      // A shot's lag is the WHOLE round trip (the picture came down, the trigger went up) plus the display delay: 250..350 ms at 200 ms.
      // The rewind must reach it, not stop at the clamp (D-043: a 250 ms clamp cut all 14 short and landed 6..12 of them).
      expect(r.clamped).toBe(0);
      expect(r.rate).toBeGreaterThanOrEqual(0.85);
    }, 60000);
  }

  it("without rewinding the same shots miss at 200 ms (the mutation that proves the compensation is what makes them land)", async () => {
    const off0 = await duel(0, { lagComp: false });
    const off200 = await duel(200, { lagComp: false });
    results["hitscan_rtt0_off"] = off0;
    results["hitscan_rtt200_off"] = off200;
    expect(off200.rate).toBeLessThan(0.5);
    // and at zero lag there is little to compensate
    expect(off0.rate).toBeGreaterThan(off200.rate);
  }, 90000);

  it("the hit test is honest: an aim 1.2 m to one side misses at every latency, compensated or not", async () => {
    for (const rtt of [0, 150]) {
      const r = await duel(rtt, { lagComp: true, offset: 1.2, shots: 8 });
      results[`hitscan_offset_rtt${rtt}`] = r;
      expect(r.hits).toBe(0);
    }
  }, 90000);

  it("pistol balls (projectiles, first instants compensated) still land on a strafing man at 12 m, at 0 and 150 ms RTT", async () => {
    for (const rtt of [0, 150]) {
      const r = await duel(rtt, { lagComp: true, weapon: WEAPON.PISTOL, range: 12, shots: 12 });
      results[`pistol_rtt${rtt}_on`] = r;
      expect(r.rate).toBeGreaterThanOrEqual(0.4); // (a ball in flight can also be dodged by a strafing man; measured 11/12 and 6/12)
    }
  }, 90000);

  it("shooting does not desync movement: a bot walking a circle while aiming and firing keeps prediction exact (recoil is cosmetic)", async () => {
    for (const rtt of [0, 100]) {
      colyseus.server.simulateLatency(rtt);
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED })) as unknown as WorldRoom;
      const combat = (room as unknown as { combat: Combat }).combat;
      let n = 0;
      const shooting: Behaviour = (tick, self, bot) => ({ ...circleWalker(tick, self, bot), buttons: BUTTON.FIRE * (tick % 15 < 2 ? 1 : 0) | (tick % 90 < 45 ? BUTTON.AIM : 0), aimElev: 0.4, weapon: WEAPON.PISTOL });
      const bot = await Bot.joinById(URL, room.roomId, "gunner", shooting);
      bot.room.onMessage("shot", () => n++);
      for (const m of ["hit", "sever", "impact", "boom", "notice", "hitmark"]) bot.room.onMessage(m, () => undefined);
      bot.start();
      const feed = setInterval(() => combat.give(bot.room.sessionId), 400);
      await sleep(6000);
      clearInterval(feed);
      const stats = await bot.stop();
      results[`shooting_prediction_rtt${rtt}`] = { ...stats, shots: n };
      expect(n).toBeGreaterThan(6);
      expect(stats.correctionMax).toBeLessThan(0.05);
      expect(stats.correctionMean).toBeLessThan(0.01);
      await colyseus.cleanup();
    }
  }, 60000);

  it("a hit shoves the victim through the server, and prediction absorbs it: the correction is bounded and the run carries on (measured)", async () => {
    colyseus.server.simulateLatency(100);
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED })) as unknown as WorldRoom;
    const runner = await Bot.joinById(URL, room.roomId, "runner", circleWalker);
    for (const m of ["hit", "sever", "impact", "boom", "notice", "hitmark", "shot"]) runner.room.onMessage(m, () => undefined);
    runner.start();
    await sleep(2500);
    const id = runner.room.sessionId;
    const combat = (room as unknown as { combat: Combat }).combat;
    void combat;
    for (let i = 0; i < 4; i++) {
      room.damagePlayer(id, 12, { zone: 1, dirX: 1, dirZ: 0 });
      const p = room.state.players.get(id)!;
      p.vx += 3;
      p.stumble = 0.4;
      await sleep(900);
    }
    const stats = await runner.stop();
    results["knock_prediction_rtt100"] = stats;
    expect(stats.correctionMax).toBeLessThan(1.0);
    expect(COMBAT.maxKnock).toBeGreaterThan(0);
  }, 60000);
});
