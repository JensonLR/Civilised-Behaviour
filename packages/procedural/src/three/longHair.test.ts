import { afterAll, describe, expect, it } from "vitest";
import * as K from "../catalog.ts";
import { generateCharacter, sanitizeSpec, type CharacterSpec } from "../spec.ts";
import { measureHair as measureHairOf } from "./fit/hairAudit.ts";
import { FIT_SHAPES, hash2, plainBase } from "./fit/shapes.ts";
import { auditHead } from "./headAudit.ts";
import { Mesh } from "three";
import { buildCharacter, clearCharacterCaches } from "./rig.ts";

/**
 * LONG HAIR (D-038, polish2 section 8): the long styles drape, lie on the shoulders and go AROUND collars, neckwear, capes and back packs, never through them. Method: the head is
 * built with the primitive audit on (headAudit.ts labels every primitive with the feature that made it); every hair vertex, at rest AND at the furthest sway (every corner of the box the animator
 * may drive), is measured against the body field with the hair's own obstacles (`WornRings.drape`: the collar, the neckwear, the cape's mantle, the pack's slab; fit/hairBlockers.ts) and the torso,
 * neck and arms. A vertex may sit 0.3 cm inside (the same slack the sway limits use), no more. The sample is deterministic: every long style x a spread of shapes, jackets, neckwear, packs and hats.
 *   LONGHAIR_SAMPLES=3   shapes' worth of extra samples per style (default 1 pass over the 34 named and slider-corner shapes)
 */

afterAll(() => clearCharacterCaches());

const LONG = ["Long Lank", "Ponytail", "Plait", "Shaggy Mane", "Draped Fall", "Braid Crown", "Salt Locks", "Wrapped Plait", "Shoulder Curtain", "Tied Tail"].map((n) => K.HAIR_STYLES.indexOf(n as never));
const JACKETS = [0, 1, 4, 6, 7, 9, 12, 13, 14, 16];
const NECKWEAR = [0, 3, 6, 7, 8, 9, 10, 11, 12, 13];
const PACKS = [0, 1, 2, 4, 5, 7];
const SHAPES = FIT_SHAPES.slice(0, 34);
/** Hair may sit this far inside the obstacles (metres): the hair sway's own limit. */
const SLACK = 0.003;
/** Triangles of the hair's strands, curtains and ornaments (the shells over the skull are not counted): the budget at full detail. */
const EXTRAS_BUDGET = 1200;

interface Result {
  name: string;
  depth: number;
}

const measureHair = measureHairOf;

