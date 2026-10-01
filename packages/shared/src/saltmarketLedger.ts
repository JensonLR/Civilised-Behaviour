import type { CampaignState, ComplicationId, ScenarioTemplateId } from "./campaignTypes.ts";
import { hash3 } from "./rng.ts";
import type { PowerId, RivalPresence } from "./worldTypes.ts";
import { neutralNumbers, type EndingNumbers, type FavourExtra, type MinorDelta, type SaltmarketEnding, type SaltmarketTemplate } from "./regionEndings.ts";

/**
 * The Saltmarket Delta's ledger NUMBERS (D-037, package D4; docs/_notes/regions34.md section 4): one row per ending. The home power is the Brine Houses (`brine`), a merchant oligarchy that decides
 * by auction and charges for weather; the Syndicate (`rival`) dumps cargo and sends factors to the Exchange; the Reapers (`reapers`) sell grain at the dock and are among the Houses' creditors; the Guild
 * (`choir`) buries what the Houses sink. The delta's contracts leave the crossing, the toll and the bridge alone (`toll: "keep"`, `control: undefined`, no `need`): the Ward hears of them late, in its memory.
 * The Houses move for EVERY ending; the story of each is carried by `rival|brine`, `ward|brine`, `brine|reapers` and `brine|choir`.
 */
const row = (a: PowerId, b: PowerId | undefined, o: Omit<EndingNumbers, "news" | "rule"> & { rule?: Partial<EndingNumbers["rule"]> }): EndingNumbers => {
  const base = neutralNumbers(a, b);
  return { ...base, ...o, rule: { ...base.rule, ...o.rule }, news: b === undefined ? { a } : { a, b } };
};
const none: MinorDelta = {};

export const SALTMARKET_ENDINGS: Record<SaltmarketEnding, EndingNumbers> = {
  // The Quiet Barge. The Houses are cheated of the duty (landed), flattered by a seizure (impounded), indifferent to a wreck that blocks their cove (scuttled), or paid-off informers' best friends (informed).
  landed: row("brine", "rival", {
    memory: { gratitude: 0, resentment: 3, contempt: 12 }, relations: { "rival|brine": -6, "ward|brine": -3, "brine|choir": -2 }, grudge: -2,
    minors: { brine: { trust: -6, grievance: 5, prosperity: -3, rivalInfluence: 4 }, reapers: none, choir: { prosperity: 2 } },
    rule: { rivalProsperity: 4 },
  }),
  impounded: row("brine", "ward", {
    memory: { gratitude: 0, resentment: 0, contempt: 7 }, relations: { "ward|brine": 4, "rival|brine": 3, "brine|reapers": 2 }, grudge: 4,
    minors: { brine: { trust: 3, grievance: -2, prosperity: 4, militaryStrength: 2 }, reapers: none, choir: none },
    rule: { rivalProsperity: -6, rivalGrievance: 5 },
  }),
  scuttled: row("brine", "choir", {
    memory: { gratitude: 0, resentment: 4, contempt: 9 }, relations: { "rival|brine": -3, "brine|choir": 4, "ward|brine": 1, "brine|reapers": -3 }, grudge: 6,
    minors: { brine: { trust: -2, grievance: 2, prosperity: -2, playerInfluence: 1 }, reapers: none, choir: { prosperity: 4 } },
    rule: { rivalProsperity: -4, rivalGrievance: 6 },
  }),
  informed: row("brine", "rival", {
    memory: { gratitude: 8, resentment: 0, contempt: 10 }, relations: { "rival|brine": -9, "ward|brine": 5, "brine|reapers": -2, "rival|choir": 3 }, grudge: 10,
    minors: { brine: { trust: 9, grievance: -4, playerInfluence: 5, prosperity: 3 }, reapers: none, choir: { trust: -2 } },
    rule: { rivalProsperity: -8, rivalGrievance: 8 },
  }),
  // The Auction at High Water. The Houses lose a lot (lot_won), share one (consortium), are shorted at their own sale (shorted) or are merely rained on (washed_out).
  lot_won: row("brine", "rival", {
    memory: { gratitude: 2, resentment: 3, contempt: 6 }, relations: { "ward|brine": -4, "rival|brine": -6, "brine|reapers": -3 }, grudge: 8,
    minors: { brine: { trust: -5, grievance: 8, prosperity: -6, playerInfluence: 4, militaryStrength: 2 }, reapers: none, choir: none },
    rule: { rivalProsperity: -6, rivalGrievance: 8 },
  }),
  consortium: row("brine", "reapers", {
    memory: { gratitude: 6, resentment: 0, contempt: 3 }, relations: { "brine|reapers": 4, "brine|choir": 3, "rival|brine": -3, "ward|brine": 2 }, grudge: 3,
    minors: { brine: { trust: 8, grievance: -3, prosperity: 7, playerInfluence: 6 }, reapers: { trust: 2 }, choir: none },
    rule: { rivalProsperity: 2, rivalGrievance: -2 },
  }),
  shorted: row("brine", "rival", {
    memory: { gratitude: 0, resentment: 6, contempt: 22 }, relations: { "rival|brine": 6, "brine|choir": -5, "ward|brine": -2, "brine|reapers": -4 }, grudge: 5,
    minors: { brine: { trust: -9, grievance: 12, fear: 4, prosperity: -5, playerInfluence: -3 }, reapers: none, choir: { prosperity: 3 } },
    rule: { rivalProsperity: -2, rivalGrievance: 6, lies: 1 },
  }),
  washed_out: row("brine", undefined, {
    memory: { gratitude: 0, resentment: 0, contempt: 14 }, relations: { "ward|brine": 3, "rival|brine": 4, "brine|reapers": 2, "brine|choir": -2 }, grudge: -3,
    minors: { brine: { trust: -1, grievance: 2, prosperity: 2 }, reapers: none, choir: none },
    rule: { rivalProsperity: 3 },
  }),
};

