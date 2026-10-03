import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_WORLD } from "@cb/shared";
import { createGameServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { LoadGauge } from "./load.ts";
import { configureLogger } from "./log.ts";

/** Lateness readings (ms), one per sample. */
const lags = (xs: number[]) => {
  let i = 0;
  return (): number => xs[Math.min(i++, xs.length - 1)]!;
};

describe("the load gauge (D-051: new rooms are admitted against how late the game thread's timers run, not a fixed cap)", () => {
  it("is busy only when the MEDIAN of a full window is at or above the threshold: one slow sample (a world being built) is not busy; off at 0", () => {
    const g = new LoadGauge({ maxLagMs: 20, window: 3, everyMs: 1000 }, lags([2, 400, 3, 30, 25, 40, 5, 4]));
    const seen: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      g.sample();
      seen.push(g.busy());
    }
    // windows: [2] [2,400] [2,400,3]=3 [400,3,30]=30 busy [3,30,25]=25 busy [30,25,40]=30 busy [25,40,5]=25 busy [40,5,4]=5
    expect(seen).toEqual([false, false, false, true, true, true, true, false]);
    expect(g.lagMs).toBe(5);
    const off = new LoadGauge({ maxLagMs: 0, window: 1, everyMs: 1000 }, lags([500]));
    off.sample();
    expect(off.busy()).toBe(false);
  });

  it("production turns it on at 20 ms and anything else leaves it off; a bad value is refused", () => {
    expect(loadConfig({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://x.example" } as never).shedLagMs).toBe(20);
    expect(loadConfig({ NODE_ENV: "development" } as never).shedLagMs).toBe(0);
    expect(loadConfig({ NODE_ENV: "development", ROOM_SHED_LAG_MS: "35" } as never).shedLagMs).toBe(35);
    expect(() => loadConfig({ NODE_ENV: "development", ROOM_SHED_LAG_MS: "-1" } as never)).toThrow(/ROOM_SHED_LAG_MS/);
  });
});

// one port per integration test file (vitest runs files in parallel)
const PORT = 2612;

describe("a busy server (D-051)", () => {
  let colyseus: ColyseusTestServer;
  const gauge = new LoadGauge({ maxLagMs: 20, window: 1, everyMs: 60_000 }, lags([1, 45]));
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never), gauge);
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => colyseus.shutdown());

  it("refuses a NEW campaign with the offices-full answer while the load is high, but a friend still joins the campaign already running, and /metrics says why", async () => {
    gauge.sample(); // 1 ms late: quiet
    const host = await colyseus.sdk.create(ROOM_WORLD, { name: "Host" });
    gauge.sample(); // 45 ms late: busy
    expect(gauge.busy()).toBe(true);
    await expect(colyseus.sdk.create(ROOM_WORLD, { name: "Late" })).rejects.toMatchObject({ code: 503 });
    const friend = await colyseus.sdk.joinById(host.roomId, { name: "Friend" });
    expect(friend.roomId).toBe(host.roomId);
    const m = (await colyseus.http.get("/metrics")).data as { lagMs: number; shedding: boolean; rooms: number };
    expect(m).toMatchObject({ shedding: true, rooms: 1, lagMs: 45 });
    await friend.leave();
    await host.leave();
  }, 60_000);
});