describe("long hair lies outside the body, the collar, the neckwear, the cape and the pack", () => {
  it("every long style on a spread of shapes, jackets, neckwear, packs and hats: no vertex deeper than 0.3 cm, at rest or at the furthest sway", () => {
    const passes = Number(process.env.LONGHAIR_SAMPLES ?? 1);
    const worst: Result[] = [];
    let budget = 0;
    for (const style of LONG) {
      for (let pass = 0; pass < passes; pass++) {
        SHAPES.forEach((shape, si) => {
          const h = hash2(style * 977 + si, pass + 7);
          const base = plainBase(shape.spec);
          const spec = sanitizeSpec({
            ...base,
            hair: style,
            jacket: JACKETS[h % JACKETS.length]!,
            neckwear: NECKWEAR[(h >>> 4) % NECKWEAR.length]!,
            pack: PACKS[(h >>> 8) % PACKS.length]!,
            hat: ((h >>> 12) % 3 === 0 ? 0 : (h >>> 14) % K.HATS.length),
            skin: base.skin,
          });
          const m = measureHair(spec);
          budget = Math.max(budget, m.extrasTris);
          worst.push({ name: `${K.HAIR_STYLES[style]} / ${shape.name} / ${K.JACKETS[spec.jacket]} / ${K.NECKWEAR[spec.neckwear]} / ${K.PACKS[spec.pack]} / ${K.HATS[spec.hat]} (rest ${(m.rest * 100).toFixed(1)}, sway ${(m.sway * 100).toFixed(1)})`, depth: Math.max(m.rest, m.sway) });
        });
      }
    }
    worst.sort((a, b) => b.depth - a.depth);
    const bad = worst.filter((w) => w.depth > SLACK);
    if (process.env.LONGHAIR_VERBOSE) process.stdout.write(`${worst.slice(0, 25).map((w) => `${(w.depth * 100).toFixed(2)} cm ${w.name}`).join("\n")}\nbad ${bad.length} of ${worst.length}, extras budget max ${budget}\n`);
    expect(bad.length, bad.slice(0, 12).map((w) => `${(w.depth * 100).toFixed(2)} cm ${w.name}`).join("\n")).toBe(0);
    expect(budget).toBeLessThanOrEqual(EXTRAS_BUDGET);
  }, 1_200_000);

  it("every long style x every hat on two bodies: the hat never pushes the hair through the body, and a hat changes nothing about the budget", () => {
    const bad: string[] = [];
    for (const style of [LONG[0]!, LONG[3]!, LONG[4]!, LONG[8]!]) {
      for (const shapeName of ["neutral", "stubbyWide"]) {
        const shape = FIT_SHAPES.find((f) => f.name === shapeName)!;
        for (let hat = 0; hat < K.HATS.length; hat++) {
          const spec = sanitizeSpec({ ...plainBase(shape.spec), hair: style, hat, jacket: 6, neckwear: 7 });
          const m = measureHair(spec);
          if (Math.max(m.rest, m.sway) > SLACK) bad.push(`${K.HAIR_STYLES[style]} / ${shapeName} / ${K.HATS[hat]}: ${(Math.max(m.rest, m.sway) * 100).toFixed(2)} cm`);
          expect(m.extrasTris).toBeLessThanOrEqual(EXTRAS_BUDGET);
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  }, 1_200_000);

  it("the hair is one draw call: the head with the longest hair is still ONE mesh, and the far levels carry no sway attribute", () => {
    for (const style of LONG) {
      const spec = sanitizeSpec({ ...generateCharacter(5), hair: style, hat: 0 });
      const rig = buildCharacter(spec, { outline: false, lod: 0 });
      const heads: Mesh[] = [];
      rig.root.traverse((o) => o instanceof Mesh && o.name === "mesh_head" && heads.push(o));
      expect(heads.length, K.HAIR_STYLES[style]).toBe(1);
      expect(heads[0]!.geometry.hasAttribute("hsw")).toBe(true);
      rig.dispose();
      const far = buildCharacter(spec, { outline: false, lod: 2 });
      const farHeads: Mesh[] = [];
      far.root.traverse((o) => o instanceof Mesh && o.name === "mesh_head" && farHeads.push(o));
      for (const m of farHeads) expect(m.geometry.hasAttribute("hsw"), `${K.HAIR_STYLES[style]} far`).toBe(false);
      far.dispose();
    }
  });

  it("the long styles keep their silhouettes apart: the hair's height, width and depth differ between the new styles", () => {
    const sig = (style: number): string => {
      const a = auditHead(sanitizeSpec({ ...plainBase(FIT_SHAPES.find((f) => f.name === "neutral")!.spec), hair: style }));
      let lo = Infinity, hi = -Infinity, wx = 0, dz = 0;
      for (const p of a.prims) if (p.label === "hair") for (let i = 0; i < p.verts.length; i += 3) { lo = Math.min(lo, p.verts[i + 1]!); hi = Math.max(hi, p.verts[i + 1]!); wx = Math.max(wx, Math.abs(p.verts[i]!)); dz = Math.max(dz, p.verts[i + 2]!); }
      a.geo.dispose();
      return [lo, hi, wx, dz].map((v) => Math.round(v * 40)).join(",");
    };
    const sigs = LONG.map(sig);
    expect(new Set(sigs).size, sigs.join(" | ")).toBe(LONG.length);
  });
});
