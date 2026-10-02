import { describe, expect, it } from "vitest";
import { DYE, PALETTE, PEOPLE, PEOPLE_IDS, WAYFARER_MIX, type PeopleId } from "@cb/shared";
import * as C from "./catalog.ts";
import { COLONIAL_CODED, PEOPLE_ADDITIONS_LANDED, PEOPLE_CATALOG_ADDITIONS, PEOPLE_OVERLAYS, applyPeople, codedList, type AdditionKey } from "./peoples.ts";
import { readFileSync } from "node:fs";
import { FIELDS, generateCharacter, HISTORY_KEYS, NATIVE_FROM, sanitizeSpec } from "./spec.ts";

/**
 * The contract's own tests (package C extends them): the overlay is deterministic, never touches skin, eye or hair colour or history, strips the colonial uniform, keeps the people apart on
 * the sliders that make a silhouette, and its catalogue additions are named and, once landed, real.
 */

const seeds = Array.from({ length: 60 }, (_, i) => 5000 + i * 7919);
const NATIVE = PEOPLE_IDS.filter((p) => p !== "wayfarers");

describe("applyPeople", () => {
  it("is deterministic and always a valid spec", () => {
    for (const p of PEOPLE_IDS) {
      for (const s of seeds.slice(0, 20)) {
        const base = generateCharacter(s);
        const a = applyPeople(base, p, s);
        expect(a).toEqual(applyPeople(base, p, s));
        expect(sanitizeSpec(a)).toEqual(a);
      }
    }
  });
  it("never touches skin, eye colour, hair colour or history", () => {
    for (const p of PEOPLE_IDS) {
      for (const s of seeds.slice(0, 30)) {
        const base = generateCharacter(s);
        const a = applyPeople(base, p, s);
        expect(a.skin).toBe(base.skin);
        expect(a.eyeColor).toBe(base.eyeColor);
        expect(a.hairColor).toBe(base.hairColor);
        for (const k of HISTORY_KEYS) expect(a[k], k).toBe(base[k]);
      }
    }
  });
  it("skin tone spans the whole palette within every people (a people is not a skin tone)", () => {
    for (const p of PEOPLE_IDS) {
      const tones = new Set(seeds.map((s) => applyPeople(generateCharacter(s), p, s).skin));
      expect(tones.size, p).toBeGreaterThanOrEqual(6);
    }
  });
  it("strips the colonial uniform and borrowed dress from every native", () => {
    for (const p of PEOPLE_IDS) {
      for (const s of seeds) {
        const a = applyPeople(generateCharacter(s), p, s);
        for (const [field, names] of Object.entries(COLONIAL_CODED)) {
          const list = codedList(field);
          const worn = list[(a as unknown as Record<string, number>)[field]!];
          expect(names, `${p} ${field}=${worn}`).not.toContain(worn);
        }
        expect(a.medals).toBe(0);
      }
    }
  });
  it("keeps the peoples apart on the sliders that make a silhouette", () => {
    const mean = (p: PeopleId, k: "height" | "torsoWidth" | "belly" | "shoulderWidth"): number => seeds.reduce((t, s) => t + applyPeople(generateCharacter(s), p, s)[k], 0) / seeds.length;
    expect(mean("kessarine", "height") - mean("brinefolk", "height")).toBeGreaterThan(80);
    expect(mean("marchers", "shoulderWidth") - mean("vesperine", "shoulderWidth")).toBeGreaterThan(80);
    expect(mean("brinefolk", "belly") - mean("kessarine", "belly")).toBeGreaterThan(80);
    expect(mean("marchers", "torsoWidth") - mean("vesperine", "torsoWidth")).toBeGreaterThan(80);
  });
  it("wayfarers are the mix: every other people's silhouette turns up, with a pack", () => {
    const heights = seeds.map((s) => applyPeople(generateCharacter(s), "wayfarers", s).height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(100);
    const packed = seeds.filter((s) => applyPeople(generateCharacter(s), "wayfarers", s).pack !== 0).length;
    expect(packed).toBe(seeds.length);
    expect(WAYFARER_MIX.every((p) => (NATIVE as readonly string[]).includes(p))).toBe(true);
  });
});

describe("overlays and catalogue additions", () => {
  it("every overlay field is a real field and every ranged slider is a slider", () => {
    const keys = new Set(FIELDS.map((f) => f.key as string));
    for (const p of NATIVE) {
      const o = PEOPLE_OVERLAYS[p as keyof typeof PEOPLE_OVERLAYS];
      for (const k of Object.keys(o.body)) expect(keys.has(k), `${p}.${k}`).toBe(true);
      for (const k of Object.keys(o.pick)) expect(keys.has(k), `${p}.${k}`).toBe(true);
      for (const [lo, hi] of Object.values(o.body)) expect(lo >= 0 && hi <= 255 && lo < hi).toBe(true);
    }
  });
  it("every name an overlay uses is an existing option or a declared addition", () => {
    const additions = new Set(Object.values(PEOPLE_CATALOG_ADDITIONS).flat() as string[]);
    const all = new Set<string>([...C.HATS, ...C.JACKETS, ...C.SHIRTS, ...C.TROUSERS, ...C.BOOTS, ...C.BELTS, ...C.SASHES, ...C.NECKWEAR, ...C.PACKS, ...C.HIP_GEAR, ...C.GLOVES, ...C.HAIR_STYLES, ...C.HAIR_ACCESSORIES, ...C.FACE_PAINT, ...C.EARRINGS, ...C.COAT_TRIMS, ...C.HAT_TRIMS, ...C.TROUSER_TRIMS, ...C.MOUSTACHES, ...C.BEARDS]);
    for (const p of NATIVE) {
      const o = PEOPLE_OVERLAYS[p as keyof typeof PEOPLE_OVERLAYS];
      for (const t of [...Object.values(o.pick), ...Object.values(o.grandPick)]) for (const [name] of t!) expect(all.has(name) || additions.has(name), `${p}: "${name}"`).toBe(true);
    }
  });
  it("the additions are named once, are not real-world garments, and (when landed) exist at the END of their catalogue", () => {
    const banned = /\b(fez|turban|poncho|kimono|kilt|sari|kaftan|keffiyeh|sombrero|beret|top knot|war paint|headdress|burka|hijab|yarmulke)\b/i;
    const names = Object.values(PEOPLE_CATALOG_ADDITIONS).flat() as string[];
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(banned.test(n), n).toBe(false);
    const lists: Record<AdditionKey, readonly string[]> = { HATS: C.HATS, JACKETS: C.JACKETS, NECKWEAR: C.NECKWEAR, FACE_PAINT: C.FACE_PAINT, HAIR_STYLES: C.HAIR_STYLES, HAIR_ACCESSORIES: C.HAIR_ACCESSORIES, HIP_GEAR: C.HIP_GEAR, BOOTS: C.BOOTS };
    for (const k of Object.keys(PEOPLE_CATALOG_ADDITIONS) as AdditionKey[]) {
      const add = PEOPLE_CATALOG_ADDITIONS[k];
      if (!PEOPLE_ADDITIONS_LANDED) continue;
      expect(lists[k].slice(-add.length), k).toEqual([...add]);
    }
  });
});

describe("the fictional peoples (D-038): silhouettes, dress, the guardrails", () => {
  const sample = Array.from({ length: 80 }, (_, i) => 9000 + i * 7919);
  const mean = (p: PeopleId, k: keyof ReturnType<typeof generateCharacter>): number => sample.reduce((t, s) => t + applyPeople(generateCharacter(s), p, s)[k], 0) / sample.length;
  const SIL = ["height", "torsoWidth", "belly", "shoulderWidth", "legLength", "headScale", "posture", "armLength"] as const;

  it("the generic generator never draws a native option: adding them changed nobody who already existed", () => {
    for (let s = 0; s < 1500; s++) {
      const spec = generateCharacter(s * 13 + 1) as unknown as Record<string, number>;
      for (const [field, from] of Object.entries(NATIVE_FROM)) expect(spec[field]!, `seed ${s} ${field}`).toBeLessThan(from);
    }
  });

  it("NATIVE_FROM is where the additions start (end of each list), so the whole addition block is what the generic generator skips", () => {
    const lists: Record<string, readonly string[]> = { hat: C.HATS, jacket: C.JACKETS, neckwear: C.NECKWEAR, facePaint: C.FACE_PAINT, hair: C.HAIR_STYLES, hairAcc: C.HAIR_ACCESSORIES, hipGear: C.HIP_GEAR, boots: C.BOOTS };
    const keys: Record<string, AdditionKey> = { hat: "HATS", jacket: "JACKETS", neckwear: "NECKWEAR", facePaint: "FACE_PAINT", hair: "HAIR_STYLES", hairAcc: "HAIR_ACCESSORIES", hipGear: "HIP_GEAR", boots: "BOOTS" };
    for (const [field, from] of Object.entries(NATIVE_FROM)) {
      expect(lists[field]!.slice(from), field).toEqual([...PEOPLE_CATALOG_ADDITIONS[keys[field]!]]);
    }
  });

  it("the five peoples read apart by SILHOUETTE: the mean body (eight sliders, 0..1) of any two is at least 0.35 apart", () => {
    const sig = Object.fromEntries(NATIVE.map((p) => [p, SIL.map((k) => mean(p, k) / 255)])) as Record<string, number[]>;
    for (const a of NATIVE) for (const b of NATIVE) if (a < b) expect(Math.hypot(...sig[a]!.map((v, i) => v - sig[b]![i]!)), `${a} vs ${b}`).toBeGreaterThan(0.35);
  });

  it("and by DRESS: each people's commonest hat and commonest garment is its own", () => {
    const top = (p: PeopleId, f: "hat" | "jacket", list: readonly string[]): string => {
      const m = new Map<string, number>();
      for (const s of sample) {
        const n = list[applyPeople(generateCharacter(s), p, s)[f]]!;
        m.set(n, (m.get(n) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    };
    const hats = NATIVE.map((p) => top(p, "hat", C.HATS));
    const coats = NATIVE.map((p) => top(p, "jacket", C.JACKETS));
    expect(new Set(hats).size, hats.join()).toBe(NATIVE.length);
    expect(new Set(coats).size, coats.join()).toBe(NATIVE.length);
    for (const n of [...hats, ...coats]) expect(Object.values(PEOPLE_CATALOG_ADDITIONS).flat() as string[], n).toContain(n);
  });

  it("every native wears at least one piece of its own people's dress, and none carries the Society's gear (spectacles, a naturalist's net, gilt trim)", () => {
    const own = new Set<string>(Object.values(PEOPLE_CATALOG_ADDITIONS).flat() as string[]);
    for (const p of NATIVE) {
      for (const s of sample.slice(0, 40)) {
        const a = applyPeople(generateCharacter(s), p, s);
        const worn = [C.HATS[a.hat], C.JACKETS[a.jacket], C.NECKWEAR[a.neckwear], C.FACE_PAINT[a.facePaint], C.HAIR_STYLES[a.hair], C.HAIR_ACCESSORIES[a.hairAcc], C.HIP_GEAR[a.hipGear], C.BOOTS[a.boots]];
        expect([C.HATS[a.hat], C.JACKETS[a.jacket], C.NECKWEAR[a.neckwear], C.HAIR_STYLES[a.hair]].some((n) => own.has(n!)), `${p} seed ${s}: ${worn.join(", ")}`).toBe(true);
        expect(a.eyewear, `${p} eyewear`).toBe(0);
        expect(a.pack, `${p} pack`).toBe(0);
        expect([1, 3, 4], `${p} hat trim`).not.toContain(a.hatTrim);
        expect([1, 4], `${p} coat trim`).not.toContain(a.coatTrim);
      }
    }
  });

  it("a wayfarer is a person of one of the others with a pack", () => {
    for (const s of sample.slice(0, 30)) expect(applyPeople(generateCharacter(s), "wayfarers", s).pack).not.toBe(0);
  });

  it("every dye is a real cloth dye, and the overlay carries no colour literal (colours live in palette.ts)", () => {
    for (const p of NATIVE) for (const d of PEOPLE[p].dyes) expect(DYE[d], `${p} ${d}`).toBeLessThan(PALETTE.cloth.length);
    const src = readFileSync(new URL("./peoples.ts", import.meta.url), "utf8");
    expect(src.match(/0x[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
  });

  it("no catalogue name in any list is a real people's dress or a real tradition (the old Fez, Poncho and Top Knot stay in the creator, never on a native)", () => {
    const banned = /\b(turban|kimono|kilt|sari|kaftan|keffiyeh|sombrero|beret|war paint|headdress|burka|hijab|yarmulke|tartan|sarong|dashiki|lederhosen)\b/i;
    for (const list of [C.HATS, C.JACKETS, C.NECKWEAR, C.FACE_PAINT, C.HAIR_STYLES, C.HAIR_ACCESSORIES, C.HIP_GEAR, C.BOOTS]) for (const n of list) expect(banned.test(n), n).toBe(false);
  });
});
