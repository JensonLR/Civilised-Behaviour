import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS as A, KESSAR_SITES as S } from "./campaignTypes.ts";
import { NAV } from "./expeditionTypes.ts";
import { kessarNavOptions } from "./garrison.ts";
import { KESSAR, createKessarWorld, kessarObstacles, kessarPlan, kessarSitePoints } from "./kessar.ts";
import { NavQuery, buildNavGrid, newNavPath } from "./nav.ts";
import { PATROL_ROUTE } from "./scenarios/convoy.ts";
import { TEMPLATES } from "./scenarios/registry.ts";
import { newCampaign } from "./factions.ts";
import { createKessarTerrain } from "./kessar.ts";

/**
 * The three newer Kessar sites (D-034): every story point is OPEN (a body of the nav clearance stands there) and REACHABLE from the landing, with the bridge
 * intact AND with it collapsed (then everything north of the river is reached through the ford). The look is judged by geometry only: nobody has seen it.
 */
const SEED = 7;
const worldOf = (bridge: "intact" | "collapsed") => createKessarWorld(SEED, bridge);

describe("Kessar sites: story points", () => {
  for (const bridge of ["intact", "collapsed"] as const) {
    const world = worldOf(bridge);
    const q = new NavQuery(buildNavGrid(world, kessarNavOptions(world)));
    const path = newNavPath();
    const snap = { x: 0, z: 0 };

    it(`every anchor is open and reachable from the landing, bridge ${bridge}`, () => {
      const pts = kessarSitePoints();
      expect(pts.length).toBeGreaterThanOrEqual(18);
      for (const p of pts) {
        expect(q.open(p.x, p.z), `${p.id} (${p.x}, ${p.z}) open`).toBe(true);
        expect(q.path(A.landing.x, A.landing.z, p.x, p.z, path), `${p.id} reachable`).toBe(true);
        expect(path.complete, `${p.id} complete path`).toBe(true);
        // (the Stone itself stands on its anchor: what matters there is that you can stand beside it)
        const stone = p.id === "border.marker";
        const probe = stone ? { x: p.x + 1.4, z: p.z } : { x: p.x, z: p.z };
        expect(world.resolveXZ(probe, world.terrainHeight(probe.x, probe.z), NAV.clearance, 1.7), `${p.id} not inside anything`).toBe(false);
      }
    });

    it(`the cast's own spots are open too: patrol route, late-group posts, the story coordinates of the templates, bridge ${bridge}`, () => {
      const c = newCampaign(3);
      const spots: { id: string; x: number; z: number }[] = PATROL_ROUTE.map((p, i) => ({ id: `patrol${i}`, ...p }));
      for (const id of ["hostage_rescue", "convoy_ambush", "border_incident"] as const) {
        const def = TEMPLATES[id];
        for (let seed = 1; seed < 400; seed++) {
          const s = def.init(c, 40, seed);
          for (const sp of def.roster(c, seed, s)) if (!spots.some((x) => x.id === `${id}.${sp.id}`)) spots.push({ id: `${id}.${sp.id}`, x: sp.post.x, z: sp.post.z });
        }
        for (const [k, v] of Object.entries(def.sites ?? {})) spots.push({ id: `${id}.site.${k}`, ...v });
        for (const pr of def.props ?? []) spots.push({ id: `${id}.prop.${pr.id}`, x: pr.x, z: pr.z });
        if (def.wagon) spots.push({ id: `${id}.wagon`, x: def.wagon.at.x, z: def.wagon.at.z });
      }
      for (const p of spots) {
        expect(q.open(p.x, p.z) || (q.nearestOpen(p.x, p.z, snap) && Math.hypot(snap.x - p.x, snap.z - p.z) < 2.5), `${p.id} (${p.x}, ${p.z})`).toBe(true);
      }
      // the posts themselves are exactly open (a spawn is not nudged)
      for (const p of spots.filter((x) => /\.(deserter|lookout|ward|rival|post|guard|driver|hostage)-?\d*$/.test(x.id))) expect(q.open(p.x, p.z), `${p.id}`).toBe(true);
    });

    it(`the convoy route is walkable end to end, bridge ${bridge}`, () => {
      const R = S.convoy.route;
      for (let i = 0; i + 1 < R.length; i++) {
        expect(q.path(R[i]!.x, R[i]!.z, R[i + 1]!.x, R[i + 1]!.z, path), `leg ${i}`).toBe(true);
        expect(path.complete).toBe(true);
        // no leg detours: the path is within 1.6x the straight line
        let len = 0;
        for (let k = 1; k < path.n; k++) len += Math.hypot(path.x[k]! - path.x[k - 1]!, path.z[k]! - path.z[k - 1]!);
        expect(len, `leg ${i} straightness`).toBeLessThan(Math.hypot(R[i + 1]!.x - R[i]!.x, R[i + 1]!.z - R[i]!.z) * 1.6 + 4);
      }
      expect(q.path(PATROL_ROUTE[0]!.x, PATROL_ROUTE[0]!.z, PATROL_ROUTE[PATROL_ROUTE.length - 1]!.x, PATROL_ROUTE[PATROL_ROUTE.length - 1]!.z, path)).toBe(true);
    });

    it(`the hostage can be walked from the cage to the landing dock, bridge ${bridge}`, () => {
      expect(q.path(S.hostage.cage.x, S.hostage.cage.z, A.landing.x, A.landing.z - 4, path)).toBe(true);
      expect(path.complete).toBe(true);
      expect(q.path(S.border.marker.x, S.border.marker.z, A.landing.x, A.landing.z - 4, path)).toBe(true);
    });
  }
});

