import { herdAt, type HerdPlan } from "./highmark.ts";
import { hashFloat } from "./rng.ts";

/**
 * THE STAMPEDE (D-114), after the open-world games' animal stampedes (the idea; built here). Highmark's herds (92 grazers in four herds, scenery drawn from a pure function of
 * the seed and the world clock: `herdAt`) are no longer only scenery. A report near a herd (a shot, a blast) or burning grass beside it sets the whole herd running, away
 * from it, flat out, for up to 55 m, fanning as it goes; then it slows, stops and draws back together over a few seconds where it ended up. Whoever is in the way is ridden
 * down (D-111's trample), whoever's side he is on; the one who set it running is credited.
 *
 * Deterministic and pure, so it costs one short string of state: a run is (the herd, when it started, the way it went, how far, where the herd stood before), and every
 * client and the server compute every animal's place and pace from it and the clock. The server decides the runs and the tramples (systems/Stampedes.ts); the client draws
 * them (render/world/highmark/herds.ts).
 */
export const STAMPEDE = {
  /** A report within this many metres of a herd's middle (and within its own reach) sets it running; burning ground within `fireR`. */
  hearR: 45,
  fireR: 14,
  /** Flat out (m/s), and how long it takes to reach it and to pull up from it. */
  speed: 9,
  rampS: 0.7,
  /** How far a herd runs: as far as the way is open (water, walls, steep ground and the map's edge stop it), never further than `maxRun`; less open than `minRun`, it runs another way. */
  maxRun: 55,
  minRun: 12,
  /** A herd that has just stopped will not run again for this long. */
  restS: 8,
  /** How wide it fans (a share of the distance run, either side), and how long its animals take to draw back together after (seconds, a time constant). */
  spread: 0.32,
  regroupS: 3.5,
  /** Each animal runs at its own pace: this much either side of the herd's. */
  paceJitter: 0.12,
  /** The tramples: the chest this far ahead of an animal's middle, a man within `reach` of it (and `dy` up or down), one man once in `cooldownS` by any one herd. */
  ahead: 1.35,
  reach: 1.1,
  dy: 1.4,
  cooldownS: 1.5,
} as const;

/** A herd's latest run. (ox, oz) is where the herd stood before it, relative to its own drift; the run adds (fx, fz) * dist to that. */
export interface HerdRun {
  k: number;
  t0: number;
  fx: number;
  fz: number;
  dist: number;
  ox: number;
  oz: number;
}

/** How long a run of `dist` metres lasts (seconds). */
export function runDuration(dist: number): number {
  const V = STAMPEDE.speed;
  const R = STAMPEDE.rampS;
  return 2 * R + Math.max(0, (dist - V * R) / V);
}

/** How far along a run of `dist` metres the herd is `tau` seconds after it started, and how fast it is going (into `out`). */
export function runProfile(dist: number, tau: number, out: { s: number; v: number }): void {
  const V = STAMPEDE.speed;
  const R = STAMPEDE.rampS;
  const cruise = Math.max(0, (dist - V * R) / V);
  const T = 2 * R + cruise;
  if (!(tau > 0)) {
    out.s = 0;
    out.v = 0;
  } else if (tau < R) {
    out.s = (V * tau * tau) / (2 * R);
    out.v = (V * tau) / R;
  } else if (tau < R + cruise) {
    out.s = (V * R) / 2 + V * (tau - R);
    out.v = V;
  } else if (tau < T) {
    const left = T - tau;
    out.s = dist - (V * left * left) / (2 * R);
    out.v = (V * left) / R;
  } else {
    out.s = dist;
    out.v = 0;
  }
}

const prof = { s: 0, v: 0 };
const base = { x: 0, z: 0, yaw: 0 };

/**
 * Animal `i` of the plan at `worldSec`, with its herd's latest run (`runs[k]`, or none): its place, heading and pace (into `out`). Running, it goes the run's way at its own
 * pace and fans out to its own side; stopped, it is where the run left it, drawing back to the herd over `regroupS`. Allocation-free; false when `i` is out of range.
 */
export function herdAnimalAt(plan: HerdPlan, i: number, worldSec: number, runs: readonly (HerdRun | undefined)[], out: { x: number; z: number; yaw: number; speed: number }): boolean {
  if (!herdAt(plan, i, worldSec, base)) return false;
  out.x = base.x;
  out.z = base.z;
  out.yaw = base.yaw;
  out.speed = 0;
  // which herd it is in (the plan lists them in order)
  let k = 0;
  let first = 0;
  while (k < plan.herds.length && i >= first + plan.herds[k]!.n) first += plan.herds[k++]!.n;
  const run = runs[k];
  if (!run) return true;
  const j = i - first;
  const pace = 1 + (hashFloat(plan.seed, k, j, 0x5a1) * 2 - 1) * STAMPEDE.paceJitter;
  const side = (hashFloat(plan.seed, k, j, 0x5a2) * 2 - 1) * STAMPEDE.spread;
  const tau = worldSec - run.t0;
  runProfile(run.dist, tau * pace, prof);
  const T = runDuration(run.dist) / pace;
  // (stopped: its own share of the fan and the pace shrinks as the herd draws back together; the herd's own offset stays)
  const along = prof.s - run.dist;
  const fan = side * prof.s * 0.5;
  const settle = tau > T ? Math.exp(-(tau - T) / STAMPEDE.regroupS) : 1;
  const ax = run.ox + run.fx * (run.dist + along * settle) - run.fz * fan * settle;
  const az = run.oz + run.fz * (run.dist + along * settle) + run.fx * fan * settle;
  out.x = base.x + ax;
  out.z = base.z + az;
  if (prof.v > 0.5) {
    out.speed = prof.v * pace;
    // the way it runs, a little out to its own side
    out.yaw = Math.atan2(run.fz + run.fx * side * 0.5, run.fx - run.fz * side * 0.5);
  }
  return true;
}

/** The runs as the room state carries them: `k,t0,fx,fz,dist,ox,oz` per herd, `;` between. Rounded: the clients only draw them. */
export function encodeHerdRuns(runs: readonly (HerdRun | undefined)[]): string {
  const parts: string[] = [];
  for (const r of runs) {
    if (!r) continue;
    parts.push([r.k, r.t0.toFixed(2), r.fx.toFixed(4), r.fz.toFixed(4), r.dist.toFixed(2), r.ox.toFixed(2), r.oz.toFixed(2)].join(","));
  }
  return parts.join(";");
}

/** The runs back from the room state (indexed by herd; anything malformed is skipped, never thrown). */
export function decodeHerdRuns(s: unknown, herds: number): (HerdRun | undefined)[] {
  const out: (HerdRun | undefined)[] = new Array<HerdRun | undefined>(Math.max(0, herds)).fill(undefined);
  if (typeof s !== "string" || s.length === 0 || s.length > 2000) return out;
  for (const part of s.split(";")) {
    const v = part.split(",").map(Number);
    if (v.length !== 7 || !v.every(Number.isFinite)) continue;
    const [k, t0, fx, fz, dist, ox, oz] = v as [number, number, number, number, number, number, number];
    if (!Number.isInteger(k) || k < 0 || k >= herds || dist < 0 || dist > 500 || Math.abs(fx) > 1.01 || Math.abs(fz) > 1.01) continue;
    out[k] = { k, t0, fx, fz, dist, ox, oz };
  }
  return out;
}
