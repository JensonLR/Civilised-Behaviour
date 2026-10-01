import { describe, expect, it } from "vitest";
import { FOLLOWER_CAP, NPC, type ScenarioOutcome } from "./campaignTypes.ts";
import type { Follower, PartyState } from "./expeditionTypes.ts";
import {
  FOLLOWER_DEFS, FOLLOWER_KINDS, HIRE_CANDIDATES, OWED_LOYALTY, OWED_MORALE_CAP, WOUNDED_EXPEDITIONS, dismiss, effectiveBravery, followerSpecs, hire, hirePool, newParty, settleRoster, startMorale, wageDue,
} from "./followers.ts";
import { NPC_SIDE } from "./expeditionTypes.ts";
import { garrisonRoster } from "./garrison.ts";
import { newCampaign } from "./factions.ts";
import { WEAPON } from "./weapons.ts";

const outcome: Pick<ScenarioOutcome, "resolution" | "brokePromise"> = { resolution: "paid", brokePromise: false };
const SEED = 41;
const withRoster = (...fs: Follower[]): PartyState => ({ ...newParty(), roster: fs });
const mk = (kind: Follower["kind"], o: Partial<Follower> = {}): Follower => ({ ...hirePool(SEED, 1).find((f) => f.kind === kind) ?? hirePool(SEED, 2).find((f) => f.kind === kind)!, ...o });

describe("authored kinds", () => {
  it("wages, bravery, arms and roles per the design", () => {
    expect(FOLLOWER_DEFS.porter).toMatchObject({ wage: 6, bravery: 35, weapon: WEAPON.FISTS, carry: 25, role: NPC.PORTER });
    expect(FOLLOWER_DEFS.rifleman).toMatchObject({ wage: 14, bravery: 60, skill: 62, weapon: WEAPON.RIFLE, role: NPC.HIRED_RIFLE });
    expect(FOLLOWER_DEFS.surgeon).toMatchObject({ wage: 18, bravery: 45, weapon: WEAPON.PISTOL, role: NPC.SURGEON });
    for (const k of FOLLOWER_KINDS) {
      const d = FOLLOWER_DEFS[k];
      expect(d.names).toHaveLength(6);
      expect(new Set(d.names).size).toBe(6);
      expect(d.grumbles.length).toBeGreaterThanOrEqual(3);
      expect(d.desertions.length).toBeGreaterThanOrEqual(3);
      expect(d.hireLines.length).toBeGreaterThanOrEqual(3);
      expect(NPC_SIDE[d.role]).toBe("party");
      for (const n of d.names) expect(n.length).toBeLessThanOrEqual(32);
      for (const v of Object.values(d.look)) expect(Number.isInteger(v) && v >= 0).toBe(true);
    }
  });

  // The world is fictional: the same banned-term idea as noRealWorld.test.ts, applied to this file's authored text.
  it("authored text names nothing from the real world", () => {
    const banned = /(?<![a-z])(england|english|britain|british|france|french|german|germany|spain|spanish|russia|russian|china|chinese|japan|india|indian|america|american|africa|african|asia|europe|london|paris|berlin|rome|cairo|delhi|christian|muslim|islam|jewish|hindu|buddhist|catholic|protestant|church|pope|bible|god|jesus|allah|mosque|missionary)(?![a-z])/i;
    const strings: string[] = [];
    for (const d of Object.values(FOLLOWER_DEFS)) strings.push(d.title, d.stamp, d.blurb, ...d.names, ...d.grumbles, ...d.desertions, ...d.hireLines);
    for (const s of strings) expect(banned.test(s), s).toBe(false);
  });
});

