import { describe, expect, it } from "vitest";
import { FIELDS, HISTORY_KEYS, LEGACY_FIELD_COUNT, decodeSpec, encodeSpec, generateCharacter, type CharacterSpec, type FieldDef } from "@cb/procedural";
import { buildCharacter } from "@cb/procedural/three";
import {
  CODE_MAX_CHARS,
  CODE_MIN_CHARS,
  COALESCE_MS,
  HISTORY_LIMIT,
  POSES,
  PRESETS,
  SECTIONS,
  SpecHistory,
  applyPasted,
  applyPreset,
  parseLookCode,
  randomiseAll,
  randomiseKeys,
  sameSpec,
} from "./creatorLogic.ts";

const person = (seed: number): CharacterSpec => generateCharacter(seed);
const withHistory = (s: CharacterSpec): CharacterSpec => ({ ...s, scars: 5, teeth: 3, woodenLeg: 2, eyepatch: 1, burnt: 2, hook: 1 });

describe("undo and redo", () => {
  it("steps back and forward through changes, and a new change after an undo drops the redo branch", () => {
    const a = person(1);
    const h = new SpecHistory(a);
    expect(h.canUndo).toBe(false);
    const b = { ...a, hat: 3 };
    const c = { ...b, jacket: 4 };
    expect(h.record(b, "hat", 0)).toBe(true);
    expect(h.record(c, "jacket", 5000)).toBe(true);
    expect(h.undo()).toEqual(b);
    expect(h.undo()).toEqual(a);
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toEqual(b);
    const d = { ...b, boots: 2 };
    h.record(d, "boots", 9000);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeUndefined();
    expect(h.undo()).toEqual(b);
  });

  it("remembers only the last 20 looks", () => {
    const h = new SpecHistory(person(2));
    let s = person(2);
    for (let i = 1; i <= 35; i++) {
      s = { ...s, height: i * 3 };
      h.record(s, undefined, i * 10_000);
    }
    expect(h.depth).toBe(HISTORY_LIMIT);
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(HISTORY_LIMIT);
    expect(h.current.height).toBe(35 * 3 - HISTORY_LIMIT * 3);
  });

  it("a drag on one control is one step, a pause or another control is a new one", () => {
    const a = person(3);
    const h = new SpecHistory(a);
    let s = a;
    for (let i = 0; i < 40; i++) {
      s = { ...s, belly: (a.belly + i + 1) % 256 };
      h.record(s, "belly", i * 20); // 40 changes 20 ms apart
    }
    expect(h.depth).toBe(1);
    h.record({ ...s, height: (s.height + 9) % 256 }, "height", 40 * 20 + 10);
    expect(h.depth).toBe(2);
    h.record({ ...s, height: (s.height + 9) % 256, belly: (s.belly + 1) % 256 }, "belly", 40 * 20 + 10 + COALESCE_MS + 1);
    expect(h.depth).toBe(3);
    // undo of the drag returns to before the drag, not to a point in the middle of it
    h.undo();
    h.undo();
    expect(h.undo()).toEqual(a);
  });

  it("an unchanged look is not a step, and the history hands out copies (nothing can corrupt it from outside)", () => {
    const a = person(4);
    const h = new SpecHistory(a);
    expect(h.record({ ...a })).toBe(false);
    const cur = h.current;
    cur.hat = (cur.hat + 1) % 20;
    expect(h.current).toEqual(a);
    h.record({ ...a, hat: 7 });
    const u = h.undo()!;
    u.hat = 19;
    expect(h.redo()).toEqual({ ...a, hat: 7 });
  });
});

