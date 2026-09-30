import type { CampaignState } from "./campaignTypes.ts";
import { POWERS, WARD, askingToll, stanceOf, wardMemory } from "./factions.ts";
import { fillTemplate } from "./negotiationText.ts";
import {
  BRIDGE_CASUAL, DATELINE_TAIL, FILLER, HEADLINES, LEDGER_TAIL, MASTHEADS, NOTICES, NOTICE_COND, PROMISES, RIVAL_TIERS, SCANDAL, SPIN_CIVIL, SPIN_DEAD,
  SPIN_LIMBS, SPIN_ROUTED, SPIN_WOUNDED, STANDFIRSTS, STORY_HEADS, WARD_SAYS,
  type HeadKey,
} from "./newspaperText.ts";
import { hash3 } from "./rng.ts";

/**
 * The Society's house paper, generated from the campaign ledger. Deterministic: the same campaign and world seed always print the same edition;
 * every choice is hash3(edition seed, tag, list length). The paper states the facts (toll, bridge, dead) and spins everything else.
 */

export interface Paper { masthead: string; edition: number; dateline: string; headline: string; standfirst: string; stories: { slug: string; head: string; body: string }[]; notices: string[] }

export const PAPER_LIMITS = { headline: 90, standfirst: 280, head: 60, body: 420, notice: 120, stories: 5, notices: 4 } as const;

