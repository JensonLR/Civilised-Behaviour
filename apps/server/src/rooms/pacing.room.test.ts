import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { FLAG, PACE, PACING, ROOM_WORLD, type PlayerStateType } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { Cast } from "../systems/Cast.ts";
import type { Incidents } from "../systems/Incidents.ts";
import type { Pacing } from "../systems/Pacing.ts";
import type { WorldRoom } from "./WorldRoom.ts";

/**
 * D-107 through a real room: the pacing director sleeps at the hub and wakes with a contract; a party gone quiet is looked for by the Ward it has roused; a member
 * down eases the fire on everybody; a coasting party meets its incident early. Port 2649.
 */
const PORT = 2649;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Inner = { pacing: Pacing; cast: Cast; incidents: Incidents };

describe("the pacing director in a real room (D-107)", () => {
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
  const quiet = (c: { onMessage(t: string, cb: (m: unknown) => void): void }): void => {
    for (const t of ["sever", "impact", "boom", "station", "parley", "saved", "cry", "bark", "gazette", "hit", "hitmark", "shot", "lasso"]) c.onMessage(t, () => undefined);
  };

  it("asleep at the hub; awake with a contract, and the debug line says so", async () => {
    const hub = (await colyseus.createRoom(ROOM_WORLD, { seed: 9 })) as unknown as WorldRoom;
    const h = await colyseus.connectTo(hub as never, { name: "Ada" });
    quiet(h);
    const hubNotes: string[] = [];
    h.onMessage("notice", (m: { text: string }) => void hubNotes.push(m.text));
    await sleep(300);
    expect((hub as unknown as Inner).pacing.awake).toBe(false);
    h.send("debug", { cmd: "pace" });
    await until(() => hubNotes.some((t) => t.startsWith("Pace:")), 3000, "the pace line at the hub");
    expect(hubNotes.find((t) => t.startsWith("Pace:"))).toContain("asleep");

    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Bram" });
    quiet(c);
    const notes: string[] = [];
    c.onMessage("notice", (m: { text: string }) => void notes.push(m.text));
    const inner = room as unknown as Inner;
    await until(() => inner.pacing.awake, 3000, "the director awake");
    c.send("debug", { cmd: "pace" });
    await until(() => notes.some((t) => t.startsWith("Pace:")), 3000, "the pace line");
    expect(notes.find((t) => t.startsWith("Pace:"))).toMatch(/^Pace: build .* may fire/);
  });

  it("a party gone quiet is looked for: the Ward it roused walk toward her; a garrison never roused stays at its posts", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    quiet(c);
    c.onMessage("notice", () => undefined);
    const inner = room as unknown as Inner;
    await until(() => inner.pacing.awake, 3000, "the director awake");
    const me = room.state.players.get(c.sessionId)! as PlayerStateType;
    const ward: PlayerStateType[] = [];
    room.state.players.forEach((p, id) => {
      if (id.startsWith("npc:sentry-")) ward.push(p as PlayerStateType);
    });
    expect(ward.length).toBeGreaterThan(1);
    const nearest = (): number => Math.min(...ward.map((p) => Math.hypot(p.x - me.x, p.z - me.z)));
    // she stands 45 m back toward the landing from the nearest of them: out of their sight (28 m), inside the hunt's reach (the landing itself is 77 m off: a party that has
    // walked right away is not chased across the map)
    const s0 = ward.reduce((a, p) => (Math.hypot(p.x - me.x, p.z - me.z) < Math.hypot(a.x - me.x, a.z - me.z) ? p : a));
    const back = Math.hypot(me.x - s0.x, me.z - s0.z);
    const tx = s0.x + ((me.x - s0.x) * 45) / back;
    const tz = s0.z + ((me.z - s0.z) * 45) / back;
    c.send("debug", { cmd: `tp:${tx}:${tz}:0` });
    await until(() => Math.hypot(me.x - tx, me.z - tz) < 1, 3000, "her new spot");
    // unprovoked: coasting sends nobody
    c.send("debug", { cmd: "pace:quiet" });
    await sleep(1500);
    expect(inner.pacing.stats.sent).toBe(0);
    // roused (the Ward alerted, as after a skirmish she walked away from), and the party quiet: they come looking
    inner.cast.order("ward", { o: "alert" });
    await sleep(300);
    const before = nearest();
    expect(before).toBeGreaterThan(30); // (out of their sight: a search, not a fight)
    expect(before).toBeLessThan(PACING.huntRange);
    c.send("debug", { cmd: "pace:quiet" });
    await until(() => inner.pacing.stats.sent > 0, 3000, "a hunt");
    await until(() => nearest() < before - 3, 8000, "the Ward closing on her");
    expect(inner.pacing.stats.sent).toBeLessThanOrEqual(PACING.huntMax * inner.pacing.stats.hunts);
  }, 30_000);

  it("a member down sends the run to its peak and then eases the fire on everybody to one man each", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const a = await colyseus.connectTo(room as never, { name: "Ada" });
    const b = await colyseus.connectTo(room as never, { name: "Bram" });
    for (const c of [a, b]) {
      quiet(c);
      c.onMessage("notice", () => undefined);
    }
    const inner = room as unknown as Inner;
    await until(() => inner.pacing.awake, 3000, "the director awake");
    await sleep(300);
    expect(inner.pacing.tokens(b.sessionId)).toBe(PACING.tokens + 1); // (nobody pressed yet)
    a.send("debug", { cmd: "down" });
    const ada = room.state.players.get(a.sessionId)! as PlayerStateType;
    await until(() => (ada.flags & FLAG.DOWNED) !== 0, 3000, "Ada down");
    await until(() => inner.pacing.state.phase === PACE.PEAK, 3000, "the peak");
    await until(() => inner.pacing.state.phase === PACE.FADE, (PACING.sustainS + 4) * 1000, "the fade");
    expect(inner.pacing.tokens(b.sessionId)).toBe(1);
    expect(inner.pacing.calm).toBe(false); // (no incident while it fades)
  }, 30_000);

  it("a coasting party meets its incident early; a party not coasting waits out the dealt delay", async () => {
    const room = (await colyseus.createRoom(ROOM_WORLD, { seed: 9, region: "kessar", scenario: "secure_crossing" })) as unknown as WorldRoom;
    const c = await colyseus.connectTo(room as never, { name: "Ada" });
    quiet(c);
    c.onMessage("notice", () => undefined);
    c.onMessage("incident", () => undefined);
    const inner = room as unknown as Inner;
    await until(() => inner.pacing.awake, 3000, "the director awake");
    // this run's incident is a courier, dealt late; the run is past the coasting minimum and has been calm long enough
    const inc = inner.incidents as unknown as { id: string; delay: number; t: number; calm: number; result: unknown; live: boolean };
    inc.id = "courier";
    inc.result = undefined;
    inc.delay = 1000;
    inc.t = PACING.incidentMinS + 1;
    inc.calm = 60;
    inner.pacing.state.dull = 0;
    await sleep(600);
    expect(inner.incidents.active).toBe("none");
    c.send("debug", { cmd: "pace:quiet" });
    await until(() => inner.incidents.active === "courier", 3000, "the courier");
  }, 30_000);
});
