import type {
  CampaignState, CasualtyTally, ParleyKind, ResolutionId, ScenarioEffect, ScenarioFx, ScenarioOutcome, ScenarioPhase, ScenarioTemplateId, ScenarioView,
} from "../campaignTypes.ts";
import type { NpcSpec } from "../expeditionTypes.ts";
import type { ScenarioInput } from "../scenario.ts";
import type { RivalPresence } from "../worldTypes.ts";

/**
 * The template contract (D-034 section 5). A template is a PURE state machine over what the server observed (`ScenarioInput`) that answers with
 * effects (`ScenarioFx`) for the server to carry out. It never touches the room, a clock or a random source. `observe` is the declarative part:
 * it tells the generic runner (apps/server/src/systems/Scenario.ts) which world facts to turn into events, so the runner holds no per-template code.
 */

/** What the runner and the HUD may read from every template's state. */
export interface BaseState {
  phase: ScenarioPhase;
  /** Seconds since the run began (advances on `tick`, also after the end, for the linger). */
  t: number;
  resolution?: ResolutionId;
  resolvedAt: number;
  /** The parley currently open, if any (the runner closes its card when this clears). */
  parley?: ParleyKind;
}

export type Fx = ScenarioEffect | ScenarioFx;
export interface Reduction<S> { s: S; fx: Fx[] }

/** Something a player can INTERACT with. Exactly one of `npc` / `at` / `mount` places it. */
export interface UseSpec {
  id: string;
  npc?: string;
  at?: { x: number; z: number };
  /** The scenario's wagon. */
  mount?: boolean;
  r: number;
  /** "barrel" / "crate" (D-037): must be carrying that kind of prop (and the press is only taken when the machine accepts it); "none": hands empty; undefined: either. */
  carry?: "barrel" | "crate" | "none";
  /** Consume the carried prop when the machine accepted the press. */
  consume?: boolean;
  /** Opens this parley (the runner checks the press, then sends `parley_open` or `talk`). */
  talk?: ParleyKind;
}

export interface SeenSpec {
  group: string;
  /** Metres at clear weather; the runner narrows it in rain / fog. */
  sight: number;
}

export interface ObserveSpec {
  /** Sites: `near` events carry how many standing humans are inside `r`. */
  near: { id: string; x: number; z: number; r: number }[];
  use: UseSpec[];
  /** Cast groups reported as `count`; `routed` names the tally key to credit when more of the group rout. */
  count: { group: string; routed?: keyof CasualtyTally }[];
  seen: SeenSpec[];
  /** Where reports of fire reach the site: a shot within `radius` of `at` becomes a `noise` event (100 at the point, 0 at the edge). */
  noise?: { x: number; z: number };
  /**
   * People to watch: `down` once, and `arrived` inside `goal`. "wagon" is the scenario's wagon. `boards`: an escort whose goal is the party's boat; when the party sails
   * with it standing near one of them, it has arrived (D-041: a rescuer who ran to the boat with the hostage ten metres behind had brought him home).
   */
  actors: { id: string; goal?: { x: number; z: number; r: number }; boards?: boolean }[];
  /** Groups whose members the runner may name in `hostile`/tally (everything else is the party's side). */
  hostileGroups: string[];
}

export interface TemplateDef<S extends BaseState> {
  id: ScenarioTemplateId;
  title: string;
  brief: string;
  init(c: CampaignState, asking: number, seed: number, presence?: RivalPresence): S;
  reduce(s: S, e: ScenarioInput): Reduction<S>;
  view(s: S, nowMs: number): ScenarioView;
  outcome(s: S): ScenarioOutcome | undefined;
  /** Every person the run may spawn. Groups starting "late:" are held back until `{k:"spawn", group}`. */
  roster(c: CampaignState, seed: number, s: S, presence?: RivalPresence): NpcSpec[];
  /** What sailing away now would commit (`undefined`: nothing happened, the run is dismissed and nothing is committed). */
  leave(s: S): ResolutionId | undefined;
  /** A template whose ledger says "not today" (only the crossing: SETTLED_DAYS). */
  settled?(c: CampaignState): boolean;
  observe: ObserveSpec;
  /** Named walks (`order march`), defined at the start. */
  routes?: Record<string, readonly { x: number; z: number }[]>;
  /** The scenario's wagon (needs `host.mounts`). */
  wagon?: { at: { x: number; z: number; yaw: number }; crates: number; route: string };
  /** Props to place at the start, by name (the runner watches them for `destroyed`). */
  props?: { id: string; kind: number; x: number; z: number }[];
  /** Effects at the start (after the roster is spawned). */
  opening?(s: S): ScenarioFx[];
  /** Where an `explode` / `say` site name is: a point or the wagon. */
  sites?: Record<string, { x: number; z: number }>;
}

export type AnyTemplate = TemplateDef<BaseState>;
