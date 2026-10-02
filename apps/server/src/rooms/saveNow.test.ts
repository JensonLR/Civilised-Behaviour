import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_WORLD, type SavedMsg } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * The pause sheet's "Save now" / "Save and quit" (D-039): a `saveNow` writes the ledger and the sender hears `saved` with `asked: true`; a joiner is told at once whether the campaign
 * is kept (that message is sent in onJoin, before a test client can listen: the real client registers its handler as soon as the room object exists); the room rate-limits the button; a campaign made without a usable identity is not kept and says so (so the client never shows "Saved" for it).
 */
const TOKEN = "3f2c1d0e-8b7a-4c6d-9e5f-1a2b3c4d5e6f";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("saveNow", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", IDENTITY_PEPPER: "integration-pepper-0123456789" } as never));
    await server.listen(2595);
    colyseus = new ColyseusTestServer(server);
  }, 60000);
  afterAll(async () => {
    await colyseus.shutdown();
  });

  const connect = async (room: WorldRoom, token: string | undefined) => {
    const got: SavedMsg[] = [];
    const c = await colyseus.connectTo(room as never, { name: "Q", ...(token ? { token } : {}) });
    c.onMessage("saved", (m: SavedMsg) => got.push(m));
    for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley"]) c.onMessage(t, () => undefined);
    return { c, got };
  };
  const until = async (cond: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error("timed out");
      await sleep(20);
    }
  };

  it("a saved campaign answers saveNow with ok and a time, and the answer is addressed to the sender and marked asked", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { token: TOKEN })) as unknown as WorldRoom;
    const { c, got } = await connect(room, TOKEN);
    const before = Date.now();
    c.send("saveNow", {});
    await until(() => got.some((m) => m.asked));
    const answer = got.find((m) => m.asked)!;
    expect(answer).toMatchObject({ kept: true, ok: true, asked: true });
    expect(answer.at).toBeGreaterThanOrEqual(before - 5000);
    expect(answer.at).toBeLessThanOrEqual(Date.now());
  });

  it("the button is rate limited: a second press at once writes nothing new but is still answered", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { token: TOKEN })) as unknown as WorldRoom;
    const { c, got } = await connect(room, TOKEN);
    c.send("saveNow", {});
    await until(() => got.filter((m) => m.asked).length === 1);
    const at = got.find((m) => m.asked)!.at;
    c.send("saveNow", {});
    await until(() => got.filter((m) => m.asked).length === 2);
    expect(got.filter((m) => m.asked)[1]!.at).toBe(at);
  });

  it("a campaign without a usable identity is not kept, and says so", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, {})) as unknown as WorldRoom;
    const { c, got } = await connect(room, undefined);
    c.send("saveNow", {});
    await until(() => got.some((m) => m.asked));
    expect(got.find((m) => m.asked)).toMatchObject({ kept: false, asked: true });
  });

  it("a hostile payload is ignored (no throw, the room goes on)", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { token: TOKEN })) as unknown as WorldRoom;
    const { c, got } = await connect(room, TOKEN);
    c.send("saveNow", { x: "y".repeat(1500), nested: { a: [1, 2, { b: null }] }, t: 1e308 });
    await until(() => got.some((m) => m.asked));
    expect(room.state.code.length).toBe(5);
  });

  it("a resume that is refused carries an HTTP-valid status (Colyseus answers matchmaking with the code as the status; 4004 threw a RangeError and the client never saw the text)", async () => {
    let err: { code?: number; message?: string } | undefined;
    try {
      await colyseus.createRoom(ROOM_WORLD, { resume: "ZZZZ9", token: TOKEN });
    } catch (e) {
      err = e as { code?: number; message?: string };
    }
    expect(err?.message).toContain("No expedition by that code");
    expect(err?.code).toBeGreaterThanOrEqual(200);
    expect(err?.code).toBeLessThanOrEqual(599);
  });
});
