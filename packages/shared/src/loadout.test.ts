import { describe, expect, it } from "vitest";
import type { Follower, Loadout } from "./expeditionTypes.ts";
import {
  CAPACITY, DROP_ORDER, LOADOUT_ITEMS, emptyLoadout, loadWord, loadoutCost, loadoutEquals, loadoutWeight, normalizeLoadout, partyCapacity, prepEffects, stepLoadout, trimLoadout, validateLoadout,
} from "./loadout.ts";
import { Rng } from "./rng.ts";

const L = (o: Partial<Loadout> = {}): Loadout => ({ ...emptyLoadout(), ...o });
const porter = (): Pick<Follower, "kind"> => ({ kind: "porter" });
const ctx = (purse: number, humans = 1, roster: Pick<Follower, "kind">[] = []) => ({ purse, humans, roster });

describe("loadout table", () => {
  it("prices and weighs per the design (ammo 6 kg / 10, kit 3 / 6, provisions 4 / 4, keg 8 / 8, horse 28, wagon 34)", () => {
    const by = Object.fromEntries(LOADOUT_ITEMS.map((i) => [i.key, i]));
    expect([by.ammo!.kg, by.ammo!.cost]).toEqual([6, 10]);
    expect([by.medical!.kg, by.medical!.cost]).toEqual([3, 6]);
    expect([by.provisions!.kg, by.provisions!.cost]).toEqual([4, 4]);
    expect([by.powder!.kg, by.powder!.cost]).toEqual([8, 8]);
    expect(by.horses!.cost).toBe(28);
    expect(by.wagon!.cost).toBe(34);
    expect(loadoutCost(L({ ammo: 2, medical: 1, provisions: 3, powder: 1, horses: 2, wagon: true }))).toBe(20 + 6 + 12 + 8 + 56 + 34);
    expect(loadoutWeight(L({ ammo: 2, medical: 1, provisions: 3, powder: 1, horses: 2, wagon: true }))).toBe(12 + 3 + 12 + 8);
    expect(loadoutCost(L())).toBe(0);
  });

  it("capacity: 30 per human, +25 per porter, +90 wagon, +40 per horse beyond the first", () => {
    expect(partyCapacity(1, [], L())).toBe(30);
    expect(partyCapacity(4, [], L())).toBe(120);
    expect(partyCapacity(2, [porter(), { kind: "rifleman" }, porter()], L())).toBe(60 + 50);
    expect(partyCapacity(1, [], L({ horses: 1 }))).toBe(30);
    expect(partyCapacity(1, [], L({ horses: 2 }))).toBe(30 + CAPACITY.extraHorse);
    expect(partyCapacity(1, [], L({ horses: 1, wagon: true }))).toBe(30 + CAPACITY.wagon);
    expect(partyCapacity(0, [], L())).toBe(30); // never below one human
    expect(partyCapacity(Number.NaN, [], L())).toBe(30);
  });

  it("the gauge speaks in words", () => {
    expect(loadWord(0, 30)).toBe("Light");
    expect(loadWord(16, 30)).toBe("Light");
    expect(loadWord(17, 30)).toBe("Laden");
    expect(loadWord(26, 30)).toBe("Full");
    expect(loadWord(30, 30)).toBe("Full");
    expect(loadWord(31, 30)).toBe("Overloaded");
  });
});

describe("validateLoadout", () => {
  it("accepts a fitting, affordable manifest", () => {
    const v = validateLoadout(L({ ammo: 1, medical: 1 }), ctx(100));
    expect(v).toMatchObject({ ok: true, problems: [], cost: 16, weight: 9, capacity: 30 });
  });
  it("wagon without a horse", () => {
    const v = validateLoadout(L({ wagon: true }), ctx(500));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/horse/);
  });
  it("overweight and unaffordable are separate problems, with the shortfall named", () => {
    const heavy = L({ ammo: 2, powder: 3 }); // 12 + 24 = 36 kg, £44
    const v = validateLoadout(heavy, ctx(100));
    expect(v.ok).toBe(false);
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toMatch(/Overweight by 6 kg/);
    const poor = validateLoadout(L({ ammo: 1 }), ctx(4));
    expect(poor.problems).toHaveLength(1);
    expect(poor.problems[0]).toMatch(/£6 short/);
    expect(validateLoadout(heavy, ctx(10)).problems).toHaveLength(2);
  });
  it("a wagon and horses buy capacity, porters too", () => {
    const big = L({ ammo: 2, powder: 3, horses: 1, wagon: true });
    expect(validateLoadout(big, ctx(500)).ok).toBe(true);
    expect(validateLoadout(L({ ammo: 2, powder: 3 }), ctx(500, 1, [porter()])).ok).toBe(true);
  });
});

