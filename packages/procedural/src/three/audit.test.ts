import { Mesh, type Object3D } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FIELDS, generateCharacter, sanitizeSpec, type CharacterSpec, type FieldDef, type FieldKey } from "../spec.ts";
import { buildCharacter, clearCharacterCaches } from "./rig.ts";
import { PartBuilder, type PrimitiveAudit } from "./parts.ts";

/**
 * The catalog audit: EVERY option of EVERY choice field, on several body shapes, must build finite geometry made of outward-facing primitives that
 * are all connected to the rest of their bone (nothing floats), and must actually change the rig (an option that draws nothing is a bug: it
 * shipped once as a silent no-op). Bases that make an option visible are listed in NEEDS.
 */

afterAll(() => clearCharacterCaches());

/** Body shapes: the six archetypes plus the slider extremes. */
const SHAPES: CharacterSpec[] = (() => {
  const out: CharacterSpec[] = [];
  for (let a = 0; a < 6; a++) out.push(generateCharacter(100 + a, a));
  const all = (v: number) => {
    const s = { ...generateCharacter(7) } as Record<string, number>;
    for (const f of FIELDS) if (f.kind === "slider") s[f.key] = v;
    return sanitizeSpec(s);
  };
  out.push(all(0), all(255));
  return out;
})();

/** A plain, fully dressed base: every optional extra off, so a single option shows up as a difference. */
const bare = (s: CharacterSpec): CharacterSpec => ({
  ...s,
  hat: 0, hair: 1, moustache: 0, beard: 0, sideburns: 0, eyewear: 0, jacket: 1, shirt: 0, trousers: 0, boots: 1, belt: 0, sash: 0, medals: 0, neckwear: 0,
  pack: 0, hipGear: 0, gloves: 0, scars: 0, teeth: 0, eyepatch: 0, burnt: 0, woodenLeg: 0, hook: 0, brows: 0, eyeShape: 0, eyeColor: 0, earShape: 0,
  stubble: 0, greying: 0, age: 0, complexion: 0, mark: 0, facePaint: 0, tattoo: 0, earring: 0, ring: 0, epaulettes: 0, decoration: 0, coatTrim: 0,
  trouserTrim: 0, hatTrim: 0, shirtColor: 0, bootColor: 0, noseStyle: 0, medalStyle: 0, buckle: 0, cuffDetail: 0, laces: 0, pocket: 0, hairAcc: 0, patchStyle: 0, scarStyle: 0,
});

/** What an option needs around it to be visible at all. */
const NEEDS: Partial<Record<FieldKey, Partial<CharacterSpec>>> = {
  hatTrim: { hat: 6 },
  hatColor: { hat: 6 },
  shirt: { jacket: 3 },
  shirtColor: { jacket: 0 },
  trouserTrim: { trousers: 1 },
  ring: { gloves: 0 },
  greying: { hair: 1, moustache: 1, beard: 1 },
  stubble: { beard: 0 },
  epaulettes: { jacket: 2 },
  decoration: { jacket: 2 },
  coatTrim: { jacket: 2 },
  eyeColor: {},
  accentColor: { jacket: 2, medals: 2 },
  trousersColor: {},
  medalStyle: { jacket: 2, medals: 3 },
  buckle: { belt: 1, jacket: 2 },
  cuffDetail: { jacket: 2 },
  laces: { boots: 1 },
  pocket: { jacket: 2 },
  hairAcc: { hair: 1, hat: 0 },
  patchStyle: { eyepatch: 1 },
  scarStyle: { scars: 1 },
};

const digest = (rig: { root: Object3D }): string => {
  let h = 2166136261;
  const mix = (x: number): void => {
    h ^= Math.round(x * 20000) | 0;
    h = Math.imul(h, 16777619);
  };
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((o) => {
    if (o instanceof Mesh) {
      for (const name of ["position", "color"] as const) {
        const a = o.geometry.attributes[name];
        if (a) for (let i = 0; i < a.array.length; i++) mix(a.array[i] as number);
      }
      const inf = o.morphTargetInfluences;
      if (inf) mix(inf.length);
    }
    for (const e of o.matrix.elements) mix(e);
  });
  return String(h >>> 0);
};

interface Built {
  audit: PrimitiveAudit[];
  digest: string;
  finite: boolean;
}

const baseDigests = new Map<string, string>();
const baseDigest = (base: CharacterSpec): string => {
  const k = JSON.stringify(base);
  let d = baseDigests.get(k);
  if (d === undefined) baseDigests.set(k, (d = build(base).digest));
  return d;
};

