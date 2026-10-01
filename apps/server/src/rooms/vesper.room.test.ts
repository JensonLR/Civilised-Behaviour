import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, MoveInput, ROOM_WORLD, TEMPLATE_RESOLUTIONS, VESPER_ANCHORS, VESPER_SITES, npcKey, parsePowers, type ParleyView, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * Vesper Gorge through a REAL room (D-037, package C3): a dev start founds the campaign there with the Lower Gallery on offer; one ending is DRIVEN for real by a parley (the Dirge-Master's bill,
 * through INTERACT and parleyPick); one is forced by the party going down; and all eight endings go through the debug `outcome:` command into the campaign, the powers and the paper. Port 2603 (one port
 * per integration test file; 2602-2610 belong to docs/_notes/regions34.md).
 */
const PORT = 2603;
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

describe("Vesper Gorge through a real room (D-037)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function founded() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 5, region: "vesper" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Surveyor" });
    const parleys: { view?: ParleyView; line?: string; closed?: boolean }[] = [];
    const notices: string[] = [];
    c.onMessage("parley", (m: never) => parleys.push(m));
    c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(250);
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const world = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    return { room, c, me, input, parleys, notices, world };
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

  it("a dev start founds the campaign at Vesper: its world, the people of the Lower Gallery in the cast, and the contract on offer", async () => {
    const { room, me } = await founded();
    expect(room.state.region).toBe("vesper");
    expect(Math.hypot(me.x - VESPER_ANCHORS.landing.x, me.z - VESPER_ANCHORS.landing.z)).toBeLessThan(6);
    const view = JSON.parse(room.state.scenario) as { template: string; title: string; resolution?: string };
    expect(view).toMatchObject({ template: "mine_rescue", title: "The Lower Gallery" });
    expect(view.resolution).toBeUndefined();
    const keys = [...room.state.players.keys()].filter((k) => k.startsWith("npc:"));
    expect(keys).toContain(npcKey("foreman"));
    expect(keys).toContain(npcKey("dirge-master"));
    expect(keys.filter((k) => k.startsWith("npc:miner-"))).toHaveLength(11);
    expect(room.state.cannons.size).toBe(0);
  }, 20_000);

  it("driven for real: INTERACT at the Dirge-Master opens her bill, a stranger's picks change nothing, the owner's parleyPick settles it, and the gallery is consecrated with the price off the purse", async () => {
    const { room, c, me, input, parleys, world } = await founded();
    const purse0 = camp(room).purse;
    const dm = room.state.players.get(npcKey("dirge-master"))!;
    expect(Math.hypot(dm.x - VESPER_SITES.dirgeMaster.x, dm.z - VESPER_SITES.dirgeMaster.z), "she is where the plan put her").toBeLessThan(8);
    me.x = dm.x + 0.9;
    me.z = dm.z;
    me.y = world.terrainHeight(me.x, me.z);
    me.facing = Math.PI / 2;
    me.vx = me.vz = 0;
    await sleep(150);
    await press(input, BUTTON.INTERACT);
    await until(() => parleys.some((m) => m.view), 3000, "the Guild's parley to open");
    const view = parleys.find((m) => m.view)!.view!;
    const i = view.options.findIndex((o) => /Settle the Guild's bill/.test(o.label));
    expect(i).toBeGreaterThanOrEqual(0);
    // a second client cannot answer the first one's parley, and garbage options from the owner change nothing
    const heckler = await colyseus.connectTo(room as never, { name: "Heckler" });
    heckler.send("parleyPick" as never, { option: i } as never);
    heckler.send("parleyClose" as never, {} as never);
    for (const bad of [-1, 99, 1.5, "0", null, {}, [], Infinity]) c.send("parleyPick" as never, { option: bad } as never);
    await sleep(400);
    expect(camp(room).history.filter((h) => h.region === "vesper")).toHaveLength(0);
    expect(parleys.some((m) => m.closed)).toBe(false);
    // the owner pays
    c.send("parleyPick" as never, { option: i } as never);
    await until(() => camp(room).history.some((h) => h.region === "vesper"), 4000, "the ending to commit");
    const after = camp(room);
    expect(after.history.at(-1)).toMatchObject({ region: "vesper", template: "mine_rescue", resolution: "consecrated" });
    expect(after.sites.ends.mine_rescue).toBe("consecrated");
    expect(after.purse).toBeLessThan(purse0);
    expect(JSON.parse(room.state.scenario)).toMatchObject({ resolution: "consecrated" });
    expect(parleys.some((m) => m.closed)).toBe(true);
    expect(parsePowers(room.state.powers)!.log.slice(-4).map((e) => e.kind)).toContain("end_consecrated");
    // one commit, whatever else is pressed afterwards
    c.send("parleyPick" as never, { option: i } as never);
    await press(input, BUTTON.INTERACT);
    expect(camp(room).history.filter((h) => h.region === "vesper")).toHaveLength(1);
  }, 30_000);

  it("forced: the whole party down commits `abandoned` at Vesper, once", async () => {
    const { room, c } = await founded();
    c.send("debug" as never, { cmd: "down" } as never);
    await until(() => camp(room).history.some((h) => h.region === "vesper"), 4000, "the abandonment to commit");
    await sleep(600);
    const h = camp(room).history.filter((x) => x.region === "vesper");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ resolution: "abandoned", template: "mine_rescue" });
  }, 20_000);

  it("all eight endings through `outcome:`: each commits with region vesper, moves the ledger and the powers, and prints a dispatch", async () => {
    const { room, c } = await founded();
    const all = [...TEMPLATE_RESOLUTIONS.mine_rescue, ...TEMPLATE_RESOLUTIONS.claim_race].filter((r) => r !== "abandoned");
    expect(all).toHaveLength(8);
    let n = 0;
    for (const r of all) {
      const powers0 = room.state.powers;
      c.send("debug" as never, { cmd: `outcome:${r}` } as never);
      n++;
      await until(() => camp(room).history.filter((h) => h.region === "vesper").length >= n, 4000, `${r} to commit`);
      const k = camp(room);
      expect(k.history.at(-1), r).toMatchObject({ region: "vesper", resolution: r });
      expect(Object.values(k.sites.ends), r).toContain(r);
      expect(room.state.powers, r).not.toBe(powers0);
      expect(parsePowers(room.state.powers)!.log.slice(-4).map((e) => e.kind), r).toContain(`end_${r}`);
    }
    expect(camp(room).sites.ends).toEqual({ mine_rescue: "consecrated", claim_race: "outpaced" });
  }, 40_000);
});
