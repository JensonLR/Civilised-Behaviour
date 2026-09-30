import type {
  CampaignState, CasualtyTally, ObjectiveView, ResolutionId, ScenarioEffect, ScenarioEvent, ScenarioOutcome, ScenarioPhase, ScenarioView,
} from "./campaignTypes.ts";
import { NPC_CAP, RIVAL_ARRIVES_S, RIVAL_PARLEY_S, RESOLVED_LINGER_S } from "./campaignTypes.ts";
import { garrisonSize } from "./garrison.ts";
import { clamp } from "./math.ts";
import { hash3 } from "./rng.ts";

/**
 * "Secure the river crossing": the scenario as a pure state machine. `reduceScenario` is the ONLY place phase logic lives; the server
 * (systems/Scenario.ts) feeds it events it observed and acts on the effects it returns. Clients never send events, they only see
 * `scenarioView`. The first resolution wins and the state is then frozen (except the clock, for the linger).
 *
 * Chaos director (small, deterministic in the campaign): the Syndicate may turn up early when it smells a precedent, and live weather
 * (`weather` input, read from weather.ts by the host) makes fuses sputter and sentries squint. Nothing random: Rng/hash3 only.
 */

export const SCENARIO = {
  arriveRange: 30,          // the party counts as "at the bar" inside this, metres from the toll bar
  talkRange: 2.2,           // INTERACT range to the Warden
  pierRange: 3.6,           // INTERACT range to the pier for lighting a charge
  fuseSeconds: 10,
  chargeRadius: 9,
  chargeAlarmRange: 12,     // sentries this close to a lit charge go hostile
  routFraction: 0.6,        // dead + routed share of the garrison that settles it
  wetRain: 0.45,            // rain at or above this wets the fuse and narrows the sentries' eyes
  wetFuseRate: 0.5,
  rivalEarlyBy: 120,        // a precedent-sniffing Syndicate arrives this many seconds sooner
  maxDt: 5,
} as const;

export type Complication = "none" | "rival_scouts";
/** The reducer accepts the frozen ScenarioEvent plus the host's weather reading. */
export type ScenarioInput = ScenarioEvent | { t: "weather"; rain: number };

export interface ScenarioState {
  phase: ScenarioPhase; t: number; partyNear: boolean; parley: boolean; chargeArmed: boolean; fuse: number; hostile: boolean;
  alive: number; routed: number; total: number;
  toll: number; paid: number; resolution?: ResolutionId; resolvedAt: number; tally: CasualtyTally; brokePromise: boolean; rivalAdvanced: boolean;
  /** Chaos director: when the Syndicate walks (seconds into the run), which complication was dealt, and the live rain (0..1). */
  rivalAt: number; complication: Complication; rain: number;
}

export const zeroTally = (): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 });
const TALLY_KEYS = Object.keys(zeroTally()) as (keyof CasualtyTally)[];
const TALLY_CAP = 999;

const int = (v: unknown, lo: number, hi: number, d = lo): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(clamp(v, lo, hi)) : d);

/**
 * A fresh run. `asking` is the toll the Warden will open at (A's `askingToll`, passed by the host so this file imports nothing of A's);
 * a standing toll in the campaign wins. A bridge that is already collapsed starts RESOLVED with no resolution: there is nothing left to
 * win, no outcome is produced, and nothing is committed a second time.
 */
export function newScenario(c: CampaignState, asking = 0): ScenarioState {
  const total = garrisonSize(c.factions.ward.militaryStrength);
  const day = int(c.day, 0, 1e6, 0);
  const scouts = c.factions.ward.rivalInfluence >= 45 || hash3(c.seed, day, 0x5c07) % 100 < 35;
  const dead = c.crossing.bridge === "collapsed";
  return {
    phase: dead ? "resolved" : "approach", t: 0, partyNear: false, parley: false, chargeArmed: false, fuse: 0, hostile: false,
    alive: total, routed: 0, total,
    toll: c.crossing.toll > 0 ? c.crossing.toll : int(asking, 0, 1000, 0), paid: 0, resolvedAt: 0, tally: zeroTally(), brokePromise: false, rivalAdvanced: false,
    rivalAt: RIVAL_ARRIVES_S - (scouts ? SCENARIO.rivalEarlyBy : 0), complication: scouts ? "rival_scouts" : "none", rain: 0,
  };
}

const RESOLVE_FX: Record<ResolutionId, readonly ScenarioEffect[]> = {
  paid: ["garrison_stand_down", "gate_open", "commit"],
  bargained: ["garrison_stand_down", "gate_open", "commit"],
  bribed: ["garrison_stand_down", "gate_open", "commit"],
  forced: ["garrison_stand_down", "gate_open", "commit"],
  sabotaged: ["garrison_stand_down", "commit"],
  rival_secured: ["garrison_stand_down", "commit"],
  abandoned: ["commit"],
};

