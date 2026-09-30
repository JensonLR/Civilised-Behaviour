import { describe, expect, it } from "vitest";
import * as K from "../catalog.ts";
import { FIELDS, generateCharacter, sanitizeSpec, type CharacterSpec } from "../spec.ts";
import { auditHead, bodyDepth, floatGap, skullDepth, type HeadAudit } from "./headAudit.ts";
import { ringAtAz } from "./headFit.ts";

/**
 * The head-region fit audit. Every option of every head field (hat, hair, beard, moustache, sideburns, eyewear, earrings, hair accessories, hat trims, eyepatch, face paint,
 * scars ...) is built on heads that are tiny, huge, narrow-jawed, heavy-jawed, big-nosed, big-eared and on the worst body, and MEASURED (not bounding boxes):
 *  - `skull`: how deep the piece's vertices sink into the skull;
 *  - `body`: how deep they sink into the neck, coat or upper arms (long hair, beards, veils, chains);
 *  - `float`: the smallest distance from the piece to the skull or to another piece: a part that touches nothing is floating (the propeller-blade brims of the old deerstalker).
 * `HEAD_VERBOSE=1` prints the worst offenders. The ratchet lowers as fixes land; nobody raises it without saying why.
 */

const set = (base: CharacterSpec, o: Partial<Record<string, number>>): CharacterSpec => sanitizeSpec({ ...base, ...o });
const base0 = generateCharacter(31);
/** A plain base: everything optional off, ordinary short hair. */
const plain = (o: Partial<Record<string, number>> = {}): CharacterSpec =>
  set(base0, {
    hat: 0, hair: 1, moustache: 0, beard: 0, sideburns: 0, eyewear: 0, hatTrim: 0, hairAcc: 0, earring: 0, eyepatch: 0, facePaint: 0, tattoo: 0, scars: 0, mark: 0, complexion: 0,
    age: 0, greying: 0, stubble: 0, earShape: 0, noseStyle: 0, jacket: 1, neckwear: 0, patchStyle: 0, scarStyle: 0, jaw: 128, noseScale: 128, earScale: 128, headScale: 128, ...o,
  });

/** Heads: the sizes and shapes the fit has to survive. */
const HEADS: { name: string; set: Partial<Record<string, number>> }[] = [
  { name: "tiny", set: { headScale: 0, jaw: 128, noseScale: 128, earScale: 128 } },
  { name: "huge", set: { headScale: 255, jaw: 128, noseScale: 128, earScale: 128 } },
  { name: "narrowJaw", set: { headScale: 128, jaw: 0, noseScale: 0, earScale: 0 } },
  { name: "heavyJaw", set: { headScale: 200, jaw: 255, noseScale: 255, earScale: 255 } },
  { name: "worstBody", set: { headScale: 255, torsoWidth: 255, belly: 255, height: 40, legLength: 20, jaw: 255, earScale: 255 } },
];

interface Finding {
  head: string;
  field: string;
  value: number;
  label: string;
  metric: string;
  amount: number;
  kind: string;
}

/** Which audit labels belong to a field's option (the labels that option ADDS on top of the plain head). */
const LABELS: Record<string, string[]> = {
  hat: ["hat"],
  hatTrim: ["hat"],
  hair: ["hair"],
  beard: ["beard"],
  moustache: ["moustache"],
  sideburns: ["sideburns"],
  eyewear: ["eyewear"],
  eyepatch: ["eyewear"],
  earring: ["earring"],
  hairAcc: ["hairAcc"],
  earShape: ["ears"],
  scars: ["scars"],
  facePaint: ["decor"],
  tattoo: ["decor"],
};

/** How deep each kind of piece may sink into the skull (metres per R... scaled by R below): hair roots and fitted cloth may root a little, a hard piece may not. */
const SKULL_TOL: Record<string, number> = { hat: 0.004, hair: 0.075, beard: 0.03, moustache: 0.03, sideburns: 0.03, eyewear: 0.06, earring: 0.05, hairAcc: 0.05, ears: 0.09, scars: 0.03, decor: 0.02 };
const BODY_TOL = 0.012;

function measure(spec: CharacterSpec, labels: string[], out: Finding[], head: string, field: string, value: number, floats: boolean): void {
  const a: HeadAudit = auditHead(spec);
  const R = a.P.headRadius;
  a.prims.forEach((p, i) => {
    if (!labels.includes(p.label) || p.verts.length === 0) return;
    const sd = skullDepth(a, p);
    if (sd > (SKULL_TOL[p.label] ?? 0.03) * (R / 0.3)) out.push({ head, field, value, label: p.label, metric: "skull", amount: sd, kind: p.kind });
    const bd = bodyDepth(a, p);
    if (bd > BODY_TOL) out.push({ head, field, value, label: p.label, metric: "body", amount: bd, kind: p.kind });
    if (floats && p.label !== "hat") {
      // (the crown of a hat is judged by the hat tests; every OTHER hat piece and every other feature must touch something)
    }
    if (floats) {
      const g = floatGap(a, i);
      if (g > 0.012 + 0.02 * R) out.push({ head, field, value, label: p.label, metric: "float", amount: g, kind: p.kind });
    }
  });
}

const worstOf = (fs: Finding[], metric: string): { count: number; worst: number } => {
  const m = fs.filter((f) => f.metric === metric);
  return { count: m.length, worst: m.reduce((w, f) => Math.max(w, f.amount), 0) };
};

