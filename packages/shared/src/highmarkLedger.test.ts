import { describe, expect, it } from "vitest";
import { liveRegions } from "./regionStatus.ts";
import { type CampaignState, type CasualtyTally, type RegionId, type ResolutionId, type ScenarioOutcome } from "./campaignTypes.ts";
import { POWERS, RESOLUTIONS, TEMPLATE_RESOLUTIONS, applyOutcome, consequenceLines, newCampaign, parseCampaign, serializeCampaign, wardMemory } from "./factions.ts";
import { HIGHMARK_ANCHORS, HIGHMARK_RESOLUTIONS, HIGHMARK_STATUS } from "./highmark.ts";
import { MEMORY_LINE } from "./negotiationText.ts";
import { generatePaper } from "./newspaper.ts";
import { HEADLINES, STANDFIRSTS } from "./newspaperText.ts";
import { HISTORY_PIECE } from "./outpostText.ts";
import { eventItem, newPowers, parsePowers, powersAfterOutcome, powersDispatches, serializePowers } from "./powers.ts";
import { RELATION_FX } from "./relations.ts";
import { GRUDGE_FX } from "./rival.ts";
import { REGIONS, isReachableRegion, reachableRegions, regionLanding, stationsFor } from "./regions.ts";
import { campaignMapOf } from "./mapData.ts";
import { mapPins } from "./powers.ts";
import { newSettlements } from "./settlement.ts";
import { REGION_TEMPLATES, pickTemplate, templateNote } from "./scenarios/registry.ts";
import { travelArrived, travelIdle, travelPropose, travelReady, travelTick, type TravelState } from "./travel.ts";
import type { PowersState } from "./worldTypes.ts";
import { POWERS_JSON_MAX, SETTLEMENTS_JSON_MAX } from "./worldTypes.ts";

const tally = (t: Partial<CasualtyTally> = {}): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0, ...t });
const out = (resolution: ResolutionId, o: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  scenario: "succession_dispute", resolution, toll: 0, paid: 0, bridge: "intact", tally: tally(), brokePromise: false, seconds: 400, region: "highmark", ...o,
});
/** What each ending would realistically hand the ledger (distinct outcomes: money, loot, blood). */
const OUTCOMES: Record<(typeof HIGHMARK_RESOLUTIONS)[number], ScenarioOutcome> = {
  backed_elder: out("backed_elder", { paid: 70 }),
  backed_younger: out("backed_younger", { paid: 45 }),
  regency: out("regency", { paid: 25 }),
  usurped: out("usurped", { tally: tally({ wounded: 3, downed: 3, garrisonKilled: 3 }), brokePromise: true }),
  crown_sold: out("crown_sold", { loot: 100 }),
};

const leaves = (v: unknown, path = "", acc = new Map<string, string>()): Map<string, string> => {
  if (Array.isArray(v)) {
    acc.set(`${path}#len`, String(v.length));
    v.forEach((x, i) => leaves(x, `${path}[${i}]`, acc));
  } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, acc);
  else acc.set(path, JSON.stringify(v));
  return acc;
};
const apart = (a: unknown, b: unknown): number => {
  const A = leaves(a), B = leaves(b);
  let n = 0;
  for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) n++;
  return n;
};

const before = newCampaign(11);
const pw0 = newPowers(11);
const after = (r: ResolutionId): CampaignState => applyOutcome(before, OUTCOMES[r as keyof typeof OUTCOMES]);
const powers = (r: ResolutionId): PowersState => powersAfterOutcome(before, after(r), pw0, OUTCOMES[r as keyof typeof OUTCOMES]);

