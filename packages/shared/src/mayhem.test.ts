import { describe, expect, it } from "vitest";
import { newCampaign } from "./factions.ts";
import { LIMB } from "./limbs.ts";
import {
  FACT_RANK, FLING_YARDS, REQUESTS, REQUEST_IDS, SPECTACLE_CAP, billLine, billStory, compassPoint, dealRequest, flightYards, gazetteLine, newBill, parseBillRecord, spectacle,
  type MayhemFact,
} from "./mayhem.ts";
import { isRegionId, type CampaignState } from "./campaignTypes.ts";
import { TEMPLATE_IDS } from "./scenarios/registry.ts";

describe("D-084: how far a blast throws a body", () => {
  it("matches the clients' ragdoll launch, grows with power and lift, and a point-blank keg throws a man well past the column's threshold", () => {
    expect(flightYards(0, 0)).toBeLessThan(FLING_YARDS);
    expect(flightYards(0.4, 0.3)).toBeLessThan(FLING_YARDS); // (a stray blast is a stumble, not news)
    expect(flightYards(1, 1)).toBeGreaterThanOrEqual(15);
    expect(flightYards(1, 1)).toBeLessThan(25);
    let prev = -1;
    for (const l of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const y = flightYards(0.8, l);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(flightYards(NaN, Infinity)).toBe(flightYards(0, 0));
  });

  it("names the compass point a limb went (-z is north)", () => {
    expect(compassPoint(0, -1)).toBe("north");
    expect(compassPoint(1, 0)).toBe("east");
    expect(compassPoint(0, 1)).toBe("south");
    expect(compassPoint(-1, -1)).toBe("north-west");
  });
});

describe("D-084: the casualty column", () => {
  const facts: MayhemFact[] = [
    { k: "sever", victim: "Picket Corporal Dunstan Aldous", limb: LIMB.ARM_L, by: "Ada", cause: "blade", party: false, dir: "north" },
    { k: "sever", victim: "Scout Fitzwilliam Hale-Dunmarrow", limb: LIMB.LEG_R, by: "", cause: "blast", party: false, dir: "south-east" },
    { k: "sever", victim: "Ada", limb: LIMB.ARM_R, by: "", cause: "shot", party: true, dir: "west" },
    { k: "fling", victim: "Carter Obadiah Plume", yards: 14, by: "Ada", party: false },
    { k: "fling", victim: "Ada", yards: 9, by: "", party: true },
    { k: "headshot", victim: "Patroller Wilmot Brandish", by: "Ada" },
    { k: "chain", kegs: 4, by: "Ada" },
    { k: "chain", kegs: 2, by: "" },
    { k: "friendly", victim: "Bram", by: "Ada" },
    { k: "civilian", victim: "Carter Obadiah Plume", by: "Ada" },
    { k: "brolly", victim: "Picket Mabel Quenby", by: "Ada" },
    { k: "double", by: "Ada", n: 2 },
    { k: "finisher", victim: "Sentry Tamsin Cray", by: "Ada" },
    ...REQUEST_IDS.map((id): MayhemFact => ({ k: "request", id })),
  ];

  it("every fact prints a whole line: names in, no braces left, short enough for the column, and no pronoun guesses about who anybody is", () => {
    for (const f of facts) {
      for (let salt = 0; salt < 12; salt++) {
        const line = gazetteLine(f, salt);
        expect(line, JSON.stringify(f)).not.toMatch(/[{}]/);
        expect(line.length).toBeLessThanOrEqual(160);
        expect(line).not.toMatch(/\b(he|she|his|her|him|hers)\b/i);
        if ("victim" in f) expect(line).toContain(f.victim);
      }
    }
  });

  it("counts are set in words (a line never opens with a figure)", () => {
    for (let salt = 0; salt < 12; salt++) {
      const line = gazetteLine({ k: "chain", kegs: 5, by: "Ada" }, salt);
      expect(line).toMatch(/\b[Ff]ive kegs\b/);
      expect(line).not.toMatch(/^\d/);
    }
    expect(gazetteLine({ k: "chain", kegs: 14, by: "" }, 1)).toMatch(/14 kegs/);
  });

  it("the phrasing varies by moment, and is the same for the same moment", () => {
    const f = facts[0]!;
    expect(new Set(Array.from({ length: 40 }, (_, i) => gazetteLine(f, i))).size).toBeGreaterThan(1);
    expect(gazetteLine(f, 7)).toBe(gazetteLine(f, 7));
  });

  it("a commission met outranks everything; a chain outranks a single limb; a bystander is the least of it", () => {
    expect(FACT_RANK.request).toBeGreaterThan(FACT_RANK.chain);
    expect(FACT_RANK.chain).toBeGreaterThan(FACT_RANK.sever);
    expect(FACT_RANK.civilian).toBe(Math.min(...Object.values(FACT_RANK)));
  });
});

describe("D-084: the Society's requests", () => {
  it("a run is dealt one deterministically, never the last one twice, and the talk-only contracts get only the quiet ones", () => {
    for (const t of TEMPLATE_IDS) {
      const a = dealRequest(7, 3, t);
      expect(dealRequest(7, 3, t)).toBe(a);
      expect(dealRequest(7, 3, t, a)).not.toBe(a);
      if (t === "mine_rescue" || t === "flooded_market") for (let d = 0; d < 30; d++) expect(REQUESTS[dealRequest(11, d, t)].quiet).toBe(true);
    }
    const seen = new Set<string>();
    for (let d = 0; d < 80; d++) seen.add(dealRequest(5, d, "secure_crossing"));
    expect(seen.size).toBeGreaterThanOrEqual(6); // (the whole menu comes round)
  });

  it("each is met by what it asks for and not before; the quiet ones only at a real ending", () => {
    const b = newBill();
    expect(REQUESTS.flight.done(b)).toBe(false);
    b.longest = 12;
    expect(REQUESTS.flight.done(b)).toBe(true);
    b.chain = 3;
    expect(REQUESTS.chain.done(b)).toBe(true);
    b.limbs = 2;
    expect(REQUESTS.limbs.done(b)).toBe(true);
    expect(REQUESTS.fencing.done(b)).toBe(false);
    b.bladeLimbs = 1;
    expect(REQUESTS.fencing.done(b)).toBe(true);
    const q = newBill();
    expect(REQUESTS.temperance.done(q)).toBe(false); // (not over yet)
    expect(REQUESTS.temperance.done(q, { resolution: "paid", seconds: 200 })).toBe(true);
    expect(REQUESTS.temperance.done(q, { resolution: "abandoned", seconds: 200 })).toBe(false);
    q.shots = 1;
    expect(REQUESTS.temperance.done(q, { resolution: "paid", seconds: 200 })).toBe(false);
    expect(REQUESTS.punctual.done(q, { resolution: "paid", seconds: 301 })).toBe(false);
    expect(REQUESTS.punctual.done(q, { resolution: "paid", seconds: 300 })).toBe(true);
    for (const id of REQUEST_IDS) expect(REQUESTS[id].reward).toBeGreaterThan(0);
  });
});

describe("D-105: the coup de grace in the bill", () => {
  it("is billed, paid for as spectacle (two pounds each, under the cap), and a record saved before it existed reads as none", () => {
    const b = { ...newBill(), finishers: 2 };
    expect(spectacle(b).pay).toBe(4);
    expect(billLine(b)).toContain("2 coups de grâce");
    expect(billLine({ ...newBill(), finishers: 1 })).toContain("1 coup de grâce");
    const old = parseBillRecord({ day: 3, region: "kessar", request: "flight", met: false, spectacle: 0, bill: { foes: 2, limbs: 1 } }, isRegionId)!;
    expect(old.bill.finishers).toBe(0);
    expect(FACT_RANK.finisher).toBeGreaterThan(FACT_RANK.headshot);
  });
});

describe("D-084: the bill, the supplement and the paper", () => {
  it("the Committee pays for spectacle, capped; a dull run is paid nothing and says nothing", () => {
    expect(spectacle(newBill())).toEqual({ pay: 0, line: "" });
    const b = { ...newBill(), limbs: 2, flings: 1, chain: 3, headshots: 1 };
    expect(spectacle(b).pay).toBe(6 + 2 + 6 + 1);
    expect(spectacle({ ...b, limbs: 40 }).pay).toBe(SPECTACLE_CAP);
  });

  it("the bill prints only what happened, with the longest flight and whose", () => {
    expect(billLine(newBill())).toBe("");
    const line = billLine({ ...newBill(), limbs: 1, flings: 2, longest: 14, longestWho: "Carter Obadiah Plume", kegs: 3, chain: 3 });
    expect(line).toContain("1 limb");
    expect(line).toContain("the longest 14 yards, Carter Obadiah Plume");
    expect(line).toContain("a chain of 3");
    expect(line).not.toContain("bystander");
  });

  const withBill = (over: Partial<CampaignState["sites"]["lastBill"]> = {}): CampaignState => {
    const c = newCampaign(1);
    const day = 4;
    return {
      ...c, day,
      history: [{ seq: 1, region: "kessar", resolution: "forced", day, template: "secure_crossing" }],
      sites: { ...c.sites, lastBill: { day, region: "kessar", bill: { ...newBill(), limbs: 3, flings: 1, longest: 13, longestWho: "Plume" }, request: "limbs", met: true, spectacle: 11, ...over } },
    };
  };

  it("the paper prints the spectacle of the expedition it reports, with the learned body's thanks, and nothing for an old record", () => {
    const s = billStory(withBill());
    expect(s?.head).toBe("BRITANNIA TRIUMPHANT: SOCIETY MEN IN SPIRITED ENGAGEMENT");
    expect(s?.body).toContain("3 limbs");
    expect(s?.body).toContain("Museum of Comparative Anatomy");
    expect(billStory(withBill({ day: 2 }))).toBeUndefined();
    expect(billStory(withBill({ bill: newBill(), met: false }))).toBeUndefined();
  });

  it("a saved record survives a round trip; junk in a save is dropped or clamped, never thrown", () => {
    const r = withBill().sites.lastBill!;
    expect(parseBillRecord(JSON.parse(JSON.stringify(r)), isRegionId)).toEqual(r);
    expect(parseBillRecord({ ...r, request: "not a request" }, isRegionId)).toBeUndefined();
    expect(parseBillRecord({ ...r, region: "atlantis" }, isRegionId)).toBeUndefined();
    expect(parseBillRecord(null, isRegionId)).toBeUndefined();
    const odd = parseBillRecord({ ...r, spectacle: 1e9, bill: { limbs: -4, longest: "far", longestWho: "x".repeat(99) } }, isRegionId)!;
    expect(odd.spectacle).toBe(SPECTACLE_CAP);
    expect(odd.bill.limbs).toBe(0);
    expect(odd.bill.longest).toBe(0);
    expect(odd.bill.longestWho.length).toBe(40);
  });
});
