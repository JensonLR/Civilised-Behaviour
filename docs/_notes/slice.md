# Slice 1: the core loop becomes real (D-033)

Goal: HQ -> map room -> sail -> ONE colony region -> ONE scenario that resolves >=3 materially different ways -> campaign state mutates -> satirical paper at HQ.
Verified-by-reading against: WorldRoom.ts, schema.ts, protocol.ts, camp.ts, arena.ts, Session.ts, Stage.ts, Game.ts, Combat/Casualties (host shapes), GDD 3-5/9.

## 0. What the places are
- **Hollowmere + the camp = HOME HQ** ("Society Depot, Hollowmere"). It is the hub, not a destination. Jetty (`JETTY`) = the dock; HQ marquee map table (`CAMP.mapTable`) = the map room;
  notice board (`hqPlan().notice`) = where the paper is pinned. Everything already built there (creator, cannon, range-ish clearing, villagers) stays; only the stations are new.
- **Kessar Reach** = region 1 of the 4 in the GDD: coast + river + a fortified hill-capital behind the crossing (the "castle in the back" of the reference art). It is a separate
  authored region (own terrain, colliders, view), not a Hollowmere re-skin. No real-world culture coding: invented heraldry (nine lamps, chevrons), Latin-letter signage, no domes/minarets/script.
- **One campaign = one Colyseus room** (join code, reconnect, campaign state all survive). The room holds exactly one ACTIVE region; switching disposes the old region's physics/props/NPCs/scenario
  and builds the new one (only the active region simulates). `JoinOptions.region` picks the initial region (dev/tests/screenshots); in play the party sails.
- Rejected: room-per-region (needs persistence hand-off = M10), streaming both regions at once (double sim and memory for nothing).

## 1. Data model (contract; the integrator creates `packages/shared/src/campaignTypes.ts` with EXACTLY this, types + constants only, then it is frozen)
```ts
export const REGION_IDS = ["hollowmere", "kessar"] as const;           // append-only
export type RegionId = (typeof REGION_IDS)[number];
export const isRegionId = (v: unknown): v is RegionId => typeof v === "string" && (REGION_IDS as readonly string[]).includes(v);
export type FactionId = "ward" | "rival";                               // ward = the fort's Ward of the Nine Lamps; rival = the Dunmarrow-Vesk Syndicate (foreign expedition)
export type NeedId = "coin" | "arms" | "medicine" | "deference";
export type Stance = "hostile" | "wary" | "neutral" | "warm" | "allied";
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
export interface ParleyView { round: number; speaker: string; line: string; toll: number; options: ParleyOption[]; mood: Stance }
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
export interface Station { id: string; kind: StationKind; x: number; z: number; r: number; prompt: string }
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
```
Campaign JSON is what crosses the wire (`WorldState.campaign`), parsed by `parseCampaign` (hostile-safe). Campaign is server-owned and never client-written.

