import { describe, expect, it } from "vitest";
import { NPC, NPC_CAP, REGION_IDS, isRegionId, type ResolutionId, type ScenarioTemplateId } from "./campaignTypes.ts";
import { NPC_SIDE } from "./expeditionTypes.ts";
import { POWERS, RESOLUTIONS, TEMPLATE_RESOLUTIONS, applyOutcome, consequenceLines, newCampaign, newSites, parseCampaign, serializeCampaign, wardMemory } from "./factions.ts";
import { generatePaper } from "./newspaper.ts";
import { HEADLINES, SITE_LINES, STANDFIRSTS, STORY_HEADS } from "./newspaperText.ts";
import { MEMORY_LINE } from "./negotiationText.ts";
import { HISTORY_PIECE } from "./outpostText.ts";
import { PALETTE, HIGHMARK_SWATCH, KESSAR_SWATCH } from "./palette.ts";
import { VESPER_SWATCH } from "./paletteVesper.ts";
import { SALTMARKET_SWATCH } from "./paletteSaltmarket.ts";
import { NEWS } from "./powersText.ts";
import { powersAfterOutcome, newPowers } from "./powers.ts";
import { REGIONS, createRegionWorld, findStation, isReachableRegion, reachableRegions, regionLanding, regionNavOptions, regionProps, regionSpawn, stationsFor } from "./regions.ts";
import { NEW_RESOLUTIONS, NEW_TEMPLATE_IDS, NEW_TEMPLATE_RESOLUTIONS, SALTMARKET_RESOLUTIONS, TEMPLATE_REGION, VESPER_RESOLUTIONS, isNewTemplate } from "./regionEndings.ts";
import { liveRegions, liveResolutions, liveTemplates } from "./regionStatus.ts";
import { RELATION_FX } from "./relations.ts";
import { GRUDGE_FX } from "./rival.ts";
import { SALTMARKET_ANCHORS, SALTMARKET_MOUNT_SPOTS, SALTMARKET_SITES, SALTMARKET_STATUS, SALTMARKET_VIEW_BUDGET, createSaltmarketWorld, saltmarketSitePoints, saltmarketSpawn } from "./saltmarket.ts";
import { COMPLICATION_POOL } from "./chaos.ts";
import { REGION_TEMPLATES, TEMPLATES, TEMPLATE_IDS, pickTemplate } from "./scenarios/registry.ts";
import { SCRIPTED_KINDS, answerSiteParley, openSiteParley, parleyScript } from "./scenarios/parleys.ts";
import { travelIdle, travelPropose } from "./travel.ts";
import { VESPER_ANCHORS, VESPER_MOUNT_SPOTS, VESPER_SITES, VESPER_STATUS, VESPER_VIEW_BUDGET, createVesperWorld, vesperSitePoints, vesperSpawn } from "./vesper.ts";
import { regionMountSpots } from "./mount.ts";
import { REGION_COPY } from "./regionCopy.ts";
import type { ScenarioOutcome } from "./campaignTypes.ts";

/**
 * D-037 contract guards (docs/_notes/regions34.md; packages C3 and D4 may ADD to this file's blocks but must never delete a test here). The two regions exist in the contract from the start:
 * ids, worlds, spawns, stations, mount spots, nine templates' tables, sixteen endings in every exhaustive table, a ledger field, parley kinds as data. Until a package sets its STATUS flag false
 * and `REGIONS.<id>.reachable` true (together, as its last act) the region must be invisible to players yet fully addressable by a dev start.
 */
const REGION_OF: Record<"vesper" | "saltmarket", { status: { stub: boolean }; endings: readonly ResolutionId[]; templates: readonly ScenarioTemplateId[] }> = {
  vesper: { status: VESPER_STATUS, endings: VESPER_RESOLUTIONS, templates: ["mine_rescue", "claim_race"] },
  saltmarket: { status: SALTMARKET_STATUS, endings: SALTMARKET_RESOLUTIONS, templates: ["smuggling_run", "flooded_market"] },
};
const tally = { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 };
const outcome = (resolution: ResolutionId, scenario: ScenarioTemplateId): ScenarioOutcome => ({ scenario, resolution, toll: 40, paid: 20, bridge: "intact", tally, brokePromise: false, seconds: 100, region: TEMPLATE_REGION[scenario] });

