import { createRegionWorld, regionProps, regionSpawn } from "./regions.ts";
import type { RegionId } from "./campaignTypes.ts";
import type { CollisionWorld, Obstacle } from "./collision.ts";
import { auditPropsFromSpawns, type AuditDoor, type AuditFootprint, type AuditKind, type AuditPoint, type AuditRoute, type AuditAllowance, type RegionAuditAdapters, type RegionAuditInput } from "./levelAudit.ts";
import { frameToWorld, insideBuilding, type RegionLevel } from "./levelPlan.ts";
import { KESSAR_ANCHORS } from "./campaignTypes.ts";
import { CAMP, hqPlan } from "./camp.ts";
import { createArena, spawnPoint } from "./arena.ts";
import { HILL, JETTY, TRAILS } from "./landscape.ts";
import { hqRoute } from "./hqRoute.ts";
import { WELL } from "./clearing.ts";
import { SITES, villageLevel } from "./village.ts";
import { HIGHMARK_TRACKS, highmarkLevel, highmarkPlan, highmarkRoad, highmarkSitePoints, hillPoint } from "./highmark.ts";
import { kessarLevel, kessarPlan, kessarSitePoints } from "./kessar.ts";
import { CLOISTER, VESPER_ANCHORS, vesperLevel, vesperPlan, vesperRoad, vesperSitePoints, vesperTracks } from "./vesper.ts";
import { SALTMARKET_ANCHORS, saltmarketLevel, saltmarketPlan, saltmarketSitePoints } from "./saltmarket.ts";

/**
 * THE FIVE REGION ADAPTERS (D-038, docs/LEVEL_PLAN.md section 9). Each turns a region's own plan (the same pure data the collision, the view and the nav read) into the audit's
 * `RegionAuditInput`: footprints grouped into buildings, the declared doors and rooms, the story points, the routes, the spawn rings and the props. `levelAuditRegions.test.ts` runs every
 * adapter over `AUDIT_SEEDS` and fails on any error beyond `ALLOWANCE` (a ratchet that only goes down: the end state is `{}` everywhere).
 *
 * INTEGRATOR: `export * from "./levelAuditAdapters.ts"` in index.ts (nothing else here is needed by the client).
 */

/** The ratchet: errors the audit may still report per region (finding kind -> count). Lowered to `{}` as the plan is built; raising it needs a line in BUILD_STATE and D-038's addendum. */
export const ALLOWANCE: Record<RegionId, AuditAllowance> = {
  hollowmere: {},
  kessar: {},
  highmark: {},
  vesper: {},
  saltmarket: {},
};

// ---- shared helpers -----------------------------------------------------------------------------------------------------------------------------

const KIND_OF_TAG: Partial<Record<NonNullable<Obstacle["tag"]>, AuditKind>> = {
  house: "building", wall: "wall", fence: "fence", jetty: "deck", bridge: "deck", sign: "sign", flag: "banner-post", pole: "prop", tent: "tent", stall: "stall",
  tree: "natural", rock: "natural", snag: "natural", stump: "natural", log: "natural", cliff: "natural", crate: "prop", cart: "prop", table: "furniture", fire: "prop", ruin: "wall", well: "furniture", vprop: "prop",
};

/** `undefined`: its own footprint; `null`: not a footprint at all (collision scaffolding). */
type Grouping = { id: string; group: string; kind?: AuditKind } | undefined | null;

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** The group a building's own solids (walls, deck, steps, landing) belong to. */
function buildingGroup(level: RegionLevel, o: Obstacle, m = 0.5): string | undefined {
  for (const b of level.buildings) if (insideBuilding(b, o.x, o.z, m, 1.8)) return b.id;
  return undefined;
}

function footprints(world: CollisionWorld, group: (o: Obstacle, i: number) => Grouping): AuditFootprint[] {
  const out: AuditFootprint[] = [];
  world.obstacles.forEach((o, i) => {
    const g = group(o, i);
    if (g === null) return;
    const tag = o.tag ?? (o.kind === "circle" && o.y1 - o.y0 > 5 ? "tree" : "rock");
    out.push({ id: g?.id ?? `${tag}@${r1(o.x)},${r1(o.z)}#${i}`, group: g?.group ?? `solo${i}`, kind: g?.kind ?? KIND_OF_TAG[tag] ?? "prop", shape: o });
  });
  return out;
}

