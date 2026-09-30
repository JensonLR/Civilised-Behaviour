import { describe, expect, it } from "vitest";
import type { RegionId, TravelState } from "@cb/shared";
import { Travel, type TravelHost } from "./Travel.ts";

function fake(slots = 0b11): { host: TravelHost; log: string[]; synced: TravelState[]; room: { slots: number; region: RegionId } } {
  const log: string[] = [];
  const synced: TravelState[] = [];
  const room = { slots, region: "hollowmere" as RegionId };
  const host: TravelHost = {
    connectedSlots: () => room.slots,
    current: () => room.region,
    enterRegion: (to) => {
      log.push(`enter ${to}`);
      room.region = to;
    },
    notice: (t) => log.push(`notice ${t}`),
    sync: (s) => synced.push(s),
  };
  return { host, log, synced, room };
}

describe("Travel (server)", () => {
  it("solo: propose, sail, enter the region once, arrive, idle", () => {
    const f = fake(0b1);
    const t = new Travel(f.host);
    t.propose("s0", 0, "kessar");
    expect(t.state.phase).toBe(2);
    expect(t.busy).toBe(true);
    for (let i = 0; i < 70; i++) t.tick(0.1);
    expect(f.log.filter((l) => l.startsWith("enter"))).toEqual(["enter kessar"]);
    expect(t.state.phase).toBe(3);
    t.regionReady(0);
    expect(t.state.phase).toBe(0);
    expect(t.busy).toBe(false);
    expect(f.log.at(-1)).toMatch(/Landfall: Kessar Reach/);
  });

  it("two players: waits for the vote; sync is published on every visible change and not otherwise", () => {
    const f = fake();
    const t = new Travel(f.host);
    t.propose("s0", 0, "kessar");
    expect(t.state.phase).toBe(1);
    const n = f.synced.length;
    t.tick(0.001);
    expect(f.synced.length).toBe(n); // (same second: nothing new to say)
    t.ready(1, true);
    expect(t.state.phase).toBe(2);
    expect(f.synced.at(-1)).toMatchObject({ phase: 2, to: "kessar" });
    t.tick(6.5);
    t.regionReady(1, "kessar");
    expect(t.state.phase).toBe(3);
    t.regionReady(0, "kessar");
    expect(t.state.phase).toBe(0);
  });

  it("a slow client cannot hold the room past the arrival timeout; a leaver releases it at once", () => {
    const f = fake();
    const t = new Travel(f.host);
    t.propose("s0", 0, "kessar");
    t.ready(1, true);
    t.tick(6.5);
    t.regionReady(0);
    t.tick(10);
    expect(t.state.phase).toBe(3);
    f.room.slots = 0b1; // slot 1 leaves mid-build
    t.onLeave(1);
    expect(t.state.phase).toBe(0);

    const g = fake();
    const u = new Travel(g.host);
    u.propose("s0", 0, "kessar");
    u.ready(1, true);
    u.tick(6.5);
    u.tick(31);
    expect(u.state.phase).toBe(0);
  });

  it("a leaver while proposed completes the vote; cancel and timeout call it off", () => {
    const f = fake();
    const t = new Travel(f.host);
    t.propose("s0", 0, "kessar");
    f.room.slots = 0b1;
    t.onLeave(1);
    expect(t.state.phase).toBe(2);

    const g = fake();
    const u = new Travel(g.host);
    u.propose("s0", 0, "kessar");
    u.cancel();
    expect(u.state.phase).toBe(0);
    expect(g.log.some((l) => /called off/.test(l))).toBe(true);
    u.propose("s0", 0, "kessar");
    u.tick(25);
    expect(u.state.phase).toBe(0);
  });

  it("hostile input changes nothing", () => {
    const f = fake();
    const t = new Travel(f.host);
    const bad: unknown[] = [undefined, null, 99, -3, 1.5, NaN, "", "atlantis", "hollowmere", {}, [], "__proto__", "constructor", { to: "kessar" }];
    for (const b of bad) {
      t.propose("s0", 0, b);
      t.propose("s0", b as number, "kessar");
      t.ready(b as number, b);
      t.regionReady(b as number, b);
      t.tick(b as number);
    }
    t.cancel();
    t.regionReady(0, "kessar");
    t.ready(1, true);
    expect(t.state.phase).toBe(0);
    expect(f.log.length).toBe(0);
    t.propose("s0", 0, "kessar");
    t.regionReady(0, "kessar"); // not arriving yet
    t.propose("s1", 1, "hollowmere"); // a second proposal while one is open
    expect(t.state).toMatchObject({ phase: 1, to: "kessar" });
  });

  it("sailing home works the same way", () => {
    const f = fake(0b1);
    f.room.region = "kessar";
    const t = new Travel(f.host);
    t.propose("s0", 0, "kessar"); // already there: ignored
    expect(t.state.phase).toBe(0);
    t.propose("s0", 0, "hollowmere");
    t.tick(7);
    expect(f.log).toContain("enter hollowmere");
  });
});
