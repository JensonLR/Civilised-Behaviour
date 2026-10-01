import type { CastOrder, NpcSide } from "./expeditionTypes.ts";
/** Campaign contract (docs/_notes/slice.md section 1). Types and constants only; frozen. */
export const REGION_IDS = ["hollowmere", "kessar", "highmark", "vesper", "saltmarket"] as const;   // append-only (D-036: highmark, region two; D-037: vesper = the gorge, saltmarket = the delta)
export type RegionId = (typeof REGION_IDS)[number];
export const isRegionId = (v: unknown): v is RegionId => typeof v === "string" && (REGION_IDS as readonly string[]).includes(v);
export type FactionId = "ward" | "rival";                               // ward = the fort's Ward of the Nine Lamps; rival = the Dunmarrow-Vesk Syndicate (foreign expedition)
export type NeedId = "coin" | "arms" | "medicine" | "deference";
export type FactionStance = "hostile" | "wary" | "neutral" | "warm" | "allied";
export interface FactionState {                                          // every number is an integer 0..100
  id: FactionId; trust: number; fear: number; grievance: number; playerInfluence: number; rivalInfluence: number;
  militaryStrength: number; prosperity: number; need: NeedId;
}
export type BridgeState = "intact" | "rigged" | "collapsed";
export type CrossingControl = "ward" | "society" | "rival" | "contested";
export type ScenarioTemplateId = "secure_crossing" | "hostage_rescue" | "convoy_ambush" | "border_incident" | "succession_dispute"
  // D-037: Vesper Gorge (mine_rescue, claim_race) and the Saltmarket Delta (smuggling_run, flooded_market)
  | "mine_rescue" | "claim_race" | "smuggling_run" | "flooded_market";
export type ResolutionId =
  | "paid" | "bargained" | "bribed" | "forced" | "sabotaged" | "rival_secured" | "abandoned"
  | "ransomed" | "rescued" | "slipped_away" | "hostage_lost" | "seized" | "tipped_off" | "burned" | "passed" | "mediated" | "sided_ward" | "sided_syndicate" | "provoked" | "escalated"
  // D-036, Highmark's succession dispute (append-only): who sits the chair, and how
  | "backed_elder" | "backed_younger" | "regency" | "usurped" | "crown_sold"
  // D-037, Vesper Gorge: the Lower Gallery (mine_rescue) and the Claim Race (claim_race)
  | "dug_out" | "blasted_through" | "sealed" | "consecrated" | "staked" | "jumped" | "partnered" | "outpaced"
  // D-037, Saltmarket Delta: the Quiet Barge (smuggling_run) and the Auction at High Water (flooded_market)
  | "landed" | "impounded" | "scuttled" | "informed" | "lot_won" | "consortium" | "shorted" | "washed_out";
