import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BEAST, BUTTON, COMBAT, FLAG, HIGHMARK_SITES, MoveInput, ROOM_WORLD, WEAPON, elevToWire, weaponToWire, yawToWire, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-094: the Great Grey through a real room: a beast's body, its shyness, a real rifle ball, its charge and its horns, and two of its endings. Port 2644. */
const PORT = 2644;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };

describe("the Great Grey in a real room (D-094)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function hunt() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "highmark", scenario: "great_grey" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "station", "notice", "parley", "saved", "cry", "bark", "gazette"]) c.onMessage(t, () => undefined);
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    await sleep(400);
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const grey = (): PlayerStateType => room.state.players.get("npc:grey")!;
    return { room, c, me, input, grey };
  }
  const view = (room: WorldRoom): { resolution?: string; phase: string } => JSON.parse(room.state.scenario) as { resolution?: string; phase: string };
  const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(50);
    }
  };
  /** Aims at the beast's barrel from where `me` stands and fires one rifle ball (held aim first, so the cone is tight). */
  async function shootAt(input: Input, me: PlayerStateType, t: PlayerStateType, height = 1.12): Promise<void> {
    const d = input.data;
    const dx = t.x - me.x, dz = t.z - me.z, dist = Math.hypot(dx, dz);
    d.weapon = weaponToWire(WEAPON.RIFLE);
    d.moveF = d.moveR = 0;
    d.yaw = yawToWire(Math.atan2(-dx, -dz));
    d.aimYaw = d.yaw;
    d.aimElev = elevToWire(Math.atan2(t.y + height - (me.y + COMBAT.eyeHeight), dist));
    for (let i = 0; i < 30; i++) {
      d.buttons = BUTTON.AIM;
      input.send();
      await sleep(40);
    }
    const shots = me.shots;
    for (let i = 0; i < 20 && me.shots === shots; i++) {
      d.buttons = BUTTON.AIM | BUTTON.FIRE;
      input.send();
      await sleep(40);
      d.buttons = BUTTON.AIM;
      input.send();
      await sleep(40);
    }
    expect(me.shots, "the rifle fired").not.toBe(shots);
  }

  it("stands in the barley as a beast (flagged, its own health), walks away from a person who comes near, and is nobody's casualty", async () => {
    const { room, c, grey } = await hunt();
    const g = grey();
    expect(g.flags & FLAG.BEAST).toBeTruthy();
    expect(g.health).toBe(BEAST.health);
    const B = HIGHMARK_SITES.strike.barley;
    expect(Math.hypot(g.x - B.x, g.z - B.z)).toBeLessThan(B.r);
    // walk up to 5 m east of it and stand: it moves off, west
    const x0 = g.x, z0 = g.z;
    c.send("debug", { cmd: `tp:${x0 + 5}:${z0}:0` });
    await sleep(2500);
    expect(grey().x, "it walked away from the person east of it").toBeLessThan(x0 - 1.5);
    expect(Math.hypot(grey().x - (x0 + 5), grey().z - z0)).toBeGreaterThan(6);
    expect(view(room).resolution).toBeUndefined();
  }, 40_000);

  it("a rifle ball from the side takes its barrel (its own body); wounded, it turns on the shooter and its horns hurt; without the licence the shot is poaching", async () => {
    const { room, c, me, input, grey } = await hunt();
    const g = grey();
    // 11 m south of it (it shies at 9 m), broadside
    c.send("debug", { cmd: `tp:${g.x}:${g.z + 11}:0` });
    await sleep(600);
    await shootAt(input, me, grey());
    await until(() => grey().health < BEAST.health, 3000, "the ball to land");
    expect(grey().flags & FLAG.DOWNED, "one ball does not drop it").toBeFalsy();
    // it comes for the shooter: stand still and it closes, and gores
    input.data.buttons = 0;
    input.send();
    const hp = me.health;
    await until(() => me.health < hp || (me.flags & FLAG.DOWNED) !== 0, 9000, "the horns");
    expect(hp - me.health).toBeGreaterThanOrEqual(BEAST.hornDamage - 1);
    expect(view(room).resolution).toBeUndefined();
  }, 60_000);

  it("shot down, it is the trophy; driven into the drovers' camp, it is driven", async () => {
    const a = await hunt();
    const g = a.grey();
    a.c.send("debug", { cmd: `tp:${g.x}:${g.z + 11}:0` });
    await sleep(600);
    g.health = 5;   // (the last ball: the rest of the fight is the test above)
    await shootAt(a.input, a.me, a.grey());
    await until(() => view(a.room).resolution !== undefined, 4000, "the trophy");
    expect(view(a.room).resolution).toBe("grey_trophy");
    expect(a.grey().flags & FLAG.DOWNED).toBeTruthy();
    // a second room: the beast walked into the fold (put there; the Cast's own steps carry it the last metre)
    const b = await hunt();
    const F = HIGHMARK_SITES.hunt.fold;
    const row = b.grey();
    row.x = F.x + 2;
    row.z = F.z + 2;
    await until(() => view(b.room).resolution !== undefined, 4000, "the fold");
    expect(view(b.room).resolution).toBe("grey_driven");
  }, 60_000);
});
