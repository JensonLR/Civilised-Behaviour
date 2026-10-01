import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { CAMP, DEMO, ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * The bounded web demo through a real room (D-036): the SERVER refuses a sailing to a region outside the demo (and a forged `to`), saves nothing even on a FILE store, refuses `resume`, and
 * closes every client with `DEMO.closeCode` when the session is over. `DEMO_SESSION_SECONDS=5` is honoured outside production only. Port 2601.
 */
const PORT = 2601;
const TOKEN = "3f2c1d0e-8b7a-4c6d-9e5f-1a2b3c4d5e6f";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};

describe("the demo, enforced by the server", () => {
  let colyseus: ColyseusTestServer;
  let dir: string;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    dir = mkdtempSync(join(tmpdir(), "cb-demo-"));
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1", DEMO_MODE: "1", DEMO_SESSION_SECONDS: "5", CAMPAIGN_STORE: "file", SAVE_DIR: dir, IDENTITY_PEPPER: "integration-pepper-0123456789" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  afterEach(async () => colyseus.cleanup());

  it("refuses Highmark and forged destinations, saves nothing, refuses resume, then closes everyone with the demo's code", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5, token: TOKEN })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Visitor", token: TOKEN });
    const notices: string[] = [];
    c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
    let closed: number | undefined;
    c.onLeave((code) => (closed = code));
    await sleep(150);
    const p = room.state.players.get(c.sessionId)!;
    p.x = CAMP.mapTable.x;
    p.z = CAMP.mapTable.z + 1.2;
    p.y = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world.terrainHeight(p.x, p.z);
    for (const bad of ["highmark", "HIGHMARK", { to: "highmark" }, null, 7, "kessar\u0000"]) {
      c.send("travelPropose" as never, { to: bad } as never);
      await sleep(1600);
      expect(room.state.travelPhase, JSON.stringify(bad)).toBe(0);
    }
    expect(notices.some((n) => /demonstration|licence/i.test(n))).toBe(true); // the refusal is explained once
    // nothing was saved: no record on a file store (a demo binds no saver)
    expect(readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json"))).toEqual([]);
    // resume is refused (the same error a stranger gets)
    await expect(colyseus.createRoom(ROOM_WORLD, { resume: "ABCDE", token: TOKEN })).rejects.toThrow();
    // the end of the session: every client is closed with the demo's code
    await until(() => closed !== undefined, 15_000, "the demo to end");
    expect(closed).toBe(DEMO.closeCode);
    expect(readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json"))).toEqual([]);
  }, 60_000);
});
