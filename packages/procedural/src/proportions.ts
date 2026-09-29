import type { CharacterSpec } from "./spec.ts";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const n = (v: number): number => v / 255;

/**
 * All body dimensions in metres, derived purely from the spec. The visual body is fitted into a fixed
 * collision envelope (CHARACTER in @cb/shared: radius 0.4, height 1.8) so customisation can never
 * change gameplay: height without headwear is normalised into [MIN_HEIGHT, MAX_HEIGHT].
 */
export interface Proportions {
  scale: number;
  legUpper: number;
  legLower: number;
  hipWidth: number;
  torsoHeight: number;
  torsoWidth: number;
  torsoDepth: number;
  bellyRadius: number;
  bellyForward: number;
  shoulderHalfWidth: number;
  armUpper: number;
  armLower: number;
  armRadius: number;
  handRadius: number;
  footLength: number;
  footWidth: number;
  headRadius: number;
  neck: number;
  noseLength: number;
  earSize: number;
  jawSize: number;
  /** Forward torso lean in radians (posture). Positive = stooped. */
  lean: number;
  /** Feet-to-crown height excluding headwear. */
  totalHeight: number;
  /** Largest half-width of the body at any point (belly, shoulders, elbows out). */
  halfWidth: number;
  /** Largest depth from centre (belly/nose), used for the front of the silhouette. */
  frontReach: number;
}

export const MIN_HEIGHT = 1.4;
export const MAX_HEIGHT = 1.95;
export const MAX_HALF_WIDTH = 0.6;

export function computeProportions(s: CharacterSpec): Proportions {
  const legTotal = lerp(0.3, 0.92, n(s.legLength));
  const legUpper = legTotal * 0.5;
  const legLower = legTotal * 0.5;
  const torsoHeight = lerp(0.5, 0.72, n(s.torsoDepth) * 0.3 + n(s.height) * 0.7);
  const torsoWidth = lerp(0.26, 0.5, n(s.torsoWidth));
  const torsoDepth = lerp(0.2, 0.42, n(s.torsoDepth));
  const bellyRadius = lerp(0.0, 0.22, n(s.belly));
  const bellyForward = lerp(0.0, 0.3, n(s.belly));
  const headRadius = lerp(0.2, 0.5, n(s.headScale));
  const neck = 0.05;
  const armTotal = lerp(0.52, 0.92, n(s.armLength));
  const lean = lerp(0.42, -0.05, n(s.posture)); // posture 0 = deeply stooped, 255 = ramrod straight

  let p: Proportions = {
    scale: 1,
    legUpper,
    legLower,
    hipWidth: torsoWidth * 0.34,
    torsoHeight,
    torsoWidth,
    torsoDepth: torsoDepth + bellyRadius,
    bellyRadius,
    bellyForward,
    shoulderHalfWidth: lerp(0.2, 0.36, n(s.shoulderWidth)) + torsoWidth * 0.1,
    armUpper: armTotal * 0.5,
    armLower: armTotal * 0.5,
    armRadius: lerp(0.065, 0.1, n(s.torsoWidth) * 0.5 + n(s.handScale) * 0.5),
    handRadius: lerp(0.07, 0.19, n(s.handScale)),
    footLength: lerp(0.26, 0.58, n(s.footScale)),
    footWidth: lerp(0.11, 0.24, n(s.footScale)),
    headRadius,
    neck,
    noseLength: lerp(0.07, 0.44, n(s.noseScale)) * (headRadius / 0.3),
    earSize: lerp(0.04, 0.17, n(s.earScale)) * (headRadius / 0.3),
    jawSize: lerp(0.7, 1.35, n(s.jaw)),
    lean,
    totalHeight: 0,
    halfWidth: 0,
    frontReach: 0,
  };

  // Fit the whole figure into the gameplay envelope by uniform scaling.
  const rawHeight = p.legUpper + p.legLower + 0.1 + p.torsoHeight + p.neck + p.headRadius * 2;
  const targetHeight = lerp(1.5, 1.85, n(s.height));
  const k = targetHeight / rawHeight;
  p = scaleProportions(p, k);
  p.totalHeight = p.legUpper + p.legLower + 0.1 * k + p.torsoHeight + p.neck + p.headRadius * 2;
  p.halfWidth = Math.max(p.torsoWidth / 2 + p.bellyRadius * 0.5, p.shoulderHalfWidth + p.armRadius, p.headRadius + p.earSize * 0.4);
  p.frontReach = Math.max(p.torsoDepth / 2 + p.bellyForward, p.headRadius + p.noseLength * 0.6);
  // If bulk still exceeds the envelope width, slim the widest parts (never the height).
  if (p.halfWidth > MAX_HALF_WIDTH) {
    const w = MAX_HALF_WIDTH / p.halfWidth;
    p.torsoWidth *= w;
    p.bellyRadius *= w;
    p.shoulderHalfWidth *= w;
    p.armRadius *= Math.max(w, 0.85);
    p.halfWidth = MAX_HALF_WIDTH;
  }
  return p;
}

function scaleProportions(p: Proportions, k: number): Proportions {
  const out = { ...p, scale: k };
  for (const key of [
    "legUpper", "legLower", "hipWidth", "torsoHeight", "torsoWidth", "torsoDepth", "bellyRadius", "bellyForward",
    "shoulderHalfWidth", "armUpper", "armLower", "armRadius", "handRadius", "footLength", "footWidth", "headRadius",
    "neck", "noseLength", "earSize",
  ] as const) out[key] = p[key] * k;
  return out;
}
