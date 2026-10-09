import type { CampaignState, ObjectiveView, ResolutionId, ScenarioEffect, ScenarioFx, ScenarioOutcome, ScenarioView } from "../campaignTypes.ts";
import { KESSAR_ANCHORS, SETTLED_DAYS } from "../campaignTypes.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import { garrisonRoster } from "../garrison.ts";
import { RIVAL_ROUTE } from "../garrison.ts";
import type { RivalPresence } from "../worldTypes.ts";
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
  /** D-040, running the bar: how many of the party stand on the road north of it, and when the sentries shouted (-1 = never). */
  past: number; warnedAt: number;
}

type RunExtra = Pick<CrossingRun, "settledStart" | "detonated" | "daysLeft" | "past" | "warnedAt">;
const mirror = (core: ScenarioState, x: RunExtra): CrossingRun => ({
  phase: core.phase, t: core.t, resolution: core.resolution, resolvedAt: core.resolvedAt, parley: core.parley ? "warden" : undefined, core,
  settledStart: x.settledStart, detonated: x.detonated, daysLeft: x.daysLeft, past: x.past, warnedAt: x.warnedAt,
});

/**
 * D-040: the playtest walked straight past the bar and up the fort road, and nothing happened. The bar is the Ward's whole point: anyone on the road north of it
 * (`RUN_BAR`) before the crossing is settled is shouted at once, and given `graceS` to step back behind the bar; still there after that, or back again once
 * warned, and the horn sounds (the same `hostile` a shot at a sentry gives: the garrison fights, and breaking it is `forced`).
 */
export const RUN_BAR = { x: KESSAR_ANCHORS.tollBar.x, z: -16, r: 12, graceS: 5 } as const;

function init(c: CampaignState, asking: number, _seed?: number, presence?: RivalPresence): CrossingRun {
  const settled = crossingSettled(c);
  // a lapsed toll is the asking price again; a settled crossing starts RESOLVED with no resolution (nothing to win, nothing to commit)
  const base = lapsed(c) ? { ...c, crossing: { ...c.crossing, toll: 0 } } : c;
  let core = newScenario(base, asking, presence);
  if (settled && core.phase !== "resolved") core = { ...core, phase: "resolved", parley: false };
  return mirror(core, { settledStart: settled, detonated: false, daysLeft: settledDaysLeft(c), past: 0, warnedAt: -1 });
}

const LINE_FUSE_ON = "There is already a fuse burning. Two would be showing off.";
const SAY_ALERT = "The horn on the gatehouse sounds. The Ward would like a word, and it is not the gentle one.";
const SAY_GATE = "The toll bar swings up. A sentry salutes, unsure whom.";
const SAY_RIVAL = "A Dunmarrow-Vesk surveyor has left the Syndicate camp with a measuring chain and an entourage. They intend to buy the crossing.";
const SAY_FUSE = "The fuse is lit. Ten seconds, give or take the weather. Clear the deck.";
const SAY_RUN_WARN = "A sentry levels a pike down the fort road: \"The toll, if you please. Back behind the bar, or we shall have to be official about it.\"";

/** The road north of the bar may be walked only once the crossing is settled (or while it is already a fight or a fuse). */
const barOpen = (s: CrossingRun): boolean => s.core.phase === "resolved" || s.core.hostile || s.core.chargeArmed || s.settledStart;

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
      // the grace after the shout has run out with somebody still on the fort road: the horn
      if (r.s.past > 0 && r.s.warnedAt >= 0 && !barOpen(r.s) && r.s.core.t - r.s.warnedAt >= RUN_BAR.graceS) {
        const h = feed(r.s, { t: "hostile" }, r.fx);
        return h;
      }
      const core = r.s.core;
      // the fuse has burned out: the bridge goes (the runner explodes the pier and rebuilds the world)
      if (core.chargeArmed && core.fuse <= 0 && !r.s.detonated && core.phase !== "resolved") {
        const b = feed({ ...r.s, detonated: true }, { t: "bridge_fell", onBridge: 0 }, [...r.fx, { k: "explode", at: "pier" }, { k: "bridge", state: "collapsed" }, { k: "say", text: "The bridge leaves. The paper will call it a structural event." }]);
        return b;
      }
      return r;
    }
    case "near": {
      if (e.at === "bar") return feed(s, { t: "arrive", party: e.party });
      if (e.at !== "past") return { s, fx: [] };
      const party = Math.max(0, Math.floor(Number.isFinite(e.party) ? e.party : 0));
      const n: CrossingRun = { ...s, past: party };
      if (party === 0 || barOpen(n) || s.core.phase === "parley") return { s: n, fx: [] };
      // first time on the road: the shout and the grace; back on it after being told: the horn at once
      if (n.warnedAt < 0) return { s: { ...n, warnedAt: n.core.t }, fx: [{ k: "say", text: SAY_RUN_WARN }] };
      if (s.past === 0) return feed(n, { t: "hostile" });
      return { s: n, fx: [] };
    }
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
    v.hint = `The crossing is on the books for ${s.daysLeft} more day${s.daysLeft === 1 ? "" : "s"}: the bar is up and you cross free. Other business waits at the ford.`;
    const objectives: ObjectiveView[] = [{ id: "books", text: "Crossing settled: nothing left to win here", done: true }, { id: "home", text: "Take the boat home from the landing", done: false }];
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
  near: [{ id: "bar", x: KESSAR_ANCHORS.tollBar.x, z: KESSAR_ANCHORS.tollBar.z, r: SCENARIO.arriveRange }, { id: "past", x: RUN_BAR.x, z: RUN_BAR.z, r: RUN_BAR.r }],
  use: [
    { id: "warden", npc: "warden", r: SCENARIO.talkRange, talk: "warden", carry: "none" },
    { id: "pier", at: KESSAR_ANCHORS.pier, r: SCENARIO.pierRange, carry: "barrel", consume: true, prompt: "Light the charge" },
  ],
  count: [{ group: "ward", routed: "garrisonRouted" }],
  seen: [],
  actors: [],
  hostileGroups: ["ward", "rival"],
};

export const crossingTemplate: TemplateDef<CrossingRun> = {
  id: "secure_crossing", title: "Secure the River Crossing",
  brief: "The Ward owns the only bridge for forty miles, and its Lamp-Warden sets the toll. The Syndicate is coming to buy it. Pay, haggle, bribe, fight, or blow up the bridge.",
  init, reduce, view, outcome,
  roster: (c, seed, _s, presence): NpcSpec[] => {
    const ruined = c.crossing.bridge === "collapsed";
    return garrisonRoster(c, seed, presence).filter((sp) => !(ruined && sp.faction === "rival"));
  },
  leave, settled, observe,
  routes: { rival: RIVAL_ROUTE },
  opening: (s): ScenarioFx[] => (s.core.phase === "resolved" ? [{ k: "order", group: "ward", order: { o: "stand_down" } }, { k: "order", group: "rival", order: { o: "stand_down" } }] : []),
  sites: { pier: KESSAR_ANCHORS.pier, bar: KESSAR_ANCHORS.tollBar },
};
