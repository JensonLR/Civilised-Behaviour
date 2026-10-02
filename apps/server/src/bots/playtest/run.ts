/**
 * The playtest harness (D-040): scripted players walk the real game's contracts through a REAL server (the same app, rooms, messages, shared step and combat a
 * browser meets), the way a person would play them, and write down what a player would have seen and felt: the time each objective took, the notices, the health
 * lost, the downs, where a walk got stuck, and the ending. It is a tool for finding dull minutes, unclear objectives, unfair deaths and dead ends, not a test:
 * every number it prints is a first pass against scripted bots. Usage (from apps/server):
 *   npx tsx src/bots/playtest/run.ts [plan-name-substring ...]
 * Report: stdout, and JSON under test-results/playtest/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGameServer } from "../../app.ts";
import { loadConfig } from "../../config.ts";
import { configureLogger } from "../../log.ts";
import { Pilot } from "./pilot.ts";
import { PLANS } from "./plans.ts";

const PORT = Number(process.env.PLAYTEST_PORT ?? 2621);

async function main(): Promise<void> {
  configureLogger("error", { silent: true });
  const server = createGameServer(loadConfig({ NODE_ENV: "test", DEBUG_COMMANDS: "1", PORT: String(PORT) } as never));
  await server.listen(PORT);
  const url = `ws://127.0.0.1:${PORT}`;
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
    const report = { plan: plan.name, expect: plan.expect, got: v?.resolution ?? "unresolved", secs: Math.round(pilot.secs), minHealth: pilot.minHealth, downs: pilot.downs, log: pilot.log, notices: pilot.notices };
    writeFileSync(resolve(out, `${plan.name}.json`), JSON.stringify(report, null, 1));
    const ok = plan.expect === undefined || (plan.expect as string[]).includes(report.got);
    const line = `${ok ? "OK  " : "MISS"} ${plan.name}: expected ${plan.expect?.join("|") ?? "-"} got ${report.got} in ${report.secs}s; min health ${report.minHealth}; downs ${report.downs}${err ? " ERROR" : ""}`;
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
