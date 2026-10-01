import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BUTTON,
  CAMP,
  COMMAND_IDS,
  FLAG,
  COMBAT,
  KESSAR_ANCHORS as A,
  MoveInput,
  WEAPONS,
  elevToWire,
  spawnPoint,
  weaponToWire,
  NO_COMMAND,
  NPC,
  ZONE,
  npcKey,
  PropKind,
  ROOM_WORLD,
  WEAPON,
  hirePool,
  loadoutCost,
  newParty,
  parseCampaign,
  parseParty,
  regionMountSpots,
  yawToWire,
  type PlayerStateType,
} from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2596; // one port per integration test file
const SEED = 4242;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

describe("the expedition through a real room: manifest, hired hands, orders, horses (server authority)", () => {
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
    notices: string[];
    stations: { kind: string }[];
    parleys: { view?: { options: { id: string }[] }; line?: string; closed?: boolean }[];
  }

  async function setup(options: Record<string, unknown> = {}) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: SEED, ...options })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Quartermaster" });
    const w: Who = {
      id: c.sessionId,
      p: room.state.players.get(c.sessionId)!,
      input: c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input,
      send: (type, msg) => c.send(type as never, msg as never),
      notices: [],
      stations: [],
      parleys: [],
    };
    c.onMessage("notice", (m: { text: string }) => w.notices.push(m.text));
    c.onMessage("station", (m: { kind: string }) => w.stations.push(m));
    c.onMessage("parley", (m: never) => w.parleys.push(m));
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark"]) c.onMessage(t, () => undefined);
    await sleep(150);
    return { room, me: w };
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
  const sail = async (room: WorldRoom, who: Who, to: string) => {
    who.send("travelPropose", { to });
    await until(() => room.state.travelPhase >= 2 || room.state.region === to, 3000, "the sailing to begin");
    await until(() => room.state.region === to && room.state.travelPhase === 3, 15000, `landfall at ${to}`);
    who.send("regionReady", { region: to });
    await until(() => room.state.travelPhase === 0, 3000, "everyone ashore");
  };
  const purse = (room: WorldRoom): number => parseCampaign(room.state.campaign)!.purse;
  const partyOf = (room: WorldRoom) => parseParty(room.state.party)!;
  const rows = (room: WorldRoom): [string, PlayerStateType][] => [...room.state.players.entries()].filter(([, p]) => p.npc);
  const combatOf = (room: WorldRoom) => (room as unknown as { combat: { inspect(id: string): { reserve: number[] } | undefined } }).combat;

  it("the supply pyramid opens the manifest; manifest, a hire, the sailing, landfall: charged once, rounds, a keg, a horse and the hand ashore; then orders and their refusals", async () => {
    const { room, me } = await setup();
    // the station
    const pyramid = { x: -6.15, z: -6.85 };
    place(room, me.p, pyramid.x + 1.3, pyramid.z, Math.PI / 2 + 0.0);
    await press(me, BUTTON.INTERACT);
    await until(() => me.stations.some((s) => s.kind === "loadout"), 2000, "the loadout station message");

    // the manifest and a hire (anyone at the table may edit it; the server normalises and keeps it)
    const purse0 = purse(room);
    me.send("loadoutSet", { loadout: { ammo: 1, medical: 1, provisions: 0, powder: 1, horses: 1, wagon: false, bogus: 99 } });
    await until(() => room.state.partyRev > 0, 2000, "the party to publish");
    expect(partyOf(room).loadout).toEqual({ ammo: 1, medical: 1, provisions: 0, powder: 1, horses: 1, wagon: false });
    const cand = hirePool(SEED, parseCampaign(room.state.campaign)!.day, newParty())[0]!;
    me.send("hire", { id: cand.id, on: true });
    await until(() => partyOf(room).roster.length === 1, 2000, "the hire");
    expect(purse(room)).toBe(purse0 - cand.wage);
    me.send("hire", { id: cand.id, on: true }); // twice: refused, nothing changes
    await sleep(300);
    expect(partyOf(room).roster.length).toBe(1);
    expect(purse(room)).toBe(purse0 - cand.wage);

    const rifleBefore = combatOf(room).inspect(me.id)!.reserve[WEAPON.RIFLE]!;
    expect(rifleBefore).toBeGreaterThan(0);
    const cost = loadoutCost(partyOf(room).loadout);
    const purseSail = purse(room);
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");

    // charged exactly once, at the ship's leaving
    expect(purse(room)).toBe(purseSail - cost);
    // the rounds, the keg, the horse and the hand are ashore
    expect(combatOf(room).inspect(me.id)!.reserve[WEAPON.RIFLE]).toBe(Math.ceil(rifleBefore * 1.5));
    expect([...room.state.props.values()].some((p) => p.kind === PropKind.BARREL && Math.hypot(p.x - A.landing.x, p.z - (A.landing.z - 4)) < 6)).toBe(true);
    expect(room.state.mounts.size).toBe(1);
    const horse = [...room.state.mounts.values()][0]!;
    const spot = regionMountSpots("kessar").horses[0]!;
    expect(Math.hypot(horse.x - spot.x, horse.z - spot.z)).toBeLessThan(2);
    const hand = rows(room).find(([k]) => k === `npc:${cand.id}`);
    expect(hand).toBeDefined();
    expect(hand![1].cmd).toBe(NO_COMMAND);
    expect([NPC.PORTER, NPC.HIRED_RIFLE, NPC.SURGEON]).toContain(hand![1].npc);
    const dressings = partyOf(room).medical;
    expect(dressings).toBe(4);

    // an order: obeyed, written onto the hand for the plates
    const stamped = (cmd: string) => me.notices.some((n) => n.startsWith(cmd));
    me.send("command", { intent: "hold", at: { x: me.p.x + 4, z: me.p.z - 4 } });
    await until(() => hand![1].cmd === COMMAND_IDS.indexOf("hold"), 3000, "the hold order to be written on the hand");
    expect(stamped("Obeyed")).toBe(true);
    await sleep(700); // a hand takes one order per half second
    me.send("command", { intent: "retreat" });
    await until(() => hand![1].cmd === COMMAND_IDS.indexOf("retreat"), 3000, "the retreat order");
    await sleep(700);
    me.send("command", { intent: "follow" });
    await sleep(700);

    // hostile orders change nothing: a point 500 m off, a forged target, an attack on a friend, junk
    const before = me.notices.length;
    const cmdBefore = hand![1].cmd;
    for (const bad of [
      { intent: "hold", at: { x: 500, z: 500 } },
      { intent: "attack", target: `npc:${cand.id}` },
      { intent: "attack", target: "npc:no-such-person" },
      { intent: "fetch", target: "9999" },
      { intent: "dance" },
      { intent: "hold", at: { x: Number.NaN, z: 0 } },
      "hold",
      null,
      { intent: "hold", who: 0xffffffff, at: { x: 1e9, z: 1e9 } },
    ]) me.send("command", bad);
    await sleep(500);
    expect(me.notices.length).toBe(before);
    expect(hand![1].cmd).toBe(cmdBefore);
  }, 60000);

  it("an unaffordable, overloaded manifest is trimmed at the ship's leaving in the fixed order, with a notice, and charged once", async () => {
    const { room, me } = await setup();
    me.send("loadoutSet", { loadout: { ammo: 2, medical: 3, provisions: 3, powder: 3, horses: 2, wagon: true } }); // £164 against a purse of £120
    await until(() => room.state.partyRev > 0, 2000, "the manifest");
    const purse0 = purse(room);
    expect(loadoutCost(partyOf(room).loadout)).toBeGreaterThan(purse0);
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");
    const kept = partyOf(room).loadout;
    const charged = purse0 - purse(room);
    expect(charged).toBe(loadoutCost(kept));
    expect(charged).toBeLessThanOrEqual(purse0);
    expect(me.notices.some((n) => /left on the quay/.test(n))).toBe(true);
    // the powder went first, the ammunition and the kits last
    expect(kept.powder).toBeLessThan(3);
    expect(kept.medical).toBe(3);
  }, 60000);

  it("hostile loadout, hire and command messages from every wrong state change nothing and never throw; spam is bounded", async () => {
    const { room, me } = await setup();
    const campaign0 = room.state.campaign;
    for (const bad of [null, "x", 7, [], { loadout: null }, { loadout: "everything" }, { loadout: { ammo: -5, horses: 1e12, wagon: "yes" } }]) me.send("loadoutSet", bad);
    for (const bad of [null, {}, { id: 7, on: true }, { id: "nobody-here", on: true }, { id: "../../etc", on: false }, { id: "x".repeat(5000), on: true }]) me.send("hire", bad);
    await sleep(500);
    // only the first (normalised) manifest may have changed the party; the hires changed nothing
    const p = partyOf(room);
    expect(p.roster.length).toBe(0);
    expect(p.loadout.horses).toBeLessThanOrEqual(2);
    expect(p.loadout.ammo).toBeGreaterThanOrEqual(0);
    expect(room.state.campaign).toBe(campaign0); // no hire was charged
    // flood: 60 manifests in a burst are throttled per sender (4 a second)
    const rev = room.state.partyRev;
    for (let i = 0; i < 60; i++) me.send("loadoutSet", { loadout: { ammo: i % 3, medical: 0, provisions: 0, powder: 0, horses: 0, wagon: false } });
    await sleep(400);
    expect((room.state.partyRev - rev) & 0xffff).toBeLessThanOrEqual(8);
    // a downed sender is ignored
    me.p.flags |= FLAG.DOWNED;
    const r2 = room.state.partyRev;
    await sleep(1200);
    me.send("loadoutSet", { loadout: { ammo: 2, medical: 2, provisions: 2, powder: 2, horses: 2, wagon: true } });
    await sleep(300);
    expect(room.state.partyRev).toBe(r2);
  }, 30000);

  const scenarioOf = (room: WorldRoom): { phase: string; template: string; resolution?: string } | undefined => (room.state.scenario ? JSON.parse(room.state.scenario) : undefined);

  it("sailing away COMMITS what happened (D-034 rule 1): right after landing nothing is committed (the campaign is byte-identical); after first blood it is `abandoned`, with the tally", async () => {
    const { room, me } = await setup({ scenario: "secure_crossing" });
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    const before = room.state.campaign;
    const rev = room.state.campaignRev;
    await sail(room, me, "kessar");
    expect(scenarioOf(room)?.phase).toBe("approach");
    place(room, me.p, A.landing.x, A.landing.z - 1, 0);
    await sail(room, me, "hollowmere");
    expect(room.state.campaign).toBe(before); // a misclick is not a war
    expect(room.state.campaignRev).toBe(rev);

    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");
    place(room, me.p, A.landing.x, A.landing.z - 1, 0);
    // a shot at the garrison: the site goes hostile (the same call Combat makes for a bullet that lands)
    (room as unknown as { damagePlayer(id: string, n: number, hit: unknown): void }).damagePlayer(npcKey("sentry-0"), 5, { zone: ZONE.TORSO, by: me.id });
    await until(() => ["fighting", "standoff"].includes(scenarioOf(room)?.phase ?? "") && scenarioOf(room)?.phase !== "approach", 3000, "the site to turn hostile");
    await sail(room, me, "hollowmere");
    const c = parseCampaign(room.state.campaign)!;
    expect(c.history.length).toBe(1);
    expect(c.history[0]).toMatchObject({ region: "kessar", resolution: "abandoned", template: "secure_crossing" });
    expect(c.tally.wounded).toBeGreaterThanOrEqual(1); // the blood is remembered
  }, 90000);

  it("a paid crossing is SETTLED: back at Kessar the dev-forced crossing starts resolved ('on the books'), and the paper remembers the toll", async () => {
    const { room, me } = await setup({ scenario: "secure_crossing" });
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");
    const warden = room.state.players.get(npcKey("warden"))!;
    place(room, me.p, warden.x, warden.z + 1.5, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => me.parleys.some((m) => m.view), 3000, "the parley to open");
    me.send("parleyPick", { option: me.parleys.find((m) => m.view)!.view!.options.findIndex((o) => o.id === "pay") });
    await until(() => room.state.campaignRev > 0, 3000, "the payment to commit");
    expect(scenarioOf(room)?.resolution).toBe("paid");
    place(room, me.p, A.landing.x, A.landing.z - 1, 0);
    await sail(room, me, "hollowmere");
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    const rev = room.state.campaignRev;
    await sail(room, me, "kessar");
    expect(scenarioOf(room)).toMatchObject({ template: "secure_crossing", phase: "resolved" }); // nothing to pay twice
    place(room, me.p, A.landing.x, A.landing.z - 1, 0);
    await sail(room, me, "hollowmere");
    expect(room.state.campaignRev).toBe(rev); // sailing past a settled crossing commits nothing more
    expect(parseCampaign(room.state.campaign)!.history.length).toBe(1);
  }, 90000);

  it("without a dev override the ledger decides: after a first crossing the next contract is not the crossing again", async () => {
    const { room, me } = await setup();
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");
    expect(scenarioOf(room)?.template).toBe("secure_crossing"); // the first visit is always the crossing
    const warden = room.state.players.get(npcKey("warden"))!;
    place(room, me.p, warden.x, warden.z + 1.5, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => me.parleys.some((m) => m.view), 3000, "the parley to open");
    me.send("parleyPick", { option: me.parleys.find((m) => m.view)!.view!.options.findIndex((o) => o.id === "pay") });
    await until(() => room.state.campaignRev > 0, 3000, "the payment to commit");
    place(room, me.p, A.landing.x, A.landing.z - 1, 0);
    await sail(room, me, "hollowmere");
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");
    expect(["hostage_rescue", "convoy_ambush", "border_incident"]).toContain(scenarioOf(room)?.template);
  }, 90000);

  it("a barrel is a powder keg: a rifle round into it sets it off (the prop is consumed, the blast is heard), a crate is only shoved", async () => {
    const { room, me } = await setup();
    const sp = spawnPoint(0, 4);
    const spawnAt = (kind: number, x: number, z: number): string =>
      (room as unknown as { spawnPropAt(k: number, x: number, z: number): string | undefined }).spawnPropAt(kind, x, z)!;
    const keg = spawnAt(PropKind.BARREL, sp.x, sp.z - 6);
    const crate = spawnAt(PropKind.CRATE, sp.x + 3, sp.z - 6);
    expect(keg).toBeDefined();
    place(room, me.p, sp.x, sp.z, 0);
    const d = me.input.data;
    d.weapon = weaponToWire(WEAPON.RIFLE);
    d.yaw = yawToWire(0);
    d.aimYaw = yawToWire(0);
    d.moveF = 0;
    d.moveR = 0;
    d.buttons = 0;
    me.input.send();
    await until(() => me.p.weapon === WEAPON.RIFLE + 1, 2000, "the rifle in hand");
    await sleep(WEAPONS[WEAPON.RIFLE].drawSeconds * 1000 + 450);
    const ps = room.state.props.get(keg)!;
    d.aimElev = elevToWire(Math.atan2(ps.y - (me.p.y + COMBAT.eyeHeight), 6));
    d.buttons = BUTTON.FIRE;
    me.input.send();
    await sleep(120);
    d.buttons = 0;
    me.input.send();
    await until(() => !room.state.props.has(keg), 3000, "the keg to go up");
    expect(room.state.props.has(crate)).toBe(true);
    expect(me.p.health).toBe(100); // six metres off: outside the blast
  }, 30000);

  it("an NPC's powder does not run out (the reserve of the firearm in hand is put back below 4 rounds); a person's is never touched", async () => {
    const { room, me } = await setup({ region: "kessar", scenario: "secure_crossing" });
    const combat = (room as unknown as { combat: unknown }).combat as unknown as { pcs: Map<string, { reserve: number[]; current: number }>; inspect(id: string): { reserve: number[] } | undefined };
    const sentryKey = npcKey("sentry-0");
    const w = room.state.players.get(sentryKey)!.weapon - 1;
    expect(w).toBeGreaterThanOrEqual(0);
    const pc = combat.pcs.get(sentryKey)!;
    pc.current = w as never;
    pc.reserve[w] = 1;
    const mine = combat.pcs.get(me.id)!;
    mine.current = WEAPON.RIFLE;
    mine.reserve[WEAPON.RIFLE] = 1;
    await sleep(400); // a few ticks: the sentry steps, a person does not
    expect(combat.inspect(sentryKey)!.reserve[w]).toBeGreaterThan(4);
    expect(combat.inspect(me.id)!.reserve[WEAPON.RIFLE]).toBe(1);
  }, 20000);

  it("a rider beside the field cannon is dismounted by INTERACT, never taken onto its crew (the saddle's press is not the gun's)", async () => {
    const { room, me } = await setup();
    const spot = regionMountSpots("hollowmere").horses[0]!;
    place(room, me.p, spot.x - 1.2, spot.z, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => (me.p.flags & FLAG.MOUNTED) !== 0, 2000, "the mount");
    const cannon = room.state.cannons.get("0")!;
    // the rider is carried to the breech end of the gun (what the server sees; the stable is a long way from it)
    place(room, me.p, cannon.x + Math.sin(cannon.yaw) * 1.6, cannon.z + Math.cos(cannon.yaw) * 1.6, cannon.yaw);
    await press(me, BUTTON.INTERACT);
    // (before the fix the gun took the press: he stayed in the saddle and was marked OPERATING; once down, a held INTERACT may of course work the gun)
    await until(() => (me.p.flags & FLAG.MOUNTED) === 0, 2000, "the dismount, not a crew place");
    expect((me.p.flags & FLAG.MOUNTED) !== 0 && (me.p.flags & FLAG.OPERATING) !== 0).toBe(false);
  }, 30000);

  it("a rider is a flag and a row: mount at the stable, sail, and nothing mounted survives the water (no stale MOUNTED, rows of the new shore are fresh)", async () => {
    const { room, me } = await setup();
    const spot = regionMountSpots("hollowmere").horses[0]!;
    place(room, me.p, spot.x - 1.2, spot.z, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => (me.p.flags & FLAG.MOUNTED) !== 0, 2000, "the mount");
    const row = [...room.state.mounts.values()].find((r) => r.rider === me.id);
    expect(row).toBeDefined();
    // dismount on a second press, remount, then sail while mounted
    await press(me, BUTTON.INTERACT);
    await until(() => (me.p.flags & FLAG.MOUNTED) === 0, 2000, "the dismount");
    place(room, me.p, spot.x - 1.2, spot.z, 0);
    await press(me, BUTTON.INTERACT);
    await until(() => (me.p.flags & FLAG.MOUNTED) !== 0, 2000, "the remount");
    place(room, me.p, CAMP.mapTable.x, CAMP.mapTable.z + 1.2, 0);
    await sail(room, me, "kessar");
    expect(me.p.flags & (FLAG.MOUNTED | FLAG.HITCHED | FLAG.GALLOPING)).toBe(0);
    expect(room.state.mounts.size).toBe(0); // the stable stayed home; nothing was in the manifest
    await sail(room, me, "hollowmere");
    expect(room.state.mounts.size).toBe(3); // the stable is rebuilt, clean
    expect([...room.state.mounts.values()].every((r) => r.rider === "")).toBe(true);
  }, 60000);
});
