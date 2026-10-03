import { describe, expect, it } from "vitest";
import { newCampaign } from "./factions.ts";
import { newPowers, powersAfterSettlement, powersDispatches, regionClimate } from "./powers.ts";
import { evolveSettlements, foundOutpost, newSettlements, settlementNews } from "./settlement.ts";
import type { RegionClimate, RegionId, SettlementEvent } from "./index.ts";

/** D-056: the Society's post at Highmark in the campaign's rules (the ground, the world and the walk are outpost.test.ts). */
describe("posts in more than one region (D-056)", () => {
  const c = { ...newCampaign(7), day: 10 };
  const both = (() => {
    let s = foundOutpost(newSettlements(), "kessar", c, 7);
    s = foundOutpost(s, "highmark", c, 7);
    return s;
  })();

  it("Highmark's weather is the Reapers'; Kessar's is the Ward's, as before; elsewhere the Syndicate presses at half", () => {
    const p = newPowers(7);
    const k = regionClimate(c, p, "kessar");
    const h = regionClimate(c, p, "highmark");
    expect(h).not.toEqual(k);
    const richer = { ...p, minor: { ...p.minor, reapers: { ...p.minor.reapers, prosperity: 90, trust: 90 } } };
    expect(regionClimate(c, richer, "highmark").trade).toBeGreaterThan(h.trade);
    expect({ ...regionClimate(c, richer, "kessar"), labour: 0 }).toEqual({ ...k, labour: 0 }); // (Kessar's labour was always the Reapers' hands)
    const there = { ...p, rival: { ...p.rival, goal: "sabotage_party" as const, where: { region: "highmark" as RegionId, spot: "road" as const } } };
    const away = { ...there, rival: { ...there.rival, where: { region: "kessar" as RegionId, spot: "road" as const } } };
    expect(regionClimate(c, there, "highmark").rivalPressure).toBeGreaterThan(regionClimate(c, away, "highmark").rivalPressure);
  });

  it("each post evolves in its own region's weather: a starving climate at Highmark leaves Kessar's post alone", () => {
    const GOOD: RegionClimate = { security: 90, trade: 90, hostility: 5, rivalPressure: 5, labour: 90 };
    const POOR: RegionClimate = { security: 5, trade: 5, hostility: 90, rivalPressure: 90, labour: 0 };
    const asked: RegionId[] = [];
    const r = evolveSettlements(both, c, (region) => (asked.push(region), region === "highmark" ? POOR : GOOD), 11);
    expect(asked.sort()).toEqual(["highmark", "kessar"]);
    expect(r.s.posts.kessar!.trade).toBeGreaterThan(r.s.posts.highmark!.trade);
    expect(r.s.posts.kessar!.growth).toBeGreaterThan(r.s.posts.highmark!.growth);
    // one climate for all still works (the old call)
    expect(evolveSettlements(both, c, GOOD, 11).s.posts.highmark!.trade).toBe(evolveSettlements(both, c, () => GOOD, 11).s.posts.highmark!.trade);
  });

  it("the paper reads every post; Highmark's founding pleases the Reapers, is printed as Highmark's, and leaves Kessar's raid flags alone", () => {
    const news = settlementNews(both);
    expect(news.filter((e) => e.kind === "founded").map((e) => e.region).sort()).toEqual(["highmark", "kessar"]);
    const p0 = newPowers(7);
    const ev: SettlementEvent[] = [{ kind: "founded", day: 10, region: "highmark", stage: "camp", name: "Fort Patience" }];
    const p = powersAfterSettlement(c, p0, ev);
    expect(p.flags).not.toContain("party_post");
    expect(p.minor.reapers.trust).toBeGreaterThan(p0.minor.reapers.trust);
    expect(p.minor.brine.trust).toBe(p0.minor.brine.trust);
    expect(p.log.at(-1)?.kind).toBe("settle_founded_highmark");
    const paper = powersDispatches(p, 7, 3);
    expect(paper.some((d) => /barley|grass|Highmark/i.test(`${d.head} ${d.body}`))).toBe(true);
    expect(paper.some((d) => /Kessar|south of the bridge/.test(`${d.head} ${d.body}`))).toBe(false);
    // Kessar's own founding still sets the flag the Syndicate's raid reads; losing Highmark's post does not clear it
    const pk = powersAfterSettlement(c, p0, [{ kind: "founded", day: 10, region: "kessar", stage: "camp", name: "x" }]);
    expect(pk.flags).toContain("party_post");
    expect(powersAfterSettlement(c, pk, [{ kind: "abandoned", day: 12, region: "highmark", stage: "none", name: "y" }]).flags).toContain("party_post");
    expect(powersAfterSettlement(c, pk, [{ kind: "abandoned", day: 12, region: "kessar", stage: "none", name: "x" }]).flags).not.toContain("party_post");
  });
});
