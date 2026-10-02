import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as K from "../../catalog.ts";
import { sanitizeSpec, type CharacterSpec } from "../../spec.ts";
import { auditHead } from "../headAudit.ts";
import { clearCharacterCaches } from "../rig.ts";
import { measureHair, sheetClashes } from "./hairAudit.ts";
import { addedPrims, judgeFloating, judgePenetration, makeTag, measure } from "./penetration.ts";
import { FIT_SHAPES, hash2, plainBase } from "./shapes.ts";

/**
 * FIT COMBINATIONS (D-038, polish2 section 8). fit.test.ts sweeps ONE option at a time over a plain base; the cosmetics people see overlap when they are WORN TOGETHER. This sweeps the extreme
 * shape grid (the 34 named and slider-corner shapes of `FIT_SHAPES`) against every combination class and measures each combination's INTERACTION:
 *   hatHair      a hat over a hairstyle (and a hair ornament): hair edges that pass through the hat's sheets (a brim, a crown wall), in cm
 *   eyewearHat   spectacles under a hat and over the hair: eyewear edges through the hat or the hair, in cm
 *   longHair     a long style under a jacket, neckwear, a pack and a hat: the deepest hair vertex in the body, collar, cape or pack slab at rest and at the furthest sway
 *   neckwear     neckwear over a jacket's collar and a shirt, with shoulder gear: what the combination adds, judged against the body field
 *   shoulder     epaulettes, medals, a decoration and a pack over a jacket
 *   beltHip      a belt, a sash and hip gear over a jacket
 * Findings feed the table below (worst in cm and the count above the tolerance). Fix the generator or the fit engine, never the numbers; the table only goes DOWN (0.3 cm / 3 % slack).
 *   FITCOMBOS_SCALE=2  twice the samples per shape and class
 */

afterAll(() => clearCharacterCaches());

const SHAPES = FIT_SHAPES.slice(0, 34);
const SCALE = Number(process.env.FITCOMBOS_SCALE ?? 1);
const LONG = ["Long Lank", "Ponytail", "Plait", "Shaggy Mane", "Draped Fall", "Braid Crown", "Salt Locks", "Wrapped Plait", "Shoulder Curtain", "Tied Tail"].map((n) => K.HAIR_STYLES.indexOf(n as never));

/** Tolerance per metric (cm): a hair strand through a brim, hair in the body, a part on a part. */
const TOL = { hairHat: 0.8, eyewear: 0.8, hairBody: 0.3 } as const;

interface Row {
  key: string;
  cm: number;
  name: string;
  /** Tolerance in cm: a finding above it counts. */
  tol: number;
}
const rows: Row[] = [];
const note = (key: string, metres: number, name: string, tol = 0.8): void => void rows.push({ key, cm: Math.round(metres * 1000) / 10, name, tol });

const pick = <T,>(xs: readonly T[], h: number): T => xs[h % xs.length]!;
const nameOf = (s: CharacterSpec): string => `${K.HATS[s.hat]} / ${K.HAIR_STYLES[s.hair]} / ${K.EYEWEAR[s.eyewear]} / ${K.HAIR_ACCESSORIES[s.hairAcc]} / ${K.JACKETS[s.jacket]} / ${K.NECKWEAR[s.neckwear]} / ${K.PACKS[s.pack]} [belt ${K.BELTS[s.belt]}, sash ${K.SASHES[s.sash]}, hip ${K.HIP_GEAR[s.hipGear]}, epaulettes ${K.EPAULETTES[s.epaulettes]}, medals ${s.medals}, decoration ${K.DECORATIONS[s.decoration]}, shirt ${K.SHIRTS[s.shirt]}]`;

