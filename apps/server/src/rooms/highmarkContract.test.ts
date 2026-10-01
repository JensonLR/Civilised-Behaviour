import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { CAMP, HIGHMARK_ANCHORS, HIGHMARK_STATUS, REGIONS, ROOM_WORLD, TICK_RATE, regionSpawn, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-036 contract through a REAL room (package G and the integrator may add to it, never delete): Highmark can be stood in by a dev start with the stub's contract on offer, and
 * while it is not reachable a party at the map table cannot sail there (the vote never opens) but can still sail to Kessar. Port 2586 (one port per integration test file; 2583-2590 are free for the packages: Q uses 2583-2585, G 2587-2588).
 */
const PORT = 2586;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};

describe("Highmark through a real room (D-036 contract)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  it("a dev start founds the campaign at Highmark: its world, its spawn and the succession on offer", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5, region: "highmark" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Surveyor" });
    await sleep(200);
    expect(room.state.region).toBe("highmark");
    const p = room.state.players.get(c.sessionId)!;
    const spawn = regionSpawn("highmark", p.slot, 4);
    expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(1);
    expect(Math.hypot(p.x - HIGHMARK_ANCHORS.landing.x, p.z - HIGHMARK_ANCHORS.landing.z)).toBeLessThan(6);
    const view = JSON.parse(room.state.scenario) as { template: string; title: string };
    expect(view.template).toBe("succession_dispute");
    expect(view.title).toBe("The Vacant Chair");
    expect(room.state.cannons.size).toBe(0);
  });

  it("while Highmark is not reachable the vote never opens, and Kessar still can be sailed to", async () => {
    if (!HIGHMARK_STATUS.stub && REGIONS.highmark.reachable) return;   // once G flips it, the integrator's travel tests take over
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5 })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Skipper" });
    await sleep(150);
    const p = room.state.players.get(c.sessionId) as PlayerStateType;
    const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    p.x = CAMP.mapTable.x;
    p.z = CAMP.mapTable.z + 1.2;
    p.y = w.terrainHeight(p.x, p.z);
    for (const bad of ["highmark", "HIGHMARK", { to: "highmark" }]) {
      c.send("travelPropose" as never, { to: bad } as never);
      await sleep(Math.ceil(1600));
      expect(room.state.travelPhase, JSON.stringify(bad)).toBe(0);
      expect(room.state.region).toBe("hollowmere");
    }
    c.send("travelPropose" as never, { to: "kessar" } as never);
    await until(() => room.state.travelPhase >= 2 || room.state.region === "kessar", 4000, "the sailing to Kessar to begin");
    await until(() => room.state.region === "kessar" && room.state.travelPhase === 3, 4000 + 1000 * TICK_RATE, "landfall at Kessar");
    c.send("regionReady" as never, { region: "kessar" } as never);
    await until(() => room.state.travelPhase === 0, 5000, "everyone ashore");
  }, 60_000);
});
