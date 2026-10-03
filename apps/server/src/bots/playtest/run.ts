/**
 * The playtest harness (D-040): scripted players walk the real game's contracts through a REAL server (the same app, rooms, messages, shared step and combat a
 * browser meets), the way a person would play them, and write down what a player would have seen and felt: the time each objective took, the notices, the health
 * lost, the downs, where a walk got stuck, and the ending. It is a tool for finding dull minutes, unclear objectives, unfair deaths and dead ends, not a test:
 * every number it prints is a first pass against scripted bots. Usage (from apps/server):
 *   npx tsx src/bots/playtest/run.ts [plan-name-substring ...]
 * A bad network (release gate 13): PLAYTEST_BADNET=delayMs,jitterMs,stallP,stallMs[,seed] puts every player behind `badnet.ts` (one-way delay, jitter, stalls), and the report
 * carries each player's prediction numbers (corrections, drift, pops) to compare with a clean run.
 * Report: stdout, and JSON under test-results/playtest/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGameServer } from "../../app.ts";
import { loadConfig } from "../../config.ts";
import { configureLogger } from "../../log.ts";
import { startBadNet, type BadNet } from "../badnet.ts";
import { Pilot } from "./pilot.ts";
import { PLANS } from "./plans.ts";

const PORT = Number(process.env.PLAYTEST_PORT ?? 2621);

async function main(): Promise<void> {
  configureLogger("error", { silent: true });
  const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1", PORT: String(PORT) } as never));
  await server.listen(PORT);
  const bad = (process.env.PLAYTEST_BADNET ?? "").split(",").filter(Boolean).map(Number);
  let badnet: BadNet | undefined;
  if (bad.length >= 4) {
    badnet = await startBadNet(0, PORT, { delayMs: bad[0]!, jitterMs: bad[1]!, stallP: bad[2]!, stallMs: bad[3]!, seed: bad[4] ?? 1 });
    console.log(`bad network: ${bad[0]} ms each way + 0..${bad[1]} ms jitter, a ${bad[3]} ms stall behind ${(bad[2]! * 100).toFixed(1)}% of chunks`);
  }
  const url = `ws://127.0.0.1:${badnet?.port ?? PORT}`;
  const want = process.argv.slice(2);
  const plans = PLANS.filter((p) => want.length === 0 || want.some((w) => p.name.includes(w)));
  const out = resolve(process.cwd(), "../../test-results/playtest");
  mkdirSync(out, { recursive: true });
  const summaries: string[] = [];
  for (const plan of plans) {
    const pilot = new Pilot(plan.player ?? "Ada Thrupp");
    let err = "";
    try {
      await pilot.join(url, plan.join);
      await plan.run(pilot);
    } catch (e) {
      err = e instanceof Error ? e.stack ?? e.message : String(e);
      pilot.note(`ERROR ${err}`);
    }
    const v = pilot.view;
    const net = pilot.netStats;
    const report = { plan: plan.name, expect: plan.expect, got: v?.resolution ?? "unresolved", secs: Math.round(pilot.secs), minHealth: pilot.minHealth, downs: pilot.downs, net, badnet: badnet?.stats(), log: pilot.log, notices: pilot.notices };
    writeFileSync(resolve(out, `${plan.name}.json`), JSON.stringify(report, null, 1));
    const ok = plan.expect === undefined || (plan.expect as string[]).includes(report.got);
    const nl = net ? `; corrections max ${net.correctionMax.toFixed(2)} m mean ${net.correctionMean.toFixed(3)} m; drift peak ${net.driftPeak.toFixed(2)} m` : "";
    const line = `${ok ? "OK  " : "MISS"} ${plan.name}: expected ${plan.expect?.join("|") ?? "-"} got ${report.got} in ${report.secs}s; min health ${report.minHealth}; downs ${report.downs}${nl}${err ? " ERROR" : ""}`;
    summaries.push(line);
    console.log(`\n=== ${plan.name}\n${pilot.log.map((l) => `${String(l.t).padStart(6)}  ${l.what}`).join("\n")}\n${line}`);
    try {
      await pilot.leave();
    } catch {
      /* already gone */
    }
  }
  console.log(`\n=== SUMMARY\n${summaries.join("\n")}`);
  // (a room still disposing can hold the shutdown open for minutes: the report is written, so do not wait on it)
  await Promise.race([server.gracefullyShutdown(false).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(0);
}

void main();