function headClasses(): void {
  SHAPES.forEach((shape, si) => {
    for (let k = 0; k < Math.round(8 * SCALE); k++) {
      const h = hash2(si * 131 + k, 11);
      const spec = sanitizeSpec({ ...plainBase(shape.spec), hat: 1 + (h % (K.HATS.length - 1)), hair: 1 + ((h >>> 5) % (K.HAIR_STYLES.length - 1)), hairAcc: (h >>> 11) % K.HAIR_ACCESSORIES.length, jacket: (h >>> 15) % K.JACKETS.length });
      const a = auditHead(spec);
      const hat = a.prims.filter((p) => p.label === "hat");
      const rho = a.P.headRadius * 1.2;
      const c = sheetClashes(a.prims.filter((p) => p.label === "hair"), hat, rho);
      note("hatHair.depth", c.depth, `${shape.name}: ${nameOf(spec)} (${c.crossings} edges)`, TOL.hairHat);
      const o = sheetClashes(a.prims.filter((p) => p.label === "hairAcc"), hat, rho);
      note("hairAccHat.depth", o.depth, `${shape.name}: ${nameOf(spec)} (${o.crossings} edges)`, TOL.hairHat);
      a.geo.dispose();
    }
    for (let k = 0; k < Math.round(6 * SCALE); k++) {
      const h = hash2(si * 977 + k, 23);
      const spec = sanitizeSpec({ ...plainBase(shape.spec), hat: 1 + (h % (K.HATS.length - 1)), eyewear: 1 + ((h >>> 6) % (K.EYEWEAR.length - 1)), hair: (h >>> 12) % K.HAIR_STYLES.length });
      const a = auditHead(spec);
      const eye = a.prims.filter((p) => p.label === "eyewear");
      const c = sheetClashes(eye, a.prims.filter((p) => p.label === "hat"), a.P.headRadius * 1.1);
      note("eyewearHat.depth", c.depth, `${shape.name}: ${nameOf(spec)} (${c.crossings} edges)`, TOL.eyewear);
      a.geo.dispose();
    }
    for (let k = 0; k < Math.round(3 * SCALE); k++) {
      const h = hash2(si * 313 + k, 41);
      const spec = sanitizeSpec({ ...plainBase(shape.spec), hair: pick(LONG, h), jacket: (h >>> 4) % K.JACKETS.length, neckwear: (h >>> 9) % K.NECKWEAR.length, pack: (h >>> 14) % K.PACKS.length, hat: (h >>> 18) % 3 === 0 ? 0 : (h >>> 20) % K.HATS.length });
      const m = measureHair(spec);
      note("longHair.depth", Math.max(m.rest, m.sway), `${shape.name}: ${nameOf(spec)}`, TOL.hairBody);
    }
  });
}

/** What a combination of body-worn options adds over the same base without them, judged against the body field (penetration, sink, floating). */
function bodyClass(klass: string, fields: readonly (keyof CharacterSpec)[], draw: (h: number, spec: Record<string, number>) => void, perShape: number): void {
  SHAPES.forEach((shape, si) => {
    for (let k = 0; k < Math.round(perShape * SCALE); k++) {
      const h = hash2(si * 7919 + k, klass.length * 31 + 5);
      const base = { ...plainBase(shape.spec), jacket: 1 + ((h >>> 3) % (K.JACKETS.length - 1)), shirt: (h >>> 9) % K.SHIRTS.length } as unknown as Record<string, number>;
      const full = { ...base };
      draw(h, full);
      for (const f of fields) base[f as string] = 0;
      const spec = sanitizeSpec(full);
      const b = measure(sanitizeSpec(base));
      const m = measure(spec);
      try {
        const added = addedPrims(b.prims, m.prims);
        const tag = makeTag(klass, 0, shape.name);
        for (const f of [...judgePenetration(m, added, tag), ...judgeFloating(m, added, tag)]) note(`${klass}.${f.metric}`, f.value, `${f.kind}@${f.bone} ${shape.name}: ${nameOf(spec)}`, f.tol * 100);
      } finally {
        b.rig.dispose();
        m.rig.dispose();
      }
    }
  });
}