const cap = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function generatePaper(c: CampaignState, worldSeed: number): Paper {
  const edition = c.expeditions + 1;
  const s = hash3(worldSeed, c.expeditions, c.day, 5);
  const pick = <T>(list: readonly T[], tag: number): T => list[hash3(s, tag, list.length) % list.length]!;

  const last = c.history.length ? c.history[c.history.length - 1]!.resolution : undefined;
  const key: HeadKey = last ?? "none";
  const t = c.tally;
  const dead = t.garrisonKilled + t.rivalKilled;
  const toll = last ? c.crossing.toll : askingToll(c);
  const vars = { toll, bridge: c.crossing.bridge, dead, routed: t.garrisonRouted, wounded: t.wounded, limbs: t.limbsLost, civ: t.civiliansHarmed, purse: c.purse, lies: c.lies };

  // The spin: one headline phrase about what happened to people, biggest first (deaths, then rout, limbs, wounds, bystanders).
  const tier = SPIN_DEAD.find((x) => dead <= x.upTo)!;
  let spin = "";
  if (last) {
    spin = dead > 0 ? pick(tier.lines, 10) : t.garrisonRouted > 0 ? pick(SPIN_ROUTED, 11) : t.limbsLost > 0 ? pick(SPIN_LIMBS, 12)
      : t.wounded > 0 ? pick(SPIN_WOUNDED, 13) : t.civiliansHarmed > 0 ? pick(SPIN_CIVIL, 14) : pick(SPIN_DEAD[0]!.lines, 10);
  }
  const f = (tpl: string): string => fillTemplate(tpl, { ...vars, spin: fillTemplate(spin, vars) }).replace(/\s+/g, " ").trim();

  const headline = cap(f(pick(HEADLINES[key], 1)), PAPER_LIMITS.headline);
  const standfirst = cap(f(pick(STANDFIRSTS[key], 2)), PAPER_LIMITS.standfirst);

  // Stories in priority order; the first five that apply are printed.
  const cands: { slug: string; head: string; body: string }[] = [];
  const story = (slug: string, heads: readonly string[], body: string, tag: number): void => {
    cands.push({ slug, head: cap(pick(heads, tag), PAPER_LIMITS.head), body: cap(f(body), PAPER_LIMITS.body) });
  };

  if (last) {
    story("ledger", STORY_HEADS.ledger,
      `Toll: £${toll}${toll === 0 ? " (waived)" : ""}. Bridge: ${c.crossing.bridge}. Fallen: ${dead}. Routed: ${t.garrisonRouted}. Purse: £${c.purse}. ${pick(BRIDGE_CASUAL[c.crossing.bridge], 20)} ${pick(LEDGER_TAIL, 21)}`, 22);
  } else {
    const p = POWERS[0]!;
    story("prospectus", STORY_HEADS.prospectus,
      `${p.blurb} The asking toll is £${toll}. The bridge is ${c.crossing.bridge}. ${WARD.leader.speaker} is said to appreciate ${WARD.likes[hash3(s, 23, 4) % WARD.likes.length]}.`, 24);
  }
  if (c.crossing.exposed) {
    story("scandal", STORY_HEADS.scandal, c.crossing.bribed ? pick(SCANDAL.pending, 25) : pick(SCANDAL.landed, 26), 27);
  }
  if (last && (dead + t.garrisonRouted + t.limbsLost + t.wounded + t.civiliansHarmed) > 0) {
    const parts: string[] = [];
    if (dead > 0) parts.push(pick(tier.lines, 30));
    if (t.garrisonRouted > 0) parts.push(pick(SPIN_ROUTED, 31));
    if (t.limbsLost > 0) parts.push(pick(SPIN_LIMBS, 32));
    if (t.wounded > 0) parts.push(pick(SPIN_WOUNDED, 33));
    if (t.civiliansHarmed > 0) parts.push(pick(SPIN_CIVIL, 34));
    story("casualty", STORY_HEADS.casualty, parts.join(" "), 35);
  }
  const stance = stanceOf(c.factions.ward);
  const mem = wardMemory(c);
  story("ward", STORY_HEADS.ward, `${WARD.leader.speaker} said: ${pick(WARD_SAYS[stance], 40)}${mem.repeat >= 2 ? " She added that she has begun to recognise the pattern." : ""}`, 41);
  const rtier = RIVAL_TIERS.find((x) => c.factions.ward.rivalInfluence <= x.upTo)!;
  story("rival", STORY_HEADS.rival, pick(rtier.lines, 42), 43);
  if (c.lies > 0) story("promise", STORY_HEADS.promise, pick(PROMISES, 44), 45);
  const other = POWERS.slice(1);
  if (hash3(s, 46, 2) % 2 === 0) {
    const p = pick(other, 47);
    cands.push({ slug: "colonies", head: cap(`Word From ${p.name}`, PAPER_LIMITS.head), body: cap(`${p.blurb} Motto: \"${p.motto}\"`, PAPER_LIMITS.body) });
  } else {
    story("filler", STORY_HEADS.filler, pick(FILLER, 48), 49);
  }

  // Notices: one conditional, then distinct picks stepping by an odd stride through the pool (the pool is a power of two, so strides never repeat).
  const notices: string[] = [];
  if (c.crossing.bridge === "collapsed") notices.push(NOTICE_COND.collapsed);
  else if (c.crossing.control === "rival") notices.push(NOTICE_COND.rival);
  else if (last && c.crossing.toll === 0 && c.crossing.control !== "contested") notices.push(NOTICE_COND.free);
  if (c.crossing.exposed) notices.push(NOTICE_COND.scandal);
  const start = hash3(s, 50, 0) % NOTICES.length, stride = 2 * (hash3(s, 51, 0) % 7) + 3;
  for (let i = 0; notices.length < PAPER_LIMITS.notices && i < 3; i++) notices.push(NOTICES[(start + i * stride) % NOTICES.length]!);

  return {
    masthead: MASTHEADS[hash3(worldSeed, 0, 0, 1) % MASTHEADS.length]!,
    edition,
    dateline: `Hollowmere Depot, Day ${c.day}. ${pick(DATELINE_TAIL, 60)}`,
    headline, standfirst,
    stories: cands.slice(0, PAPER_LIMITS.stories),
    notices: notices.slice(0, PAPER_LIMITS.notices).map((n) => cap(n, PAPER_LIMITS.notice)),
  };
}
