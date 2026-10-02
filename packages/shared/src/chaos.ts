import type { CampaignState, ComplicationId, ScenarioTemplateId } from "./campaignTypes.ts";
import { hash3 } from "./rng.ts";
import { REAPERS_COMPLICATIONS } from "./reapersLedger.ts";
import { SALTMARKET_COMPLICATIONS } from "./saltmarketLedger.ts";
import { VESPER_COMPLICATIONS } from "./vesperLedger.ts";
import type { RivalPresence } from "./worldTypes.ts";

/**
 * The chaos director (D-034). No spawner: a complication is ONE thing the template already knows how to handle (a timed event, a thinner fog, a
 * shorter deadline), dealt deterministically when the run starts and named in the view's hint. Weighted by compatibility, with a cooldown (the one
 * dealt last time is never dealt twice running) and nothing from `hash3` but the campaign seed and day.
 */

/** Each template's pool. Every entry is outdoors-compatible (all of Kessar is); "rain" is plain weather. */
export const COMPLICATION_POOL: Record<ScenarioTemplateId, readonly ComplicationId[]> = {
  secure_crossing: ["rival_scouts"],
  hostage_rescue: ["reinforcements", "rival_bid", "rain"],
  convoy_ambush: ["outriders", "ward_patrol", "rain"],
  border_incident: ["fog", "stray_shot", "reinforcements"],
  outpost_raid: ["reinforcements", "fog", "rain"],   // D-045: more raiders; a late launch; slow torches (scenarios/outpostRaid.ts)
  succession_dispute: ["rain", "fog", "outriders"],   // D-036: rain hurries the harvest bell, fog delays it, outriders shorten the Syndicate's patience (scenarios/succession.ts)
  ...VESPER_COMPLICATIONS, ...SALTMARKET_COMPLICATIONS, ...REAPERS_COMPLICATIONS,   // D-037: each region package declares the pools of its own two templates (existing ComplicationIds only)
};
/** Complications that need a Syndicate worth the name. */
const RIVAL_ONLY: ReadonlySet<ComplicationId> = new Set(["rival_scouts", "rival_bid"]);
const RIVAL_MIN = 30;
/** Weight of "nothing happens" against one of the pool: a quarter to a third of runs are quiet. */
const NONE_WEIGHT = 3, ENTRY_WEIGHT = 3;

/** The crossing's own rule, unchanged since slice 1: the Syndicate turns up early when it smells a precedent. */
const crossingScouts = (c: CampaignState): boolean => c.factions.ward.rivalInfluence >= 45 || hash3(c.seed, Math.max(0, Math.round(c.day)), 0x5c07) % 100 < 35;

const TEMPLATE_TAG: Record<ScenarioTemplateId, number> = { secure_crossing: 1, hostage_rescue: 2, convoy_ambush: 3, border_incident: 4, succession_dispute: 5, mine_rescue: 6, claim_race: 7, smuggling_run: 8, flooded_market: 9, reapers_strike: 10, winding_engine: 11, outpost_raid: 12 };

export function dealComplication(c: CampaignState, id: ScenarioTemplateId, seed: number, presence?: RivalPresence): ComplicationId {
  if (id === "secure_crossing") return crossingScouts(c) ? "rival_scouts" : "none";
  const rival = c.factions.ward.rivalInfluence;
  const day = Math.max(0, Math.round(c.day));
  const last = c.sites?.lastComplication ?? "none";
  // D-035: a Syndicate that is out for redress deals more trouble; one lying low, less; and it is "worth the name" whenever it is not hiding
  const rivalOk = rival >= RIVAL_MIN || (presence !== undefined && presence.goal !== "lie_low");
  const pool = COMPLICATION_POOL[id].filter((x) => x !== last && (!RIVAL_ONLY.has(x) || rivalOk));
  if (pool.length === 0) return "none";
  const none = presence === undefined ? NONE_WEIGHT : presence.goal === "sabotage_party" ? 1 : presence.goal === "lie_low" ? 5 : NONE_WEIGHT;
  const total = none + pool.length * ENTRY_WEIGHT;
  let roll = hash3(seed >>> 0, day, 0xc4a05, TEMPLATE_TAG[id]) % total;
  if (roll < none) return "none";
  roll -= none;
  return pool[Math.floor(roll / ENTRY_WEIGHT)]!;
}

/** The sentence the hint adds for a complication ("" for none). Authored, terse, a little sour. */
export const COMPLICATION_HINT: Record<ComplicationId, string> = {
  none: "",
  rival_scouts: "Syndicate scouts are about: they will be early.",
  rain: "It is going to rain: footsteps and fuses are both affected.",
  reinforcements: "More men are on their way, which the briefing described as 'a rumour with boots'.",
  rival_bid: "The Syndicate has bid for the prize: the deadline is shorter than the brief said.",
  outriders: "A Syndicate scout rides ahead of the wagon, and he will see you if you let him.",
  ward_patrol: "A Ward patrol is expected to cross the Cut. They write everything down.",
  fog: "Fog on the ford: nobody can see far, which is not the same as nobody being careful.",
  stray_shot: "Somebody, somewhere, will fire a shot they did not mean to. Both sides will mean it afterwards.",
};
