// Server capacity per instance (D-051): the PRODUCTION build in its own process, rooms added in steps (one walking bot each, from this process), and at every step the
// server's own resident memory, CPU share and tick times. The soak (scripts/soak.mjs) runs its bots in the server's process, so its memory is not the server's; this is.
// Usage: pnpm --filter @cb/server build && npx tsx scripts/capacity.mts [--steps 0,2,4,8,12] [--bots 1-4] [--settle 20] [--port 2596] [--out cap.json]
// Never uses :2567. Prints one JSON line per step on stdout, then a summary with the marginal cost of a room (least squares over the steps).
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { Bot, circleWalker } from "../apps/server/src/bots/Bot.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const steps = arg("steps", "0,2,4,8,12").split(",").map(Number);
const perRoom = Math.max(1, Math.min(4, Number(arg("bots", "1")))); // players per room (a full party is 4)
const settleS = Number(arg("settle", "20"));
const port = Number(arg("port", "2596"));
const out = arg("out", "");
// `--quota 0.1`: run the server under a hard CPU quota (a cgroup-v1 CFS quota, as a hosted instance is held: Render's free tier is 0.1 of a core). Needs root and a writable
// /sys/fs/cgroup/cpu (true in the dev container). Busy loops sharing a core are NOT the same: the scheduler favours the mostly idle server, so it never feels the squeeze.
const quota = Number(arg("quota", "0"));
const shed = arg("shed", "1000"); // ROOM_SHED_LAG_MS for the run (1000: measure, never refuse)
const http = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cg = quota > 0 ? `/sys/fs/cgroup/cpu/cb-capacity-${port}` : "";
if (cg) {
  mkdirSync(cg, { recursive: true });
  writeFileSync(`${cg}/cpu.cfs_period_us`, "100000");
  writeFileSync(`${cg}/cpu.cfs_quota_us`, String(Math.round(quota * 100000)));
}
const server = spawn(cg ? "sh" : process.execPath, cg ? ["-c", `echo $$ > ${cg}/tasks; exec "${process.execPath}" apps/server/dist/main.js`] : ["apps/server/dist/main.js"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), ALLOWED_ORIGINS: "http://capacity.invalid", CAMPAIGN_STORE: "memory", ROOM_CREATE_BURST: "0", MAX_ROOMS: "0", ROOM_SHED_LAG_MS: shed, LOG_LEVEL: "warn" },
  stdio: ["ignore", "ignore", "inherit"],
});
const pid = server.pid!;
const CLK = 100; // USER_HZ on Linux
const cpuTicks = (): number => {
  const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ");
  return Number(f[11]) + Number(f[12]); // utime + stime (fields 14 and 15, counted after the comm field)
};
type Metrics = { rooms: number; players: number; rssMB: number; heapMB: number; tickOverruns: number; lagMs: number; tick: { p50Ms: number; p95Ms: number; maxMs: number } };
const metrics = async (): Promise<Metrics> => (await fetch(`${http}/metrics`)).json() as Promise<Metrics>;

const bots: Bot[] = [];
let refused = 0;
const rows: { rooms: number; rssMB: number; heapMB: number; cpuCores: number; lagMs: number; tickP50Ms: number; tickP95Ms: number; overruns: number; refused: number; shedding: boolean }[] = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      await metrics();
      break;
    } catch {
      await sleep(300);
    }
  }
  for (const n of steps) {
    while (bots.length < n * perRoom) {
      let host: Bot;
      try {
        host = await Bot.create(`ws://127.0.0.1:${port}`, `Cap${bots.length}`, circleWalker);
      } catch (e) {
        refused++; // the server shed it (503: too busy for another room); the step measures what it holds
        process.stderr.write(`create refused: ${e instanceof Error ? e.message : String(e)}\n`);
        break;
      }
      host.start();
      bots.push(host);
      for (let k = 1; k < perRoom; k++) {
        const b = await Bot.joinById(`ws://127.0.0.1:${port}`, host.room.roomId, `Cap${bots.length}`, circleWalker);
        b.start();
        bots.push(b);
      }
    }
    await sleep(settleS * 500); // let the new rooms build and settle, then measure over the second half
    const c0 = cpuTicks();
    const t0 = performance.now();
    const before = await metrics();
    await sleep(settleS * 500);
    const m = await metrics();
    const cpuCores = (cpuTicks() - c0) / CLK / ((performance.now() - t0) / 1000);
    const row = { rooms: m.rooms, rssMB: m.rssMB, heapMB: m.heapMB, cpuCores: Math.round(cpuCores * 1000) / 1000, lagMs: m.lagMs, tickP50Ms: m.tick.p50Ms, tickP95Ms: m.tick.p95Ms, overruns: m.tickOverruns - before.tickOverruns, refused, shedding: (m as unknown as { shedding: boolean }).shedding };
    rows.push(row);
    process.stdout.write(JSON.stringify(row) + "\n");
  }
} finally {
  for (const b of bots) await b.stop().catch(() => undefined);
  server.kill("SIGTERM");
  if (cg) {
    await new Promise((r) => server.once("exit", r));
    try {
      rmdirSync(cg);
    } catch {
      /* (a cgroup with a task left in it cannot be removed; it is harmless) */
    }
  }
}

// marginal cost per room: least squares over the steps
const fit = (ys: number[]): { perRoom: number; base: number } => {
  const xs = rows.map((r) => r.rooms);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
  const perRoom = sxy / sxx;
  return { perRoom: Math.round(perRoom * 1000) / 1000, base: Math.round((my - perRoom * mx) * 1000) / 1000 };
};
const summary = { steps: rows, rssMB: fit(rows.map((r) => r.rssMB)), cpuCores: fit(rows.map((r) => r.cpuCores)) };
process.stdout.write(JSON.stringify({ summary: { rssMB: summary.rssMB, cpuCores: summary.cpuCores } }) + "\n");
if (out) writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
process.exit(0);