function spawnsOf(region: RegionId): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let n = 1; n <= 4; n++) for (let i = 0; i < n; i++) out.push(regionSpawn(region, i, n));
  return out;
}

interface Parts {
  region: RegionId;
  seed: number;
  world: CollisionWorld;
  group: (o: Obstacle, i: number) => Grouping;
  doors: readonly AuditDoor[];
  points: readonly AuditPoint[];
  routes: readonly AuditRoute[];
  allowOverlap?: RegionAuditInput["allowOverlap"];
}

/** The doors with the absolute height of the floor each opens from: the terrain under the building's centre (its pad) plus the plan's floor height. */
function withFloors(world: CollisionWorld, level: RegionLevel, doors: readonly AuditDoor[] = level.doors): AuditDoor[] {
  return doors.map((d) => {
    const b = level.buildings.find((x) => x.id === d.building);
    return b ? { ...d, floorY: world.terrainHeight(b.x, b.z) + b.floor } : d;
  });
}

function assemble(p: Parts): RegionAuditInput {
  return {
    region: p.region,
    seed: p.seed,
    world: p.world,
    footprints: footprints(p.world, p.group),
    doors: p.doors,
    points: p.points,
    routes: p.routes,
    props: auditPropsFromSpawns(regionProps(p.region, p.seed, p.world)),
    spawns: spawnsOf(p.region),
    allowOverlap: p.allowOverlap,
  };
}

const pts = (list: readonly { id: string; x: number; z: number }[], not: readonly string[] = []): AuditPoint[] => list.map((p) => ({ id: p.id, x: p.x, z: p.z, mustReach: !not.includes(p.id) }));
const route = (id: string, cls: AuditRoute["class"], points: readonly { x: number; z: number }[], minWidth?: number): AuditRoute => ({ id, class: cls, points, minWidth });

// ---- Saltmarket ---------------------------------------------------------------------------------------------------------------------------------

export function saltmarketAdapter(seed: number): RegionAuditInput {
  const world = createRegionWorld("saltmarket", seed);
  const plan = saltmarketPlan();
  const level = saltmarketLevel();
  const ex = plan.exchange;
  const A = SALTMARKET_ANCHORS;
  const inRect = (o: Obstacle, cx: number, cz: number, hx: number, hz: number): boolean => Math.abs(o.x - cx) <= hx && Math.abs(o.z - cz) <= hz;
  const group = (o: Obstacle): Grouping => {
    const t = o.tag;
    if (t === "house") return { id: `bldg@${r1(o.x)},${r1(o.z)}`, group: buildingGroup(level, o) ?? `solo-${r1(o.x)},${r1(o.z)}`, kind: "building" };
    if (t === "fence") return { id: `revet@${r1(o.x)},${r1(o.z)}`, group: "revetment" };
    for (const b of plan.bridges) {
      const hx = b.yaw === 0 ? 3.0 : b.hl + 0.4;
      const hz = b.yaw === 0 ? b.hl + 0.4 : 3.0;
      if ((t === "bridge" || t === "wall") && inRect(o, b.x, b.z, hx, hz)) return { id: `${b.id}.${t}@${r1(o.x)},${r1(o.z)}`, group: `bridge:${b.id}` };
    }
    if ((t === "jetty" || t === "pole") && Math.abs(o.x) < 4 && o.z > 119 && o.z < 135) return { id: `quay@${r1(o.x)},${r1(o.z)}`, group: "quay" };
    if (t === "jetty") return { id: `pier@${r1(o.x)},${r1(o.z)}`, group: "covePier" };
    if ((t === "ruin" || t === "wall" || t === "table") && inRect(o, ex.x, ex.z, ex.hx + 1, ex.hz + 3)) return { id: `exchange.${t}@${r1(o.x)},${r1(o.z)}`, group: "exchange" };
    return undefined;
  };
  const routes: AuditRoute[] = [
    route("board.main", "street", plan.boardwalks[0]!.pts.filter((p) => p.z > 12)),
    route("board.cove", "street", plan.boardwalks[1]!.pts),
    route("board.drop", "street", plan.boardwalks[2]!.pts),
    route("board.customs", "street", plan.boardwalks[3]!.pts),
    route("board.customsDoor", "street", plan.boardwalks[4]!.pts),
    route("board.shedW", "street", plan.boardwalks[5]!.pts),
    route("board.shedE", "street", plan.boardwalks[6]!.pts),
  ];
  void A;
  return assemble({
    region: "saltmarket", seed, world, group,
    doors: withFloors(world, level),
    points: pts(saltmarketSitePoints()),
    routes,
    // (a bridge's parapet ends in the revetment's pilings: a joint, not an overlap you could see or bump)
    allowOverlap: [["revetment", "bridge:customsBridge"], ["revetment", "bridge:coveBridge"], ["revetment", "bridge:reedBridge"]],
  });
}