describe("Highmark's ledger: the five endings", () => {
  it("every table is exhaustive, and the template's resolutions are the five plus abandoned", () => {
    for (const r of HIGHMARK_RESOLUTIONS) {
      expect(RESOLUTIONS).toContain(r);
      expect(RELATION_FX[r], r).toBeDefined();
      expect(Object.keys(RELATION_FX[r]).length, `${r} moves the map of grudges`).toBeGreaterThanOrEqual(3);
      expect(typeof GRUDGE_FX[r]).toBe("number");
      expect(HISTORY_PIECE[r].label.length).toBeGreaterThan(30);
      expect(MEMORY_LINE[r].length).toBeGreaterThanOrEqual(2);
      expect(HEADLINES[r].length).toBeGreaterThanOrEqual(3);
      expect(STANDFIRSTS[r].length).toBeGreaterThanOrEqual(3);
    }
    expect([...TEMPLATE_RESOLUTIONS.succession_dispute].sort()).toEqual([...HIGHMARK_RESOLUTIONS, "abandoned"].sort());
  });

  it("the five endings give distinct campaign JSON and distinct powers JSON, at least three fields apart", () => {
    const rs = HIGHMARK_RESOLUTIONS;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        expect(apart(after(rs[i]!), after(rs[j]!)), `campaign ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
        expect(apart(JSON.parse(serializePowers(powers(rs[i]!))), JSON.parse(serializePowers(powers(rs[j]!)))), `powers ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
      }
    }
    // and with the same outcome numbers the endings still differ by their own rules (the ledger, the relations, the Reapers)
    const same = (r: (typeof HIGHMARK_RESOLUTIONS)[number]): ScenarioOutcome => out(r, { paid: 30 });
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = powersAfterOutcome(before, applyOutcome(before, same(rs[i]!)), pw0, same(rs[i]!)), b = powersAfterOutcome(before, applyOutcome(before, same(rs[j]!)), pw0, same(rs[j]!));
      expect(apart(JSON.parse(serializePowers(a)), JSON.parse(serializePowers(b))), `powers (equal outcomes) ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("sites.succession and history[].region are right, and Kessar's crossing, toll and bridge are left alone", () => {
    const want = { backed_elder: "elder", backed_younger: "younger", regency: "regency", usurped: "usurped", crown_sold: "sold" } as const;
    for (const r of HIGHMARK_RESOLUTIONS) {
      const a = after(r);
      expect(a.sites.succession, r).toBe(want[r]);
      expect(a.history[a.history.length - 1], r).toMatchObject({ region: "highmark", resolution: r, template: "succession_dispute" });
      expect(a.crossing, r).toEqual(before.crossing);
      expect(a.factions.ward.need, "the Ward's need is not Highmark's business").toBe(before.factions.ward.need);
      expect(a.sites.hostage).toBe(before.sites.hostage);
      expect(a.sites.lastDay.succession_dispute).toBe(before.day + 1);
      expect(parseCampaign(serializeCampaign(a))).toEqual(a);
    }
    // a Kessar outcome still files itself under Kessar, and leaves the succession "open"
    const k = applyOutcome(before, { ...out("paid", { paid: 30 }), scenario: "secure_crossing", region: undefined });
    expect(k.history[k.history.length - 1]!.region).toBe("kessar");
    expect(k.sites.succession).toBe("open");
  });

  it("the Lamp-Warden's garrison, trust and crowd are not what a court's dead cost her; the Syndicate's own are", () => {
    const bloody = applyOutcome(before, OUTCOMES.usurped);
    expect(bloody.factions.ward.militaryStrength).toBe(before.factions.ward.militaryStrength);
    expect(bloody.factions.ward.trust).toBe(before.factions.ward.trust);
    expect(bloody.factions.ward.fear).toBe(Math.max(0, before.factions.ward.fear - 2));
    expect(bloody.tally.garrisonKilled, "the ledger still counts them").toBe(3);
    const envoy = applyOutcome(before, out("usurped", { tally: tally({ rivalKilled: 1 }) }));
    expect(envoy.factions.rival.militaryStrength).toBeLessThan(before.factions.rival.militaryStrength);
    // the same blood at Kessar still costs the Ward her garrison (unchanged)
    const kessar = applyOutcome(before, { ...out("forced"), scenario: "secure_crossing", region: undefined, tally: tally({ garrisonKilled: 3 }) });
    expect(kessar.factions.ward.militaryStrength).toBeLessThan(before.factions.ward.militaryStrength);
    // a broken promise at court is still a lie on the books
    expect(bloody.lies).toBe(before.lies + 1);
    // the Ward remembers, in her memory only, and distinctly
    const mem = new Set(HIGHMARK_RESOLUTIONS.map((r) => JSON.stringify([wardMemory(after(r)).gratitude, wardMemory(after(r)).resentment, wardMemory(after(r)).contempt])));
    expect(mem.size).toBe(5);
  });

  it("the Reapers move for every ending (the home power), the pairs carry the story, no two endings read alike, and the saved powers stay inside their caps", () => {
    for (const r of HIGHMARK_RESOLUTIONS) {
      const p = powers(r);
      const b = applyOutcomeDrift(pw0);
      expect(apart(p.minor.reapers, b.minor.reapers), `${r} moves the Reapers`).toBeGreaterThanOrEqual(2);
      expect(serializePowers(p).length).toBeLessThan(POWERS_JSON_MAX);
      expect(parsePowers(serializePowers(p))).toEqual(p);
      expect(p.log[p.log.length - 1]).toMatchObject({ kind: `chair_${r}`, a: "reapers" });
      expect(JSON.stringify(newSettlements()).length).toBeLessThan(SETTLEMENTS_JSON_MAX);
    }
    for (let i = 0; i < HIGHMARK_RESOLUTIONS.length; i++) for (let j = i + 1; j < HIGHMARK_RESOLUTIONS.length; j++) {
      const a = RELATION_FX[HIGHMARK_RESOLUTIONS[i]!], b = RELATION_FX[HIGHMARK_RESOLUTIONS[j]!];
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof typeof a>;
      let d = 0;
      for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) d++;
      expect(d, `${HIGHMARK_RESOLUTIONS[i]} vs ${HIGHMARK_RESOLUTIONS[j]}`).toBeGreaterThanOrEqual(2);
    }
    for (const r of HIGHMARK_RESOLUTIONS) {
      const keys = Object.keys(RELATION_FX[r]);
      expect(keys.some((k) => k === "reapers|choir"), `${r} touches the Reapers and the Guild (the death certificate)`).toBe(true);
      expect(keys.some((k) => k === "brine|reapers" || k === "rival|brine"), `${r} touches the Houses' side of it`).toBe(true);
    }
  });

  it("the paper prints a dispatch for each ending, and the five headlines and standfirsts are distinct", () => {
    const heads = new Set<string>();
    const dispatches = new Set<string>();
    for (const r of HIGHMARK_RESOLUTIONS) {
      const c = after(r);
      const p = powers(r);
      const items = powersDispatches(p, 9);
      const chair = items.find((i) => i.slug.startsWith("chair-"));
      expect(chair, `${r} dispatch`).toBeDefined();
      expect(chair!.slug).toBe(`chair-${r.replace(/_/g, "-")}`);
      expect(chair!.head.length).toBeGreaterThan(10);
      expect(chair!.body).not.toMatch(/[{}]|undefined/);
      dispatches.add(chair!.head);
      const paper = generatePaper(c, 9, { dispatches: items });
      expect(paper.stories.some((s) => s.slug === chair!.slug)).toBe(true);
      expect(paper.stories.find((s) => s.slug === "ledger")!.head).toMatch(/Chair|Highmark|Throne/);
      for (let seed = 0; seed < 60; seed++) heads.add(generatePaper(c, seed).headline);
      expect(new Set(Array.from({ length: 80 }, (_, s) => generatePaper(c, s).headline)).size, r).toBeGreaterThanOrEqual(3);
      expect(paper.headline).not.toMatch(/[{}]/);
      expect(eventItem({ day: 3, kind: `chair_${r}`, a: "reapers", b: "choir", n: 0 }, 1)).toBeDefined();
    }
    expect(dispatches.size).toBeGreaterThanOrEqual(3);
    expect(heads.size).toBeGreaterThanOrEqual(15);
    // the debrief card says what the chair did
    for (const r of HIGHMARK_RESOLUTIONS) expect(consequenceLines(before, after(r)).join(" ")).toMatch(/Highmark/);
  });

  it("a campaign saved before D-036 (no `succession` in the site ledger, no Highmark history) loads and plays on", () => {
    const old = JSON.parse(serializeCampaign(newCampaign(3))) as { sites: Record<string, unknown> };
    delete old.sites.succession;
    const c = parseCampaign(JSON.stringify(old))!;
    expect(c.sites.succession).toBe("open");
    const again = applyOutcome(c, OUTCOMES.regency);
    expect(again.sites.succession).toBe("regency");
    // and a state that claims an unknown ending is read as open
    const bad = JSON.parse(serializeCampaign(newCampaign(3))) as { sites: Record<string, unknown> };
    bad.sites.succession = "usurped\u0000";
    expect(parseCampaign(JSON.stringify(bad))!.sites.succession).toBe("open");
  });

  it("the Reapers are the Highmark power; every other minor keeps its home away", () => {
    expect(POWERS.filter((p) => p.region === "highmark").map((p) => p.id)).toEqual(["reapers"]);
  });
});

