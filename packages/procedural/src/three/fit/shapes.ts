import { FIELDS, generateCharacter, sanitizeSpec, type CharacterSpec, type FieldDef, type FieldKey } from "../../spec.ts";

/**
 * The body shapes the fit audit sweeps, and the plain dressed base every option is compared against. Shared by fit.test.ts and by anyone (agents on heads, limbs) who
 * wants to run the same shapes through their own checks: `import { FIT_SHAPES, plainBase, needsFor } from "./fit/shapes.ts"`.
 */

export interface FitShape {
  name: string;
  spec: CharacterSpec;
}

const SLIDERS = ["height", "headScale", "torsoWidth", "torsoDepth", "belly", "shoulderWidth", "armLength", "legLength", "handScale", "footScale", "noseScale", "earScale", "jaw", "posture"] as const;

const neutral = (): Record<string, number> => {
  const s = { ...generateCharacter(7) } as Record<string, number>;
  for (const k of SLIDERS) s[k] = 128;
  return s;
};
const withSliders = (o: Record<string, number>): CharacterSpec => sanitizeSpec({ ...neutral(), ...o });

/** The two bodies from the user's bug reports: they are ALWAYS in a sweep. */
export const STUBBY_WIDE = withSliders({ torsoWidth: 255, belly: 255, height: 40, legLength: 20, headScale: 255 });
export const TALL_THIN = withSliders({ torsoWidth: 0, belly: 0, height: 255, legLength: 255, headScale: 0, shoulderWidth: 0 });

/** Corners of the sliders that change fit: each one at 0 and 255 with the rest neutral, a few named extremes and 40 generated people. */
export const FIT_SHAPES: readonly FitShape[] = (() => {
  const out: FitShape[] = [
    { name: "stubbyWide", spec: STUBBY_WIDE },
    { name: "tallThin", spec: TALL_THIN },
    { name: "neutral", spec: withSliders({}) },
    { name: "gorilla", spec: withSliders({ shoulderWidth: 255, armLength: 255, handScale: 255, footScale: 255, torsoWidth: 220 }) },
    { name: "pinhead", spec: withSliders({ headScale: 0, jaw: 0, noseScale: 0, earScale: 0, shoulderWidth: 255, torsoWidth: 200 }) },
    { name: "beachBall", spec: withSliders({ belly: 255, torsoWidth: 60, shoulderWidth: 40, height: 90 }) },
    { name: "hipsAndLegs", spec: withSliders({ legLength: 255, torsoWidth: 255, belly: 0, height: 255, shoulderWidth: 30 }) },
    { name: "bigHeadThin", spec: withSliders({ headScale: 255, jaw: 255, noseScale: 255, earScale: 255, torsoWidth: 0, shoulderWidth: 0 }) },
  ];
  for (const k of ["torsoWidth", "belly", "height", "legLength", "headScale", "shoulderWidth", "armLength", "handScale", "footScale", "jaw", "noseScale", "earScale", "torsoDepth"] as const) {
    out.push({ name: `${k}:0`, spec: withSliders({ [k]: 0 }) }, { name: `${k}:255`, spec: withSliders({ [k]: 255 }) });
  }
  for (let i = 0; i < 40; i++) out.push({ name: `seed${i}`, spec: generateCharacter(1000 + i * 7) });
  return out;
})();

/** Stable small hash for choosing which shapes an option is tried on. */
export const hash2 = (a: number, b: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
};

/** A plain, fully dressed base: every optional extra off, so a single option shows up as a difference. */
export const plainBase = (s: CharacterSpec): CharacterSpec => ({
  ...s,
  hat: 0, hair: 1, moustache: 0, beard: 0, sideburns: 0, eyewear: 0, jacket: 1, shirt: 0, trousers: 0, boots: 1, belt: 0, sash: 0, medals: 0, neckwear: 0,
  pack: 0, hipGear: 0, gloves: 0, scars: 0, teeth: 0, eyepatch: 0, burnt: 0, woodenLeg: 0, hook: 0, brows: 0, eyeShape: 0, eyeColor: 0, earShape: 0,
  stubble: 0, greying: 0, age: 0, complexion: 0, mark: 0, facePaint: 0, tattoo: 0, earring: 0, ring: 0, epaulettes: 0, decoration: 0, coatTrim: 0,
  trouserTrim: 0, hatTrim: 0, shirtColor: 0, bootColor: 0, noseStyle: 0, medalStyle: 0, buckle: 0, cuffDetail: 0, laces: 0, pocket: 0, hairAcc: 0, patchStyle: 0, scarStyle: 0,
});

/** What an option needs around it to be visible at all (same idea as audit.test.ts). */
export const NEEDS: Partial<Record<FieldKey, Partial<CharacterSpec>>> = {
  hatTrim: { hat: 6 },
  hatColor: { hat: 6 },
  shirt: { jacket: 3 },
  shirtColor: { jacket: 0 },
  trouserTrim: { trousers: 1 },
  greying: { hair: 1, moustache: 1, beard: 1 },
  epaulettes: { jacket: 2 },
  decoration: { jacket: 2 },
  coatTrim: { jacket: 2 },
  accentColor: { jacket: 2, medals: 2 },
  medalStyle: { jacket: 2, medals: 3 },
  buckle: { belt: 1, jacket: 2 },
  cuffDetail: { jacket: 2 },
  laces: { boots: 1 },
  pocket: { jacket: 2 },
  hairAcc: { hair: 1, hat: 0 },
  patchStyle: { eyepatch: 1 },
  scarStyle: { scars: 1 },
};

export const needsFor = (key: string): Partial<CharacterSpec> => NEEDS[key as FieldKey] ?? {};

/** Every option value of a field worth sweeping: choices 1..max (0 is "off"), flags by bit, sliders at 220; colours are sampled. */
export function optionValues(f: FieldDef): number[] {
  const values: number[] = [];
  if (f.kind === "flags") for (let bit = 1; bit <= f.max; bit <<= 1) values.push(bit);
  else if (f.kind === "slider") values.push(220);
  else for (let v = 1; v <= f.max; v++) values.push(v);
  return f.options ? values : values.filter((v, i) => i % 3 === 0 || v === f.max);
}

/** The fields of the sweep: every choice / flags field (sliders are body shapes, not options). */
export const sweepFields = (): FieldDef[] => (FIELDS as readonly FieldDef[]).filter((f) => f.kind !== "slider" && f.group !== "colour");

/** Jackets a coat-worn accessory is tried over (rotates with the shape index): all eleven cuts get covered across a sweep. */
export const JACKET_ROTATION = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0] as const;
