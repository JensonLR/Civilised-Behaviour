import type { CampaignState } from "./campaignTypes.ts";
import { stanceOf } from "./factions.ts";
import { ACHIEVEMENTS, type AchievementId } from "./platform.ts";
import { powerStance } from "./powers.ts";
import type { PowersState, SettlementsState } from "./worldTypes.ts";

/**
 * Which achievements the campaign has EARNED (D-036, package D). One pure table over the three saved sections (campaign ledger, powers, settlements): no clock, no randomness, no
 * state of its own, so the same campaign always answers the same and a resumed campaign re-earns nothing it should not (the storefront's own unlock is idempotent). The
 * client calls it when the campaign revision moves and hands each NEWLY earned id to `PlatformAdapter.unlock`; the server and the wire know nothing about it.
 * Titles and blurbs are authored in `platformText.ts`.
 */
type Rule = (c: CampaignState, p: PowersState, s: SettlementsState) => boolean;

const WARM = (st: ReturnType<typeof stanceOf>): boolean => st === "warm" || st === "allied";
const post = (s: SettlementsState) => Object.values(s.posts).find((x) => x && x.stage !== "none");

export const ACHIEVEMENT_RULES: Readonly<Record<AchievementId, Rule>> = {
  /** Any contract settled: the first ledger entry. */
  first_crossing: (c) => c.history.length > 0 || c.expeditions > 0,
  /** The Ward was paid, and the ending says so. */
  paid_in_full: (c) => c.history.some((h) => h.resolution === "paid"),
  bridge_down: (c) => c.crossing.bridge === "collapsed",
  rescued_quim: (c) => c.sites.hostage === "freed",
  wagon_taken: (c) => c.sites.convoy === "seized",
  border_mediated: (c) => c.sites.border === "mediated",
  /** A camp stands (a ruin and a half-built foundation do not count). */
  outpost_founded: (_c, _p, s) => post(s) !== undefined,
  /** A town that grew up while the party was busy elsewhere: ten days after its founding. */
  town_by_neglect: (c, _p, s) => Object.values(s.posts).some((x) => x !== undefined && x.stage === "town" && c.day - x.foundedDay >= 10),
  steam_launch: (_c, _p, s) => s.tech.launch,
  /** Every local power has granted an audience, and the Ward has been met across a crossing contract that was not simply abandoned. */
  all_powers_met: (c, p) =>
    c.history.some((h) => h.template === "secure_crossing" && h.resolution !== "abandoned") && p.minor.brine.lastAudienceDay > 0 && p.minor.reapers.lastAudienceDay > 0 && p.minor.choir.lastAudienceDay > 0,
  /** Highmark's chair has an occupant (any ending but the open question). Reads the ledger's `succession` value; a pre-D-036 save parses to "open". */
  chair_settled: (c) => c.sites.succession !== undefined && c.sites.succession !== "open",
  /** The Ward and all three minor powers are warm toward the Society at the same moment. */
  four_at_once: (c, p) => WARM(stanceOf(c.factions.ward)) && WARM(powerStance(p.minor.brine)) && WARM(powerStance(p.minor.reapers)) && WARM(powerStance(p.minor.choir)),
};

/** Ids the campaign has earned and `already` does not hold, in table order. Never throws on a hostile or partial state (an unreadable campaign earns nothing). */
export function evaluateAchievements(c: CampaignState, p: PowersState, s: SettlementsState, already: readonly AchievementId[] = []): AchievementId[] {
  const out: AchievementId[] = [];
  for (const id of ACHIEVEMENTS) {
    if (already.includes(id)) continue;
    try {
      if (ACHIEVEMENT_RULES[id](c, p, s)) out.push(id);
    } catch {
      // a malformed section earns nothing
    }
  }
  return out;
}
