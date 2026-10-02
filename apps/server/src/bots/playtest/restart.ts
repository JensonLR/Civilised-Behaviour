/**
 * Restart persistence against a REAL store (D-041): runs the real server entry point (src/main.ts) as a child process with the production-like persistence config
 * (CAMPAIGN_STORE=postgres or file, a pepper), plays a campaign through the real SDK (create, outcomes committed by the QA command, an outpost founded), then KILLS
 * the server (SIGKILL: a crash; SIGTERM: a deploy) and starts a fresh one on the same store, resumes by join code with the same identity token and compares
 * every saved section byte for byte. A stranger's token and an unknown code must be refused. Usage (from apps/server):
 *   DATABASE_URL=postgres://... npx tsx src/bots/playtest/restart.ts postgres
 *   npx tsx src/bots/playtest/restart.ts file
 * Exits non-zero on any mismatch.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_WORLD, WorldState, type WorldStateType } from "@cb/shared";

const kind = (process.argv[2] ?? "postgres") as "postgres" | "file";
const PORT = 2631;
const URL_WS = `ws://127.0.0.1:${PORT}`;
const saveDir = kind === "file" ? mkdtempSync(join(tmpdir(), "cb-restart-")) : "";
const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(PORT),
  DEBUG_COMMANDS: "1",
  LOG_LEVEL: "warn",
  CAMPAIGN_STORE: kind,
  IDENTITY_PEPPER: "restart-test-pepper-0123456789abcdef",
  ...(kind === "file" ? { SAVE_DIR: saveDir } : {}),
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};

async function boot(): Promise<ChildProcess> {
  // (node itself, with tsx as a loader: the signal must reach the server process, not a launcher that may not forward it)
  const child = spawn(process.execPath, ["--import", "tsx", resolve("src/main.ts")], { env, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("server did not come up");
}

async function stop(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  const gone = new Promise<void>((r) => child.once("exit", () => r()));
  // (npx runs tsx which runs node: signal the whole group by killing the child and waiting; tsx forwards SIGTERM, SIGKILL needs the grandchild too)
  child.kill(signal);
  await Promise.race([gone, sleep(10_000)]);
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/health`);
      await sleep(250);
    } catch {
      return;
    }
  }
  throw new Error(`the server did not stop on ${signal}`);
}

interface Sections { campaign: string; powers: string; settlements: string; party: string; seed: number; code: string }
const sections = (room: Room<WorldStateType>): Sections => ({
  campaign: room.state.campaign, powers: room.state.powers, settlements: room.state.settlements, party: room.state.party, seed: room.state.seed, code: room.state.code,
});

async function open(opts: Record<string, unknown>): Promise<{ room: Room<WorldStateType>; saves: { kept: boolean; ok: boolean; at: number }[] }> {
  const room = await new Client(URL_WS).create<WorldStateType>(ROOM_WORLD, { name: "Ada", ...opts }, WorldState as never);
  const saves: { kept: boolean; ok: boolean; at: number }[] = [];
  room.onMessage("saved", (m: { kept: boolean; ok: boolean; at: number }) => saves.push(m));
  room.onMessage("*", () => undefined);
  for (let i = 0; i < 80 && !room.state.code; i++) await sleep(50);
  return { room, saves };
}

async function waitFor(cond: () => boolean, ms: number, what: string): Promise<boolean> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) {
      console.log(`  (timed out waiting for ${what})`);
      return false;
    }
    await sleep(50);
  }
  return true;
}

async function scenario(signal: NodeJS.Signals, waitForSave: boolean): Promise<void> {
  console.log(`\n--- ${kind} store, ${signal}, ${waitForSave ? "after the save was confirmed" : "straight after the change (no wait)"}`);
  const token = crypto.randomUUID(); // (the identity the browser keeps in cb.identity: an anonymous v4 UUID)
  let server = await boot();
  const { room, saves } = await open({ token });
  check(await waitFor(() => saves.length > 0, 5000, "the save line"), "the joiner is told where the save stands");
  check(saves[0]?.kept === true, `the room keeps the campaign (kept=${saves[0]?.kept})`);
  for (const r of ["paid", "rescued", "seized"]) room.send("debug", { cmd: `outcome:${r}` });
  room.send("debug", { cmd: "outpost:trading_post" });
  const histOk = await waitFor(() => (JSON.parse(room.state.campaign || "{}").history?.length ?? 0) === 3, 10_000, "three endings");
  check(histOk, "three endings are on the ledger");
  if (waitForSave) {
    const n = saves.length;
    room.send("saveNow", {});
    await waitFor(() => saves.length > n && saves[saves.length - 1]!.ok, 6000, "saveNow's answer");
  }
  const before = sections(room);
  await stop(server, signal);
  void Promise.race([room.leave(false), sleep(500)]).catch(() => undefined); // (the socket died with the server: do not wait on it)
  server = await boot();
  try {
    const { room: back } = await open({ resume: before.code, token });
    await waitFor(() => back.state.campaign !== "", 5000, "the resumed ledger");
    const after = sections(back);
    check(after.code === before.code && after.seed === before.seed, `same code (${after.code}) and seed (${after.seed})`);
    check(after.campaign === before.campaign, "campaign section byte-identical");
    check(after.powers === before.powers, "powers section byte-identical");
    check(after.settlements === before.settlements, "settlements section byte-identical");
    check(after.party === before.party, "party section byte-identical");
    check(back.state.region === "hollowmere", `a resumed expedition begins at HQ (${back.state.region})`);
    await back.leave(true);
  } catch (e) {
    check(false, `resume after ${signal}: ${e instanceof Error ? e.message : e}`);
  }
  // a stranger, and a code nobody has
  for (const [opts, what] of [[{ resume: before.code, token: crypto.randomUUID() }, "a stranger's token"], [{ resume: "ZZZZZ", token }, "an unknown code"]] as const) {
    try {
      const { room: r } = await open(opts as never);
      check(false, `${what} was let in`);
      await r.leave(true);
    } catch (e) {
      check(/No expedition|cannot|not/i.test(e instanceof Error ? e.message : String(e)), `${what} is refused ("${e instanceof Error ? e.message.slice(0, 60) : e}")`);
    }
  }
  await stop(server, "SIGTERM");
}

async function main(): Promise<void> {
  await scenario("SIGKILL", true);
  await scenario("SIGTERM", false);
  if (saveDir) rmSync(saveDir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
