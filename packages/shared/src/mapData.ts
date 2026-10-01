import type { CampaignState, RegionId } from "./campaignTypes.ts";
import { REGION_IDS } from "./campaignTypes.ts";
import { REGIONS } from "./regions.ts";
import { techEffects } from "./settlement.ts";
import type { CampaignMapData, MapPowerPin, RivalSighting, SettlementsState, TechState } from "./worldTypes.ts";

/**
 * What the campaign map shows (D-035), as ONE pure description so the drawn chart (client CampaignMap.ts) is only a painter: every region (where you stand, the contract on offer, the
 * outpost and its stage, the Syndicate's post), the sea lanes with their sailing times (the steam launch halves them), the powers as pins (unmet ones read "?"), the rival's last
 * sighting with its age (and its goal only with intel), and the tech that has been latched. F's outputs (`pins`, `rival`) and O's (`s`, `tech`) arrive as contract types.
 */
export function campaignMapOf(
  _c: CampaignState, s: SettlementsState, rival: RivalSighting | undefined, pins: readonly MapPowerPin[], offered: { region?: RegionId; title: string; brief: string } | undefined,
  tech: TechState, here: RegionId = "hollowmere", rivalPosts = 0,
): CampaignMapData {
  const fx = techEffects(tech);
  const regions = REGION_IDS.map((id) => {
    const p = s.posts[id];
    const entry: CampaignMapData["regions"][number] = { id, name: REGIONS[id].name, here: id === here, rivalPost: id === "kessar" ? (Math.min(2, Math.max(0, rivalPosts)) as 0 | 1 | 2) : 0 };
    if (offered && (offered.region ?? "kessar") === id) entry.offered = { title: offered.title, brief: offered.brief };
    if (p && p.stage !== "none") entry.outpost = { stage: p.stage, name: p.name, priority: p.priority, supply: p.supply };
    return entry;
  });
  const lanes = REGION_IDS.filter((id) => id !== here).map((id) => ({ to: id, seconds: fx.sailSeconds ?? REGIONS[id].sailSeconds }));
  const out: CampaignMapData = { regions, pins: pins.map((p) => ({ ...p })), tech: { ...tech, since: { ...tech.since } }, lanes };
  if (rival) out.rival = { ...rival };
  return out;
}
