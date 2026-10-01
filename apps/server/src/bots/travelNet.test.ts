import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { CAMP, KESSAR_ANCHORS as A, ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "../rooms/WorldRoom.ts";
import { Bot, type Behaviour } from "./Bot.ts";
import { sail } from "./travel.ts";

const PORT = 2593; // one port per integration test file
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stands still at HQ; once ashore in Kessar Reach, walks north up the road. */
const walkInKessar: Behaviour = (_tick, _self, bot) => {
  const s = bot.room.state;
  const ashore = s.region === "kessar" && s.travelPhase === 0;
  return { moveF: ashore ? 1 : 0, moveR: 0, yaw: 0, buttons: 0 };
};

describe("the sailing, from a client's point of view (prediction across a region change)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  it("a bot sails out (slow to build the new shore), lands on the ring, walks Kessar's road and stays in step with the server", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 55 })) as unknown as WorldRoom;
    const bot = await Bot.joinById(URL, room.roomId, "Sailor", walkInKessar);
    bot.start();
    await sleep(1500);
    const me = room.state.players.get(bot.room.sessionId)!;
    me.x = CAMP.mapTable.x;
    me.z = CAMP.mapTable.z + 1.2;
    await sleep(500);

    await sail(bot, "kessar", { buildMs: 700 });
    expect(room.state.region).toBe("kessar");
    expect(Math.hypot(me.x - A.landing.x, me.z - A.landing.z)).toBeLessThan(8);
    const startZ = me.z;
    await sleep(3500); // walking the road in the region the bot's own prediction has rebuilt
    expect(me.z).toBeLessThan(startZ - 6); // it actually went north (inputs are taken again once ashore)
    const pred = bot.predicted!;
    // the prediction walked the same ground as the server: no drift from a stale world
    expect(Math.hypot(pred.x - me.x, pred.z - me.z)).toBeLessThan(0.5);
    expect(bot.world.boundsRadius).toBe(A.bounds);
    const stats = await bot.stop();
    expect(stats.driftEma).toBeLessThan(0.5);
  }, 40000);

  it("a client that joins while the party is already in Kessar lands in Kessar", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 55, region: "kessar" })) as unknown as WorldRoom;
    const bot = await Bot.joinById(URL, room.roomId, "Latecomer", walkInKessar);
    expect(room.state.region).toBe("kessar");
    const me = room.state.players.get(bot.room.sessionId)!;
    expect(Math.hypot(me.x - A.landing.x, me.z - A.landing.z)).toBeLessThan(8);
    expect(bot.world.boundsRadius).toBe(A.bounds);
    await bot.stop();
  });
});
