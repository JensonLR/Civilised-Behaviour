import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MoveInput, yawToWire } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "../rooms/WorldRoom.ts";
import { Bot, type Behaviour } from "./Bot.ts";

const PORT = 2576; // one port per integration test file
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown> = {};

describe("netcode with casualties", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    mkdirSync("../../test-results", { recursive: true });
    writeFileSync("../../test-results/casualty-net.json", JSON.stringify(results, null, 2));
    await colyseus.shutdown();
  });

  const idle: Behaviour = () => ({ moveF: 0, moveR: 0, yaw: 0, buttons: 0 });

  it.each([0, 120])("a player being dragged stays in sync with the server (prediction drift) at %i ms RTT", async (rtt) => {
    colyseus.server.simulateLatency(rtt);
    // Dragger: waits, presses GRAB once, then walks a wide arc in the flat clearing.
    const dragger: Behaviour = (tick) => {
      if (tick === 100) return { moveF: 0, moveR: 0, yaw: 0, buttons: BUTTON.GRAB };
      if (tick < 110) return { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };
      return { moveF: 1, moveR: 0, yaw: ((tick - 110) / 30) * 0.25, buttons: 0 };
    };
    const victim = await Bot.create(URL, "victim", idle);
    const roomId = victim.room.roomId;
    const room = colyseus.getRoomById<WorldRoom>(roomId);
    const puller = await Bot.joinById(URL, roomId, "puller", dragger);
    victim.start();
    puller.start();
    await sleep(800);
    // Stage: victim goes down; the puller is placed beside them facing them.
    const v = room.state.players.get(victim.room.sessionId)!;
    const p = room.state.players.get(puller.room.sessionId)!;
    room.damagePlayer(victim.room.sessionId, 1000);
    p.x = v.x;
    p.z = v.z + 1;
    p.y = v.y;
    p.facing = 0;
    p.vx = p.vz = 0;
    await sleep(5500);
    const dragged = (v.flags & FLAG.DRAGGED) !== 0;
    const moved = Math.hypot(v.x - p.x, v.z - p.z);
    const stats = await victim.stop();
    await puller.stop();
    results[`dragged_rtt${rtt}`] = { ...stats, draggedAtEnd: dragged, gapToPuller: moved };
    expect(dragged).toBe(true);
    expect(moved).toBeLessThan(2.5); // body is following, not left behind
    // Measured 2026-09-29: 0 ms -> mean 0.012 / max 0.27 m; 120 ms -> mean 0.053 / max 1.07 m (worst case is the moment
    // pulling starts: the server suddenly steers a body the client predicted as stationary). Bounds leave headroom over
    // that; a broken dragged-step (e.g. not integrating server velocity) produces means above 0.5 m.
    expect(stats.correctionMean).toBeLessThan(rtt === 0 ? 0.05 : 0.12);
    if (rtt === 0) expect(stats.correctionMax).toBeLessThan(0.7);
    else {
      // D-047: the worst correction is ONE snap, the moment pulling starts (the server moves a body the client predicted still, and the client hears of it a round trip later),
      // so its size is the drag speed times that delay: whole server ticks (0.27 m each), 4..5 of them here, 7 on a loaded CI runner (1.87 m against the old 1.6 m bar: the bar sat
      // on the expected value and timing decided it). What the test is for, a dragged body that does not track, shows AFTER the onset: so the snap is bounded by the body's
      // own reach and confined to the first second, and the tracking after it is held far tighter than the old bar ever held it (measured: nothing over 0.2 m after the onset).
      const big = stats.corrections.filter((c) => c.mag > 0.7);
      const onset = big[0]?.tick ?? stats.corrections.find((c) => c.mag > 0.2)?.tick ?? 0;
      expect(stats.correctionMax, "the onset snap is within the body's reach").toBeLessThan(2.5);
      for (const c of big) expect(c.tick - onset, `a ${c.mag.toFixed(2)} m correction at tick ${c.tick}, ${c.tick - onset} after the onset`).toBeLessThan(30);
      const steady = stats.corrections.filter((c) => c.tick > onset + 30);
      expect(steady.length, "the drag ran long enough to judge").toBeGreaterThan(20);
      expect(Math.max(0, ...steady.map((c) => c.mag)), "steady tracking after the first second").toBeLessThan(0.35);
    }
  });

  it("MEASURE: input-frame flooding vs movement speed", async () => {
    colyseus.server.simulateLatency(0);
    const room = (await colyseus.createRoom("world", { seed: 3 })) as unknown as WorldRoom;
    const keepAlive = await colyseus.connectTo(room as never, { name: "keepalive" }); // an empty room is disposed
    const dist = async (perStep: number) => {
      const c = await colyseus.connectTo(room as never, { name: `flood${perStep}` });
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as { data: { moveF: number; buttons: number; yaw: number }; send(): void };
      const me = room.state.players.get(c.sessionId)!;
      me.x = 0;
      me.z = 0;
      await sleep(100);
      let x0Override = 0;
      let z0Override = 0;
      // Drain the burst allowance first (the bucket starts full for genuine hitches), then measure the steady state.
      const pump = async (ms: number) => {
        const stop = Date.now() + ms;
        while (Date.now() < stop) {
          for (let k = 0; k < perStep; k++) {
            input.data.moveF = 127;
            input.data.yaw = yawToWire(-Math.PI / 2); // camera toward +X: open ground (north is the stone wall at z=-12)
            input.send();
          }
          await sleep(33);
        }
      };
      await pump(1500);
      me.x = 0; // reset position (the arena is bounded), keep the drained bucket
      me.z = 0;
      const x1 = me.x;
      const z1 = me.z;
      await pump(3000);
      await sleep(200);
      x0Override = x1;
      z0Override = z1;
      const d = Math.hypot(me.x - x0Override, me.z - z0Override);
      await c.leave(true);
      return d;
    };
    const normal = await dist(1);
    const flood = await dist(3);
    results.flood = { normal, flood, ratio: flood / normal };
    expect(normal).toBeGreaterThan(3);
    // Server input budget (WorldRoom INPUT_BUDGET_*): flooding 3x frames must not buy more than the 5% drift allowance.
    // (Before the budget existed this ratio measured 1.31.)
    expect(flood / normal).toBeLessThan(1.12);
    await keepAlive.leave(true);
  });
});
