import { describe, expect, it } from "vitest";
import { createArena } from "./arena.ts";
import { CAMP, hqPlan } from "./camp.ts";
import { KESSAR_ANCHORS as A, REGION_IDS } from "./campaignTypes.ts";
import { JETTY } from "./landscape.ts";
import { REGIONS, createRegionWorld, findStation, regionProps, regionSpawn, stationsFor } from "./regions.ts";

describe("regions", () => {
  it("every region has a definition, a world, a spawn ring and props", () => {
    for (const id of REGION_IDS) {
      expect(REGIONS[id].id).toBe(id);
      expect(REGIONS[id].name.length).toBeGreaterThan(3);
      expect(REGIONS[id].blurb.length).toBeGreaterThan(20);
      const w = createRegionWorld(id, 7);
      expect(w.boundsRadius).toBe(REGIONS[id].bounds);
      for (let i = 0; i < 4; i++) {
        const s = regionSpawn(id, i);
        expect(Math.hypot(s.x, s.z)).toBeLessThan(REGIONS[id].bounds);
        expect(Number.isFinite(w.terrainHeight(s.x, s.z))).toBe(true);
      }
      expect(regionProps(id, 7, w).length).toBeGreaterThan(3);
    }
  });

  it("hollowmere is the arena, unchanged; kessar honours the bridge option", () => {
    const a = createRegionWorld("hollowmere", 7);
    const b = createArena(7);
    expect(a.obstacles.length).toBe(b.obstacles.length);
    expect(a.terrainHeight(12, -30)).toBe(b.terrainHeight(12, -30));
    const k = createRegionWorld("kessar", 7);
    const c = createRegionWorld("kessar", 7, { bridge: "collapsed" });
    expect(k.obstacles.some((o) => o.tag === "bridge" && o.kind === "box")).toBe(true);
    expect(c.obstacles.some((o) => o.tag === "bridge" && o.kind === "box")).toBe(false);
  });

  it("names and blurbs are invented: no real nation, people, religion or city", () => {
    const banned = /\b(london|england|britain|british|france|french|german|spain|spanish|rome|roman|india|indian|china|chinese|japan|africa|african|arab|arabia|egypt|turk|persia|islam|muslim|christ|jewish|hindu|buddh|america|russia|paris|berlin|cairo)\b/i;
    for (const r of Object.values(REGIONS)) {
      expect(r.name).not.toMatch(banned);
      expect(r.blurb).not.toMatch(banned);
    }
  });

  it("kessar's arrivals ring the landing", () => {
    for (let i = 0; i < 4; i++) {
      const s = regionSpawn("kessar", i, 4);
      expect(Math.hypot(s.x - A.landing.x, s.z - A.landing.z)).toBeCloseTo(2.6, 5);
    }
  });
});

describe("stations", () => {
  it("hollowmere: the map table, the notice board, the dock, the supply manifest", () => {
    const ids = stationsFor("hollowmere").map((s) => `${s.kind}:${s.id}`);
    expect(ids).toEqual(["map:map", "paper:paper", "dock:dock", "loadout:loadout"]);
    expect(stationsFor("kessar").map((s) => s.kind).sort()).toEqual(["dock", "foundation", "pier", "warden"]);
    expect(stationsFor("kessar")).not.toBe(stationsFor("kessar")); // (a copy: callers may not edit the table)
  });

  it("facing the table from its south side finds the map; turning your back loses it", () => {
    const t = CAMP.mapTable;
    // facing 0 looks toward -z: standing south of the table, looking at it
    expect(findStation("hollowmere", t.x, t.z + 1.6, 0)?.kind).toBe("map");
    expect(findStation("hollowmere", t.x, t.z + 1.6, Math.PI)).toBeUndefined();
    // right on top of it, any way round works (arm's reach)
    expect(findStation("hollowmere", t.x, t.z + 0.4, Math.PI)?.kind).toBe("map");
    expect(findStation("hollowmere", t.x + 10, t.z + 10, 0)).toBeUndefined();
  });

  it("the notice board and the dock are found from where you would stand; the nearest wins", () => {
    const n = hqPlan().notice;
    expect(findStation("hollowmere", n.x, n.z + 1.5, 0)?.kind).toBe("paper");
    expect(findStation("hollowmere", JETTY.x0, JETTY.z0 + 1.5, 0)?.kind).toBe("dock");
    // between the map table and the notice board the nearer is chosen
    const near = findStation("hollowmere", CAMP.mapTable.x + 0.3, CAMP.mapTable.z + 0.3, 0);
    expect(near?.id).toBe("map");
  });

  it("kessar: pier, warden and dock by position; nothing in the open", () => {
    expect(findStation("kessar", A.pier.x, A.pier.z + 1, 0)?.kind).toBe("pier");
    expect(findStation("kessar", A.wardenPost.x, A.wardenPost.z + 1, 0)?.kind).toBe("warden");
    expect(findStation("kessar", A.landing.x, A.landing.z + 1, 0)?.kind).toBe("dock");
    expect(findStation("kessar", 30, 60, 0)).toBeUndefined();
    // the same spot means different things in different regions
    expect(findStation("hollowmere", A.landing.x, A.landing.z, 0)).toBeUndefined();
  });

  it("findStation does not allocate (a call that allocated 20 bytes would grow the heap by 8 MB here)", () => {
    const run = (n: number): number => {
      let hits = 0;
      for (let i = 0; i < n; i++) if (findStation("hollowmere", -2.4, -5.4 + (i % 3) * 0.1, (i % 7) * 0.1)) hits++;
      return hits;
    };
    run(20_000); // warm up: compile, settle
    const before = process.memoryUsage().heapUsed;
    const hits = run(400_000);
    expect(hits).toBeGreaterThan(0);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(8_000_000);
  });
});
