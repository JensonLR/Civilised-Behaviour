import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { decodeSpec } from "@cb/procedural";
import { ROOM_WORLD, ZONE, type CampaignState, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Grudges } from "../systems/Grudges.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-109 through a real room: a soldier remembered as maimed by the party comes back in the garrison with his nickname and a hook, says his piece when she comes near, the
 * column prints his return and, when she puts him down again, that too; the commit spends one of his returns. Port 2651.
 */
const PORT = 2651;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Inner = { grudges: Grudges; campaign: CampaignState };

describe("survivors with grudges in a real room (D-109)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(30);
    }
  };

  it("he comes back with a hook and a nickname, says his piece when she comes near, and the paper follows it", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["sever", "impact", "boom", "station", "parley", "saved", "cry", "hit", "hitmark", "shot", "lasso"]) c.onMessage(t, () => undefined);
    const notes: string[] = [];
    const barks: { id: string; k: string }[] = [];
    const column: { text: string; k: string }[] = [];
    c.onMessage("notice", (m: { text: string }) => void notes.push(m.text));
    c.onMessage("bark", (m: { id: string; k: string }) => void barks.push(m));
    c.onMessage("gazette", (m: { text: string; k: string }) => void column.push(m));
    await sleep(400);
    const inner = room as unknown as Inner;
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    // the nearest sentry lost his right arm to Ada yesterday
    c.send("debug", { cmd: "grudge:2" });
    await until(() => notes.some((t) => t.endsWith("remembers you.")), 3000, "the grudge planted");
    await until(() => inner.grudges.fielded !== undefined, 3000, "him fielded");
    const { key, grudge } = inner.grudges.fielded!;
    const him = room.state.players.get(key)! as PlayerStateType;
    expect(him.name).toContain('"Hook"');
    expect(decodeSpec(him.look)?.hook).toBe(2);
    expect(grudge.by).toBe("Ada");
    // she walks up (well within earshot, out of his sight line's reach of a fight): he says his piece, and the column prints it
    c.send("debug", { cmd: `tp:${him.x + 12}:${him.z + 12}:0` });
    await until(() => barks.some((b) => b.id === key && b.k === "grudge"), 5000, "his piece");
    await until(() => column.some((m) => m.k === "grudge" && m.text.includes("Hook") && m.text.includes("Ada")), 8000, "the column's line");
    expect(barks.filter((b) => b.k === "grudge")).toHaveLength(1);
    // she puts him down again
    room.damagePlayer(key, 1000, { zone: ZONE.TORSO, by: c.sessionId });
    await until(() => column.some((m) => m.k === "grudge_down"), 8000, "the second defeat in the column");
    const after = inner.grudges.settle({ ...inner.campaign, day: inner.campaign.day + 1 });
    expect(after.sites.grudges!.find((g) => g.lookSeed === grudge.lookSeed)!.returns).toBe(1);
    void me;
  }, 30_000);
});
