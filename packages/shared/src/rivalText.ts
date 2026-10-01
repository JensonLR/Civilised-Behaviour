import type { RivalEventKind, RivalGoal, RivalSpot } from "./worldTypes.ts";

/**
 * Authored copy for the Dunmarrow-Vesk Syndicate as an agent (D-035). The Syndicate is a corporation that believes every border is a pricing error.
 * All fictional; scanned by noRealWorld.test.ts. Pending developer review (docs/AI_CONTENT_REGISTER.md).
 * Placeholders: {days} (days until the goal pays out, as the paper estimates it).
 */

export const GOAL_LABEL: Record<RivalGoal, string> = {
  buy_crossing: "buy the crossing",
  survey_route: "survey a route",
  arm_brine: "arm the Brine Houses",
  found_post: "found a trading post",
  sabotage_party: "settle a score",
  lie_low: "lie low and recount",
};

/** What the paper (and a rumour at the map table) says while a goal is under way: >= 3 each. */
export const GOAL_NEWS: Record<RivalGoal, { head: readonly string[]; body: readonly string[] }> = {
  buy_crossing: {
    head: ["Syndicate Said to Be Shopping for a Bridge", "Offer on the Crossing Rumoured", "Director Dunmarrow-Vesk Seen Measuring the Bridge"],
    body: ["A Syndicate offer for the Kessar crossing is understood to be in preparation, expected to land in about {days} days. The Ward has been told to expect an 'enhancement'.", "The Director has been observed pacing the span with a ledger. The Ward is advised that this is not an inspection, it is a valuation.", "The Syndicate is believed to be preparing a bid, to be presented in around {days} days. The Ward has put the kettle on."],
  },
  survey_route: {
    head: ["Syndicate Surveyors Take to the Road", "Chains and Theodolites at the Ford", "New Road Planned, Nobody Consulted"],
    body: ["Syndicate surveyors are walking the route between the camp and the ford, expected to finish in about {days} days. They are measuring the land the Syndicate describes as 'currently unoccupied'.", "A new road is being surveyed. It runs through three farms, one orchard and the Ward's opinion of itself. {days} days are expected.", "A survey party with a very long chain is working the road. They appear to be drawing the border before the border knows."],
  },
  arm_brine: {
    head: ["Syndicate Wagon Rumoured to Carry Arms for the Houses", "Rifles for the Tide: A Rumour", "The Syndicate Is Being Generous"],
    body: ["A wagon of arms for the Brine Houses is thought to be on the road, due in about {days} days. The Houses deny it, in writing, at a deposit.", "Crates marked 'agricultural equipment' have been seen to clink. They are headed for the coast, to arrive in about {days} days.", "The Syndicate is understood to be lending the Houses a few rifles, in the manner of a leash lending a dog."],
  },
  found_post: {
    head: ["Syndicate Plans a Post of Its Own", "Rival Flag Spotted South of the Bridge", "The Syndicate Would Like a Foothold"],
    body: ["The Syndicate is reported to be planning a trading post, about {days} days from opening. The Society is invited to consider whether it has the room.", "Stakes, string and a signboard have been seen in the scrub. The signboard reads 'Coming Soon', which, around here, is a threat.", "A rival post is rumoured. The land is described as 'adjacent'. The Society has found that everything is adjacent to something."],
  },
  sabotage_party: {
    head: ["Syndicate Said to Be Nursing a Grievance", "Warning: Syndicate Out for Redress", "Escort Doubled; Reasons Not Given"],
    body: ["Syndicate escorts have been doubled and seen cleaning their equipment with some feeling. Something is expected in about {days} days.", "The Syndicate has 'taken note of recent events' and 'will be responding proportionately', which in its dialect is a promise of disproportion.", "The Director has been heard to say 'enough'. It is considered a bad sign that it was said calmly."],
  },
  lie_low: {
    head: ["Syndicate Camp Quiet", "The Syndicate Is Counting Its Money", "Nothing From the Syndicate, Which Is Not the Same as Nothing"],
    body: ["The Syndicate camp is quiet. Accountants have been seen. It is expected to be back in business within about {days} days.", "The Syndicate is recounting, reorganising and re-forming a face. This usually takes about {days} days.", "A lull. The Society recommends using it, and not telling the Syndicate."],
  },
};

