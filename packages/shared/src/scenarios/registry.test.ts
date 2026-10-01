import { describe, expect, it } from "vitest";
import type { CampaignState, ResolutionId, ScenarioTemplateId } from "../campaignTypes.ts";
import { COMPLICATION_HINT, COMPLICATION_POOL, dealComplication } from "../chaos.ts";
import { newCampaign } from "../factions.ts";
import { TEMPLATES, TEMPLATE_IDS, isTemplateId, pickTemplate, templateNote } from "./registry.ts";

const withHistory = (list: [ScenarioTemplateId, ResolutionId, number][], patch?: (c: CampaignState) => void): CampaignState => {
  const c = newCampaign(5);
  c.history = list.map(([template, resolution, day], i) => ({ seq: i + 1, region: "kessar", resolution, day, template }));
  c.day = (list.length ? list[list.length - 1]![2] : 1);
  c.expeditions = list.length;
  patch?.(c);
  return c;
};
const offers = (c: CampaignState, n = 300): Map<ScenarioTemplateId, number> => {
  const m = new Map<ScenarioTemplateId, number>();
  for (let seed = 0; seed < n; seed++) {
    const t = pickTemplate(c, "kessar", seed)!;
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
};

describe("pickTemplate", () => {
  it("the first visit is the crossing; Hollowmere offers nothing", () => {
    for (let seed = 0; seed < 20; seed++) expect(pickTemplate(newCampaign(seed), "kessar", seed)).toBe("secure_crossing");
    expect(pickTemplate(withHistory([["secure_crossing", "abandoned", 2]]), "hollowmere", 1)).toBeUndefined();
  });

  it("is deterministic: the same ledger and seed always offer the same contract", () => {
    const c = withHistory([["secure_crossing", "forced", 2]]);
    for (let seed = 0; seed < 50; seed++) expect(pickTemplate(c, "kessar", seed)).toBe(pickTemplate(structuredClone(c), "kessar", seed));
  });

  it("a settled crossing is not offered for SETTLED_DAYS days, then it returns; sabotage and a rival buy do not settle", () => {
    for (const r of ["paid", "bargained", "bribed", "forced"] as const) {
      expect(offers(withHistory([["secure_crossing", r, 2]])).has("secure_crossing"), r).toBe(false);
      // two days of other business later it is still on the books (day 4: 2 days since); at day 5 it lapses
      expect(offers(withHistory([["secure_crossing", r, 2], ["border_incident", "mediated", 3], ["convoy_ambush", "passed", 4]])).has("secure_crossing"), `${r} +2`).toBe(false);
      expect(offers(withHistory([["secure_crossing", r, 2], ["border_incident", "mediated", 3], ["convoy_ambush", "passed", 4], ["hostage_rescue", "rescued", 5]]), 400).has("secure_crossing"), `${r} +3`).toBe(true);
    }
    for (const r of ["sabotaged", "rival_secured", "abandoned"] as const) {
      const c = withHistory([["secure_crossing", r, 2], ["border_incident", "mediated", 3]], (x) => { if (r === "sabotaged") x.crossing.bridge = "collapsed"; });
      expect(offers(c).has("secure_crossing"), r).toBe(r !== "sabotaged");
    }
  });

  it("never the same contract twice running when another is eligible", () => {
    for (const t of ["hostage_rescue", "convoy_ambush", "border_incident"] as const) {
      const c = withHistory([["secure_crossing", "abandoned", 2], [t, "abandoned", 3]], (x) => { x.factions.ward.rivalInfluence = 90; x.factions.ward.militaryStrength = 90; });
      expect(offers(c).has(t), t).toBe(false);
    }
    // the crossing, abandoned, comes back as a different contract's alternative but never straight away
    expect(offers(withHistory([["secure_crossing", "abandoned", 2]])).has("secure_crossing")).toBe(false);
  });

  it("the ledger weights the offer: a broken garrison and desertion breed hostages, a strong Syndicate runs wagons, two strong powers make a border", () => {
    const base = withHistory([["secure_crossing", "abandoned", 2]], (x) => { x.factions.ward.rivalInfluence = 10; x.factions.ward.militaryStrength = 70; });
    const share = (c: CampaignState, id: ScenarioTemplateId): number => (offers(c, 600).get(id) ?? 0) / 600;
    const weak = withHistory([["secure_crossing", "forced", 2]], (x) => { x.factions.ward.rivalInfluence = 10; x.factions.ward.militaryStrength = 30; });
    expect(share(weak, "hostage_rescue")).toBeGreaterThan(share(base, "hostage_rescue"));
    expect(share(weak, "hostage_rescue")).toBeGreaterThan(0.5);
    const rich = withHistory([["secure_crossing", "rival_secured", 2]], (x) => { x.factions.ward.rivalInfluence = 70; x.factions.ward.militaryStrength = 40; });
    expect(share(rich, "convoy_ambush")).toBeGreaterThan(0.5);
    const strong = withHistory([["secure_crossing", "abandoned", 2]], (x) => { x.factions.ward.rivalInfluence = 40; x.factions.ward.militaryStrength = 70; });
    expect(share(strong, "border_incident")).toBeGreaterThan(share(base, "border_incident"));
    expect(share(strong, "border_incident")).toBeGreaterThan(0.4);
  });

  it("always offers something at Kessar, over 2000 random ledgers; every template is reachable", () => {
    const seen = new Set<ScenarioTemplateId>();
    for (let i = 0; i < 2000; i++) {
      const rs: ResolutionId[] = ["paid", "forced", "abandoned", "rival_secured", "sabotaged", "seized", "mediated", "provoked"];
      const hist: [ScenarioTemplateId, ResolutionId, number][] = Array.from({ length: i % 6 }, (_, k) => [TEMPLATE_IDS[(i + k) % 4]!, rs[(i * 3 + k) % rs.length]!, 2 + k]);
      const c = withHistory(hist, (x) => { x.factions.ward.rivalInfluence = (i * 7) % 101; x.factions.ward.militaryStrength = (i * 13) % 101; if (i % 11 === 0) x.crossing.bridge = "collapsed"; });
      const t = pickTemplate(c, "kessar", i);
      expect(t, `ledger ${i}`).toBeDefined();
      expect(isTemplateId(t)).toBe(true);
      seen.add(t!);
    }
    expect(seen.size).toBe(4);
  });

  it("the map room note is the offered contract's title and brief", () => {
    for (const id of TEMPLATE_IDS) {
      const n = templateNote(id);
      expect(n.title).toBe(TEMPLATES[id].title);
      expect(n.brief).toBe(TEMPLATES[id].brief);
    }
  });
});

describe("dealComplication", () => {
  it("is deterministic from the ledger and the seed", () => {
    for (const id of TEMPLATE_IDS) for (let seed = 0; seed < 40; seed++) {
      const c = newCampaign(seed);
      expect(dealComplication(c, id, seed)).toBe(dealComplication(structuredClone(c), id, seed));
    }
  });

  it("deals only from the template's pool; 'rival_*' only when the Syndicate is worth the name; 'rain' only from pools that have it", () => {
    for (const id of TEMPLATE_IDS) {
      for (let seed = 0; seed < 300; seed++) {
        const c = newCampaign(seed);
        c.factions.ward.rivalInfluence = seed % 2 === 0 ? 5 : 80;
        const d = dealComplication(c, id, seed);
        expect(["none", ...COMPLICATION_POOL[id]], `${id} ${d}`).toContain(d);
        if (c.factions.ward.rivalInfluence < 30 && id !== "secure_crossing") expect(["rival_scouts", "rival_bid"]).not.toContain(d);
      }
    }
  });

  it("cooldown: the complication dealt last time is never dealt twice running", () => {
    for (const id of ["hostage_rescue", "convoy_ambush", "border_incident"] as const) {
      const dealt = new Set<string>();
      for (let seed = 0; seed < 400; seed++) {
        for (const last of COMPLICATION_POOL[id]) {
          const c = newCampaign(seed);
          c.factions.ward.rivalInfluence = 80;
          c.sites.lastComplication = last;
          const d = dealComplication(c, id, seed);
          expect(d, `${id} after ${last}`).not.toBe(last);
          dealt.add(d);
        }
      }
      // every entry of the pool shows up, and so does the quiet run
      for (const x of COMPLICATION_POOL[id]) expect(dealt.has(x), `${id} ${x}`).toBe(true);
      expect(dealt.has("none")).toBe(true);
    }
  });

  it("roughly a third of runs are quiet, and every complication has a hint sentence", () => {
    let quiet = 0;
    for (let seed = 0; seed < 600; seed++) if (dealComplication(newCampaign(seed), "convoy_ambush", seed) === "none") quiet++;
    expect(quiet / 600).toBeGreaterThan(0.2);
    expect(quiet / 600).toBeLessThan(0.5);
    for (const [k, v] of Object.entries(COMPLICATION_HINT)) expect(k === "none" ? v === "" : v.length > 20, k).toBe(true);
  });

  it("the crossing's complication is the slice-1 rule, unchanged", () => {
    const c = newCampaign(12);
    const run = (rival: number): string[] => Array.from({ length: 80 }, (_, i) => { const x = { ...newCampaign(i), day: 1 + (i % 9) }; x.factions.ward.rivalInfluence = rival; return TEMPLATES.secure_crossing.init(x, 40, i).phase === "approach" ? dealComplication(x, "secure_crossing", i) : ""; });
    expect(run(50).every((d) => d === "rival_scouts")).toBe(true);
    expect(run(10).some((d) => d === "none")).toBe(true);
    void c;
  });
});
