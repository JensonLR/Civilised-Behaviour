import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import WebSocket from "ws";
import { ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { configureLogger } from "./log.ts";
import { createOriginPolicy } from "./origins.ts";

const GOOD = "https://cb-client-42gz.onrender.com";
const EVIL = "https://evil.example";
// Each integration test file needs its own port: vitest runs files in parallel workers.
const PORT = 2571;

describe("createOriginPolicy", () => {
  it("is open when no origins are configured (dev/test)", () => {
    const p = createOriginPolicy([]);
    expect(p.allows(EVIL)).toBe(true);
    expect(p.allows(undefined)).toBe(true);
  });
  it("allows exact matches case-insensitively, ignoring trailing slashes", () => {
    const p = createOriginPolicy([GOOD + "/"]);
    expect(p.allows(GOOD)).toBe(true);
    expect(p.allows(GOOD.toUpperCase())).toBe(true);
  });
  it("rejects other origins, subdomain tricks and 'null'; allows absent Origin (non-browser)", () => {
    const p = createOriginPolicy([GOOD]);
    expect(p.allows(EVIL)).toBe(false);
    expect(p.allows(GOOD + ".evil.example")).toBe(false);
    expect(p.allows("http://cb-client-42gz.onrender.com")).toBe(false); // scheme matters
    expect(p.allows("null")).toBe(false);
    expect(p.allows(undefined)).toBe(true);
    expect(p.allows(null)).toBe(true);
  });
  it("never reflects a disallowed origin in CORS", () => {
    const p = createOriginPolicy([GOOD]);
    expect(p.corsOrigin(EVIL)).toBe(GOOD);
    expect(p.corsOrigin(GOOD)).toBe(GOOD);
  });
});

describe("origin enforcement (integration)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    // boot() ignores its port argument for Server instances (always 2568), so listen ourselves.
    const server = createGameServer(loadConfig({ NODE_ENV: "test", ALLOWED_ORIGINS: GOOD } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());

  const create = (origin?: string) =>
    colyseus.http.post(`/matchmake/create/${ROOM_WORLD}`, {
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: { name: "t" },
    });

  it("matchmaking: allowed origin and no-origin succeed; foreign origin is refused", async () => {
    expect((await create(GOOD)).data).toHaveProperty("roomId");
    expect((await create()).data).toHaveProperty("roomId");
    await expect(create(EVIL)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("matchmaking: a text/plain cross-site POST (no CORS preflight) cannot create a room", async () => {
    const rooms = async () => (await colyseus.http.get("/metrics")).data.rooms as number;
    const n0 = await rooms();
    await expect(
      colyseus.http.post(`/matchmake/create/${ROOM_WORLD}`, {
        headers: { "content-type": "text/plain", origin: EVIL },
        body: JSON.stringify({ name: "blind" }),
      }),
    ).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(await rooms()).toBe(n0);
  });

  it("CORS headers only ever name the allowed origin, without credentials", async () => {
    const res = await colyseus.http.post(`/matchmake/create/${ROOM_WORLD}`, {
      headers: { "content-type": "application/json", origin: GOOD },
      body: { name: "t" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(GOOD);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("campaign lookup refuses foreign origins", async () => {
    await expect(colyseus.http.get("/campaign/ABCDE", { headers: { origin: EVIL } })).rejects.toMatchObject({ statusCode: 403 });
  });

  const upgrade = (origin: string | undefined) =>
    new Promise<string>(async (resolve) => {
      const seat = (await create()).data as { processId: string; roomId: string; sessionId: string };
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/${seat.processId}/${seat.roomId}?sessionId=${seat.sessionId}&skipHandshake=1`, {
        headers: origin ? { Origin: origin } : {},
      });
      ws.on("open", () => (ws.close(), resolve("open")));
      ws.on("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
      ws.on("error", () => resolve("error"));
    });

  it("websocket: cross-origin upgrade gets 403, allowed and absent origins connect", async () => {
    expect(await upgrade(EVIL)).toBe("http 403");
    expect(await upgrade(GOOD)).toBe("open");
    expect(await upgrade(undefined)).toBe("open");
  });
});
