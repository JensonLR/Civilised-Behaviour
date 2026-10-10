import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MoveInput, REACT, ROOM_WORLD, SHIELD, WEAPON, ZONE, reactKind, weaponToWire, yawToWire, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Casualties } from "../systems/Casualties.ts";
import type { Combat } from "../systems/Combat.ts";
import type { Flung } from "../systems/Flung.ts";
import type { Mayhem } from "../systems/Mayhem.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-112 through a real room: a sentry doubled over in front of Ada is seized as a shield with GRAB. He is held up in front of her as she walks, she can still fire,
 * his own side's rounds would meet him (hers never do), and the Society bills it. GRAB again shoves him off onto his back, watched for what he meets; held too long, he
 * works himself free. Port 2653.
 */
const PORT = 2653;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Inner = {
  cast: { order(group: string, o: { o: "stand_down" }): void; byKey: Map<string, { group: string }> };
  casualties: { damage: Casualties["damage"]; shieldOf: Casualties["shieldOf"]; shields: Map<string, { left: number }> };
  combat: { stats: Combat["stats"]; hittable(shooter: string, id: string, t: PlayerStateType): boolean };
  flung: Flung;
  mayhem: Mayhem;
};

describe("the human shield in a real room (D-112)", () => {
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

  it("a doubled-over sentry is seized, held in front as she walks and fires, and shoved off onto his back; held too long he works free", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["sever", "impact", "boom", "station", "notice", "parley", "saved", "cry", "bark", "gazette", "shot", "lasso", "hit", "hitmark"]) c.onMessage(t, () => undefined);
    await sleep(300);
    const inner = room as unknown as Inner;
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const key = "npc:sentry-3";
    const s = room.state.players.get(key)! as PlayerStateType;
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    const send = async (n = 4): Promise<void> => {
      for (let i = 0; i < n; i++) {
        input.send();
        await sleep(40);
      }
    };
    // the pistol drawn, facing north (yaw 0 looks down -Z), a pace south of him
    d.weapon = weaponToWire(WEAPON.PISTOL);
    d.yaw = d.aimYaw = yawToWire(0);
    await send(25);
    await until(() => me.weapon === weaponToWire(WEAPON.PISTOL), 3000, "the pistol drawn");
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 1.2}:0` });
    await send();
    // a blow to the body doubles him over (nobody's: no side is provoked)
    inner.casualties.damage(key, 30, { zone: ZONE.TORSO, dirX: 0, dirZ: -1 });
    expect(reactKind(s.react)).toBe(REACT.DOUBLED);
    d.buttons = BUTTON.GRAB;
    await send(1);
    await until(() => s.roped === SHIELD.held, 3000, "him seized");
    d.buttons = 0;
    await send(1);
    expect((s.flags & FLAG.DRAGGED) !== 0).toBe(true);
    expect((me.flags & FLAG.DRAGGING) !== 0).toBe(true);
    expect(s.dragger).toBe(c.sessionId);
    expect(inner.casualties.shieldOf(c.sessionId)).toBe(key);
    expect(inner.mayhem.bill.shields).toBe(1);
    // his own side's rounds would meet him; hers pass him by
    expect(inner.combat.hittable("npc:sentry-1", key, s)).toBe(true);
    expect(inner.combat.hittable(c.sessionId, key, s)).toBe(false);
    // (the garrison stood down for the rest: her shot over his shoulder would bring the Ward down on her, and a downed holder lets go, which is the game but not this test)
    inner.cast.order(inner.cast.byKey.get(key)!.group, { o: "stand_down" });
    // she walks north with him: he stays a pace in front, facing the way she faces
    d.moveF = 127;
    await send(20);
    d.moveF = 0;
    await send(6);
    expect(s.roped).toBe(SHIELD.held);
    expect(Math.hypot(s.x - me.x, s.z - me.z)).toBeLessThan(1.1);
    expect(s.z).toBeLessThan(me.z);
    // she can still fire over his shoulder
    const shots = inner.combat.stats.shots;
    d.buttons = BUTTON.FIRE;
    await send(1);
    d.buttons = 0;
    await send(3);
    expect(inner.combat.stats.shots).toBeGreaterThan(shots);
    // GRAB again shoves him off: forward, onto his back, watched for what he meets
    await sleep(600); // (the pistol's cooldown has nothing to do with it; the press must be a new one)
    const z0 = s.z;
    d.buttons = BUTTON.GRAB;
    await send(1);
    await until(() => s.roped === 0, 3000, "him shoved off");
    d.buttons = 0;
    await send(1);
    expect(reactKind(s.react)).toBe(REACT.FLOORED);
    expect((me.flags & FLAG.DRAGGING) !== 0).toBe(false);
    expect(inner.flung.stats.watched).toBeGreaterThanOrEqual(1);
    await until(() => s.z < z0 - 1.5, 3000, "him thrown forward");
    // seized again once he is staggered, and held past his time: he works himself free
    await until(() => s.react === 0, 5000, "him up");
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 1.2}:0` });
    await send();
    inner.casualties.damage(key, 30, { zone: ZONE.TORSO, dirX: 0, dirZ: -1 });
    d.buttons = BUTTON.GRAB;
    await send(1);
    await until(() => s.roped === SHIELD.held, 3000, "him seized again");
    d.buttons = 0;
    await send(1);
    inner.casualties.shields.get(key)!.left = 0.05;
    await until(() => s.roped === 0 && (s.flags & FLAG.DRAGGED) === 0, 3000, "him free");
    expect((me.flags & FLAG.DRAGGING) !== 0).toBe(false);
  }, 40_000);
});
