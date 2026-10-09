import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MoveInput, PropKind, ROOM_WORLD, TRIG, VESPER_SITES, VESPER_TRIG, npcKey, type ParleyView, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-096: the Triangulation through a real room: the theodolite in its case (a prop of its own kind) lies on the ground by the wharf and is lifted by the room's own INTERACT; a round of angles at each station is taken
 * with it in your arms (and it stays in your arms); the triangle closes; with arms empty the Dirge-Master's parley enters the Guild's names, and the ending reaches the campaign. Port 2646.
 */
const PORT = 2646;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number }; send(): void };
type Camp = { purse: number; history: { resolution: string; region: string; template: string }[] };

describe("the Triangulation in a real room (D-096)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const view = (room: WorldRoom): { resolution?: string; objectives: { id: string; text: string; done: boolean }[] } => JSON.parse(room.state.scenario);
  const camp = (room: WorldRoom): Camp => JSON.parse(room.state.campaign) as Camp;
  const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(50);
    }
  };
  const press = async (h: Input, buttons: number): Promise<void> => {
    h.data.moveF = h.data.moveR = 0;
    h.data.buttons = buttons;
    h.send();
    await sleep(120);
    h.data.buttons = 0;
    h.send();
    await sleep(120);
  };

  it("lifts the theodolite, takes a round at each station with it in hand, closes the triangle, and buys the Guild's names at the Cloister", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "vesper", scenario: "triangulation" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    const parleys: { view?: ParleyView }[] = [];
    c.onMessage("parley", (m: never) => parleys.push(m));
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "notice", "saved", "cry", "bark", "gazette", "telegram"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(400);
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const world = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    expect(room.state.players.get(npcKey("dirge"))).toBeDefined();

    // the theodolite: on the ground by the wharf, where the template put it
    const T = VESPER_TRIG.theodolite;
    let crate = "";
    room.state.props.forEach((p, id) => { if (p.kind === PropKind.INSTRUMENT && Math.hypot(p.x - T.x, p.z - T.z) < 1.5) crate = id; });
    expect(crate, "the theodolite in its case").not.toBe("");
    const pr = room.state.props.get(crate)!;
    expect(Math.abs(pr.y - world.terrainHeight(pr.x, pr.z)), "on the ground").toBeLessThan(0.8);
    // a station with empty hands is not a round of angles
    const S = VESPER_TRIG.stations;
    c.send("debug", { cmd: `tp:${S[0]!.x + 1}:${S[0]!.z}:0` });
    await sleep(300);
    await press(input, BUTTON.INTERACT);
    expect(view(room).objectives[0]!.text).toMatch(/\(0\//);
    // lift it (facing 0 looks to -z: stand just south of it)
    c.send("debug", { cmd: `tp:${pr.x}:${pr.z + 1.1}:0` });
    await sleep(300);
    await press(input, BUTTON.INTERACT);
    await until(() => room.state.props.get(crate)?.holder === c.sessionId, 3000, "the crate in my arms");
    // the vigil station first, before the bell; then the other two
    for (const k of [1, 0, 2]) {
      c.send("debug", { cmd: `tp:${S[k]!.x + 1}:${S[k]!.z}:0` });
      await sleep(300);
      for (let i = 0; i < TRIG.foulPresses && !view(room).objectives[k]!.done; i++) {
        await press(input, BUTTON.INTERACT);
        await sleep(TRIG.coolS * 1000);
      }
      expect(view(room).objectives[k]!.done, `station ${k} booked`).toBe(true);
      expect(room.state.props.get(crate)?.holder, "the instrument stays in hand").toBe(c.sessionId);
      expect((me.flags & FLAG.CARRYING) !== 0).toBe(true);
    }
    // set it down at the Cloister door, then call on the Dirge-Master
    const D = room.state.players.get(npcKey("dirge"))!;
    c.send("debug", { cmd: `tp:${D.x + 3}:${D.z}:0` });
    await sleep(300);
    await press(input, BUTTON.INTERACT);
    await until(() => (me.flags & FLAG.CARRYING) === 0, 2000, "arms empty");
    me.x = D.x + 0.9;
    me.z = D.z;
    me.y = world.terrainHeight(me.x, me.z);
    await sleep(200);
    const before = parleys.length;
    await press(input, BUTTON.INTERACT);
    await until(() => parleys.slice(before).some((m) => m.view), 3000, "the Dirge-Master's parley");
    const v = parleys.slice(before).find((m) => m.view)!.view!;
    const i = v.options.findIndex((o) => /Guild's names/.test(o.label));
    expect(i).toBeGreaterThanOrEqual(0);
    c.send("parleyPick" as never, { option: i } as never);
    await until(() => view(room).resolution !== undefined, 4000, "the ending");
    expect(view(room).resolution).toBe("trig_guild");
    await until(() => camp(room).history.some((h) => h.template === "triangulation"), 4000, "the ending committed");
    expect(camp(room).history.at(-1)).toMatchObject({ region: "vesper", template: "triangulation", resolution: "trig_guild" });
    expect(Math.hypot(D.x - VESPER_SITES.dirgeMaster.x, D.z - VESPER_SITES.dirgeMaster.z)).toBeLessThan(3);
  }, 90_000);
});
