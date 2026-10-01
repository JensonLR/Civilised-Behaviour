import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, CASUALTY, FLAG, MoveInput, ROOM_WORLD, spawnPoint, MAX_PLAYERS } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "./WorldRoom.ts";

const PORT = 2575; // one port per integration test file
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Input = { data: { buttons: number; moveF: number; moveR: number; yaw: number }; send(): void };

describe("casualties: down, revive, drag, rout (server authority)", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", ROUT_SECONDS: "1.5" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());
  afterEach(async () => colyseus.cleanup());

  async function setup(n = 2) {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 77 })) as unknown as WorldRoom;
    const ps = [];
    for (let i = 0; i < n; i++) {
      const c = await colyseus.connectTo(room as never, { name: `P${i}` });
      const input = c.input({ type: MoveInput, mode: "reliable" }) as unknown as Input;
      ps.push({ c, input, id: c.sessionId, p: room.state.players.get(c.sessionId)! });
    }
    await sleep(150);
    return { room, ps };
  }
  type P = Awaited<ReturnType<typeof setup>>["ps"][number];

  /** Streams frames at the real 30 Hz cadence for `ms`, optionally several per step (a flooding client). */
  const stream = async (who: P, buttons: number, ms: number, opts: { perStep?: number; moveF?: number; moveR?: number } = {}) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (let k = 0; k < (opts.perStep ?? 1); k++) {
        who.input.data.buttons = buttons;
        who.input.data.moveF = Math.round((opts.moveF ?? 0) * 127);
        who.input.data.moveR = Math.round((opts.moveR ?? 0) * 127);
        who.input.send();
      }
      await sleep(33);
    }
    who.input.data.buttons = 0;
    who.input.data.moveF = 0;
    who.input.data.moveR = 0;
    who.input.send();
  };

  /** Puts `b` 1 m south of `a` (so `b` faces north/-Z toward `a`), at rest. */
  const placeNear = (a: P, b: P) => {
    b.p.x = a.p.x;
    b.p.z = a.p.z + 1.0;
    b.p.y = a.p.y;
    b.p.facing = 0;
    b.p.vx = b.p.vz = 0;
  };

  describe("health and downing", () => {
    it("damage reduces health; zero puts the player down (not dead) and the downed take no further damage", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [P];
      expect(a.p.health).toBe(CASUALTY.maxHealth);
      room.damagePlayer(a.id, 30);
      expect(a.p.health).toBe(70);
      expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
      room.damagePlayer(a.id, 999);
      expect(a.p.health).toBe(0);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
      room.damagePlayer(a.id, 50); // already down
      expect(a.p.health).toBe(0);
      room.damagePlayer(a.id, -20); // negative/NaN never heals through the damage path
      room.damagePlayer(a.id, NaN);
      expect(a.p.health).toBe(0);
    });

    it("going down drops a carried prop", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [P];
      const [id, prop] = [...room.state.props.entries()][0]!;
      a.p.x = prop.x;
      a.p.z = prop.z + 1.2;
      a.p.y = prop.y - 0.3;
      a.p.facing = 0;
      await sleep(100);
      a.input.data.buttons = BUTTON.INTERACT;
      a.input.send();
      await sleep(120);
      a.input.data.buttons = 0;
      a.input.send();
      await sleep(120);
      expect(prop.holder).toBe(a.id);
      room.damagePlayer(a.id, 1000);
      await sleep(100);
      expect(prop.holder).toBeFalsy();
      expect(a.p.flags & FLAG.CARRYING).toBeFalsy();
      expect(id).toBeDefined();
    });

    it("a downed player cannot pick things up", async () => {
      const { room, ps } = await setup(1);
      const [a] = ps as [P];
      const [, prop] = [...room.state.props.entries()][0]!;
      a.p.x = prop.x;
      a.p.z = prop.z + 1.2;
      a.p.y = prop.y - 0.3;
      a.p.facing = 0;
      room.damagePlayer(a.id, 1000);
      await sleep(100);
      await stream(a, BUTTON.INTERACT, 300);
      expect(prop.holder).toBeFalsy();
    });
  });

  describe("revive", () => {
    it("holding interact beside a downed teammate revives them with partial health", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      await sleep(100);
      await stream(b, BUTTON.INTERACT, 400);
      // (mid-way the reviver is flagged and progress is visible)
      const streaming = stream(b, BUTTON.INTERACT, 2800);
      await sleep(1200);
      expect(b.p.flags & FLAG.REVIVING).toBeTruthy();
      expect(a.p.reviver).toBe(b.id);
      expect(a.p.reviveProgress).toBeGreaterThan(10);
      expect(a.p.reviveProgress).toBeLessThan(90);
      await streaming;
      await sleep(150);
      expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
      expect(a.p.health).toBe(CASUALTY.reviveHealth);
      expect(a.p.reviveProgress).toBe(0);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy();
    });

    it("releasing early cancels and resets progress", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      await sleep(100);
      await stream(b, BUTTON.INTERACT, 1100);
      await sleep(400);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
      expect(a.p.reviveProgress).toBe(0);
      expect(a.p.reviver).toBeFalsy();
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy();
    });

    it("cannot start from out of reach, and walking away mid-revive cancels", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000);
      // 4 m off, on a side with no prop within 3 m (D-038: props come in clusters, and INTERACT beside one would pick it up, and the next press would drop it instead of reviving)
      const props: { x: number; z: number }[] = [];
      room.state.props.forEach((p) => props.push({ x: p.x, z: p.z }));
      const side = [[0, 4], [0, -4], [4, 0], [-4, 0]].find(([dx, dz]) => props.every((p) => Math.hypot(p.x - (a.p.x + dx!), p.z - (a.p.z + dz!)) > 3)) ?? [0, 4];
      b.p.x = a.p.x + side[0]!;
      b.p.z = a.p.z + side[1]!;
      b.p.facing = 0;
      await sleep(100);
      await stream(b, BUTTON.INTERACT, 400);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy();
      expect(a.p.reviver).toBeFalsy();

      placeNear(a, b);
      await sleep(100);
      const s = stream(b, BUTTON.INTERACT, 1500);
      await sleep(500);
      expect(b.p.flags & FLAG.REVIVING).toBeTruthy();
      b.p.z += 3; // yanked out of reach (e.g. knocked back)
      await s;
      await sleep(200);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
      expect(a.p.reviveProgress).toBe(0);
    });

    it("cannot revive a healthy player, and the downed cannot revive each other or themselves", async () => {
      const { room, ps } = await setup(3);
      const [a, b, c] = ps as [P, P, P];
      placeNear(a, b);
      await sleep(100);
      await stream(b, BUTTON.INTERACT, 400);
      expect(b.p.flags & FLAG.REVIVING).toBeFalsy(); // a is healthy

      room.damagePlayer(a.id, 1000);
      room.damagePlayer(b.id, 1000);
      placeNear(a, b);
      c.p.x = 30; // far away, irrelevant
      await sleep(100);
      await stream(b, BUTTON.INTERACT, 3200);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // two downed players cannot lift each other
      await stream(a, BUTTON.INTERACT, 3200);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // nor self-revive
    });

    it("only one reviver at a time; a second cannot double the speed", async () => {
      const { room, ps } = await setup(3);
      const [a, b, c] = ps as [P, P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      c.p.x = a.p.x + 0.4;
      c.p.z = a.p.z + 1.0;
      c.p.facing = 0;
      await sleep(100);
      const sb = stream(b, BUTTON.INTERACT, 1500);
      await sleep(200);
      const sc = stream(c, BUTTON.INTERACT, 1200);
      await sleep(300);
      expect(a.p.reviver).toBe(b.id);
      expect(c.p.flags & FLAG.REVIVING).toBeFalsy();
      await Promise.all([sb, sc]);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // 1.5 s of one reviver < 2.5 s needed
    });

    it("flooding extra input frames does not speed up a revive (timers run on server ticks)", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      await sleep(100);
      // 3 frames per 33 ms (~90 msgs/s, under the 120/s kick limit) for 1.4 s: real time is well under the 2.5 s needed.
      await stream(b, BUTTON.INTERACT, 1400, { perStep: 3 });
      await sleep(100);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
    });

    it("a reviver whose frames stop arriving stops reviving (stale holds expire)", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      await sleep(100);
      // Press once, then go silent without releasing (tab frozen / hostile client).
      b.input.data.buttons = BUTTON.INTERACT;
      b.input.send();
      await sleep(3200);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy();
    });
  });

  describe("drag", () => {
    it("grab, drag the body behind you while walking, and let go", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      await sleep(100);
      await stream(b, BUTTON.GRAB, 200); // rising edge
      expect(b.p.flags & FLAG.DRAGGING).toBeTruthy();
      expect(a.p.flags & FLAG.DRAGGED).toBeTruthy();
      expect(a.p.dragger).toBe(b.id);

      const start = { x: b.p.x, z: b.p.z };
      await stream(b, 0, 2400, { moveF: 1 }); // camera yaw 0: walk north (-Z) dragging the body
      const travelled = Math.hypot(b.p.x - start.x, b.p.z - start.z);
      expect(travelled).toBeGreaterThan(1.5);
      expect(travelled).toBeLessThan(4.4 * 0.55 * 2.4 + 0.6); // slowed by the drag factor
      const gap = Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z);
      expect(gap).toBeGreaterThan(0.6);
      expect(gap).toBeLessThan(CASUALTY.dragDistance + 0.8);
      expect(a.p.z).toBeGreaterThan(b.p.z); // trailing behind (south of) the walker

      await stream(b, BUTTON.GRAB, 200); // second press lets go
      expect(b.p.flags & FLAG.DRAGGING).toBeFalsy();
      expect(a.p.flags & FLAG.DRAGGED).toBeFalsy();
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // still down
      await sleep(400);
      expect(Math.hypot(a.p.vx, a.p.vz)).toBeLessThan(0.2);
    });

    it("only downed teammates can be grabbed", async () => {
      const { ps } = await setup(2);
      const [a, b] = ps as [P, P];
      placeNear(a, b);
      await sleep(100);
      await stream(b, BUTTON.GRAB, 250);
      expect(b.p.flags & FLAG.DRAGGING).toBeFalsy();
      expect(a.p.flags & FLAG.DRAGGED).toBeFalsy();
    });

    it("the bond breaks if the dragger goes down, leaves, or the body is revived", async () => {
      const { room, ps } = await setup(3);
      const [a, b, c] = ps as [P, P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      c.p.x = 40;
      await sleep(100);
      await stream(b, BUTTON.GRAB, 200);
      expect(a.p.flags & FLAG.DRAGGED).toBeTruthy();
      room.damagePlayer(b.id, 1000); // dragger goes down
      await sleep(100);
      expect(a.p.flags & FLAG.DRAGGED).toBeFalsy();
      expect(b.p.flags & FLAG.DRAGGING).toBeFalsy();

      // Leaver: a fresh drag, then the dragger disconnects for good.
      const room2 = (await colyseus.createRoom(ROOM_WORLD, { seed: 5 })) as unknown as WorldRoom;
      const mk = async (name: string) => {
        const cl = await colyseus.connectTo(room2 as never, { name });
        return { c: cl, id: cl.sessionId, p: room2.state.players.get(cl.sessionId)!, input: cl.input({ type: MoveInput, mode: "reliable" }) as unknown as Input } as P;
      };
      const v = await mk("victim");
      const d = await mk("dragger");
      const o = await mk("other");
      o.p.x = 40;
      room2.damagePlayer(v.id, 1000);
      placeNear(v, d);
      await sleep(100);
      await stream(d, BUTTON.GRAB, 200);
      expect(v.p.flags & FLAG.DRAGGED).toBeTruthy();
      await d.c.leave(true);
      await sleep(300);
      expect(v.p.flags & FLAG.DRAGGED).toBeFalsy();
      expect(v.p.dragger).toBeFalsy();
    });

    // Two independent guards (start check + per-tick validity) both refuse a dragged body, so removing only one is not observable.
    it("cannot revive a body that is being dragged; reviving after release works", async () => {
      const { room, ps } = await setup(3);
      const [a, b, c] = ps as [P, P, P];
      room.damagePlayer(a.id, 1000);
      placeNear(a, b);
      c.p.x = a.p.x + 0.3;
      c.p.z = a.p.z + 1.0;
      c.p.facing = 0;
      await sleep(100);
      await stream(b, BUTTON.GRAB, 200);
      await stream(c, BUTTON.INTERACT, 400);
      expect(c.p.flags & FLAG.REVIVING).toBeFalsy(); // being dragged
      await stream(b, BUTTON.GRAB, 200); // let go
      await sleep(100);
      c.p.x = a.p.x;
      c.p.z = a.p.z + 1.0;
      c.p.facing = 0;
      await sleep(100);
      await stream(c, BUTTON.INTERACT, 3000);
      await sleep(100);
      expect(a.p.flags & FLAG.DOWNED).toBeFalsy();
    });
  });

  describe("rout (whole party down)", () => {
    it("hauls everyone back up together after the delay, at spawn, with partial health, and announces it", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      const notices: string[] = [];
      a.c.onMessage("notice", (m: { text: string }) => notices.push(m.text));
      a.p.x = 20;
      b.p.x = -20;
      room.damagePlayer(a.id, 1000);
      room.damagePlayer(b.id, 1000);
      await sleep(900);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // not yet (routSeconds = 1.5)
      await sleep(1200);
      for (const who of [a, b]) {
        expect(who.p.flags & FLAG.DOWNED).toBeFalsy();
        expect(who.p.health).toBe(CASUALTY.routHealth);
        const sp = spawnPoint(who.p.slot, MAX_PLAYERS);
        expect(Math.hypot(who.p.x - sp.x, who.p.z - sp.z)).toBeLessThan(1);
      }
      expect(notices.join(" ")).toMatch(/routed|repositioning/i);
    });

    it("does not fire while someone is still standing, and the timer resets if a player gets up", async () => {
      const { room, ps } = await setup(2);
      const [a, b] = ps as [P, P];
      room.damagePlayer(a.id, 1000); // only one down
      await sleep(2200);
      expect(a.p.flags & FLAG.DOWNED).toBeTruthy(); // the healthy b prevents a rout
      expect(b.p.health).toBe(CASUALTY.maxHealth);
    });
  });
});
