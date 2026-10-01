import { runLineup } from "./Lineup.ts";

/**
 * The fictional peoples' lineup (`?showcase=peoples`, D-038). A thin wrapper over the character lineup (`Lineup.ts`: every option there works here too, so a still can be framed any way):
 *   people=kessarine|mereborn|marchers|vesperine|brinefolk|wayfarers|all   which people (default all: one of each of the five, then the Wayfarers' mix)
 *   n=6          figures (default 6)          seed=N   the row's base seed
 *   back=1       from behind (hair, cloaks, packs)       turns=...   per-figure yaw (see the lineup)
 *   frame=body|upper|head|skull|legs   the frame (default body)
 * Everything the lineup takes (set=, vary=, lod=, gore=, close=) passes through.
 *
 * WIRING (integrator): `main.ts` has one branch per showcase; add `else if (showcase === "peoples") { const { runPeoples } = await import("./showcase/Peoples.ts"); runPeoples(canvas, params); }`
 * beside the lineup's (until then `?showcase=lineup&people=all` is the same picture).
 */
export function runPeoples(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const p = new URLSearchParams(params);
  if (!p.has("people")) p.set("people", "all");
  if (!p.has("n")) p.set("n", "6");
  if (!p.has("frame")) p.set("frame", "body");
  if (!p.has("act")) p.set("act", "0");
  if (p.get("back") === "1" && !p.has("turns")) p.set("turns", "3.14");
  p.set("showcase", "lineup");
  runLineup(canvas, p);
}
