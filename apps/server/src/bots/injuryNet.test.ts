import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { BUTTON, FLAG, LIMB, ZONE } from "@cb/shared";
import { createGameServer } from "../app.ts";
import { loadConfig } from "../config.ts";
import { configureLogger } from "../log.ts";
import type { WorldRoom } from "../rooms/WorldRoom.ts";
import { Bot, type Behaviour } from "./Bot.ts";

const PORT = 2580; // one port per integration test file
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown> = {};

/** Sprints along a wide arc in the flat spawn clearing: constant speed changes are exactly what injuries alter. */
const sprintArc: Behaviour = (tick) => ({ moveF: 1, moveR: 0, yaw: (tick / 30) * 0.7, buttons: BUTTON.SPRINT | BUTTON.JUMP });

/**
 * A wound is a server-owned INPUT to the shared step. The client mirrors it with the reconciler snapshot (PREDICTED_FIELDS), so a
 * wound that lands while the player is running must cost at most a tiny correction. Numbers are recorded in test-results/injury-net.json
 * and copied into docs/NETWORKING.md.
 */
describe("prediction while injuries land mid-run", () => {
  let colyseus: ColyseusTestServer;
  beforeAll(async () => {
    configureLogger("error", { silent: true });
    const server = createGameServer(loadConfig({ NODE_ENV: "test" } as never));
    await server.listen(PORT);
    colyseus = new ColyseusTestServer(server);
  });
  afterAll(async () => {
    mkdirSync("../../test-results", { recursive: true });
    writeFileSync("../../test-results/injury-net.json", JSON.stringify(results, null, 2));
    await colyseus.shutdown();
  });

  type Harm = (room: WorldRoom, id: string) => void;
  const scenarios: Record<string, Harm[]> = {
    none: [],
    "grievous leg": [(r, id) => r.damagePlayer(id, 44, { zone: ZONE.LEG_L })],
    "leg torn off": [(r, id) => r["casualties"].sever(id, LIMB.LEG_R)],
    "leg torn off, peg fitted": [(r, id) => r["casualties"].sever(id, LIMB.LEG_R)],
    "three hits in a second": [
      (r, id) => r.damagePlayer(id, 30, { zone: ZONE.LEG_L }),
      (r, id) => r.damagePlayer(id, 44, { zone: ZONE.LEG_R }),
      (r, id) => r.damagePlayer(id, 25, { zone: ZONE.HEAD }),
    ],
  };

  for (const rtt of [0, 120]) {
    for (const [name, harms] of Object.entries(scenarios)) {
      it(`${name} at ${rtt} ms RTT: bounded correction`, async () => {
        colyseus.server.simulateLatency(rtt);
        const bot = await Bot.create(URL, "runner", sprintArc);
        const room = colyseus.getRoomById<WorldRoom>(bot.room.roomId);
        const id = bot.room.sessionId;
        if (name.includes("peg")) room["woodenLeg"].set(id, 2); // wooden leg fitted on the right
        bot.start();
        await sleep(2600); // past the spawn-snap warm-up, running
        for (const harm of harms) {
          harm(room, id);
          await sleep(350);
        }
        await sleep(2400);
        const seen = { wounds: bot.predicted!.wounds, missing: bot.predicted!.missing, flags: bot.predicted!.flags };
        const stats = await bot.stop();
        colyseus.server.simulateLatency(0);
        results[`${name} @${rtt}`] = { correctionMean: stats.correctionMean, correctionMax: stats.correctionMax, driftEma: stats.driftEma, popMax: stats.popMax };
        // The client really did learn the injury and predicted with it.
        if (harms.length) expect(seen.wounds).not.toBe(0);
        if (name.includes("torn off")) expect(seen.missing).toBe(LIMB.LEG_R);
        if (name.includes("peg")) expect(seen.flags & FLAG.PEG_LEG).toBeTruthy();
        // Measured (2026-09-29): mean <= 1.1 mm, worst single correction <= 45 mm. With wounds/missing NOT mirrored (mutation) the same
        // scenarios give mean 70-217 mm and worst 0.25-0.49 m, so these bounds separate the two by an order of magnitude.
        expect(stats.correctionMean).toBeLessThan(0.01);
        expect(stats.correctionMax).toBeLessThan(rtt === 0 ? 0.1 : 0.15);
      });
    }
  }
});
