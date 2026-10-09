import { describe, expect, it } from "vitest";
import type { ScenarioInput } from "../scenario.ts";
import { newCampaign } from "../factions.ts";
import { REQUESTS, REQUEST_IDS, dealRequest, quietOnly, requestLine } from "../mayhem.ts";
import { TEMPLATES, TEMPLATE_IDS } from "./registry.ts";
import { OUTCOME_KIND, TERMS, outcomeKind } from "./terms.ts";
import type { AnyTemplate, BaseState } from "./types.ts";

/** A run that has walked up to every site, with nothing else done. */
function arrived(def: AnyTemplate, seed = 11): BaseState {
  const c = { ...newCampaign(seed), purse: 200 };
  let s = def.init(c, 40, seed);
  const evs: ScenarioInput[] = [...def.observe.near.map((n) => ({ t: "near", at: n.id, party: 2 }) as ScenarioInput), { t: "arrive", party: 2 }];
  for (const e of evs) s = def.reduce(s, e).s;
  return s;
}
/** The same run after a shot at the first group the template counts as hostile (what the runner sends for a hit or a near miss). */
function shotAt(def: AnyTemplate, s: BaseState): BaseState {
  const group = def.observe.hostileGroups.find((g) => !g.startsWith("late:")) ?? def.observe.hostileGroups[0];
  let n = def.reduce(s, { t: "hostile", at: group }).s;
  for (let i = 0; i < 3; i++) n = def.reduce(n, { t: "tick", dt: 0.5 }).s;
  return n;
}

describe("D-086: the contracts' terms, held to the code", () => {
  it("every contract has its terms: ways to win and to lose, a fighting rule, short enough for the orders card", () => {
    for (const id of TEMPLATE_IDS) {
      const t = TERMS[id];
      expect(t.win.length, id).toBeGreaterThan(0);
      expect(t.lose.length, id).toBeGreaterThan(0);
      expect(t.rule.length, `${id} rule`).toBeGreaterThan(20);
      expect(t.rule.length, `${id} rule fits the card in two lines`).toBeLessThanOrEqual(125);
      for (const l of [...t.win, ...t.partial, ...t.lose]) expect(l.trim(), id).not.toBe("");
    }
  });

  it("'forbidden' means it: a shot (even a miss) at either side loses the contract at once; 'costly' and 'expected' contracts go on", () => {
    for (const id of TEMPLATE_IDS) {
      const def = TEMPLATES[id] as AnyTemplate;
      const after = shotAt(def, arrived(def));
      const res = after.resolution;
      if (TERMS[id].fighting === "forbidden") {
        expect(res, `${id}: a shot ends it`).toBeDefined();
        expect(OUTCOME_KIND[res!], `${id}: and it is a loss`).toBe("lost");
      } else {
        expect(res === undefined || OUTCOME_KIND[res] !== "lost", `${id}: a shot is not a loss by itself (${res})`).toBe(true);
      }
    }
  });

  it("the orders card carries the rule while it can still be broken, and drops it once the contract is over", () => {
    for (const id of TEMPLATE_IDS) {
      const def = TEMPLATES[id] as AnyTemplate;
      const s = arrived(def);
      expect(def.view(s, 0).rule, id).toBe(TERMS[id].rule);
      const over = def.reduce(s, { t: "party_down" }).s;
      expect(over.resolution, id).toBe("abandoned");
      expect(def.view(over, 0).rule, `${id}: no rule once it is over`).toBeUndefined();
    }
  });

  it("an ending's kind: every resolution has one, and the Crown sold for the party's cheque is a sale while the Crown sold for want of anyone settling it is a loss", () => {
    expect(outcomeKind({ resolution: "crown_sold", loot: 120 })).toBe("partial");
    expect(outcomeKind({ resolution: "crown_sold" })).toBe("lost");
    expect(outcomeKind({ resolution: "provoked" })).toBe("lost");
    expect(outcomeKind({ resolution: "mediated" })).toBe("won");
    expect(outcomeKind({ resolution: "protection_paid" })).toBe("partial");
  });
});

describe("D-086: the Society asks for nothing the contract forbids, or cannot give", () => {
  it("where fighting loses the contract (and at the mine) only the quiet commissions are dealt", () => {
    for (const id of TEMPLATE_IDS) {
      expect(quietOnly(id), id).toBe(TERMS[id].fighting === "forbidden" || id === "mine_rescue" || id === "triangulation");
      if (!quietOnly(id)) continue;
      for (let seed = 1; seed < 40; seed++) for (let day = 1; day < 8; day++) expect(REQUESTS[dealRequest(seed, day, id)].quiet, `${id} ${seed}/${day}`).toBe(true);
    }
    expect(quietOnly("border_incident")).toBe(true);
  });

  it("no chain of three where two kegs are in reach, and no flight with none", () => {
    for (let seed = 1; seed < 60; seed++) {
      for (let day = 1; day < 6; day++) {
        expect(dealRequest(seed, day, "convoy_ambush", undefined, 2), `${seed}/${day}`).not.toBe("chain");
        const none = dealRequest(seed, day, "outpost_raid", undefined, 0);
        expect(["chain", "flight"], `${seed}/${day}`).not.toContain(none);
      }
    }
    // with three in reach, the chain is in the pool
    const seen = new Set<string>();
    for (let seed = 1; seed < 200; seed++) seen.add(dealRequest(seed, 1, "hostage_rescue", undefined, 3));
    expect(seen.has("chain")).toBe(true);
  });

  it("the quiet commissions pay only for a contract won: a border lost to the party's own first shot was 'settled inside five minutes'", () => {
    const empty = { shots: 0, partyDowns: 0 } as Parameters<(typeof REQUESTS)["punctual"]["done"]>[0];
    expect(REQUESTS.punctual.done(empty, { resolution: "provoked", seconds: 10 })).toBe(false);
    expect(REQUESTS.punctual.done(empty, { resolution: "mediated", seconds: 200 })).toBe(true);
    expect(REQUESTS.temperance.done(empty, { resolution: "washed_out", seconds: 300 })).toBe(false);
    expect(REQUESTS.temperance.done(empty, { resolution: "lot_won", seconds: 300 })).toBe(true);
    expect(REQUESTS.insurers.done(empty, { resolution: "crown_sold", seconds: 300 })).toBe(false);
  });

  it("the card shows the money first, then who asks and what for, in the player's words", () => {
    for (const id of REQUEST_IDS) {
      const line = requestLine(id, "1 of 2");
      expect(line, id).toMatch(/^£\d+ bonus · /);
      expect(line.length, id).toBeLessThanOrEqual(80);
      expect(line, id).not.toMatch(/\bfell\b|an enemy|any make/);
    }
    expect(requestLine("temperance")).toBe("£25 bonus · Temperance & Quietude League: win without firing a shot");
  });
});
