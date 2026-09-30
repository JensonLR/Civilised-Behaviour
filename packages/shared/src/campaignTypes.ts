/** Campaign contract (docs/_notes/slice.md section 1). Types and constants only; frozen. */
export const REGION_IDS = ["hollowmere", "kessar"] as const;           // append-only
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
export type ResolutionId = "paid" | "bargained" | "bribed" | "forced" | "sabotaged" | "rival_secured" | "abandoned";
export interface CrossingState { bridge: BridgeState; control: CrossingControl; toll: number; tollPaidTotal: number; bribed: boolean; exposed: boolean }  // toll in pounds per crossing (0 = free)
export interface CasualtyTally { wounded: number; downed: number; limbsLost: number; garrisonKilled: number; garrisonRouted: number; civiliansHarmed: number; rivalKilled: number }
export interface HistoryEntry { seq: number; region: RegionId; resolution: ResolutionId; day: number }
export interface CampaignState {
  v: 1; seed: number; day: number; expeditions: number; purse: number; lies: number;   // purse in pounds; lies = promises broken (negotiation leverage)
  factions: Record<FactionId, FactionState>; crossing: CrossingState; tally: CasualtyTally; history: HistoryEntry[];   // history capped at 12
}
export interface ScenarioOutcome {                                       // what the scenario hands the campaign (applyOutcome consumes it)
  scenario: "secure_crossing"; resolution: ResolutionId; toll: number; paid: number; bridge: BridgeState;
  tally: CasualtyTally /* deltas of this run */; brokePromise: boolean; seconds: number;
}
// ---- negotiation (types here so C never imports A's code) ----
export interface Leverage { purse: number; armed: number; garrisonAlive: number; garrisonTotal: number; partyWounded: number; rivalInfluence: number; lies: number }
export interface ParleyOption { id: "pay" | "haggle_flatter" | "haggle_threaten" | "bribe" | "walk_away"; label: string; cost: number; hint: string }
export interface ParleyView { round: number; speaker: string; line: string; toll: number; options: ParleyOption[]; mood: FactionStance }
export type ParleyStep = { view: ParleyView; done?: undefined } | { done: { resolution: ResolutionId | "walked_away" | "hostile"; toll: number; paid: number }; view?: undefined; line: string };
// ---- scenario public view (HUD) and machine I/O ----
export type ScenarioPhase = "approach" | "standoff" | "parley" | "fighting" | "rigging" | "resolved";
export interface ObjectiveView { id: string; text: string; done: boolean; optional?: boolean }
export interface ScenarioView { phase: ScenarioPhase; objectives: ObjectiveView[]; hint: string; timerLabel: string; endsAtWorldMs: number; resolution?: ResolutionId }   // endsAtWorldMs 0 = no timer
export type ScenarioEvent =
  | { t: "tick"; dt: number } | { t: "arrive"; party: number } | { t: "parley_open" } | { t: "parley_close" }
  | { t: "deal"; resolution: "paid" | "bargained" | "bribed"; toll: number; paid: number } | { t: "hostile" }
  | { t: "garrison"; alive: number; routed: number; total: number } | { t: "charge_set" } | { t: "bridge_fell"; onBridge: number }
  | { t: "party_down" } | { t: "tally"; add: Partial<CasualtyTally> };
export type ScenarioEffect = "garrison_alert" | "garrison_stand_down" | "gate_open" | "arm_charge" | "rival_advance" | "commit";
export type StationKind = "map" | "paper" | "dock" | "pier" | "warden";
export interface UseStation { id: string; kind: StationKind; x: number; z: number; r: number; prompt: string }
export const NPC = { NONE: 0, SENTRY: 1, WARDEN: 2, RIVAL_GUARD: 3, RIVAL_SURVEYOR: 4 } as const;   // PlayerState.npc
export const NPC_CAP = 12, SAIL_SECONDS = 6, ARRIVE_TIMEOUT_S = 30, PROPOSE_TIMEOUT_S = 20, RIVAL_ARRIVES_S = 420, RIVAL_PARLEY_S = 60, RESOLVED_LINGER_S = 45;
/** Story coordinates of Kessar Reach (metres, x east, z south, y from terrain). B builds the geometry around them; C puts people on them. Frozen. */
export const KESSAR_ANCHORS = {
  bounds: 120, landing: { x: 0, z: 88 }, bridge: { x: 0, z: 20, length: 22, width: 5.5 }, river: { z: 20, halfWidth: 9 },    // river runs east-west, bridge north-south
  tollBar: { x: 0, z: 8 }, wardenPost: { x: 3.2, z: 5.5 }, pier: { x: -2.9, z: 20 },                                          // pier = west parapet mid-span: where the charge goes
  sentries: [{ x: -4, z: 8.5 }, { x: 4.5, z: 8.5 }, { x: -7, z: -1 }, { x: 8, z: -1 }, { x: 46, z: 11 }, { x: 40, z: 11 }, { x: -2, z: 3 }, { x: 2, z: 3 }],   // first 4 always; the rest by militaryStrength; the last two are the ford patrol ends
  ford: { x: 46, z: 20 }, fort: { x: 0, z: -60, hillRadius: 34, wallRadius: 22, gate: { x: 0, z: -34 } },
  rivalCamp: { x: -34, z: 52 }, rivalParley: { x: -6, z: 12 }, powder: { x: 10, z: 42 },                                        // powder = 3 barrels by a cart on the south bank
} as const;
