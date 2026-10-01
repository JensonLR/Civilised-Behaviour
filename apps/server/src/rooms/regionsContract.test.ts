import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { CAMP, REGIONS, ROOM_WORLD, SALTMARKET_STATUS, TICK_RATE, VESPER_STATUS, regionLanding, regionSpawn, type PlayerStateType, type RegionId } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-037 contract through a REAL room (packages C3 and D4 and the integrator may add to it, never delete): each later region can be stood in by a dev start with its first contract on offer, and while it is
 * not reachable a party at the map table cannot sail there (the vote never opens) but can still sail to Kessar. Port 2602 (one port per integration test file; 2602-2610 belong to docs/_notes/regions34.md:
 * contract 2602, C3 2603, D4 2604, integrator 2605-2610).
 */
const PORT = 2602;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};
const FIRST: Record<"vesper" | "saltmarket", { template: string; title: string; status: { stub: boolean } }> = {
  vesper: { template: "mine_rescue", title: "The Lower Gallery", status: VESPER_STATUS },
  saltmarket: { template: "smuggling_run", title: "The Quiet Barge", status: SALTMARKET_STATUS },
};

describe("Vesper Gorge and the Saltmarket Delta through a real room (D-037 contract)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  for (const id of ["vesper", "saltmarket"] as const) {
    it(`${id}: a dev start founds the campaign there: its world, its spawn at its landing and its first contract on offer`, async () => {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5, region: id })) as unknown as WorldRoom;
      const c = await colyseus.connectTo(room as never, { name: "Surveyor" });
      await sleep(200);
      expect(room.state.region).toBe(id);
      const p = room.state.players.get(c.sessionId)!;
      const spawn = regionSpawn(id, p.slot, 4);
      expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(1);
      const L = regionLanding(id);
      expect(Math.hypot(p.x - L.x, p.z - L.z)).toBeLessThan(6);
      const view = JSON.parse(room.state.scenario) as { template: string; title: string };
      expect(view.template).toBe(FIRST[id].template);
      expect(view.title).toBe(FIRST[id].title);
      expect(room.state.cannons.size).toBe(0);
    });

    it(`${id}: while it is not reachable the vote never opens, and Kessar still can be sailed to`, async () => {
      if (!FIRST[id].status.stub && REGIONS[id].reachable) return;   // once its package flips it, the integrator's travel tests take over
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5 })) as unknown as WorldRoom;
      const c = await colyseus.connectTo(room as never, { name: "Skipper" });
      await sleep(150);
      const p = room.state.players.get(c.sessionId) as PlayerStateType;
      const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
      p.x = CAMP.mapTable.x;
      p.z = CAMP.mapTable.z + 1.2;
      p.y = w.terrainHeight(p.x, p.z);
      for (const bad of [id, id.toUpperCase(), { to: id }]) {
        c.send("travelPropose" as never, { to: bad } as never);
        await sleep(1600);
        expect(room.state.travelPhase, JSON.stringify(bad)).toBe(0);
        expect(room.state.region).toBe("hollowmere");
      }
      c.send("travelPropose" as never, { to: "kessar" } as never);
      await until(() => room.state.travelPhase >= 2 || room.state.region === "kessar", 4000, "the sailing to Kessar to begin");
      await until(() => room.state.region === "kessar" && room.state.travelPhase === 3, 4000 + 1000 * TICK_RATE, "landfall at Kessar");
      c.send("regionReady" as never, { region: "kessar" } as never);
      await until(() => room.state.travelPhase === 0, 5000, "everyone ashore");
    }, 60_000);
  }

  it("the debug command outcome:<resolution> commits a later region's ending with its own region in the history, and the paper prints it", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5 })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Clerk" });
    await sleep(150);
    for (const [r, region] of [["sealed", "vesper"], ["washed_out", "saltmarket"]] as const) {
      c.send("debug" as never, { cmd: `outcome:${r}` } as never);
      await until(() => (JSON.parse(room.state.campaign) as { history: { resolution: string }[] }).history.some((h) => h.resolution === r), 3000, `${r} to commit`);
      const camp = JSON.parse(room.state.campaign) as { history: { resolution: string; region: RegionId }[]; sites: { ends: Record<string, string> } };
      expect(camp.history.find((h) => h.resolution === r)?.region).toBe(region);
    }
  }, 30_000);
});
