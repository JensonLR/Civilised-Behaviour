import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Scene, Vector3 } from "three";
import { REGION_IDS, createRegionWorld, type RegionId } from "@cb/shared";
import { PRESETS } from "../Stage.ts";
import { createRegionView } from "./regionView.ts";
import { describeOverlap, overlaps, scenePieces, type OverlapPiece } from "./overlapAudit.ts";

/**
 * NOTHING PASSES THROUGH ANYTHING. In every region, with and without a town founded: no plant, stone or tree passes into anything built (a crown through a
 * roof, a bush in the keep, grass out of a ruin's stones, reeds through a stepping stone); nothing man-made passes into anything else; no animal passes into a
 * tree, a stone or a building, and no two animals stand in each other (sampled through time in `fauna.test.ts`). Plants in plants, and animals in the grass
 * they graze, are how things grow. A failure lists the worst pairs: both pieces (mesh#instance, centre, size) and how deep.
 */

const g = globalThis as unknown as Record<string, unknown>;
let saved: unknown;
beforeAll(() => {
  saved = g.document;
  const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : (): unknown => ({ addColorStop() {}, width: 10 })), set: (t, k, v) => ((t[k as string] = v), true) });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }), fonts: undefined };
});
afterAll(() => {
  g.document = saved;
});

const sun = new Vector3(-0.55, 0.62, 0.42).normalize();

/** What grows or lies wild (plants, stones, trees, crags); what is ground cover an animal grazes in; what moves on its own. Everything else is built. */
const NATURAL = /^(grass|cups|daisies|lilies|toadstools|ferns|bush|berry-bush|reeds|sedge|tufts|scrub|tamarisk|pebbles|barley|rock|boulders|outcrops|cliff|slab|log|stump|snags?|broadleaf|pine|birch|acacia|palms|mounds|hill-.*)$/;
const COVER = /^(grass|cups|daisies|lilies|toadstools|ferns|bush|berry-bush|reeds|sedge|tufts|scrub|tamarisk|pebbles|barley)$/;
const ANIMAL = /^(livestock|wildlife|herds)$/;
/** Not things at all: paint and lettering on the ground, falling water, fire, insects. */
const NOT_THINGS = /^(road-paint|hq-route-lettering|flood|falls|fire-pool|flame|butterflies)$/;
/** Bedded on purpose (as the ground audit allows): Vesper's outcrops lean into the cliffs and the rock mass the cloister is cut into. */
const BEDDED: readonly [string, string][] = [["outcrops", "vesper"]];

/** How deep two things may meet (m): a reed rooted level with a pool's 8 cm surface, a pebble half-sunk beside a stepping stone. */
const TOL = 0.12;
const ANIMAL_TOL = 0.05;

const built = (p: OverlapPiece): boolean => !NATURAL.test(p.mesh) && !ANIMAL.test(p.mesh);
const bedded = (a: OverlapPiece, b: OverlapPiece): boolean => BEDDED.some(([x, y]) => (a.mesh === x && b.mesh === y) || (a.mesh === y && b.mesh === x));

/** The pairs worth testing (asked both ways round): at least one is a placed thing (an instance), and one of the rules above covers the two. */
function judged(a: OverlapPiece, b: OverlapPiece): boolean {
  if (!a.instanced && !b.instanced) return false; // (two parts of the merged buildings: joined on purpose)
  if (bedded(a, b)) return false;
  if (ANIMAL.test(a.mesh)) return ANIMAL.test(b.mesh) ? a.mesh === b.mesh : !COVER.test(b.mesh);
  if (built(a)) return !built(b) || a.mesh !== b.mesh;
  return false;
}

function audit(id: RegionId, town: boolean): string[] {
  const world = createRegionWorld(id, 7, town ? { outpost: "town", telegraph: true, railway: true, works: true } : undefined);
  const view = createRegionView(id, new Scene(), world, PRESETS.medium, sun, 7);
  if (town) view.applyDress?.({ outpost: "town", rivalPost: 2, road: 2, telegraph: true, launch: true, name: "Fort Audit", railway: true, works: true });
  const pieces = scenePieces(view.root).filter((p) => !NOT_THINGS.test(p.mesh));
  const found = overlaps(pieces, judged, Math.min(TOL, ANIMAL_TOL)).filter((o) => o.depth > (ANIMAL.test(o.a.mesh) && ANIMAL.test(o.b.mesh) ? ANIMAL_TOL : TOL));
  view.dispose();
  return found.map(describeOverlap);
}

describe("nothing placed passes through anything else", () => {
  for (const id of REGION_IDS) {
    for (const town of [false, true]) {
      it(`${id}${town ? " with a town founded" : ""}: no plant, stone or tree through anything built, nothing built through anything else, no animal through a thing or another`, () => {
        const found = audit(id, town);
        expect(found.length, found.slice(0, 8).join("\n")).toBe(0);
      }, 180_000);
    }
  }
});