## 2. Server <-> client (append-only; integrator only)
`WorldState` (schema.ts) gains: `region: string`; `travelPhase: uint8` (0 idle, 1 proposed, 2 sailing, 3 arriving); `travelTo: string`; `travelReady: uint8` (bitmask of slots); `travelLeft: uint8` (seconds);
`campaign: string` (JSON, < 4 KB) + `campaignRev: uint16`; `scenario: string` (ScenarioView JSON, "" outside a scenario) + `scenarioRev: uint16`.
`PlayerState` gains `npc: uint8` (NPC.* ; 0 = a real player). Assign every new numeric field explicitly at creation (Colyseus decodes unassigned numerics as undefined).
`JoinOptions` gains `region?: RegionId` (create only; default hollowmere; validated with `isRegionId`).
`ClientMessages` gain: `travelPropose: { to: RegionId }`, `travelReady: { ready: boolean }`, `travelCancel: {}`, `regionReady: { region: RegionId }`, `parleyPick: { option: number }`, `parleyClose: {}`.
`ServerMessages` gain: `station: { kind: "map" | "paper" }` (open a UI), `parley: { view?: ParleyView; line?: string; closed?: boolean }`. Bridge fall reuses `boom`; toasts reuse `notice`. No paper message: the client runs `generatePaper(parseCampaign(state.campaign), state.seed)` itself.
Server rules (all messages validated, rate limited by the room's existing limiter, unknown/stale ignored): propose only in phase 0/1, `to` valid and != current, sender connected; ready/cancel only phase 1; `regionReady` only phase 3 and `region` == state.region;
`parleyPick` only from the session that owns the open parley and `0 <= option < options.length`.
**NPCs are `PlayerState` rows** keyed `npc:<id>` with `slot = 255`, `npc != 0`, a generated `look`, driven on the server by synthetic `MoveCommand`s through the SAME `stepCharacter` + `Combat.onFrame` + `Casualties.damage` path.
They therefore get wounds, downing, dismemberment, blood, lag-comp rewind, ragdoll, interpolation and rendering with no new client code. Rules the integrator adds: NPCs are excluded from slots/invite counts/"whole party down" rout/revive+drag candidate scans;
a downed NPC stays down and is removed after 30 s; friendly fire never applies NPC-vs-NPC of the same faction. Cap `NPC_CAP`.
Travel flow: propose -> (all connected ready, solo instant; else `PROPOSE_TIMEOUT_S` then cancel) -> phase 2 for `SAIL_SECONDS` (inputs discarded server-side, clients blocked behind the Sailing card) -> server `enterRegion(to)` (new world, physics, props, cannons, NPCs, scenario, players teleported to `regionSpawn`; `state.region` flips) -> phase 3 until every connected client sends `regionReady` or `ARRIVE_TIMEOUT_S` -> phase 0. Inputs stay discarded through phase 3 (the client builds the new world meanwhile). Teleport must snap the reconciler (precedent: rout respawn); the integrator verifies with a bot test.

## 3. Work packages (DISJOINT ownership; each exports pure functions/types from NEW files, touches no integrator file, and adds its own `*.test.ts`)
Import rule: A, B and C may import only `campaignTypes.ts` and pre-existing shared modules from each other's area. Cross-package calls are injected through host objects (C receives `negotiation` functions via its host).

### Package A: factions, negotiation, newspaper (pure) + two thin DOM views
Owns: `packages/shared/src/{campaign.ts,negotiation.ts,newspaper.ts,newspaperText.ts}` + tests, `apps/client/src/ui/{Parley.ts,Newspaper.ts,parley.css,newspaper.css}`.
Exports (exact):
```ts
newCampaign(seed: number): CampaignState            // purse 120, ward{trust 35,fear 10,grievance 15,military 55,prosperity 50,need:"coin"}, rival{rivalInfluence 30}, bridge intact, control "ward", toll 0, tally zeros
parseCampaign(json: string): CampaignState | undefined     // clamps every field, caps history, rejects wrong v; never throws
serializeCampaign(c: CampaignState): string
stanceOf(f: FactionState): Stance                    // from trust - grievance + 0.5*fear (document the cut points)
askingToll(c: CampaignState): number                 // integer pounds, 25..90, from need, prosperity, rivalInfluence, stance
applyOutcome(c: CampaignState, o: ScenarioOutcome): CampaignState   // pure, returns new; day += 1, expeditions += 1, history push (cap 12)
leverageOf(c: CampaignState, live: { armed: number; garrisonAlive: number; garrisonTotal: number; partyWounded: number }): Leverage
openParley(c: CampaignState, lv: Leverage, seed: number): ParleyView
answerParley(c: CampaignState, lv: Leverage, seed: number, view: ParleyView, option: number): ParleyStep
generatePaper(c: CampaignState, worldSeed: number): Paper
export interface Paper { masthead: string; edition: number; dateline: string; headline: string; standfirst: string; stories: { slug: string; head: string; body: string }[]; notices: string[] }
// Parley.ts:    class Parley { constructor(root: HTMLElement); open(v: ParleyView, pick: (i: number) => void, close: () => void): void; update(v: ParleyView): void; closeUi(): void; dispose(): void }   (keyboard + PadNav)
// Newspaper.ts: class NewspaperView { constructor(root: HTMLElement); show(p: Paper, onClose: () => void): void; hide(): void; dispose(): void }   (broadsheet idiom, palette vars only, larger-text + reduced-motion aware)
```
Rules: deterministic (no Math.random/Date.now; rolls via `hash3(seed, round, slot)`); one `applyOutcome` rules table; haggle outcomes are functions of trust/fear/need/armed/rivalInfluence; the bribe option needs `purse >= cost` and sets `exposed` deterministically (rivalInfluence >= 50 or `hash3 < 0.5`).
Outcome table intent: paid = control "ward", toll set, trust+, prosperity+; bargained = lower toll, trust+, deference need met; bribed = toll 0 for now, lies+1, `exposed` later grievance+20; forced = control "society", fear+, grievance++, trust--, military -= 6/kill, toll 0; sabotaged = bridge collapsed, prosperity--, grievance+, rivalInfluence+ (the rival blames you, profits); rival_secured = control "rival", rivalInfluence++, playerInfluence-; abandoned = grievance+, purse unchanged.
Acceptance tests: (1) newCampaign/parse/serialize round-trip; fuzz parse with 2000 hostile strings (NaN, huge, wrong types, deep nesting) never throws and always yields clamped ints; (2) `applyOutcome` matrix: for every pair of {paid, bargained, bribed, forced, sabotaged, rival_secured} the resulting (bridge, control, toll, trust, fear, grievance, prosperity, purse) differ in >= 3 fields; (3) parley: each of pay/haggle/bribe/walk_away reaches a `done` in <= 4 rounds from every starting stance; threaten only works with armed >= 2 and fear/garrison odds; flatter only when need == "deference" or trust >= 40; no option is a dead end; deterministic for a given seed; (4) newspaper: all 7 resolutions give distinct headlines that state their material facts (toll amount, bridge state, dead count), euphemism table turns casualties into "decisive strategic repositioning"-style spin, >= 3 templates per resolution chosen by `hash3`, output stable for equal input, edition increments, length limits; (5) `noRealWorld.test.ts`: scans A's and B's authored strings against a banned-terms list (real nations, peoples, religions, real cities); (6) DOM views: render from fixtures, keyboard focus order, no colour literals (existing palette guard).

### Package B: Kessar Reach plan, region switch plumbing, travel, map room
Owns: `packages/shared/src/{regions.ts,kessar.ts,travel.ts}` + tests; `packages/shared/src/palette.ts` (APPEND a `kessar` group only; B is the only editor); `apps/client/src/render/world/{regionView.ts,kessar/*}`; `apps/client/src/ui/{MapRoom.ts,Sailing.ts,mapRoom.css}`; `apps/client/src/showcase/World.ts` (accept `&region=`); `apps/server/src/systems/Travel.ts`; `apps/server/src/bots/travel.ts`.
Exports (exact):
```ts
export interface RegionDef { id: RegionId; name: string; blurb: string; bounds: number; sailSeconds: number }
export const REGIONS: Record<RegionId, RegionDef>
createRegionWorld(id: RegionId, seed: number, opts?: { bridge?: BridgeState }): CollisionWorld   // hollowmere -> createArena(seed); kessar -> kessar.ts
regionSpawn(id: RegionId, index: number, count?: number): { x: number; z: number }               // kessar: ring of 4 at KESSAR_ANCHORS.landing
regionProps(id: RegionId, seed: number, world: CollisionWorld): PropSpawn[]                       // kessar: scatterProps + 3 BARRELs at powder
stationsFor(id: RegionId): Station[]                                                              // hollowmere: map (CAMP.mapTable), paper (hqPlan().notice), dock (JETTY foot); kessar: pier, dock (landing)
findStation(id: RegionId, x: number, z: number, facing: number): Station | undefined              // pure; range/cone like INTERACT; allocation-free
kessarPlan(): KessarPlan                                                                          // fort, walls, towers, gatehouse, bridge, banners, palms, cannon emplacements (data the view and the colliders share)
// travel.ts (pure state machine, no I/O)
export interface TravelState { phase: 0|1|2|3; to: RegionId; ready: number; left: number }
travelPropose/travelReady/travelCancel/travelTick/travelArrived(s, ...): TravelStep   // TravelStep = { s: TravelState; fx?: "enter_region" | "cancelled" | "done" }
// Travel.ts (server): class Travel { constructor(host: { connectedSlots(): number; current(): RegionId; enterRegion(to: RegionId): void; notice(text: string): void; sync(s: TravelState): void }); propose(sid, slot, to); ready(slot, on); cancel(); regionReady(slot); tick(dt); onLeave(slot) }
// client: regionView.ts
export interface RegionView { readonly root: Group; readonly stats: WorldStats; applyDay(d: DayState): void; update(t: number, cam?: {x:number;y?:number;z:number}, worldSec?: number): void; setPushers(list: readonly {x:number;z:number}[], n?: number): void; dispose(): void }
createRegionView(id: RegionId, scene: Scene, world: CollisionWorld, detail: WorldDetail, sun: Vector3): RegionView   // hollowmere wraps the existing WorldView unchanged
// ui: class MapRoom { constructor(root: HTMLElement); open(v: { regions: { id: RegionId; name: string; blurb: string; note: string; here: boolean }[]; ready: { slot: number; name: string; ready: boolean }[]; phase: number }, cb: { propose(to: RegionId): void; ready(on: boolean): void; cancel(): void; close(): void }): void; update(...): void; close(): void; dispose(): void }
// ui: class Sailing { constructor(root: HTMLElement); show(to: string, left: number): void; arriving(): void; hide(): void; dispose(): void }
```
Kessar content: sandstone hill-capital with curtain wall, four round towers, a gatehouse with toll bar on the north abutment, stone bridge (pier parapet where the charge goes), a shallow ford downstream (walkable, waist-deep, patrolled, no objective depends on it), palms, banner cloth in the existing ripple shader, cannon emplacements on the walls (display only this slice), a rival camp (tents, wagon, flag). Toon ramp + ink outline + palette vars; <= 60 draw calls on medium; the river/gorge is impassable except at the bridge and the ford (steep banks through the shared step's slope limit, no invisible walls).
Bridge collapse = `createRegionWorld(id, seed, { bridge: "collapsed" })` rebuilt on both sides (deck colliders absent, pier stumps + rubble present); the integrator owns the swap (see 4). No prop or player spawn is on the deck.
Acceptance tests: (1) `createRegionWorld("kessar", s)` deterministic across 5 seeds (same obstacle count/hash) and never mutates Hollowmere's `createArena` output (snapshot hash of arena unchanged); (2) reachability: flood-fill with the real `stepCharacter` on a 2 m grid from the landing: the fort gate, tollBar, wardenPost and every sentry post are reachable ONLY through bridge(intact) or ford; with `bridge: "collapsed"` reachability of tollBar needs the ford; no anchor inside an obstacle; (3) `findStation` range/cone/priority table tests, allocation-free; (4) travel machine: every transition incl. timeouts, leaver while proposed, solo instant, double propose ignored, stale regionReady ignored, no stuck state under random event fuzz (5000 sequences end in phase 0 within 100 s of simulated time); (5) `Travel.ts` with a fake host; (6) client geometry tests in the style of `geometry.test.ts`: finite, outward normals, draws/triangles under budget per preset, dispose frees everything, no colour literals (palette guard), no real-world term in any sign text; (7) a render check via `node scripts/shot.mjs "?showcase=world&region=kessar"` viewed by eye at landing, bridge and gate; (8) `bots/travel.ts`: `sail(bot, to)` helper (propose, ready, wait phase, send regionReady).

### Package C: scenario engine, garrison and rival NPCs, objective tracker
Owns: `packages/shared/src/{scenario.ts,garrison.ts}` + tests; `apps/server/src/systems/Scenario.ts` + test; `apps/client/src/ui/{ObjectiveTracker.ts,objectiveTracker.css}`.
Exports (exact):
```ts
export interface ScenarioState { phase: ScenarioPhase; t: number; partyNear: boolean; parley: boolean; chargeArmed: boolean; fuse: number; hostile: boolean; alive: number; routed: number; total: number;
  toll: number; paid: number; resolution?: ResolutionId; resolvedAt: number; tally: CasualtyTally; brokePromise: boolean; rivalAdvanced: boolean }
newScenario(c: CampaignState): ScenarioState                        // garrison total from militaryStrength (4..8), toll from campaign.crossing.toll || askingToll semantic passed in by host; bridge collapsed at start => pre-resolved
reduceScenario(s: ScenarioState, e: ScenarioEvent): { s: ScenarioState; fx: ScenarioEffect[] }        // the ONLY place phase logic lives; first resolution wins; bridge_fell beats fighting
scenarioView(s: ScenarioState, worldMsNow: number): ScenarioView  // authored objective text; timer = rival arrival countdown, then fuse
scenarioOutcome(s: ScenarioState): ScenarioOutcome | undefined     // defined once resolved
// garrison.ts (pure utility brain, allocation-free: writes into `out`)
export interface NpcSpec { id: string; role: number /* NPC.* */; faction: FactionId; post: { x: number; z: number }; weapon: WeaponId; lookSeed: number; name: string }
garrisonRoster(c: CampaignState, seed: number): NpcSpec[]            // sentries (anchors) + Warden + 3 rival NPCs; <= NPC_CAP
export type NpcMode = "post" | "alert" | "attack" | "flee" | "stand_down" | "march";
export interface NpcBrain { mode: NpcMode; morale: number; target: string; cooldown: number; route: number }
newBrain(spec: NpcSpec): NpcBrain
export interface NpcBody { x: number; z: number; facing: number; health: number; weapon: number; ammo: number; flags: number }        // read from the PlayerState row
export interface NpcSenses { enemy: { id: string; x: number; z: number; armed: boolean; down: boolean } | undefined; allies: number; alert: boolean; standDown: boolean; fear: number }   // host fills (nearest live player, O(players))
npcDecide(b: NpcBrain, me: NpcBody, senses: NpcSenses, dt: number, out: MoveCommand): void    // utility scores: attack vs hold vs flee (morale from losses and campaign fear); march follows a waypoint list (rival)
```
Server `Scenario.ts`: `class Scenario { constructor(host: ScenarioHost); start(): void; tick(dt: number): void; onInteract(sid: string, p: PlayerStateType, carriedProp?: string): boolean; onPick(sid: string, option: number): void; onParleyClose(sid: string): void; onDamage(victim: string, attacker: string, zone: number, down: boolean): void; dispose(): void }`.
`ScenarioHost` (integrator supplies): `players`, `worldMs()`, `campaign()`, `commit(o: ScenarioOutcome)`, `spawnNpc(spec): boolean`, `removeNpc(id)`, `stepNpc(id, cmd)` (= stepCharacter + Combat.onFrame), `explode(x, y, z, radius)`, `consumeProp(id)`, `propKind(id)`, `rebuildBridge(state: BridgeState)`, `publish(view: ScenarioView)`, `send(sid, type, msg)`, `negotiation: { leverageOf, openParley, answerParley }` (A's functions, injected), `seed`.
Behaviour: arrival check 1 Hz (party within 30 m of toll bar); INTERACT at the Warden (<= 2.2 m) opens a parley owned by that session (others see phase "parley"); first hit by a player on any Ward NPC = `hostile` (alert all; parley dies with "You have made your point, with a bullet"); sentries obey `npcDecide` (attack nearest armed player, flee below morale, stand down on `garrison_stand_down`); pier + carried BARREL + INTERACT = `charge_set` (barrel consumed, 10 s fuse, `boom` radius 9 at the pier, `rebuildBridge("collapsed")`, anybody on the deck falls: natural result of the rebuilt colliders); sentries within 12 m of an armed charge go hostile; rival NPCs march `rivalCamp -> rivalParley` from `RIVAL_ARRIVES_S` and, after `RIVAL_PARLEY_S` with no resolution, `rival_secured`; resolved => `commit(outcome)` once, NPCs stand down, linger `RESOLVED_LINGER_S`, then despawn. Tally counts come from `onDamage`/casualty callbacks (wounds, downs, limbs, kills by faction).
Acceptance tests: (1) reducer: table test for every (phase, event) pair; single resolution per run; `bridge_fell` beats `fighting`; rival timer; `party_down` -> abandoned; pre-collapsed bridge starts resolved; (2) three end-to-end scripted runs on a fake host reach `paid` (parley), `forced` (kill/rout 60%), `sabotaged` (barrel at pier) with different `ScenarioOutcome`s, and each commits exactly once; (3) `npcDecide`: deterministic, allocation-free (heap delta test like movement), attacks nearest, flees at low morale, never acts in `stand_down`, marches the waypoint list; (4) `garrisonRoster` count tracks militaryStrength and respects `NPC_CAP`; (5) hostile-input: `onPick` from a non-owner, out-of-range option, parley after resolved, charge without barrel, double charge: all ignored, no throw; (6) `ObjectiveTracker` renders fixtures (done/optional/timer), reduced-motion aware.

## 4. Integrator-only files (nobody else edits these; implementers never touch them)
`packages/shared/src/{campaignTypes.ts (new, frozen), schema.ts, protocol.ts, index.ts, constants.ts}`; `apps/server/src/rooms/WorldRoom.ts`; `apps/server/src/systems/{Combat.ts,Casualties.ts}` (NPC filters only); `apps/server/src/{physics.ts (add replaceStatic(world)), roomConfig.ts, app.ts}`;
`apps/client/src/{main.ts, net/Session.ts, game/Game.ts, game/boot.ts, render/Stage.ts, ui/Hud.ts, style.css}`; docs (`BUILD_STATE.md`, `ASSET_REGISTER.md`, `AI_CONTENT_REGISTER.md`). Implementers also never edit `camp.ts`, `village.ts`, `arena.ts`, `landscape.ts`, `worldgen.ts` (read-only).
Wiring list (integrator, in this order, each step ending with `pnpm typecheck && pnpm test`):
1. Create `campaignTypes.ts` from section 1, export from `index.ts`; land schema/protocol additions (section 2). Implementers start from this commit.
2. `WorldRoom`: `world`/`physics` become fields swapped by `enterRegion(id)`; Casualties and Combat hosts read them through getters; `state.cannons`/`props` are cleared and refilled in place; `onCreate` reads `options.region`; per-region setup = `createRegionWorld`, `regionProps`, cannons only in Hollowmere.
3. Instantiate `Travel` and `Scenario` (scenario only when region == kessar); new message handlers; `handleInteraction`: after the casualty/combat checks and BEFORE the prop branch, `findStation` (map/paper -> send `station`; dock -> same as map; pier/warden -> `scenario.onInteract`); skip stepping/interaction and `acc.take` the queue while `travelPhase >= 2`.
4. `campaign`: created in `onCreate` (`newCampaign(seed)`), `commit(outcome)` = `applyOutcome` + serialize + `campaignRev++`; `scenario` JSON republished on change only.
5. NPC plumbing: `spawnNpc` (row + `Combat.onJoin` + look from `@cb/procedural` generator with `lookSeed`), `stepNpc`, Casualties/Combat NPC filters, 30 s downed-NPC removal, `rebuildBridge` (new `CollisionWorld` + `physics.replaceStatic`, and `state.campaign` bridge field updated by commit).
6. Client: `Session.world` mutable; on `state.region` change rebuild `world = createRegionWorld(...)`, call `stage.buildRegionAsync`, then send `regionReady`; `Stage` builds via `createRegionView`; bridge state change (from campaign JSON) rebuilds the world the same way; Hud prompt from `findStation`; `station`/`parley`/`scenario`/`campaign` mounted to MapRoom/Parley/NewspaperView/ObjectiveTracker; Sailing card on phases 2-3 with `Controls.blocked`; nametags show NPC role names; invite count excludes NPCs.
7. `Session.create` passes `region`; `?region=kessar` URL param; docs.
Fallback if `replaceStatic` proves unclean: collapse keeps the old Rapier statics (cosmetic only for props), the analytic `CollisionWorld` (what players walk on) is still rebuilt. Props never stand on the deck, so nothing observable breaks.

## 5. The three ways, as played (the integration acceptance script; bots in `apps/server/src/**/*.test.ts`, plus one Playwright smoke)
- **Negotiate:** Warden opens at `askingToll`; pay it (`paid`), haggle down (`bargained`: flatter needs deference/trust, threaten needs 2+ armed), or bribe the quartermaster (`bribed`, cheaper, later exposed by the rival's gossip).
- **Force:** shoot a sentry: alarm, garrison attacks, gore and downs on the existing rules, rout at 60% (`forced`: fear up, toll abolished, the Ward remembers).
- **Trick:** carry a barrel from the powder cart to the pier, light it, run (`sabotaged`: bridge gone, everyone on the deck swims, rival profits, paper blames "structural enthusiasm").
- **Dawdle:** the Syndicate arrives at 7:00, parleys for a minute and buys the crossing (`rival_secured`).
Then: sail home at the landing dock; the paper on the notice board (`station: paper`) reports it, and `campaign` is unchanged by rejoin (server-held; persistence across server restarts is M10).
Integration tests: one bot run per resolution asserts distinct `campaign` JSON + distinct `generatePaper` headline; travel round-trip hollowmere -> kessar -> hollowmere with 2 bots (one slow `regionReady`); a teleport-snap prediction check; a reconnect during `sailing`; a hostile-message fuzz of every new message; p95 tick stays under budget with 12 NPCs + 4 bots; Playwright `?region=kessar` loads, the tracker shows, no console errors.

## 6. Not in this slice (say so in BUILD_STATE)
Loadout/inventory, horses/wagon/boat vehicles (sailing is a card, not a playable voyage), NPC-crewed cannons (wall cannons are display), chaos director, >1 scenario template, outposts, persistence across server restarts, revisiting a region with a collapsed bridge (the scenario starts pre-resolved), audio for new content, real-GPU measurements. Balance of the garrison is a first pass never played by humans.
