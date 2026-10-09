import { describe, expect, it } from "vitest";
import { newCampaign } from "./factions.ts";
import { newPowers } from "./powers.ts";
import { PropKind } from "./props.ts";
import {
  INDUSTRY, SUPPLY_DECAY, deliverTo, evolveSettlements, newSettlements, newTech, parseSettlements, regionDressOf, serializeSettlements, settlementDispatches,
  settlementNews, techEffects, techOf, worksDay,
} from "./settlement.ts";
import type { CampaignState } from "./campaignTypes.ts";
import type { OutpostState, RegionClimate, SettlementsState } from "./worldTypes.ts";

/**
 * D-091, the industrial age: three more latched technologies, earned from the campaign's later state with no menu. The railway reaches a Kessar town that has its road
 * and its wire; the armourers of a garrisoned post rifle the Society's barrels; an extraction post opens a works that pays and pollutes.
 */

const GOOD: RegionClimate = { security: 80, trade: 80, hostility: 10, rivalPressure: 10, labour: 70 };
const c0 = (day: number): CampaignState => ({ ...newCampaign(5), day });

/** A founded post in `region`, set to `stage` since `since`, with the given priority and figures. */
function postAt(region: "kessar" | "highmark", stage: OutpostState["stage"], since: number, extra: Partial<OutpostState> = {}): SettlementsState {
  let s = newSettlements();
  for (let i = 0; i < 4; i++) s = deliverTo(s, region, PropKind.CRATE, c0(1), 5).s;
  return { ...s, posts: { [region]: { ...s.posts[region]!, stage, stageSince: since, supply: 80, trade: 80, security: 80, ...extra } } };
}

