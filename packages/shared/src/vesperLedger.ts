import type { CampaignState, ComplicationId, ScenarioTemplateId } from "./campaignTypes.ts";
import { hash3 } from "./rng.ts";
import type { RivalPresence } from "./worldTypes.ts";
import type { EndingNumbers, FavourExtra, VesperEnding, VesperTemplate } from "./regionEndings.ts";

/**
 * Vesper Gorge's ledger NUMBERS (D-037, package C3; docs/_notes/regions34.md section 3): one row per ending, in the shape every region's endings are declared in. The home power is the Low
 * Vesper Lamentation Guild (`choir`), whose pairs carry the story: the Reapers (labour: miners and mourners are the same families), the Ward, the Houses (who buy the ore) and the Syndicate (who
 * peg the claims). The Syndicate (`rival`) is the other party at the claim race. The mine's contracts leave the crossing, the toll and the bridge alone (`toll: "keep"`, no `need`).
 *
 * The Guild's reading of the Lower Gallery: a gallery dug out is a funeral lost (prosperity down, a little grievance); a blast is a funeral with extra attendees; a seal is a funeral that never has
 * to be held and can still be billed for; a consecration is the Guild's best day. The claim race: the Guild certifies whatever is registered, so it prefers the fight that lasts longest.
 */

const NO_WARD = { trust: 0, fear: 0, grievance: 0, prosperity: 0, playerInfluence: 0, rivalInfluence: 0 };
const row = (e: Omit<EndingNumbers, "rule"> & { rule: { ward?: Partial<typeof NO_WARD>; lies?: number; rivalProsperity?: number; rivalGrievance?: number } }): EndingNumbers => ({
  ...e,
  rule: { control: undefined, toll: "keep", ward: { ...NO_WARD, ...e.rule.ward }, lies: e.rule.lies ?? 0, rivalProsperity: e.rule.rivalProsperity ?? 0, rivalGrievance: e.rule.rivalGrievance ?? 0 },
});

export const VESPER_ENDINGS: Record<VesperEnding, EndingNumbers> = {
  // ---- the Lower Gallery ------------------------------------------------------------------------------------------------------------
  dug_out: row({
    rule: { ward: { prosperity: 1, playerInfluence: 2 } },
    memory: { gratitude: 14, resentment: 0, contempt: 0 },
    relations: { "ward|choir": 3, "reapers|choir": 4, "rival|choir": -3, "brine|choir": -2 },
    grudge: 0,
    minors: { brine: { prosperity: 2 }, reapers: { trust: 6, grievance: -3, playerInfluence: 3 }, choir: { prosperity: -6, trust: -3, grievance: 4 } },
    news: { a: "choir" },
  }),
  blasted_through: row({
    rule: { ward: { fear: 1, playerInfluence: 1 } },
    memory: { gratitude: 4, resentment: 8, contempt: 10 },
    relations: { "ward|choir": -3, "reapers|choir": -3, "rival|choir": 2, "brine|choir": 4 },
    grudge: 0,
    minors: { brine: { trust: 3, prosperity: 4 }, reapers: { trust: -4, grievance: 6, fear: 3 }, choir: { prosperity: 5, trust: -2, grievance: 2 } },
    news: { a: "choir" },
  }),
  sealed: row({
    rule: { ward: { playerInfluence: -1, prosperity: 1 }, rivalProsperity: 1 },
    memory: { gratitude: 0, resentment: 6, contempt: 22 },
    relations: { "ward|choir": -5, "reapers|choir": -5, "rival|choir": 4, "brine|choir": 2 },
    grudge: 2,
    minors: { brine: { prosperity: -2, trust: -2 }, reapers: { trust: -6, grievance: 8 }, choir: { prosperity: 8, trust: -2, grievance: 2 } },
    news: { a: "choir" },
  }),
  consecrated: row({
    rule: { ward: { grievance: 1 } },
    memory: { gratitude: 2, resentment: 0, contempt: 14 },
    relations: { "ward|choir": 4, "reapers|choir": -2, "rival|choir": -2, "brine|choir": -1 },
    grudge: 0,
    minors: { brine: { trust: 1 }, reapers: { trust: -3, grievance: 3 }, choir: { prosperity: 12, trust: 4, playerInfluence: -2 } },
    news: { a: "choir" },
  }),
  // ---- the Claim Race -----------------------------------------------------------------------------------------------------------------
  staked: row({
    rule: { ward: { playerInfluence: 3, rivalInfluence: -2 }, rivalProsperity: -4, rivalGrievance: 8 },
    memory: { gratitude: 6, resentment: 0, contempt: 2 },
    relations: { "rival|choir": -4, "ward|choir": 2, "reapers|choir": 1, "brine|choir": 2 },
    grudge: 10,
    minors: { brine: { prosperity: 3, trust: 2 }, reapers: { playerInfluence: 2 }, choir: { trust: 2, playerInfluence: 2 } },
    news: { a: "rival", b: "choir" },
  }),
  jumped: row({
    rule: { ward: { playerInfluence: 1, rivalInfluence: -3 }, lies: 1, rivalProsperity: -6, rivalGrievance: 12 },
    memory: { gratitude: 0, resentment: 14, contempt: 8 },
    relations: { "rival|choir": -8, "ward|choir": -3, "reapers|choir": -2, "ward|rival": -4 },
    grudge: 14,
    minors: { brine: { trust: -3, grievance: 3 }, reapers: { trust: -1 }, choir: { trust: -4, grievance: 3, rivalInfluence: -2 } },
    news: { a: "rival", b: "choir" },
  }),
  partnered: row({
    rule: { ward: { playerInfluence: 2 }, rivalProsperity: 2, rivalGrievance: -2 },
    memory: { gratitude: 10, resentment: 2, contempt: 0 },
    relations: { "rival|choir": 4, "ward|choir": 1, "brine|choir": 3, "rival|brine": 3 },
    grudge: 3,
    minors: { brine: { trust: 3, prosperity: 2 }, reapers: { playerInfluence: 1 }, choir: { prosperity: 6, trust: 5 } },
    news: { a: "rival", b: "choir" },
  }),
  outpaced: row({
    rule: { ward: { rivalInfluence: 3, playerInfluence: -2 }, rivalProsperity: 6, rivalGrievance: -4 },
    memory: { gratitude: 0, resentment: 4, contempt: 18 },
    relations: { "rival|choir": 6, "ward|choir": -2, "reapers|choir": -1, "ward|rival": 3 },
    grudge: -8,
    minors: { brine: { rivalInfluence: 5, trust: -1 }, reapers: { trust: -1 }, choir: { prosperity: 3, trust: -2, rivalInfluence: 4 } },
    news: { a: "rival", b: "choir" },
  }),
};

