import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { FLAG, MOUNT, MOUNT_PHASE, ROOM_WORLD, regionMountSpots } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "../rooms/WorldRoom.ts";
import { Bot } from "./Bot.ts";
import { mountRider } from "./mount.ts";

const PORT = 2595; // one port per integration test file
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a mounted ride through the REAL room: the client predicts it with the shared step and stays with the server", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  it("mounts at the stable, gallops west, jumps, dismounts: flags flip once each way, no riding drift, the dismount is the only (bounded) position correction", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 91 })) as unknown as WorldRoom;
    expect(room.state.mounts.size).toBe(3); // the stable: two horses and a wagon, from the first tick
    const spot = regionMountSpots("hollowmere").horses[0]!;
    const bot = await Bot.joinById(URL, room.roomId, "Rider", mountRider({ mountAt: 15, yaw: Math.PI / 2, gallop: [40, 125], jumps: [90], dismountAt: 150 }));
    const me = room.state.players.get(bot.room.sessionId)!;
    me.x = spot.x - 1.2; // west of the first horse, inside reach; the second horse and the wagon are further off
    me.z = spot.z;
    me.y = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world.terrainHeight(me.x, me.z);
    me.facing = 0;
    me.vx = me.vz = 0;
    await sleep(600);
    bot.start();

    let sawMounted = false;
    let topSpeed = 0;
    let predictedMounted = false;
    let riderRow = "";
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      await sleep(40);
      if ((me.flags & FLAG.MOUNTED) !== 0) {
        sawMounted = true;
        topSpeed = Math.max(topSpeed, Math.hypot(me.vx, me.vz));
        room.state.mounts.forEach((row, id) => {
          if (row.rider === bot.room.sessionId) riderRow = id;
        });
        if (Math.hypot(me.vx, me.vz) > MOUNT.gallopFlagAt) predictedMounted ||= (bot.predicted!.flags & FLAG.MOUNTED) !== 0; // at speed the client's own copy rides too
      } else if (sawMounted) break; // dismounted
    }
    await sleep(500);
    expect(sawMounted).toBe(true);
    expect(riderRow).not.toBe("");
    expect(predictedMounted).toBe(true);
    expect(topSpeed).toBeGreaterThan(MOUNT.gallopFlagAt); // a gallop, not a walker's sprint (6.6 m/s)
    expect(me.flags & (FLAG.MOUNTED | FLAG.GALLOPING | FLAG.HITCHED)).toBe(0); // the dismount cleared every mount bit
    expect(room.state.mounts.get(riderRow)!.rider).toBe("");
    expect(room.state.mounts.get(riderRow)!.phase).not.toBe(MOUNT_PHASE.ridden);

    const pr = bot.predicted!;
    expect(pr.flags & (FLAG.MOUNTED | FLAG.GALLOPING)).toBe(0); // the client's own copy dismounted too
    expect(Math.hypot(pr.x - me.x, pr.z - me.z)).toBeLessThan(0.6); // and it ends where the server is
    const stats = await bot.stop();
    // (the drift meter is not asserted: it sums raw field differences, and a MOUNTED flip is a 4096 in the `flags` field, which is not a position error)
    // mounting is a flag flip (no position); a throw or the dismount's deliberate 1 m placement are the only position corrections a ride can cost
    expect(stats.correctionMax).toBeLessThanOrEqual(1.5);
    expect(stats.correctionMean).toBeLessThan(0.1); // no riding error accumulates: the shared step replays exactly
    expect(stats.popMax).toBeLessThan(0.6); // nothing visibly snapped (the rendered rider never jumps more than the dismount's placement)
  }, 40000);
});