// ---- Kessar -------------------------------------------------------------------------------------------------------------------------------------

export function kessarAdapter(seed: number): RegionAuditInput {
  const world = createRegionWorld("kessar", seed);
  const plan = kessarPlan();
  const level = kessarLevel();
  const A = KESSAR_ANCHORS;
  const F = plan.fort;
  const group = (o: Obstacle): Grouping => {
    const t = o.tag;
    const d = Math.hypot(o.x - F.x, o.z - F.z);
    for (const b of level.buildings) if (b.kind === "tent" && Math.abs(b.x - o.x) < 0.01 && Math.abs(b.z - o.z) < 0.01) return { id: b.id, group: b.id, kind: "tent" };
    if (t === "wall" && o.x === F.door.x && o.z === F.door.z) return { id: "fort.gate", group: "fort.gate", kind: "gate" };
    // the curtain, its four towers and the two bastions are ONE structure (towers stand in the wall; the bastions flank the gate)
    if ((t === "wall" || t === "ruin" || t === "house") && d > 17 && d < 27) return { id: `fort@${r1(o.x)},${r1(o.z)}`, group: "fort", kind: "wall" };
    if (t === "house") return { id: `bldg@${r1(o.x)},${r1(o.z)}`, group: buildingGroup(level, o) ?? `solo-${r1(o.x)},${r1(o.z)}`, kind: "building" };
    if (t === "wall" && o.z > 8 && o.z < 32 && Math.abs(o.x) < 4.5) return { id: `bridge.rail@${r1(o.x)},${r1(o.z)}`, group: "bridge" };
    if (t === "bridge" && Math.abs(o.x) < 4.5) return { id: `bridge@${r1(o.x)},${r1(o.z)}`, group: "bridge" };
    if (t === "wall") return { id: `rim@${r1(o.x)},${r1(o.z)}`, group: "rim", kind: "fence" };
    return undefined;
  };
  const routes: AuditRoute[] = [
    route("road.main", "road", [A.landing, { x: 0, z: 40 }, { x: 0, z: 31 }, { x: 0, z: 9 }, { x: 0, z: -30 }]),
    // the worn tracks kessar.ts paints (ROADS): the branch to the Syndicate's camp, and the south-bank track to the ford landing and into the ford
    route("road.camp", "street", [{ x: 0, z: 74 }, { x: -20, z: 60 }, A.rivalCamp]),
    route("road.ford", "street", [{ x: 0, z: 38 }, { x: 24, z: 37 }, { x: 46, z: 35 }, { x: 46, z: 23.5 }]),
  ];
  const sites = [
    { id: "landing", ...A.landing }, { id: "tollBar", ...A.tollBar }, { id: "wardenPost", ...A.wardenPost }, { id: "pier", ...A.pier }, ...A.sentries.map((s, i) => ({ id: `sentry${i}`, x: s.x, z: s.z })),
    { id: "ford", ...A.ford }, { id: "fort.gate", ...A.fort.gate }, { id: "rivalCamp", ...A.rivalCamp }, { id: "rivalParley", ...A.rivalParley }, { id: "powder", ...A.powder },
    ...kessarSitePoints(),
    // the fort's courtyard is inside the sealed curtain (drawn, not enterable): not a place anybody must reach
    { id: "A.fort", x: A.fort.x, z: A.fort.z },
  ];
  // (the bridge's parapets end in the rim wall along the gorge: a joint)
  return assemble({ region: "kessar", seed, world, group, doors: withFloors(world, level), points: pts(sites, ["A.fort"]), routes, allowOverlap: [["bridge", "rim"]] });
}

