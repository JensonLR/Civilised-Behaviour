import type { CampaignState, RegionId, ResolutionId, ScenarioTemplateId } from "./campaignTypes.ts";
import type { Rule } from "./factions.ts";
import type { HqPieceKind, HqSurface } from "./outpostText.ts";
import type { NewsDef } from "./powersText.ts";
import type { MinorPowerId, PairKey, PowerId, PowerState } from "./worldTypes.ts";

/**
 * D-037 (docs/_notes/regions34.md): the endings of regions three and four, and the SHAPE every region's endings are declared in.
 *
 * A region package never edits a central table. Each ending is declared ONCE, as a row of numbers (`EndingNumbers`, in `<region>Ledger.ts`) and a row of authored copy
 * (`EndingCopy`, in `<region>Text.ts`); the central exhaustive tables (RULES, MEMORY, RELATION_FX, GRUDGE_FX, HISTORY_PIECE, MEMORY_LINE, HEADLINES, STANDFIRSTS, SITE_LINES, NEWS and the
 * minors' moods) are built from the old literal PLUS these rows through `pluck`, so a missing ending is still a COMPILE error and two packages never edit one file.
 * Highmark's five (D-036) keep their older literal rows; they are not migrated (working code is not refactored for tidiness).
 *
 * Imports here are TYPE-ONLY (erased), so this file can be imported by every table without a cycle.
 */

/** Vesper Gorge (the arid canyon, mineral frontier). Two templates; `abandoned` is shared and is not listed. */
export const VESPER_RESOLUTIONS = ["dug_out", "blasted_through", "sealed", "consecrated", "staked", "jumped", "partnered", "outpaced"] as const satisfies readonly ResolutionId[];
/** The Saltmarket Delta (the wetland trading region). Two templates. */
export const SALTMARKET_RESOLUTIONS = ["landed", "impounded", "scuttled", "informed", "lot_won", "consortium", "shorted", "washed_out"] as const satisfies readonly ResolutionId[];
export type VesperEnding = (typeof VESPER_RESOLUTIONS)[number];
/** D-042: Highmark's second contract, the Reapers' Strike (its endings follow this file's shape; the succession's five keep their older literal rows). */
export const REAPERS_RESOLUTIONS = ["honest_measure", "bought_back", "strike_broken", "barley_lost"] as const satisfies readonly ResolutionId[];
export type ReapersEnding = (typeof REAPERS_RESOLUTIONS)[number];
/** D-044: Vesper's third contract, the Winding Engine (the sabotage the D-037 note left for later). */
export const ENGINE_RESOLUTIONS = ["engine_fouled", "engine_blown", "engine_bought", "vein_struck"] as const satisfies readonly ResolutionId[];
export type EngineEnding = (typeof ENGINE_RESOLUTIONS)[number];
/** D-045: Kessar's fifth contract, the Raid on the Post (the GDD's outpost defence): offered only while the Syndicate means to raid the party's outpost. */
export const RAID_RESOLUTIONS = ["post_held", "post_burned", "protection_paid"] as const satisfies readonly ResolutionId[];
export type RaidEnding = (typeof RAID_RESOLUTIONS)[number];
export type SaltmarketEnding = (typeof SALTMARKET_RESOLUTIONS)[number];
/** Every ending in the D-037 shape (27: Vesper's and the Saltmarket's sixteen, the strike's four, the engine's four, the raid's three). Tests that script Kessar's twenty or Highmark's chair exclude these. */
export const NEW_RESOLUTIONS = [...VESPER_RESOLUTIONS, ...SALTMARKET_RESOLUTIONS, ...REAPERS_RESOLUTIONS, ...ENGINE_RESOLUTIONS, ...RAID_RESOLUTIONS] as const;
export type NewEnding = (typeof NEW_RESOLUTIONS)[number];

/** What each new template can end as (each has >= 3 materially different endings besides the shared `abandoned`). */
export const NEW_TEMPLATE_RESOLUTIONS = {
  mine_rescue: ["dug_out", "blasted_through", "sealed", "consecrated", "abandoned"],
  claim_race: ["staked", "jumped", "partnered", "outpaced", "abandoned"],
  smuggling_run: ["landed", "impounded", "scuttled", "informed", "abandoned"],
  flooded_market: ["lot_won", "consortium", "shorted", "washed_out", "abandoned"],
  reapers_strike: ["honest_measure", "bought_back", "strike_broken", "barley_lost", "abandoned"],   // D-042 (Highmark)
  winding_engine: ["engine_fouled", "engine_blown", "engine_bought", "vein_struck", "abandoned"],   // D-044 (Vesper)
  outpost_raid: ["post_held", "post_burned", "protection_paid", "abandoned"],   // D-045 (Kessar)
} as const satisfies Partial<Record<ScenarioTemplateId, readonly ResolutionId[]>>;
export type NewTemplateId = keyof typeof NEW_TEMPLATE_RESOLUTIONS;
export type VesperTemplate = "mine_rescue" | "claim_race" | "winding_engine";
export type SaltmarketTemplate = "smuggling_run" | "flooded_market";
export const NEW_TEMPLATE_IDS = Object.keys(NEW_TEMPLATE_RESOLUTIONS) as NewTemplateId[];
export const isNewTemplate = (t: unknown): t is NewTemplateId => typeof t === "string" && (NEW_TEMPLATE_IDS as readonly string[]).includes(t);

