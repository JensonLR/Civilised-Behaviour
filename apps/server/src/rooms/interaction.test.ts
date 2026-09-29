import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MoveInput, ROOM_WORLD, PROP_DEFS, type PropKindId } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2573; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("prop interaction (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(players = 1) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 2024 })) as unknown as WorldRoom;
    const clients = [];
    for (let i = 0; i < players; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      clients.push({ c, input: c.input({ type: MoveInput, mode: "reliable" }) as unknown as { data: { buttons: number; moveF: number }; send(): void } });
    }
    await sleep(150);
    const props = [...room.state.props.entries()].filter(([, p]) => PROP_DEFS[p.kind as PropKindId].carryable);
    expect(props.length).toBeGreaterThan(5);
    return { room, clients, props };
  }

  /** Test-only teleport: places a player 1.2 m south of the prop, facing it (-Z). */
  const standNear = (room: WorldRoom, sid: string, prop: { x: number; y: number; z: number }) => {
    const p = room.state.players.get(sid)!;
    p.x = prop.x;
    p.z = prop.z + 1.2;
    p.y = prop.y - 0.3;
    p.facing = 0;
    p.vx = 0;
    p.vz = 0;
  };

  const press = async (h: { data: { buttons: number }; send(): void }, buttons: number) => {
    h.data.buttons = buttons;
    h.send();
    await sleep(120);
    h.data.buttons = 0;
    h.send();
    await sleep(120);
  };

  it("picks up a nearby prop, carries it slowly, and drops it", async () => {
    const { room, clients, props } = await setup();
    const [id, prop] = props[0]!;
    const { c, input } = clients[0]!;
    const me = room.state.players.get(c.sessionId)!;
    standNear(room, c.sessionId, prop);
    await sleep(100);
    await press(input, BUTTON.INTERACT);
    expect(prop.holder).toBe(c.sessionId);
    expect(me.flags & FLAG.CARRYING).toBeTruthy();

    // The held prop rides in front of the player at chest height.
    await sleep(200);
    expect(Math.hypot(prop.x - me.x, prop.z - me.z)).toBeLessThan(1.3);
    expect(prop.y - me.y).toBeGreaterThan(0.6);

    // Carrying caps speed below run speed (4.4 m/s * 0.72).
    input.data.moveF = 127;
    input.data.buttons = BUTTON.SPRINT;
    for (let i = 0; i < 30; i++) {
      input.send();
      await sleep(33);
    }
    expect(Math.hypot(me.vx, me.vz)).toBeLessThan(3.4);
    input.data.moveF = 0;
    input.data.buttons = 0;
    input.send();
    await sleep(300);

    await press(input, BUTTON.INTERACT); // second press drops
    expect(prop.holder).toBe("");
    expect(me.flags & FLAG.CARRYING).toBeFalsy();
    expect(room.state.props.get(id)).toBe(prop);
  });

  it("throws a carried prop away from the player", async () => {
    const { room, clients, props } = await setup();
    const [, prop] = props[0]!;
    const { c, input } = clients[0]!;
    standNear(room, c.sessionId, prop);
    await sleep(100);
    await press(input, BUTTON.INTERACT);
    expect(prop.holder).toBe(c.sessionId);
    const me = room.state.players.get(c.sessionId)!;
    const before = { x: me.x, z: me.z };
    await press(input, BUTTON.THROW);
    await sleep(700);
    expect(prop.holder).toBe("");
    // Facing -Z at throw time, so the prop lands well north (smaller z) of the thrower.
    expect(before.z - prop.z).toBeGreaterThan(2.5);
  });

  it("ignores pickup attempts that are out of reach", async () => {
    const { room, clients, props } = await setup();
    const [, prop] = props[0]!;
    const { c, input } = clients[0]!;
    const me = room.state.players.get(c.sessionId)!;
    me.x = prop.x;
    me.z = prop.z + 5; // 5 m away
    me.y = prop.y - 0.3;
    me.facing = 0;
    await sleep(100);
    await press(input, BUTTON.INTERACT);
    expect(prop.holder).toBe("");
    expect(me.flags & FLAG.CARRYING).toBeFalsy();
  });

  it("does not let a second player steal a held prop", async () => {
    const { room, clients, props } = await setup(2);
    const [, prop] = props[0]!;
    const [a, b] = clients as [(typeof clients)[0], (typeof clients)[0]];
    standNear(room, a.c.sessionId, prop);
    await sleep(100);
    await press(a.input, BUTTON.INTERACT);
    expect(prop.holder).toBe(a.c.sessionId);
    // B stands right next to A's held prop and tries to take it.
    standNear(room, b.c.sessionId, prop);
    await sleep(100);
    await press(b.input, BUTTON.INTERACT);
    expect(prop.holder).toBe(a.c.sessionId);
    // B may legitimately grab a different free prop lying in reach, but never A's held one.
    const heldByB = [...room.state.props.values()].filter((p) => p.holder === b.c.sessionId);
    expect(heldByB).not.toContain(prop);
  });

  it("drops the load when the carrier leaves", async () => {
    const { room, clients, props } = await setup(2);
    const [, prop] = props[0]!;
    const [a] = clients;
    standNear(room, a!.c.sessionId, prop);
    await sleep(100);
    await press(a!.input, BUTTON.INTERACT);
    expect(prop.holder).toBe(a!.c.sessionId);
    await a!.c.leave(true);
    await sleep(300);
    expect(prop.holder).toBe("");
  });

  it("holding the button does not re-trigger (rising edge only)", async () => {
    const { room, clients, props } = await setup();
    const [, prop] = props[0]!;
    const { c, input } = clients[0]!;
    standNear(room, c.sessionId, prop);
    await sleep(100);
    input.data.buttons = BUTTON.INTERACT; // held down across many frames
    for (let i = 0; i < 20; i++) {
      input.send();
      await sleep(33);
    }
    expect(prop.holder).toBe(c.sessionId); // picked up once, never dropped by the held button
    input.data.buttons = 0;
    input.send();
  });
});
