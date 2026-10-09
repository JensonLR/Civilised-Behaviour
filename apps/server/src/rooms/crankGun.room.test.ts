import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BUTTON, CRANK, CRANK_PHASE, FLAG, crankJams, MoveInput, NPC, ROOM_WORLD, WEAPON, WEAPONS, crankSpot, elevToWire, foundOutpost, newCampaign, newSettlements, yawToWire,
  type CampaignState, type CannonStateType, type NpcSpec, type PlayerStateType, type SettlementsState, type WeaponId,
} from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-092: the post's crank gun through a real room. Port 2643 (one per integration test file). */
const PORT = 2643;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Priv = {
  campaign: CampaignState; settlements: SettlementsState; rebuildWorld(): void;
  world: { terrainHeight(x: number, z: number): number; obstacles: readonly { tag?: string; x: number; z: number }[] };
  cast: { spawn(specs: readonly NpcSpec[]): number };
};

describe("the crank gun (D-092)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  /** A Kessar room whose post is a stockade and whose works has cast the gun (or not), and one player. */
  async function setup(crank = true) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 77, region: "kessar" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Gunner" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "notice", "parley", "station", "saved", "bark"]) c.onMessage(t, () => undefined);
    const me = { id: c.sessionId, p: room.state.players.get(c.sessionId)!, input: c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input };
    await sleep(150);
    const priv = room as unknown as Priv;
    const founded = foundOutpost(newSettlements(), "kessar", newCampaign(77), 77);
    priv.settlements = {
      ...founded,
      posts: { kessar: { ...founded.posts.kessar!, stage: "fortified_outpost", supply: 60, security: 60, trade: 50 } },
      tech: { ...founded.tech, breech: true, works: "kessar", crank },
    };
    priv.rebuildWorld();
    await sleep(100);
    return { room, me, priv };
  }
  const until = async (cond: () => boolean, ms: number, what: string) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };
  /** Hold `buttons` (aimed down the gun's rest heading) until `cond`, sending a frame every 33 ms. */
  const holdUntil = async (me: { input: Input }, buttons: number, yaw: number, cond: () => boolean, ms: number, what: string) => {
    const d = me.input.data;
    const end = Date.now() + ms;
    do {
      d.moveF = d.moveR = 0;
      d.buttons = buttons;
      d.yaw = yawToWire(yaw);
      d.aimYaw = yawToWire(yaw);
      d.aimElev = elevToWire(0);
      me.input.send();
      await sleep(33);
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    } while (!cond());
  };
  const behind = (priv: Priv, p: PlayerStateType, g: CannonStateType, back = 1.2) => {
    p.x = g.x + Math.sin(g.yaw) * back;
    p.z = g.z + Math.cos(g.yaw) * back;
    p.y = priv.world.terrainHeight(p.x, p.z);
    p.vx = p.vz = 0;
    p.facing = g.yaw;
  };

  it("stands, solid, inside the stockade trained on the gate with a full hopper and three in the limber; never without the tech", async () => {
    const { room, priv } = await setup();
    const g = room.state.cannons.get("crank")!;
    const at = crankSpot("kessar")!;
    expect(g).toMatchObject({ kind: 1, phase: CRANK_PHASE.READY, progress: WEAPONS[WEAPON.CRANK].ranged!.magazine, shells: CRANK.hoppers - 1, crew: 0 });
    expect(g.x).toBeCloseTo(at.x, 4);
    expect(g.z).toBeCloseTo(at.z, 4);
    expect(g.yaw).toBeCloseTo(at.yaw, 4);
    expect(priv.world.obstacles.some((o) => o.tag === "cannon" && Math.hypot(o.x - at.x, o.z - at.z) < 0.01)).toBe(true);
    // the works has not cast one: no gun, no carriage
    const bare = await setup(false);
    expect(bare.room.state.cannons.has("crank")).toBe(false);
    expect(bare.priv.world.obstacles.some((o) => o.tag === "cannon")).toBe(false);
  }, 30_000);

  it("held Use with the trigger turns the handle: rounds out of the barrels into a raider in front, the hopper emptying, the gunner's own pistol silent; a jam and an empty hopper are seen to with Use alone", async () => {
    const { room, me, priv } = await setup();
    const g = room.state.cannons.get("crank")!;
    behind(priv, me.p, g);
    // a Syndicate raider eight metres down the barrels, standing still (bare hands, a civil brain: it does not shoot back)
    const tx = g.x - Math.sin(g.yaw) * 8, tz = g.z - Math.cos(g.yaw) * 8;
    priv.cast.spawn([{ id: "target", role: NPC.SENTRY, faction: "rival", side: "rival", group: "target", post: { x: tx, z: tz }, weapon: WEAPON.FISTS as WeaponId, lookSeed: 3, name: "Target", skill: 10, bravery: 100, brain: "civil" }]);
    await sleep(100);
    const target = room.state.players.get("npc:target")!;
    target.x = tx;
    target.z = tz;
    target.y = priv.world.terrainHeight(tx, tz);
    const hp = target.health;
    const myShots = me.p.shots;
    // the trigger alone, without Use, does nothing to the gun
    await holdUntil(me, BUTTON.FIRE, g.yaw, () => true, 600, "a moment");
    await sleep(300);
    expect(g.fired).toBe(0);
    // Use and the trigger: it fires, the gunner works it, the raider is hit
    await holdUntil(me, BUTTON.INTERACT | BUTTON.FIRE, g.yaw, () => g.fired >= 6 || g.phase === CRANK_PHASE.JAMMED, 6000, "six rounds (or a jam)");
    expect(me.p.flags & FLAG.OPERATING).toBeTruthy();
    expect(g.crew).toBe(1);
    expect(me.p.shots).toBe(myShots);
    await until(() => target.health < hp || (target.flags & FLAG.DOWNED) !== 0, 2000, "the raider hit");
    // crank to the bottom of the hopper, seeing to every jam on the way with Use alone
    let jams = 0;
    for (let guard = 0; guard < 60 && g.phase !== CRANK_PHASE.CHANGING; guard++) {
      if (g.phase === CRANK_PHASE.JAMMED) {
        jams++;
        const t0 = Date.now();
        await holdUntil(me, BUTTON.INTERACT | BUTTON.FIRE, g.yaw, () => true, 400, "a turn");
        expect(g.phase, "turning a jammed handle clears nothing").toBe(CRANK_PHASE.JAMMED);
        await holdUntil(me, BUTTON.INTERACT, g.yaw, () => g.phase === CRANK_PHASE.READY, CRANK.clearSeconds * 4000, "the jam cleared");
        expect(Date.now() - t0).toBeGreaterThan(CRANK.clearSeconds * 1000 * 0.8);
      } else await holdUntil(me, BUTTON.INTERACT | BUTTON.FIRE, g.yaw, () => g.phase !== CRANK_PHASE.READY, 12_000, "the hopper empty or a jam");
    }
    expect(g.phase).toBe(CRANK_PHASE.CHANGING);
    expect(g.shells).toBe(CRANK.hoppers - 1);
    // the next hopper: Use alone, the trigger let go
    await holdUntil(me, BUTTON.INTERACT, g.yaw, () => g.phase === CRANK_PHASE.READY, CRANK.changeSeconds * 4000, "a fresh hopper");
    expect(g.progress).toBe(WEAPONS[WEAPON.CRANK].ranged!.magazine);
    expect(g.shells).toBe(CRANK.hoppers - 2);
    expect(me.p.shots, "the gunner's own weapon never fired").toBe(myShots);
    // (the jams are the gun's own and the same every time: on world seed 77 its rounds 2, 12 and 33 jam, each cleared above with Use alone)
    expect(jams).toBe(3);
    expect([2, 12, 33].every((n) => crankJams(77, 0, n))).toBe(true);
    // let go: the gunner is free again
    await holdUntil(me, 0, g.yaw, () => (me.p.flags & FLAG.OPERATING) === 0, 2000, "released");
    expect(g.crew).toBe(0);
  }, 90_000);
});
