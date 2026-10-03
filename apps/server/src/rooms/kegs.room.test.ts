import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, KEG_FUSE, MoveInput, PropKind, ROOM_WORLD, yawToWire, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/** D-054: a lit powder keg through a real room. Port 2614 (one per integration test file). */
const PORT = 2614;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number }; send(): void };

describe("lit powder kegs (D-054)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup() {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 77, region: "kessar" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Sapper" });
    for (const t of ["hit", "sever", "shot", "impact", "boom", "hitmark", "notice", "parley", "station", "saved"]) c.onMessage(t, () => undefined);
    const me = { id: c.sessionId, p: room.state.players.get(c.sessionId)!, input: c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input };
    await sleep(200);
    // inland, away from the landing's dock (USE there opens the chart), with a keg a step ahead (facing 0 looks towards -z)
    const w = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world;
    me.p.x = 20;
    me.p.z = 60;
    me.p.y = w.terrainHeight(20, 60);
    me.p.vx = me.p.vz = 0;
    me.p.facing = 0;
    await sleep(150);
    const keg = (room as unknown as { spawnPropAt(kind: number, x: number, z: number): string | undefined }).spawnPropAt(PropKind.BARREL, me.p.x, me.p.z - 1.2)!;
    return { room, me, keg };
  }
  const until = async (cond: () => boolean, ms: number, what: string) => {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  };
  const tap = async (me: { input: Input }, buttons: number) => {
    const d = me.input.data;
    d.moveF = d.moveR = 0;
    d.yaw = yawToWire(0);
    d.buttons = buttons;
    me.input.send();
    await sleep(120);
    d.buttons = 0;
    me.input.send();
    await sleep(120);
  };
  const pickUp = async (room: WorldRoom, me: { p: PlayerStateType; input: Input }, keg: string) => {
    me.p.facing = 0;
    await tap(me, BUTTON.INTERACT);
    await until(() => room.state.props.get(keg)?.holder === (me as unknown as { id: string }).id, 3000, "the keg in my arms");
  };

  it("RELOAD with a keg in your arms lights it; dawdle, and it goes off in your arms", async () => {
    const { room, me, keg } = await setup();
    await pickUp(room, me, keg);
    expect(room.state.props.get(keg)!.fuse).toBe(0);
    await tap(me, BUTTON.RELOAD);
    await until(() => (room.state.props.get(keg)?.fuse ?? 0) > 0, 2000, "the fuse lit");
    expect(room.state.props.get(keg)!.fuse).toBeLessThanOrEqual(KEG_FUSE.seconds * 10);
    const hp = me.p.health;
    await until(() => !room.state.props.has(keg), (KEG_FUSE.seconds + 3) * 1000, "the keg gone off");
    expect((me.p.flags & FLAG.CARRYING) === 0, "arms empty").toBe(true);
    // (the blast's hits are gathered and landed on the next combat tick)
    await until(() => me.p.health < hp || (me.p.flags & FLAG.DOWNED) !== 0, 2000, "the sapper to feel it");
  }, 30_000);

  it("thrown, it goes off where it lands, out of reach of the thrower; an unlit keg never goes off by itself", async () => {
    const { room, me, keg } = await setup();
    await pickUp(room, me, keg);
    await tap(me, BUTTON.RELOAD);
    await until(() => (room.state.props.get(keg)?.fuse ?? 0) > 0, 2000, "the fuse lit");
    await tap(me, BUTTON.THROW);
    expect(room.state.props.get(keg)?.holder).toBe("");
    // walk the other way while it burns
    const d = me.input.data;
    d.yaw = yawToWire(Math.PI);
    d.moveF = 1;
    d.buttons = 0;
    const walk = setInterval(() => me.input.send(), 50);
    const hp = me.p.health;
    try {
      await until(() => !room.state.props.has(keg), (KEG_FUSE.seconds + 3) * 1000, "the keg gone off");
    } finally {
      clearInterval(walk);
    }
    await sleep(400); // (the blast's hits land a tick later: give them the chance)
    expect(me.p.health).toBe(hp);
    // an unlit keg stays put for longer than any fuse
    const quiet = (room as unknown as { spawnPropAt(kind: number, x: number, z: number): string | undefined }).spawnPropAt(PropKind.BARREL, me.p.x + 6, me.p.z)!;
    await sleep((KEG_FUSE.seconds + 1) * 1000);
    expect(room.state.props.has(quiet)).toBe(true);
    expect(room.state.props.get(quiet)!.fuse).toBe(0);
  }, 40_000);
});
