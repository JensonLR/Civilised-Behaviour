import type { CampaignState, RegionId, ScenarioTemplateId } from "../campaignTypes.ts";
import { hash3 } from "../rng.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { borderTemplate } from "./border.ts";
import { convoyTemplate } from "./convoy.ts";
import { crossingTemplate, crossingSettled } from "./crossing.ts";
import { hostageTemplate } from "./hostage.ts";
import { successionTemplate } from "./succession.ts";
import type { AnyTemplate } from "./types.ts";

export * from "./types.ts";
export { crossingSettled, settledDaysLeft } from "./crossing.ts";

/** Every template, by id. The runner (server `Scenario`) is generic over this table. */
export const TEMPLATES: Readonly<Record<ScenarioTemplateId, AnyTemplate>> = {
  secure_crossing: crossingTemplate as unknown as AnyTemplate,
  hostage_rescue: hostageTemplate as unknown as AnyTemplate,
  convoy_ambush: convoyTemplate as unknown as AnyTemplate,
  border_incident: borderTemplate as unknown as AnyTemplate,
  succession_dispute: successionTemplate as unknown as AnyTemplate,   // D-036: Highmark's (a stub until package G)
};
export const TEMPLATE_IDS: readonly ScenarioTemplateId[] = ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident", "succession_dispute"];
/** D-036: the contracts each region offers (the ledger weights WITHIN a region's list; Kessar's four are unchanged, Highmark's family is one template for now). */
export const REGION_TEMPLATES: Readonly<Record<RegionId, readonly ScenarioTemplateId[]>> = {
  hollowmere: [],
  kessar: ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident"],
  highmark: ["succession_dispute"],
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
  if (region === "highmark") return "succession_dispute";   // D-036: one family so far; G may weight more templates here WITHOUT touching Kessar's weights (backcompat.test.ts hashes them)
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
    succession_dispute: 0,   // never offered at Kessar
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
