import { describe, expect, it } from "vitest";
import { newCampaign } from "./factions.ts";
import { campaignMapOf } from "./mapData.ts";
import { mapPins, newPowers } from "./powers.ts";
import { rivalSighting } from "./rival.ts";
import { newSettlements, deliverTo } from "./settlement.ts";
import { PropKind } from "./props.ts";
import { REGIONS } from "./regions.ts";

describe("campaignMapOf", () => {
  const c = newCampaign(2), p = newPowers(2);
  const pins = mapPins(c, p, ["brine"]);
  it("a fresh campaign: both regions, no outposts, no rival marker, the lanes from where you stand, unmet powers unknown", () => {
    const m = campaignMapOf(c, newSettlements(), undefined, pins, { title: "Secure the River Crossing", brief: "x" }, newSettlements().tech);
    expect(m.regions.map((r) => r.id)).toEqual(["hollowmere", "kessar"]);
    expect(m.regions[0]!.here).toBe(true);
    expect(m.regions[1]!.offered?.title).toBe("Secure the River Crossing");
    expect(m.regions.every((r) => r.outpost === undefined && r.rivalPost === 0)).toBe(true);
    expect(m.rival).toBeUndefined();
    expect(m.lanes).toEqual([{ to: "kessar", seconds: REGIONS.kessar.sailSeconds }]);
    expect(m.pins.length).toBe(5);
    expect(m.pins.find((x) => x.id === "choir")!.known).toBe(false);
    expect(m.pins.find((x) => x.id === "brine")!.audience).toBe(true);
  });
  it("with an outpost, the rival's post, a sighting and a launch", () => {
    let s = newSettlements();
    for (let i = 0; i < 4; i++) s = deliverTo(s, "kessar", PropKind.CRATE, c, 1).s;
    const tech = { road: 2 as const, telegraph: true, launch: true, since: { road: 1, telegraph: 2, launch: 3 } };
    const seen = { ...p, rival: { ...p.rival, seenDay: 3, day: 5, where: { region: "kessar" as const, spot: "ford" as const } } };
    const m = campaignMapOf(c, { ...s, tech }, rivalSighting(c, seen, 2), pins, undefined, tech, "kessar", 2);
    expect(m.regions[1]!.here).toBe(true);
    expect(m.regions[1]!.outpost).toMatchObject({ stage: "camp", priority: "trade" });
    expect(m.regions[1]!.rivalPost).toBe(2);
    expect(m.rival).toMatchObject({ age: 2, where: "at the ford" });
    expect(m.rival!.goal).toBeTruthy();
    expect(m.lanes).toEqual([{ to: "hollowmere", seconds: REGIONS.hollowmere.sailSeconds / 2 }]);
    expect(m.tech).toEqual(tech);
    // the data is a copy: mutating it leaves the state alone
    m.tech.since.road = 99;
    expect(tech.since.road).toBe(1);
  });
  it("no rival goal without intel", () => {
    const seen = { ...p, rival: { ...p.rival, seenDay: 3, day: 5 } };
    expect(campaignMapOf(c, newSettlements(), rivalSighting(c, seen, 0), pins, undefined, newSettlements().tech).rival!.goal).toBeUndefined();
  });
});
