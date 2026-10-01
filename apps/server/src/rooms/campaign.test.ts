import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BODY_SHAPES,
  BUTTON,
  CAMP,
  COMBAT,
  hqPlan,
  FLAG,
  KESSAR_ANCHORS as A,
  MoveInput,
  NPC,
  PropKind,
  ROOM_WORLD,
  WEAPON,
  ZONE,
  createRegionWorld,
  elevToWire,
  generatePaper,
  npcKey,
  parseCampaign,
  weaponToWire,
  yawToWire,
  type CampaignState,
  type ParleyView,
  type PlayerStateType,
  type ScenarioView,
} from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2592; // one port per integration test file
const SEED = 2024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

describe("campaign: sail to Kessar Reach, settle the crossing, come home (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  interface Who {
    id: string;
    p: PlayerStateType;
    input: Input;
    send(type: string, msg: unknown): void;
    stations: { kind: string }[];
    parleys: { view?: ParleyView; line?: string; closed?: boolean }[];
  }

  async function setup(options: Record<string, unknown> = {}, n = 1) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, ...options })) as unknown as WorldRoom;
    const ps: Who[] = [];
    for (let i = 0; i < n; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const w: Who = {
        id: c.sessionId,
        p: room.state.players.get(c.sessionId)!,
        input: c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input,
        send: (type, msg) => c.send(type as never, msg as never),
        stations: [],
        parleys: [],
      };
      c.onMessage("station", (m: { kind: string }) => w.stations.push(m));
      c.onMessage("parley", (m: never) => w.parleys.push(m));
      for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark"]) c.onMessage(t, () => undefined);
      ps.push(w);
    }
    await sleep(150);
    return { room, ps };
  }

  const until = async (cond: () => boolean, ms = 4000, what = "condition") => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };
  const place = (room: WorldRoom, p: PlayerStateType, x: number, z: number, facing = 0) => {
    const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    p.x = x;
    p.z = z;
    p.y = w.terrainHeight(x, z);
    p.facing = facing;
    p.vx = p.vz = 0;
  };
  /** One input frame with the buttons held, then released (a rising edge on the server). */
  const press = async (who: Who, buttons: number, yaw = 0) => {
    const d = who.input.data;
    d.moveF = 0;
    d.moveR = 0;
    d.yaw = yawToWire(yaw);
    d.buttons = buttons;
    who.input.send();
    await sleep(120);
    d.buttons = 0;
    who.input.send();
    await sleep(120);
  };
  const campaignOf = (room: WorldRoom): CampaignState => parseCampaign(room.state.campaign)!;
  const scenarioOf = (room: WorldRoom): ScenarioView | undefined => (room.state.scenario ? (JSON.parse(room.state.scenario) as ScenarioView) : undefined);
  const npcRows = (room: WorldRoom): [string, PlayerStateType][] => [...room.state.players.entries()].filter(([, p]) => p.npc);
  const sail = async (room: WorldRoom, who: Who, to: string) => {
    who.send("travelPropose", { to });
    await until(() => room.state.travelPhase >= 2 || room.state.region === to, 3000, "the sailing to begin");
    await until(() => room.state.region === to && room.state.travelPhase === 3, 15000, `landfall at ${to}`);
    who.send("regionReady", { region: to });
    await until(() => room.state.travelPhase === 0, 3000, "everyone ashore");
  };

  it("a client leaves HQ from the map table, lands in Kessar Reach, pays the toll, and sails home to a paper that says so", async () => {
    const { room, ps } = await setup();
    const me = ps[0]!;
    expect(room.state.region).toBe("hollowmere");
    expect(room.state.cannons.size).toBeGreaterThan(0);
    const propsHome = room.state.props.size;
    const paperBefore = generatePaper(campaignOf(room), SEED).headline;

    // The map table opens the map room; the paper is pinned at the notice board.
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => me.stations.length > 0, 2000, "the station message");
    expect(me.stations[0]).toEqual({ kind: "map" });

    place(room, me.p, hqPlan().notice.x, hqPlan().notice.z + 1.2, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => me.stations.length > 1, 2000, "the notice board");
    expect(me.stations[1]).toEqual({ kind: "paper" });
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);

    await sail(room, me, "kessar");
    expect(room.state.region).toBe("kessar");
    expect(room.state.cannons.size).toBe(0); // the field gun stays at HQ
    expect(Math.hypot(me.p.x - A.landing.x, me.p.z - A.landing.z)).toBeLessThan(8);
    const cast = npcRows(room);
    expect(cast.length).toBeGreaterThanOrEqual(8); // 4+ sentries, the Warden, three of the Syndicate
    expect(cast.some(([, p]) => p.npc === NPC.WARDEN)).toBe(true);
    expect(scenarioOf(room)?.phase).toBe("approach");
    expect(campaignOf(room).history.length).toBe(0); // arriving changes nothing yet

    // The Lamp-Warden: INTERACT opens the parley, paying ends it, the campaign remembers.
    const warden = room.state.players.get(npcKey("warden"))!;
    place(room, me.p, warden.x, warden.z + 1.5, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => me.parleys.some((m) => m.view), 3000, "the parley to open");
    const view = me.parleys.find((m) => m.view)!.view!;
    const pay = view.options.findIndex((o) => o.id === "pay");
    expect(pay).toBeGreaterThanOrEqual(0);
    me.send("parleyPick", { option: pay });
    await until(() => room.state.campaignRev > 0, 3000, "the outcome to commit");
    const after = campaignOf(room);
    expect(after.history[0]).toMatchObject({ region: "kessar", resolution: "paid" });
    expect(after.crossing.control).toBe("ward");
    expect(after.crossing.toll).toBeGreaterThan(0);
    expect(scenarioOf(room)?.phase).toBe("resolved");
    expect(scenarioOf(room)?.resolution).toBe("paid");
    expect(me.parleys.some((m) => m.closed)).toBe(true);

    // Sail home from the dock; the garrison goes with the region, HQ comes back, the paper reports it.
    place(room, me.p, A.landing.x, A.landing.z - 1, 0);
    await sail(room, me, "hollowmere");
    expect(room.state.region).toBe("hollowmere");
    expect(npcRows(room).length).toBe(0);
    expect(room.state.cannons.size).toBeGreaterThan(0);
    expect(room.state.props.size).toBe(propsHome);
    expect(room.state.scenario).toBe("");
    expect(campaignOf(room).history.length).toBe(1); // the campaign survived the crossing of the water
    const paperAfter = generatePaper(campaignOf(room), SEED);
    expect(paperAfter.headline).not.toBe(paperBefore);
    expect(paperAfter.stories.map((s) => s.body).join(" ")).toContain(String(after.crossing.toll));
  }, 40000);

  it("hostile messages change nothing: far from the map, nonsense regions, out-of-phase and forged picks", async () => {
    const { room, ps } = await setup();
    const me = ps[0]!;
    place(room, me.p, 90, 90); // nowhere near the map table or the dock
    me.send("travelPropose", { to: "kessar" });
    await sleep(300);
    expect(room.state.travelPhase).toBe(0);
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    me.p.flags |= FLAG.DOWNED; // a downed comrade at the table cannot put the party to sea
    me.send("travelPropose", { to: "kessar" });
    await sleep(300);
    expect(room.state.travelPhase).toBe(0);
    me.p.flags &= ~FLAG.DOWNED;
    for (const bad of [{ to: "atlantis" }, { to: 7 }, { to: "hollowmere" }, {}, null, "kessar"]) me.send("travelPropose", bad);
    me.send("regionReady", { region: "kessar" });
    me.send("travelReady", { ready: true });
    me.send("travelCancel", {});
    me.send("parleyPick", { option: 0 });
    me.send("parleyPick", { option: "0" });
    me.send("parleyClose", {});
    await sleep(300);
    expect(room.state.travelPhase).toBe(0);
    expect(room.state.region).toBe("hollowmere");
    expect(room.state.campaignRev).toBe(0);
    expect(room.state.scenario).toBe("");
  });

  it("a proposal waits for the whole party; nothing sails until everyone says yes", async () => {
    const { room, ps } = await setup({}, 2);
    const [a, b] = ps as [Who, Who];
    place(room, a.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    a.send("travelPropose", { to: "kessar" });
    await until(() => room.state.travelPhase === 1, 2000, "the vote");
    await sleep(400);
    expect(room.state.travelPhase).toBe(1);
    b.send("travelReady", { ready: true });
    await until(() => room.state.travelPhase === 2, 2000, "the sailing");
    await until(() => room.state.region === "kessar" && room.state.travelPhase === 3, 15000, "landfall");
    a.send("regionReady", { region: "kessar" });
    await sleep(300);
    expect(room.state.travelPhase).toBe(3); // b is slow: the room waits for the slowest client
    b.send("regionReady", { region: "kessar" });
    await until(() => room.state.travelPhase === 0, 3000, "everyone ashore");
  }, 40000);

  it("force: hitting the Ward's people is a declaration of war, the garrison routs, the campaign remembers", async () => {
    const { room, ps } = await setup({ region: "kessar" });
    const me = ps[0]!;
    expect(room.state.region).toBe("kessar");
    const sentries = npcRows(room).filter(([, p]) => p.npc === NPC.SENTRY);
    expect(sentries.length).toBeGreaterThanOrEqual(4);
    // the same entry point Combat uses for every blow
    room.damagePlayer(sentries[0]![0], 10, { zone: ZONE.ARM_R, by: me.id });
    await until(() => scenarioOf(room)?.phase === "fighting", 2000, "the alarm");
    for (const [id] of sentries) room.damagePlayer(id, 1000, { zone: ZONE.TORSO, by: me.id });
    await until(() => scenarioOf(room)?.phase === "resolved", 4000, "the garrison to break");
    const c = campaignOf(room);
    expect(c.history[0]).toMatchObject({ region: "kessar", resolution: "forced" });
    expect(c.crossing.control).toBe("society");
    expect(c.tally.garrisonKilled).toBeGreaterThanOrEqual(sentries.length);
    expect(c.factions.ward.fear).toBeGreaterThan(10);
  }, 20000);

  it("trick: a barrel carried to the pier and lit brings the bridge down (sabotaged)", async () => {
    const { room, ps } = await setup({ region: "kessar" });
    const me = ps[0]!;
    const barrel = [...room.state.props.entries()].find(([, p]) => p.kind === PropKind.BARREL)!;
    place(room, me.p, barrel[1].x, barrel[1].z + 1.2, 0);
    me.p.y = barrel[1].y - 0.3;
    await press(me, BUTTON.INTERACT);
    await until(() => (me.p.flags & FLAG.CARRYING) !== 0, 2000, "to pick the barrel up");
    place(room, me.p, A.pier.x, A.pier.z + 1.4, 0);
    await sleep(200);
    await press(me, BUTTON.INTERACT);
    await until(() => scenarioOf(room)?.phase === "rigging", 2000, "the fuse to be lit");
    expect(room.state.props.has(barrel[0])).toBe(false); // consumed
    expect((me.p.flags & FLAG.CARRYING) === 0).toBe(true);
    place(room, me.p, A.landing.x, A.landing.z, 0); // clear the deck
    await until(() => room.state.campaignRev > 0, 35000, "the bridge to go (rain slows a fuse)");
    const c = campaignOf(room);
    expect(c.history[0]).toMatchObject({ region: "kessar", resolution: "sabotaged" });
    expect(c.crossing.bridge).toBe("collapsed");
    // the room's own world lost its deck: nobody can walk the span any more
    const w = createRegionWorld("kessar", SEED, { bridge: "collapsed" });
    const live = (room as unknown as { world: { groundHeight(x: number, z: number, y: number): number } }).world;
    expect(live.groundHeight(A.bridge.x, A.bridge.z, 1e6)).toBeCloseTo(w.groundHeight(A.bridge.x, A.bridge.z, 1e6), 3);
  }, 60000);

  it("the garrison fights the party whatever the friendly-fire rule: a pistol shot hurts a sentry with friendly fire off", async () => {
    const { room, ps } = await setup({ region: "kessar", friendlyFire: false });
    const me = ps[0]!;
    expect(room.state.friendlyFire).toBe(false);
    const sid = npcKey("sentry-2"); // on open ground north of the toll bar
    const sentry = room.state.players.get(sid)!;
    // stand close, on open ground, with the sentry in front
    place(room, me.p, sentry.x + 4, sentry.z, Math.PI / 2); // (D-038: east of him, not south: four metres south is now inside the toll booth's walls)
    await sleep(350);
    const d = me.input.data;
    d.weapon = weaponToWire(WEAPON.PISTOL);
    d.buttons = 0;
    d.moveF = d.moveR = 0;
    d.yaw = yawToWire(0);
    me.input.send();
    await until(() => me.p.weapon === WEAPON.PISTOL + 1, 2000, "the pistol in hand");
    await sleep(900);
    const before = sentry.health;
    const torsoY = BODY_SHAPES[ZONE.TORSO]![1];
    const at = aimFrom(me.p, { x: sentry.x, y: sentry.y + torsoY, z: sentry.z });
    for (let i = 0; i < 6 && sentry.health === before; i++) {
      d.buttons = BUTTON.AIM | BUTTON.FIRE;
      d.yaw = yawToWire(at.yaw);
      d.aimYaw = yawToWire(at.yaw);
      d.aimElev = elevToWire(at.elev);
      me.input.send();
      await sleep(80);
      d.buttons = BUTTON.AIM;
      me.input.send();
      await sleep(700);
    }
    expect(room.state.players.get(sid)!.health).toBeLessThan(before);
    // first blood on the Ward's people is the declaration of war (a lone party that the garrison then puts down has "abandoned" the matter)
    await until(() => ["fighting", "resolved"].includes(scenarioOf(room)?.phase ?? ""), 2000, "the alarm after first blood");
  }, 30000);
});

function aimFrom(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { yaw: number; elev: number } {
  const eye = from.y + COMBAT.eyeHeight;
  return { yaw: Math.atan2(-(to.x - from.x), -(to.z - from.z)), elev: Math.atan2(to.y - eye, Math.hypot(to.x - from.x, to.z - from.z)) };
}
