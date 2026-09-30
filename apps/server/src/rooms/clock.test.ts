import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_WORLD, WORLD_CLOCK, lightningAt, weatherAt, worldHours, type WorldStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2591; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The client-side copy of the room state (the test client is typed loosely). */
const stateOf = (client: unknown): WorldStateType => (client as { state: WorldStateType }).state;

describe("the server-owned world clock", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  it("publishes the start hour, the day length and the world's age (defaults: 09:00, a 30 minute day)", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5 })) as unknown as WorldRoom;
    const client = await colyseus.connectTo(room as never, { name: "Watcher" });
    await room.waitForNextPatch();
    for (const s of [room.state, stateOf(client)]) {
      expect(s.dayStartHour).toBe(WORLD_CLOCK.defaultStartHour);
      expect(s.dayMinutes).toBe(WORLD_CLOCK.defaultDayMinutes);
      expect(s.worldMs).toBeGreaterThanOrEqual(0);
      expect(s.worldMs).toBeLessThan(5000);
    }
  });

  it("two players who join at different moments see the same hour and the same weather", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 42 })) as unknown as WorldRoom;
    const a = await colyseus.connectTo(room as never, { name: "First" });
    await sleep(1300);
    const b = await colyseus.connectTo(room as never, { name: "Second" });
    const t1 = performance.now();
    await sleep(150);
    // the joiner's first state carries a FRESH age (not a value from up to four seconds ago), and the sync reaches the first player too
    const seenA = stateOf(a).worldMs;
    const seenB = stateOf(b).worldMs;
    expect(seenB).toBeGreaterThan(1250);
    expect(Math.abs(seenA - seenB)).toBeLessThan(300);
    // each client extrapolates from the moment it received the age; compare at one shared instant
    const now = performance.now();
    const ageA = seenA + (now - t1);
    const ageB = seenB + (now - t1);
    const start = stateOf(a).dayStartHour;
    const mins = stateOf(a).dayMinutes;
    const hA = worldHours(start, ageA, mins);
    const hB = worldHours(stateOf(b).dayStartHour, ageB, stateOf(b).dayMinutes);
    expect(Math.abs(hA - hB)).toBeLessThan(0.01); // 0.01 h = 36 s of game time; the truth is far tighter
    const seed = room.state.seed;
    expect(weatherAt(seed, ageA)).toEqual(weatherAt(stateOf(a).seed, ageA));
    expect(lightningAt(seed, ageB).flash).toBeGreaterThanOrEqual(0);
  });

  it("refreshes the world's age every few seconds without any client asking", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 3 })) as unknown as WorldRoom;
    const client = await colyseus.connectTo(room as never, { name: "Idle" });
    const first = stateOf(client).worldMs;
    await sleep(4600);
    expect(stateOf(client).worldMs - first).toBeGreaterThan(3500);
  }, 15000);
});

describe("clock configuration", () => {
  it("reads DAY_START_HOUR and DAY_MINUTES and rejects nonsense", () => {
    const c = loadConfig({ NODE_ENV: "test", DAY_START_HOUR: "18.5", DAY_MINUTES: "12" } as never);
    expect(c.dayStartHour).toBe(18.5);
    expect(c.dayMinutes).toBe(12);
    const d = loadConfig({ NODE_ENV: "test" } as never);
    expect(d.dayStartHour).toBe(9);
    expect(d.dayMinutes).toBe(30);
    expect(loadConfig({ NODE_ENV: "test", DAY_MINUTES: "0" } as never).dayMinutes).toBe(0);
    expect(() => loadConfig({ NODE_ENV: "test", DAY_START_HOUR: "25" } as never)).toThrow(/DAY_START_HOUR/);
    expect(() => loadConfig({ NODE_ENV: "test", DAY_MINUTES: "-4" } as never)).toThrow(/DAY_MINUTES/);
    expect(() => loadConfig({ NODE_ENV: "test", DAY_MINUTES: "abc" } as never)).toThrow(/DAY_MINUTES/);
  });
});

describe("a configured world", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DAY_START_HOUR: "18.5", DAY_MINUTES: "12" } as never));
    await server.listen(PORT + 1);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());

  it("starts at the configured hour", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, {})) as unknown as WorldRoom;
    const client = await colyseus.connectTo(room as never, { name: "Dusk" });
    expect(stateOf(client).dayStartHour).toBeCloseTo(18.5, 5);
    expect(stateOf(client).dayMinutes).toBe(12);
    expect(worldHours(stateOf(client).dayStartHour, 0, stateOf(client).dayMinutes)).toBeCloseTo(18.5, 4);
  });
});
