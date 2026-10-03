import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { configureLogger } from "./log.ts";
import type { WorldRoom } from "./rooms/WorldRoom.ts";

// one port per integration test file (vitest runs files in parallel)
const PORT = 2608;

describe("QA levers are off without debug commands (security review, D-048)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "0" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());

  it("a creator cannot choose the world's seed (it seeds combat, casualties and the hire pool), nor the region or the contract", async () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 3; i++) {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 4242, region: "kessar", scenario: "outpost_raid", name: "t" })) as unknown as WorldRoom;
      expect(room.state.region).toBe("hollowmere");
      expect(room.state.scenario).toBe("");
      seeds.add(room.state.seed);
      await room.disconnect();
    }
    expect(seeds.has(4242)).toBe(false);
    expect(seeds.size).toBe(3);
  }, 60_000);
});
