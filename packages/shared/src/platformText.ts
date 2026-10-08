import type { AchievementId, PresenceState } from "./platform.ts";
import { REGION_COPY } from "./regionCopy.ts";
import { DEMO } from "./demo.ts";
import { hash3 } from "./rng.ts";

/**
 * Authored copy for the storefront seam and the bounded demo (D-036, package D; docs/AI_CONTENT_REGISTER.md). Presence lines are what a friend sees under the player's name; the
 * achievement titles are what the storefront's own table is configured with later; the demo notices are what the server tells a demo party (and what the client banner recognises).
 * Pools are fixed and chosen by `hash3`, so a presence string is a pure function of the state (no clock, no randomness). Invented institutions only; no join code ever appears in text.
 */

const REGION_NAME = { hollowmere: "Hollowmere Depot", kessar: "Kessar Reach", highmark: "Highmark", vesper: "Vesper Gorge", saltmarket: "Saltmarket Delta" } as const;

const MENU_LINES = [
  "Queueing at the Society's front desk",
  "Filling in Form 1 (Arrival, in triplicate)",
  "Being told the Society will see them shortly",
] as const;
const HQ_LINES = [
  "Day {day} at Hollowmere Depot, {party}, awaiting sailing orders",
  "Day {day}: {party} counting crates at the Depot and calling it planning",
  "Day {day}: {party} at the survey table, drawing borders over other people's fields",
] as const;
const SAILING_LINES = [
  "At sea, bound for {where}, day {day}, {party} and a ledger",
  "Day {day}: {party} crossing to {where} with the paperwork on the roof",
  "Day {day}: sailing for {where}, {party}, assuring each other it is a rescue",
] as const;
const REGION_LINES = {
  hollowmere: ["Day {day}: {party} improving Hollowmere, invoice to follow", "Day {day} in Hollowmere, {party}, civilising the neighbours"],
  kessar: ["Day {day}: {party} negotiating at Kessar Reach, loudly", "Day {day} at Kessar Reach, {party}, tolls disputed"],
  highmark: ["Day {day}: {party} at Highmark, waiting on a Chamberlain", "Day {day} at Highmark, {party}, in the order of precedence (last)"],
  vesper: REGION_COPY.vesper!.presence,   // D-037: the later regions author their own lines (<region>Text.ts)
  saltmarket: REGION_COPY.saltmarket!.presence,
} as const;
const PARTY = ["a lone surveyor", "a party of two", "a party of three", "a party of four"] as const;

const fill = (t: string, v: Record<string, string | number>): string => t.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? ""));
const pick = <T>(list: readonly T[], a: number, b: number, c: number): T => list[hash3(0x70e5, a, b, c) % list.length]!;

/** The rich-presence line for a player's state: <= 120 characters, plain text, deterministic, with nothing private in it (the join code is NOT part of it). */
export function presenceText(p: PresenceState): string {
  const party = Math.max(1, Math.min(4, Math.floor(Number.isFinite(p.party) ? p.party : 1)));
  const day = Math.max(0, Math.min(9999, Math.floor(Number.isFinite(p.day) ? p.day : 0)));
  const v = { day: day || 1, party: PARTY[party - 1]!, where: p.region && p.region in REGION_NAME ? REGION_NAME[p.region] : "the far shore" };
  let line: string;
  switch (p.where) {
    case "menu": line = pick(MENU_LINES, 1, 0, 0); break;
    case "hq": line = fill(pick(HQ_LINES, 2, day, party), v); break;
    case "sailing": line = fill(pick(SAILING_LINES, 3, day, party), v); break;
    default: line = fill(pick(p.region && p.region in REGION_LINES ? REGION_LINES[p.region] : REGION_LINES.hollowmere, 4, day, party), v);
  }
  return line.slice(0, 120);
}