// ---- Highmark -----------------------------------------------------------------------------------------------------------------------------------

export function highmarkAdapter(seed: number): RegionAuditInput {
  const world = createRegionWorld("highmark", seed);
  const plan = highmarkPlan();
  const level = highmarkLevel();
  const g = plan.gate;
  const near = (o: Obstacle, list: readonly { x: number; z: number }[], d: number): number => list.findIndex((p) => Math.hypot(p.x - o.x, p.z - o.z) < d);
  const group = (o: Obstacle): Grouping => {
    const t = o.tag;
    if ((t === "house" || t === "wall") && Math.abs(o.z - g.z) < 4.5 && Math.abs(o.x) < 10) return { id: `gate@${r1(o.x)},${r1(o.z)}`, group: "gate", kind: "gate" };
    if (t === "wall") return { id: `terrace@${r1(o.x)},${r1(o.z)}`, group: "terraces", kind: "wall" };
    if (t === "house") return { id: `bldg@${r1(o.x)},${r1(o.z)}`, group: buildingGroup(level, o) ?? `solo-${r1(o.x)},${r1(o.z)}`, kind: "building" };
    if (t === "stall" || t === "pole") {
      const i = near(o, plan.stalls, 2.4);
      if (i >= 0) return { id: `stall${i}@${r1(o.x)},${r1(o.z)}`, group: `stall${i}`, kind: "stall" };
    }
    return undefined;
  };
  const A = plan;
  const routes: AuditRoute[] = [
    route("road.processional", "road", highmarkRoad()),
    // the Grange waits on the granary terrace: up the first ramp (south), then round the terrace's arc westward
    route("road.grange", "street", [{ x: 0, z: -14 }, { x: 0, z: -29 }, hillPoint(68, -8), hillPoint(68, -20), hillPoint(67.6, -33), { x: -37, z: -40 }]),
    route("road.envoy", "street", [{ x: 28.7, z: -31.6 }, { x: 31, z: -39 }]),
    // (the Waiting Stones stand in a row at x -8.6: the track threads the gap between the second and third)
    route("road.drovers", "track", HIGHMARK_TRACKS[0]!),
  ];
  // (the gatehouse is built into the court terrace's retaining wall: its towers stand in it)
  return assemble({ region: "highmark", seed, world, group, doors: withFloors(world, level), points: pts(highmarkSitePoints()), routes, allowOverlap: [["gate", "terraces"]] });
}

// ---- Vesper -------------------------------------------------------------------------------------------------------------------------------------

export function vesperAdapter(seed: number): RegionAuditInput {
  const world = createRegionWorld("vesper", seed);
  const plan = vesperPlan();
  const level = vesperLevel();
  const C = CLOISTER;
  const group = (o: Obstacle): Grouping => {
    const t = o.tag;
    if (t === "house") {
      const rec = level.buildings.find((b) => b.id === "records")!;
      const own = insideBuilding(rec, o.x, o.z, 0.2) ? "records" : buildingGroup(level, o, 0.2);
      if (own && own !== "cloister") return { id: `bldg@${r1(o.x)},${r1(o.z)}`, group: own, kind: "building" };
      if (o.x > -54 && o.x < -41.5 && o.z > 25 && o.z < 63) return { id: `cloister@${r1(o.x)},${r1(o.z)}`, group: "cloister", kind: "building" };
      return { id: `bldg@${r1(o.x)},${r1(o.z)}`, group: own ?? `solo-${r1(o.x)},${r1(o.z)}`, kind: "building" };
    }
    // the terrace's, the ledge's and the ramp's edge walls, and the cliffs' toe walls, are chains of overlapping segments: one structure each
    // the trestle: the deck and its two rails and its piles are one structure
    if ((t === "wall" || t === "pole") && Math.abs(o.z - plan.trestle.z) < 3 && o.x > plan.trestle.x0 - 1 && o.x < 20) return { id: `trestle@${r1(o.x)},${r1(o.z)}`, group: "trestle", kind: "deck" };
    // the terrace's, the ledge's and the ramp's edge walls are chains of overlapping segments: one structure
    if (t === "wall") return { id: `edge@${r1(o.x)},${r1(o.z)}`, group: "edges", kind: "wall" };
    // (the cliffs' toe walls are collision scaffolding buried in the rock, not authored solids: buildings are held to level ground by `padFlatness` instead)
    if (t === "cliff") return null;
    return undefined;
  };
  const gallery = Array.from({ length: C.arches }, (_, i) => ({ id: `arch${i}`, x: i === 0 ? (C.pierIn + C.frontX) / 2 : (C.backX + C.pierIn) / 2, z: 26 + C.pierW + C.archClear / 2 + i * (C.pierW + C.archClear) }));
  const sites = [...vesperSitePoints(), ...gallery, { id: "gallery.south", x: (C.backX + C.pierIn) / 2, z: 60.5 }];
  const routes: AuditRoute[] = [
    route("road.ore", "road", vesperRoad()),
    route("track.assay", "track", [{ x: vesperTracks()[0]!.ax, z: vesperTracks()[0]!.az }, { x: vesperTracks()[0]!.bx, z: vesperTracks()[0]!.bz }]),
    route("track.cloister", "street", [{ x: vesperTracks()[1]!.ax, z: vesperTracks()[1]!.az }, { x: vesperTracks()[1]!.bx, z: vesperTracks()[1]!.bz }]),
    route("track.pegging", "track", [{ x: vesperTracks()[2]!.ax, z: vesperTracks()[2]!.az }, { x: vesperTracks()[2]!.bx, z: vesperTracks()[2]!.bz }]),
    route("trestle", "street", [{ x: 18, z: plan.trestle.z }, { x: plan.trestle.x0 + 1, z: plan.trestle.z }], 2.4),
  ];
  // (the pocket behind the rock fall is sealed until the mine-rescue template clears it)
  return assemble({ region: "vesper", seed, world, group, doors: withFloors(world, level), points: pts(sites, ["miners0", "miners1", "miners2"]), routes });
}