/** What happened when a goal paid out (>= 3 each). */
export const EVENT_NEWS: Record<RivalEventKind, { head: readonly string[]; body: readonly string[] }> = {
  goal_set: {
    head: ["Syndicate Announces a New Priority", "A New Initiative at the Syndicate", "The Syndicate Has Plans"],
    body: ["The Syndicate has reprioritised. The details are in a memo that has not been circulated, and therefore has been circulated.", "A fresh strategy is being rolled out at the camp. It involves a bigger flag.", "Whatever the Syndicate is doing next, it has stopped doing the last thing, which was already a mistake."],
  },
  bought_crossing: {
    head: ["Syndicate Acquires Kessar Crossing", "Bridge Changes Hands; Ward Unavailable for Comment", "Crossing Now Under New Management"],
    body: ["The Syndicate has bought the right to the crossing from a Ward it described as 'highly motivated to transition'. A new tariff board has been put up.", "A deal was done at the toll bar. The Warden signed under protest, in good handwriting, which is the strongest form of protest she has.", "The crossing is now a Syndicate asset. The Ward has been given a receipt, which is not what she asked for."],
  },
  posted_surveyors: {
    head: ["Syndicate Surveyors Complete Their Route", "Line Drawn on the Map; Land Under It Notified Later", "A Road That Was Not There Is Now Marked"],
    body: ["The survey is complete and a road exists on paper. The land beneath it has been told by letter.", "The Syndicate's chain has reached the ford. The ford has been informed that it is 'a feature'.", "Pegs are in the ground from the camp to the water. They are, in the Syndicate's phrase, 'not yet a claim'."],
  },
  armed_brine: {
    head: ["Houses Receive a Mysterious Crate of Rifles", "Arms Reach the Coast, Origin Undisclosed", "Brine Constabulary Newly, Mysteriously Equipped"],
    body: ["The Brine Houses have been seen with unfamiliar rifles. They describe them as 'inherited'. The stock is stamped Dunmarrow-Vesk.", "The Syndicate has armed the Houses against the Ward. The Houses have accepted on terms they will regret in the autumn.", "A delivery of arms was made at night. By morning it had become a tradition."],
  },
  founded_post: {
    head: ["Syndicate Opens Trading Post South of the Bridge", "Rival Flag Raised in the Scrub", "A Competitor Appears, With Bunting"],
    body: ["A Syndicate trading post is open. It sells the same goods as ours at slightly less than cost, which it regards as a loss leader and we regard as a declaration.", "A signboard, a hitching rail and a smile have been installed on the south bank. The smile is attached to a salesman.", "The Syndicate has a post. The Society is reminded that Competition Is Healthy, and is reviewing the definition."],
  },
  raided_outpost: {
    head: ["Society Outpost Subject to a 'Routine Inspection'", "Unscheduled Visit to Our Post", "Outpost Raided; Culprits 'Possibly Weather'"],
    body: ["Persons in Syndicate livery visited the outpost in the night and inspected it, roughly. The Society regrets that nobody was on hand to be inspected back.", "Stores are lighter. The signboard has been corrected. The Syndicate regrets the misunderstanding and has invoiced for the correction.", "A raid. The Syndicate says it was an audit. The outpost says it was a raid. The outpost is the one with the broken door."],
  },
  ambushed_party: {
    head: ["Syndicate Escorts Waylay Society Party", "Words, Then Shots, on the Road", "A Disagreement on the Road, Settled by Rifle"],
    body: ["The Syndicate has 'redressed' a grievance, in the road, with an escort. The party is reported to have held, in the manner of people who have had no choice.", "A skirmish in the scrub. Both sides call it the other side's fault, and have counted accordingly.", "The Syndicate has been 'proportionate'. We note the proportions."],
  },
  retreated: {
    head: ["Syndicate Withdraws to Regroup", "Camp Quiet; Accountants Busy", "The Syndicate Has Gone Away, Politely"],
    body: ["The Syndicate has retired to its camp and its books. It has not given up. It has simply moved the giving-up to a later quarter.", "The camp is quiet and the purse is fuller. This will not last.", "The Syndicate has stopped, which in a corporation is a pause between two enthusiasms."],
  },
  outbid: {
    head: ["Syndicate Plans Fall Through", "Syndicate Outbid, Outmanoeuvred or Out of Cash", "The Syndicate Blames the Weather"],
    body: ["A Syndicate initiative has failed to land. A spokesman said the plan had been 'a roaring success in every respect other than the result'.", "The Director has declared the matter a learning experience, and has asked for it to be re-learned by the Board.", "What was to be done has not been done. It will be done again, at a higher price."],
  },
};

export const SPOT_TEXT: Record<RivalSpot, string> = {
  camp: "at the camp", road: "on the road", ford: "at the ford", fort: "under the fort", outpost: "by our outpost", sea: "out on the water",
};
