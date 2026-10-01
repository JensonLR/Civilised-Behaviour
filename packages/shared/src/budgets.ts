import { TICK_RATE } from "./constants.ts";

/**
 * Performance budgets (D-036, package Q): ONE table for the server's tick, the wire and the client's crowd, read by the soak harness, the tests that enforce them and
 * docs/PERFORMANCE.md. A budget is a promise about a MEASURED configuration (below), not a hope: the numbers start as the targets the architect set from the measurements
 * already in PERFORMANCE.md, and package Q may TIGHTEN any of them to what it measures but may not loosen one without recording why in PERFORMANCE.md. Software-GL numbers are
 * floors and are never budgets: draw-call and triangle COUNTS are (they do not depend on the rasteriser).
 */
export const SERVER_BUDGET = {
  /** The configuration every number below is a promise about (per room): a town (Hollowmere's HQ, villagers on), a Kessar garrison and 12..24 NPC rows, 4 bots. */
  config: { botsPerRoom: 4, npcRows: [12, 24] as const },
  /** One tick of one room, in ms, measured over >= 2000 ticks after `warmupTicks` (the first ticks pay the physics engine's JIT and the nav build). */
  tickMs: 1000 / TICK_RATE,
  warmupTicks: 90,
  p50Ms: 3,
  p95Ms: 8,
  p99Ms: 12,
  /** Nothing after warm-up may exceed one whole tick period (an overrun is a skipped frame for four people). */
  maxMs: 1000 / TICK_RATE,
  /** Rooms sharing one Node process run their ticks on one thread: the SUM of the rooms' p95 must stay under this share of a tick, which is what `roomsPerProcess` divides by. */
  processShare: 0.6,
  /** Heap growth after a forced GC, per hour of soak, the least-squares trend of forced-GC samples over the second half of the run (the first half is warm-up and cache fill). */
  heapGrowthMBPerHour: 25,
  /** Bytes per second per client, steady state with 24 NPCs in view. Down = server to client (the state patches), up = client to server (input frames). */
  downBytesPerClientPerS: 12_000,
  upBytesPerClientPerS: 2_500,
  /**
   * The worst single prediction correction a bot may see, metres. Was a bare 1 inside `judgeSoak`; a rider's dismount is a deliberate 1.0 m server placement beside the horse (the
   * mount tests allow 1.5 for it), so a soak whose bots ride cannot meet 1.00. Walking, shooting and joining add nothing: the soak's own bots see ~0.00005 m of drift.
   */
  correctionMaxM: 1.5,
  /** Wall-clock slack multiplier for noisy hosts (shared CI): `CB_BUDGET_SLACK=2` doubles every time budget, never the memory or bandwidth ones. Default 1. */
  slackEnv: "CB_BUDGET_SLACK",
} as const;

/**
 * The client's mesh (draw call) budgets for the village crowd on stage, main pass, counted in Node by the existing test rigs (no GPU involved), with every level at its cap (`planLods`: head
 * counts, `maxVisible` and the triangle ceiling). Was ~93 / ~232 / ~317 before the merged LOD (D-036: levels 1 and 2 are ONE skinned draw each). `high` was set at 175 from a full-detail
 * person of 37 meshes; the rig pass that made the hand its own bone makes it 41 with ink (4 x 41 + 6 + 7 = 177), so `high` is 180 (docs/PERFORMANCE.md, "Merged crowd LOD"). low 33 and medium 93 are measured.
 */
export const CROWD_MESH_BUDGET = { low: 40, medium: 100, high: 180 } as const;

