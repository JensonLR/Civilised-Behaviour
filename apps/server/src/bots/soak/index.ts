import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  FLAG, MAX_PLAYERS, NPC, NPC_CAP, NPC_SIDE, ROOM_WORLD, SERVER_BUDGET, TICK_RATE, KESSAR_ANCHORS, KESSAR_SITES, createRegionWorld, hash3, isRegionId, regionMountSpots, judgeSoak, percentile, regionWorldOpts, worldKey,
  type NpcSpec, type RegionId, type SoakReport, type SoakTick, WEAPON,
} from "@cb/shared";
import { createGameServer } from "../../app.ts";
import { loadConfig } from "../../config.ts";
import { configureLogger } from "../../log.ts";
import { metrics } from "../../metrics.ts";
import type { WorldRoom } from "../../rooms/WorldRoom.ts";
import { tickProbe } from "../../tickProbe.ts";
import { Bot, type BotStats } from "../Bot.ts";
import { soakBehaviour, type SoakActivity } from "./behaviour.ts";
import { WireCounter } from "./wire.ts";

/**
 * The soak harness (D-036, package Q; docs/_notes/ship.md section 4). `scripts/soak.mjs` runs `runSoak` under tsx and prints the `SoakReport` as JSON (exit code 1 when
 * `judgeSoak` finds a broken budget). Rooms are created in-process on a test port (`@colyseus/testing`; never :2567, which belongs to the dev server), the bots are the real
 * `Bot` (the browser's prediction wiring over a real WebSocket), and what is measured is the room's own fixed step (`tickProbe`), the patch encode, the wire, the heap after a
 * forced GC and what the bots saw of the server.
 *
 * What a room carries (`scenario`): "mixed" (the default, the budget's configuration) is Kessar with the Society's town at the crossing (`outpost:town`: its colliders and nav
 * grid), the garrison, the Syndicate's camp and padding rows up to `npcs`, a horse, a wagon, a file store in a temp dir (saves cost) and the bots' patrol/skirmish/ride loop with one
 * bot leaving and rejoining every `reconnectS`; "garrison" is the same without the town; "town" is Hollowmere's HQ (no server NPC rows, the villagers are the client's) with patrol
 * and ride only.
 *
 * Two honest limits. (1) The NPCs HOLD FIRE: a bot that is shot down is hauled back to the landing by the room, and that deliberate teleport would read as a netcode error in
 * `bots.correctionMax`. The garrison still thinks, paths, takes cover and is shot, bled and dismembered by the bots; what is not exercised is NPC rounds against players. (2) Bots
 * and room share one thread, so the room's tick is measured inside its own step (exact) and no whole-process CPU figure is claimed.
 */
export interface SoakOptions {
  /** Rooms running at once in this process. */
  rooms: number;
  /** Bots per room (1..4; each runs the real prediction wiring). */
  botsPerRoom: number;
  /** NPC rows per room (12..24, the Cast cap): garrison, rival, hands, deserters, drovers. */
  npcs: number;
  /** Measured seconds after the warm-up (`SERVER_BUDGET.warmupTicks`). */
  seconds: number;
  /** World seed of room 0; room i uses seed + i. */
  seed: number;
  /** Which behaviour the bots run: "town" stays at Hollowmere with villagers on, "garrison" crosses to Kessar and fights, "mixed" does both (the default for the budget). */
  scenario: "town" | "garrison" | "mixed";
  /** Test port (default 2583; 2584 is tickBudget.test.ts). */
  port?: number;
  /** One bot per room leaves and rejoins this often (seconds, default 60). */
  reconnectS?: number;
}

export const SOAK_DEFAULTS: SoakOptions = { rooms: 2, botsPerRoom: 4, npcs: 18, seconds: 60, seed: 11, scenario: "mixed" };
export const SOAK_PORT = 2583;

const SECTION_PATCH = "patch";
const MB = 1048576;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let running = false;

/** A `gc()` without the `--expose-gc` flag (the flag set at runtime); a no-op when even that is refused. */
function gcFn(): { gc: () => void; real: boolean } {
  try {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    return { gc, real: typeof gc === "function" };
  } catch {
    return { gc: () => undefined, real: false };
  }
}

