import type { ResolutionId, ScenarioTemplateId } from "../campaignTypes.ts";

/**
 * D-086: PLAIN ORDERS. "The wording can be confusing in the objectives & what's actually allowed." Each contract's rules were spread over its objective lines, a
 * hint paragraph the HUD no longer shows, and the code; some lines contradicted the code (a near miss is a shot; the border is lost by the first one; paying the
 * Dirge-Master loses the miners). This is the one plain statement of every contract's terms, written from the reducers: how it is won, what settles it short of a
 * win, how it is lost, and what fighting does there. The pause sheet prints it in full; the orders card carries the one rule that matters while it still applies
 * (`ScenarioView.rule`, set by each template's view); the Society's commissions are dealt so that none asks for what the contract forbids. The tests hold the
 * words to the code (terms.test.ts).
 */

/** What an ending means for the party: the contract done, settled short of it (something gained, something given up), or lost. */
export type OutcomeKind = "won" | "partial" | "lost";

export const OUTCOME_KIND: Readonly<Record<ResolutionId, OutcomeKind>> = {
  paid: "won", bargained: "won", bribed: "won", forced: "won", sabotaged: "won", rival_secured: "lost", abandoned: "lost",
  ransomed: "won", rescued: "won", slipped_away: "won", hostage_lost: "lost",
  seized: "won", tipped_off: "won", burned: "won", passed: "lost",
  mediated: "won", sided_ward: "won", sided_syndicate: "won", provoked: "lost", escalated: "lost",
  backed_elder: "won", backed_younger: "won", regency: "won", usurped: "won", crown_sold: "partial",
  dug_out: "won", blasted_through: "won", sealed: "lost", consecrated: "lost",
  staked: "won", jumped: "won", partnered: "won", outpaced: "lost",
  landed: "won", impounded: "lost", scuttled: "partial", informed: "partial",
  lot_won: "won", consortium: "won", shorted: "partial", washed_out: "lost",
  honest_measure: "won", bought_back: "partial", strike_broken: "lost", barley_lost: "lost",
  engine_fouled: "won", engine_blown: "won", engine_bought: "won", vein_struck: "lost",
  post_held: "won", protection_paid: "partial", post_burned: "lost",
};

/** An ending's kind, from what was committed: the Crown sold for the party's cheque is a sale; the Crown sold because nobody settled anything is a loss. */
export function outcomeKind(o: { resolution: ResolutionId; loot?: number }): OutcomeKind {
  if (o.resolution === "crown_sold") return (o.loot ?? 0) > 0 ? "partial" : "lost";
  return OUTCOME_KIND[o.resolution] ?? "lost";
}

/** What fighting does in a contract: the job is a fight; it closes some ways to win; or it loses the contract outright. */
export type Fighting = "expected" | "costly" | "forbidden";

export interface ContractTerms {
  /** The ways to win, one plain line each. */
  win: readonly string[];
  /** What ends it short of a win (something gained, something given up). */
  partial: readonly string[];
  /** The ways to lose. */
  lose: readonly string[];
  fighting: Fighting;
  /** The rule that matters, one line, on the orders card while it still applies. "A shot" is any shot that hits or passes close: a miss counts. */
  rule: string;
}

const DOWN = "The whole party goes down";

