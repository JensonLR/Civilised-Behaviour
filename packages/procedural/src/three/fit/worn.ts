import { computeProportions } from "../../proportions.ts";
import type { CharacterSpec } from "../../spec.ts";
import type { Ring } from "../loft.ts";
import type { BodyCtx } from "../bodyKit.ts";
import { foreArmRings, lowerLegPlan } from "../limbRings.ts";
import { pelvisTopRings } from "./skirtShape.ts";
import { ponchoRings, capeRings } from "../drape.ts";
import { closedSkirtLength, skirtRings, skirtSpec } from "../garments.ts";
import { upperArmRings, upperLegRings } from "../limbs.ts";
import { makeBodyField, type BodyField, type WornRings } from "./bodyField.ts";
import { torsoRings } from "./torsoShape.ts";
import { hairBlockers } from "./hairBlockers.ts";

/**
 * The worn layer of the body field: the outermost body-following surface of the spec (sleeves, trouser legs, the coat skirt, the poncho's panel), built from the
 * SAME ring tables the garments are lofted from. Lives apart from bodyField.ts because it needs limbs.ts / drape.ts / garments.ts (which need bodyField.ts).
 */

/** A minimal BodyCtx: enough for the ring tables (colours are irrelevant to shape). */
export function shapeCtx(spec: CharacterSpec): BodyCtx {
  const P = computeProportions(spec);
  return { spec, P, skin: 0, jacketC: 0, trouserC: 0, shirtC: 0, armC: 0, accent: 0, burnt: 0, footH: 0.05 * P.scale, leather: 0 };
}

/** Pelvis rings as buildPelvis lofts them (the trouser top), and the coat skirt below it when the jacket has one. */
function pelvisWorn(c: BodyCtx): Ring[] {
  const { spec, P } = c;
  const sk = skirtSpec(spec, P);
  if (!sk || sk.len <= 0) return pelvisTopRings(c);
  // (the open coats are cut away at the front, but the sections below are what a strap, a scabbard or a sword hilt must clear)
  return skirtRings(c, sk.len, sk.flare, 0, 0, upperLegRings(c), sk.open);
}

/** The forearm as the sleeve (or the shirt cuff) makes it: limbRings.ts `foreArmRings` is the table the forearm is lofted from. */
const foreArmWorn = (c: BodyCtx): Ring[] => foreArmRings(c);

/** The whole lower leg as a player sees it (the trouser down to the boot's lip, then the shaft): limbRings.ts `lowerLegPlan(c).surface`, the table the leg and its details are built from. */
const lowerLegWorn = (c: BodyCtx): Ring[] => lowerLegPlan(c).surface;

/** The worn rings of every region for a spec. */
export function wornRings(spec: CharacterSpec, forHair = false): WornRings {
  const c = shapeCtx(spec);
  const { P } = c;
  const j = spec.jacket;
  return {
    ...(forHair ? { drape: hairBlockers(spec, P) } : {}),
    // a poncho's panel is what a player sees on the trunk; a cape's mantle only covers the shoulders and back, so the trunk keeps its own cut
    torso: j === 7 ? ponchoRings(P, 0) : torsoRings(P, 0, j === 6 ? 0 : j),
    pelvis: pelvisWorn(c),
    upperArm: upperArmRings(P, 0, j),
    foreArm: foreArmWorn(c),
    upperLeg: upperLegRings(c),
    lowerLeg: lowerLegWorn(c),
    slimLeg: closedSkirtLength(spec, P) > 0,
  };
}

/** The complete body field for a spec: skin core plus the real worn layer. This is the one to use in tests and in builders that already import limbs/garments. */
export function bodyField(spec: CharacterSpec): BodyField {
  return makeBodyField(spec, wornRings(spec));
}

export { capeRings };