describe("D-091: the industrial age", () => {
  it("the railway reaches a Kessar town with its road and its wire, after three days a town, and never before", () => {
    const town = postAt("kessar", "town", 10);
    const wired = { ...town, tech: { ...town.tech, road: 2 as const, telegraph: true } };
    expect(techOf(wired, c0(12), GOOD).railway).toBe(false); // (two days a town)
    expect(techOf(wired, c0(13), GOOD).railway).toBe(true);
    expect(techOf(wired, c0(13), GOOD).since.railway).toBe(13);
    // no wire (the Syndicate holds the crossing, so none can be strung) or no second road (trade too thin to wear one): no railway
    const held = { ...c0(30), crossing: { ...c0(30).crossing, control: "rival" as const } };
    expect(techOf({ ...town, tech: { ...town.tech, road: 2 as const } }, held, GOOD).railway).toBe(false);
    const thin = postAt("kessar", "town", 10, { trade: 40 });
    expect(techOf({ ...thin, tech: { ...thin.tech, road: 1 as const, telegraph: true } }, c0(30), GOOD).railway).toBe(false);
    // a settlement is not a town
    const settled = postAt("kessar", "settlement", 1);
    expect(techOf({ ...settled, tech: { ...settled.tech, road: 2 as const, telegraph: true } }, c0(30), GOOD).railway).toBe(false);
  });

  it("breech-loaders come from a post held as a garrison for four days (fortified or better, its priority military), or from any town; anywhere the Society has a post", () => {
    const fort = postAt("highmark", "fortified_outpost", 10, { priority: "military" });
    expect(techOf(fort, c0(13), GOOD).breech).toBe(false);
    expect(techOf(fort, c0(14), GOOD).breech).toBe(true);
    expect(techOf(postAt("kessar", "fortified_outpost", 1, { priority: "trade" }), c0(30), GOOD).breech).toBe(false);
    expect(techOf(postAt("kessar", "trading_post", 1, { priority: "military" }), c0(30), GOOD).breech).toBe(false);
    expect(techOf(postAt("kessar", "town", 29), c0(30), GOOD).breech).toBe(true);
  });

  it("the works opens beside the first post that is a settlement or better with extraction its priority, and names its region", () => {
    expect(techOf(postAt("highmark", "settlement", 1, { priority: "extraction" }), c0(5), GOOD).works).toBe("highmark");
    expect(techOf(postAt("highmark", "trading_post", 1, { priority: "extraction" }), c0(5), GOOD).works).toBe("");
    expect(techOf(postAt("kessar", "settlement", 1, { priority: "trade" }), c0(5), GOOD).works).toBe("");
  });

  it("all three are latched: a post that falls back keeps what it earned", () => {
    const s = postAt("kessar", "trading_post", 1);
    const earned = { ...s, tech: { ...newTech(), road: 2 as const, telegraph: true, railway: true, breech: true, works: "kessar" as const, since: { ...newTech().since, railway: 4, breech: 5, works: 6 } } };
    const t = techOf(earned, c0(40), GOOD);
    expect([t.railway, t.breech, t.works]).toEqual([true, true, "kessar"]);
    expect(t.since).toMatchObject({ railway: 4, breech: 5, works: 6 });
  });

  it("what they change: the railway's freight and a better-fed Kessar post, the breech-loaders' faster reload", () => {
    const none = techEffects(newTech());
    expect(none.reloadScale).toBe(1);
    const all = techEffects({ ...newTech(), road: 2, railway: true, breech: true });
    expect(all.capacityKg).toBe(40 + INDUSTRY.freightKg);
    expect(all.reloadScale).toBe(INDUSTRY.breechReload);
    expect(INDUSTRY.breechReload).toBeLessThan(1);
    // a day's supply at Kessar's post, with and without the railway
    const s = postAt("kessar", "settlement", 1);
    const a = evolveSettlements(s, c0(2), GOOD, 2).s.posts.kessar!.supply;
    const b = evolveSettlements({ ...s, tech: { ...s.tech, railway: true } }, c0(2), GOOD, 2).s.posts.kessar!.supply;
    expect(80 - a).toBe(SUPPLY_DECAY);
    expect(80 - b).toBe(INDUSTRY.railSupplyDecay);
  });

  it("a day of the works pays into the purse while its post stands, and the region's home power takes the grievance (the Ward at Kessar, the Reapers at Highmark)", () => {
    const c = c0(5);
    const p = newPowers(5);
    expect(worksDay(c, p, newSettlements()).paid).toBe(0);
    const k = postAt("kessar", "settlement", 1);
    const kw = worksDay(c, p, { ...k, tech: { ...k.tech, works: "kessar" } });
    expect(kw.paid).toBe(INDUSTRY.worksPay);
    expect(kw.c.purse).toBe(c.purse + INDUSTRY.worksPay);
    expect(kw.c.factions.ward.grievance).toBe(c.factions.ward.grievance + INDUSTRY.worksGrievance);
    expect(kw.p).toBe(p);
    const h = postAt("highmark", "settlement", 1);
    const hw = worksDay(c, p, { ...h, tech: { ...h.tech, works: "highmark" } });
    expect(hw.p.minor.reapers.grievance).toBe(p.minor.reapers.grievance + INDUSTRY.worksGrievance);
    expect(hw.c.factions.ward.grievance).toBe(c.factions.ward.grievance);
    // the post gone: no dividend, no smoke
    const gone = { ...h, posts: { highmark: { ...h.posts.highmark!, stage: "none" as const } }, tech: { ...h.tech, works: "highmark" as const } };
    expect(worksDay(c, p, gone).paid).toBe(0);
  });

  it("the day they arrive is news, with its own copy, and the paper reprints them from the state alone", () => {
    const town = postAt("kessar", "town", 1, { priority: "extraction" });
    const s = { ...town, tech: { ...town.tech, road: 2 as const, telegraph: true } };
    const r = evolveSettlements(s, c0(6), GOOD, 6);
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["railway", "breech", "works"]));
    for (const it of settlementDispatches(r.s, r.events.filter((e) => ["railway", "breech", "works"].includes(e.kind)), 7)) expect(it.head + it.body).not.toMatch(/\{\w+\}/);
    expect(settlementNews(r.s).map((e) => e.kind)).toEqual(expect.arrayContaining(["railway", "breech", "works"]));
  });

  it("parsing keeps them and refuses nonsense (a works where no post can stand, a railway that is a string); old saves read as none", () => {
    const s = { ...newSettlements(), tech: { ...newTech(), railway: true, breech: true, works: "highmark" as const, since: { ...newTech().since, railway: 3, breech: 4, works: 5 } } };
    expect(parseSettlements(serializeSettlements(s))?.tech).toEqual(s.tech);
    const bad = JSON.parse(serializeSettlements(s)) as { tech: Record<string, unknown> };
    bad.tech.works = "vesper";
    bad.tech.railway = "yes";
    const t = parseSettlements(JSON.stringify(bad))!.tech;
    expect([t.works, t.railway]).toEqual(["", false]);
    const old = JSON.stringify({ v: 1, posts: {}, tech: { road: 1, telegraph: true, launch: false, since: { road: 2, telegraph: 3, launch: 0 } } });
    expect(parseSettlements(old)?.tech).toMatchObject({ road: 1, telegraph: true, railway: false, breech: false, works: "", since: { railway: 0, breech: 0, works: 0 } });
  });

  it("the view draws the railhead at Kessar's post and the works beside its own post, only while a post stands there", () => {
    const k = postAt("kessar", "town", 1);
    const s = { ...k, tech: { ...k.tech, railway: true, works: "kessar" as const } };
    const rival = { posts: 0 as const };
    expect(regionDressOf(s, rival, "kessar")).toMatchObject({ railway: true, works: true });
    expect(regionDressOf(s, rival, "highmark").railway).toBeUndefined();
    expect(regionDressOf(s, rival, "highmark").works).toBeUndefined();
    const gone = { ...s, posts: { kessar: { ...s.posts.kessar!, stage: "none" as const } } };
    expect(regionDressOf(gone, rival, "kessar").railway).toBeUndefined();
    expect(regionDressOf(gone, rival, "kessar").works).toBeUndefined();
    // a dress without them keeps its old shape (the view's cache key)
    expect(Object.keys(regionDressOf(newSettlements(), rival, "kessar"))).not.toContain("railway");
  });
});
