import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MoveInput, REACT, ROOM_WORLD, WEAPON, reactKind, weaponToWire, yawToWire, type HitEvent, type HitMarkEvent, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Combat } from "../systems/Combat.ts";
import type { Flung } from "../systems/Flung.ts";
import type { Mayhem } from "../systems/Mayhem.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-108 through a real room: with a pistol in hand, V is the boot. A sentry on his feet is lifted, thrown several metres and laid on his back (every client told), the
 * Society bills it, the body is watched for what it meets; a second boot on him, down, is the coup de grâce. Port 2650.
 */
const PORT = 2650;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Inner = { combat: Combat; flung: Flung; mayhem: Mayhem };

describe("the boot in a real room (D-108)", () => {
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

  it("a boot lifts a sentry, throws him metres back and lays him flat; a second boot on him, down, is the coup de grâce", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["sever", "impact", "boom", "station", "notice", "parley", "saved", "cry", "bark", "gazette", "shot", "lasso"]) c.onMessage(t, () => undefined);
    const hits: HitEvent[] = [];
    const marks: HitMarkEvent[] = [];
    c.onMessage("hit", (e: HitEvent) => void hits.push(e));
    c.onMessage("hitmark", (e: HitMarkEvent) => void marks.push(e));
    await sleep(300);
    const inner = room as unknown as Inner;
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const key = "npc:sentry-3";
    const s = room.state.players.get(key)! as PlayerStateType;
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    // the pistol drawn, facing north (yaw 0 looks down -Z), a pace south of him
    d.weapon = weaponToWire(WEAPON.PISTOL);
    d.yaw = d.aimYaw = yawToWire(0);
    for (let i = 0; i < 25; i++) {
      input.send();
      await sleep(40);
    }
    await until(() => me.weapon === weaponToWire(WEAPON.PISTOL), 3000, "the pistol drawn");
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 1.2}:0` });
    for (let i = 0; i < 4; i++) {
      input.send();
      await sleep(40);
    }
    const x0 = s.x;
    const z0 = s.z;
    const health0 = s.health;
    d.buttons = BUTTON.MELEE;
    input.send();
    await until(() => hits.some((h) => h.id === key && h.boot === true), 3000, "the boot");
    d.buttons = 0;
    input.send();
    expect(reactKind(s.react)).toBe(REACT.FLOORED);
    expect(inner.combat.stats.boots).toBe(1);
    expect(inner.flung.stats.watched).toBeGreaterThanOrEqual(1);
    await until(() => Math.hypot(s.x - x0, s.z - z0) > 3, 3000, "him thrown back");
    expect(s.z).toBeLessThan(z0); // (away from her: north)
    expect(health0 - s.health).toBeLessThan(40); // (the boot itself barely hurts; whatever he met does)
    expect(inner.mayhem.bill.boots).toBe(1);
    expect((s.flags & FLAG.DOWNED) !== 0).toBe(false);
    // he lies: she walks up and boots him again (the stamp)
    await sleep(1100); // (the boot's cooldown)
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 1.0}:0` });
    for (let i = 0; i < 4; i++) {
      input.send();
      await sleep(40);
    }
    expect(reactKind(s.react)).toBe(REACT.FLOORED);
    d.buttons = BUTTON.MELEE;
    input.send();
    await until(() => marks.some((m) => m.fin === true), 3000, "the stamp");
    d.buttons = 0;
    input.send();
    expect((s.flags & FLAG.DOWNED) !== 0).toBe(true);
  }, 30_000);
});
