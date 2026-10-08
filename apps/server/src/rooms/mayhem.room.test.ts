import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { FLAG, NPC_SIDE, PropKind, ROOM_WORLD, parseCampaign, type ScenarioView } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-084: the casualty column, the Society's request and the Butcher's Bill through a real room. Port 2641 (one per integration test file). */
const PORT = 2641;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the Society's appetites (D-084)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const until = async (cond: () => boolean, ms: number, what: string) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };

  it("a keg stack among the Ward's sentries: the chain makes the column, the request rides the tracker, and the commit pays for the spectacle and keeps the bill", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 77, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Sapper" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "parley", "station", "saved", "cry"]) c.onMessage(t, () => undefined);
    const gazette: string[] = [];
    const notices: string[] = [];
    c.onMessage("gazette", (m: { text: string }) => gazette.push(m.text));
    c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
    await until(() => room.state.scenario !== "", 5000, "the contract");
    const view = JSON.parse(room.state.scenario) as ScenarioView;
    const req = view.objectives.find((o) => o.id === "society");
    expect(req?.optional).toBe(true);
    expect(req?.text).toMatch(/^For the /);

    // the Ward's sentries, and three kegs at the feet of the first (the column needs a chain of at least two)
    const sentries: string[] = [];
    room.state.players.forEach((p, id) => {
      if (p.npc !== 0 && NPC_SIDE[p.npc] === "ward" && (p.flags & FLAG.DOWNED) === 0) sentries.push(id);
    });
    expect(sentries.length).toBeGreaterThan(0);
    const s = room.state.players.get(sentries[0]!)!;
    const spawn = (room as unknown as { spawnPropAt(kind: number, x: number, z: number): string | undefined }).spawnPropAt.bind(room);
    const kegs = [spawn(PropKind.BARREL, s.x + 0.8, s.z), spawn(PropKind.BARREL, s.x - 0.8, s.z + 0.4), spawn(PropKind.BARREL, s.x, s.z - 0.9)].filter((k): k is string => !!k);
    expect(kegs.length).toBe(3);
    const purse0 = parseCampaign(room.state.campaign)!.purse;
    // the Sapper's shot finds the first keg (the room's own path for a shot keg: the others catch from it)
    (room as unknown as { propShot(id: string, shooter: string): void }).propShot(kegs[0]!, c.sessionId);
    await until(() => kegs.every((k) => !room.state.props.has(k)), 8000, "the stack gone up");
    await until(() => gazette.some((l) => /kegs?/.test(l)), 6000, "the column to report the chain");
    expect(gazette.length).toBeGreaterThanOrEqual(1);
    for (const l of gazette) expect(l).not.toMatch(/[{}]/);

    // the contract ends (the debug ending runs the real commit): the bill, the supplement, the paper's record
    c.send("debug", { cmd: "outcome:forced" });
    await until(() => notices.some((n) => n.includes("Butcher's Bill")), 5000, "the debrief");
    const debrief = notices.find((n) => n.includes("Butcher's Bill"))!;
    expect(debrief).toMatch(/a chain of 3|3 kegs/);
    expect(debrief).toMatch(/for spectacle/);
    const camp = parseCampaign(room.state.campaign)!;
    const bill = camp.sites.lastBill!;
    expect(bill).toBeDefined();
    expect(bill.bill.kegs).toBe(3);
    expect(bill.bill.chain).toBe(3);
    expect(bill.spectacle).toBeGreaterThanOrEqual(6);
    expect(camp.purse).toBeGreaterThanOrEqual(purse0 + bill.spectacle + 30); // (the remittance for a triumph, and the spectacle on top)
  }, 45_000);
});
