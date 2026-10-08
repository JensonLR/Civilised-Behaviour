import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { getRoomConfig } from "../roomConfig.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** Self-service erasure through the real server: a device forgets its own campaigns (PRIVACY_DATA_MAP). Port 2642 (one per integration test file). */
const PORT = 2642;
const TOKEN = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const GOOD = "https://play.example.test";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("self-service erasure", () => {
  let colyseus: ColyseusTestServer;
  const dir = mkdtempSync(join(tmpdir(), "cb-erase-"));
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", ALLOWED_ORIGINS: GOOD, CAMPAIGN_STORE: "file", SAVE_DIR: dir, IDENTITY_PEPPER: "erase-pepper-0123456789" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  const erase = (body: unknown, origin = GOOD) => colyseus.http.post("/privacy/erase", { headers: { "content-type": "application/json", origin, "x-forwarded-for": "198.51.100.7" }, body: body as never });

  it("a member's campaign is forgotten (a campaign left with nobody goes); the log never sees the token; junk, a foreign origin and a flood are refused", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 99, region: "kessar", token: TOKEN })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada", token: TOKEN });
    for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley", "saved"]) c.onMessage(t, () => undefined);
    const code = room.state.code;
    await sleep(300);
    await c.leave();
    await room.disconnect();
    const store = await getRoomConfig().persistence!.store();
    const end = Date.now() + 5000;
    while (!(await store.findByCode(code)) && Date.now() < end) await sleep(25);
    expect((await store.findByCode(code))?.members.length).toBe(1);

    await expect(erase({ identity: "not-a-token" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(erase({ identity: TOKEN }, "https://evil.example.test")).rejects.toMatchObject({ statusCode: 403 });
    const res = await erase({ identity: TOKEN });
    expect(res.data).toEqual({ ok: true, campaigns: 1 });
    expect(await store.findByCode(code)).toBeUndefined();
    // (asking again finds nothing, and the burst runs out)
    let limited = false;
    for (let i = 0; i < 5 && !limited; i++) {
      try {
        const again = await erase({ identity: TOKEN });
        expect(again.data.campaigns).toBe(0);
      } catch (e) {
        expect((e as { statusCode: number }).statusCode).toBe(429);
        limited = true;
      }
    }
    expect(limited).toBe(true);
  }, 30_000);
});
