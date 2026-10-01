import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { KESSAR_ANCHORS as A, ROOM_WORLD, TICK_RATE, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { WorldRoom } from "./WorldRoom.ts";

const PORT = 2597; // one port per integration test file (this file uses 2597-2599)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Everything a hostile client could put in `options.region` / `options.scenario`. */
const HOSTILE: unknown[] = ["kessar", "KESSAR", " kessar", "kessar\0", "../kessar", "__proto__", "constructor", "secure_crossing", "x".repeat(5000), 7, 0, -1, null, undefined, true, {}, [], ["kessar"], { toString: () => "kessar" }];

const forced = (room: WorldRoom): unknown => (room as unknown as { forcedTemplate: unknown }).forcedTemplate;

describe("QA levers are dev-only: `region` and `scenario` in the join options", () => {
  describe("debugCommands: false (production behaviour)", () => {
    let colyseus: ColyseusTestServer;
    beforeAll(async () => {
      configureLogger("error", { silent: true });
      const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "0" } as never));
      await server.listen(PORT);
      colyseus = new ColyseusTestServer(server);
    });
    afterAll(async () => colyseus.shutdown());
    afterEach(async () => colyseus.cleanup());

    it("ignores region and scenario for every value, hostile or well-formed: the campaign is founded at Hollowmere with no forced contract", async () => {
      for (const v of HOSTILE) {
        const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 3, region: v, scenario: v })) as unknown as WorldRoom;
        expect(room.state.region, String(v)).toBe("hollowmere");
        expect(forced(room), String(v)).toBeUndefined();
        expect(room.state.scenario, String(v)).toBe("");
      }
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 3, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
      expect(room.state.region).toBe("hollowmere");
      expect(forced(room)).toBeUndefined();
    });
  });

  describe("debugCommands: true (dev, tests, screenshots)", () => {
    let colyseus: ColyseusTestServer;
    beforeAll(async () => {
      configureLogger("error", { silent: true });
      const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
      await server.listen(PORT + 1);
      colyseus = new ColyseusTestServer(server);
    });
    afterAll(async () => colyseus.shutdown());
    afterEach(async () => colyseus.cleanup());

    it("honours a well-formed region and scenario, and still ignores the hostile values", async () => {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 3, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
      expect(room.state.region).toBe("kessar");
      expect(forced(room)).toBe("secure_crossing");
      for (const v of HOSTILE.filter((x) => x !== "kessar" && x !== "secure_crossing")) {
        const r = (await colyseus.createRoom(ROOM_WORLD, { seed: 3, region: v, scenario: v })) as unknown as WorldRoom;
        expect(r.state.region, String(v)).toBe("hollowmere");
        expect(forced(r), String(v)).toBeUndefined();
      }
    });
  });
});

// ---- the sim clock -------------------------------------------------------------------------------------------------------------------------

interface Tick {
  (ctx: { dt: number; dtMs: number }): void;
}

describe("the NPCs run on the SIM clock: the host stalling does not change what they do", () => {
  let colyseus: ColyseusTestServer;
  let current: Tick | undefined;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    // the rooms' own timers must not run: the test drives the fixed step by hand, with its own stalls
    vi.spyOn(WorldRoom.prototype as unknown as { setFixedTimestep(fn: Tick): void }, "setFixedTimestep").mockImplementation((fn: Tick) => {
      current = fn;
    });
    const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1" } as never));
    await server.listen(PORT + 2);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await colyseus.shutdown();
  });
  afterEach(async () => colyseus.cleanup());

  const fnv = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  };
  const q = (n: number): number => Math.round(n * 1e4) / 1e4;
  /** Every NPC row, in key order, by value (never by session id, which differs per room). */
  const npcHash = (room: WorldRoom): { hash: number; n: number; json: string } => {
    const rows: string[] = [];
    room.state.players.forEach((p: PlayerStateType, id: string) => {
      if (p.npc) rows.push(`${id}|${q(p.x)}|${q(p.y)}|${q(p.z)}|${q(p.facing)}|${p.health}|${p.flags}|${p.weapon}|${p.ammo}|${p.cmd}|${p.morale}`);
    });
    rows.sort();
    const json = rows.join("\n");
    return { hash: fnv(json), n: rows.length, json };
  };

  /** One Kessar room, one standing player at the gate, 600 hand-driven ticks. `stall` runs between ticks (wall-clock time passes, sim time does not). */
  async function run(stall: (i: number) => Promise<void> | void): Promise<{ hash: number; n: number; json: string }> {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 77, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const tick = current!;
    await colyseus.connectTo(room as never, { name: "Watcher" });
    await sleep(50);
    const me = [...room.state.players.values()].find((p) => !p.npc)!;
    // 8 m from the ford patrol, in plain view; a report then puts the garrison on alert
    me.x = A.sentries[4]!.x - 3;
    me.z = A.sentries[4]!.z + 8;
    me.y = (room as unknown as { world: { terrainHeight(x: number, z: number): number } }).world.terrainHeight(me.x, me.z);
    const cast = (room as unknown as { cast: { noise(x: number, z: number, r: number, src: string): void; order(g: string, o: { o: string }): void } }).cast;
    cast.order("ward", { o: "alert" });
    cast.noise(me.x, me.z, 80, "reporter");
    for (let i = 0; i < 600; i++) {
      await stall(i);
      tick({ dt: 1 / TICK_RATE, dtMs: 1000 / TICK_RATE });
    }
    return npcHash(room);
  }

  it("same seed, same scripted state, different wall-clock stalls: identical NPC state after 600 ticks", async () => {
    const a = await run(() => undefined);
    // B: the wall clock lurches (performance.now jumps by seconds every 37 ticks) and the event loop really stalls now and then
    const real = performance.now.bind(performance);
    let skew = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => real() + skew);
    let b: { hash: number; n: number; json: string };
    try {
      b = await run(async (i) => {
        if (i % 37 === 0) skew += 2500 + (i % 5) * 700;
        if (i % 150 === 149) await sleep(40);
      });
    } finally {
      spy.mockRestore();
    }
    expect(a.n).toBeGreaterThan(3); // there is a garrison to compare
    expect(b.json).toBe(a.json);
    expect(b.hash).toBe(a.hash);
  }, 60_000);
});