describe("hirePool", () => {
  it("is deterministic per (seed, day), three candidates, at least two kinds, distinct names and ids", () => {
    for (let seed = 0; seed < 40; seed++) for (let day = 1; day < 12; day++) {
      const a = hirePool(seed, day);
      expect(a).toEqual(hirePool(seed, day));
      expect(a).toHaveLength(HIRE_CANDIDATES);
      expect(new Set(a.map((f) => f.kind)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(a.map((f) => f.id)).size).toBe(a.length);
      expect(new Set(a.map((f) => f.name)).size).toBe(a.length);
      for (const f of a) {
        expect(f).toMatchObject({ wage: FOLLOWER_DEFS[f.kind].wage, loyalty: 50, morale: 70, wounded: 0, owed: 0 });
        expect(f.bravery).toBeGreaterThanOrEqual(FOLLOWER_DEFS[f.kind].bravery - 8);
        expect(f.bravery).toBeLessThanOrEqual(FOLLOWER_DEFS[f.kind].bravery + 8);
        expect(f.id).toMatch(/^hand-[a-z0-9]+$/);
        expect(f.id.length).toBeLessThanOrEqual(24);
      }
    }
  });
  it("varies with the day and the seed", () => {
    const sig = (seed: number, day: number): string => hirePool(seed, day).map((f) => f.id).join();
    expect(new Set([1, 2, 3, 4, 5, 6].map((d) => sig(SEED, d))).size).toBe(6);
    expect(sig(1, 1)).not.toBe(sig(2, 1));
  });
  it("leaves out whoever is already on the roster", () => {
    const pool = hirePool(SEED, 3);
    expect(hirePool(SEED, 3, withRoster(pool[0]!)).map((f) => f.id)).toEqual(pool.slice(1).map((f) => f.id));
  });
  it("ids never collide with the garrison's", () => {
    const g = new Set(garrisonRoster(newCampaign(SEED), SEED).map((s) => s.id));
    for (let d = 1; d < 30; d++) for (const f of hirePool(SEED, d)) expect(g.has(f.id)).toBe(false);
  });
});

describe("hire / dismiss (purse exact to the penny)", () => {
  const pool = hirePool(SEED, 2);
  it("hiring costs one wage and adds the candidate; inputs are untouched", () => {
    const p0 = newParty();
    const c = pool[0]!;
    const r = hire(p0, 100, c.id, SEED, 2);
    expect(r.ok).toBe(true);
    expect(r.purse).toBe(100 - c.wage);
    expect(r.party.roster).toEqual([c]);
    expect(p0.roster).toEqual([]);
  });
  it("refuses: unknown id, wrong day, duplicate, cap, short purse, NaN purse", () => {
    expect(hire(newParty(), 100, "hand-nobody", SEED, 2)).toMatchObject({ ok: false, purse: 100 });
    expect(hire(newParty(), 100, pool[0]!.id, SEED, 3)).toMatchObject({ ok: false }); // yesterday's candidate
    const once = hire(newParty(), 100, pool[0]!.id, SEED, 2);
    expect(hire(once.party, once.purse, pool[0]!.id, SEED, 2)).toMatchObject({ ok: false, purse: once.purse });
    expect(hire(newParty(), pool[1]!.wage - 1, pool[1]!.id, SEED, 2)).toMatchObject({ ok: false });
    expect(hire(newParty(), Number.NaN, pool[1]!.id, SEED, 2).ok).toBe(false);
    // the cap: fill four from four different days
    let party = newParty();
    let purse = 1000;
    for (let day = 1; day <= FOLLOWER_CAP; day++) {
      const r = hire(party, purse, hirePool(SEED, day)[0]!.id, SEED, day);
      expect(r.ok).toBe(true);
      party = r.party;
      purse = r.purse;
    }
    expect(party.roster).toHaveLength(FOLLOWER_CAP);
    const over = hire(party, purse, hirePool(SEED, 9)[0]!.id, SEED, 9);
    expect(over.ok).toBe(false);
    expect(over.purse).toBe(purse);
    expect(over.party.roster).toHaveLength(FOLLOWER_CAP);
  });
  it("dismiss pays what is owed first, or refuses and changes nothing", () => {
    const f = mk("rifleman", { owed: 28 });
    expect(dismiss(withRoster(f), 27, f.id)).toMatchObject({ ok: false, purse: 27 });
    const r = dismiss(withRoster(f), 30, f.id);
    expect(r).toMatchObject({ ok: true, purse: 2 });
    expect(r.party.roster).toEqual([]);
    expect(dismiss(withRoster(mk("porter")), 0, mk("porter").id)).toMatchObject({ ok: true, purse: 0 });
    expect(dismiss(newParty(), 5, "hand-x").ok).toBe(false);
  });
});

describe("settleRoster", () => {
  const rif = (o: Partial<Follower> = {}): Follower => mk("rifleman", { id: "hand-r1", ...o });
  const por = (o: Partial<Follower> = {}): Follower => mk("porter", { id: "hand-p1", ...o });
  const sur = (o: Partial<Follower> = {}): Follower => mk("surgeon", { id: "hand-s1", ...o });

  it("pays every wage in full, in roster order, to the penny", () => {
    const party = withRoster(rif(), por(), sur());
    const r = settleRoster(party, 100, outcome);
    expect(r.purse).toBe(100 - 14 - 6 - 18);
    expect(r.party.roster.every((f) => f.owed === 0)).toBe(true);
    expect(r.party.roster.map((f) => f.loyalty)).toEqual([55, 55, 55]);
    expect(r.lines[0]).toBe("Wages: £38 paid to 3 hands.");
    expect(party.roster[0]!.loyalty).toBe(50); // input untouched
  });
  it("a wage is all or nothing: the purse that cannot cover the next one is left alone and the debt is carried", () => {
    const r = settleRoster(withRoster(rif(), por(), sur()), 20, outcome); // 14 paid, 6 paid, surgeon 18 > 0 left
    expect(r.purse).toBe(0);
    expect(r.party.roster.map((f) => f.owed)).toEqual([0, 0, 18]);
    const r2 = settleRoster(withRoster(sur(), rif()), 20, outcome); // surgeon 18 first, then 14 > 2
    expect(r2.purse).toBe(2);
    expect(r2.party.roster.map((f) => f.owed)).toEqual([0, 14]);
    for (const purse of [0, 1, 13, 14, 15, 37, 38, 39, 1000]) {
      const r3 = settleRoster(withRoster(rif(), por(), sur()), purse, outcome);
      const paid = r3.party.roster.reduce((s, f) => s + (f.owed === 0 ? f.wage : 0), 0);
      expect(r3.purse).toBe(purse - paid);
      expect(r3.purse).toBeGreaterThanOrEqual(0);
    }
  });
  it("unpaid: owed carries, loyalty -15, morale capped at 60, a grumble line (none with provisions)", () => {
    const r = settleRoster(withRoster(rif({ morale: 90 })), 3, outcome);
    const f = r.party.roster[0]!;
    expect(f.owed).toBe(14);
    expect(f.loyalty).toBe(50 - OWED_LOYALTY);
    expect(f.morale).toBe(OWED_MORALE_CAP);
    expect(r.purse).toBe(3);
    expect(r.lines.length).toBe(1);
    const fed = settleRoster({ ...withRoster(rif({ morale: 90 })), provisions: 1 }, 3, outcome);
    expect(fed.lines).toEqual([]); // no grumble: fed hands keep quiet
    expect(fed.party.roster[0]!.owed).toBe(14); // ...but they are still owed
    // the debt is paid with the next purse, with this expedition's wage on top
    const back = settleRoster(r.party, 100, outcome);
    expect(back.party.roster[0]!.owed).toBe(0);
    expect(back.purse).toBe(100 - 28);
  });
  it("broken and unpaid deserts with an authored line; broken but paid stays; unpaid but steady stays", () => {
    const gone = settleRoster(withRoster(rif({ id: "hand-r1" })), 0, outcome, { morale: { "hand-r1": 12 } });
    expect(gone.party.roster).toEqual([]);
    expect(gone.lines.some((l) => FOLLOWER_DEFS.rifleman.desertions.some((d) => l === d.replace(/%n/g, rif().name)))).toBe(true);
    expect(settleRoster(withRoster(rif()), 100, outcome, { morale: { "hand-r1": 12 } }).party.roster).toHaveLength(1);
    expect(settleRoster(withRoster(rif()), 0, outcome, { morale: { "hand-r1": 80 } }).party.roster).toHaveLength(1);
  });
  it("loyalty running out deserts an unpaid hand", () => {
    const r = settleRoster(withRoster(por({ loyalty: 10, owed: 6 })), 0, outcome);
    expect(r.party.roster).toEqual([]);
  });
  it("the downed and not revived are wounded for two expeditions, sit out, draw half wages, then return", () => {
    const f = rif();
    let party = settleRoster(withRoster(f), 100, outcome, { down: [f.id] }).party;
    expect(party.roster[0]!.wounded).toBe(WOUNDED_EXPEDITIONS);
    expect(followerSpecs(party, SEED, { x: 0, z: 0 })).toEqual([]); // laid up: not in the field
    expect(wageDue(party.roster[0]!)).toBe(7);
    let s = settleRoster(party, 100, outcome);
    expect(s.purse).toBe(93);
    party = s.party;
    expect(party.roster[0]!.wounded).toBe(1);
    expect(followerSpecs(party, SEED, { x: 0, z: 0 })).toHaveLength(0);
    s = settleRoster(party, 100, outcome);
    party = s.party;
    expect(party.roster[0]!.wounded).toBe(0);
    expect(followerSpecs(party, SEED, { x: 0, z: 0 })).toHaveLength(1);
  });
  it("the dead stay dead and their wages die with them", () => {
    const a = rif({ id: "hand-r1", owed: 14 });
    const b = por();
    const r = settleRoster(withRoster(a, b), 50, outcome, { dead: [a.id] });
    expect(r.party.roster.map((f) => f.id)).toEqual([b.id]);
    expect(r.purse).toBe(44);
    expect(r.lines.some((l) => l.includes(a.name))).toBe(true);
  });
  it("morale rests (+15) from where the expedition left it, and is deterministic", () => {
    const f = rif();
    const a = settleRoster(withRoster(f), 100, outcome, { morale: { [f.id]: 40 } });
    expect(a.party.roster[0]!.morale).toBe(55);
    expect(settleRoster(withRoster(f), 100, outcome, { morale: { [f.id]: 40 } })).toEqual(a);
    expect(settleRoster(withRoster(f), 100, outcome, { morale: { [f.id]: 99 } }).party.roster[0]!.morale).toBe(100);
  });
  it("provisions and stock are spent by the expedition", () => {
    const r = settleRoster({ ...withRoster(rif()), provisions: 3, medical: 8 }, 100, outcome);
    expect(r.party.provisions).toBe(0);
    expect(r.party.medical).toBe(0);
  });
  it("hostile numbers in the purse never produce a negative or NaN", () => {
    for (const purse of [Number.NaN, -5, Infinity, 0.5]) {
      const r = settleRoster(withRoster(rif()), purse, outcome);
      expect(Number.isFinite(r.purse) || purse === Infinity).toBe(true);
      expect(r.purse).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("followerSpecs / nerve", () => {
  it("side party, brain follower, ring about the landing, within NPC rules", () => {
    const party = withRoster(...hirePool(SEED, 1), ...hirePool(SEED, 2).slice(0, 1));
    const specs = followerSpecs(party, SEED, { x: 5, z: 80 });
    expect(specs).toHaveLength(4);
    for (const s of specs) {
      expect(s).toMatchObject({ side: "party", group: "party", brain: "follower" });
      expect(Math.hypot(s.post.x - 5, s.post.z - 80)).toBeCloseTo(2.6, 5);
      expect(NPC_SIDE[s.role]).toBe("party");
    }
    expect(new Set(specs.map((s) => `${s.post.x.toFixed(2)},${s.post.z.toFixed(2)}`)).size).toBe(4);
    expect(followerSpecs(party, SEED, { x: 5, z: 80 })).toEqual(specs);
  });
  it("loyalty moves nerve by +-15; owed wages cap the starting morale", () => {
    expect(effectiveBravery({ bravery: 50, loyalty: 100 })).toBe(65);
    expect(effectiveBravery({ bravery: 50, loyalty: 0 })).toBe(35);
    expect(effectiveBravery({ bravery: 99, loyalty: 100 })).toBe(100);
    expect(startMorale({ morale: 90, owed: 0 })).toBe(90);
    expect(startMorale({ morale: 90, owed: 6 })).toBe(60);
  });
});
