import { describe, expect, it } from "vitest";
import { FOLLOWER_CAP } from "./campaignTypes.ts";
import type { PartyState } from "./expeditionTypes.ts";
import { hirePool, newParty } from "./followers.ts";
import { PARTY_JSON_MAX, parseCommandMsg, parseHireMsg, parseLoadoutMsg, parseParty, serializeParty } from "./partyState.ts";
import { Rng } from "./rng.ts";

const fullParty = (): PartyState => {
  const p = newParty();
  p.loadout = { ammo: 2, medical: 3, provisions: 1, powder: 2, horses: 2, wagon: true };
  p.roster = [...hirePool(3, 1), ...hirePool(3, 2)].slice(0, FOLLOWER_CAP);
  p.roster.forEach((f, i) => { f.owed = 14 * i; f.loyalty = 20 + i * 15; f.wounded = i % 3; });
  p.medical = 12;
  p.provisions = 2;
  return p;
};

describe("party wire form", () => {
  it("round-trips and stays well under the 2 KB budget with four hands", () => {
    const p = fullParty();
    const s = serializeParty(p);
    expect(s.length).toBeLessThan(PARTY_JSON_MAX);
    expect(s.length).toBeLessThan(1500);
    expect(parseParty(s)).toEqual(p);
    expect(serializeParty(parseParty(s)!)).toBe(s);
    expect(parseParty(serializeParty(newParty()))).toEqual(newParty());
  });
  it("rejects what is not a party", () => {
    for (const bad of ["", "{", "null", "[]", "\"x\"", "{\"v\":2}", "{\"roster\":[]}", "x".repeat(PARTY_JSON_MAX + 1)]) expect(parseParty(bad), bad.slice(0, 20)).toBeUndefined();
    for (const bad of [undefined, null, 5, {}, []]) expect(parseParty(bad)).toBeUndefined();
  });
  it("clamps every field, drops bad or duplicate hands, caps the roster", () => {
    const f = hirePool(9, 1)[0]!;
    const hostile = JSON.stringify({
      v: 1, loadout: { ammo: 99, wagon: "yes" }, medical: 1e9, provisions: -4,
      roster: [
        { ...f, loyalty: 9999, morale: -5, owed: 1e12, wounded: 99, wage: "x" }, { ...f }, { ...f, id: "Bad Id!" }, { ...f, kind: "dragoon" }, { ...f, id: "hand-zzz", name: "<b>Evil</b>\u0000" },
        ...Array.from({ length: 6 }, (_, i) => ({ ...f, id: `hand-q${i}`, name: "N" })), 5, null, "x",
      ],
    });
    const p = parseParty(hostile)!;
    expect(p).toBeDefined();
    expect(p.loadout).toEqual({ ammo: 2, medical: 0, provisions: 0, powder: 0, horses: 0, wagon: false });
    expect(p.medical).toBe(99);
    expect(p.provisions).toBe(0);
    expect(p.roster.length).toBeLessThanOrEqual(FOLLOWER_CAP);
    expect(new Set(p.roster.map((r) => r.id)).size).toBe(p.roster.length);
    const first = p.roster[0]!;
    expect(first).toMatchObject({ loyalty: 100, morale: 0, owed: 9999, wounded: 9 });
    expect(first.wage).toBeGreaterThan(0); // "x" falls back to the kind's wage
    for (const r of p.roster) expect(r.name).not.toMatch(/[<>\u0000]/);
  });
  it("2000 hostile strings never throw and give undefined or a valid party", () => {
    const rng = new Rng(5);
    const base = serializeParty(fullParty());
    for (let i = 0; i < 2000; i++) {
      let s: string;
      const mode = i % 4;
      if (mode === 0) { const a = rng.int(0, base.length - 1); s = base.slice(0, a) + String.fromCharCode(rng.int(0, 0xffff)) + base.slice(a + rng.int(0, 3)); }
      else if (mode === 1) s = base.slice(0, rng.int(0, base.length));
      else if (mode === 2) s = Array.from({ length: rng.int(0, 60) }, () => String.fromCharCode(rng.int(0, 255))).join("");
      else s = JSON.stringify({ v: 1, roster: Array.from({ length: rng.int(0, 9) }, () => ({ id: "hand-" + rng.int(0, 9999).toString(36), kind: ["porter", "rifleman", "surgeon", "x", 4][rng.int(0, 4)], name: rng.int(0, 1) ? "N" : 7, loyalty: rng.next() * 300 - 100 })), loadout: { ammo: rng.next() * 9 } });
      const p = parseParty(s);
      if (p === undefined) continue;
      expect(p.roster.length).toBeLessThanOrEqual(FOLLOWER_CAP);
      expect(serializeParty(p).length).toBeLessThan(PARTY_JSON_MAX);
      for (const r of p.roster) {
        expect(r.loyalty).toBeGreaterThanOrEqual(0); expect(r.loyalty).toBeLessThanOrEqual(100);
        expect(Number.isInteger(r.owed)).toBe(true);
      }
    }
  });
});