const NOFX: ScenarioEffect[] = [];
const stay = (s: ScenarioState): { s: ScenarioState; fx: ScenarioEffect[] } => ({ s, fx: NOFX });

function resolve(s: ScenarioState, r: ResolutionId, patch: Partial<ScenarioState> = {}): { s: ScenarioState; fx: ScenarioEffect[] } {
  return {
    s: { ...s, ...patch, phase: "resolved", resolution: r, resolvedAt: s.t, parley: false, chargeArmed: false, fuse: 0 },
    fx: RESOLVE_FX[r].slice(),
  };
}

/** True while the fuse is burning (the rival waits, the forced-rout check waits, and the bridge will have the last word). */
const fuseBurning = (s: ScenarioState): boolean => s.chargeArmed;

export function reduceScenario(s: ScenarioState, e: ScenarioInput): { s: ScenarioState; fx: ScenarioEffect[] } {
  if (s.phase === "resolved") {
    // first resolution wins; the clock keeps running so the host can time the linger
    return e.t === "tick" ? stay({ ...s, t: s.t + clamp(Number.isFinite(e.dt) ? e.dt : 0, 0, SCENARIO.maxDt) }) : stay(s);
  }
  switch (e.t) {
    case "tick": {
      const dt = clamp(Number.isFinite(e.dt) ? e.dt : 0, 0, SCENARIO.maxDt);
      let n: ScenarioState = { ...s, t: s.t + dt };
      const fx: ScenarioEffect[] = [];
      if (n.chargeArmed) n.fuse = Math.max(0, n.fuse - dt * (n.rain >= SCENARIO.wetRain ? SCENARIO.wetFuseRate : 1));
      if (!n.rivalAdvanced && n.t >= n.rivalAt) {
        n = { ...n, rivalAdvanced: true };
        fx.push("rival_advance");
      }
      // the Syndicate buys the crossing while nobody is settling it (a firefight or a lit fuse holds them back)
      if (n.rivalAdvanced && n.t >= n.rivalAt + RIVAL_PARLEY_S && !fuseBurning(n) && !n.hostile) {
        const r = resolve(n, "rival_secured");
        return { s: r.s, fx: fx.concat(r.fx) };
      }
      return { s: n, fx };
    }
    case "weather":
      return stay({ ...s, rain: Number.isFinite(e.rain) ? clamp(e.rain, 0, 1) : 0 });
    case "arrive": {
      const near = typeof e.party === "number" && e.party > 0;
      return stay({ ...s, partyNear: near, phase: near && s.phase === "approach" ? "standoff" : s.phase });
    }
    case "parley_open":
      if ((s.phase !== "standoff" && s.phase !== "approach") || s.hostile || s.chargeArmed) return stay(s);
      return stay({ ...s, phase: "parley", parley: true, partyNear: true });
    case "parley_close":
      if (s.phase !== "parley") return stay(s);
      return stay({ ...s, phase: "standoff", parley: false });
    case "deal": {
      // only an open parley can be settled, and only into the three negotiated endings
      if (s.phase !== "parley" || (e.resolution !== "paid" && e.resolution !== "bargained" && e.resolution !== "bribed")) return stay(s);
      return resolve(s, e.resolution, { toll: int(e.toll, 0, 1000, s.toll), paid: int(e.paid, 0, 9999, 0) });
    }
    case "hostile": {
      if (s.hostile) return stay(s);
      return { s: { ...s, hostile: true, parley: false, phase: s.phase === "rigging" ? "rigging" : "fighting", brokePromise: s.brokePromise || s.phase === "parley" }, fx: ["garrison_alert"] };
    }
    case "garrison": {
      const total = int(e.total, 0, NPC_CAP, s.total);
      const alive = int(e.alive, 0, total);
      const routed = int(e.routed, 0, total - alive);
      const n = { ...s, total, alive, routed };
      // dead + routed at 60% settles it by force, but never while a fuse is burning: the bridge outranks the bar
      if (n.hostile && !fuseBurning(n) && total > 0 && total - alive >= Math.ceil(total * SCENARIO.routFraction)) return resolve(n, "forced");
      return stay(n);
    }
    case "charge_set":
      if (s.chargeArmed) return stay(s);
      return { s: { ...s, chargeArmed: true, fuse: SCENARIO.fuseSeconds, parley: false, phase: "rigging", brokePromise: s.brokePromise || s.phase === "parley" }, fx: ["arm_charge"] };
    case "bridge_fell":
      // only a charge that was actually lit can bring the bridge down; it beats any fight in progress
      return s.chargeArmed ? resolve(s, "sabotaged") : stay(s);
    case "party_down":
      return resolve(s, "abandoned");
    case "tally": {
      const tally = { ...s.tally };
      const add = e.add ?? {};
      for (const k of TALLY_KEYS) tally[k] = int(tally[k] + int(add[k], 0, TALLY_CAP, 0), 0, TALLY_CAP);
      return stay({ ...s, tally });
    }
    default:
      return stay(s);
  }
}

