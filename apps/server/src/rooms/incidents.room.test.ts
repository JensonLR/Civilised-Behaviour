import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { INCIDENT_LEAVE_S } from "../systems/Incidents.ts";
import { ColyseusTestServer } from "@colyseus/testing";
import { ACCIDENT_OWNER, BUTTON, FLAG, INCIDENT, INCIDENT_DONE, MoveInput, PropKind, ROOM_WORLD, npcKey, parseCampaign, parseParty, yawToWire, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-052: incidents through a real room. Each is forced with the QA lever (`incident:<id>`: the real one waits a minute or two and for calm), met by a real player's
 * presses, and committed with a synthetic contract ending (`outcome:`) through the same pipeline a real ending takes. Port 2613 (one per integration test file).
 */
const PORT = 2613;
const SEED = 5151;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number }; send(): void };

describe("incidents in a real room (D-052)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, region: "kessar" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Captain" });
    const notices: string[] = [];
    c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "parley", "station", "saved"]) c.onMessage(t, () => undefined);
    const me = { id: c.sessionId, p: room.state.players.get(c.sessionId)!, input: c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input, send: (t: string, m: unknown) => c.send(t as never, m as never) };
    await sleep(200);
    return { room, me, notices };
  }
  const until = async (cond: () => boolean, ms = 5000, what = "condition") => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };
  /** Stand `p` just south (+z) of the incident's person, facing it. */
  const beside = (room: WorldRoom, p: PlayerStateType, row: PlayerStateType) => {
    const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    p.x = row.x;
    p.z = row.z + 1.2;
    p.y = w.terrainHeight(p.x, p.z);
    p.facing = 0; // (facing 0 looks towards -z: at the person)
    p.vx = p.vz = 0;
  };
  const hold = async (me: { input: Input }, buttons: number, ms: number) => {
    const end = Date.now() + ms;
    const d = me.input.data;
    d.moveF = d.moveR = 0;
    d.yaw = yawToWire(0);
    while (Date.now() < end) {
      d.buttons = buttons;
      me.input.send();
      await sleep(50);
    }
    d.buttons = 0;
    me.input.send();
    await sleep(150);
  };
  /** The party lands at the shore: the incident is placed on dry ground, never in the surf off the landing (the first browser look found the courier in the sea). */
  const dry = (room: WorldRoom, row: PlayerStateType) => {
    const t = (room as unknown as { world: { terrain: { waterDepth?: (x: number, z: number) => number } } }).world.terrain;
    expect(t.waterDepth, "Kessar's terrain knows its water").toBeTypeOf("function");
    expect(t.waterDepth!(row.x, row.z), `incident at ${row.x.toFixed(1)},${row.z.toFixed(1)}`).toBeLessThanOrEqual(0);
  };
  const lastIncident = (room: WorldRoom) => parseCampaign(room.state.campaign)!.sites.lastIncident;
  const commit = async (room: WorldRoom, me: { send(t: string, m: unknown): void }) => {
    const before = room.state.campaignRev;
    me.send("debug", { cmd: "outcome:rescued" });
    await until(() => room.state.campaignRev !== before, 3000, "the outcome committed");
  };

  it("a courier: he comes, a press takes the dispatch, and the commit enters the arrears and the record", async () => {
    const { room, me, notices } = await setup();
    me.send("debug", { cmd: "incident:courier" });
    const key = npcKey("incident-courier");
    await until(() => room.state.players.has(key), 4000, "the courier");
    await until(() => notices.some((n) => n.includes("SOCIETY - URGENT - ARREARS")), 3000, "the courier's telegram");
    dry(room, room.state.players.get(key)!);
    beside(room, me.p, room.state.players.get(key)!);
    await hold(me, BUTTON.INTERACT, 150);
    await until(() => notices.some((n) => n === INCIDENT_DONE.delivered), 3000, "the dispatch taken");
    // he goes about his business and leaves the ground, taking his USE prompt with him (it stayed on screen while his body lingered)
    expect(room.state.players.has(key)).toBe(true);
    await until(() => !room.state.players.has(key), (INCIDENT_LEAVE_S + 3) * 1000, "the courier gone");
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "courier", result: "delivered", region: "kessar" });
  }, 30_000);

  it("a wounded traveller lies down, the ordinary held revive gets them up, and the commit records the kindness", async () => {
    const { room, me, notices } = await setup();
    me.send("debug", { cmd: "incident:wounded_traveller" });
    const key = npcKey("incident-traveller");
    await until(() => room.state.players.has(key), 4000, "the traveller");
    const row = room.state.players.get(key)!;
    expect(row.flags & FLAG.DOWNED).not.toBe(0);
    dry(room, row);
    beside(room, me.p, row);
    await hold(me, BUTTON.INTERACT, 3600);
    await until(() => (row.flags & FLAG.DOWNED) === 0, 3000, "the traveller on their feet");
    await until(() => notices.some((n) => n.includes("is on their feet")), 2000, "the thanks");
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "wounded_traveller", result: "helped" });
  }, 30_000);

  it("a deserter signs on: the hand is on the roster and on the ground; one left waiting when the contract ends is turned away", async () => {
    const { room, me, notices } = await setup();
    me.send("debug", { cmd: "incident:deserter" });
    const key = npcKey("incident-deserter");
    await until(() => room.state.players.has(key), 4000, "the deserter");
    const name = room.state.players.get(key)!.name;
    beside(room, me.p, room.state.players.get(key)!);
    await hold(me, BUTTON.INTERACT, 150);
    await until(() => (parseParty(room.state.party)?.roster ?? []).some((f) => f.name === name), 3000, "the deserter on the books");
    const hand = parseParty(room.state.party)!.roster.find((f) => f.name === name)!;
    expect(hand.kind).toBe("rifleman");
    await until(() => room.state.players.has(npcKey(hand.id)), 3000, "his body as a hand");
    expect(room.state.players.has(key)).toBe(false);
    await until(() => notices.some((n) => n.includes("signs on")), 3000, "the signing notice");
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "deserter", result: "enlisted" });
  }, 30_000);

  it("a runaway horse: a saddled horse turns up loose; whoever gets in the saddle has caught it, and the commit pays the owner's reward", async () => {
    const { room, me, notices } = await setup();
    const before = new Set(room.state.mounts.keys());
    me.send("debug", { cmd: "incident:runaway_horse" });
    await until(() => [...room.state.mounts.keys()].some((k) => !before.has(k)), 4000, "the loose horse");
    const id = [...room.state.mounts.keys()].find((k) => !before.has(k))!;
    const horse = room.state.mounts.get(id)!;
    expect(horse.rider).toBe("");
    await until(() => notices.some((n) => n.includes("Catch it")), 3000, "the hail"); // (the server's state is read in-process, the notice comes over the socket: wait for it)
    const t = (room as unknown as { world: { terrain: { waterDepth?: (x: number, z: number) => number } } }).world.terrain;
    expect(t.waterDepth!(horse.x, horse.z)).toBeLessThanOrEqual(0);
    beside(room, me.p, horse as unknown as PlayerStateType);
    await hold(me, BUTTON.INTERACT, 150);
    await until(() => horse.rider === me.id, 3000, "in the saddle");
    await until(() => notices.some((n) => n.startsWith("You have caught")), 3000, "the reward telegram");
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "runaway_horse", result: "caught" });
  }, 30_000);

  it("an incident nobody met is settled by the contract's end, and the next run never deals the same one", async () => {
    const { room, me } = await setup();
    me.send("debug", { cmd: "incident:courier" });
    await until(() => room.state.players.has(npcKey("incident-courier")), 4000, "the courier");
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "courier", result: "missed" });
  }, 30_000);

  // D-071: the overturned powder wagon. (The fuse is shortened through the room's own table so the test does not wait out fourteen seconds.)
  const wagon = async () => {
    const { room, me, notices } = await setup();
    const before = new Set<string>();
    room.state.props.forEach((_p, id) => before.add(id));
    me.send("debug", { cmd: "incident:powder_wagon" });
    await until(() => notices.some((n) => n.includes("spilled its kegs")), 4000, "the wagon's telegram");
    const kegs: string[] = [];
    room.state.props.forEach((p, id) => {
      if (!before.has(id) && p.kind === PropKind.BARREL) kegs.push(id);
    });
    const lit = (room as unknown as { lit: Map<string, { left: number; owner: string }> }).lit;
    return { room, me, notices, kegs, lit };
  };

  it("D-071: a powder wagon left alone goes up as a chain, and the commit records the crater", async () => {
    const { room, me, notices, kegs, lit } = await wagon();
    expect(kegs.length).toBe(INCIDENT.wagonKegs);
    const burning = kegs.filter((k) => lit.has(k));
    expect(burning).toHaveLength(1);
    expect(room.state.props.get(burning[0]!)!.fuse).toBeGreaterThan(0);
    expect(lit.get(burning[0]!)!.owner).toBe(ACCIDENT_OWNER);
    lit.get(burning[0]!)!.left = 0.3;
    await until(() => notices.some((n) => n.includes("went up, kegs and all")), 8000, "the road rearranged");
    expect(kegs.filter((k) => room.state.props.has(k)).length).toBeLessThan(INCIDENT.wagonSalvage);
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "powder_wagon", result: "went_up", region: "kessar" });
  }, 30_000);

  it("D-071: the fizzing keg got well clear (thrown, rolled, kicked) and the rest is the Society's powder", async () => {
    const { room, me, notices, kegs, lit } = await wagon();
    const first = kegs.find((k) => lit.has(k))!;
    // what a throw does: the burning keg ends up far from its fellows (20 m off, on the ground)
    const physics = (room as unknown as { physics: { props: Map<string, { body: { translation(): { x: number; y: number; z: number }; setTranslation(t: { x: number; y: number; z: number }, wake: boolean): void; setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void } }> } }).physics;
    const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    const b = physics.props.get(first)!.body;
    const t = b.translation();
    b.setTranslation({ x: t.x + 20, y: w.terrainHeight(t.x + 20, t.z) + 0.6, z: t.z }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    await sleep(300);
    lit.get(first)!.left = 0.3;
    await until(() => notices.some((n) => n.includes("went off well clear")), 8000, "the salvage");
    expect(kegs.filter((k) => room.state.props.has(k)).length).toBe(INCIDENT.wagonKegs - 1);
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "powder_wagon", result: "salvaged" });
  }, 30_000);

  // D-088: the Syndicate arrives armed, not with a cheque
  const collectors = async () => {
    const { room, me, notices } = await setup();
    const before = new Set<string>();
    room.state.props.forEach((_p, id) => before.add(id));
    me.send("debug", { cmd: "incident:syndicate_collectors" });
    await until(() => notices.some((n) => n.includes("an invoice read by their powder cart, then rifles")), 4000, "the collectors' telegram");
    // (a lone player meets two of them; a party, three)
    const keys = [0, 1].map((i) => npcKey(`incident-collector-${i}`));
    await until(() => keys.every((k) => room.state.players.has(k)), 4000, "the collectors");
    expect(room.state.players.has(npcKey("incident-collector-2")), "two for a lone player").toBe(false);
    const kegs: string[] = [];
    room.state.props.forEach((p, id) => {
      if (!before.has(id) && p.kind === PropKind.BARREL) kegs.push(id);
    });
    return { room, me, notices, keys, kegs };
  };

  it("D-088: armed collectors and their powder cart (unlit) come for the party, read their invoice, then open fire (at once if one is hurt); seen off, their bag is the Society's", async () => {
    const { room, me, notices, keys, kegs } = await collectors();
    expect(kegs.length).toBe(INCIDENT.collectorKegs);
    const lit = (room as unknown as { lit: Map<string, unknown> }).lit;
    expect(kegs.some((k) => lit.has(k)), "the cart is not lit").toBe(false);
    const rows = keys.map((k) => room.state.players.get(k)!);
    expect(new Set(rows.map((r) => r.weapon)).size, "different arms").toBe(rows.length);
    // they read the invoice first (the party's moment), and open fire the moment one of them is hurt
    const cast = (room as unknown as { cast: { hostileTo(a: string, b: string): boolean } }).cast;
    expect(cast.hostileTo(keys[0]!, me.id), "not yet: the invoice is being read").toBe(false);
    (room as unknown as { incidents: { onHurt(v: string): void } }).incidents.onHurt(keys[1]!);
    expect(cast.hostileTo(keys[0]!, me.id), "a collector hurt: they all come for the party").toBe(true);
    const purse0 = parseCampaign(room.state.campaign)!.purse;
    for (const r of rows) r.flags |= FLAG.DOWNED;
    await until(() => notices.some((n) => n.includes("are seen off")), 4000, "the collectors seen off");
    await commit(room, me);
    const c = parseCampaign(room.state.campaign)!;
    expect(c.sites.lastIncident).toMatchObject({ id: "syndicate_collectors", result: "repelled" });
    expect(c.purse - purse0, "the bag (and the contract's own pay)").toBeGreaterThanOrEqual(INCIDENT.collectorBag);
  }, 30_000);

  it("D-088: unprovoked, they open fire when the invoice is read; a contract that ends with them still standing pays them", async () => {
    const { room, me, keys } = await collectors();
    const cast = (room as unknown as { cast: { hostileTo(a: string, b: string): boolean } }).cast;
    await until(() => cast.hostileTo(keys[0]!, me.id), (INCIDENT.collectorDemandS + 3) * 1000, "the invoice read");
    await commit(room, me);
    expect(lastIncident(room)).toMatchObject({ id: "syndicate_collectors", result: "collected" });
  }, 30_000);
});
