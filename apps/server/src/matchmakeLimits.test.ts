import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { configureLogger } from "./log.ts";

// one port per integration test file (vitest runs files in parallel)
const PORT = 2607;

describe("room creation limits (security review, D-048)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    // production-shaped limits on a test server: one trusted proxy, two creates per address, four live rooms
    const server = createGameServer(loadConfig({ NODE_ENV: "test", TRUST_PROXY_HOPS: "1", ROOM_CREATE_BURST: "2", ROOM_CREATE_EVERY_S: "3600", MAX_ROOMS: "4" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());

  let forged = 0;
  /** A create from `client`, behind one proxy, with a fresh made-up address in front each time (what the old limiter keyed on). */
  const create = (client: string) =>
    colyseus.http.post(`/matchmake/create/${ROOM_WORLD}`, {
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${++forged}, ${client}` },
      body: { name: "t" },
    });

  it("an address gets its burst of new rooms and then 429, however it forges the forwarded chain; another address is unaffected; past the cap, 503 for everybody", async () => {
    expect((await create("198.51.100.7")).data).toHaveProperty("roomId");
    expect((await create("198.51.100.7")).data).toHaveProperty("roomId");
    await expect(create("198.51.100.7")).rejects.toMatchObject({ statusCode: 429 });
    expect((await create("198.51.100.8")).data).toHaveProperty("roomId");
    expect((await create("198.51.100.9")).data).toHaveProperty("roomId");
    // four rooms live: the next is refused whoever asks, and it is not counted against them
    await expect(create("198.51.100.10")).rejects.toMatchObject({ statusCode: 503 });
    const m = (await colyseus.http.get("/metrics")).data as { rooms: number };
    expect(m.rooms).toBe(4);
  }, 60_000);

  it("the join-code lookup limiter keys on the same trusted address: forging the front of the chain does not buy more lookups", async () => {
    const look = (client: string) => colyseus.http.get("/campaign/ABCDE", { headers: { "x-forwarded-for": `203.0.113.${++forged}, ${client}` } }).then(() => 0, (e: { statusCode: number }) => e.statusCode);
    const got: number[] = [];
    for (let i = 0; i < 12; i++) got.push(await look("192.0.2.44"));
    expect(got.slice(0, 10).every((c) => c === 404)).toBe(true);
    expect(got.slice(10)).toEqual([429, 429]);
    expect(await look("192.0.2.45")).toBe(404);
  });
});
