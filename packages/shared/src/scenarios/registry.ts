import type { CampaignState, ParleyKind, RegionId, ScenarioTemplateId, ScenarioView } from "../campaignTypes.ts";
import { hash3 } from "../rng.ts";
import { pickHighmarkContract } from "../reapersLedger.ts";
import { pickSaltmarketContract } from "../saltmarketLedger.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { pickVesperContract } from "../vesperLedger.ts";
import { borderTemplate } from "./border.ts";
import { claimRaceTemplate } from "./claimRace.ts";
import { convoyTemplate } from "./convoy.ts";
import { crossingTemplate, crossingSettled } from "./crossing.ts";
import { floodedMarketTemplate } from "./floodedMarket.ts";
import { hostageTemplate } from "./hostage.ts";
import { mineRescueTemplate } from "./mineRescue.ts";
import { reapersStrikeTemplate } from "./reapersStrike.ts";
import { windingEngineTemplate } from "./windingEngine.ts";
import { outpostRaidTemplate } from "./outpostRaid.ts";
import { lostSurveyTemplate } from "./lostSurvey.ts";
import { greatGreyTemplate } from "./greatGrey.ts";
import { countingHouseTemplate } from "./countingHouse.ts";
import { triangulationTemplate } from "./triangulation.ts";
import { smugglingRunTemplate } from "./smugglingRun.ts";
import { successionTemplate } from "./succession.ts";
import { CARRY_KIND, type AnyTemplate } from "./types.ts";

export * from "./types.ts";
export { crossingSettled, settledDaysLeft } from "./crossing.ts";
export { BORDER } from "./border.ts";
export { HOSTAGE } from "./hostage.ts";
export { SMUGGLE } from "./smugglingRun.ts";
export { STRIKE } from "./reapersStrike.ts";
export { ENGINE } from "./windingEngine.ts";
export { RAID, RAID_SITES } from "./outpostRaid.ts";
export { LOST } from "./lostSurvey.ts";
export { HUNT } from "./greatGrey.ts";
export { SIEGE } from "./countingHouse.ts";
export { TRIG } from "./triangulation.ts";
export { CARRY_KIND, type CarryKind } from "./types.ts";

/** Every template, by id. The runner (server `Scenario`) is generic over this table. */
export const TEMPLATES: Readonly<Record<ScenarioTemplateId, AnyTemplate>> = {
  secure_crossing: crossingTemplate as unknown as AnyTemplate,
  hostage_rescue: hostageTemplate as unknown as AnyTemplate,
  convoy_ambush: convoyTemplate as unknown as AnyTemplate,
  border_incident: borderTemplate as unknown as AnyTemplate,
  succession_dispute: successionTemplate as unknown as AnyTemplate,   // D-036: Highmark's
  mine_rescue: mineRescueTemplate as unknown as AnyTemplate,   // D-037: Vesper Gorge's
  claim_race: claimRaceTemplate as unknown as AnyTemplate,
  smuggling_run: smugglingRunTemplate as unknown as AnyTemplate,   // D-037: the Saltmarket Delta's
  flooded_market: floodedMarketTemplate as unknown as AnyTemplate,
  reapers_strike: reapersStrikeTemplate as unknown as AnyTemplate,   // D-042: Highmark's second
  winding_engine: windingEngineTemplate as unknown as AnyTemplate,   // D-044: Vesper's third
  outpost_raid: outpostRaidTemplate as unknown as AnyTemplate,   // D-045: Kessar's fifth
  lost_survey: lostSurveyTemplate as unknown as AnyTemplate,   // D-093: the Saltmarket's third
  great_grey: greatGreyTemplate as unknown as AnyTemplate,   // D-094: Highmark's third
  counting_house: countingHouseTemplate as unknown as AnyTemplate,   // D-095: Kessar's sixth
  triangulation: triangulationTemplate as unknown as AnyTemplate,   // D-096: Vesper's fourth
};
export const TEMPLATE_IDS: readonly ScenarioTemplateId[] = ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident", "succession_dispute", "mine_rescue", "claim_race", "smuggling_run", "flooded_market", "reapers_strike", "winding_engine", "outpost_raid", "lost_survey", "great_grey", "counting_house", "triangulation"];
/** D-036: the contracts each region offers (the ledger weights WITHIN a region's list; Kessar's four are unchanged). D-042: Highmark has two. */
export const REGION_TEMPLATES: Readonly<Record<RegionId, readonly ScenarioTemplateId[]>> = {
  hollowmere: [],
  kessar: ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident", "outpost_raid", "counting_house"],   // D-045: the raid only while one is due; D-095: the siege only while the Syndicate keeps a post
  highmark: ["succession_dispute", "reapers_strike", "great_grey"],
  vesper: ["mine_rescue", "claim_race", "winding_engine", "triangulation"],   // D-037; D-044 the engine; D-096 the survey
  saltmarket: ["smuggling_run", "flooded_market", "lost_survey"],
};
export const isTemplateId = (v: unknown): v is ScenarioTemplateId => typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);