/** The heap measure: V8's heap plus external memory (ArrayBuffers and the physics engine's WASM memory, which V8's heap does not count and which never shrinks). */
const heapMB = (gc: () => void): number => {
  gc();
  gc();
  const m = process.memoryUsage();
  return (m.heapUsed + m.external) / MB;
};

/** Pads (and keeps padded) a Kessar room to `target` NPC rows with deserters at the hostage camp's posts, and keeps every NPC group's fire held (see the header). */
function topUp(room: WorldRoom, target: number, serial: { n: number }): void {
  const r = room as unknown as { cast: { spawn(s: readonly NpcSpec[]): number; order(g: string, o: { o: "hold_fire" }): void }; state: { players: { forEach(cb: (p: { npc: number }) => void): void } }};
  let rows = 0;
  r.state.players.forEach((p) => {
    if (p.npc) rows++;
  });
  const want = Math.min(NPC_CAP, target);
  const posts = KESSAR_SITES.hostage.posts;
  const specs: NpcSpec[] = [];
  for (let i = rows; i < want; i++) {
    const k = serial.n++;
    const post = posts[k % posts.length]!;
    specs.push({
      id: `soak-${k}`, role: NPC.SENTRY, faction: "ward", side: NPC_SIDE[NPC.SENTRY]!, group: "soak", post: { x: post.x, z: post.z + 6 + (k % 5) * 3 }, weapon: k % 2 ? WEAPON.RIFLE : WEAPON.PISTOL,
      lookSeed: hash3(room.state.seed, k, 0x50a4), name: `Soak Auxiliary ${k}`, skill: 40, bravery: 50, brain: "garrison",
    });
  }
  if (specs.length) r.cast.spawn(specs);
  for (const g of ["ward", "rival", "soak", "outlaw"]) r.cast.order(g, { o: "hold_fire" });
}

/** Gives a bot the world the browser would build (region, bridge, outpost stage, telegraph) when the room's has changed since; never a teleport, only the collision model. */
function syncBotWorld(bot: Bot, keys: WeakMap<Bot, string>, region: RegionId, seed: number): void {
  const st = bot.room.state;
  if (!st.campaign || !st.settlements) return;
  const opts = regionWorldOpts(st.campaign, st.settlements, region);
  const key = `${region}|${worldKey(opts)}`;
  if (keys.get(bot) === key) return;
  keys.set(bot, key);
  bot.world = createRegionWorld(region, seed, opts);
}

/**
 * `Bot` keeps one number per rendered frame in a private log for its pop statistics (client-side tooling, unbounded: ~8 KB/s per bot). The soak does not report pops, and left alone
 * 16 bots would read as ~25 MB/h of "server heap growth", so the log is emptied before every heap sample.
 */
const dropPopLog = (bots: readonly Bot[]): void => {
  for (const b of bots) (b as unknown as { pops: number[] }).pops.length = 0;
};

const quiet = (bot: Bot): void => {
  bot.room.onMessage("*", () => undefined);
};

/** Least-squares slope of [seconds, MB] samples, per hour (0 when there are fewer than two or they share an instant): the heap's trend, not the difference of two noisy points. */
function slopePerHour(pts: readonly [number, number][]): number {
  const n = pts.length;
  if (n < 2) return 0;
  const mt = pts.reduce((a, p) => a + p[0], 0) / n;
  const mv = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [t, v] of pts) {
    num += (t - mt) * (v - mv);
    den += (t - mt) ** 2;
  }
  return den > 0 ? (num / den) * 3600 : 0;
}

const tickSummary = (samples: Float64Array, n: number): SoakTick => {
  const win = Array.from(samples.subarray(0, n)).sort((a, b) => a - b);
  return {
    samples: n, p50Ms: percentile(win, 0.5), p95Ms: percentile(win, 0.95), p99Ms: percentile(win, 0.99), maxMs: win[n - 1] ?? 0,
    overruns: win.reduce((c, ms) => (ms > SERVER_BUDGET.tickMs ? c + 1 : c), 0),
  };
};

