import type { CasualtyTally, ResolutionId, ScenarioFx } from "../campaignTypes.ts";
import { RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { clamp } from "../math.ts";
import { zeroTally } from "../scenario.ts";
import type { BaseState, Fx, Reduction } from "./types.ts";

/** Small helpers the template reducers share. Pure; nothing here keeps state. */

export { zeroTally };
const TALLY_KEYS = Object.keys(zeroTally()) as (keyof CasualtyTally)[];
const TALLY_CAP = 999;

export const int = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(clamp(v, lo, hi)) : d);
export const MAX_DT = 5;
export const dtOf = (e: { dt: number }): number => clamp(Number.isFinite(e.dt) ? e.dt : 0, 0, MAX_DT);

export const NOFX: Fx[] = [];
export const stay = <S>(s: S): Reduction<S> => ({ s, fx: NOFX });
export const say = (text: string): ScenarioFx => ({ k: "say", text });

/** Add a tally delta with the same clamps as the crossing's reducer. */
export function addTally(t: CasualtyTally, add: Partial<CasualtyTally> | undefined): CasualtyTally {
  const out = { ...t };
  const a = add ?? {};
  for (const k of TALLY_KEYS) out[k] = int(out[k] + int(a[k], 0, TALLY_CAP, 0), 0, TALLY_CAP);
  return out;
}
export const tallyEmpty = (t: CasualtyTally): boolean => TALLY_KEYS.every((k) => t[k] === 0);

/** The run ends: first resolution wins; the commit effect is always LAST so a host that stops at it has run everything else. */
export function resolveWith<S extends BaseState>(s: S, r: ResolutionId, patch: Partial<S>, fx: Fx[] = []): Reduction<S> {
  return { s: { ...s, ...patch, phase: "resolved", resolution: r, resolvedAt: s.t, parley: undefined }, fx: [...fx, { k: "commit" }] };
}

/** After the end only the clock moves (the linger). */
export function frozen<S extends BaseState>(s: S, e: { t: string; dt?: number }): Reduction<S> {
  return e.t === "tick" ? stay({ ...s, t: s.t + dtOf({ dt: e.dt ?? 0 }) }) : stay(s);
}

/** True once the post-resolution linger is over (the runner then despawns the cast). */
export const lingerDone = (s: BaseState): boolean => s.phase === "resolved" && s.resolution !== undefined && s.t - s.resolvedAt >= RESOLVED_LINGER_S;

/** Remaining seconds as the HUD's countdown (`endsAtWorldMs` 0 = none). */
export function timer(label: string, remain: number, now: number): { timerLabel: string; endsAtWorldMs: number } {
  return remain > 0 ? { timerLabel: label, endsAtWorldMs: Math.round(now + remain * 1000) } : { timerLabel: "", endsAtWorldMs: 0 };
}
