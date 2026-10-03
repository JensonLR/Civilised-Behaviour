import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ColyseusTestServer } from "@colyseus/testing";
import { HONOUR_TITLE, NPC, ROOM_WORLD, ZONE, parseCampaign, parseHonours } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { getRoomConfig } from "../roomConfig.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-055: honours through a real room on the file store: earned at a commit by the member's own deeds, worn as the title, saved, and worn again after a resume. Port 2615. */
const PORT = 2615;
const TOKEN = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean | Promise<boolean>, ms: number, what: string) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};

describe("honours in a real room (D-055)", () => {
  let colyseus: ColyseusTestServer;
  let dir = "";
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    dir = mkdtempSync(join(tmpdir(), "cb-honours-"));
    const server = createGameServer(loadConfig({ NODE_ENV: "test", IDENTITY_PEPPER: "integration-pepper-0123456789", CAMPAIGN_STORE: "file", SAVE_DIR: dir } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  }, 60_000);
  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the member who put the garrison down is the Terror of the Ledger; the title is saved with the campaign and worn again when it is resumed", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 4243, region: "kessar", token: TOKEN })) as unknown as WorldRoom;
    const code = room.state.code;
    const c = await colyseus.connectTo(room as never, { name: "Q", token: TOKEN });
    const notices: string[] = [];
    c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley", "saved"]) c.onMessage(t, () => undefined);
    const me = room.state.players.get(c.sessionId)!;
    expect(me.title).toBe("");
    const sentries = [...room.state.players.entries()].filter(([, p]) => p.npc === NPC.SENTRY);
    expect(sentries.length).toBeGreaterThanOrEqual(6);
    for (const [id] of sentries) room.damagePlayer(id, 1000, { zone: ZONE.TORSO, by: c.sessionId });
    await until(() => room.state.campaignRev > 0, 6000, "the outcome");
    expect(parseCampaign(room.state.campaign)!.history[0]!.resolution).toBe("forced");
    await until(() => me.title === HONOUR_TITLE.terror, 2000, "the title");
    await until(() => notices.some((n) => n.includes(`The Society's honours: Q, ${HONOUR_TITLE.terror}`)), 2000, "the honours in the debrief");

    await c.leave();
    await room.disconnect();
    const store = await getRoomConfig().persistence!.store();
    await until(async () => !!(await store.findByCode(code))?.sections.honours, 5000, "the honours saved");
    const rec = (await store.findByCode(code))!;
    const saved = parseHonours(rec.sections.honours!)!;
    expect(Object.values(saved.by)).toEqual([["terror"]]);
    expect(Object.keys(saved.by)).toEqual(rec.members); // keyed by the member's HMAC key, the one the membership list holds
    expect(JSON.stringify(rec)).not.toContain(TOKEN);

    const back = (await colyseus.createRoom(ROOM_WORLD, { resume: code, token: TOKEN })) as unknown as WorldRoom;
    const c2 = await colyseus.connectTo(back as never, { name: "Q", token: TOKEN });
    for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley", "saved"]) c2.onMessage(t, () => undefined);
    expect(back.state.players.get(c2.sessionId)!.title).toBe(HONOUR_TITLE.terror);
    // a stranger joining the same campaign is undecorated
    const c3 = await colyseus.connectTo(back as never, { name: "R", token: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b" });
    for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley", "saved"]) c3.onMessage(t, () => undefined);
    expect(back.state.players.get(c3.sessionId)!.title).toBe("");
    await c3.leave();
    await c2.leave();
    await back.disconnect();
  }, 60_000);
});
