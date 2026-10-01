import type { CampaignState, ObjectiveView, ResolutionId, ScenarioEffect, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { KESSAR_ANCHORS, SETTLED_DAYS } from "../campaignTypes.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { garrisonRoster } from "../garrison.ts";
import { RIVAL_ROUTE } from "../garrison.ts";
import {
  SCENARIO, newScenario, reduceScenario, scenarioOutcome, scenarioView, type ScenarioInput, type ScenarioState,
} from "../scenario.ts";
import { tallyEmpty } from "./common.ts";
import type { BaseState, Fx, ObserveSpec, Reduction, TemplateDef } from "./types.ts";

/**
 * "Secure the river crossing" as a template (D-034). The slice-1 reducer (scenario.ts) is kept AS IS: this file wraps it. It translates the new, generic
 * observations (`near`, `count`, `use`, `leave`) into the events the reducer already understands, and its old string effects into `ScenarioFx` for the
 * generic runner. It adds the sections-7 rules: sailing away COMMITS (dismissed when nothing happened), and a crossing the Ward has just been paid for is SETTLED.
 */

/** Settling resolutions: after one of these the Ward's ledger is closed for SETTLED_DAYS campaign days. */
const SETTLING: ReadonlySet<ResolutionId> = new Set(["paid", "bargained", "bribed", "forced"]);

/** True while the crossing is on the books: the last crossing ended in a settling resolution fewer than SETTLED_DAYS campaign days ago. */
export function crossingSettled(c: CampaignState): boolean {
  for (let i = c.history.length - 1; i >= 0; i--) {
    const h = c.history[i]!;
    if (h.template !== "secure_crossing") continue;
    return SETTLING.has(h.resolution) && c.day - h.day < SETTLED_DAYS;
  }
  return false;
}
/** Days until the toll lapses and the crossing returns (0 when it is not settled). */
export function settledDaysLeft(c: CampaignState): number {
  if (!crossingSettled(c)) return 0;
  for (let i = c.history.length - 1; i >= 0; i--) if (c.history[i]!.template === "secure_crossing") return Math.max(0, SETTLED_DAYS - (c.day - c.history[i]!.day));
  return 0;
}
/** After the window the standing toll lapses back to the Ward's asking price. */
function lapsed(c: CampaignState): boolean {
  for (let i = c.history.length - 1; i >= 0; i--) {
    const h = c.history[i]!;
    if (h.template === "secure_crossing") return SETTLING.has(h.resolution) && c.day - h.day >= SETTLED_DAYS;
  }
  return false;
}

export interface CrossingRun extends BaseState {
  core: ScenarioState; settledStart: boolean; detonated: boolean; daysLeft: number; actor?: undefined;
}

const mirror = (core: ScenarioState, x: { settledStart: boolean; detonated: boolean; daysLeft: number }): CrossingRun => ({
  phase: core.phase, t: core.t, resolution: core.resolution, resolvedAt: core.resolvedAt, parley: core.parley ? "warden" : undefined, core,
  settledStart: x.settledStart, detonated: x.detonated, daysLeft: x.daysLeft,
});

function init(c: CampaignState, asking: number): CrossingRun {
  const settled = crossingSettled(c);
  // a lapsed toll is the asking price again; a settled crossing starts RESOLVED with no resolution (nothing to win, nothing to commit)
  const base = lapsed(c) ? { ...c, crossing: { ...c.crossing, toll: 0 } } : c;
  let core = newScenario(base, asking);
  if (settled && core.phase !== "resolved") core = { ...core, phase: "resolved", parley: false };
  return mirror(core, { settledStart: settled, detonated: false, daysLeft: settledDaysLeft(c) });
}

const LINE_FUSE_ON = "There is already a fuse burning. Two would be showing off.";
const SAY_ALERT = "The horn on the gatehouse sounds. The Ward would like a word, and it is not the gentle one.";
const SAY_GATE = "The toll bar swings up. A sentry salutes, unsure whom.";
const SAY_RIVAL = "A Dunmarrow-Vesk surveyor has left the Syndicate camp with a measuring chain and an entourage. They intend to buy the crossing.";
const SAY_FUSE = "The fuse is lit. Ten seconds, give or take the weather. Clear the deck.";

function mapFx(list: readonly ScenarioEffect[]): Fx[] {
  const out: ScenarioFx[] = [];
  for (const f of list) {
    switch (f) {
      case "garrison_alert": out.push({ k: "order", group: "ward", order: { o: "alert" } }, { k: "say", text: SAY_ALERT }); break;
      case "garrison_stand_down": out.push({ k: "order", group: "ward", order: { o: "stand_down" } }, { k: "order", group: "rival", order: { o: "stand_down" } }); break;
      case "gate_open": out.push({ k: "open", what: "gate" }, { k: "say", text: SAY_GATE }); break;
      case "rival_advance": out.push({ k: "order", group: "rival", order: { o: "march", route: "rival" } }, { k: "say", text: SAY_RIVAL }); break;
      case "arm_charge": out.push({ k: "say", text: SAY_FUSE }); break;
      case "commit": out.push({ k: "commit" }); break;
    }
  }
  return out;
}

function feed(s: CrossingRun, ev: ScenarioInput, extra: Fx[] = []): Reduction<CrossingRun> {
  const r = reduceScenario(s.core, ev);
  const next = r.s === s.core ? s : mirror(r.s, s);
  return { s: next, fx: [...extra, ...mapFx(r.fx)] };
}

function reduce(s: CrossingRun, e: ScenarioInput): Reduction<CrossingRun> {
  switch (e.t) {
    case "tick": {
      const r = feed(s, e);
      const core = r.s.core;
      // the fuse has burned out: the bridge goes (the runner explodes the pier and rebuilds the world)
      if (core.chargeArmed && core.fuse <= 0 && !r.s.detonated && core.phase !== "resolved") {
        const b = feed({ ...r.s, detonated: true }, { t: "bridge_fell", onBridge: 0 }, [...r.fx, { k: "explode", at: "pier" }, { k: "bridge", state: "collapsed" }, { k: "say", text: "The bridge leaves. The paper will call it a structural event." }]);
        return b;
      }
      return r;
    }
    case "near": return e.at === "bar" ? feed(s, { t: "arrive", party: e.party }) : { s, fx: [] };
    case "count": return e.group === "ward" ? feed(s, { t: "garrison", alive: e.alive, routed: e.routed, total: e.total }) : { s, fx: [] };
    case "hostile": {
      if (e.at === "rival") return { s, fx: [{ k: "order", group: "rival", order: { o: "alert" } }] };
      return feed(s, { t: "hostile" });
    }
    case "use": {
      if (e.target !== "pier") return { s, fx: [] };
      if (s.core.chargeArmed) return { s, fx: [{ k: "say", text: LINE_FUSE_ON }] };
      return feed(s, { t: "charge_set" });
    }
    case "leave": {
      const r = leave(s);
      if (r === undefined || s.core.phase === "resolved") return { s, fx: [] };
      // a lit fuse falls unwatched; anything else is abandoned, with the tally and the broken promises so far
      return r === "sabotaged" ? feed(s, { t: "bridge_fell", onBridge: 0 }) : feed(s, { t: "party_down" });
    }
    case "weather": case "arrive": case "parley_open": case "parley_close": case "deal": case "party_down": case "tally": case "garrison": case "charge_set": case "bridge_fell": {
      const notOpen = s.core.phase !== "parley";
      const r = feed(s, e);
      if (e.t === "parley_open") {
        if (r.s.core.phase === "parley" && notOpen) return { s: r.s, fx: [...r.fx, { k: "parley", kind: "warden", price: r.s.core.toll }] };
        const c = s.core;
        const why = c.chargeArmed ? "She will not negotiate with a lit fuse in the vicinity." : c.hostile ? "She is not taking audiences at the moment. She is taking cover." : "";
        return why ? { s, fx: [{ k: "say", text: why }] } : r;
      }
      return r;
    }
    default: return { s, fx: [] };
  }
}

function leave(s: CrossingRun): ResolutionId | undefined {
  const c = s.core;
  if (c.phase === "resolved") return c.resolution;
  if (c.phase === "approach" && tallyEmpty(c.tally) && !c.hostile && !c.chargeArmed) return undefined;
  return c.chargeArmed ? "sabotaged" : "abandoned";
}

function view(s: CrossingRun, now: number): ScenarioView {
  const v = scenarioView(s.core, now);
  if (s.settledStart && s.core.resolution === undefined) {
    v.hint = `The crossing is on the books: the Ward's ledger is closed for ${s.daysLeft} more day${s.daysLeft === 1 ? "" : "s"}. The bar is up, the lamps are lit, and nobody will take your money again. The ford will do for other business.`;
    const objectives: ObjectiveView[] = [{ id: "books", text: "The crossing is settled (nothing left to win here)", done: true }, { id: "home", text: "Sail home from the landing dock", done: false }];
    v.objectives = objectives;
  }
  return v;
}

function outcome(s: CrossingRun): ScenarioOutcome | undefined {
  const o = scenarioOutcome(s.core);
  if (!o) return undefined;
  o.complication = s.core.complication;
  return o;
}

const settled = (c: CampaignState): boolean => crossingSettled(c);

const observe: ObserveSpec = {
  near: [{ id: "bar", x: KESSAR_ANCHORS.tollBar.x, z: KESSAR_ANCHORS.tollBar.z, r: SCENARIO.arriveRange }],
  use: [
    { id: "warden", npc: "warden", r: SCENARIO.talkRange, talk: "warden", carry: "none" },
    { id: "pier", at: KESSAR_ANCHORS.pier, r: SCENARIO.pierRange, carry: "barrel", consume: true },
  ],
  count: [{ group: "ward", routed: "garrisonRouted" }],
  seen: [],
  actors: [],
  hostileGroups: ["ward", "rival"],
};

export const crossingTemplate: TemplateDef<CrossingRun> = {
  id: "secure_crossing", title: "Secure the River Crossing",
  brief: "The Ward owns the only bridge for forty miles and charges for the privilege. Cross it, by whatever means: pay, haggle, bribe, break the garrison, or drop the bridge in the river.",
  init, reduce, view, outcome,
  roster: (c, seed): NpcSpec[] => {
    const ruined = c.crossing.bridge === "collapsed";
    return garrisonRoster(c, seed).filter((sp) => !(ruined && sp.faction === "rival"));
  },
  leave, settled, observe,
  routes: { rival: RIVAL_ROUTE },
  opening: (s): ScenarioFx[] => (s.core.phase === "resolved" ? [{ k: "order", group: "ward", order: { o: "stand_down" } }, { k: "order", group: "rival", order: { o: "stand_down" } }] : []),
  sites: { pier: KESSAR_ANCHORS.pier, bar: KESSAR_ANCHORS.tollBar },
};
