import { FIELDS, type CharacterSpec, type FieldDef } from "../../spec.ts";
import { addedPrims, judgeFloating, judgePenetration, judgePoseClip, makeTag, measure, POSES, type Finding, type FitPrim, type Measured, type PoseDef } from "./penetration.ts";
import { FIT_SHAPES, hash2, JACKET_ROTATION, needsFor, optionValues, plainBase, sweepFields, type FitShape } from "./shapes.ts";

/**
 * The option sweep behind fit.test.ts (and usable from a script): for every option of every wearable field, on a set of body shapes, build the character, take what the
 * option ADDED over the plain base, and judge it (penetration, floating, and optionally clipping in the animator's extreme poses).
 */

export interface SweepOptions {
  /** Shapes each option is tried on: the two bug-report bodies always, plus this many more, chosen by a stable hash of the option so a sweep covers them all over the catalog. */
  extraShapes?: number;
  /** Restrict to some fields. */
  fields?: readonly string[];
  /** Pose clipping runs on the first N shapes only (it is the expensive check). 0 = off. */
  poseShapes?: number;
  poses?: readonly PoseDef[];
  /** Called for each finished build (progress). */
  onBuild?: () => void;
}

/** Fields whose pieces move with limbs or hang near them: worth the pose check. */
export const POSE_FIELDS: ReadonlySet<string> = new Set(["jacket", "coatTrim", "pack", "hipGear", "belt", "sash", "epaulettes", "decoration", "trousers", "boots", "pocket", "cuffDetail", "trouserTrim", "medals", "neckwear"]);

export interface OptionCase {
  field: FieldDef;
  value: number;
  shape: FitShape;
  /** The jacket the option is worn over (for coat-borne accessories). */
  jacket: number;
}

/** The (option, shape) pairs a sweep covers. */
export function sweepCases(o: SweepOptions = {}): OptionCase[] {
  const extra = o.extraShapes ?? 4;
  const cases: OptionCase[] = [];
  const fixed = FIT_SHAPES.slice(0, 2);
  const rest = FIT_SHAPES.slice(2);
  for (const f of sweepFields()) {
    if (o.fields && !o.fields.includes(f.key)) continue;
    const fi = (FIELDS as readonly FieldDef[]).indexOf(f);
    for (const v of optionValues(f)) {
      const shapes = [...fixed];
      for (let k = 0; k < extra; k++) shapes.push(rest[hash2(fi * 131 + v, k) % rest.length]!);
      for (const shape of new Set(shapes)) {
        const jacket = JACKET_ROTATION[hash2(fi * 17 + v, shape.name.length + shape.name.charCodeAt(shape.name.length - 1)) % JACKET_ROTATION.length]!;
        cases.push({ field: f, value: v, shape, jacket });
      }
    }
  }
  // (shape-major, then jacket: consecutive cases share their base build)
  return cases.sort((a, b) => (a.shape.name + a.jacket).localeCompare(b.shape.name + b.jacket));
}

/** The specs (base, with the option) of a case. */
export function caseSpecs(c: OptionCase): { base: CharacterSpec; spec: CharacterSpec } {
  const needs = needsFor(c.field.key);
  const base = { ...plainBase(c.shape.spec), ...(needs.jacket === undefined ? { jacket: c.jacket } : {}), ...needs } as Record<string, number>;
  if (c.field.key === "jacket") base.jacket = 0;
  else if (base[c.field.key] === c.value) base[c.field.key] = 0;
  return { base: base as unknown as CharacterSpec, spec: { ...base, [c.field.key]: c.value } as unknown as CharacterSpec };
}

let cachedKey = "";
let cachedBase: Measured | undefined;
const baseOf = (spec: CharacterSpec): Measured => {
  const key = JSON.stringify(spec);
  if (key !== cachedKey || !cachedBase) {
    cachedBase?.rig.dispose();
    cachedBase = measure(spec);
    cachedKey = key;
  }
  return cachedBase;
};

/** Runs one case. `poses` = also run the pose check. */
export function runCase(c: OptionCase, poses: boolean, poseList: readonly PoseDef[] = POSES): { findings: Finding[]; added: FitPrim[] } {
  const { base, spec } = caseSpecs(c);
  const b = baseOf(base);
  const m = measure(spec);
  try {
    const added = addedPrims(b.prims, m.prims);
    const tag = makeTag(c.field.key, c.value, c.shape.name);
    const findings = [...judgePenetration(m, added, tag), ...judgeFloating(m, added, tag)];
    if (poses && POSE_FIELDS.has(c.field.key)) findings.push(...judgePoseClip(m, tag, poseList, added));
    return { findings, added };
  } finally {
    m.rig.dispose();
  }
}