export async function runSoak(options: Partial<SoakOptions> = {}): Promise<SoakReport> {
  const o: SoakOptions = { ...SOAK_DEFAULTS, ...options };
  const rooms = Math.floor(o.rooms), botsPerRoom = Math.floor(o.botsPerRoom), npcs = Math.floor(o.npcs);
  if (!(rooms >= 1 && rooms <= 16)) throw new Error(`rooms must be 1..16 (got ${o.rooms})`);
  if (!(botsPerRoom >= 1 && botsPerRoom <= MAX_PLAYERS)) throw new Error(`botsPerRoom must be 1..${MAX_PLAYERS} (got ${o.botsPerRoom})`);
  if (!(npcs >= 0 && npcs <= NPC_CAP)) throw new Error(`npcs must be 0..${NPC_CAP} (got ${o.npcs})`);
  if (!(o.seconds >= 2 && o.seconds <= 7200)) throw new Error(`seconds must be 2..7200 (got ${o.seconds})`);
  if (!["town", "garrison", "mixed"].includes(o.scenario)) throw new Error(`scenario must be town, garrison or mixed (got ${String(o.scenario)})`);
  if (running) throw new Error("runSoak is already running in this process (rooms, ports and the tick probe are process-wide)");
  running = true;

  const port = o.port ?? SOAK_PORT;
  const url = `ws://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), "cb-soak-"));
  const wire = new WireCounter();
  const { gc, real: gcReal } = gcFn();
  const region: RegionId = o.scenario === "town" ? "hollowmere" : "kessar";
  const fights = o.scenario !== "town";
  const town = o.scenario === "mixed";
  const reconnectMs = (o.reconnectS ?? 60) * 1000;

  let colyseus: ColyseusTestServer | undefined;
  const live: Bot[] = []; // every bot currently connected
  const finished: BotStats[] = []; // stats of bots that left (the reconnecter's earlier lives, and everyone at the end)
  const activity: SoakActivity = { shotsHeld: 0, mountedTicks: 0, walkedM: 0 };
  let reconnects = 0;
  const failures: string[] = [];
  const prevOnTick = tickProbe.onTick;

  try {
    configureLogger("error", { silent: true });
    wire.install();
    const server = createGameServer(loadConfig({ NODE_ENV: "test", CAMPAIGN_STORE: "file", SAVE_DIR: dir, IDENTITY_PEPPER: "soak-harness-pepper-not-a-secret" } as never));
    await server.listen(port);
    colyseus = new ColyseusTestServer(server);

    // ---- rooms: one tick sample array each, tagged by the room whose clock ticked last (a room's step runs synchronously after its clock tick) ----------------------------
    const capacity = Math.ceil((o.seconds + 30) * TICK_RATE * 2);
    const samples = Array.from({ length: rooms }, () => new Float64Array(capacity));
    const counts = new Array<number>(rooms).fill(0);
    const patchMs = new Float64Array(Math.ceil((o.seconds + 30) * 20 * rooms * 2));
    let patchN = 0;
    let current = -1;
    let recording = false;
    let saves = 0;
    tickProbe.onTick = (ms) => {
      if (recording && current >= 0 && counts[current]! < capacity) samples[current]![counts[current]!++] = ms;
    };
    const roomList: WorldRoom[] = [];
    const bots: Bot[][] = [];
    const joinedAt: number[][] = [];
    const worldKeys = new WeakMap<Bot, string>();
    const serial = { n: 0 };

    for (let i = 0; i < rooms; i++) {
      const room = (await colyseus.createRoom(ROOM_WORLD, { seed: o.seed + i, region, token: randomUUID(), name: `Soak ${i}` })) as unknown as WorldRoom;
      if (!isRegionId(room.state.region)) throw new Error("the soak room did not come up");
      const clock = (room as unknown as { clock: { tick: () => void } }).clock;
      const tick = clock.tick.bind(clock);
      clock.tick = () => {
        current = i;
        tick();
      };
      const patch = room.broadcastPatch.bind(room);
      room.broadcastPatch = () => {
        const t0 = performance.now();
        const r = patch();
        if (recording && patchN < patchMs.length) patchMs[patchN++] = performance.now() - t0;
        return r;
      };
      const saver = (room as unknown as { saver?: { saveNow: (...a: unknown[]) => unknown } }).saver;
      if (saver) {
        const save = saver.saveNow.bind(saver);
        saver.saveNow = (...a: unknown[]) => {
          if (recording) saves++;
          return save(...a);
        };
      }
      roomList.push(room);
      bots.push([]);
      joinedAt.push([]);
    }

    const spawnBot = async (i: number, k: number): Promise<Bot> => {
      const room = roomList[i]!;
      const behaviour = soakBehaviour({ region, index: k, fights, onSkirmish: () => bot?.room.send("debug", { cmd: "give:all" }) }, activity);
      let bot: Bot | undefined;
      bot = await Bot.joinById(url, room.roomId, `Soak ${i}.${k}`, behaviour);
      quiet(bot);
      syncBotWorld(bot, worldKeys, region, room.state.seed);
      live.push(bot);
      bots[i]![k] = bot;
      joinedAt[i]![k] = Date.now();
      return bot;
    };
    for (let i = 0; i < rooms; i++) for (let k = 0; k < botsPerRoom; k++) await spawnBot(i, k);

    // ---- setup that needs a player: the town at the crossing --------------------------------------------------------------------------------------------------------------
    if (town) {
      for (let i = 0; i < rooms; i++) {
        const before = (roomList[i] as unknown as { world: unknown }).world;
        bots[i]![0]!.room.send("debug", { cmd: "outpost:town" });
        for (let w = 0; w < 100 && (roomList[i] as unknown as { world: unknown }).world === before; w++) await sleep(50);
        if ((roomList[i] as unknown as { world: unknown }).world === before) throw new Error(`room ${i}: the outpost was not founded`);
      }
    }
    if (region === "kessar") {
      for (const room of roomList) {
        topUp(room, npcs, serial);
        // what the manifest would have brought: the horses and a harnessed wagon on the ring behind the landing (a Hollowmere room has its stable from the first tick)
        const mounts = (room as unknown as { mounts: { spawnHorse(at: { x: number; z: number; yaw: number }, o: { coat: number }): string; spawnWagon(at: { x: number; z: number; yaw: number }, o: { coat: number; crates: number; horse?: boolean }): string } }).mounts;
        const spots = regionMountSpots(region);
        for (const h of spots.horses) mounts.spawnHorse(h, { coat: hash3(room.state.seed, Math.round(h.x), 0x4c03) });
        mounts.spawnWagon(spots.wagon, { coat: hash3(room.state.seed, 7, 0x4c02), crates: 2, horse: true });
      }
    }
    for (let i = 0; i < rooms; i++) for (const b of bots[i]!) syncBotWorld(b, worldKeys, region, roomList[i]!.state.seed);
    for (const b of live) b.start();

    // ---- warm-up (JIT, nav build, caches), then the window ------------------------------------------------------------------------------------------------------------------
    const warmMs = Math.max(3000, (SERVER_BUDGET.warmupTicks * 1000) / TICK_RATE + 1500);
    const t0w = Date.now();
    while (Date.now() - t0w < warmMs) {
      if (region === "kessar") for (const room of roomList) topUp(room, npcs, serial);
      await sleep(250);
    }
    tickProbe.reset();
    wire.reset();
    wire.measure(true);
    const shots0 = metrics.shotsFired, hits0 = metrics.hitsLanded, saveFail0 = metrics.saveFailures;
    activity.shotsHeld = activity.mountedTicks = activity.walkedM = 0;
    dropPopLog(live);
    const heapStart = heapMB(gc);
    const startedAt = Date.now();
    recording = true;
    const heapSamples: [number, number][] = [];
    const heapEveryMs = Math.max(3000, (o.seconds * 1000) / 30);
    let nextHeap = Date.now() + heapEveryMs;
    let nextTop = 0;
    let nextSync = 0;
    let npcRowSum = 0, npcRowN = 0;
    const endAt = startedAt + o.seconds * 1000;
    while (Date.now() < endAt) {
      const now = Date.now();
      if (now >= nextHeap) {
        nextHeap = now + heapEveryMs;
        recording = false; // (the forced GCs are a deliberate pause; they are not a tick)
        dropPopLog(live);
        heapSamples.push([(Date.now() - startedAt) / 1000, heapMB(gc)]);
        recording = true;
      }
      if (now >= nextTop) {
        nextTop = now + 3000;
        for (const room of roomList) {
          if (region === "kessar") topUp(room, npcs, serial);
          let rows = 0;
          room.state.players.forEach((p) => p.npc && rows++);
          npcRowSum += rows;
          npcRowN++;
        }
      }
      if (now >= nextSync) {
        nextSync = now + 2000;
        for (let i = 0; i < rooms; i++) for (const b of bots[i]!) syncBotWorld(b, worldKeys, region, roomList[i]!.state.seed);
      }
      // one bot per room leaves and comes back (the seat, the slot, the save, the join's full state)
      for (let i = 0; i < rooms; i++) {
        const k = botsPerRoom - 1;
        const old = bots[i]![k]!;
        if (reconnectMs > 0 && now - joinedAt[i]![k]! >= reconnectMs && now + 4000 < endAt) {
          live.splice(live.indexOf(old), 1);
          finished.push(await old.stop());
          const fresh = await spawnBot(i, k);
          fresh.start();
          reconnects++;
        }
      }
      await sleep(100);
    }
    recording = false;
    wire.measure(false);
    dropPopLog(live);
    const heapEnd = heapMB(gc);
    const elapsedS = (Date.now() - startedAt) / 1000;
    heapSamples.push([elapsedS, heapEnd]);

    // ---- the report ---------------------------------------------------------------------------------------------------------------------------------------------------------
    const per = samples.map((s, i) => tickSummary(s, counts[i]!));
    const pooled = new Float64Array(counts.reduce((a, b) => a + b, 0));
    let at = 0;
    samples.forEach((s, i) => {
      pooled.set(s.subarray(0, counts[i]!), at);
      at += counts[i]!;
    });
    const sec: SoakReport["sections"] = {};
    for (const [name, s] of Object.entries(tickProbe.stats())) sec[name] = { avgMs: s.avgMs, p95Ms: s.p95Ms };
    const pw = Array.from(patchMs.subarray(0, patchN)).sort((a, b) => a - b);
    sec[SECTION_PATCH] = { avgMs: pw.length ? pw.reduce((a, b) => a + b, 0) / pw.length : 0, p95Ms: percentile(pw, 0.95) };

    for (const b of live) finished.push(await b.stop());
    live.length = 0;
    const clients = rooms * botsPerRoom;
    const mem = process.memoryUsage();
    const rep: Omit<SoakReport, "failures"> = {
      v: 1,
      scenario: o.scenario,
      node: process.version,
      rooms,
      botsPerRoom,
      npcRows: npcRowN ? Math.round(npcRowSum / npcRowN) : 0,
      durationS: Math.round(elapsedS * 10) / 10,
      tick: { rooms: per, all: tickSummary(pooled, pooled.length) },
      sections: sec,
      heap: { startMB: heapStart, endMB: heapEnd, growthMBPerHour: slopePerHour(heapSamples.filter(([t]) => t >= elapsedS / 2)), afterGc: gcReal },
      rssMB: mem.rss / MB,
      net: {
        downBytesPerClientPerS: wire.downBytes / clients / elapsedS,
        upBytesPerClientPerS: wire.upBytes / clients / elapsedS,
        messagesPerClientPerS: wire.downFrames / clients / elapsedS,
      },
      bots: { correctionMax: Math.max(0, ...finished.map((s) => s.correctionMax)), driftPeak: Math.max(0, ...finished.map((s) => s.driftPeak)) },
      activity: {
        shots: metrics.shotsFired - shots0, hits: metrics.hitsLanded - hits0, mountedS: activity.mountedTicks / TICK_RATE, walkedM: activity.walkedM, reconnects,
        saves,
      },
    };
    if (metrics.saveFailures > saveFail0) failures.push(`${metrics.saveFailures - saveFail0} campaign save(s) failed`);
    return { ...rep, failures: [...failures, ...judgeSoak(rep, undefined, Math.min(1000, Math.floor(o.seconds * TICK_RATE * 0.9)))] };
  } finally {
    tickProbe.onTick = prevOnTick;
    wire.uninstall();
    for (const b of live) await b.stop().catch(() => undefined);
    try {
      await colyseus?.cleanup();
    } catch {
      /* the rooms are going anyway */
    }
    try {
      await colyseus?.shutdown();
    } catch {
      /* ditto */
    }
    rmSync(dir, { recursive: true, force: true });
    configureLogger("info");
    running = false;
  }
}
