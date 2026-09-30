import { BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import * as K from "../catalog.ts";
import { computeProportions } from "../proportions.ts";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { buildHead } from "./head.ts";
import { HAT_SEAT } from "./hatsGeo.ts";
import { headShape } from "./headShape.ts";

/**
 * Every hat over every hairstyle, with and without facial hair: nothing of the hair, sideburns or beard may show above the band of the hat unless the hat is over it.
 * Method: heads are built as (hat, hair, beard) and (hat only); what the first has and the second lacks IS the hair; and from every hair vertex above the band a ray goes
 * straight up - it must hit the hat (from inside: the crown covers it). A hair vertex that no hat surface lies above has poked through the crown or stands out beside it.
 */

const colors = { skin: 0xd29c76, hairC: 0x3b2616, hatC: 0x555555, accent: 0xd0a94a, burnt: 0 };
const key = (x: number, y: number, z: number): string => `${Math.round(x * 5000)},${Math.round(y * 5000)},${Math.round(z * 5000)}`;

interface Tri {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  cx: number;
  cz: number;
  cy: number;
}

function vertexSet(g: BufferGeometry): Set<string> {
  const p = g.attributes.position!;
  const s = new Set<string>();
  for (let i = 0; i < p.count; i++) s.add(key(p.getX(i), p.getY(i), p.getZ(i)));
  return s;
}

/** Triangles of `g` having at least one vertex not in `known`. */
function newTriangles(g: BufferGeometry, known: Set<string>): Tri[] {
  const p = g.attributes.position!;
  const ix = g.index!;
  const out: Tri[] = [];
  const isNew = (i: number): boolean => !known.has(key(p.getX(i), p.getY(i), p.getZ(i)));
  for (let t = 0; t < ix.count; t += 3) {
    const a = ix.getX(t);
    const b = ix.getX(t + 1);
    const c = ix.getX(t + 2);
    if (!isNew(a) && !isNew(b) && !isNew(c)) continue;
    out.push({ ax: p.getX(a), ay: p.getY(a), az: p.getZ(a), bx: p.getX(b), by: p.getY(b), bz: p.getZ(b), cx: p.getX(c), cy: p.getY(c), cz: p.getZ(c) });
  }
  return out;
}

/** The vertices of `g` that are not in `known`. */
function newVertices(g: BufferGeometry, known: Set<string>): [number, number, number][] {
  const p = g.attributes.position!;
  const seen = new Set<string>();
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    if (known.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  }
  return out;
}

/** Is there hat surface straight above (x, y, z)? (Ray up, tested in the xz plane; a small margin so a vertex just outside a triangle's edge still counts as covered.) */
function coveredAbove(tris: readonly Tri[], x: number, y: number, z: number, margin: number): boolean {
  for (const t of tris) {
    if (Math.max(t.ay, t.by, t.cy) < y - 1e-4) continue;
    const minX = Math.min(t.ax, t.bx, t.cx) - margin;
    const maxX = Math.max(t.ax, t.bx, t.cx) + margin;
    if (x < minX || x > maxX) continue;
    const minZ = Math.min(t.az, t.bz, t.cz) - margin;
    const maxZ = Math.max(t.az, t.bz, t.cz) + margin;
    if (z < minZ || z > maxZ) continue;
    // barycentric in xz, slightly inflated
    const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
    const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
    const l3 = 1 - l1 - l2;
    const e = -margin * 4;
    if (l1 < e || l2 < e || l3 < e) continue;
    const hy = l1 * t.ay + l2 * t.by + l3 * t.cy;
    if (hy >= y - 1e-4) return true;
  }
  return false;
}

/** Bodies with different head sizes: the crown is fitted per head, so try a small, an average and a big head. */
const BODIES = [3, 9, 17].map((seed, i) => ({ ...generateCharacter(seed), headScale: [10, 120, 250][i]!, hair: 1, hat: 0, hatTrim: 0, beard: 0, moustache: 0, sideburns: 0, eyewear: 0, scars: 0, eyepatch: 0, mark: 0, facePaint: 0, tattoo: 0, earring: 0, age: 0, greying: 0 }) as CharacterSpec);

function poking(spec: CharacterSpec): { count: number; worst: [number, number, number] | undefined } {
  const P = computeProportions(spec);
  const R = P.headRadius;
  const both = buildHead(spec, P, colors)!;
  const hatOnly = buildHead({ ...spec, hair: 0, beard: 0, sideburns: 0, moustache: 0 }, P, colors)!;
  const bare = buildHead({ ...spec, hair: 0, beard: 0, sideburns: 0, moustache: 0, hat: 0, hatTrim: 0 }, P, colors)!;
  const hat = newTriangles(hatOnly, vertexSet(bare));
  const hair = newVertices(both, vertexSet(hatOnly));
  const bandY = R + (HAT_SEAT[spec.hat] ?? 0.5) * R; // (the head centre is R above the bone origin)
  let count = 0;
  let worst: [number, number, number] | undefined;
  for (const [x, y, z] of hair) {
    if (y < bandY + 0.008) continue; // below the band the hair may hang out under the brim
    if (!coveredAbove(hat, x, y, z, 0.004 * (R / 0.3))) {
      count++;
      worst ??= [x, y, z];
    }
  }
  return { count, worst };
}

describe("hats over hair", () => {
  for (let hat = 1; hat < K.HATS.length; hat++) {
    it(`${K.HATS[hat]}: no hairstyle pokes through or out beside the crown (small, average and big heads)`, () => {
      const bad: string[] = [];
      for (const body of BODIES) {
        for (let hair = 0; hair < K.HAIR_STYLES.length; hair++) {
          const r = poking({ ...body, hat, hair });
          if (r.count > 0) bad.push(`${K.HAIR_STYLES[hair]} (head ${body.headScale}): ${r.count} vertices, e.g. ${r.worst!.map((v) => v.toFixed(3)).join(",")}`);
        }
      }
      expect(bad, `${K.HATS[hat]}: ${bad.join(" | ")}`).toEqual([]);
    });
  }

  it("facial hair and sideburns stay under every hat's band or under the hat", () => {
    const bad: string[] = [];
    for (let hat = 1; hat < K.HATS.length; hat++) {
      for (const beard of [1, 4, 6, 10, 12]) {
        const r = poking({ ...BODIES[1]!, hat, hair: 1, beard, sideburns: 4 });
        if (r.count > 0) bad.push(`${K.HATS[hat]} + ${K.BEARDS[beard]}: ${r.count}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
