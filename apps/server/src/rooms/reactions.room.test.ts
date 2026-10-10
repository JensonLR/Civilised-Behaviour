import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, MoveInput, REACT, ROOM_WORLD, WEAPON, ZONE, aimShake, reactKind, setWound, weaponToWire, yawToWire, type PlayerStateType, type ShotEvent } from "@cb/shared";
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
    for (const t of ["hit", "sever", "impact", "boom", "hitmark", "station", "notice", "parley", "saved", "cry", "bark", "gazette"]) c.onMessage(t, () => undefined);
    c.onMessage("shot", (e: ShotEvent) => void shots.push(e));
    await sleep(300);
    return { room, c, shots, inner: room as unknown as Inner, me: room.state.players.get(c.sessionId)! as PlayerStateType };
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
});