/** Where each template is played (its outcome carries this as `ScenarioOutcome.region`; the debug command `outcome:<resolution>` reads it). Exhaustive. */
export const TEMPLATE_REGION: Readonly<Record<ScenarioTemplateId, RegionId>> = {
  secure_crossing: "kessar", hostage_rescue: "kessar", convoy_ambush: "kessar", border_incident: "kessar", succession_dispute: "highmark",
  mine_rescue: "vesper", claim_race: "vesper", smuggling_run: "saltmarket", flooded_market: "saltmarket", reapers_strike: "highmark", winding_engine: "vesper", outpost_raid: "kessar",
};

/** What one ending does to a minor power's mood (integer deltas, applied after the day's drift, clamped 0..100). */
export type MinorDelta = Partial<Pick<PowerState, "trust" | "fear" | "grievance" | "playerInfluence" | "rivalInfluence" | "militaryStrength" | "prosperity">>;

/** The NUMBERS of one ending. */
export interface EndingNumbers {
  /** `applyOutcome`'s rule (factions.ts `Rule`). A contract played away from Kessar leaves the crossing, the toll and the bridge alone (`toll: "keep"`, `control: undefined`) and carries NO `need`. */
  rule: Rule;
  /** What the Lamp-Warden's memory keeps of it before decay (news from far away reaches her late). */
  memory: { gratitude: number; resentment: number; contempt: number };
  /** The relation matrix nudges (`RELATION_FX`). Inside one template every pair of endings differs in >= 2 pairs. */
  relations: Partial<Record<PairKey, number>>;
  /** The Syndicate's grudge in points (`GRUDGE_FX`). */
  grudge: number;
  /** What the ending meant to each minor power (the powers' own `minorAfter`). */
  minors: Record<MinorPowerId, MinorDelta>;
  /** The dispatch the powers' log carries for the paper: kind `end_<resolution>` (copy under that key in `EndingCopy.news`), `a` the power it is about, `b` the other, if any. */
  news: { a: PowerId; b?: PowerId };
}

/** The AUTHORED COPY of one ending (scanned by `noRealWorld.test.ts`: it lives in a `*Text.ts` file). Every list has >= 3 variants except where noted. */
export interface EndingCopy {
  /** What HQ keeps of it (existing piece kinds and surfaces only; one object, one line). */
  piece: { kind: HqPieceKind; surface: HqSurface; label: string };
  /** What the Lamp-Warden says of it when you reach Kessar (>= 2). */
  memoryLine: readonly string[];
  /** The paper's headline and standfirst (placeholders {toll} {bridge} {dead} {routed} {wounded} {limbs} {civ} {spin} {purse} {lies}). */
  headlines: readonly string[];
  standfirsts: readonly string[];
  /** The ledger story's euphemism for what was done (>= 2). */
  siteLines: readonly string[];
  /** ONE plain line for the debrief card ("what changed"): terse, factual, a little sour; names the place. */
  debrief: string;
  /** The powers' dispatch (`{a}` `{b}` are the powers' short names, `{A}` capitalised). */
  news: NewsDef;
}

/**
 * Which resolutions satisfy a power's pledged FAVOUR (powersText HOOKS `satisfiedBy`) beyond the ones authored there: a region's home power may be pleased by its own region's endings.
 * Absent = nothing extra.
 */
export type FavourExtra = Partial<Record<MinorPowerId, readonly ResolutionId[]>>;

/** Builds `Record<K, E[F]>` from a table of rows: the central tables spread the result, and the compiler still insists every ending has its row. */
export function pluck<K extends string, E, F extends keyof E>(rows: Record<K, E>, field: F): Record<K, E[F]> {
  const out = {} as Record<K, E[F]>;
  for (const k of Object.keys(rows) as K[]) out[k] = rows[k][field];
  return out;
}

/** A row that changes nothing (the contract's placeholder: a package replaces every row it owns). The story a neutral row tells in the paper is `a` (and `b`). */
export const neutralNumbers = (a: PowerId, b?: PowerId): EndingNumbers => ({
  rule: { control: undefined, toll: "keep", ward: { trust: 0, fear: 0, grievance: 0, prosperity: 0, playerInfluence: 0, rivalInfluence: 0 }, lies: 0, rivalProsperity: 0, rivalGrievance: 0 },
  memory: { gratitude: 0, resentment: 0, contempt: 0 },
  relations: {},
  grudge: 0,
  minors: { brine: {}, reapers: {}, choir: {} },
  news: b === undefined ? { a } : { a, b },
});

/** What a region says in the places that are not an ending (authored in `<region>Text.ts`, gathered in `regionCopy.ts`). */
export interface RegionCopy {
  /** The chart's note for the region, from the ledger (`c.history`, `c.sites.ends`): plain text, no markup, <= 240 characters before the contract on offer is appended. */
  chartNote(c: CampaignState): string;
  /** Rich-presence lines (>= 2): `{day}` `{party}` are filled in. */
  presence: readonly string[];
  /** The parley sheet: the heading, and the asked line (`{price}` `{round}` `{mood}` are filled in). */
  parley: { heading: string; asked: string };
}

/** The powers' dispatches of a region's endings, keyed `end_<resolution>` (what `EndingNumbers.news` logs and `powersText` NEWS prints). */
export function endingNews(rows: Record<string, EndingCopy>): Record<string, NewsDef> {
  const out: Record<string, NewsDef> = {};
  for (const k of Object.keys(rows)) out[`end_${k}`] = rows[k]!.news;
  return out;
}
