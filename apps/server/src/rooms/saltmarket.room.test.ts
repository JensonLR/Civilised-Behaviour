import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, MoveInput, ROOM_WORLD, SALTMARKET_ANCHORS, SALTMARKET_SITES, TEMPLATE_RESOLUTIONS, npcKey, parsePowers, regionSpawn, type ParleyView, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * The Saltmarket Delta through a REAL room (D-037, package D4): a dev start founds the campaign there with either contract on offer; two endings are DRIVEN for real by parleys (the Tide-Reeve's informing,
 * through INTERACT and parleyPick; a consortium agreed with two House-Heads), one is forced by the party going down, and all eight endings go through the debug `outcome:` command into the campaign, the
 * powers and the paper. Port 2604 (one port per integration test file; 2602-2610 belong to docs/_notes/regions34.md).
 */
const PORT = 2604;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};
type Camp = { purse: number; history: { resolution: string; region: string; template: string }[]; sites: { ends: Record<string, string> } };
type Input = { data: { buttons: number; moveF: number }; send(): void };

describe("The Saltmarket Delta through a real room (D-037)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function founded(scenario?: string) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5, region: "saltmarket", ...(scenario ? { scenario } : {}) })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Factor" });
    const parleys: { view?: ParleyView; line?: string; closed?: boolean }[] = [];
    c.onMessage("parley", (m: never) => parleys.push(m));
    for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(250);
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const world = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    return { room, c, me, input, parleys, world };
  }
  const camp = (room: WorldRoom): Camp => JSON.parse(room.state.campaign) as Camp;
  const press = async (h: Input, buttons: number): Promise<void> => {
    h.data.buttons = buttons;
    h.send();
    await sleep(120);
    h.data.buttons = 0;
    h.send();
    await sleep(120);
  };
  const stand = (room: WorldRoom, me: PlayerStateType, world: { terrainHeight(x: number, z: number): number }, key: string): void => {
    const n = room.state.players.get(npcKey(key))!;
    me.x = n.x + 0.9;
    me.z = n.z;
    me.y = world.terrainHeight(me.x, me.z);
    me.facing = Math.PI / 2;
    me.vx = me.vz = 0;
  };

  it("a dev start founds the campaign at the delta: its world, its spawn at the quay, and The Quiet Barge on offer with its cast", async () => {
    const { room, me } = await founded("smuggling_run");
    expect(room.state.region).toBe("saltmarket");
    const spawn = regionSpawn("saltmarket", me.slot, 4);
    expect(Math.hypot(me.x - spawn.x, me.z - spawn.z)).toBeLessThan(1);
    expect(Math.hypot(me.x - SALTMARKET_ANCHORS.landing.x, me.z - SALTMARKET_ANCHORS.landing.z)).toBeLessThan(8);
    const view = JSON.parse(room.state.scenario) as { template: string; title: string; resolution?: string };
    expect(view).toMatchObject({ template: "smuggling_run", title: "The Quiet Barge" });
    expect(view.resolution).toBeUndefined();
    const keys = [...room.state.players.keys()].filter((k) => k.startsWith("npc:"));
    expect(keys).toContain(npcKey("reeve"));
    expect(keys.filter((k) => k.startsWith("npc:patrol-") || k.startsWith("npc:customs-"))).toHaveLength(4);
    expect(room.state.cannons.size).toBe(0);
  }, 20_000);

  it("the market is the other offer: the Exchange's Auctioneer, four House-Heads and the Syndicate's factor, in the hall", async () => {
    const { room } = await founded("flooded_market");
    expect(JSON.parse(room.state.scenario)).toMatchObject({ template: "flooded_market", title: "The Auction at High Water" });
    const keys = [...room.state.players.keys()].filter((k) => k.startsWith("npc:"));
    for (const id of ["auctioneer", "head-0", "head-1", "head-2", "head-3", "factor"]) expect(keys, id).toContain(npcKey(id));
    const a = room.state.players.get(npcKey("auctioneer"))!;
    expect(Math.hypot(a.x - SALTMARKET_SITES.auctioneer.x, a.z - SALTMARKET_SITES.auctioneer.z), "he is where the plan put him").toBeLessThan(8);
  }, 20_000);

  it("driven for real: INTERACT at the Tide-Reeve opens his parley, a stranger's picks and garbage options change nothing, the owner's pick informs on the barge and commits `informed` once", async () => {
    const { room, c, me, input, parleys, world } = await founded("smuggling_run");
    stand(room, me, world, "reeve");
    await sleep(150);
    await press(input, BUTTON.INTERACT);
    await until(() => parleys.some((m) => m.view), 3000, "the Reeve's parley to open");
    const view = parleys.find((m) => m.view)!.view!;
    const i = view.options.findIndex((o) => /Inform on your own barge/.test(o.label));
    expect(i).toBeGreaterThanOrEqual(0);
    const heckler = await colyseus.connectTo(room as never, { name: "Heckler" });
    heckler.send("parleyPick" as never, { option: i } as never);
    heckler.send("parleyClose" as never, {} as never);
    for (const bad of [-1, 99, 1.5, "0", null, {}, [], Infinity]) c.send("parleyPick" as never, { option: bad } as never);
    await sleep(400);
    expect(camp(room).history.filter((h) => h.region === "saltmarket")).toHaveLength(0);
    expect(parleys.some((m) => m.closed)).toBe(false);
    c.send("parleyPick" as never, { option: i } as never);
    await until(() => camp(room).history.some((h) => h.region === "saltmarket"), 4000, "the ending to commit");
    const after = camp(room);
    expect(after.history.at(-1)).toMatchObject({ region: "saltmarket", template: "smuggling_run", resolution: "informed" });
    expect(after.sites.ends.smuggling_run).toBe("informed");
    expect(JSON.parse(room.state.scenario)).toMatchObject({ resolution: "informed" });
    expect(parsePowers(room.state.powers)!.log.slice(-4).map((e) => e.kind)).toContain("end_informed");
    c.send("parleyPick" as never, { option: i } as never);
    await press(input, BUTTON.INTERACT);
    expect(camp(room).history.filter((h) => h.region === "saltmarket")).toHaveLength(1);
  }, 30_000);

  it("driven for real: two House-Heads agree to a consortium, one after the other, and the market commits `consortium`", async () => {
    const { room, c, me, input, parleys, world } = await founded("flooded_market");
    for (const head of ["head-0", "head-1"]) {
      const before = parleys.filter((m) => m.view).length;
      stand(room, me, world, head);
      await sleep(150);
      await press(input, BUTTON.INTERACT);
      await until(() => parleys.filter((m) => m.view).length > before, 3000, `${head}'s parley to open`);
      const view = [...parleys].reverse().find((m) => m.view)!.view!;
      const i = view.options.findIndex((o) => /Propose a consortium/.test(o.label));
      expect(i, head).toBeGreaterThanOrEqual(0);
      c.send("parleyPick" as never, { option: i } as never);
      await sleep(300);
    }
    await until(() => camp(room).history.some((h) => h.region === "saltmarket"), 4000, "the consortium to commit");
    expect(camp(room).history.at(-1)).toMatchObject({ region: "saltmarket", template: "flooded_market", resolution: "consortium" });
    expect(camp(room).sites.ends.flooded_market).toBe("consortium");
  }, 30_000);

  it("forced: the whole party down commits `abandoned` at the delta, once", async () => {
    const { room, c } = await founded("smuggling_run");
    c.send("debug" as never, { cmd: "down" } as never);
    await until(() => camp(room).history.some((h) => h.region === "saltmarket"), 4000, "the abandonment to commit");
    await sleep(600);
    const h = camp(room).history.filter((x) => x.region === "saltmarket");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ resolution: "abandoned", template: "smuggling_run" });
  }, 20_000);

  it("all eight endings through `outcome:`: each commits with region saltmarket, moves the ledger and the powers, and prints a dispatch", async () => {
    const { room, c } = await founded();
    const all = [...TEMPLATE_RESOLUTIONS.smuggling_run, ...TEMPLATE_RESOLUTIONS.flooded_market].filter((r) => r !== "abandoned");
    expect(all).toHaveLength(8);
    let n = 0;
    for (const r of all) {
      const powers0 = room.state.powers;
      c.send("debug" as never, { cmd: `outcome:${r}` } as never);
      n++;
      await until(() => camp(room).history.filter((h) => h.region === "saltmarket").length >= n, 4000, `${r} to commit`);
      const k = camp(room);
      expect(k.history.at(-1), r).toMatchObject({ region: "saltmarket", resolution: r });
      expect(Object.values(k.sites.ends), r).toContain(r);
      expect(room.state.powers, r).not.toBe(powers0);
      expect(parsePowers(room.state.powers)!.log.slice(-4).map((e) => e.kind), r).toContain(`end_${r}`);
    }
    expect(camp(room).sites.ends).toEqual({ smuggling_run: "informed", flooded_market: "washed_out" });
  }, 40_000);
});