/**
 * Resolutions that satisfy a minor power's pledged favour beyond the ones authored in powersText `HOOKS`: the Guild's "respectable season of mourning" is pleased by anything that ends in a funeral or
 * a seal (a sealed gallery, a gallery blasted through with some loss, a consecration).
 */
export const VESPER_FAVOUR: FavourExtra = { choir: ["sealed", "blasted_through", "consecrated"] };

/**
 * Which of Vesper's two contracts the campaign offers next (called by `pickTemplate(c, "vesper", seed, presence)`; pure and deterministic; never the same template twice running while both are eligible).
 * The first visit is the Lower Gallery (the Guild's home contract: the contract test founds a dev start on it) unless the Syndicate both has influence enough to be pegging the gorge (>= 50) AND has
 * surveyors in it (`presence.surveyors`): then the Claim Race. After that the other one is offered, because the campaign has only the two, weighted anyway by the ledger so the rule survives a third contract: a seal or a consecration last time makes the
 * Guild's own business likelier, a Syndicate that filed first (`outpaced`) makes the grudge match likelier. Ties break by hash3(seed, day).
 */
export function pickVesperContract(c: CampaignState, seed: number, presence?: RivalPresence): ScenarioTemplateId {
  type Id = "mine_rescue" | "claim_race";
  const ids: readonly Id[] = ["mine_rescue", "claim_race"];
  const mine = c.history.filter((h) => h.region === "vesper");
  const last = mine.length > 0 ? mine[mine.length - 1]!.template : undefined;
  const w: Record<Id, number> = {
    mine_rescue: 3 + (c.sites.ends.claim_race === "outpaced" ? 0 : 1),
    claim_race: 3 + (c.factions.ward.rivalInfluence >= 50 ? 3 : 0) + (presence !== undefined && presence.surveyors > 0 ? 4 : 0) + (c.sites.ends.claim_race === "outpaced" ? 2 : 0) + (c.sites.ends.mine_rescue === "sealed" || c.sites.ends.mine_rescue === "consecrated" ? 0 : 1),
  };
  if (last === undefined) return c.factions.ward.rivalInfluence >= 50 && presence !== undefined && presence.surveyors > 0 ? "claim_race" : "mine_rescue";
  const pool = ids.filter((id) => id !== last);
  const choices: readonly Id[] = pool.length > 0 ? pool : ids;
  const total = choices.reduce((n, id) => n + w[id], 0);
  let roll = hash3(seed >>> 0, Math.max(0, Math.round(c.day)), 0x7e12) % total;
  for (const id of choices) {
    if (roll < w[id]) return id;
    roll -= w[id];
  }
  return choices[0]!;
}

/** The complications each of the region's templates may be dealt (existing `ComplicationId`s only; the chaos director spreads this into `COMPLICATION_POOL`). The rain and the fog move the Company's schedule; scouts and outriders move the Syndicate's. */
export const VESPER_COMPLICATIONS: Record<VesperTemplate, readonly ComplicationId[]> = {
  mine_rescue: ["rain", "fog"],
  claim_race: ["rival_scouts", "outriders"],
};
