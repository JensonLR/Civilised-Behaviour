/**
 * THE PACING DIRECTOR (D-107), after the AI director of the big co-op shooters (the idea; built here). It does not spawn anybody: it measures how hard
 * the fight is pressing each member of the party (an INTENSITY, 0..100, that rises when they are hurt, shot at, knocked down or caught near a blast,
 * and drains once nothing has happened to them for a moment), and moves the run through four phases on the worst of them:
 *
 *   BUILD   the ordinary state. Somebody's intensity reaches `peakAt` -> PEAK.
 *   PEAK    the fight at its height, held `sustainS` seconds -> FADE.
 *   FADE    the enemy eases off until the worst intensity is down to `fadeTo` (or `fadeMaxS` has passed) -> RELAX.
 *   RELAX   a breather of `relaxS` seconds -> BUILD.
 *
 * The levers are systems that exist (server: `systems/Pacing.ts`):
 *  - ATTACK TOKENS (the Cast's limit on how many men may shoot at one target): two as before; three at a member who is coasting through a fight; one
 *    at a member who is overwhelmed, and one at everybody while the run FADEs or RELAXes. A man down (and the comrade reviving him) is never the
 *    target of a firing line: going down sends the run to PEAK and then FADE.
 *  - HUNTS: a party that has gone quiet (`dullS` with nobody above `dullAt`) in a run whose enemies are already roused is looked for: the nearest idle
 *    roused soldiers walk to where it is. A garrison never provoked is never sent.
 *  - INCIDENTS (D-052): a quiet run meets its incident sooner (from `incidentMinS`), and none starts while the run is at PEAK or FADE.
 *
 * Pure and deterministic: the server owns the state and feeds it facts from the rows; nothing here reads a clock or `Math.random`, and nothing allocates.
 */
export const PACE = { BUILD: 0, PEAK: 1, FADE: 2, RELAX: 3 } as const;
export type PacePhase = (typeof PACE)[keyof typeof PACE];

export const PACING = {
  /** Intensity added per point of health lost, on going down (to the top), per second per man holding a token on you, and for a blast within `blastR`. */
  hurtPerHp: 1.5,
  downed: 100,
  shotAtPerS: 6,
  blast: 25,
  blastR: 12,
  max: 100,
  /** After `quietS` seconds without a blow (being shot at does not count: a long exchange still drains), intensity drains `decayPerS` a second. */
  quietS: 3,
  decayPerS: 10,
  /** The phases. FADE ends at `fadeTo` or after `fadeMaxS`, whichever is first (a fight that never lets up still gets its breather). */
  peakAt: 70,
  sustainS: 4,
  fadeTo: 25,
  fadeMaxS: 20,
  relaxS: 30,
  /** The party is coasting when nobody's intensity has been over `dullAt` for `dullS` seconds of BUILD. */
  dullAt: 15,
  dullS: 25,
  /** Attack tokens per target: a member under `easyBelow` in BUILD draws one more shooter; one at or over `reliefAt` (or anybody in FADE/RELAX) draws one. */
  tokens: 2,
  easyBelow: 30,
  reliefAt: 85,
  /** Hunts: every `huntEveryS` of coasting, up to `huntMax` idle roused soldiers within `huntRange` are sent to look `huntScatter` metres round a member. */
  huntEveryS: 6,
  huntMax: 3,
  huntRange: 70,
  huntScatter: 4,
  /** A coasting run may meet its incident from this many seconds in (its dealt delay, 45..110 s, still applies otherwise). */
  incidentMinS: 30,
} as const;

/** One member's intensity and the seconds since the last blow. */
export interface PaceMeter {
  v: number;
  quiet: number;
}
export const newMeter = (): PaceMeter => ({ v: 0, quiet: 0 });

/**
 * One tick of a member's intensity: `blows` (a hurt, a fall, a blast: >= 0) add and restart the quiet; `pressure` (being shot at) adds without restarting it, so
 * the drain after `quietS` can outrun one shooter and not two. In place.
 */
export function meterStep(m: PaceMeter, blows: number, pressure: number, dt: number): void {
  if (!(dt > 0)) return;
  const b = Number.isFinite(blows) && blows > 0 ? blows : 0;
  const p = Number.isFinite(pressure) && pressure > 0 ? pressure : 0;
  if (b > 0.001) m.quiet = 0;
  else m.quiet += dt;
  const drain = m.quiet >= PACING.quietS ? PACING.decayPerS * dt : 0;
  m.v = Math.max(0, Math.min(PACING.max, m.v + b + p - drain));
}

/** The run's pacing: the phase, seconds in it, and seconds the party has been coasting. */
export interface PaceState {
  phase: PacePhase;
  t: number;
  dull: number;
  /** The worst member's intensity on the last step. */
  worst: number;
}
export const newPace = (): PaceState => ({ phase: PACE.BUILD, t: 0, dull: 0, worst: 0 });

/** One step of the phases on the worst member's intensity. In place. */
export function paceStep(s: PaceState, worst: number, dt: number): void {
  if (!(dt > 0)) return;
  s.worst = Number.isFinite(worst) ? Math.max(0, worst) : 0;
  s.t += dt;
  switch (s.phase) {
    case PACE.BUILD:
      if (s.worst >= PACING.peakAt) {
        enter(s, PACE.PEAK);
        return;
      }
      s.dull = s.worst < PACING.dullAt ? s.dull + dt : 0;
      return;
    case PACE.PEAK:
      if (s.t >= PACING.sustainS) enter(s, PACE.FADE);
      return;
    case PACE.FADE:
      if (s.worst <= PACING.fadeTo || s.t >= PACING.fadeMaxS) enter(s, PACE.RELAX);
      return;
    case PACE.RELAX:
      if (s.t >= PACING.relaxS) enter(s, PACE.BUILD);
      return;
  }
}

function enter(s: PaceState, phase: PacePhase): void {
  s.phase = phase;
  s.t = 0;
  s.dull = 0;
}

/** True while the party is coasting (BUILD, nobody pressed, for `dullS`): the time for a hunt or an early incident. */
export const coasting = (s: PaceState): boolean => s.phase === PACE.BUILD && s.dull >= PACING.dullS;

/** True while the run is at its height or easing off: no incident starts then. */
export const pressed = (s: PaceState): boolean => s.phase === PACE.PEAK || s.phase === PACE.FADE;

/** How many men may shoot at a member at once, from the run's phase and that member's own intensity. */
export function tokensFor(s: PaceState, v: number): number {
  if (s.phase === PACE.FADE || s.phase === PACE.RELAX || v >= PACING.reliefAt) return 1;
  if (s.phase === PACE.BUILD && v < PACING.easyBelow) return PACING.tokens + 1;
  return PACING.tokens;
}
