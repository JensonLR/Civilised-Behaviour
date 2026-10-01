import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, CAMP, FLAG, MAX_PLAYERS, MOUNT_PHASE, MoveInput, ROOM_WORLD, hirePool, newParty, parseCampaign, parseParty, regionMountSpots, regionSpawn, yawToWire, type PlayerStateType, type WorldStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2601; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEED = 91;
/** Any close code but 4000 (a deliberate leave) is a dropped connection: the room keeps the slot and waits. */
const DROP = 4500;

interface Input {
  readonly data: { moveF: number; moveR: number; yaw: number; buttons: number };
  send(): void;
}
type Cli = Awaited<ReturnType<ColyseusTestServer["connectTo"]>>;
const stateOf = (c: unknown): WorldStateType => (c as { state: WorldStateType }).state;

describe("reconnecting through the expedition: a ride and a sailing (real room)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

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
  const join = async (room: WorldRoom, name: string) => {
    const c = await colyseus.connectTo(room as never, { name });
    for (const t of ["notice", "station", "parley", "hit", "sever", "shot", "impact", "boom", "hitmark"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(100);
    return { c, id: c.sessionId, token: c.reconnectionToken, p: room.state.players.get(c.sessionId)!, input, send: (type: string, msg: unknown) => c.send(type as never, msg as never) };
  };
  type Who = Awaited<ReturnType<typeof join>>;
  const press = async (who: Who, buttons: number) => {
    const d = who.input.data;
    d.moveF = 0;
    d.moveR = 0;
    d.yaw = yawToWire(0);
    d.buttons = buttons;
    who.input.send();
    await sleep(120);
    d.buttons = 0;
    who.input.send();
    await sleep(120);
  };
  const drop = async (room: WorldRoom, who: Who) => {
    who.c.connection.transport.close(DROP, "network drop");
    await until(() => room.state.players.get(who.id)?.connected === false, 3000, "the room to notice the drop");
  };
  const pyramid = { x: -6.15 + 1.3, z: -6.85 };
  const partyOf = (room: WorldRoom) => parseParty(room.state.party)!;

  /** A rider on the first Hollowmere horse, with a manifest and a hire on the books. */
  async function riderSetup() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED })) as unknown as WorldRoom;
    const me = await join(room, "Rider");
    place(room, me.p, pyramid.x, pyramid.z, Math.PI / 2);
    me.send("loadoutSet", { loadout: { ammo: 1, medical: 1, provisions: 0, powder: 0, horses: 1, wagon: false } });
    await until(() => room.state.partyRev > 0, 2000, "the manifest");
    const cand = hirePool(SEED, parseCampaign(room.state.campaign)!.day, newParty())[0]!;
    await sleep(300);
    me.send("hire", { id: cand.id, on: true });
    await until(() => partyOf(room).roster.length === 1, 2000, "the hire");
    const spot = regionMountSpots("hollowmere").horses[0]!;
    place(room, me.p, spot.x - 1.2, spot.z, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => (me.p.flags & FLAG.MOUNTED) !== 0, 3000, "to be in the saddle");
    let horse = "";
    room.state.mounts.forEach((row, id) => {
      if (row.rider === me.id) horse = id;
    });
    expect(horse).not.toBe("");
    return { room, me, horse };
  }

  it("a rider who drops the socket and reconnects inside the window keeps the slot, the saddle, the roster and the manifest", async () => {
    const { room, me, horse } = await riderSetup();
    const slot = me.p.slot;
    const party0 = room.state.party;
    const campaign0 = room.state.campaign;
    const names0 = [...room.state.players.entries()].filter(([, p]) => !p.npc).map(([id]) => id);

    await drop(room, me);
    // dropped: still in the saddle, still on the books
    expect(me.p.flags & FLAG.MOUNTED).not.toBe(0);
    expect(room.state.mounts.get(horse)!.rider).toBe(me.id);
    expect(room.state.party).toBe(party0);

    const back = await colyseus.sdk.reconnect(me.token);
    for (const t of ["notice", "station", "parley", "hit", "sever", "shot", "impact", "boom", "hitmark"]) back.onMessage(t, () => undefined);
    await until(() => room.state.players.get(me.id)?.connected === true, 3000, "the reconnection");
    await sleep(200);
    expect(back.sessionId).toBe(me.id);
    const row = room.state.players.get(me.id)!;
    expect(row.slot).toBe(slot);
    expect(row.flags & FLAG.MOUNTED).not.toBe(0); // FLAG.MOUNTED survived
    expect(room.state.mounts.get(horse)!.rider).toBe(me.id); // MountState.rider survived
    expect(room.state.party).toBe(party0); // the manifest and the roster survived
    expect(partyOf(room).roster).toHaveLength(1);
    expect(partyOf(room).loadout.horses).toBe(1);
    expect(room.state.campaign).toBe(campaign0);
    expect([...room.state.players.entries()].filter(([, p]) => !p.npc).map(([id]) => id)).toEqual(names0);
    // and the client's own decoded copy says the same
    const theirs = stateOf(back);
    expect(theirs.players.get(me.id)!.flags & FLAG.MOUNTED).not.toBe(0);
    expect(theirs.mounts.get(horse)!.rider).toBe(me.id);
    expect(theirs.party).toBe(party0);
  }, 40_000);

  it("a rider who never returns is dismounted when the window closes, and the horse stands where he left it", async () => {
    const { room, me, horse } = await riderSetup();
    const at = { x: room.state.mounts.get(horse)!.x, z: room.state.mounts.get(horse)!.z };
    await drop(room, me);
    // the window is 45 s; close it now (the documented Deferred of Room.allowReconnection)
    const pending = (room as unknown as { _reconnections: Record<string, [string, { reject(v?: unknown): void }]> })._reconnections;
    expect(Object.keys(pending).length).toBe(1);
    for (const [, d] of Object.values(pending)) d.reject(false);
    await until(() => !room.state.players.has(me.id), 4000, "the slot to be given up");
    const h = room.state.mounts.get(horse)!;
    expect(h).toBeDefined(); // the horse is still in the world
    expect(h.rider).toBe("");
    expect(h.phase).not.toBe(MOUNT_PHASE.ridden);
    expect(h.speed).toBeLessThan(0.5);
    expect(Math.hypot(h.x - at.x, h.z - at.z)).toBeLessThan(3); // it stands: nobody rode it off
    let riders = 0;
    room.state.mounts.forEach((r) => {
      if (r.rider !== "") riders++;
    });
    expect(riders).toBe(0);
  }, 40_000);

  // ---- the sailing ------------------------------------------------------------------------------------------------------------------------

  async function twoAtTheTable() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED })) as unknown as WorldRoom;
    const a = await join(room, "Captain");
    const b = await join(room, "Passenger");
    place(room, a.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    place(room, b.p, CAMP.mapTable.x + 1, CAMP.mapTable.z + 1.2, 0);
    return { room, a, b };
  }
  const propose = async (room: WorldRoom, a: Who) => {
    a.send("travelPropose", { to: "kessar" });
    await until(() => room.state.travelPhase >= 1, 3000, "the vote to open");
    if (room.state.travelPhase === 1) a.send("travelReady", { ready: true });
  };
  const ring = (slot: number) => regionSpawn("kessar", slot, MAX_PLAYERS);

  it("during the sailing: a dropped slot stops blocking the vote; its owner comes back to the sailing card, says `regionReady`, and lands where the others did", async () => {
    const { room, a, b } = await twoAtTheTable();
    await propose(room, a);
    expect(room.state.travelPhase).toBe(1); // B has not said yes: the vote is held
    await sleep(300);
    expect(room.state.travelPhase).toBe(1);
    await drop(room, b); // ... and now B is gone: nobody is blocking
    await until(() => room.state.travelPhase >= 2, 3000, "the sailing to begin without the dropped slot");
    const slotB = b.p.slot;
    const back = await colyseus.sdk.reconnect(b.token);
    for (const t of ["notice", "station", "parley"]) back.onMessage(t, () => undefined);
    await until(() => room.state.players.get(b.id)?.connected === true, 3000, "the reconnection mid-sailing");
    // the reconnected client sees the sailing
    await until(() => stateOf(back).travelPhase >= 2 || stateOf(back).region === "kessar", 3000, "the client to see the sailing");
    expect(stateOf(back).travelTo).toBe("kessar");
    await until(() => room.state.region === "kessar" && room.state.travelPhase === 3, 20_000, "landfall");
    // now both are connected: the arrival waits for BOTH, so the party is held until each client has built the shore
    a.send("regionReady", { region: "kessar" });
    await sleep(400);
    expect(room.state.travelPhase).toBe(3);
    back.send("regionReady" as never, { region: "kessar" } as never);
    await until(() => room.state.travelPhase === 0, 4000, "everyone ashore");
    for (const who of [a, b]) {
      const row = room.state.players.get(who.id)!;
      const at = ring(row.slot);
      expect(Math.hypot(row.x - at.x, row.z - at.z), who.id).toBeLessThan(1);
      expect(row.connected).toBe(true);
    }
    expect(room.state.players.get(b.id)!.slot).toBe(slotB);
    expect(stateOf(back).region).toBe("kessar");
  }, 60_000);

  it("a reconnect after landfall needs no handshake: the party landed without the dropped slot, which comes back to a settled shore", async () => {
    const { room, a, b } = await twoAtTheTable();
    await propose(room, a);
    await drop(room, b);
    await until(() => room.state.travelPhase >= 2, 3000, "the sailing");
    await until(() => room.state.region === "kessar" && room.state.travelPhase === 3, 20_000, "landfall");
    a.send("regionReady", { region: "kessar" });
    await until(() => room.state.travelPhase === 0, 4000, "the connected party ashore without waiting for the dropped slot");
    const back = await colyseus.sdk.reconnect(b.token);
    for (const t of ["notice", "station", "parley"]) back.onMessage(t, () => undefined);
    await until(() => room.state.players.get(b.id)?.connected === true, 3000, "the reconnection after landfall");
    await sleep(300);
    expect(room.state.travelPhase).toBe(0); // no new vote, no arrival to wait for
    const s = stateOf(back);
    expect(s.region).toBe("kessar");
    expect(s.travelPhase).toBe(0);
    const row = room.state.players.get(b.id)!;
    const at = ring(row.slot);
    expect(Math.hypot(row.x - at.x, row.z - at.z)).toBeLessThan(1); // the dropped row was carried ashore with the rest
  }, 60_000);
});
