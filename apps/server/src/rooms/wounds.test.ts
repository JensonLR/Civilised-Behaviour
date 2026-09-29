import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, MoveInput, ROOM_WORLD, WOUNDS, ZONE, woundLevel, type HitEvent } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2577; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("wounds: zones, severity, hit events (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", ROUT_SECONDS: "1.5" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(seed = 5, n = 1) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed })) as unknown as WorldRoom;
    const ps = [];
    for (let i = 0; i < n; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const hits: HitEvent[] = [];
      c.onMessage("hit", (e: HitEvent) => hits.push(e));
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as { data: { buttons: number }; send(): void };
      ps.push({ c, input, hits, id: c.sessionId, p: room.state.players.get(c.sessionId)! });
    }
    await sleep(120);
    return { room, ps };
  }

  it("an aimed hit marks exactly that zone, scaled by damage; a light knock leaves no wound", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [(typeof ps)[number]];
    expect(a.p.wounds).toBe(0);
    room.damagePlayer(a.id, WOUNDS.minDamage - 1, { zone: ZONE.HEAD });
    expect(a.p.wounds).toBe(0);
    room.damagePlayer(a.id, 10, { zone: ZONE.ARM_L });
    expect(woundLevel(a.p.wounds, ZONE.ARM_L)).toBe(1);
    room.damagePlayer(a.id, 25, { zone: ZONE.LEG_R });
    expect(woundLevel(a.p.wounds, ZONE.LEG_R)).toBe(2);
    expect(woundLevel(a.p.wounds, ZONE.ARM_L)).toBe(1); // untouched
    expect(woundLevel(a.p.wounds, ZONE.HEAD)).toBe(0);
  });

  it("repeated hits on one zone escalate it", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [(typeof ps)[number]];
    room.damagePlayer(a.id, 10, { zone: ZONE.TORSO });
    room.damagePlayer(a.id, 10, { zone: ZONE.TORSO });
    expect(woundLevel(a.p.wounds, ZONE.TORSO)).toBe(2);
  });

  it("clients receive a hit event with a unit direction, power and the down flag", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [(typeof ps)[number]];
    room.damagePlayer(a.id, 30, { zone: ZONE.TORSO, dirX: 3, dirZ: 4 });
    room.damagePlayer(a.id, 999, { zone: ZONE.HEAD, dirX: 0, dirZ: 0 });
    await sleep(150);
    expect(a.hits).toHaveLength(2);
    const [h1, h2] = a.hits as [HitEvent, HitEvent];
    expect(h1).toMatchObject({ id: a.id, zone: ZONE.TORSO, down: false });
    expect(h1.dx).toBeCloseTo(0.6);
    expect(h1.dz).toBeCloseTo(0.8);
    expect(h1.power).toBeCloseTo(0.5);
    expect(h2.down).toBe(true);
    expect(h2.power).toBe(1);
    expect(Math.hypot(h2.dx, h2.dz)).toBeCloseTo(1); // no direction given -> seeded random unit vector, never NaN
  });

  it("bad zones from a caller fall back to a valid random zone instead of corrupting the mask", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [(typeof ps)[number]];
    for (const zone of [99, -1, NaN, 2.5]) room.damagePlayer(a.id, 50, { zone: zone as never });
    expect(a.p.wounds).toBeGreaterThan(0);
    expect(a.p.wounds).toBeLessThan(1 << 12);
  });

  it("unaimed hits pick zones from the campaign seed: same seed, same injuries", async () => {
    const zonesFor = async (seed: number) => {
      const { room, ps } = await setup(seed);
      const [a] = ps as [(typeof ps)[number]];
      for (let i = 0; i < 6; i++) room.damagePlayer(a.id, 9);
      await sleep(100);
      return a.hits.map((h) => h.zone);
    };
    const one = await zonesFor(11);
    await colyseus.cleanup();
    const two = await zonesFor(11);
    expect(one).toHaveLength(6);
    expect(two).toEqual(one);
  });

  it("a downed player takes no further wounds or hit events", async () => {
    const { room, ps } = await setup();
    const [a] = ps as [(typeof ps)[number]];
    room.damagePlayer(a.id, 1000, { zone: ZONE.TORSO });
    const before = a.p.wounds;
    room.damagePlayer(a.id, 50, { zone: ZONE.HEAD });
    await sleep(100);
    expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
    expect(a.p.wounds).toBe(before);
    expect(a.hits).toHaveLength(1);
  });

  it("being revived patches wounds down to a field dressing but does not cure them", async () => {
    const { room, ps } = await setup(5, 2);
    const [a, b] = ps as [(typeof ps)[number], (typeof ps)[number]];
    room.damagePlayer(a.id, 50, { zone: ZONE.HEAD }); // grievous (3)
    room.damagePlayer(a.id, 12, { zone: ZONE.LEG_L }); // scratch (1)
    room.damagePlayer(a.id, 1000, { zone: ZONE.TORSO });
    expect(woundLevel(a.p.wounds, ZONE.HEAD)).toBe(3);
    // Revive through the real mechanic: b kneels beside a and holds interact.
    b.p.x = a.p.x;
    b.p.z = a.p.z + 1;
    b.p.y = a.p.y;
    b.p.facing = 0;
    const end = Date.now() + 3300;
    while (Date.now() < end && a.p.flags & FLAG.DOWNED) {
      b.input.data.buttons = BUTTON.INTERACT;
      b.input.send();
      await sleep(33);
    }
    expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
    expect(woundLevel(a.p.wounds, ZONE.HEAD)).toBe(WOUNDS.revivedCap);
    expect(woundLevel(a.p.wounds, ZONE.LEG_L)).toBe(1);
    expect(woundLevel(a.p.wounds, ZONE.TORSO)).toBe(WOUNDS.revivedCap); // the fatal blow was grievous too
  });
});
