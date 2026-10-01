import { describe, expect, it } from "vitest";
import { PEOPLE_IDS, WAYFARER_MIX, type PeopleId } from "@cb/shared";
import * as C from "./catalog.ts";
import { COLONIAL_CODED, PEOPLE_ADDITIONS_LANDED, PEOPLE_CATALOG_ADDITIONS, PEOPLE_OVERLAYS, applyPeople, type AdditionKey } from "./peoples.ts";
import { FIELDS, generateCharacter, HISTORY_KEYS, sanitizeSpec } from "./spec.ts";

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
          const list = field === "epaulettes" ? C.EPAULETTES : field === "decoration" ? C.DECORATIONS : field === "eyewear" ? C.EYEWEAR : ((C as unknown as Record<string, readonly string[]>)[{ hat: "HATS", jacket: "JACKETS", neckwear: "NECKWEAR", hair: "HAIR_STYLES", moustache: "MOUSTACHES", hipGear: "HIP_GEAR", belt: "BELTS", sash: "SASHES" }[field]!]!);
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
