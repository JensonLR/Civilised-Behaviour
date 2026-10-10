import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FINISHER, FLAG, MoveInput, REACT, ROOM_WORLD, WEAPON, ZONE, aimShake, reactKind, setWound, weaponToWire, yawToWire, type HitEvent, type HitMarkEvent, type LassoEvent, type PlayerStateType, type ShotEvent } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Casualties } from "../systems/Casualties.ts";
import type { Combat } from "../systems/Combat.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-104 through a real room: a sentry shot in the arm loses his rifle (gone from his kit, fists up, the state tells the clients), one shot in the leg goes down on the knee
 * and gets up again; and a player's wounded arm widens the cone the server itself draws the shot from. Port 2648.
 */
const PORT = 2648;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Inner = { casualties: Casualties; combat: Combat };

describe("hit reactions in a real room (D-104)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(30);
    }
  };

  async function kessar() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    const shots: ShotEvent[] = [];
    for (const t of ["sever", "impact", "boom", "station", "notice", "parley", "saved", "cry", "bark", "gazette"]) c.onMessage(t, () => undefined);
    const loops: LassoEvent[] = [];
    c.onMessage("lasso", (e: LassoEvent) => void loops.push(e));
    const marks: HitMarkEvent[] = [];
    const hits: HitEvent[] = [];
    c.onMessage("hitmark", (e: HitMarkEvent) => void marks.push(e));
    c.onMessage("hit", (e: HitEvent) => void hits.push(e));
    c.onMessage("shot", (e: ShotEvent) => void shots.push(e));
    await sleep(300);
    return { room, c, shots, marks, hits, loops, inner: room as unknown as Inner, me: room.state.players.get(c.sessionId)! as PlayerStateType };
  }

  it("an arm shot takes a sentry's rifle and puts his fists up; a leg shot floors him, and he gets up", async () => {
    const { room, inner } = await kessar();
    const key = "npc:sentry-1";
    const s = room.state.players.get(key)! as PlayerStateType;
    await until(() => s.weapon !== 0, 3000, "the sentry armed");
    const held = s.weapon;
    expect(held).not.toBe(weaponToWire(WEAPON.FISTS));
    inner.casualties.damage(key, 24, { zone: ZONE.ARM_R, dirX: 1, dirZ: 0 });
    expect(reactKind(s.react)).toBe(REACT.DISARMED);
    expect(s.weapon).toBe(weaponToWire(WEAPON.FISTS)); // (the same tick: the clients never see the rifle in the hand and in the air at once)
    expect((inner.combat.inspect(key)!.owned & (1 << (held - 1))) === 0).toBe(true);
    await sleep(1500);
    expect(s.weapon).toBe(weaponToWire(WEAPON.FISTS)); // (his brain fights with what he holds now)
    expect(s.react).toBe(0);
    inner.casualties.damage(key, 30, { zone: ZONE.LEG_L, dirX: 1, dirZ: 0 });
    expect(reactKind(s.react)).toBe(REACT.FLOORED);
    await until(() => s.react === 0, 3000, "him up again");
  }, 20_000);

  it("a player's wounded arm widens the cone the server draws the shot from", async () => {
    const { c, shots, me } = await kessar();
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    d.weapon = weaponToWire(WEAPON.PISTOL);
    d.yaw = d.aimYaw = yawToWire(Math.PI / 2);
    d.aimElev = 0;
    const shoot = async (): Promise<ShotEvent> => {
      const n = shots.length;
      for (let i = 0; i < 60 && shots.length === n; i++) {
        d.buttons = BUTTON.FIRE;
        input.send();
        await sleep(40);
        d.buttons = 0;
        input.send();
        await sleep(40);
      }
      expect(shots.length).toBeGreaterThan(n);
      return shots[shots.length - 1]!;
    };
    for (let i = 0; i < 15; i++) {
      input.send();
      await sleep(40);
    }
    const steady = await shoot();
    await sleep(700);
    me.wounds = setWound(0, ZONE.ARM_R, 3);
    const shaky = await shoot();
    expect(shaky.spread).toBeCloseTo(steady.spread * aimShake(me.wounds, 0), 5);
    expect(shaky.spread).toBeGreaterThan(steady.spread * 1.5);
  }, 30_000);

  it("D-105: a sabre on a floored sentry finishes him (down, marked as a coup de grace to the one who struck, a second wind for her); on a man on his feet it is only a blow", async () => {
    const { room, c, marks, hits, inner, me } = await kessar();
    const key = "npc:sentry-3";
    const s = room.state.players.get(key)! as PlayerStateType;
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    // the sabre drawn, facing north (yaw 0 looks down -Z)
    d.weapon = weaponToWire(WEAPON.SABRE);
    d.yaw = d.aimYaw = yawToWire(0);
    d.aimElev = 0;
    for (let i = 0; i < 25; i++) {
      input.send();
      await sleep(40);
    }
    await until(() => me.weapon === weaponToWire(WEAPON.SABRE), 3000, "the sabre drawn");
    me.health = 60;
    // the second wind, measured across the room's own payout (any other harm to her in the same moment would blur her health)
    const host = (inner.combat as unknown as { host: { finished?: (by: string, t: string, w: number) => void } }).host;
    const paid = host.finished!.bind(host);
    let gained = 0;
    host.finished = (by, t, w) => {
      const h0 = me.health;
      paid(by, t, w);
      gained = me.health - h0;
    };
    // floored by a blow nobody is named for (so the Ward is not up yet), then she steps up just south of him and swings
    inner.casualties.damage(key, 30, { zone: ZONE.LEG_L, dirX: 0, dirZ: -1 });
    expect(reactKind(s.react)).toBe(REACT.FLOORED);
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 1.2}:0` });
    for (let i = 0; i < 4; i++) {
      input.send();
      await sleep(40);
    }
    d.buttons = BUTTON.FIRE;
    input.send();
    await until(() => marks.some((m) => m.fin === true), 3000, "the coup de grace");
    d.buttons = 0;
    input.send();
    expect((s.flags & FLAG.DOWNED) !== 0).toBe(true);
    expect(gained).toBe(FINISHER.heal);
    expect(hits.some((h) => h.id === key && h.fin === true && h.down)).toBe(true);
    // the control, last: the same blade on a sentry on his feet is an ordinary blow. Her finisher roused the Ward, who move and shoot (CI read his spot 900 ms before
    // the swing, and he had gone), so the garrison is stood down first: he stops where he is, on his feet, and nobody shoots her
    const cast = (room as unknown as { cast: { order(group: string, o: { o: "stand_down" }): void; byKey: Map<string, { group: string }> } }).cast;
    cast.order(cast.byKey.get("npc:sentry-1")!.group, { o: "stand_down" });
    await sleep(900); // (he comes to a stop; the sabre's cooldown)
    const o = room.state.players.get("npc:sentry-1")! as PlayerStateType;
    expect((o.flags & FLAG.DOWNED) !== 0).toBe(false);
    me.health = 100;
    c.send("debug", { cmd: `tp:${o.x}:${o.z + 1.1}:0` });
    for (let i = 0; i < 4; i++) {
      input.send();
      await sleep(40);
    }
    const n = marks.length;
    d.buttons = BUTTON.FIRE;
    input.send();
    await until(() => marks.length > n, 3000, "the ordinary blow");
    expect(marks[n]!.fin).toBeUndefined();
    expect(marks.filter((m) => m.fin).length).toBe(1);
  }, 30_000);

  it("D-106: the lariat thrown at a sentry ahead: every client sees the loop fly, he is roped and hauled, and the same key lets him go", async () => {
    const { room, c, loops, me } = await kessar();
    const key = "npc:sentry-3";
    const s = room.state.players.get(key)! as PlayerStateType;
    // six metres south of him, facing him (north: yaw 0 looks down -Z)
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 6}:0` });
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    d.yaw = d.aimYaw = yawToWire(0);
    for (let i = 0; i < 10; i++) {
      input.send();
      await sleep(40);
    }
    d.buttons = BUTTON.GRAB;
    input.send();
    await sleep(60);
    d.buttons = 0;
    input.send();
    await until(() => loops.length > 0, 2000, "the loop thrown");
    expect(loops[0]).toMatchObject({ by: c.sessionId, hit: true });
    await until(() => s.roped === 1, 2000, "him roped");
    expect(s.dragger).toBe(c.sessionId);
    expect((s.flags & FLAG.DRAGGED) !== 0).toBe(true);
    expect((me.flags & FLAG.DRAGGING) !== 0).toBe(true);
    // let go
    await sleep(300);
    d.buttons = BUTTON.GRAB;
    input.send();
    await sleep(60);
    d.buttons = 0;
    input.send();
    await until(() => s.roped === 0 && (s.flags & FLAG.DRAGGED) === 0, 2000, "him let go");
  }, 30_000);
});