export interface SoakTick { samples: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; overruns: number }
export interface SoakReport {
  v: 1;
  scenario: string;
  node: string;
  rooms: number;
  botsPerRoom: number;
  npcRows: number;
  durationS: number;
  /** One entry per room (each room's own tick, the budget's unit) plus `all`: every sample pooled. Rooms in one process run on one thread, so `roomsPerProcess(all.p95Ms)` is the capacity claim. */
  tick: { rooms: SoakTick[]; all: SoakTick };
  /** Per tick section (inputs, mounts, npc, scenario, cast, ...): the average and the p95 across all rooms (the server's `tickProbe`). */
  sections: Record<string, { avgMs: number; p95Ms: number }>;
  heap: { startMB: number; endMB: number; growthMBPerHour: number; afterGc: boolean };
  rssMB: number;
  net: { downBytesPerClientPerS: number; upBytesPerClientPerS: number; messagesPerClientPerS: number };
  /**
   * What the bots saw of the server: `correctionMax` is the worst single POSITION correction in metres (a soak that desyncs is not a pass); `driftPeak` is the reconciler's own
   * drift meter in raw field units (a position error is metres, but a flag flip such as a mount or a crouch counts as its bit value, so a peak of 4 or 10 is a flag, not a desync).
   */
  bots: { correctionMax: number; driftPeak: number };
  /** What the harness's bots and rooms really did in the window (a soak that stood still would pass every budget): rounds fired and blows landed, seconds ridden, metres walked, reconnects, saves. */
  activity?: { shots: number; hits: number; mountedS: number; walkedM: number; reconnects: number; saves: number };
  /** Filled by `judgeSoak`. */
  failures: string[];
}

/** `slack` multiplies the TIME budgets only (default from the environment, 1). */
export function budgetSlack(env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): number {
  const v = Number(env[SERVER_BUDGET.slackEnv] ?? 1);
  return Number.isFinite(v) && v >= 1 && v <= 10 ? v : 1;
}

/** Nearest-rank percentile of an ascending array (q in 0..1). 0 for an empty one. */
export function percentile(sortedAsc: ArrayLike<number>, q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  return sortedAsc[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]!;
}

/**
 * The pure verdict: every broken budget as one readable line (empty = pass). Used by `scripts/soak.mjs` (exit code) and by the budget tests. `minSamples` is how many ticks a room
 * must have been measured for (default 1000, about 33 s: the percentiles of fewer are not a claim); a CI-sized run passes less and says so.
 */
export function judgeSoak(r: Omit<SoakReport, "failures">, slack = budgetSlack(), minSamples = 1000): string[] {
  const b = SERVER_BUDGET;
  const out: string[] = [];
  const check = (label: string, got: number, limit: number): void => {
    if (!(got <= limit)) out.push(`${label}: ${got.toFixed(2)} > ${limit.toFixed(2)}`);
  };
  r.tick.rooms.forEach((t, i) => {
    if (t.samples < minSamples) out.push(`room ${i}: only ${t.samples} ticks measured (need >= ${minSamples})`);
    check(`room ${i} tick p50 ms`, t.p50Ms, b.p50Ms * slack);
    check(`room ${i} tick p95 ms`, t.p95Ms, b.p95Ms * slack);
    check(`room ${i} tick p99 ms`, t.p99Ms, b.p99Ms * slack);
    check(`room ${i} tick max ms`, t.maxMs, b.maxMs * slack);
  });
  check("heap growth MB/h", r.heap.growthMBPerHour, b.heapGrowthMBPerHour);
  check("down bytes/client/s", r.net.downBytesPerClientPerS, b.downBytesPerClientPerS);
  check("up bytes/client/s", r.net.upBytesPerClientPerS, b.upBytesPerClientPerS);
  check("bot correction max m", r.bots.correctionMax, b.correctionMaxM);
  if (!r.heap.afterGc) out.push("heap was not measured after a forced GC");
  return out;
}

/** Rooms one Node process can host at the measured p95 (floor), by the share-of-a-tick rule. */
export function roomsPerProcess(p95Ms: number): number {
  return p95Ms > 0 ? Math.max(1, Math.floor((SERVER_BUDGET.tickMs * SERVER_BUDGET.processShare) / p95Ms)) : 1;
}