export type ComplicationId = "none" | "rival_scouts" | "rain" | "reinforcements" | "rival_bid" | "outriders" | "ward_patrol" | "fog" | "stray_shot";
export interface CrossingState { bridge: BridgeState; control: CrossingControl; toll: number; tollPaidTotal: number; bribed: boolean; exposed: boolean }  // toll in pounds per crossing (0 = free)
export interface CasualtyTally { wounded: number; downed: number; limbsLost: number; garrisonKilled: number; garrisonRouted: number; civiliansHarmed: number; rivalKilled: number }
export interface HistoryEntry { seq: number; region: RegionId; resolution: ResolutionId; day: number; template: ScenarioTemplateId }
/** What the three newer sites remember (D-034). `lastDay` = the campaign day each template last ran. */
export interface SiteLedger {
  lastDay: Partial<Record<ScenarioTemplateId, number>>; hostage: "none" | "freed" | "lost"; convoy: "none" | "seized" | "tipped" | "burned" | "passed";
  border: "quiet" | "mediated" | "ward" | "syndicate" | "war"; lastComplication: ComplicationId;
  /** D-036: who holds Highmark's chair. `parseCampaign` defaults it to "open" (a campaign saved before D-036 has no such field). */
  succession: "open" | "elder" | "younger" | "regency" | "usurped" | "sold";
  /** D-037: how the LAST run of each template that has no bespoke field above ended (the four of Vesper and Saltmarket); `applyOutcome` writes it, `parseCampaign` validates each value against that template's endings and defaults to {}. */
  ends: Partial<Record<ScenarioTemplateId, ResolutionId>>;
}
export interface CampaignState {
  v: 1; seed: number; day: number; expeditions: number; purse: number; lies: number;   // purse in pounds; lies = promises broken (negotiation leverage)
  factions: Record<FactionId, FactionState>; crossing: CrossingState; tally: CasualtyTally; history: HistoryEntry[];   // history capped at 12
  sites: SiteLedger;
}
export interface ScenarioOutcome {                                       // what the scenario hands the campaign (applyOutcome consumes it)
  scenario: ScenarioTemplateId; resolution: ResolutionId; toll: number; paid: number; bridge: BridgeState;
  tally: CasualtyTally /* deltas of this run */; brokePromise: boolean; seconds: number;
  /** Pounds that come INTO the purse (seized cargo). */
  loot?: number;
  /** The complication this run was dealt (recorded in `sites.lastComplication` so it is never dealt twice running). */
  complication?: ComplicationId;
  /** D-036: where the contract was played (absent = Kessar, which is every outcome before Highmark). `applyOutcome` writes it into the history entry. */
  region?: RegionId;
}
// ---- negotiation (types here so C never imports A's code) ----
export interface Leverage { purse: number; armed: number; garrisonAlive: number; garrisonTotal: number; partyWounded: number; rivalInfluence: number; lies: number }
export interface ParleyOption { id: "pay" | "haggle_flatter" | "haggle_threaten" | "bribe" | "walk_away"; label: string; cost: number; hint: string }
export interface ParleyView { round: number; speaker: string; line: string; toll: number; options: ParleyOption[]; mood: FactionStance }
export type ParleyStep = { view: ParleyView; done?: undefined } | { done: { resolution: ResolutionId | "walked_away" | "hostile"; toll: number; paid: number }; view?: undefined; line: string };
// ---- scenario public view (HUD) and machine I/O ----
export type ScenarioPhase = "approach" | "standoff" | "parley" | "fighting" | "rigging" | "resolved" | "planning" | "extract" | "waiting" | "tension" | "escalated";
export interface ObjectiveView { id: string; text: string; done: boolean; optional?: boolean }
export interface ScenarioView {
  phase: ScenarioPhase; objectives: ObjectiveView[]; hint: string; timerLabel: string; endsAtWorldMs: number; resolution?: ResolutionId;   // endsAtWorldMs 0 = no timer
  template: ScenarioTemplateId; title: string; complication?: ComplicationId;
}
export type ScenarioEvent =
  | { t: "tick"; dt: number } | { t: "arrive"; party: number } | { t: "parley_open" } | { t: "parley_close" }
  | { t: "deal"; resolution: "paid" | "bargained" | "bribed"; toll: number; paid: number } | { t: "hostile"; at?: string /* the victim's cast group */ }
  | { t: "garrison"; alive: number; routed: number; total: number } | { t: "charge_set" } | { t: "bridge_fell"; onBridge: number }
  | { t: "party_down" } | { t: "tally"; add: Partial<CasualtyTally> }
  // ---- D-034 templates: everything below is something the SERVER observed (clients send none of it) ----
  | { t: "near"; at: string; party: number } | { t: "use"; target: string; slot: number }
  | { t: "count"; group: string; alive: number; routed: number; down: number; total: number } | { t: "seen"; group: string } | { t: "noise"; level: number }
  | { t: "prop"; what: "delivered" | "destroyed" | "seized"; at: string; n: number } | { t: "actor"; id: string; state: "down" | "free" | "arrived" } | { t: "leave" }
  | { t: "talk"; kind: ParleyKind; result: TalkResult; paid: number };
/** Who a site parley is with. "warden" is the crossing's (negotiation.ts); the rest are authored in scenarios/parleys.ts. */
export type ParleyKind = "warden" | "ransom" | "ward_post" | "surveyor" | "ford_post" | "chamberlain" | "claimant_elder" | "claimant_younger"   // D-036: Highmark's
  | "foreman" | "dirge_master" | "assayer" | "tide_reeve" | "auctioneer" | "house_head";   // D-037: Vesper's three, then the Saltmarket's three
export type TalkResult = "open" | "close" | "hostile" | "paid" | "bargained" | "bribed" | "ransom" | "survey" | "learn" | "tell" | "envelope" | "tip";
export type ScenarioEffect = "garrison_alert" | "garrison_stand_down" | "gate_open" | "arm_charge" | "rival_advance" | "commit";
/** What a template asks the server to DO (the runner turns each into Cast / Mounts / host calls). Sites are named in KESSAR_SITES / KESSAR_ANCHORS. */
export type ScenarioFx =
  | { k: "spawn"; group: string } | { k: "order"; group: string; order: CastOrder } | { k: "war"; a: NpcSide; b: NpcSide; on: boolean } | { k: "say"; text: string }
  | { k: "open"; what: "gate" | "cage" } | { k: "explode"; at: string } | { k: "bridge"; state: BridgeState } | { k: "commit" }
  | { k: "wagon"; op: "go" | "halt" | "seize" | "wreck" } | { k: "parley"; kind: ParleyKind; price: number };
