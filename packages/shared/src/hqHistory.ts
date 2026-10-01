import { CAMP, hqPlan } from "./camp.ts";
import type { CampaignState } from "./campaignTypes.ts";
import { HISTORY_PIECE, MODEL_LABEL, PENNANT_LABEL, type HqPieceKind, type HqSurface } from "./outpostText.ts";
import type { OutpostStage, SettlementsState } from "./worldTypes.ts";

/**
 * HQ decorated by what the campaign has done (D-035): a pure, deterministic list of at most twelve pieces placed ONLY on surfaces `hqPlan()`/`CAMP` already have, so there is no new
 * collider and no `camp.ts` edit: the planning table (the map table, with a scale model of the outpost at its centre), the strongbox, and the marquee's back wall (pictures,
 * pennants). `HISTORY_PIECE` is `Record<ResolutionId, ...>` (outpostText.ts): a new ending must decide what the camp keeps of it.
 */

export const HISTORY_MAX = 12;
export const HISTORY_ENDINGS = 7;
/** Scale of the outpost model on the table (the stage ring is 32 m: 0.4 m on the table). */
export const MODEL_SCALE = 0.0125;

export interface HqHistoryPiece {
  id: string;
  kind: HqPieceKind;
  surface: HqSurface;
  /** World centre of the piece's base (x, z) and the height of that base above the ground (y is OVER the ground, add `terrainHeight`). */
  x: number;
  z: number;
  /** Height above the ground at the surface it stands on / hangs from, and the piece's own footprint half-extents and height. */
  base: number;
  hx: number;
  hz: number;
  height: number;
  yaw: number;
  label: string;
  /** A model only: the stage it shows. */
  stage?: OutpostStage;
  /** A pennant only: which infrastructure it flags. */
  tech?: "road" | "telegraph" | "launch";
}

const T = CAMP.mapTable;
const TABLE_SLOTS: readonly (readonly [number, number])[] = [[-0.6, -0.28], [0.6, -0.28], [0.6, 0.28], [-0.6, 0.28]];   // corners; the centre is the model's
const CHEST_SLOTS: readonly (readonly [number, number])[] = [[-0.24, 0], [0.24, 0]];
const WALL_ROWS = [1.55, 2.0] as const;
const WALL_LZ = [-2.0, -1.3, -0.6, 0.1] as const;

const rot = (cx: number, cz: number, yaw: number, u: number, v: number): { x: number; z: number } => ({ x: cx + u * Math.cos(yaw) - v * Math.sin(yaw), z: cz + u * Math.sin(yaw) + v * Math.cos(yaw) });

const SIZE: Record<HqPieceKind, { hx: number; hz: number; h: number }> = {
  lamp: { hx: 0.09, hz: 0.09, h: 0.26 }, bridge: { hx: 0.14, hz: 0.07, h: 0.1 }, portrait: { hx: 0.2, hz: 0.02, h: 0.3 }, crate: { hx: 0.12, hz: 0.12, h: 0.2 }, frame: { hx: 0.17, hz: 0.015, h: 0.24 },
  stone: { hx: 0.07, hz: 0.07, h: 0.14 }, board: { hx: 0.16, hz: 0.03, h: 0.2 }, key: { hx: 0.06, hz: 0.03, h: 0.02 }, pennant: { hx: 0.22, hz: 0.01, h: 0.3 }, model: { hx: 0.4, hz: 0.4, h: 0.12 },
  envelope: { hx: 0.1, hz: 0.07, h: 0.02 }, barrel: { hx: 0.04, hz: 0.04, h: 0.3 },
};

/** At most twelve pieces for this campaign: the last seven endings, the outpost's model, a pennant per infrastructure. Deterministic from state alone. */
export function historyPieces(c: CampaignState, s: SettlementsState): HqHistoryPiece[] {
  const want: { id: string; kind: HqPieceKind; surface: HqSurface; label: string; stage?: OutpostStage; tech?: HqHistoryPiece["tech"] }[] = [];
  for (const h of c.history.slice(-HISTORY_ENDINGS)) {
    const d = HISTORY_PIECE[h.resolution];
    want.push({ id: `end:${h.seq}`, kind: d.kind, surface: d.surface, label: d.label });
  }
  const post = s.posts.kessar;
  const model = post && post.stage !== "none" ? post.stage : undefined;
  for (const t of ["road", "telegraph", "launch"] as const) {
    const on = t === "road" ? s.tech.road > 0 : s.tech[t];
    if (on) want.push({ id: `tech:${t}`, kind: "pennant", surface: "wall", label: PENNANT_LABEL[t], tech: t });
  }
  const out: HqHistoryPiece[] = [];
  const used = { table: 0, chest: 0, wall: 0 };
  const plan = hqPlan();
  const m = plan.marquee;
  const ch = plan.chest;
  const at = (lx: number, lz: number): { x: number; z: number } => rot(m.x, m.z, m.yaw, lx, lz);
  if (model) {
    const p = rot(T.x, T.z, T.yaw, 0, 0);
    const z = SIZE.model;
    out.push({ id: "model:kessar", kind: "model", surface: "table", x: p.x, z: p.z, base: T.height, hx: z.hx, hz: z.hz, height: z.h, yaw: T.yaw, label: MODEL_LABEL, stage: model });
  }
  for (const w of want) {
    if (out.length >= HISTORY_MAX) break;
    const sz = SIZE[w.kind];
    if (w.surface === "table") {
      const slot = TABLE_SLOTS[used.table++];
      if (!slot) continue;
      const p = rot(T.x, T.z, T.yaw, slot[0], slot[1]);
      out.push({ id: w.id, kind: w.kind, surface: "table", x: p.x, z: p.z, base: T.height, hx: sz.hx, hz: sz.hz, height: sz.h, yaw: T.yaw + 0.4 * (slot[0] > 0 ? 1 : -1), label: w.label });
    } else if (w.surface === "chest") {
      const slot = CHEST_SLOTS[used.chest++];
      if (!slot) continue;
      const p = rot(ch.x, ch.z, ch.yaw, slot[0], slot[1]);
      out.push({ id: w.id, kind: w.kind, surface: "chest", x: p.x, z: p.z, base: ch.height, hx: sz.hx, hz: sz.hz, height: sz.h, yaw: ch.yaw, label: w.label });
    } else {
      const i = used.wall++;
      const row = WALL_ROWS[Math.floor(i / WALL_LZ.length)];
      const lz = WALL_LZ[i % WALL_LZ.length];
      if (row === undefined || lz === undefined) continue;
      const p = at(-m.hx + 0.16 + sz.hz, lz);
      out.push({ id: w.id, kind: w.kind, surface: "wall", x: p.x, z: p.z, base: row - sz.h / 2, hx: sz.hz, hz: sz.hx, height: sz.h, yaw: m.yaw, label: w.label, ...(w.tech ? { tech: w.tech } : {}) });
    }
  }
  return out;
}