// ---- Hollowmere (the hub) -----------------------------------------------------------------------------------------------------------------------

/** A painted trail as a route: every 4th point (every 2nd for the hill's climb) of its smoothed line, stopping at `maxR` metres from the origin (the map's edge fades out). */
const trail = (name: string, maxR = Infinity, every = 8): { x: number; z: number }[] => {
  const t = TRAILS.find((x) => x.name === name)!;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < t.line.length; i += every) {
    const r = Math.hypot(t.line[i]!, t.line[i + 1]!);
    if (r > maxR) break;
    if (r > 88.6) continue;   // (the hill's climb swings out past the playable disc at the far side: the walkable line is the one inside it)
    out.push({ x: t.line[i]!, z: t.line[i + 1]! });
  }
  return out;
};

export function hollowmereAdapter(seed: number): RegionAuditInput {
  const world = createRegionWorld("hollowmere", seed);
  const level = villageLevel();
  const hq = hqPlan().marquee;
  const gate = SITES.find((s) => s.kind === "clock")!;
  const inHq = (o: Obstacle): boolean => o.x > hq.x - hq.hx - 1.6 && o.x < hq.x + hq.hx + 1.6 && o.z > hq.z - hq.hz - 1.2 && o.z < hq.z + hq.hz + 1.2;
  const ruins = world.obstacles.filter((o) => o.tag === "ruin");
  const ruinNear = (o: Obstacle): boolean => ruins.some((r) => Math.hypot(r.x - o.x, r.z - o.z) < 4.5);
  const group = (o: Obstacle): Grouping => {
    const t = o.tag;
    if (t === "hq" || t === "marquee") return { id: `hq.${t}@${r1(o.x)},${r1(o.z)}`, group: "hq", kind: "furniture" };
    if (inHq(o) && (t === "table" || t === "crate" || t === "pole" || t === "flag")) return { id: `hq.${t}@${r1(o.x)},${r1(o.z)}`, group: "hq", kind: "furniture" };
    if (t === "ruin") return { id: `ruin@${r1(o.x)},${r1(o.z)}`, group: "observatory", kind: "wall" };
    // (boulders tumbled against the ruin's wall are part of the ruin)
    if ((t === "rock" || t === "snag") && ruinNear(o)) return { id: `${t}@${r1(o.x)},${r1(o.z)}`, group: "observatory", kind: "natural" };
    if (t === "fence") return { id: `pen@${r1(o.x)},${r1(o.z)}`, group: "pen", kind: "fence" };
    if (t === "bridge" || (t === "wall" && o.z > -40 && o.z < -10 && o.x > 8 && o.x < 15)) return { id: `footbridge@${r1(o.x)},${r1(o.z)}`, group: "footbridge", kind: "deck" };
    if (t === "tent") return { id: `tent@${r1(o.x)},${r1(o.z)}`, group: `tent@${r1(o.x)},${r1(o.z)}`, kind: "tent" };
    // (the jetty's lantern post stands on its deck: one structure)
    if (t === "vprop" && o.kind === "circle" && o.r <= 0.1 && Math.hypot(o.x - JETTY.x0 + 0, o.z - JETTY.z0) < 5.5) return { id: `jetty.post@${r1(o.x)},${r1(o.z)}`, group: "jetty", kind: "deck" };
    if (t === "jetty") return { id: "jetty", group: "jetty", kind: "deck" };
    if (t === "vprop" && o.kind === "box" && o.hz === 0.07) return { id: `fence@${r1(o.x)},${r1(o.z)}`, group: "village.fences", kind: "fence" };
    if (t === "vprop") {
      const own = level.buildings.find((b) => b.kind === "open-front" && insideBuilding(b, o.x, o.z, -0.1));
      if (own) return { id: `${own.id}.prop@${r1(o.x)},${r1(o.z)}`, group: own.id, kind: "furniture" };
    }
    if (t === "house") {
      if (Math.hypot(o.x - gate.x, o.z - gate.z) < 3.4) return { id: `gate@${r1(o.x)},${r1(o.z)}`, group: "gate", kind: "gate" };
      const own = buildingGroup(level, o, 0.8);
      if (own) return { id: `bldg@${r1(o.x)},${r1(o.z)}`, group: own, kind: "building" };
    }
    return undefined;
  };
  const rt = hqRoute();
  const A = CAMP;
  const sites = [
    { id: "mapTable", x: A.mapTable.x + 1.2, z: A.mapTable.z + 1.4 }, { id: "fire", x: A.fire.x - 1.4, z: A.fire.z }, { id: "notice", x: hqPlan().notice.x + 1.4, z: hqPlan().notice.z + 1.4 },
    { id: "jetty", x: JETTY.x0, z: JETTY.z0 }, { id: "well", x: WELL.x + 1.6, z: WELL.z }, { id: "hall.steps", x: -21, z: -58.5 }, { id: "observatory.steps", x: HILL.x - 3, z: HILL.z + 9.5 },
    { id: "gate.far", x: 6.2, z: -43.7 }, { id: "plaza", x: -21, z: -52 },
  ];
  const dock = rt.dock;
  const routes: AuditRoute[] = [
    route("hq.map", "track", rt.map),
    // the dock line: from the fire up the footbridge path, through the village street, down the ferry lane to the jetty. The footbridge (1.7 m between its rails) is the hub's one choke;
    // the ferry lane between the two stilt houses' steps is a track
    route("hq.dock.fire", "track", dock.slice(0, 4)),
    route("hq.dock.footbridge", "track", dock.slice(3, 6), 1.4),
    route("hq.dock.street", "street", dock.slice(5, 12)),
    route("hq.dock.lane", "track", [dock[11]!, { x: -21.5, z: -47.4 }, { x: -21.6, z: -42.4 }]),
    route("trail.coast", "track", trail("coast", 82)),
    // (the climb of the Observatory hill is a wild desire line through the arena's seeded rocks and crags, which `createArena` places by centre distance only: it is walked by the 20-seed run, not audited as a route)
    route("trail.village", "street", trail("village")),
  ];
  const doors = withFloors(world, level);
  void spawnPoint; void createArena;
  return assemble({ region: "hollowmere", seed, world, group, doors, points: pts(sites), routes });
}

// ---- the registry -------------------------------------------------------------------------------------------------------------------------------

const notYet = (region: RegionId) => (seed: number): RegionAuditInput => assemble({ region, seed, world: createRegionWorld(region, seed), group: () => undefined, doors: [], points: [], routes: [] });

export const LEVEL_ADAPTERS: RegionAuditAdapters = {
  hollowmere: hollowmereAdapter,
  kessar: kessarAdapter,
  highmark: highmarkAdapter,
  vesper: vesperAdapter,
  saltmarket: saltmarketAdapter,
};

export { frameToWorld };