/** Resolutions that satisfy a minor power's pledged favour beyond the ones authored in powersText `HOOKS` (the Houses' "a Syndicate wagon, misplaced" is pleased by a scuttled barge, and by a barge informed upon). */
export const SALTMARKET_FAVOUR: FavourExtra = { brine: ["scuttled", "informed"] };

const HERE = (c: CampaignState): CampaignState["history"] => c.history.filter((h) => h.region === "saltmarket");

/**
 * Which of Saltmarket's two contracts the campaign offers next (called by `pickTemplate(c, "saltmarket", seed, presence)`; pure and deterministic; never the same template twice running while both are eligible).
 * The Quiet Barge is offered more while the Syndicate has goods to move (a wagon at large, or influence of 50 and up) and after a sale that went to the Houses; the Auction at High Water more once the party
 * has a name at the Exchange (the last barge was informed upon or landed) and while the Syndicate is out arming the Houses. Ties are broken by hash3(seed, day), so the same ledger always offers the same thing.
 * Kessar's weights are untouched (backcompat.test.ts hashes them).
 */
export function pickSaltmarketContract(c: CampaignState, seed: number, presence?: RivalPresence): ScenarioTemplateId {
  const here = HERE(c);
  const last = here.length ? here[here.length - 1]!.template : undefined;
  const run = c.factions.ward.rivalInfluence >= 50 || presence?.wagon === true;
  const ends = c.sites.ends;
  const weights = {
    smuggling_run: 3 + (run ? 3 : 0) + (ends.flooded_market === "washed_out" || ends.flooded_market === "shorted" ? 2 : 0),
    flooded_market: 3 + (presence?.goal === "arm_brine" ? 3 : 0) + (ends.smuggling_run === "informed" || ends.smuggling_run === "landed" ? 2 : 0) + (c.factions.ward.rivalInfluence <= 20 ? 1 : 0),
  } as const;
  type Id = SaltmarketTemplate;
  const both: readonly Id[] = ["smuggling_run", "flooded_market"];
  const ids = both.filter((id) => id !== last);
  const pool = ids.length > 0 ? ids : both;
  const total = pool.reduce((n, id) => n + weights[id], 0);
  let roll = hash3(seed >>> 0, Math.max(0, Math.round(c.day)), 0x5a1e) % total;
  for (const id of pool) {
    if (roll < weights[id]) return id;
    roll -= weights[id];
  }
  return pool[0]!;
}

/** The complications each of the region's templates may be dealt (existing `ComplicationId`s only; the chaos director spreads this into `COMPLICATION_POOL`). The barge: fog and rain narrow the patrol's sight, a Ward patrol adds a man; the sale: rain hurries the tide, fog slows it. */
export const SALTMARKET_COMPLICATIONS: Record<SaltmarketTemplate, readonly ComplicationId[]> = {
  smuggling_run: ["fog", "ward_patrol", "rain"],
  flooded_market: ["rain", "fog"],
};
