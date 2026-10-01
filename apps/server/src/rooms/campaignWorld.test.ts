import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  CAMP, FLAG, KESSAR_ANCHORS, MoveInput, createRegionWorld, ROOM_WORLD, SAIL_SECONDS, audiencesAt, newCampaign, parseCampaign, parsePowers, parseSettlements, serializeCampaign, serializePowers, serializeSettlements,
  type CampaignState, type ParleyView, type PlayerStateType, type PowersState, type SettlementsState,
} from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { metrics } from "../metrics.ts";
import { MemoryStore } from "../persistence/memoryStore.ts";
import type { PersistenceRuntime } from "../persistence/runtime.ts";
import { getRoomConfig, setRoomConfig } from "../roomConfig.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-035 through the REAL room: audiences at HQ, the launch, the standing deals' effects, hostile messages. (Resume and founding: resume.test.ts.) */
const PORT = 2595;
const SEED = 777;
const TOKEN = "3f2c1d0e-8b7a-4c6d-9e5f-1a2b3c4d5e6f";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 4000, what = "condition") => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
};
type Priv = { campaign: CampaignState; powers: PowersState; settlements: SettlementsState; publishCampaign(): void; publishPowers(): void; publishSettlements(): void; world: { terrainHeight(x: number, z: number): number } };

