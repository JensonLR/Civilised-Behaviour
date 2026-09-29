import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, LIMB, MoveInput, ROOM_WORLD, ZONE, woundLevel, type SeverEvent } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2578; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("dismemberment (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", ROUT_SECONDS: "30" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(opts: { seed?: number; dismemberment?: boolean; n?: number } = {}) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: opts.seed ?? 5, ...(opts.dismemberment === undefined ? {} : { dismemberment: opts.dismemberment }) })) as unknown as WorldRoom;
    const ps = [];
    for (let i = 0; i < (opts.n ?? 1); i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const severs: SeverEvent[] = [];
      c.onMessage("sever", (e: SeverEvent) => severs.push(e));
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as { data: { buttons: number }; send(): void };
      ps.push({ c, severs, input, id: c.sessionId, p: room.state.players.get(c.sessionId)! });
    }
    await sleep(120);
    return { room, ps };
  }
  type P = Awaited<ReturnType<typeof setup>>["ps"][number];

  it("a crushing blow to a limb takes it off: state bit, grievous stump, and one sever event to everyone", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [P];
    expect(a.p.missing).toBe(0);
    room.damagePlayer(a.id, 95, { zone: ZONE.ARM_R, dirX: 1, dirZ: 0 });
    await sleep(150);
    expect(a.p.missing & LIMB.ARM_R).toBe(LIMB.ARM_R);
    expect(woundLevel(a.p.wounds, ZONE.ARM_R)).toBe(3);
    expect(a.severs).toHaveLength(1);
    expect(a.severs[0]).toMatchObject({ id: a.id, limb: LIMB.ARM_R, dx: 1 });
    expect(a.severs[0]!.power).toBeGreaterThan(0.9);
  });

  it("blows to the head or torso never sever, and light blows to a limb never do either", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [P];
    for (const zone of [ZONE.HEAD, ZONE.TORSO]) room.damagePlayer(a.id, 95, { zone });
    expect(a.p.missing).toBe(0);
    for (let seed = 1; seed <= 8; seed++) {
      const r = await setup({ seed });
      const [v] = r.ps as [P];
      r.room.damagePlayer(v.id, 44, { zone: seed % 2 ? ZONE.LEG_L : ZONE.ARM_R }); // just under the threshold
      expect(v.p.missing).toBe(0);
      await colyseus.cleanup();
    }
  }, 60_000);

  it("a moderate blow only sometimes severs, but a limb that is already cut up goes more easily (seeded, so repeatable)", async () => {
    const trial = async (seed: number) => {
      const { room, ps } = await setup({ seed });
      const [a] = ps as [P];
      a.p.wounds |= 3 << (ZONE.LEG_L * 2); // grievous already
      room.damagePlayer(a.id, 70, { zone: ZONE.LEG_L });
      const lost = (a.p.missing & LIMB.LEG_L) !== 0;
      await colyseus.cleanup();
      return lost;
    };
    // same seed, same outcome
    expect(await trial(21)).toBe(await trial(21));
    // a grievous leg at 70 damage: chance = 0.39 + 0.36 = 0.75; across many seeds most (not all) lose it
    let lost = 0;
    for (let seed = 1; seed <= 24; seed++) if (await trial(seed)) lost++;
    expect(lost).toBeGreaterThan(10);
    expect(lost).toBeLessThan(24);
  }, 60_000);

  it("campaigns can switch dismemberment off: nothing is ever severed, even by a huge blow", async () => {
    const { room, ps } = await setup({ dismemberment: false });
    const [a] = ps as [P];
    expect(room.state.dismemberment).toBe(false);
    room.damagePlayer(a.id, 500, { zone: ZONE.LEG_R });
    expect(a.p.missing).toBe(0);
    expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // the blow still puts them down
    await sleep(100);
    expect(a.severs).toHaveLength(0);
  });

  it("is on by default, and the flag is replicated to every client", async () => {
    const { room, ps } = await setup({ n: 2 });
    expect(room.state.dismemberment).toBe(true);
    const [, b] = ps as [P, P];
    expect((b.c.state as unknown as { dismemberment: boolean }).dismemberment).toBe(true);
  });

  it("a lost limb is lost once: repeat blows don't re-sever, and unaimed hits don't pick on a stump", async () => {
    const { room, ps } = await setup({ seed: 9 });
    const [a] = ps as [P];
    room.damagePlayer(a.id, 95, { zone: ZONE.LEG_L });
    expect(a.p.missing).toBe(LIMB.LEG_L);
    room.damagePlayer(a.id, 95, { zone: ZONE.LEG_L });
    await sleep(100);
    expect(a.severs).toHaveLength(1);
    const before = woundLevel(a.p.wounds, ZONE.LEG_L);
    for (let i = 0; i < 6 && a.p.health > 0; i++) room.damagePlayer(a.id, 5); // unaimed, no dir
    expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(before);
  });

  it("losses persist through downing and reviving (a revive patches wounds, it does not grow a leg back)", async () => {
    const { room, ps } = await setup({ n: 2 });
    const [a, b] = ps as [P, P];
    room.damagePlayer(a.id, 95, { zone: ZONE.ARM_L });
    room.damagePlayer(a.id, 1000, { zone: ZONE.TORSO });
    expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
    b.p.x = a.p.x;
    b.p.z = a.p.z + 1;
    b.p.y = a.p.y;
    b.p.facing = 0;
    const end = Date.now() + 3500;
    while (Date.now() < end && a.p.flags & FLAG.DOWNED) {
      b.input.data.buttons = BUTTON.INTERACT;
      b.input.send();
      await sleep(33);
    }
    expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
    expect(a.p.missing).toBe(LIMB.ARM_L);
  }, 30_000);

  it("scripted losses validate their input: garbage limb ids are ignored", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [P];
    const c = (room as unknown as { casualties: { sever(id: string, limb: number): boolean; restoreLimbs(id: string): void } }).casualties;
    expect(c.sever(a.id, 3)).toBe(false);
    expect(c.sever(a.id, 0)).toBe(false);
    expect(c.sever(a.id, NaN)).toBe(false);
    expect(c.sever("nobody", LIMB.LEG_L)).toBe(false);
    expect(a.p.missing).toBe(0);
    expect(c.sever(a.id, LIMB.LEG_L)).toBe(true);
    c.restoreLimbs(a.id);
    expect(a.p.missing).toBe(0);
  });
});