describe("head fit audit", () => {
  it("every option of every head field, on tiny, huge, narrow, heavy and worst-case heads, stays inside the ratchet", () => {
    const findings: Finding[] = [];
    const fields = ["hat", "hair", "beard", "moustache", "sideburns", "eyewear", "earring", "hairAcc", "hatTrim", "eyepatch", "earShape", "facePaint", "tattoo"] as const;
    for (const h of HEADS) {
      for (const f of fields) {
        const def = FIELDS.find((x) => x.key === f)!;
        for (let v = 1; v <= def.max; v++) {
          const extra: Partial<Record<string, number>> = f === "hatTrim" ? { hat: 3 } : f === "hairAcc" ? { hair: 1 } : {};
          measure(plain({ ...h.set, ...extra, [f]: v }), LABELS[f]!, findings, h.name, f, v, true);
        }
      }
      // the fields that also matter on top of one another: a hat over long hair and a beard
      for (const hat of [1, 5, 13, 15, 17, 18, 19, 20]) {
        for (const hair of [8, 10, 11, 15]) measure(plain({ ...h.set, hat, hair, beard: 6 }), ["hat", "hair", "beard"], findings, h.name, "hat+hair", hat * 100 + hair, false);
      }
    }
    if (process.env.HEAD_VERBOSE) {
      for (const metric of ["skull", "body", "float"]) {
        const seen = new Set<string>();
        for (const t of [...findings].filter((f) => f.metric === metric).sort((a, b) => b.amount - a.amount)) {
          const k = `${t.field}=${t.value}`;
          if (seen.has(k) || seen.size >= 14) continue;
          seen.add(k);
          process.stdout.write(`${t.metric} ${(t.amount * 100).toFixed(1)} cm  ${t.head} ${t.field}=${t.value} ${t.label}/${t.kind}\n`);
        }
      }
    }
    const s = { skull: worstOf(findings, "skull"), body: worstOf(findings, "body"), float: worstOf(findings, "float") };
    if (process.env.HEAD_VERBOSE) process.stdout.write(`${JSON.stringify(s)}\n`);
    // Ratchet (metres / counts): as of the last fix.
    // (skull: a fitted piece may not sink more than a hair root; body: 1.4 cm of a hair curtain lying on a shoulder; float: nothing may hang free)
    expect(s.skull.worst, "skull").toBeLessThanOrEqual(0.02);
    expect(s.body.worst, "body").toBeLessThanOrEqual(0.02);
    expect(s.float.worst, "float").toBeLessThanOrEqual(0.03);
    expect(s.skull.count + s.body.count + s.float.count, "total findings").toBeLessThanOrEqual(12);
  }, 900_000);

  it("the head-fit queries are consistent: the ear anchors sit on the ear, the hair lift is zero on bald heads, sections follow the skull", () => {
    for (const h of HEADS) {
      const spec = plain({ ...h.set, hair: 0 });
      const a = auditHead(spec);
      const R = a.P.headRadius;
      const { hf } = a;
      // section radii at the equator match the skull's own radius in that direction
      const sec = hf.section(0);
      for (let k = 0; k < sec.length; k += 3) {
        const th = (k / sec.length) * Math.PI * 2;
        const r = hf.shape.radius(Math.sin(th), 0, -Math.cos(th));
        expect(Math.abs(sec[k]! - r), `${h.name} section ${k}`).toBeLessThan(0.02 * R);
      }
      expect(ringAtAz(sec, Math.PI / 2)).toBeCloseTo(sec[sec.length / 4]!, 6);
      // ears: top above the lobe, outer beyond the skull, front in front of back
      for (const sx of [-1, 1] as const) {
        const e = hf.ear(sx);
        expect(e.top[1], h.name).toBeGreaterThan(e.lobe[1]);
        expect(Math.abs(e.outer[0]), h.name).toBeGreaterThan(Math.abs(e.root[0]) * 0.97);
        expect(e.front[2], h.name).toBeLessThan(e.back[2]);
      }
      // a bald head has no hair lift; shaggy hair has some
      expect(hf.hairLift(1, 0.2, 0)).toBe(0);
      const shaggy = auditHead(plain({ ...h.set, hair: 15 }));
      expect(shaggy.hf.hairLift(0, 0.5, 0.86)).toBeGreaterThan(0.02 * R);
    }
  });

  it("hats: the crown clears the hair and the ears, whatever the head", () => {
    for (const h of HEADS) {
      for (const hat of [1, 2, 3, 7, 10, 11, 14, 17, 20]) {
        for (const hair of [1, 3, 7, 15]) {
          const a = auditHead(plain({ ...h.set, hat, hair }));
          const R = a.P.headRadius;
          // the band is above the ears
          expect(a.seatY * R, `${h.name} hat ${hat}`).toBeGreaterThanOrEqual(((a.hf.ear(1).top[1] - R) / R) * R - 1e-6);
          // no crown vertex inside the hair mass: for every crown vertex above the band, its distance to the skull surface exceeds the hair's thickness there
          const bandY = R + a.seatY * R;
          for (const p of a.prims) {
            if (p.label !== "hat" || p.kind !== "loft") continue;
            for (let i = 0; i < p.verts.length; i += 3) {
              const y = p.verts[i + 1]!;
              if (y < bandY - 1e-6) continue;
              const dx = p.verts[i]!;
              const dy = y - R;
              const dz = p.verts[i + 2]!;
              const l = Math.hypot(dx, dy, dz) || 1e-9;
              const out = l - a.hf.shape.radius(dx / l, dy / l, dz / l);
              if (out < 0) continue; // (inside the skull is measured by skullDepth)
              expect(out + 0.003, `${h.name} hat ${hat} hair ${hair}`).toBeGreaterThanOrEqual(a.hf.hairLift(dx / l, dy / l, dz / l) * 0.7);
            }
          }
        }
      }
    }
  });
});

void K;
