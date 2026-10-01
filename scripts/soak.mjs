// Server soak (D-036, package Q): real rooms + real bots in one process, per-room tick percentiles, per-section cost, heap after GC, wire bytes, bot drift.
// Usage: node scripts/soak.mjs --rooms 4 --bots 4 --npcs 24 --seconds 300 --scenario mixed --out soak.json [--seed 11] [--port 2583] [--reconnect 60]
// Prints the SoakReport JSON on stdout (progress and verdict on stderr); exits 1 when a budget in packages/shared/src/budgets.ts is broken. CB_BUDGET_SLACK=2 doubles the TIME
// budgets on a noisy host. Never uses :2567. The harness removes its rooms, port, timers and temp save directory on the way out (it is a function, runSoak, tested in-process).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.error("node scripts/soak.mjs [--rooms N] [--bots 1-4] [--npcs 0-24] [--seconds S] [--scenario town|garrison|mixed] [--seed N] [--port N] [--reconnect S] [--out file.json]");
  process.exit(0);
}

// Re-exec under tsx with a real gc (the report says whether the heap was measured after a forced GC).
if (!process.env.CB_SOAK_CHILD) {
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync(process.execPath, ["--expose-gc", "--import", "tsx", self, ...args], { stdio: "inherit", env: { ...process.env, CB_SOAK_CHILD: "1" }, cwd: process.cwd() });
  process.exit(r.status ?? 1);
}

// (a dependency prints an ".env not found" line with console.log: stdout is for the JSON only)
console.log = console.error;
const { runSoak } = await import("../apps/server/src/bots/soak/index.ts");
const options = {
  rooms: Number(arg("rooms", 2)),
  botsPerRoom: Number(arg("bots", 4)),
  npcs: Number(arg("npcs", 18)),
  seconds: Number(arg("seconds", 60)),
  scenario: arg("scenario", "mixed"),
  seed: Number(arg("seed", 11)),
  port: Number(arg("port", 2583)),
  reconnectS: Number(arg("reconnect", 60)),
};
console.error(`soak: ${options.rooms} room(s) x ${options.botsPerRoom} bot(s), ${options.npcs} NPC rows, ${options.scenario}, ${options.seconds} s on :${options.port}`);
const report = await runSoak(options);
const json = JSON.stringify(report, null, 2);
const out = arg("out", "");
if (out) writeFileSync(out, json + "\n");
process.stdout.write(json + "\n");
if (report.failures.length) {
  console.error(`SOAK FAILED:\n - ${report.failures.join("\n - ")}`);
  process.exit(1);
}
console.error("soak: within budget");
process.exit(0);
