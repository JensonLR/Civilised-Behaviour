import {
  DAYS_IDLE_CAP, newCampaign, newHonours, parseHonours, serializeHonours, type HonoursState, newParty, newPowers, newSettlements, parseCampaign, parseParty, parsePowers, parseSettlements, serializeCampaign, serializeParty, serializePowers, serializeSettlements,
  type CampaignState, type PartyState, type PowersState, type SettlementsState,
} from "@cb/shared";
import type { AnyCodec } from "../persistence/sections.ts";

/**
 * The saved sections (D-035): the campaign ledger, the hired hands and manifest, the powers, the settlements; and the idle days still owed to the rival (below). Each is the module's own hostile-safe parser and serialiser;
 * a section that fails to parse is replaced by `fresh(seed)` and reported (one bad section never loses the campaign). Positions, props, NPCs, mounts and scenario progress are NOT saved:
 * a resumed campaign always starts at HQ.
 */
export const CAMPAIGN_CODECS: readonly AnyCodec[] = [
  { key: "campaign", version: 1, fresh: (seed: number) => newCampaign(seed), parse: (j: string) => parseCampaign(j), serialize: (v: CampaignState) => serializeCampaign(v) },
  { key: "party", version: 1, fresh: () => newParty(), parse: (j: string) => parseParty(j), serialize: (v: PartyState) => serializeParty(v) },
  { key: "powers", version: 1, fresh: (seed: number) => newPowers(seed), parse: (j: string) => parsePowers(j), serialize: (v: PowersState) => serializePowers(v) },
  { key: "settlements", version: 1, fresh: () => newSettlements(), parse: (j: string) => parseSettlements(j), serialize: (v: SettlementsState) => serializeSettlements(v) },
  // idle days the rival is owed and has not yet been paid (they are paid at the first commit). Saved because every join and leave saves a fresh `savedAt`: kept only in the room,
  // a resume that ended no contract forgot them (the persistence review's finding (c)). A record from before this section has none: fresh, 0 owed.
  { key: "idle", version: 1, fresh: () => 0, parse: (j: string) => parseIdle(j), serialize: (v: number) => String(parseIdle(String(v)) ?? 0) },
  // D-055: each member's last three honours, keyed by the same HMAC key the membership list holds (a record from before this section has none: fresh, nobody decorated)
  { key: "honours", version: 1, fresh: () => newHonours(), parse: (j: string) => parseHonours(j), serialize: (v: HonoursState) => serializeHonours(v) },
];

/** Whole idle days owed, 0..DAYS_IDLE_CAP; anything else (hostile, garbled) is not a section. */
export function parseIdle(j: string): number | undefined {
  if (!/^[0-9]{1,2}$/.test(j)) return undefined;
  const n = Number(j);
  return n <= DAYS_IDLE_CAP ? n : undefined;
}
