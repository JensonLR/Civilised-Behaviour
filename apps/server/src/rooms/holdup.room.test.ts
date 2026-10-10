import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, HOLDUP, MoveInput, ROOM_WORLD, WEAPON, ZONE, weaponToWire, yawToWire, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Mayhem } from "../systems/Mayhem.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-113 through a real room: Ada aims her pistol at a sentry whose nerve is going. He drops his rifle (every client is told), puts his hands up and stays put, counted
 * out of the fight; the Society bills it. Shot with his hands up, the paper says so. Port 2654.
 */
const PORT = 2654;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number; aimYaw: number; aimElev: number; weapon: number }; send(): void };
type Inner = {
  cast: { byKey: Map<string, { brain: { morale: { v: number } } }>; count(group: string): { routed: number }; hasYielded(key: string): boolean };
  mayhem: Mayhem;
};

describe("the hold-up in a real room (D-113)", () => {
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

  it("a sentry whose nerve is going, held at gunpoint, drops his rifle and puts his hands up; shot like that, the paper says so", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    for (const t of ["sever", "impact", "boom", "station", "notice", "parley", "saved", "cry", "gazette", "shot", "lasso", "hit", "hitmark"]) c.onMessage(t, () => undefined);
    const yields: string[] = [];
    const barks: { id: string; k: string }[] = [];
    c.onMessage("yield", (e: { id: string }) => void yields.push(e.id));
    c.onMessage("bark", (b: { id: string; k: string }) => void barks.push(b));
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
    d.weapon = weaponToWire(WEAPON.PISTOL);
    d.yaw = d.aimYaw = yawToWire(0);
    await send(25);
    await until(() => me.weapon === weaponToWire(WEAPON.PISTOL), 3000, "the pistol drawn");
    const held = s.weapon;
    // 8 m south of him, facing him; his nerve going (wavering)
    c.send("debug", { cmd: `tp:${s.x}:${s.z + 8}:0` });
    await send();
    inner.cast.byKey.get(key)!.brain.morale.v = 35;
    expect(s.roped ?? 0).toBe(0);
    // she raises the pistol at him and keeps it there
    d.buttons = BUTTON.AIM;
    const end = Date.now() + 6000;
    while (s.roped !== HOLDUP.held && Date.now() < end) {
      d.yaw = d.aimYaw = yawToWire(Math.atan2(-(s.x - me.x), -(s.z - me.z)));
      input.send();
      await sleep(40);
    }
    d.buttons = 0;
    await send(1);
    expect(s.roped).toBe(HOLDUP.held);
    expect(held).not.toBe(weaponToWire(WEAPON.FISTS));
    expect(s.weapon).toBe(weaponToWire(WEAPON.FISTS));
    await until(() => yields.includes(key), 2000, "every client told");
    expect(barks.some((b) => b.id === key && b.k === "yield")).toBe(true);
    expect(inner.cast.hasYielded(key)).toBe(true);
    expect(inner.cast.count("ward").routed).toBeGreaterThanOrEqual(1);
    expect(inner.mayhem.bill.holdups).toBe(1);
    // he stays where he gave in
    const x0 = s.x;
    const z0 = s.z;
    await sleep(1500);
    expect(Math.hypot(s.x - x0, s.z - z0)).toBeLessThan(0.3);
    expect(s.roped).toBe(HOLDUP.held);
    // she shoots him anyway
    room.damagePlayer(key, 10, { zone: ZONE.LEG_L, by: c.sessionId });
    expect(inner.mayhem.bill.unsporting).toBe(1);
  }, 30_000);
});
