/**
 * World contract (docs/_notes/campaign.md section 1, D-035). Types and constants only, no logic. Frozen, append-only.
 * Imports types from campaignTypes.ts alone, so the powers (powers.ts, rival.ts), the settlements (settlement.ts) and the server meet
 * only through the names in this file.
 */
import type { BridgeState, FactionStance, NeedId, RegionId } from "./campaignTypes.ts";

export const POWER_IDS = ["ward", "rival", "brine", "reapers", "choir"] as const;   // append-only; ward and rival keep their FactionState in CampaignState.factions
export type PowerId = (typeof POWER_IDS)[number];
export type MinorPowerId = "brine" | "reapers" | "choir";
export const PAIR_KEYS = ["ward|rival", "ward|brine", "ward|reapers", "ward|choir", "rival|brine", "rival|reapers", "rival|choir", "brine|reapers", "brine|choir", "reapers|choir"] as const;   // canonical POWER_IDS order
export type PairKey = (typeof PAIR_KEYS)[number];
export type PairState = "feud" | "cold" | "civil" | "trade" | "pact";
/** Ints 0..100, `owes` 0..3 (favours the power owes the party). */
export interface PowerState { id: MinorPowerId; trust: number; fear: number; grievance: number; playerInfluence: number; rivalInfluence: number; militaryStrength: number; prosperity: number; need: NeedId; lastAudienceDay: number; owes: number; refusals: number[] /* campaign days of the last <=3 refusals, newest last (D-035 addendum: the price of refusal) */ }
export type RivalGoal = "buy_crossing" | "survey_route" | "arm_brine" | "found_post" | "sabotage_party" | "lie_low";
export type RivalSpot = "camp" | "road" | "ford" | "fort" | "outpost" | "sea";
/** progress/escort/grudge 0..100; purse pounds; lead = days of warning before the goal pays out. */
export interface RivalAgent { day: number; goal: RivalGoal; since: number; progress: number; purse: number; escort: number; grudge: number; posts: 0 | 1 | 2; where: { region: RegionId; spot: RivalSpot }; seenDay: number; lead: number }
export type RivalEventKind = "goal_set" | "bought_crossing" | "posted_surveyors" | "armed_brine" | "founded_post" | "raided_outpost" | "ambushed_party" | "retreated" | "outbid";
export interface RivalEvent { kind: RivalEventKind; day: number; region: RegionId; power?: PowerId }
export interface PowerEvent { day: number; kind: string /* key into powersText NEWS */; a: PowerId; b?: PowerId; n: number }
export interface PowersState { v: 1; minor: Record<MinorPowerId, PowerState>; rel: Record<PairKey, number> /* -100..100 */; rival: RivalAgent; flags: string[] /* <=12, authored list */; log: PowerEvent[] /* <=6 newest */ }
/** What the Syndicate physically has in the active region NOW. */
export interface RivalPresence { goal: RivalGoal; arrivesInS: number; escort: number; wagon: boolean; surveyors: number; postStage: 0 | 1 | 2;
  /** D-045: the Syndicate means to raid the party's outpost and has not yet (present only when true, so older presences are byte-identical). */
  raidDue?: true;
  /** D-047: the stage of the PARTY's own post where the contract is played (the room adds it from its settlements; absent = no post), so a raid meets the walls that stand. */
  partyPost?: OutpostStage }
/** 0..100; F computes, O consumes. */
export interface RegionClimate { security: number; trade: number; hostility: number; rivalPressure: number; labour: number }
/** What standing deals and flags change elsewhere (the integrator applies; F computes). */
export interface PowerEffects { tollDelta: number; manifestPct: number; sailDelta: number; intelDays: number }
export interface PaperItem { slug: string; head: string; body: string }
export interface PaperExtras { dispatches?: PaperItem[] }
export type OutpostStage = "none" | "camp" | "trading_post" | "fortified_outpost" | "settlement" | "town";
export const OUTPOST_STAGES: readonly OutpostStage[] = ["none", "camp", "trading_post", "fortified_outpost", "settlement", "town"];
export type OutpostPriority = "trade" | "military" | "growth" | "extraction" | "transport";
/** 0..100 except days and crates. */
export interface OutpostState { region: RegionId; name: string; stage: OutpostStage; priority: OutpostPriority; foundedDay: number; stageSince: number; crates: number; supply: number; security: number; trade: number; growth: number; raidedDay: number; ruined: boolean; raids: number /* raids that landed on a weak outpost (D-035 addendum); 0..9 */ }
/** Derived, then latched. */
/**
 * The Society's infrastructure, LATCHED (once earned it stays). D-091 adds the industrial age: a `railway` from Kessar's landing to its post, `breech`-loading rifles from a
 * garrisoned post's armourers, and the `works` of an extraction post (the region it stands in, or "").
 */
export interface TechState {
  road: 0 | 1 | 2; telegraph: boolean; launch: boolean; railway: boolean; breech: boolean; works: RegionId | "";
  since: { road: number; telegraph: number; launch: number; railway: number; breech: number; works: number };
}
export interface SettlementsState { v: 1; posts: Partial<Record<RegionId, OutpostState>>; tech: TechState }
export type SettlementEventKind = "founded" | "delivered" | "promoted" | "demoted" | "raided" | "abandoned" | "road" | "telegraph" | "launch" | "railway" | "breech" | "works";
export interface SettlementEvent { kind: SettlementEventKind; day: number; region: RegionId; stage: OutpostStage; name: string }
/** What the COLLISION world depends on (both sides build the same world from these). */
export interface RegionWorldOpts {
  bridge?: BridgeState; outpost?: OutpostStage; telegraph?: boolean; /** The Syndicate's own post at Kessar (absent: none; never 0, so a world without it keeps its old key). */ rivalPost?: 1 | 2;
  /** D-091: the railhead at Kessar's post and the works beside an extraction post are solid (absent: none, so a world without them keeps its old key). */
  railway?: boolean; works?: boolean;
}
/** What the VIEW draws (no collision). */
export interface RegionDress {
  outpost: OutpostStage; rivalPost: 0 | 1 | 2; road: 0 | 1 | 2; telegraph: boolean; launch: boolean; name: string;
  /** D-091: the railhead at Kessar's post, and the works beside an extraction post (absent: none). */
  railway?: boolean; works?: boolean;
}
export const FOUNDATION_CRATES = 4, DAYS_IDLE_CAP = 3, POWERS_JSON_MAX = 3072, SETTLEMENTS_JSON_MAX = 2048;
export interface MapPowerPin { id: PowerId; name: string; seat: string; stance: FactionStance; note: string; known: boolean; audience: boolean }
export interface RivalSighting { region: RegionId; where: string; day: number; age: number; goal?: string /* only with intel */ }
export interface CampaignMapData { regions: { id: RegionId; name: string; here: boolean; offered?: { title: string; brief: string }; outpost?: { stage: OutpostStage; name: string; priority: OutpostPriority; supply: number }; rivalPost: 0 | 1 | 2 }[]; pins: MapPowerPin[]; rival?: RivalSighting; tech: TechState; lanes: { to: RegionId; seconds: number }[] }