describe("fit combinations on the extreme shape grid", () => {
  it("hat x hair x ornament, eyewear x hat, long hair x jacket x neckwear x pack x hat", () => {
    headClasses();
  }, 3_000_000);

  it("neckwear x collar x shoulder gear; shoulder gear over a jacket; belt x sash x hip gear", () => {
    bodyClass("neckwear", ["neckwear", "pack", "epaulettes"], (h, s) => ((s.neckwear = 1 + (h % (K.NECKWEAR.length - 1))), (s.pack = (h >>> 12) % K.PACKS.length), (s.epaulettes = (h >>> 17) % K.EPAULETTES.length)), 3);
    bodyClass("shoulder", ["epaulettes", "medals", "decoration", "pack"], (h, s) => ((s.epaulettes = 1 + (h % (K.EPAULETTES.length - 1))), (s.medals = 1 + ((h >>> 5) % 5)), (s.decoration = (h >>> 9) % K.DECORATIONS.length), (s.pack = (h >>> 13) % K.PACKS.length)), 3);
    bodyClass("beltHip", ["belt", "sash", "hipGear"], (h, s) => ((s.belt = 1 + (h % (K.BELTS.length - 1))), (s.sash = (h >>> 5) % K.SASHES.length), (s.hipGear = 1 + ((h >>> 9) % (K.HIP_GEAR.length - 1)))), 3);
  }, 3_000_000);

  it("stays within the ratchet", () => {
    const keys = [...new Set(rows.map((r) => r.key))].sort();
    const summary: Record<string, { worstCm: number; count: number; worst: string[] }> = {};
        for (const key of keys) {
      const rs = rows.filter((r) => r.key === key).sort((a, b) => b.cm - a.cm);
      const above = rs.filter((r) => r.cm > r.tol);
      summary[key] = { worstCm: rs[0]!.cm, count: above.length, worst: rs.slice(0, 4).map((r) => `${r.cm} ${r.name}`) };
    }
    const out = resolve(__dirname, "../../../../../test-results/fit-combos-report.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ rows: rows.length, ratchet: RATCHET, summary }, null, 1));
    const lines = keys.map((k) => `${k}: ${summary[k]!.count} above tolerance, worst ${summary[k]!.worstCm} cm (limit ${RATCHET[k]?.worstCm ?? "none"} cm / ${RATCHET[k]?.count ?? "none"})`);
    if (process.env.FITCOMBOS_VERBOSE) process.stdout.write(`${lines.join("\n")}\n`);
    for (const k of keys) {
      const r = RATCHET[k];
      expect(r, `no ratchet entry for ${k}: add it (today's numbers)\n${lines.join("\n")}`).toBeDefined();
      expect(summary[k]!.worstCm, `${k} worst\n${lines.join("\n")}`).toBeLessThanOrEqual(r!.worstCm + 0.3);
      expect(summary[k]!.count, `${k} count\n${lines.join("\n")}`).toBeLessThanOrEqual(Math.ceil(r!.count * 1.03) + 1);
    }
  });
});

/** Worst in cm and number of combinations above the tolerance, as of the day this test was written (D-038). Lower them when a fix lands. */
const RATCHET: Record<string, { worstCm: number; count: number }> = {
  "hatHair.depth": { worstCm: 0, count: 0 }, // (was 6.9 cm / 22 before nightcap and dust-wrap tails lay outside the hair; a strand through a brim is zero)
  "hairAccHat.depth": { worstCm: 2.2, count: 7 }, // (combs and pins under wide brims)
  "eyewearHat.depth": { worstCm: 3.8, count: 18 }, // (was 5.3 / 112, then 3.8 / 25; D-047 keeps the front of every brim up over spectacles: the rest are straps and arms meeting a brim swept down behind, the sou'wester's and the topee's)
  "longHair.depth": { worstCm: 0.2, count: 0 }, // (was 4.1 cm at the start of the pass; the target is 0.3)
  "neckwear.accessoryPenetration": { worstCm: 2.2, count: 8 }, // (a neckerchief meeting a pack strap)
  "neckwear.accessorySink": { worstCm: 0.9, count: 40 }, // (epaulette fringe; was 1.3 / 100)
  "shoulder.accessoryPenetration": { worstCm: 1.2, count: 3 },
  "shoulder.accessorySink": { worstCm: 1.0, count: 64 }, // (was 1.4 / 136)
  "beltHip.accessoryPenetration": { worstCm: 2.4, count: 31 }, // (a bandolier over a coat's skirt with hip gear; was 3.3 / 34)
  "beltHip.accessorySink": { worstCm: 1.1, count: 1 }, // (was 1.9 / 13)
};
