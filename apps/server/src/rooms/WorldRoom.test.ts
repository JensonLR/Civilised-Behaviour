import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, MoveInput, ROOM_WORLD, WorldState, axisToWire, yawToWire } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WorldRoom (integration)", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    configureLogger("error", { silent: true });
    colyseus = await boot(createGameServer(loadConfig({ NODE_ENV: "test" } as never)));
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  it("spawns joined players with sanitised names and unique slots", async () => {
    const room = await colyseus.createRoom(ROOM_WORLD, {});
    const a = await colyseus.connectTo(room, { name: "  Sir\u0000 Reginald   Blunt-Wittering-Smythe the Third  " });
    const b = await colyseus.connectTo(room, { name: "Ada" });
    await room.waitForNextPatch();
    expect(room.state.players.size).toBe(2);
    const pa = room.state.players.get(a.sessionId)!;
    const pb = room.state.players.get(b.sessionId)!;
    expect(pa.name.length).toBeLessThanOrEqual(20);
    expect(pa.name).not.toContain("\u0000");
    expect(pa.slot).not.toBe(pb.slot);
    expect(room.state.code).toMatch(/^[A-Z2-9]{5}$/);
  });

  it("moves a player from streamed input and stays authoritative", async () => {
    const room = await colyseus.createRoom(ROOM_WORLD, { seed: 1234 });
    const client = await colyseus.connectTo(room, { name: "Runner" });
    const input = client.input({ type: MoveInput, mode: "reliable" });
    const p = room.state.players.get(client.sessionId)!;
    const startZ = p.z;
    for (let i = 0; i < 40; i++) {
      input.data.moveF = axisToWire(1);
      input.data.yaw = yawToWire(0);
      input.data.buttons = BUTTON.SPRINT;
      input.send();
      await sleep(1000 / 30);
    }
    await sleep(150);
    expect(p.z).toBeLessThan(startZ - 3);
  });

  it("clamps hostile input values (NaN / out of range) instead of crashing", async () => {
    const room = await colyseus.createRoom(ROOM_WORLD, { seed: 9 });
    const client = await colyseus.connectTo(room, { name: "Hax" });
    const input = client.input({ type: MoveInput, mode: "reliable" });
    const p = room.state.players.get(client.sessionId)!;
    for (let i = 0; i < 30; i++) {
      input.data.moveF = 127;
      input.data.moveR = -128;
      input.data.buttons = 0xffff;
      input.send();
      await sleep(1000 / 30);
    }
    // 30 frames at sprint speed cannot exceed ~7 m/s * 1 s; a speed hack would.
    const moved = Math.hypot(p.x - 3 * Math.cos(Math.PI / 4), p.z - 3 * Math.sin(Math.PI / 4));
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(moved).toBeLessThan(12);
  });

  it("keeps a dropped player's slot and lets them reconnect", async () => {
    const room = await colyseus.createRoom(ROOM_WORLD, {});
    const client = await colyseus.connectTo(room, { name: "Flaky" });
    const sid = client.sessionId;
    const token = client.reconnectionToken;
    client.connection.transport.close(4500, "network drop"); // any code except 4000 (CloseCode.CONSENTED = deliberate leave)
    await sleep(200);
    expect(room.state.players.get(sid)?.connected).toBe(false);
    const back = await colyseus.sdk.reconnect(token);
    await sleep(100);
    expect(back.sessionId).toBe(sid);
    expect(room.state.players.get(sid)?.connected).toBe(true);
  });

  it("refuses a fifth player", async () => {
    const room = await colyseus.createRoom(ROOM_WORLD, {});
    for (let i = 0; i < 4; i++) await colyseus.connectTo(room, { name: `P${i}` });
    await expect(colyseus.connectTo(room, { name: "Extra" })).rejects.toBeTruthy();
    expect(room.state.players.size).toBe(4);
  });

  it("world state schema is the shared one", () => {
    expect(new WorldState().players.size).toBe(0);
  });
});

describe("join-by-code endpoint", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    colyseus = await boot(createGameServer(loadConfig({ NODE_ENV: "test" } as never)));
  });
  afterAll(async () => colyseus.shutdown());

  it("resolves a private campaign by code and rejects junk", async () => {
    const room = await colyseus.createRoom(ROOM_WORLD, {});
    await sleep(50);
    const ok = await colyseus.http.get(`/campaign/${room.state.code.toLowerCase()}`);
    expect(ok.data).toMatchObject({ roomId: room.roomId });
    await expect(colyseus.http.get("/campaign/NOPE!")).rejects.toMatchObject({ statusCode: 400 });
    await expect(colyseus.http.get("/campaign/ZZZZZ")).rejects.toMatchObject({ statusCode: 404 });
  });
});