/** The storefront table: a title and a one-line blurb for each id, in the Society's voice. */
export const ACHIEVEMENT_TEXT: Readonly<Record<AchievementId, { title: string; blurb: string }>> = {
  first_crossing: { title: "First Crossing", blurb: "Settle a contract. The Society regrets nothing and has filed it." },
  paid_in_full: { title: "Paid in Full", blurb: "Pay the Ward's toll to the last penny and be thanked for it." },
  bridge_down: { title: "Bridge Down", blurb: "Leave the crossing in a condition best described as historical." },
  rescued_quim: { title: "Home, Insured and Aggrieved", blurb: "Bring Mr. Quim back from the Orchard." },
  wagon_taken: { title: "Cargo Redistributed", blurb: "Take the Syndicate's wagon, and take the paperwork with it." },
  border_mediated: { title: "Joint Survey", blurb: "Settle Marker Stone No. 4 without anyone being shot at." },
  outpost_founded: { title: "A Flag and a Fence", blurb: "Raise a camp on land that had a perfectly good owner." },
  town_by_neglect: { title: "Town, By Neglect", blurb: "Let a camp grow into a town while you were looking elsewhere." },
  steam_launch: { title: "Launch Day", blurb: "Put a steam launch on the water. Somebody will be billed for the whistle." },
  all_powers_met: { title: "Calling Cards", blurb: "Be received by every local power at least once, and refused by most." },
  chair_settled: { title: "The Vacant Chair", blurb: "Settle who sits at Highmark, or who profits from nobody doing so." },
  four_at_once: { title: "Four at Once", blurb: "Have the Ward and all three local powers warm toward you on the same day." },
  honest_measure: { title: "An Honest Bushel", blurb: "End the Reapers' Strike with a measure both sides will sign. Neither will thank you." },
  miners_out: { title: "Eleven Out of the Ground", blurb: "Get the Lower Gallery's miners out, by shovel or by powder." },
  engine_blown: { title: "Unscheduled Maintenance", blurb: "Stop the Winding Engine with the Company's own keg." },
  claim_staked: { title: "Four Pegs and a Fee", blurb: "File a claim at the Assay House before the Syndicate does, by fair means or by pulling theirs." },
  cargo_landed: { title: "Nothing to Declare", blurb: "Land the Quiet Barge's cargo at the drop-house door." },
  lot_won: { title: "Hammer Price", blurb: "Hold the winning paddle at the Auction at High Water." },
  post_held: { title: "The Post Holds", blurb: "Keep the raiders' torches out of the Society's yard." },
  good_samaritan: { title: "Stopped for a Stranger", blurb: "Revive a wounded traveller by the road. The Society is investigating." },
  powder_salvaged: { title: "Salvage, Not Theft", blurb: "Throw the fizzing keg clear of an overturned powder wagon and keep the rest." },
  learned_society: { title: "By Appointment", blurb: "Meet a commission from one of the Society's learned bodies." },
  unscheduled_flight: { title: "Unscheduled Flight", blurb: "Send somebody twenty yards by powder, as measured by the Society's surveyor." },
  museum_piece: { title: "For the Museum", blurb: "Five limbs in one contract. The Museum of Comparative Anatomy will want a word." },
  umbrella_man: { title: "Closed, In Action", blurb: "Fell an enemy with an umbrella." },
};

// ---- the demo's notices (server -> party, over the existing `notice` message; the client banner recognises the warning) ----
const WARN_RE = /^The Society's demonstration licence expires in (\d{1,3}) minutes?\b/;
/** The warning the server sends at `minutes` left. */
export const demoWarnText = (minutes: number): string =>
  `The Society's demonstration licence expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}. ${minutes <= DEMO.warnAtMinutes[1] ? "Please conclude your civilising." : "Do finish whatever you are plundering."}`;
/** The minutes a warning notice announces, or undefined for any other text. */
export function parseDemoWarn(text: unknown): number | undefined {
  if (typeof text !== "string" || text.length > 200) return undefined;
  const m = WARN_RE.exec(text);
  return m ? Number(m[1]) : undefined;
}
export const DEMO_OVER_TEXT = "The demonstration licence has expired. The Society thanks you for your custom and your expedition's cooperation.";
export const DEMO_REFUSED_TEXT = "That destination is reserved for licensed members. The demonstration licence covers Hollowmere and Kessar Reach only.";