/** True once the post-resolution linger is over (the host despawns the cast). A pre-resolved (ruined) run never lingers out. */
export const lingerOver = (s: ScenarioState): boolean => s.phase === "resolved" && s.resolution !== undefined && s.t - s.resolvedAt >= RESOLVED_LINGER_S;

export function scenarioOutcome(s: ScenarioState): ScenarioOutcome | undefined {
  if (s.phase !== "resolved" || s.resolution === undefined) return undefined;
  return {
    scenario: "secure_crossing", resolution: s.resolution, toll: s.toll, paid: s.paid, bridge: s.resolution === "sabotaged" ? "collapsed" : "intact",
    tally: { ...s.tally }, brokePromise: s.brokePromise, seconds: Math.round(s.resolvedAt),
  };
}

// ---- what the HUD shows (authored) -------------------------------------------------------------------------------------------------------------

const HINT: Record<Exclude<ScenarioPhase, "resolved">, string> = {
  approach: "Follow the road north to the toll bar. The Ward owns the only bridge for forty miles and has opinions about it.",
  standoff: "The Lamp-Warden is at her bar. Talk to her, or consider the alternatives: a rifle, or a barrel from the powder cart south of the bridge.",
  parley: "The Warden is listening. Mind what you promise; she keeps receipts.",
  fighting: "The garrison is armed and offended. Put six in ten of them down or to flight and the bar is yours.",
  rigging: "The fuse is lit. Nobody should be standing on the bridge, least of all you.",
};
const DONE_HINT: Record<ResolutionId, string> = {
  paid: "Toll paid, receipt stamped. The bar lifts. Sail home from the landing when you are ready.",
  bargained: "Toll haggled down. The bar lifts, resentfully. Sail home from the landing.",
  bribed: "A quiet word and a quiet envelope. The bar lifts. The Syndicate will hear of it. Sail home from the landing.",
  forced: "The garrison is broken and the bar is yours. The Ward will remember. Sail home from the landing.",
  sabotaged: "The bridge is gone. Structurally, it was always a suggestion. Sail home from the landing.",
  rival_secured: "The Syndicate bought the crossing while you dithered. Sail home and read about it.",
  abandoned: "The expedition is down. The Ward is unmoved. Sail home and explain yourselves.",
};

export function scenarioView(s: ScenarioState, worldMsNow: number): ScenarioView {
  const res = s.resolution;
  const won = res !== undefined && res !== "abandoned" && res !== "rival_secured";
  const objectives: ObjectiveView[] = [
    { id: "reach", text: "Reach the Ward's toll bar", done: s.phase !== "approach" },
    {
      id: "secure",
      text: res === "rival_secured" ? "Lost: the Syndicate bought the crossing" : res === "abandoned" ? "Lost: the expedition went down" : "Secure the river crossing, by whatever means",
      done: won,
    },
  ];
  if (s.phase === "fighting" || (s.hostile && s.phase !== "resolved")) {
    const need = Math.ceil(s.total * SCENARIO.routFraction);
    objectives.push({ id: "rout", text: `Break the garrison (${Math.min(need, s.total - s.alive)} of ${need})`, done: res === "forced", optional: true });
  }
  if (s.phase === "rigging" || res === "sabotaged") {
    objectives.push({ id: "clear", text: "Clear the deck before the fuse burns", done: res === "sabotaged", optional: true });
  }
  if (s.phase === "resolved" && res !== undefined) objectives.push({ id: "home", text: "Sail home from the landing dock", done: false });

  const wet = s.rain >= SCENARIO.wetRain && s.phase !== "resolved";
  let hint = s.phase === "resolved" ? (res ? DONE_HINT[res] : "The bridge is a ruin already. The ford will do.") : HINT[s.phase];
  if (wet) hint += " It is raining: fuses sputter and sentries squint.";

  let timerLabel = "";
  let remain = 0;
  if (s.phase !== "resolved") {
    if (s.chargeArmed && s.fuse > 0) {
      timerLabel = "Fuse";
      remain = s.fuse / (wet ? SCENARIO.wetFuseRate : 1);
    } else if (!s.rivalAdvanced) {
      timerLabel = "Syndicate arrives";
      remain = s.rivalAt - s.t;
    } else {
      timerLabel = "Syndicate buys the crossing";
      remain = s.rivalAt + RIVAL_PARLEY_S - s.t;
    }
  }
  const v: ScenarioView = {
    phase: s.phase, objectives, hint, timerLabel: remain > 0 ? timerLabel : "", endsAtWorldMs: remain > 0 ? Math.round(worldMsNow + remain * 1000) : 0,
  };
  if (res !== undefined) v.resolution = res;
  return v;
}