describe("look codes", () => {
  it("round-trips any generated look, with surrounding spaces, quotes or a look= prefix", () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = person(seed);
      const code = encodeSpec(s);
      for (const wrapped of [code, `  ${code}\n`, `"${code}"`, `look=${code}`, `https://example.test/?look=${code}&x=1`]) {
        const r = parseLookCode(wrapped);
        expect(r.ok, wrapped).toBe(true);
        if (r.ok) {
          expect(r.spec).toEqual(s);
          expect(r.note).toBeUndefined();
        }
      }
    }
  });

  it("explains in words what is wrong", () => {
    const code = encodeSpec(person(9));
    const fails = (input: unknown): string => {
      const r = parseLookCode(input);
      expect(r.ok, String(input)).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(fails("")).toMatch(/nothing to paste/i);
    expect(fails("   \n ")).toMatch(/nothing to paste/i);
    expect(fails(42)).toMatch(/nothing to paste/i);
    expect(fails(`${code.slice(0, 20)} ${code.slice(20)}`)).toMatch(/spaces or line breaks/i);
    expect(fails(`${code.slice(0, 10)}!${code.slice(11)}`)).toMatch(/"!" \(number 11\)/);
    expect(fails(code.slice(0, 30))).toMatch(/\d+ characters short/);
    expect(fails(code.slice(0, CODE_MIN_CHARS - 1))).toMatch(/short/);
    expect(fails("B" + code.slice(1))).toMatch(/different version/i);
    expect(fails(code + code + code)).toMatch(/far too long/i);
    // every message is a whole sentence a person can act on
    for (const bad of ["x", "hello world", "A".repeat(200), "%%%"]) expect(fails(bad).length).toBeGreaterThan(25);
  });

  it("reads an older, shorter look with the newer options off, says so, clamps out-of-range values and never throws on garbage", () => {
    const s = person(5);
    const bytes = encodeSpec(s);
    const legacy = bytes.slice(0, CODE_MIN_CHARS);
    const r = parseLookCode(legacy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.note).toMatch(/older/i);
      const dec = decodeSpec(legacy)!;
      expect(r.spec).toEqual(dec);
      for (const f of (FIELDS as readonly FieldDef[]).slice(LEGACY_FIELD_COUNT)) expect(r.spec[f.key as keyof CharacterSpec], f.key).toBe(0);
    }
    // a value out of range in the last field is adjusted, with a note
    const flipped = bytes.slice(0, -1) + "_";
    const r2 = parseLookCode(flipped);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.note).toMatch(/adjusted|out of range/i);
    let x = 1;
    for (let i = 0; i < 500; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const junk = Array.from({ length: x % 100 }, (_, k) => String.fromCharCode(32 + ((x >> (k % 20)) % 95))).join("");
      expect(() => parseLookCode(junk)).not.toThrow();
    }
    expect(CODE_MAX_CHARS).toBe(encodeSpec(s).length);
  });

  it("a pasted look keeps the character's campaign history (scars, teeth, a wooden leg ...)", () => {
    const mine = withHistory(person(6));
    const theirs = { ...person(7), scars: 0, teeth: 0, woodenLeg: 0, eyepatch: 0, burnt: 0, hook: 0 };
    const merged = applyPasted(mine, theirs);
    for (const k of HISTORY_KEYS) expect(merged[k], k).toBe(mine[k]);
    expect(merged.hat).toBe(theirs.hat);
    expect(merged.height).toBe(theirs.height);
  });
});