// D-037: the chart, the lanes and the sailing cover the regions that can be reached (a stubbed region is not on the chart yet)
const REACH = reachableRegions();
const applyOutcomeDrift = (p: PowersState): PowersState => powersAfterOutcome(before, before, p, out("abandoned", { scenario: "secure_crossing", region: undefined }));

describe("Highmark on the chart: every live region, a lane from each, every ordered pair sails", () => {
  it("is reachable, the stub flag is off, and the two flipped together", () => {
    expect(HIGHMARK_STATUS.stub).toBe(false);
    expect(REGIONS.highmark.reachable).toBe(true);
    expect(isReachableRegion("highmark")).toBe(true);
    expect(reachableRegions().slice(0, 3)).toEqual(["hollowmere", "kessar", "highmark"]);
    expect(reachableRegions()).toEqual(liveRegions());   // D-037: a region is reachable exactly when its content is live
    expect(regionLanding("highmark")).toEqual(HIGHMARK_ANCHORS.landing);
    expect(stationsFor("highmark").some((s) => s.kind === "dock")).toBe(true);
  });

  it("a mark per live region and a lane from each to all the others, with the launch halving them", () => {
    const c = newCampaign(2), p = newPowers(2), s = newSettlements();
    const pins = mapPins(c, p, []);
    for (const here of REACH) {
      const m = campaignMapOf(c, s, undefined, pins, undefined, s.tech, here);
      expect(m.regions.map((r) => r.id)).toEqual([...REACH]);
      expect(m.regions.filter((r) => r.here).map((r) => r.id)).toEqual([here]);
      expect(m.lanes.map((l) => l.to).sort()).toEqual(REACH.filter((r) => r !== here).sort());
      for (const l of m.lanes) expect(l.seconds).toBe(REGIONS[l.to].sailSeconds);
      const fast = campaignMapOf(c, s, undefined, pins, undefined, { ...s.tech, launch: true }, here);
      for (const l of fast.lanes) expect(l.seconds).toBeLessThan(REGIONS[l.to].sailSeconds);
    }
    // the contract on offer at each region comes from its own template list
    const offers: Partial<Record<RegionId, { title: string; brief: string }>> = {};
    for (const id of REACH) {
      const t = pickTemplate(c, id, 5);
      if (t) offers[id] = templateNote(t);
    }
    expect(Object.keys(offers).sort()).toEqual(["highmark", "kessar", "saltmarket", "vesper"]);
    expect(offers.highmark!.title).toBe("The Vacant Chair");
    const m = campaignMapOf(c, s, undefined, pins, offers, s.tech, "hollowmere");
    expect(m.regions.map((r) => r.offered?.title)).toEqual([undefined, "Secure the River Crossing", "The Vacant Chair", offers.vesper!.title, offers.saltmarket!.title]);
    expect(REGION_TEMPLATES.highmark).toEqual(["succession_dispute", "reapers_strike", "great_grey"]);   // D-042: the chair is still the first visit's offer; D-094: the hunt the third
  });

  it("every ordered pair of regions sails in the travel machine: propose, vote, sail, arrive", () => {
    let pairs = 0;
    for (const from of REACH) for (const to of REACH) {
      let st = travelPropose(travelIdle(from), from, to, 0, 0b11);
      if (from === to) {
        expect(st.s.phase, `${from} -> ${to}`).toBe(0);
        continue;
      }
      pairs++;
      expect(st.s.phase).toBe(1);
      st = travelReady(st.s, 1, true, 0b11);
      expect(st.s).toMatchObject({ phase: 2, to });
      st = travelTick(st.s, REGIONS[to].sailSeconds + 0.1, 0b11);
      expect(st.fx).toBe("enter_region");
      const s3: TravelState = st.s;
      expect(travelArrived(s3, 0, to, 0b11).s.phase).toBe(3);
      st = travelArrived(travelArrived(s3, 0, to, 0b11).s, 1, to, 0b11);
      expect(st).toMatchObject({ fx: "done", s: { phase: 0 } });
    }
    expect(pairs).toBe(REACH.length * (REACH.length - 1));
    // a forged or unknown destination is still ignored
    for (const bad of ["Highmark", "HIGHMARK", "highmark ", { to: "highmark" }, null, undefined, 3, ["highmark"], "__proto__"]) expect(travelPropose(travelIdle(), "hollowmere", bad, 0, 1).s.phase).toBe(0);
  });
});