describe("normalizeLoadout", () => {
  it("clamps, floors and drops unknown keys", () => {
    expect(normalizeLoadout({ ammo: 9, medical: -4, provisions: 1.9, powder: "3", horses: 2, wagon: true, extra: 1 })).toEqual({ ammo: 2, medical: 0, provisions: 1, powder: 0, horses: 2, wagon: true });
    expect(normalizeLoadout(null)).toEqual(emptyLoadout());
    expect(normalizeLoadout([1, 2, 3])).toEqual(emptyLoadout());
    expect(normalizeLoadout({ wagon: 1 })).toEqual(emptyLoadout()); // only a real `true` is a wagon
    expect(normalizeLoadout({ ammo: Number.NaN, medical: Infinity })).toEqual(emptyLoadout());
  });
  it("2000 hostile values never throw and always give a well-formed manifest", () => {
    const rng = new Rng(77);
    const junk: unknown[] = [undefined, null, 0, 1, -1, NaN, Infinity, "", "x", "{}", [], {}, true, false, Symbol.iterator, () => 1, 1n, new Date(0)];
    for (let i = 0; i < 2000; i++) {
      const v: unknown = i < junk.length ? junk[i]
        : { ammo: junk[rng.int(0, junk.length - 1)], medical: rng.int(-9, 9) + rng.next(), provisions: rng.int(-1e9, 1e9), powder: junk[rng.int(0, junk.length - 1)], horses: rng.next() * 1e30, wagon: rng.next() < 0.5, __proto__: { ammo: 2 }, constructor: 7 };
      const l = normalizeLoadout(v);
      expect(l.ammo).toBeGreaterThanOrEqual(0); expect(l.ammo).toBeLessThanOrEqual(2); expect(Number.isInteger(l.ammo)).toBe(true);
      expect(l.medical).toBeLessThanOrEqual(3); expect(l.provisions).toBeLessThanOrEqual(3); expect(l.powder).toBeLessThanOrEqual(3); expect(l.horses).toBeLessThanOrEqual(2);
      expect(typeof l.wagon).toBe("boolean");
      expect(Object.keys(l).sort()).toEqual(["ammo", "horses", "medical", "powder", "provisions", "wagon"]);
    }
  });
  it("an inherited key is not read (prototype pollution cannot hand out items)", () => {
    const evil = Object.create({ ammo: 2, wagon: true }) as unknown;
    expect(loadoutEquals(normalizeLoadout(evil), emptyLoadout())).toBe(true);
  });
});

describe("trimLoadout (departure)", () => {
  it("leaves a fitting manifest alone", () => {
    const t = trimLoadout(L({ ammo: 1, medical: 1 }), ctx(100));
    expect(t.dropped).toBe(0);
    expect(t.lines).toEqual([]);
    expect(t.loadout).toEqual(L({ ammo: 1, medical: 1 }));
  });
  it("drops in the fixed order: powder, provisions, wagon, horses, ammo, medical", () => {
    expect(DROP_ORDER).toEqual(["powder", "provisions", "wagon", "horses", "ammo", "medical"]);
    const all = L({ ammo: 2, medical: 3, provisions: 3, powder: 3, horses: 2, wagon: true }); // £20+18+12+24+56+34 = 164
    // £150: the first unit of powder goes (164 -> 156 still too much), a second (148 fits)
    let t = trimLoadout(all, ctx(150, 4, [porter(), porter(), porter(), porter()]));
    expect(t.loadout).toEqual({ ...all, powder: 1 });
    expect(t.dropped).toBe(2);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatch(/Powder keg x2/);
    // £100: all powder and provisions, then the wagon (34), which is enough
    t = trimLoadout(all, ctx(100, 4, [porter(), porter(), porter(), porter()]));
    expect(t.loadout).toEqual({ ammo: 2, medical: 3, provisions: 0, powder: 0, horses: 2, wagon: false });
    // £0: everything goes, order intact, and the result is valid
    t = trimLoadout(all, ctx(0));
    expect(t.loadout).toEqual(emptyLoadout());
    expect(validateLoadout(t.loadout, ctx(0)).ok).toBe(true);
  });
  it("a wagon without a horse goes at once; a wagon never outlives its last horse", () => {
    expect(trimLoadout(L({ wagon: true, ammo: 1 }), ctx(500)).loadout).toEqual(L({ ammo: 1 }));
    const t = trimLoadout(L({ wagon: true, horses: 1 }), ctx(30)); // £62 for £30: the wagon (34) goes first anyway; then still £28 = fits? horse 28 <= 30
    expect(t.loadout).toEqual(L({ horses: 1 }));
    const u = trimLoadout(L({ wagon: true, horses: 1 }), ctx(10));
    expect(u.loadout).toEqual(emptyLoadout());
  });
  it("trims for weight too, with the same order", () => {
    const t = trimLoadout(L({ ammo: 2, powder: 3 }), ctx(500)); // 36 kg for 30
    expect(t.loadout).toEqual(L({ ammo: 2, powder: 2 })); // one keg (8 kg) is enough: 28 kg
  });
  it("never mutates its input and tolerates garbage", () => {
    const a = L({ powder: 3 });
    trimLoadout(a, ctx(0));
    expect(a.powder).toBe(3);
    expect(trimLoadout({ ammo: 99 } as never, ctx(Number.NaN)).loadout).toEqual(emptyLoadout());
  });
});

describe("prepEffects & stepper", () => {
  it("ammo is +50% reserve per crate, a kit is four dressings", () => {
    expect(prepEffects(L({ ammo: 2, medical: 3, provisions: 1, powder: 2, horses: 1, wagon: true }))).toEqual({ reserveMul: 2, dressings: 12, provisions: 1, kegs: 2, horses: 1, wagon: true });
    expect(prepEffects(L({ wagon: true }))).toMatchObject({ wagon: false }); // no horse, no wagon at landfall
    expect(prepEffects(L()).reserveMul).toBe(1);
  });
  it("stepLoadout clamps and toggles", () => {
    expect(stepLoadout(L(), "ammo", 1).ammo).toBe(1);
    expect(stepLoadout(L({ ammo: 2 }), "ammo", 1).ammo).toBe(2);
    expect(stepLoadout(L(), "ammo", -1).ammo).toBe(0);
    expect(stepLoadout(L(), "wagon", 1).wagon).toBe(true);
    expect(stepLoadout(L({ wagon: true }), "wagon", -1).wagon).toBe(false);
  });
});
