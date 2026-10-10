import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MOUNT_FLAG, MoveInput, REACT, ROOM_WORLD, reactKind, yawToWire, type HitEvent, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Combat } from "../systems/Combat.ts";
import type { Flung } from "../systems/Flung.ts";
import type { Mayhem } from "../systems/Mayhem.ts";
import type { Mounts } from "../systems/Mounts.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-111 through a real room: Ada mounts a horse and gallops at a sentry. He is ridden down: every client is told (laid flat, the hooves heard), he is thrown ahead
 * and off the horse's line, floored, watched for what he meets, and the Society bills it. Port 2652.
 */
const PORT = 2652;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Inner = { combat: Combat; flung: Flung; mayhem: Mayhem; mounts: Mounts };

describe("ridden down in a real room (D-111)", () => {
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

  it("a galloping horse rides a sentry down: thrown ahead and aside, laid flat, billed", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["sever", "impact", "boom", "station", "notice", "parley", "saved", "cry", "bark", "gazette", "shot", "lasso", "hitmark"]) c.onMessage(t, () => undefined);
    const hits: HitEvent[] = [];
    c.onMessage("hit", (e: HitEvent) => void hits.push(e));
    await sleep(300);
    const inner = room as unknown as Inner;
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const key = "npc:sentry-3";
    const s = room.state.players.get(key)! as PlayerStateType;
    // a horse 14 m south of him, facing him; Ada beside it
    const hid = inner.mounts.spawnHorse({ x: s.x, z: s.z + 14, yaw: 0 }, { coat: 2 });
    const horse = room.state.mounts.get(hid)!;
    const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
    const d = input.data;
    d.yaw = d.aimYaw = yawToWire(0);
    c.send("debug", { cmd: `tp:${horse.x + 1.2}:${horse.z}:0` });
    for (let i = 0; i < 4; i++) {
      input.send();
      await sleep(40);
    }
    d.buttons = BUTTON.INTERACT;
    input.send();
    await until(() => (me.flags & MOUNT_FLAG.MOUNTED) !== 0, 3000, "Ada in the saddle");
    d.buttons = 0;
    input.send();
    await sleep(80);
    const x0 = s.x;
    const z0 = s.z;
    // the charge: full stick and the spur, steering at him as he stands
    const end = Date.now() + 6000;
    while (!hits.some((h) => h.id === key && h.trample === true) && Date.now() < end) {
      d.moveF = 127;
      d.buttons = BUTTON.SPRINT;
      d.yaw = d.aimYaw = yawToWire(Math.atan2(-(s.x - me.x), -(s.z - me.z)));
      input.send();
      await sleep(40);
    }
    d.moveF = 0;
    d.buttons = 0;
    input.send();
    const hit = hits.find((h) => h.id === key && h.trample === true);
    expect(hit, "the sentry ridden down").toBeDefined();
    expect(hit!.boot).toBe(true); // (laid flat on every client)
    expect(inner.combat.stats.tramples).toBe(1);
    expect(inner.mounts.stats.tramples).toBe(1);
    expect(inner.mayhem.bill.trampled).toBe(1);
    if ((s.flags & FLAG.DOWNED) === 0) {
      expect(reactKind(s.react)).toBe(REACT.FLOORED);
      expect(inner.flung.stats.watched).toBeGreaterThanOrEqual(1);
    }
    await until(() => Math.hypot(s.x - x0, s.z - z0) > 2.5, 3000, "him thrown");
    expect(s.z).toBeLessThan(z0); // (ahead of the horse: north)
  }, 30_000);
});