export const TERMS: Readonly<Record<ScenarioTemplateId, ContractTerms>> = {
  secure_crossing: {
    win: ["Pay, haggle or bribe the Lamp-Warden to raise the bar", "Beat the garrison: drop six in ten of them, or send them running", "Blow the bridge: carry a powder barrel to the pier, then get clear"],
    partial: [],
    lose: ["The Syndicate buys the crossing first", DOWN],
    fighting: "costly",
    rule: "A shot at the Ward, even a miss, ends all talk with the Lamp-Warden. So does walking past her bar unpaid.",
  },
  hostage_rescue: {
    win: ["Pay the deserters' ransom", "Sneak him out: open the cage unseen and quietly, then walk him to the landing", "Fight for him: drop three of the four deserters, or send them running, and walk him to the landing"],
    partial: [],
    lose: ["Mr. Quim goes down", "The Syndicate buys him first", "You sail without him"],
    fighting: "costly",
    rule: "A shot near the camp, even a miss, ends paying and sneaking. Being seen ends sneaking.",
  },
  convoy_ambush: {
    win: ["Beat the guards, then search the wagon", "Blow a powder keg beside the wagon", "Tip off the Ward's ford post and let its pickets stop it"],
    partial: [],
    lose: ["The wagon reaches the ford", DOWN],
    fighting: "expected",
    rule: "The wagon's guards are fair game. The Ward's ford post is not: fire on it and the Ward will remember.",
  },
  border_incident: {
    win: ["Talk both banks into a joint survey, then stand at the Stone while the chains go out", "Learn the Syndicate's plan from its surveyor and tell the Ward post", "Take the Syndicate's envelope, then pull the Stone"],
    partial: [],
    lose: ["Anyone in the party fires a shot, even a miss", "Tempers boil over, or the clock runs out", DOWN],
    fighting: "forbidden",
    rule: "Hold your fire: one shot here, even a miss, starts the war and loses the contract.",
  },
  succession_dispute: {
    win: ["Crown an heir: file Form 11, pledge one heir, and feed two delegates a barrel of grain each; the court ratifies at the bell", "Or the same with both heirs signed to a regency", "Seize the chair: beat the court guard, then sit somebody in it"],
    partial: ["Sell it: take the Syndicate envoy's cheque and get Form 11 filed"],
    lose: ["Nothing is settled when the Syndicate's deadline comes", DOWN],
    fighting: "costly",
    rule: "A shot at the court, even a miss, ends every deal: then only taking the chair by force is left.",
  },
  mine_rescue: {
    win: ["Dig them out: carry three timber crates to the fall, then dig there by hand", "Blast through: carry a powder keg to the fall and stand clear (the blast may kill miners)"],
    partial: [],
    lose: ["The Company seals the gallery (stop its clock: pay the foreman, file a Variance Form, or get the Guild to object)", "The air runs out", "You pay the Dirge-Master's bill: that buries the miners"],
    fighting: "costly",
    rule: "A shot at the Company or the Guild, even a miss, ends all talk with them.",
  },
  claim_race: {
    win: ["Peg three corners and file at the Assay House, with none of the Syndicate's pegs standing", "Pull the Syndicate's pegs (once its surveyors are beaten, or its survey is marked provisional), then file", "File a joint claim with the Syndicate (a peg each at least)"],
    partial: [],
    lose: ["The Syndicate files first, or the Assay House closes", DOWN],
    fighting: "costly",
    rule: "A shot at the Syndicate's men, even a miss, ends any joint claim. Keep the clerk standing: nobody else can file.",
  },
  smuggling_run: {
    win: ["Land three crates at the drop-house in the west reeds without the Customs House catching you"],
    partial: ["Pull the barge's plug and sink the evidence", "Inform on your own barge to the Tide-Reeve for a finder's fee"],
    lose: ["A patrolman's challenge runs out (answer it with a stamped permit from the Tide-Reeve, or the plug)", "Slack water ends", DOWN],
    fighting: "costly",
    rule: "A shot near the Customs House, even a miss, raises the alarm: you can still land, but only through its men.",
  },
  flooded_market: {
    win: ["Hold the top cash bid when the hammer falls (or when every rival paddle is out)", "Pool a consortium: place a bid, then get two signatures"],
    partial: ["Win on a short bid (no cash behind it)"],
    lose: ["High water with no winning bid", "Any violence in the saleroom"],
    fighting: "forbidden",
    rule: "No violence in the saleroom: a shot at a House-Head or the Auctioneer, even a miss, stops the sale and loses it.",
  },
  reapers_strike: {
    win: ["An honest measure: carry the royal bushel from the granary scale to the Steward, then get the Steward and the Compact to sign"],
    partial: ["Pay the Compact's harvest bonus (they go back; nothing is reformed)"],
    lose: ["Two strike-breakers reach the barley while nobody is fighting them", "The rain reaches the barley", DOWN],
    fighting: "costly",
    rule: "The strike-breakers are fair game. A shot at the Compact or the Steward, even a miss, ends every deal.",
  },
  winding_engine: {
    win: ["Foul it: carry a crate to the feed hopper before the alarm (or after every terrace guard is down)", "Blow it: carry a powder keg to the boiler and stand clear", "Pay the engineer for an inspection"],
    partial: [],
    lose: ["The cross-cut reaches the vein", DOWN],
    fighting: "costly",
    rule: "A shot, even a miss, or a guard's whistle raises the alarm: then the hopper is guarded until every terrace guard is down.",
  },
  outpost_raid: {
    win: ["Drop seven in ten of the raiders, or send them running"],
    partial: ["Pay the captain for \"protection\""],
    lose: ["Two raiders stand in the yard together long enough to torch the stores", DOWN],
    fighting: "expected",
    rule: "Drop any raider who reaches the yard: two in it together set the stores alight.",
  },
};

/** The rule line for a view while it still matters (`open`), or nothing. */
export const ruleWhile = (id: ScenarioTemplateId, open: boolean): { rule?: string } => (open ? { rule: TERMS[id].rule } : {});