export type StationKind = "map" | "paper" | "dock" | "pier" | "warden" | "loadout" | "foundation" | "court" | "post";   // D-036: "court" = a person of Highmark's court (the chamberlain, a claimant), acted on through the scenario; D-037: "post" = the same for any later region (a foreman, a clerk, a customs shed)
export interface UseStation { id: string; kind: StationKind; x: number; z: number; r: number; prompt: string }
export const NPC = { NONE: 0, SENTRY: 1, WARDEN: 2, RIVAL_GUARD: 3, RIVAL_SURVEYOR: 4, DESERTER: 5, HOSTAGE: 6, DRIVER: 7, PORTER: 8, HIRED_RIFLE: 9, SURGEON: 10, CHAMBERLAIN: 11, CLAIMANT: 12, COURT_GUARD: 13, HERDER: 14,
  FOREMAN: 15, MINER: 16, MOURNER: 17, CUSTOMS: 18, BARGEMAN: 19, FACTOR: 20 } as const;   // PlayerState.npc (append-only; D-034, D-036, D-037: Vesper's three, then the Saltmarket's three)
export const NPC_CAP = 24, FOLLOWER_CAP = 4, SETTLED_DAYS = 3, HOSTAGE_DEADLINE_S = 480, CONVOY_DEPART_S = 60, BORDER_ESCALATE_S = 240, NAME_TAG_RANGE = 30, SAIL_SECONDS = 6, ARRIVE_TIMEOUT_S = 30, PROPOSE_TIMEOUT_S = 20, RIVAL_ARRIVES_S = 420, RIVAL_PARLEY_S = 60, RESOLVED_LINGER_S = 45;
/** Story coordinates of Kessar Reach (metres, x east, z south, y from terrain). B builds the geometry around them; C puts people on them. Frozen. */
export const KESSAR_ANCHORS = {
  bounds: 120, landing: { x: 0, z: 88 }, bridge: { x: 0, z: 20, length: 22, width: 5.5 }, river: { z: 20, halfWidth: 9 },    // river runs east-west, bridge north-south
  tollBar: { x: 0, z: 8 }, wardenPost: { x: 3.2, z: 5.5 }, pier: { x: -2.9, z: 20 },                                          // pier = west parapet mid-span: where the charge goes
  sentries: [{ x: -4, z: 8.5 }, { x: 4.5, z: 8.5 }, { x: -7, z: -1 }, { x: 8, z: -1 }, { x: 46, z: 11 }, { x: 40, z: 11 }, { x: -2, z: 3 }, { x: 2, z: 3 }],   // first 4 always; the rest by militaryStrength; the last two are the ford patrol ends
  ford: { x: 46, z: 20 }, fort: { x: 0, z: -60, hillRadius: 34, wallRadius: 22, gate: { x: 0, z: -34 } },
  rivalCamp: { x: -34, z: 52 }, rivalParley: { x: -6, z: 12 }, powder: { x: 10, z: 42 },                                        // powder = 3 barrels by a cart on the south bank
} as const;
/**
 * Frozen story coordinates of the three newer Kessar sites (D-034); same frame as KESSAR_ANCHORS. Package S proves each is open and reachable (kessarSites.test.ts).
 */
export const KESSAR_SITES = {
  hostage: { cage: { x: 72, z: -20 }, posts: [{ x: 66, z: -24 }, { x: 76, z: -26 }, { x: 78, z: -17 }, { x: 67, z: -15 }], lookout: { x: 58, z: -12 } },   // deserters' camp "Hangman's Orchard", NE scrub, reached by the ford
  convoy: { cut: { x: 36, z: 36 }, route: [{ x: -34, z: 52 }, { x: -12, z: 44 }, { x: 10, z: 40 }, { x: 24, z: 37 }, { x: 36, z: 36 }, { x: 46, z: 32 }] },   // Syndicate wagon: rival camp -> the Dry Cut -> ford landing (south bank)
  border: { marker: { x: 46, z: 20 }, ward: [{ x: 44, z: 9 }, { x: 48, z: 9 }], rival: [{ x: 42, z: 31 }, { x: 46, z: 31 }, { x: 50, z: 31 }] },   // Marker Stone No. 4 stands IN the ford; each side shouts across the water
} as const;