describe("randomising", () => {
  it("shuffles only the named fields, is repeatable for a seed and differs between seeds", () => {
    const s = person(8);
    const keys = SECTIONS.face[1]!.keys;
    const a = randomiseKeys(s, keys, 1);
    const a2 = randomiseKeys(s, keys, 1);
    const b = randomiseKeys(s, keys, 2);
    expect(a).toEqual(a2);
    expect(sameSpec(a, b)).toBe(false);
    for (const f of FIELDS) if (!keys.includes(f.key)) expect(a[f.key], f.key).toBe(s[f.key]);
    expect(keys.some((k) => a[k as keyof CharacterSpec] !== s[k as keyof CharacterSpec])).toBe(true);
    for (const f of FIELDS) expect(a[f.key]).toBeLessThanOrEqual(f.max);
  });

  it("never touches the campaign's history, whatever it is asked to shuffle, and randomise-all keeps it too", () => {
    const mine = withHistory(person(10));
    const all = FIELDS.map((f) => f.key as string);
    for (let seed = 0; seed < 25; seed++) {
      const r = randomiseKeys(mine, all, seed);
      for (const k of HISTORY_KEYS) expect(r[k], k).toBe(mine[k]);
      expect(r.teeth).toBe(mine.teeth);
      expect(r.scars).toBe(mine.scars);
      const r2 = randomiseAll(mine, seed);
      for (const k of HISTORY_KEYS) expect(r2[k], k).toBe(mine[k]);
    }
  });

  it("keeps rare vanity rare: over many shuffles most people have no face paint, tattoo or ring", () => {
    const s = person(11);
    let paint = 0;
    let rings = 0;
    for (let seed = 0; seed < 400; seed++) {
      const r = randomiseKeys(s, ["facePaint", "ring", "tattoo"], seed);
      if (r.facePaint) paint++;
      if (r.ring) rings++;
    }
    expect(paint).toBeLessThan(400 * 0.25);
    expect(rings).toBeLessThan(400 * 0.5);
    expect(paint).toBeGreaterThan(0);
  });
});

describe("presets", () => {
  it("there are six to eight, each named, described, valid, distinct and free of campaign history", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(PRESETS.length).toBeLessThanOrEqual(8);
    const codes = new Set<string>();
    const names = new Set<string>();
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.blurb.length).toBeGreaterThan(15);
      names.add(p.name);
      codes.add(encodeSpec(p.spec));
      expect(decodeSpec(encodeSpec(p.spec))).toEqual(p.spec);
      for (const k of HISTORY_KEYS) expect(p.spec[k], `${p.name} ${k}`).toBe(0);
      expect(p.spec.scars).toBe(0);
      expect(p.spec.teeth).toBe(0);
      for (const f of FIELDS) expect(p.spec[f.key]).toBeLessThanOrEqual(f.max);
    }
    expect(names.size).toBe(PRESETS.length);
    expect(codes.size).toBe(PRESETS.length);
    expect(PRESETS.map((p) => p.name)).toContain("Portly Colonel");
  });

  it("each preset is a deliberate outfit (a hat or a distinctive coat, and at least four choices made) and builds a rig", () => {
    for (const p of PRESETS) {
      const s = p.spec;
      expect(s.hat > 0 || s.jacket > 0, p.name).toBe(true);
      const set = ["hat", "jacket", "shirt", "trousers", "boots", "belt", "eyewear", "moustache", "beard", "sideburns", "pack", "hipGear", "neckwear", "gloves", "sash", "decoration", "epaulettes", "coatTrim", "trouserTrim", "hair"].filter((k) => s[k as keyof CharacterSpec] > 0);
      expect(set.length, `${p.name} sets ${set.join(",")}`).toBeGreaterThanOrEqual(6);
      const rig = buildCharacter(s, { outline: false });
      expect(rig.meshCount).toBeGreaterThan(8);
      rig.dispose();
    }
  });

  it("applying a preset changes the look and keeps the campaign's history", () => {
    const mine = withHistory(person(12));
    for (const p of PRESETS) {
      const r = applyPreset(mine, p);
      for (const k of HISTORY_KEYS) expect(r[k], `${p.name} ${k}`).toBe(mine[k]);
      expect(r.hat).toBe(p.spec.hat);
      expect(r.jacket).toBe(p.spec.jacket);
    }
  });
});

describe("preview poses", () => {
  it("offers the turntable, walk, idle, pain and triumph, in that order", () => {
    expect(POSES.map((p) => p.label)).toEqual(["Turntable", "Walk", "Idle", "Pain", "Triumph"]);
  });
});
