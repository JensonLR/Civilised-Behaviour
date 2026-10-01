import { describe, expect, it } from "vitest";
import { REGION_IDS, isRegionId } from "./campaignTypes.ts";
import { HIGHMARK_ANCHORS, HIGHMARK_RESOLUTIONS, HIGHMARK_SITES, HIGHMARK_STATUS, createHighmarkWorld, highmarkSitePoints, highmarkSpawn } from "./highmark.ts";
import { POWERS, RESOLUTIONS, TEMPLATE_RESOLUTIONS } from "./factions.ts";
import { REGIONS, createRegionWorld, findStation, isReachableRegion, reachableRegions, regionLanding, regionNavOptions, regionProps, regionSpawn, stationsFor } from "./regions.ts";
import { REGION_TEMPLATES, TEMPLATES, TEMPLATE_IDS, pickTemplate } from "./scenarios/registry.ts";
import { newCampaign } from "./factions.ts";
import { travelIdle, travelPropose } from "./travel.ts";
import { regionMountSpots } from "./mount.ts";

/**
 * D-036 contract guards (package G may ADD to this file's gate block but must never delete a test here). Until G sets `HIGHMARK_STATUS.stub = false` and
 * `REGIONS.highmark.reachable = true` the region must be invisible to players: not on the chart, refused by the travel machine, yet fully addressable by a dev start.
 */
describe("Highmark contract (D-036)", () => {
  it("is a region of the contract with its own world, spawn, props, stations, nav options and mount spots", () => {
    expect(REGION_IDS).toContain("highmark");
    expect(isRegionId("highmark")).toBe(true);
    expect(REGIONS.highmark.id).toBe("highmark");
    expect(REGIONS.highmark.bounds).toBe(HIGHMARK_ANCHORS.bounds);
    const w = createRegionWorld("highmark", 7);
    expect(w.boundsRadius).toBe(HIGHMARK_ANCHORS.bounds);
    expect(createHighmarkWorld(7).obstacles.length).toBe(w.obstacles.length);
    for (let i = 0; i < 4; i++) {
      const s = regionSpawn("highmark", i, 4);
      expect(s).toEqual(highmarkSpawn(i, 4));
      const p = { x: s.x, z: s.z };
      expect(w.resolveXZ(p, w.terrainHeight(s.x, s.z), 0.6, 1.2), `spawn ${i} is open`).toBe(false);
    }
    expect(regionLanding("highmark")).toEqual(HIGHMARK_ANCHORS.landing);
    expect(regionLanding("kessar")).toEqual({ x: 0, z: 88 });
    expect(Array.isArray(regionProps("highmark", 7, w))).toBe(true);
    expect(regionNavOptions("highmark", w).tag).toBe("highmark");
    expect(regionNavOptions("hollowmere", createRegionWorld("hollowmere", 7))).toEqual({});
    expect(stationsFor("highmark").map((s) => s.id)).toEqual(["dock", "chamberlain", "elder", "younger"]);
    expect(stationsFor("highmark").filter((s) => s.kind === "court")).toHaveLength(3);
    const near = HIGHMARK_SITES.chamberlain;
    expect(findStation("highmark", near.x, near.z + 1, 0)?.id).toBe("chamberlain");
    const spots = regionMountSpots("highmark");
    expect(spots.horses.length).toBeGreaterThanOrEqual(2);
    expect(highmarkSitePoints().length).toBeGreaterThan(10);
  });

  it("the Reapers have their home here, and no other local power does", () => {
    expect(POWERS.filter((p) => p.region === "highmark").map((p) => p.id)).toEqual(["reapers"]);
    expect(POWERS.find((p) => p.id === "ward")!.region).toBe("kessar");
  });

  it("the succession dispute is registered, offered only at Highmark, and its five endings are in every exhaustive table", () => {
    expect(TEMPLATE_IDS).toContain("succession_dispute");
    expect(TEMPLATES.succession_dispute.id).toBe("succession_dispute");
    expect(REGION_TEMPLATES.highmark).toEqual(["succession_dispute"]);
    expect(REGION_TEMPLATES.kessar).not.toContain("succession_dispute");
    expect(REGION_TEMPLATES.hollowmere).toEqual([]);
    const c = newCampaign(3);
    expect(pickTemplate(c, "highmark", 3)).toBe("succession_dispute");
    for (const day of [1, 4, 9, 30]) for (const tpl of ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident"] as const) {
      expect(pickTemplate({ ...c, day, history: [{ seq: 1, region: "kessar", resolution: "paid", day: 1, template: tpl }] }, "kessar", day)).not.toBe("succession_dispute");
    }
    expect([...TEMPLATE_RESOLUTIONS.succession_dispute].sort()).toEqual([...HIGHMARK_RESOLUTIONS, "abandoned"].sort());
    for (const r of HIGHMARK_RESOLUTIONS) expect(RESOLUTIONS).toContain(r);
    expect(TEMPLATES.succession_dispute.init(c, 0, 3).phase).toBe("approach");
    expect(TEMPLATES.succession_dispute.leave(TEMPLATES.succession_dispute.init(c, 0, 3))).toBeUndefined();
  });

  it("while it is a stub it is not reachable by sea: off the chart, refused by the travel machine, still a dev start", () => {
    if (!HIGHMARK_STATUS.stub) return;   // G's gate tests (highmark.test.ts) take over
    expect(REGIONS.highmark.reachable).toBe(false);
    expect(isReachableRegion("highmark")).toBe(false);
    expect(reachableRegions()).toEqual(["hollowmere", "kessar"]);
    const r = travelPropose(travelIdle(), "hollowmere", "highmark", 0, 1);
    expect(r.s.phase).toBe(0);
    expect(travelPropose(travelIdle(), "hollowmere", "kessar", 0, 1).s.phase).toBe(2);
  });

  it("once it is reachable the stub flag must be off (the two flip together, as G's last act)", () => {
    expect(REGIONS.highmark.reachable).toBe(!HIGHMARK_STATUS.stub);
  });
});
