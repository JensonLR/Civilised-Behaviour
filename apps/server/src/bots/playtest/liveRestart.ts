/**
 * Live persistence probe (D-041): does a campaign on the DEPLOYED server survive that server's process ending? It needs no access to the host: the free
 * tier stops an idle service and boots a fresh process on the next request, and `/health` reports the process's uptime, so a resume after the uptime has
 * started again is a resume after a restart, against the deployed store (Neon on Render). Two phases, run minutes apart:
 *   npx tsx src/bots/playtest/liveRestart.ts create <https-base> <state-file>   # a new campaign, a manifest change, a confirmed save; writes the state file
 *   npx tsx src/bots/playtest/liveRestart.ts resume <https-base> <state-file>   # refuses unless the process is new; resumes by code + token, compares
 * The state file holds the join code, an anonymous v4 identity token minted here, the server's start time and the saved sections: nothing secret, but keep
 * it out of the repo (it is a key to one test campaign). Prints no connection string, pepper or credential, because it never has one.
 */
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_WORLD, WorldState, type WorldStateType } from "@cb/shared";

const [phase, base, file] = process.argv.slice(2) as ["create" | "resume", string, string];
if ((phase !== "create" && phase !== "resume") || !base?.startsWith("https://") || !file) {
  console.error("usage: liveRestart.ts create|resume https://<server> <state-file>");
  process.exit(2);
}
const wsBase = base.replace(/^https:/, "wss:");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};

interface Sections { campaign: string; powers: string; settlements: string; party: string; seed: number; code: string }
interface State { code: string; token: string; startedAt: number; sections: Sections }
const sections = (room: Room<WorldStateType>): Sections => ({
  campaign: room.state.campaign, powers: room.state.powers, settlements: room.state.settlements, party: room.state.party, seed: room.state.seed, code: room.state.code,
});

/** When the serving process started (ms since the epoch), from its uptime. */
async function processStart(): Promise<number> {
  const r = await fetch(`${base}/health`);
  const h = (await r.json()) as { ok: boolean; env: string; uptimeS: number };
  console.log(`health: ok=${h.ok} env=${h.env} uptime ${h.uptimeS} s`);
  return Date.now() - h.uptimeS * 1000;
}

async function open(opts: Record<string, unknown>): Promise<{ room: Room<WorldStateType>; saves: { kept: boolean; ok: boolean; at: number }[] }> {
  const room = await new Client(wsBase).create<WorldStateType>(ROOM_WORLD, { name: "QA Restart Probe", ...opts }, WorldState as never);
  const saves: { kept: boolean; ok: boolean; at: number }[] = [];
  room.onMessage("saved", (m: { kept: boolean; ok: boolean; at: number }) => saves.push(m));
  room.onMessage("*", () => undefined);
  for (let i = 0; i < 200 && !room.state.code; i++) await sleep(50);
  return { room, saves };
}

/** Leave without waiting on the SDK (over a proxy its consented leave can fall into its reconnection loop). */
async function bye(room: Room<WorldStateType>): Promise<void> {
  void Promise.race([room.leave(true), sleep(1500)]).catch(() => undefined);
  await sleep(1500);
}

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(100);
  return cond();
}

async function create(): Promise<void> {
  const startedAt = await processStart();
  const token = crypto.randomUUID();
  const { room, saves } = await open({ token });
  check(await until(() => saves.length > 0, 15_000), "the joiner is told where the save stands");
  check(saves[0]?.kept === true, `the deployed room keeps the campaign (kept=${saves[0]?.kept})`);
  // (a manifest change, if the server takes one from here, makes the party section more than its default; it is compared either way)
  const party0 = room.state.party;
  room.send("loadoutSet", { loadout: { ammo: 1, medical: 1, provisions: 0, powder: 0, horses: 1, wagon: false } });
  console.log(`note: manifest change ${(await until(() => room.state.party !== party0, 5000)) ? "taken" : "not taken from the landing (the party section stays its default)"}`);
  const n = saves.length;
  room.send("saveNow", {});
  check(await until(() => saves.length > n && saves[saves.length - 1]!.ok, 15_000), "saveNow is answered ok");
  const state: State = { code: room.state.code, token, startedAt, sections: sections(room) };
  writeFileSync(file, JSON.stringify(state));
  console.log(`campaign ${state.code} (seed ${state.sections.seed}) recorded; leaving`);
  await bye(room);
}

async function resume(): Promise<void> {
  const state = JSON.parse(readFileSync(file, "utf8")) as State;
  const startedAt = await processStart();
  const fresh = startedAt > state.startedAt + 60_000;
  check(fresh, `the serving process is a NEW one (started ${Math.round((startedAt - state.startedAt) / 60_000)} min after the one that saved)`);
  if (!fresh) {
    console.log("not restarted yet: run resume again later");
    process.exit(3);
  }
  const { room } = await open({ resume: state.code, token: state.token });
  await until(() => room.state.campaign !== "", 15_000);
  const after = sections(room);
  check(after.code === state.code && after.seed === state.sections.seed, `same code (${after.code}) and seed (${after.seed})`);
  check(after.campaign === state.sections.campaign, "campaign section byte-identical");
  check(after.powers === state.sections.powers, "powers section byte-identical");
  check(after.settlements === state.sections.settlements, "settlements section byte-identical");
  check(after.party === state.sections.party, "party section byte-identical");
  check(room.state.region === "hollowmere", `a resumed expedition begins at HQ (${room.state.region})`);
  await bye(room);
  try {
    const { room: r } = await open({ resume: state.code, token: crypto.randomUUID() });
    check(false, "a stranger's token was let in");
    await bye(r);
  } catch (e) {
    check(/No expedition|cannot|not/i.test(e instanceof Error ? e.message : String(e)), "a stranger's token is refused");
  }
}

await (phase === "create" ? create() : resume()).catch((e) => {
  check(false, `${phase}: ${e instanceof Error ? e.message : e}`);
});
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
