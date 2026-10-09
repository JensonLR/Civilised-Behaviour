import type { CampaignState, RegionId, ScenarioTemplateId } from "../campaignTypes.ts";
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
import { smugglingRunTemplate } from "./smugglingRun.ts";
import { successionTemplate } from "./succession.ts";
import type { AnyTemplate } from "./types.ts";

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
};
export const TEMPLATE_IDS: readonly ScenarioTemplateId[] = ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident", "succession_dispute", "mine_rescue", "claim_race", "smuggling_run", "flooded_market", "reapers_strike", "winding_engine", "outpost_raid", "lost_survey", "great_grey", "counting_house"];
/** D-036: the contracts each region offers (the ledger weights WITHIN a region's list; Kessar's four are unchanged). D-042: Highmark has two. */
export const REGION_TEMPLATES: Readonly<Record<RegionId, readonly ScenarioTemplateId[]>> = {
  hollowmere: [],
  kessar: ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident", "outpost_raid", "counting_house"],   // D-045: the raid only while one is due; D-095: the siege only while the Syndicate keeps a post
  highmark: ["succession_dispute", "reapers_strike", "great_grey"],
  vesper: ["mine_rescue", "claim_race", "winding_engine"],   // D-037; D-044 the engine
  saltmarket: ["smuggling_run", "flooded_market", "lost_survey"],
};
export const isTemplateId = (v: unknown): v is ScenarioTemplateId => typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);

/** What the map room shows as the region's note: the offered contract. */
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
    mine_rescue: 0, claim_race: 0, smuggling_run: 0, flooded_market: 0, reapers_strike: 0, winding_engine: 0, lost_survey: 0, great_grey: 0,   // (D-037, D-042, D-093, D-094: nor are the later regions' contracts)
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
