import type { ScenarioOutcome } from "./campaignTypes.ts";
import { withFlag } from "./relations.ts";
import type { PowersState } from "./worldTypes.ts";

/**
 * D-045: what a finished Raid on the Post means beyond the ledger (WorldRoom.commitOutcome runs it before the rival's days). Whatever the ending, the Syndicate's raid on the post has been
 * MADE, here, so it does not land again between expeditions (`party_post_raided`, the flag its `sabotage_party` goal checks). A burned post, or a party that went down in its yard, takes the
 * raid now; a held one stands firmer; paid protection leaves the post as it was. Pure; any other contract passes through untouched.
 */
export function raidAftermath(p: PowersState, o: ScenarioOutcome): { p: PowersState; raid: boolean; defended: boolean } {
  if (o.scenario !== "outpost_raid") return { p, raid: false, defended: false };
  return { p: { ...p, flags: withFlag(p.flags, "party_post_raided") }, raid: o.resolution === "post_burned" || o.resolution === "abandoned", defended: o.resolution === "post_held" };
}