describe("message parsers (structure only)", () => {
  it("loadoutSet", () => {
    expect(parseLoadoutMsg({ loadout: { ammo: 1, wagon: true } })).toEqual({ ammo: 1, medical: 0, provisions: 0, powder: 0, horses: 0, wagon: true });
    for (const bad of [undefined, null, 4, "x", [], {}, { loadout: 5 }, { loadout: null }, { loadout: [] }]) expect(parseLoadoutMsg(bad)).toBeUndefined();
  });
  it("hire", () => {
    expect(parseHireMsg({ id: "hand-p1a2b3", on: true })).toEqual({ id: "hand-p1a2b3", on: true });
    expect(parseHireMsg({ id: "hand-p1a2b3", on: false })).toEqual({ id: "hand-p1a2b3", on: false });
    for (const bad of [null, {}, { id: "x", on: true }, { id: "hand-x", on: "yes" }, { id: 5, on: true }, { id: "A".repeat(30), on: true }, { id: "hand-x y", on: true }, { id: "../etc", on: true }]) expect(parseHireMsg(bad), JSON.stringify(bad)).toBeUndefined();
  });
  it("command: intents, points, targets, masks", () => {
    expect(parseCommandMsg({ intent: "follow" })).toEqual({ intent: "follow" });
    expect(parseCommandMsg({ intent: "hold", at: { x: 3, z: -4 }, who: 5 })).toEqual({ intent: "hold", at: { x: 3, z: -4 }, who: 5 });
    expect(parseCommandMsg({ intent: "attack", target: "deserter-1" })).toEqual({ intent: "attack", target: "deserter-1" });
    expect(parseCommandMsg({ intent: "fetch", target: "p17", at: { x: 1, z: 2 } })).toEqual({ intent: "fetch", target: "p17", at: { x: 1, z: 2 } });
    expect(parseCommandMsg({ intent: "retreat", who: 0 })).toEqual({ intent: "retreat", who: 0 });
    expect(parseCommandMsg({ intent: "follow", who: 0b110011 })?.who).toBe(0b0011); // bits beyond the cap are stripped
    const bad: unknown[] = [
      null, 5, "follow", [], {}, { intent: "dance" }, { intent: 3 }, { intent: "hold", at: 5 }, { intent: "hold", at: { x: Infinity, z: 0 } }, { intent: "hold", at: { x: "1", z: 0 } },
      { intent: "hold", at: { x: 5000, z: 0 } }, { intent: "attack", target: "" }, { intent: "attack", target: "x".repeat(49) }, { intent: "attack", target: 5 },
      { intent: "follow", who: -1 }, { intent: "follow", who: Number.NaN }, { intent: "follow", who: "3" }, { intent: "follow", who: 16 }, { intent: "follow", who: 2 ** 40 },
    ];
    for (const b of bad) expect(parseCommandMsg(b), JSON.stringify(b)).toBeUndefined();
  });
  it("an inherited intent is not read", () => {
    expect(parseCommandMsg(Object.create({ intent: "follow" }))).toBeUndefined();
  });
});