describe("Kessar sites: geometry", () => {
  const plan = kessarPlan();
  it("the plan carries the sites without moving anything that was there", () => {
    expect(plan.sites.camp.tents).toHaveLength(3);
    expect(plan.sites.camp.posts).toHaveLength(4);
    expect(plan.sites.ford.flags.map((f) => f.kind).sort()).toEqual(["syndicate", "ward"]);
    expect(plan.sites.camp.wagon.z).toBeLessThan(S.hostage.cage.z);   // the cage is the wagon's door, not inside it
    expect(plan.sites.cut.x).toBe(S.convoy.cut.x);
    expect(plan.cart).toEqual({ x: 14, z: 44, yaw: 0.35 });
    expect(plan.camp.wagon).toEqual({ x: -26, z: 50.4, yaw: -0.5 });   // (D-038: moved 3.5 m north, off the worn track into the camp)
  });

  it("the obstacles the sites add are solid, near the sites, and never on a story point", () => {
    const terrain = createKessarTerrain(SEED);
    const withSites = kessarObstacles(terrain, SEED, "intact");
    const tagged = withSites.filter((o) => (o.tag === "tent" || o.tag === "cart" || o.tag === "fire" || o.tag === "flag" || o.tag === "ruin") && o.x > 30 && o.z < 34 && o.z > -40);
    expect(tagged.length).toBeGreaterThanOrEqual(8);
    for (const p of kessarSitePoints()) {
      for (const o of withSites) {
        if (p.id === "border.marker" && o.tag === "ruin" && o.x === p.x && o.z === p.z) continue;   // the Stone itself
        const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
        expect(Math.hypot(o.x - p.x, o.z - p.z), `${p.id} vs ${o.tag} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)})`).toBeGreaterThan(Math.min(r, 1.2) * 0.9);
      }
    }
  });

  it("is deterministic, and a collapsed world differs from an intact one only at the bridge", () => {
    const t = createKessarTerrain(SEED);
    expect(kessarObstacles(t, SEED, "intact")).toEqual(kessarObstacles(t, SEED, "intact"));
    const a = kessarObstacles(t, SEED, "intact"), b = kessarObstacles(t, SEED, "collapsed");
    const far = (o: { x: number; z: number }): boolean => Math.hypot(o.x - A.bridge.x, o.z - A.bridge.z) > 14 && Math.abs(o.x - A.bridge.x) > 8;
    expect(a.filter(far)).toEqual(b.filter(far));
    expect(KESSAR.level).toBeGreaterThan(0);
  });
});