/** What the map room shows as the region's note: the offered contract. */
/** D-100: the words over a person you can talk to (a talk point's own `prompt` wins). One plain line per kind of talk. */
export const TALK_PROMPT: Readonly<Record<ParleyKind, string>> = {
  warden: "Talk to the Warden", ransom: "Talk to the deserters' sergeant", ward_post: "Talk to the Ward's sergeant", surveyor: "Talk to the Syndicate's surveyor",
  ford_post: "Talk to the corporal at the ford", chamberlain: "Talk to the Chamberlain", claimant_elder: "Talk to Princess Orla", claimant_younger: "Talk to Prince Dunstan",
  foreman: "Talk to the foreman", dirge_master: "Talk to the Dirge-Master", assayer: "Talk to the Assay clerk", tide_reeve: "Talk to the Tide-Reeve",
  auctioneer: "Talk to the Auctioneer", house_head: "Talk to the House-Head", reaper: "Talk to the Foreperson", steward: "Talk to the Steward",
  engineer: "Talk to the engineer", raid_captain: "Talk to the raiders' captain", dues_collector: "Talk to the Collector", lost_surveyor: "Talk to the surveyor",
  master_of_hunt: "Talk to the Master of the Hunt", menagerie_agent: "Talk to the menagerie agent", siege_factor: "Talk to the factor",
  needle_names: "Talk to the Dirge-Master", railway_surveyor: "Talk to the railway surveyor",
};

/** Where a contract point is, as the client sees the room: a standing NPC row's place by its template id (undefined when absent or down), and the contract's wagon. */
export interface UsePlaces {
  person(npc: string): { x: number; z: number } | undefined;
  wagon?: { x: number; z: number };
}
const NOBODY: UsePlaces = { person: () => undefined };

/**
 * D-100: what a press of Use does at one of the contract's own points, by the runner's rule (Scenario.onInteract): in the template's order, the first point whose
 * place (a fixed spot, its person standing, the wagon) is within its reach and whose `carry` matches your arms (`held`: the prop kind carried, undefined for
 * empty hands). The HUD's words and the point's place (a talk's two-shot frames the person). Undefined when nothing is in reach, a booked point (`until`) takes
 * no more, or the contract has resolved. The server still decides; this only says what it will be asked.
 */
export function contractUse(view: ScenarioView | undefined, x: number, z: number, held: number | undefined, places: UsePlaces = NOBODY): { prompt: string; x: number; z: number; talk: boolean } | undefined {
  if (view === undefined || view.resolution !== undefined) return undefined;
  for (const u of TEMPLATES[view.template]?.observe.use ?? []) {
    const at = u.npc !== undefined ? places.person(u.npc) : u.mount ? places.wagon : u.at;
    if (!at || Math.hypot(x - at.x, z - at.z) > u.r) continue;
    if (u.carry !== undefined && u.carry !== "none" ? held !== CARRY_KIND[u.carry] : u.carry === "none" && held !== undefined) continue;
    if (u.until !== undefined && view.objectives.some((o) => o.id === u.until && o.done)) continue;
    const prompt = u.prompt ?? (u.talk !== undefined ? TALK_PROMPT[u.talk] : undefined);
    if (prompt !== undefined) return { prompt, x: at.x, z: at.z, talk: u.talk !== undefined };
  }
  return undefined;
}

