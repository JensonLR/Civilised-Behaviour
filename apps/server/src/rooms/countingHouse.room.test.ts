import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, COMBAT, FLAG, KESSAR_SITES, MoveInput, OUTPOST_SITES, ROOM_WORLD, WEAPON, ZONE, elevToWire, parsePowers, weaponToWire, yawToWire, type CollisionWorld, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-095: the Siege of the Counting-House through a real room: the Syndicate's post solid at Kessar, a picket planted by standing on its mark, a real rifle ball starting the storm, and the post struck when it falls. Port 2645. */
const PORT = 2645;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Priv = { world: CollisionWorld; damagePlayer(id: string, dmg: number, o?: { zone?: number }): void };
const SYN = OUTPOST_SITES.kessar!.rivalSite;
const S = KESSAR_SITES.siege;

describe("the Siege of the Counting-House in a real room (D-095)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function siege() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "counting_house" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "notice", "parley", "saved", "cry", "bark", "gazette", "telegram"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(400);
    c.send("debug", { cmd: "synpost:2" });
    await sleep(300);
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const npc = (id: string): PlayerStateType | undefined => room.state.players.get(`npc:${id}`);
    return { room, c, me, input, npc, priv: room as unknown as Priv };
  }
  const view = (room: WorldRoom): { resolution?: string; phase: string; objectives: { id: string; done: boolean }[] } => JSON.parse(room.state.scenario);
  const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(50);
    }
  };
  const synObstacles = (w: CollisionWorld): number => w.obstacles.filter((o) => Math.hypot(o.x - SYN.x, o.z - SYN.z) < 9 && (o.tag === "tent" || o.tag === "house" || o.tag === "stall")).length;

  it("the Syndicate's post stands solid; the garrison and the factor stand at their stations; standing on a picket mark brings the Ward's boy to it", async () => {
    const { room, c, npc, priv } = await siege();
    expect(synObstacles(priv.world), "tent, hut and counter").toBe(3);
    expect(parsePowers(room.state.powers)!.rival.posts).toBe(2);
    for (const id of ["factor", "garrison-0", "garrison-1", "sally-0", "sally-1"]) expect(npc(id), id).toBeDefined();
    const f = npc("factor")!;
    expect(Math.hypot(f.x - S.factor.x, f.z - S.factor.z)).toBeLessThan(1.5);
    expect(npc("picket-0")).toBeUndefined();
    c.send("debug", { cmd: `tp:${S.pickets[0]!.x}:${S.pickets[0]!.z}:0` });
    await until(() => npc("picket-0") !== undefined, 4000, "the picket boy");
    expect(view(room).objectives[0]!.id).toBe("picket1");
    expect(view(room).resolution).toBeUndefined();
  }, 40_000);

  it("a rifle ball into the yard is the storm; three of its four down and the post falls, and with it the Syndicate's post at Kessar", async () => {
    const { room, c, me, input, npc, priv } = await siege();
    const g = npc("garrison-0")!;
    // 14 m north of the yard's first gun, square on
    c.send("debug", { cmd: `tp:${g.x}:${g.z - 14}:0` });
    await sleep(600);
    const d = input.data;
    const dx = g.x - me.x, dz = g.z - me.z;
    d.weapon = weaponToWire(WEAPON.RIFLE);
    d.yaw = yawToWire(Math.atan2(-dx, -dz));
    d.aimYaw = d.yaw;
    d.aimElev = elevToWire(Math.atan2(g.y + 1.2 - (me.y + COMBAT.eyeHeight), Math.hypot(dx, dz)));
    for (let i = 0; i < 30; i++) { d.buttons = BUTTON.AIM; input.send(); await sleep(40); }
    const shots = me.shots;
    for (let i = 0; i < 20 && me.shots === shots; i++) { d.buttons = BUTTON.AIM | BUTTON.FIRE; input.send(); await sleep(40); d.buttons = BUTTON.AIM; input.send(); await sleep(40); }
    expect(me.shots, "the rifle fired").not.toBe(shots);
    await until(() => view(room).objectives.some((o) => o.id === "storm"), 4000, "the storm");
    // (the rest of the fight is the reducer's and the runner's tests: the last three go down through the room's own damage path)
    c.send("debug", { cmd: "tp:0:88:0" });
    for (const id of ["garrison-0", "garrison-1", "sally-0"]) priv.damagePlayer(`npc:${id}`, 1000, { zone: ZONE.TORSO });
    await until(() => view(room).resolution !== undefined, 5000, "the fall");
    expect(view(room).resolution).toBe("siege_stormed");
    expect((npc("garrison-1")!.flags & FLAG.DOWNED) !== 0).toBe(true);
    await until(() => parsePowers(room.state.powers)!.rival.posts === 0, 4000, "the post struck");
    expect(synObstacles(priv.world), "the world is rebuilt without it").toBe(0);
  }, 60_000);
});
