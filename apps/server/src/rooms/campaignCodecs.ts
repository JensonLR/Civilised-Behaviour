import {
  newCampaign, newParty, newPowers, newSettlements, parseCampaign, parseParty, parsePowers, parseSettlements, serializeCampaign, serializeParty, serializePowers, serializeSettlements,
  type CampaignState, type PartyState, type PowersState, type SettlementsState,
} from "@cb/shared";
import type { AnyCodec } from "../persistence/sections.ts";

/**
 * The four saved sections (D-035): the campaign ledger, the hired hands and manifest, the powers, the settlements. Each is the module's own hostile-safe parser and serialiser;
 * a section that fails to parse is replaced by `fresh(seed)` and reported (one bad section never loses the campaign). Positions, props, NPCs, mounts and scenario progress are NOT saved:
 * a resumed campaign always starts at HQ.
 */
export const CAMPAIGN_CODECS: readonly AnyCodec[] = [
  { key: "campaign", version: 1, fresh: (seed: number) => newCampaign(seed), parse: (j: string) => parseCampaign(j), serialize: (v: CampaignState) => serializeCampaign(v) },
  { key: "party", version: 1, fresh: () => newParty(), parse: (j: string) => parseParty(j), serialize: (v: PartyState) => serializeParty(v) },
  { key: "powers", version: 1, fresh: (seed: number) => newPowers(seed), parse: (j: string) => parsePowers(j), serialize: (v: PowersState) => serializePowers(v) },
  { key: "settlements", version: 1, fresh: () => newSettlements(), parse: (j: string) => parseSettlements(j), serialize: (v: SettlementsState) => serializeSettlements(v) },
];
