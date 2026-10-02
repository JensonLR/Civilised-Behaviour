import type { CampaignState, ResolutionId, ScenarioOutcome } from "./campaignTypes.ts";
import { clamp } from "./math.ts";

/**
 * D-040, the Society's remittance. The playtest ran one modest expedition (a crate of rounds, a horse, two hands, the toll) and came home to a purse of £4: the
 * only money that ever came IN was loot from a handful of shady endings, so an honest campaign starved after two contracts. The Imperial Cartographic & Improvement
 * Society now pays for each contract that comes home, through its Committee for Remittances, and the Committee pays BY THE COLUMN-INCH: what it buys is a story it
 * can print. A triumph (the paper's word for anything loud and decisive) pays best, a story pays, an embarrassment pays a little, and an abandoned expedition gets a
 * condolence voucher. That is the satire's point and the economy's floor at once: the Society funds drama, not decency, and nobody is ever stuck at HQ with nothing.
 * Pure: a table over the resolutions (exhaustive, checked by the type) and one step the room's commit pipeline runs after `applyOutcome`.
 */

export type PressGrade = "triumph" | "story" | "embarrassment" | "condolence";

export const REMITTANCE: Readonly<Record<PressGrade, number>> = { triumph: 45, story: 30, embarrassment: 12, condolence: 5 };

export const PRESS_GRADE: Readonly<Record<ResolutionId, PressGrade>> = {
  // the crossing
  paid: "story", bargained: "story", bribed: "story", forced: "triumph", sabotaged: "triumph", rival_secured: "embarrassment", abandoned: "condolence",
  // the hostage, the convoy, the border
  ransomed: "story", rescued: "triumph", slipped_away: "story", hostage_lost: "embarrassment",
  seized: "triumph", tipped_off: "story", burned: "triumph", passed: "embarrassment",
  mediated: "story", sided_ward: "story", sided_syndicate: "story", provoked: "embarrassment", escalated: "embarrassment",
  // Highmark's chair
  backed_elder: "triumph", backed_younger: "triumph", regency: "story", usurped: "triumph", crown_sold: "embarrassment",
  // Vesper Gorge
  dug_out: "triumph", blasted_through: "triumph", sealed: "embarrassment", consecrated: "story",
  staked: "triumph", jumped: "triumph", partnered: "story", outpaced: "embarrassment",
  // the Saltmarket Delta
  landed: "story", impounded: "embarrassment", scuttled: "embarrassment", informed: "story",
  lot_won: "triumph", consortium: "story", shorted: "story", washed_out: "embarrassment",
  // Highmark's strike (D-042)
  honest_measure: "triumph", bought_back: "story", strike_broken: "embarrassment", barley_lost: "embarrassment",
  // Vesper's engine (D-044)
  engine_fouled: "story", engine_blown: "triumph", engine_bought: "story", vein_struck: "embarrassment",
  // Kessar's post (D-045)
  post_held: "triumph", post_burned: "embarrassment", protection_paid: "embarrassment",
};

const LINE: Readonly<Record<PressGrade, string>> = {
  triumph: "The Committee for Remittances pays £{n} for a triumph, by the column-inch.",
  story: "The Committee for Remittances pays £{n} for a story it can print.",
  embarrassment: "The Committee for Remittances pays £{n}, marked \"for the avoidance of further columns\".",
  condolence: "The Committee for Remittances sends a condolence voucher worth £{n}.",
};

export interface Remittance {
  c: CampaignState;
  paid: number;
  grade: PressGrade;
  line: string;
}

/** The Society's payment for a committed contract, credited to the purse (capped like every purse). Pure: a new campaign out, the input untouched. */
export function remit(c: CampaignState, o: Pick<ScenarioOutcome, "resolution">): Remittance {
  const grade = PRESS_GRADE[o.resolution] ?? "condolence";
  const paid = REMITTANCE[grade];
  const purse = Math.round(clamp(c.purse + paid, 0, 99999));
  return { c: { ...c, purse }, paid: purse - c.purse, grade, line: LINE[grade].replace("{n}", String(paid)) };
}