describe("Vesper Gorge and the Saltmarket Delta: the contract (D-037)", () => {
  it("both are regions of the contract with a definition, a world, spawns, a landing, props, stations, nav options and mount spots", () => {
    expect(REGION_IDS).toEqual(expect.arrayContaining(["vesper", "saltmarket"]));
    expect(REGION_IDS.slice(0, 3)).toEqual(["hollowmere", "kessar", "highmark"]);   // append-only
    const anchors = { vesper: VESPER_ANCHORS, saltmarket: SALTMARKET_ANCHORS };
    for (const id of ["vesper", "saltmarket"] as const) {
      expect(isRegionId(id)).toBe(true);
      expect(REGIONS[id].id).toBe(id);
      expect(REGIONS[id].name.length).toBeGreaterThan(5);
      expect(REGIONS[id].blurb.length).toBeGreaterThan(40);
      expect(REGIONS[id].bounds).toBe(anchors[id].bounds);
      const w = createRegionWorld(id, 7);
      expect(w.boundsRadius).toBe(anchors[id].bounds);
      for (let i = 0; i < 4; i++) {
        const s = regionSpawn(id, i, 4);
        expect(w.resolveXZ({ x: s.x, z: s.z }, w.terrainHeight(s.x, s.z), 0.6, 1.2), `${id} spawn ${i} is open`).toBe(false);
      }
      expect(regionLanding(id)).toEqual(anchors[id].landing);
      expect(Array.isArray(regionProps(id, 7, w))).toBe(true);
      expect(regionNavOptions(id, w).tag).toBe(id);
      const st = stationsFor(id);
      expect(st.some((s) => s.kind === "dock")).toBe(true);
      expect(st.filter((s) => s.kind === "post").length).toBeGreaterThanOrEqual(3);
      expect(new Set(st.map((s) => s.id)).size).toBe(st.length);
      const spots = regionMountSpots(id);
      expect(spots.horses.length).toBeGreaterThanOrEqual(2);
      for (const sp of [...spots.horses, spots.wagon]) expect(w.resolveXZ({ x: sp.x, z: sp.z }, w.terrainHeight(sp.x, sp.z), 0.9, 1.8), `${id} mount spot is open`).toBe(false);
    }
    expect(createVesperWorld(7).obstacles.length).toBe(createRegionWorld("vesper", 7).obstacles.length);
    expect(createSaltmarketWorld(7).obstacles.length).toBe(createRegionWorld("saltmarket", 7).obstacles.length);
    expect(vesperSpawn(1, 4)).toEqual(regionSpawn("vesper", 1, 4));
    expect(saltmarketSpawn(1, 4)).toEqual(regionSpawn("saltmarket", 1, 4));
    expect(VESPER_MOUNT_SPOTS).toBe(regionMountSpots("vesper"));
    expect(SALTMARKET_MOUNT_SPOTS).toBe(regionMountSpots("saltmarket"));
    const dockV = stationsFor("vesper").find((s) => s.id === "dock")!;
    expect(findStation("vesper", dockV.x, dockV.z + 1, 0)?.id).toBe("dock");
    for (const pts of [vesperSitePoints(), saltmarketSitePoints()]) {
      expect(pts.length).toBeGreaterThan(10);
      expect(new Set(pts.map((p) => p.id)).size).toBe(pts.length);
    }
    expect(VESPER_SITES.miners.length).toBeGreaterThanOrEqual(3);
    expect(SALTMARKET_SITES.houseHeads.length).toBeGreaterThanOrEqual(3);
    for (const b of [VESPER_VIEW_BUDGET, SALTMARKET_VIEW_BUDGET]) {
      expect(b.meshes.low).toBeLessThanOrEqual(b.meshes.medium);
      expect(b.triangles.low).toBeLessThanOrEqual(b.triangles.high);
    }
  });

  it("the home powers: the Guild's Cloister is Vesper's, the Houses' Quay is the Saltmarket's, and no other power moved", () => {
    expect(POWERS.filter((p) => p.region === "vesper").map((p) => p.id)).toEqual(["choir"]);
    expect(POWERS.filter((p) => p.region === "saltmarket").map((p) => p.id)).toEqual(["brine"]);
    expect(POWERS.filter((p) => p.region === "highmark").map((p) => p.id)).toEqual(["reapers"]);
    expect(POWERS.find((p) => p.id === "ward")!.region).toBe("kessar");
  });

  it("four templates are registered, each offered only in its own region, each with >= 3 endings besides abandoned", () => {
    expect(NEW_TEMPLATE_IDS.sort()).toEqual(["claim_race", "flooded_market", "mine_rescue", "smuggling_run"]);
    expect(REGION_TEMPLATES.vesper).toEqual(["mine_rescue", "claim_race"]);
    expect(REGION_TEMPLATES.saltmarket).toEqual(["smuggling_run", "flooded_market"]);
    for (const id of NEW_TEMPLATE_IDS) {
      expect(TEMPLATE_IDS).toContain(id);
      expect(TEMPLATES[id].id).toBe(id);
      expect(TEMPLATES[id].title.length).toBeGreaterThan(5);
      expect(TEMPLATES[id].brief.length).toBeGreaterThan(60);
      expect(TEMPLATE_RESOLUTIONS[id]).toEqual(NEW_TEMPLATE_RESOLUTIONS[id]);
      expect(TEMPLATE_RESOLUTIONS[id].filter((r) => r !== "abandoned").length).toBeGreaterThanOrEqual(3);
      expect(TEMPLATE_RESOLUTIONS[id]).toContain("abandoned");
      expect(isNewTemplate(id)).toBe(true);
      expect(COMPLICATION_POOL[id].length).toBeGreaterThan(0);
      for (const where of ["hollowmere", "kessar", "highmark"] as const) expect(REGION_TEMPLATES[where]).not.toContain(id);
    }
    for (const id of TEMPLATE_IDS) expect(REGION_TEMPLATES[TEMPLATE_REGION[id]], id).toContain(id);   // TEMPLATE_REGION agrees with REGION_TEMPLATES, for all nine
    const c = newCampaign(3);
    for (const region of ["vesper", "saltmarket"] as const) {
      const seen = new Set<ScenarioTemplateId>();
      let h = c;
      for (let i = 0; i < 6; i++) {
        const t = pickTemplate(h, region, 11 + i)!;
        expect(REGION_TEMPLATES[region]).toContain(t);
        seen.add(t);
        h = applyOutcome(h, outcome(TEMPLATE_RESOLUTIONS[t][0]!, t));
      }
      expect(seen.size, `${region} offers both of its contracts over a campaign`).toBe(2);
    }
    for (const day of [1, 4, 9, 30]) for (const tpl of ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident"] as const) {
      expect(NEW_TEMPLATE_IDS as string[], "never at Kessar").not.toContain(pickTemplate({ ...c, day, history: [{ seq: 1, region: "kessar", resolution: "paid", day: 1, template: tpl }] }, "kessar", day));
    }
  });

  it("all sixteen endings are in every exhaustive table, apply without throwing, and are remembered in the ledger and the paper", () => {
    expect(NEW_RESOLUTIONS.length).toBe(16);
    expect(new Set(NEW_RESOLUTIONS).size).toBe(16);
    for (const r of NEW_RESOLUTIONS) expect(RESOLUTIONS).toContain(r);
    for (const tpl of NEW_TEMPLATE_IDS) {
      for (const r of NEW_TEMPLATE_RESOLUTIONS[tpl]) {
        for (const table of [RELATION_FX, GRUDGE_FX, HISTORY_PIECE, MEMORY_LINE, HEADLINES, STANDFIRSTS] as Record<string, unknown>[]) expect(table[r], `${tpl}/${r}`).toBeDefined();
        const before = newCampaign(5);
        const after = applyOutcome(before, outcome(r, tpl));
        expect(after.history[after.history.length - 1]).toMatchObject({ resolution: r, template: tpl, region: TEMPLATE_REGION[tpl] });
        expect(after.sites.ends[tpl], `${tpl}/${r}`).toBe(r);
        // crossing, toll and bridge belong to Kessar's contract: a contract played in these regions leaves them alone
        expect(after.crossing).toEqual(before.crossing);
        expect(Number.isFinite(wardMemory(after).contempt)).toBe(true);
        expect(Array.isArray(consequenceLines(before, after))).toBe(true);
        const p = powersAfterOutcome(before, after, newPowers(5), outcome(r, tpl));
        expect(p.log.some((e) => e.kind === `end_${r}`) || r === "abandoned", `${r} logs its dispatch`).toBe(true);
        if (r !== "abandoned") expect(NEWS[`end_${r}`], r).toBeDefined();
        expect(generatePaper(after, 9).headline.length).toBeGreaterThan(5);
      }
    }
    for (const tpl of NEW_TEMPLATE_IDS) expect((STORY_HEADS as Record<string, readonly string[]>)[tpl]?.length, tpl).toBeGreaterThanOrEqual(3);
    for (const r of NEW_RESOLUTIONS) expect((SITE_LINES as Record<string, readonly string[] | undefined>)[r]?.length ?? 0, r).toBeGreaterThanOrEqual(2);
  });

  it("the ledger's `ends` field: a pre-D-037 campaign loads with {}, a hostile one is clamped, and it survives a serialise round trip", () => {
    const old = JSON.parse(serializeCampaign(newCampaign(4))) as { sites: Record<string, unknown> };
    delete old.sites.ends;
    expect(parseCampaign(JSON.stringify(old))?.sites.ends).toEqual({});
    expect(newSites().ends).toEqual({});
    const hostile = JSON.parse(serializeCampaign(newCampaign(4))) as { sites: Record<string, unknown> };
    hostile.sites.ends = { mine_rescue: "paid", claim_race: "staked", smuggling_run: 7, flooded_market: "washed_out", secure_crossing: "paid", __proto__: { x: 1 } };
    // an ending the template cannot have, a wrong type and a template that has no entry are dropped; the valid ones stay
    expect(parseCampaign(JSON.stringify(hostile))?.sites.ends).toEqual({ claim_race: "staked", flooded_market: "washed_out" });
    for (const junk of [null, 5, "x", [], [1, 2], { a: 1 }]) {
      const j = JSON.parse(serializeCampaign(newCampaign(4))) as { sites: Record<string, unknown> };
      j.sites.ends = junk;
      expect(parseCampaign(JSON.stringify(j))?.sites.ends).toEqual({});
    }
    let c = newCampaign(6);
    for (const [t, r] of [["mine_rescue", "sealed"], ["claim_race", "jumped"], ["smuggling_run", "informed"], ["flooded_market", "consortium"]] as const) c = applyOutcome(c, outcome(r, t));
    expect(c.sites.ends).toEqual({ mine_rescue: "sealed", claim_race: "jumped", smuggling_run: "informed", flooded_market: "consortium" });
    expect(parseCampaign(serializeCampaign(c))).toEqual(c);
    expect(serializeCampaign(c).length).toBeLessThan(2400);   // the 12-entry history + the four ends stay far inside parseCampaign's 8 KB and the wire's budget
  });

  it("the six parley kinds are SCRIPTS: each opens, walks away, never throws on hostile input, and only ever reports a result its script offers", () => {
    expect([...SCRIPTED_KINDS].sort()).toEqual(["assayer", "auctioneer", "dirge_master", "foreman", "house_head", "tide_reeve"]);
    for (const kind of SCRIPTED_KINDS) {
      const sc = parleyScript(kind)!;
      expect(sc.speaker.length).toBeGreaterThan(5);
      for (const list of [sc.open, sc.round2]) expect(list.length).toBeGreaterThanOrEqual(2);
      const v = openSiteParley(kind, { price: 40, purse: 100, seed: 3, day: 2 });
      expect(v.speaker).toBe(sc.speaker);
      expect(v.options.length).toBeGreaterThanOrEqual(1);
      const walk = v.options.findIndex((o) => o.id === "walk_away");
      expect(walk, `${kind} offers a way out`).toBeGreaterThanOrEqual(0);
      expect(answerSiteParley(kind, { price: 40, purse: 100, seed: 3, day: 2 }, v, walk)).toMatchObject({ done: { result: "walked" } });
      for (const bad of [-1, 99, 1.5, NaN, "x" as unknown as number, undefined as unknown as number]) {
        const s = answerSiteParley(kind, { price: 40, purse: 0, seed: 3, day: 2 }, v, bad);
        expect(s.view !== undefined || s.done !== undefined).toBe(true);
      }
      for (let i = 0; i < v.options.length; i++) {
        let step = answerSiteParley(kind, { price: 40, purse: 100, seed: 3, day: 2 }, v, i);
        for (let r = 0; r < 4 && step.view; r++) step = answerSiteParley(kind, { price: 40, purse: 100, seed: 3, day: 2 }, step.view, step.view.options.length - 1);
        expect(step.view === undefined || step.done === undefined).toBe(true);
      }
    }
  });

  it("the NPC roles are unique and sided, the palettes exist and obey the discipline, and the copy gathers in REGION_COPY", () => {
    const roles = Object.values(NPC);
    expect(new Set(roles).size).toBe(roles.length);
    for (const r of [NPC.FOREMAN, NPC.MINER, NPC.MOURNER, NPC.CUSTOMS, NPC.BARGEMAN, NPC.FACTOR]) expect(NPC_SIDE[r], `role ${r}`).toBeDefined();
    expect(NPC_CAP).toBeGreaterThanOrEqual(24);
    for (const g of [PALETTE.vesper, PALETTE.saltmarket]) {
      expect(Object.keys(g).length).toBeGreaterThanOrEqual(8);
      for (const v of Object.values(g)) expect(Number.isInteger(v) && v >= 0 && v <= 0xffffff).toBe(true);
    }
    for (const sw of [KESSAR_SWATCH, HIGHMARK_SWATCH, VESPER_SWATCH, SALTMARKET_SWATCH]) expect(Object.keys(sw).sort()).toEqual(["accent", "cloth", "ground", "roof", "wall"]);
    for (const id of ["vesper", "saltmarket"] as const) {
      const rc = REGION_COPY[id]!;
      expect(rc.presence.length).toBeGreaterThanOrEqual(2);
      expect(rc.parley.heading.length).toBeGreaterThan(4);
      expect(rc.parley.asked).toContain("{price}");
      const c0 = newCampaign(2);
      expect(rc.chartNote(c0).length).toBeGreaterThan(20);
      expect(rc.chartNote(c0).length).toBeLessThanOrEqual(240);
      const t = REGION_TEMPLATES[id][0]!;
      const c1 = applyOutcome(c0, outcome(TEMPLATE_RESOLUTIONS[t][0]!, t));
      expect(rc.chartNote(c1).length).toBeLessThanOrEqual(240);
    }
  });

  it("while a region is a stub it is not reachable by sea: off the chart, refused by the travel machine, still a dev start", () => {
    for (const id of ["vesper", "saltmarket"] as const) {
      if (!REGION_OF[id].status.stub) continue;   // the package's own gate tests take over once it flips
      expect(REGIONS[id].reachable, id).toBe(false);
      expect(isReachableRegion(id)).toBe(false);
      expect(reachableRegions()).not.toContain(id);
      const r = travelPropose(travelIdle(), "hollowmere", id, 0, 1);
      expect(r.s.phase).toBe(0);
    }
    expect(reachableRegions().slice(0, 3)).toEqual(["hollowmere", "kessar", "highmark"]);
    expect(travelPropose(travelIdle(), "hollowmere", "kessar", 0, 1).s.phase).toBe(2);
  });

  it("once a region is reachable its stub flag must be off (the two flip together, as the package's last act), and the live helpers agree", () => {
    for (const id of ["vesper", "saltmarket"] as const) expect(REGIONS[id].reachable, id).toBe(!REGION_OF[id].status.stub);
    expect(reachableRegions()).toEqual(liveRegions());
    for (const id of ["vesper", "saltmarket"] as const) {
      for (const e of REGION_OF[id].endings) expect(liveResolutions().includes(e), e).toBe(!REGION_OF[id].status.stub);
      for (const t of REGION_OF[id].templates) expect(liveTemplates().includes(t), t).toBe(!REGION_OF[id].status.stub);
    }
  });
});