function build(spec: CharacterSpec): Built {
  clearCharacterCaches();
  PartBuilder.audit = [];
  let rig;
  try {
    rig = buildCharacter(spec, { outline: false });
  } finally {
    // (the audit list is read below)
  }
  const audit = PartBuilder.audit;
  PartBuilder.audit = undefined;
  let finite = true;
  rig.root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const name of ["position", "normal", "color"] as const) {
      const a = o.geometry.attributes[name];
      if (!a) continue;
      for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) finite = false;
    }
  });
  const d = digest(rig);
  rig.dispose();
  return { audit, digest: d, finite };
}

/** Primitives grouped by bone; returns the ones that touch nothing else of their bone (within `gap` metres): parts floating in the air. */
function floaters(audit: PrimitiveAudit[], gap = 0.012): PrimitiveAudit[] {
  const out: PrimitiveAudit[] = [];
  const byTag = new Map<string, PrimitiveAudit[]>();
  for (const a of audit) (byTag.get(a.tag) ?? byTag.set(a.tag, []).get(a.tag)!).push(a);
  for (const list of byTag.values()) {
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const touch = (a: PrimitiveAudit, b: PrimitiveAudit): boolean =>
      a.min[0] <= b.max[0] + gap && b.min[0] <= a.max[0] + gap && a.min[1] <= b.max[1] + gap && b.min[1] <= a.max[1] + gap && a.min[2] <= b.max[2] + gap && b.min[2] <= a.max[2] + gap;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (touch(list[i]!, list[j]!)) parent[find(i)] = find(j);
    // the largest component is the body of the bone; anything outside it floats
    const size = new Map<number, number>();
    list.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + list[i]!.triangles));
    let main = -1;
    let best = -1;
    for (const [root, tris] of size) if (tris > best) ((best = tris), (main = root));
    list.forEach((a, i) => find(i) !== main && out.push(a));
  }
  return out;
}

function checkClean(label: string, b: Built): void {
  expect(b.finite, `${label}: finite`).toBe(true);
  const inside = b.audit.filter((a) => a.triangles >= 4 && a.outward <= 0);
  expect(inside.length, `${label}: inside-out primitives ${JSON.stringify(inside.slice(0, 2))}`).toBe(0);
  const lost = floaters(b.audit);
  expect(lost.length, `${label}: floating primitives ${JSON.stringify(lost.slice(0, 2))}`).toBe(0);
}

describe("catalog audit: every option builds sound geometry and shows up", () => {
  const fields = (FIELDS as readonly FieldDef[]).filter((f) => f.kind !== "slider" || f.key === "age");
  for (const f of fields) {
    const values: number[] = [];
    if (f.kind === "flags") for (let bit = 1; bit <= f.max; bit <<= 1) values.push(bit);
    else if (f.kind === "slider") values.push(220);
    else for (let v = 1; v <= f.max; v++) values.push(v);
    // Colours are numbered swatches: sample a few instead of every one.
    const sampled = f.options ? values : values.filter((v, i) => i % 3 === 0 || v === f.max);
    for (const v of sampled) {
      const name = f.options ? (f.options[v] ?? String(v)) : String(v);
      it(`${f.key} = ${v} (${name})`, () => {
        let changed = 0;
        // three body shapes per option, rotating, so the whole catalog covers every shape without the suite taking minutes
        for (const i of [v % SHAPES.length, (v + 3) % SHAPES.length, (v + 5) % SHAPES.length]) {
          const shape = SHAPES[i]!;
          const base = { ...bare(shape), ...(NEEDS[f.key as FieldKey] ?? {}) } as CharacterSpec;
          if (base[f.key as FieldKey] === v) base[f.key as FieldKey] = 0; // (the plain base already wears this option: compare against none)
          const spec = { ...base, [f.key]: v } as CharacterSpec;
          const b = build(spec);
          checkClean(`${f.key}=${v} shape ${i}`, b);
          if (b.digest !== baseDigest(base)) changed++;
        }
        expect(changed, `${f.key}=${v} (${name}) changes nothing in any body shape: an option that draws nothing`).toBeGreaterThan(0);
        // ... and it must look different from the option before it (an unfinished option that falls through to a default is a copy of its neighbour)
        if (f.options && v >= 2 && f.kind === "choice" && f.group !== "history") {
          const shape = SHAPES[v % SHAPES.length]!;
          const base = { ...bare(shape), ...(NEEDS[f.key as FieldKey] ?? {}) } as CharacterSpec;
          const a = build({ ...base, [f.key]: v } as CharacterSpec).digest;
          const b = build({ ...base, [f.key]: v - 1 } as CharacterSpec).digest;
          expect(a, `${f.key}=${v} (${name}) is identical to ${f.key}=${v - 1}: not implemented?`).not.toBe(b);
        }
      });
    }
  }
});

describe("generated people are sound", () => {
  it("150 generated characters build clean, outward, connected geometry", () => {
    for (let seed = 0; seed < 150; seed++) checkClean(`seed ${seed}`, build(generateCharacter(seed)));
  });
});