/** D-096: the words for a point that takes what is in your arms (`contractUse` with a prop held); undefined with empty hands. */
export function carryUsePrompt(view: ScenarioView | undefined, x: number, z: number, held: number | undefined, places: UsePlaces = NOBODY): string | undefined {
  return held === undefined ? undefined : contractUse(view, x, z, held, places)?.prompt;
}
export const templateNote = (id: ScenarioTemplateId): { title: string; brief: string } => ({ title: TEMPLATES[id].title, brief: TEMPLATES[id].brief });

/** How many recent expeditions a grudge, a weakness or a debt is remembered for when weighting the next contract. */
const RECENT = 4;

/**
 * Which contract the campaign offers next at `region`. Pure and deterministic. The first visit is the crossing. After that the ledger weights the
 * other three: deserters multiply after a broken garrison (`forced`) or an `abandoned` run, the Syndicate runs wagons once it has influence (>= 50, or it
 * just bought the crossing), a border incident needs two strong powers (ward strength >= 55, Syndicate influence >= 35). The crossing is offered again
 * only while it is NOT settled (a paid crossing is on the books for SETTLED_DAYS) and the bridge still stands. Never the same template twice running when
 * another is eligible; weighted ties are broken by hash3(seed, day), so the same ledger always offers the same thing.
 */
export function pickTemplate(c: CampaignState, region: RegionId, seed: number, presence?: RivalPresence): ScenarioTemplateId | undefined {
  if (region === "highmark") return pickHighmarkContract(c);   // D-042: the chair first, then the two alternate (Kessar's weights untouched: backcompat.test.ts hashes them)
  if (region === "vesper") return pickVesperContract(c, seed, presence);   // D-037: C3 weights its two contracts from the ledger (never the same twice running when both are eligible)
  if (region === "saltmarket") return pickSaltmarketContract(c, seed, presence);   // D-037: D4 likewise
  if (region !== "kessar") return undefined;
  if (c.history.length === 0) return "secure_crossing";
  const recent = c.history.slice(-RECENT);
  const had = (r: string): boolean => recent.some((h) => h.resolution === r);
  const w = c.factions.ward;
  const weights: Record<ScenarioTemplateId, number> = {
    // a floor of 1 so there is always something to offer when the crossing is closed
    secure_crossing: crossingSettled(c) || c.crossing.bridge === "collapsed" ? 0 : 3,
    hostage_rescue: 1 + (had("forced") ? 4 : 0) + (had("abandoned") ? 3 : 0) + (w.militaryStrength <= 40 ? 2 : 0),
    convoy_ambush: 1 + (w.rivalInfluence >= 50 ? 4 : 0) + (had("rival_secured") ? 3 : 0) + (presence?.wagon ? 6 : 0),   // the Syndicate runs a wagon while it has goods to move
    border_incident: 1 + (w.militaryStrength >= 55 && w.rivalInfluence >= 35 ? 4 : 0) + (presence !== undefined && presence.postStage > 0 ? 3 : 0),
    // D-045: the raid is offered only while the Syndicate means to raid the party's post, and then above everything else (a weight of 0 otherwise keeps the hashed old weights byte-identical)
    outpost_raid: presence?.raidDue ? 12 : 0,
    // D-095: the siege only while the Syndicate keeps a post at Kessar (0 without a presence or a post, so the hashed old weights stay byte-identical), and not while its raid on
    // the party's own post is due: the post is defended before the Syndicate's is besieged
    counting_house: presence !== undefined && presence.postStage > 0 && !presence.raidDue ? 5 : 0,
    succession_dispute: 0,   // never offered at Kessar
    mine_rescue: 0, claim_race: 0, smuggling_run: 0, flooded_market: 0, reapers_strike: 0, winding_engine: 0, lost_survey: 0, great_grey: 0, triangulation: 0,   // (D-037, D-042, D-093, D-094, D-096: nor are the later regions' contracts)
  };
  const last = c.history[c.history.length - 1]!.template;
  const ids = TEMPLATE_IDS.filter((id) => weights[id] > 0);
  let pool = ids.filter((id) => id !== last);
  if (pool.length === 0) pool = ids;
  const total = pool.reduce((n, id) => n + weights[id], 0);
  let roll = hash3(seed >>> 0, Math.max(0, Math.round(c.day)), 0x7e11) % total;
  for (const id of pool) {
    if (roll < weights[id]) return id;
    roll -= weights[id];
  }
  return pool[0];
}