describe("campaign world: audiences, the launch, standing deals (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(n = 1) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, token: TOKEN })) as unknown as WorldRoom;
    const priv = room as unknown as Priv;
    const ps: { id: string; p: PlayerStateType; send(t: string, m: unknown): void; parleys: { view?: ParleyView; line?: string; closed?: boolean }[]; notices: string[] }[] = [];
    for (let i = 0; i < n; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}`, token: i === 0 ? TOKEN : undefined });
      const w = { id: c.sessionId, p: room.state.players.get(c.sessionId)!, send: (t: string, m: unknown) => c.send(t as never, m as never), parleys: [] as { view?: ParleyView; line?: string; closed?: boolean }[], notices: [] as string[] };
      c.onMessage("parley", (m: never) => w.parleys.push(m));
      c.onMessage("notice", (m: { text: string }) => w.notices.push(m.text));
      for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station"]) c.onMessage(t, () => undefined);
      void c.input({ type: MoveInput, mode: "reliable" });
      ps.push(w);
    }
    await sleep(150);
    return { room, priv, ps };
  }
  const place = (priv: Priv, p: PlayerStateType, x: number, z: number) => {
    p.x = x;
    p.z = z;
    p.y = priv.world.terrainHeight(x, z);
    p.vx = p.vz = 0;
  };
  /** A campaign a few days in, so powers are asking for the party. */
  const seasoned = (priv: Priv, room: WorldRoom) => {
    priv.campaign = { ...newCampaign(SEED), day: 6, expeditions: 2, purse: 400 };
    priv.publishCampaign();
    return room;
  };

  it("an audience at the map table: open, answer, the powers and the purse move together, the paper has something to print", async () => {
    const { room, priv, ps } = await setup();
    const me = ps[0]!;
    seasoned(priv, room);
    const asking = audiencesAt(priv.campaign, priv.powers);
    expect(asking.length).toBeGreaterThan(0);
    const power = asking[0]!.power;
    place(priv, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2);
    const powers0 = room.state.powers;
    me.send("audienceOpen", { power });
    await until(() => me.parleys.some((m) => m.view), 3000, "the audience to open");
    let view = me.parleys.find((m) => m.view)!.view!;
    expect(view.speaker.length).toBeGreaterThan(3);
    for (let i = 0; i < 6 && !me.parleys.some((m) => m.closed); i++) {
      const idx = view.options.findIndex((o) => o.id === "pay");
      me.send("parleyPick", { option: idx >= 0 ? idx : view.options.findIndex((o) => o.id === "walk_away") });
      await sleep(150);
      const last = [...me.parleys].reverse().find((m) => m.view);
      if (last?.view) view = last.view;
    }
    await until(() => me.parleys.some((m) => m.closed), 3000, "the audience to end");
    expect(room.state.powers).not.toBe(powers0);
    expect(parsePowers(room.state.powers)!.minor[power].lastAudienceDay).toBe(6);
    expect(room.state.powersRev).toBeGreaterThan(0);
    // that power has just been seen: it is no longer asking
    expect(audiencesAt(parseCampaign(room.state.campaign)!, parsePowers(room.state.powers)!).some((a) => a.power === power)).toBe(false);
  }, 30000);

  it("forged powers, an audience away from the map room, nothing pending, a downed asker and spam are all ignored", async () => {
    const { room, priv, ps } = await setup();
    const me = ps[0]!;
    seasoned(priv, room);
    const power = audiencesAt(priv.campaign, priv.powers)[0]!.power;
    const before = room.state.powers;
    place(priv, me.p, 80, 80); // nowhere near the table
    me.send("audienceOpen", { power });
    await sleep(250); // (the server reads the row when the message arrives, not when it is sent)
    place(priv, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2);
    for (const bad of [{ power: "ward" }, { power: "rival" }, { power: "ZZZ" }, { power: 7 }, { power: null }, {}, null, "brine", [], { power: { toString: 1 } }]) me.send("audienceOpen", bad);
    await sleep(250);
    me.p.flags |= FLAG.DOWNED;
    me.send("audienceOpen", { power });
    await sleep(250);
    me.p.flags &= ~FLAG.DOWNED;
    me.send("parleyPick", { option: 0 }); // nothing open
    me.send("parleyClose", {});
    await sleep(400);
    expect(me.parleys.length).toBe(0);
    expect(room.state.powers).toBe(before);
    // nothing pending: a fresh campaign has had no expedition
    priv.campaign = newCampaign(SEED);
    priv.publishCampaign();
    me.send("audienceOpen", { power });
    await sleep(300);
    expect(me.parleys.length).toBe(0);
    // spam: one open is honoured, the rest are not another conversation
    seasoned(priv, room);
    await sleep(1300); // (past the per-sender gap)
    for (let i = 0; i < 20; i++) me.send("audienceOpen", { power });
    await sleep(400);
    expect(me.parleys.filter((m) => m.view).length).toBe(1);
  }, 30000);

  it("a steam launch cuts the sailing to half; without it the sailing is the region's own", async () => {
    const { room, priv, ps } = await setup();
    const me = ps[0]!;
    place(priv, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2);
    me.send("travelPropose", { to: "kessar" });
    await until(() => room.state.travelPhase >= 2, 3000, "the sailing");
    expect(room.state.travelLeft).toBeGreaterThanOrEqual(SAIL_SECONDS - 1);
    await until(() => room.state.travelPhase === 3, 15000, "landfall");
    me.send("regionReady", { region: "kessar" });
    await until(() => room.state.travelPhase === 0, 3000, "ashore");
    // the launch is built (latched): the sailing home is shorter
    const s = parseSettlements(room.state.settlements)!;
    priv.settlements = { ...s, tech: { road: 1, telegraph: false, launch: true, since: { road: 1, telegraph: 0, launch: 1 } } };
    priv.publishSettlements();
    place(priv, me.p, 0, 88);
    await sleep(1100); // (the propose cooldown)
    me.send("travelPropose", { to: "hollowmere" });
    await until(() => room.state.travelPhase >= 2, 3000, "the sailing home");
    expect(room.state.travelLeft).toBeLessThanOrEqual(Math.ceil(SAIL_SECONDS / 2));
    await until(() => room.state.region === "hollowmere" && room.state.travelPhase === 3, 15000, "home");
  }, 40000);

  it("a standing deal changes the manifest's charge and the Ward's toll, and a strike makes it dearer", async () => {
    const { room, priv, ps } = await setup();
    const me = ps[0]!;
    place(priv, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2);
    const loadout = { ammo: 2, medical: 0, provisions: 2, powder: 0, horses: 0, wagon: false };
    const f = (room as unknown as { followers: { p: { loadout: unknown } } }).followers;
    f.p.loadout = loadout;
    priv.powers = { ...priv.powers, flags: ["reaper_grain"] }; // -10 % on the manifest
    priv.publishPowers();
    const before = priv.campaign.purse;
    me.send("travelPropose", { to: "kessar" });
    await until(() => room.state.travelPhase >= 2, 3000, "the sailing");
    const spent = before - parseCampaign(room.state.campaign)!.purse;
    expect(spent).toBeGreaterThan(0);
    expect(me.notices.some((n) => n.includes("takes £"))).toBe(true);
    await until(() => room.state.travelPhase === 3, 15000, "landfall");
    // the Guild's gossip is in the Ward's price
    priv.powers = { ...priv.powers, flags: ["choir_gossip"] };
    const base = (await import("@cb/shared")).askingToll(priv.campaign);
    expect((await import("@cb/shared")).askingToll(priv.campaign, priv.powers)).toBe(Math.min(90, base + 5));
    expect(serializePowers(priv.powers).length).toBeLessThan(3072);
    expect(serializeCampaign(priv.campaign).length).toBeLessThan(8192);
    expect(serializeSettlements(priv.settlements).length).toBeLessThan(2048);
  }, 40000);

  it("a store that is down never stops the game: the room keeps ticking and answering, retries, and metrics.saveFailures rises", async () => {
    const mem = new MemoryStore();
    let attempts = 0;
    const broken = Object.assign(Object.create(mem) as MemoryStore, {
      save: async () => {
        attempts++;
        throw new Error("the disk is on fire");
      },
    });
    const runtime: PersistenceRuntime = {
      cfg: { kind: "memory", saveDir: "", databaseUrl: undefined, pepper: "integration-pepper-0123456789", retentionDays: 1 }, store: async () => broken, status: () => ({ kind: "memory", downgraded: false }), close: async () => undefined,
    };
    const was = getRoomConfig();
    setRoomConfig({ ...was, persistence: runtime });
    try {
      const failures0 = metrics.saveFailures;
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, token: TOKEN })) as unknown as WorldRoom;
      const priv = room as unknown as Priv;
      const c = await colyseus.connectTo(room as never, { name: "Q", token: TOKEN });
      for (const t of ["notice", "hit", "sever", "shot", "impact", "boom", "hitmark", "station", "parley"]) c.onMessage(t, () => undefined);
      void c.input({ type: MoveInput, mode: "reliable" });
      const me = room.state.players.get(c.sessionId)!;
      // the ledger changes while the store is failing: the room neither throws nor stalls
      priv.campaign = { ...priv.campaign, purse: priv.campaign.purse + 5 };
      priv.publishCampaign();
      const t0 = room.state.worldMs;
      place(priv, me, CAMP.mapTable.x, CAMP.mapTable.z + 1.2);
      await until(() => metrics.saveFailures > failures0, 15000, "a save failure to be counted (after its retries)");
      expect(attempts).toBeGreaterThanOrEqual(4); // one try and three retries
      expect(parseCampaign(room.state.campaign)!.purse).toBe(priv.campaign.purse);
      c.send("ping" as never, { t: 1 } as never);
      await sleep(300);
      expect(room.state.worldMs).toBeGreaterThanOrEqual(t0);
      expect(room.state.players.has(c.sessionId)).toBe(true);
    } finally {
      setRoomConfig(was);
    }
  }, 40000);
  it("the server's collision world is built from the LEDGER, not from the last published string: inside a commit the ledger moves first and is published last", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, region: "kessar", token: TOKEN })) as unknown as WorldRoom;
    const priv = room as unknown as Priv & { world: { groundHeight(x: number, z: number, y: number): number }; rebuildWorld(): void };
    const A = KESSAR_ANCHORS.bridge;
    const standing = createRegionWorld("kessar", SEED, { bridge: "intact" }).groundHeight(A.x, A.z, 1e6);
    const fallen = createRegionWorld("kessar", SEED, { bridge: "collapsed" }).groundHeight(A.x, A.z, 1e6);
    expect(Math.abs(standing - fallen)).toBeGreaterThan(0.5); // (the two worlds really differ here, or this test proves nothing)
    expect(priv.world.groundHeight(A.x, A.z, 1e6)).toBeCloseTo(standing, 3);
    priv.campaign = { ...priv.campaign, crossing: { ...priv.campaign.crossing, bridge: "collapsed" } }; // moved, NOT published: state.campaign still says "intact"
    expect(parseCampaign(room.state.campaign)!.crossing.bridge).toBe("intact");
    priv.rebuildWorld(); // (what an outpost promoted by the same ending does)
    expect(priv.world.groundHeight(A.x, A.z, 1e6)).toBeCloseTo(fallen, 3);
  });

});
