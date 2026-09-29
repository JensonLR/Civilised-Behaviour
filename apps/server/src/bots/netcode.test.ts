import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import { Bot, circleWalker, wallBumper, type Behaviour } from "./Bot.ts";

const PORT = 2572; // one port per integration test file (vitest runs files in parallel)
const URL = `ws://127.0.0.1:${PORT}`;
const results: Record<string, unknown> = {};
/** Prediction must agree with the server: tiny persistent drift, no large single correction. */
const expectMatched = (s: { driftEma: number; correctionMax: number }) => {
  expect(s.driftEma).toBeLessThan(0.01);
  expect(s.correctionMax).toBeLessThan(0.05);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("prediction under simulated latency", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    // Persist measurements for docs/PERFORMANCE.md (vitest swallows console output here).
    mkdirSync("../../test-results", { recursive: true });
    writeFileSync("../../test-results/netcode.json", JSON.stringify(results, null, 2));
    await colyseus.shutdown();
  });
  afterEach(() => colyseus.server.simulateLatency(0));

  const run = async (rttMs: number, behaviour: Behaviour, seconds: number) => {
    colyseus.server.simulateLatency(rttMs);
    const bot = await Bot.create(URL, `bot${rttMs}`, behaviour);
    bot.start();
    await sleep(seconds * 1000);
    const predicted = bot.predicted!;
    const auth = bot.self!;
    const stats = await bot.stop();
    return { stats, predicted: { x: predicted.x, z: predicted.z }, auth: { x: auth.x, z: auth.z } };
  };

  // Regression for D-013: empty server ticks must not synthesize steps the client never predicted.
  it("client hitches (150 ms stalls then input bursts) do not desync prediction", async () => {
    colyseus.server.simulateLatency(60);
    const bot = await Bot.create(URL, "hitchy", wallBumper);
    bot.start();
    await sleep(2200); // past the spawn-snap warm-up
    for (let i = 0; i < 6; i++) {
      await bot.hitch(150);
      await sleep(600);
    }
    await sleep(600);
    const stats = await bot.stop();
    results["hitch_rtt60"] = stats;
    expectMatched(stats);
  });

  it("a long client hitch (350 ms) is applied in full: the input budget tolerates real stalls", async () => {
    colyseus.server.simulateLatency(60);
    const bot = await Bot.create(URL, "stall", wallBumper);
    bot.start();
    await sleep(2200);
    for (let i = 0; i < 4; i++) {
      await bot.hitch(350);
      await sleep(700);
    }
    await sleep(600);
    const stats = await bot.stop();
    results["longhitch_rtt60"] = stats;
    expectMatched(stats);
  });

  for (const rtt of [0, 100, 150]) {
    it(`circle walk at ${rtt} ms RTT: no visible correction pops`, async () => {
      const r = await run(rtt, circleWalker, 5);
      results[`circle_rtt${rtt}`] = r.stats;
      expect(r.stats.ticks).toBeGreaterThan(100);
      expect(r.stats.popMax).toBeLessThan(0.3);
      expectMatched(r.stats);
    });

    it(`wall collisions at ${rtt} ms RTT: prediction agrees with the server`, async () => {
      const r = await run(rtt, wallBumper, 8);
      results[`wall_rtt${rtt}`] = r.stats;
      expect(r.stats.popMax).toBeLessThan(0.4);
      expectMatched(r.stats);
      // Authoritative state lags by ~RTT, so allow the distance covered in that time at sprint speed.
      const lag = Math.hypot(r.predicted.x - r.auth.x, r.predicted.z - r.auth.z);
      expect(lag).toBeLessThan(6.6 * (rtt / 1000 + 0.35));
    });
  }
});
