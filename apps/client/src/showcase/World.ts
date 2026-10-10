import { Vector3 } from "three";
import { OUTPOST_STAGES, isRegionId, TEMPLATE_RESOLUTIONS, PropKind, PROP_DEFS, VESPER_TRIG, type PropKindId, applyOutcome, deliverTo, historyPieces, newCampaign, newSettlements, newTech, type OutpostStage, type ScenarioTemplateId, standingHeight, CAMP, FLAG, HILL, JETTY, MILL, PEN, WELL, classifyObstacle, createArena, getBridge, getWayposts, ruinPlan, spawnPoint, villagePlan } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter } from "@cb/procedural/three";
import { PropViews } from "../render/PropViews.ts";
import { PRESETS, Stage } from "../render/Stage.ts";
import { createRegionView, type RegionView } from "../render/world/regionView.ts";
import { KESSAR_OUTPOST as KO, crankSpot } from "@cb/shared";
import { CrankGunView } from "../render/weapons/CrankGunView.ts";
import { KESSAR_ANCHORS as KA, createRegionWorld, regionProps, regionSpawn, type RegionId } from "../render/world/kessar/shared.ts";
import { folkHints } from "../render/world/villagers.ts";
import { SALTMARKET_DEFAULT_VIEW, saltmarketViews } from "./saltmarket.ts";
import { VESPER_DEFAULT_VIEW, vesperViews } from "./vesper.ts";

/**
 * World review scene (`?showcase=world`): the real arena (same seed -> same layout as the game) with a few figures for scale and
 * the server's scattered props, seen from named vantage points. Deterministic stills; never a perf number (software GL).
 *   view=game|camp|tents|fire|flag|sign|wall|cart|luggage|crates|props|tree|rock|snag|edge|hills|sky   (default game)
 *   view=table|scope|gramophone|wash|hammock|lanterns|ruin|tower|colonnade|aqueduct|ford|pond|source|meadow|trail|stump|log|far   (the environment upgrade)
 *   view=well|pen|bridge|waypost|door|inside|dome|refractor|flock   (the clearing's furniture, and the Observatory's doorway, dark room, dome and great telescope)
 *   view=village|vtop|vmarket|vjetty|vweir|b-<id>   HOLLOWMERE (b-gate|b-hall|b-mill|b-shop|b-stilt-w|b-stilt-e|b-gran-a|b-gran-b|b-cot-a|b-cot-b|b-cot-c|b-stall-1); d=N sets the distance, a=N the angle
 *   time=13|dusk|night|17.5|...   the hour (see shared/daycycle.ts); without it the day drifts
 *   weather=clear|overcast|rain|storm|fog|dust   force a weather state at full strength (lightning in a storm); wms=N&wseed=S sits the schedule at N ms
 *   motion=0..1   the ambient-motion preference (0 = still trees and cloth); without it prefers-reduced-motion gives 0.3
 *   drift=1    keep the clock running after ?time=
 *   push=x,z;x,z   up to four invisible walkers the grass bends away from (the figures are pushers too)
 *   i=N        which tree/rock/snag for view=tree|rock|snag
 *   region=kessar   KESSAR REACH (the colony region) instead of Hollowmere: view=landing|pier|bridge|underbridge|gate|fort|ford|toll|camp|powder|rim|top|fortfar|boat, bridge=collapsed (the span down)
 *   region=highmark HIGHMARK (D-036; the savannah and its hill-capital): view=landing|road|grass|herds|waiting|foot|terraces|granary|market|ramp|gate|window|court|throne|palace|capital|capitalfar|plateau|top|quay|camp
 *     (time=dusk is the harvest bell hour: the lamps burn); herds are a function of seed and the world clock (wms=N sits it)
 *   region=vesper   VESPER GORGE (D-037; the canyon and its mine): the vantage points are package C3's (showcase/vesper.ts)
 *   region=saltmarket   THE SALTMARKET DELTA (D-037; the channels and the Exchange): the vantage points are package D4's (showcase/saltmarket.ts)
 *   outpost=none|camp|trading_post|fortified_outpost|settlement|town [&telegraph=1&road=0|1|2&launch=1&rivalpost=0|1|2]   (region=kessar, view=outpost|rivalpost|wire|landing) THE SOCIETY'S OUTPOST (D-035)
 *   history=N [&outpost=<stage>]   (view=table|game, Hollowmere) HQ keeps the first N endings of a scripted campaign on the planning table, the strongbox and the back wall
 *   seed=N     arena seed (default 7)
 *   cam=x,y,z&at=x,y,z   explicit camera and target (metres)
 *   viewer=x,z|none   D-038: where the cutaway thinks the player is (default: under the camera); a room's roof is lifted while the viewer is inside it
 *   fov=N      vertical field of view (default 65 like the game)
 *   gfx=low|medium|high
 *   view=folk|folkplaza|folkgate|folkmill|folkjetty|folkwell   HOLLOWMERE'S FOLK (the village at `time=`; try weather=drizzle). who=<id|trade> follows one villager (wd=metres away, wa=angle round them,
 *     wh=camera height, wl=look-at height); tags=1 shows name tags and speech slips; drift=1 lets the day run; the four spawn figures are hidden in these views
 *   figures=0  hide the figures
 *   props=0    no props (world-only draw-call and triangle counts)
 *   propline=1 one crate, barrel, bottle and chair in a row at (0, -3) instead of the scatter
 */
export function runWorld(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new Stage(canvas, (params.get("gfx") as import("../render/Stage.ts").PresetName | null) ?? "medium");
  const seed = Number(params.get("seed") ?? 7);
  const regionParam = params.get("region");
  const region: RegionId = isRegionId(regionParam) ? regionParam : "hollowmere";   // (D-037: every region id of the contract, dev starts included)
  // D-035: the Society's outpost and what comes of it. outpost=none|camp|trading_post|fortified_outpost|settlement|town, telegraph=1, road=0|1|2, launch=1, rivalpost=0|1|2
  // (D-091: railway=1 the railhead at Kessar's post, works=1 the works beside a post at Kessar or Highmark)
  const stageParam = params.get("outpost");
  const outpost: OutpostStage = (OUTPOST_STAGES as readonly string[]).includes(stageParam ?? "") ? (stageParam as OutpostStage) : "none";
  const telegraph = params.get("telegraph") === "1" && outpost !== "none";
  const railway = params.get("railway") === "1" && outpost !== "none" && region === "kessar";
  const worksOn = params.get("works") === "1" && outpost !== "none";
  // (D-092: crank=1 the crank gun inside a fortified post's gate, drawn as the game draws the replicated fixture, its barrels on the gate)
  const crankOn = params.get("crank") === "1" && (OUTPOST_STAGES as readonly string[]).indexOf(outpost) >= OUTPOST_STAGES.indexOf("fortified_outpost") && (region === "kessar" || region === "highmark");
  const world = region === "kessar" ? createRegionWorld("kessar", seed, { bridge: params.get("bridge") === "collapsed" ? "collapsed" : "intact", outpost, telegraph, railway, works: worksOn, crank: crankOn })
    : region === "hollowmere" ? createArena(seed) : region === "highmark" ? createRegionWorld(region, seed, { outpost, works: worksOn, crank: crankOn }) : createRegionWorld(region, seed);
  const crankAt = crankOn ? crankSpot(region as RegionId) : undefined;
  if (crankAt) {
    const gun = new CrankGunView(stage.scene, stage.outlines);
    gun.update(0, { x: crankAt.x, y: world.terrainHeight(crankAt.x, crankAt.z), z: crankAt.z, yaw: crankAt.yaw + Number(params.get("traverse") ?? 0), elev: 0.08, phase: 2, progress: 40, crew: 0, shells: 3, fired: 0, kind: 1 } as never);
  }
  if (region === "highmark" || region === "vesper" || region === "saltmarket") {
    const inner = stage as unknown as { worldView?: RegionView; builtFor?: typeof world; lightDir: Vector3 };
    inner.builtFor = world;
    inner.worldView = createRegionView(region, stage.scene, world, PRESETS[(params.get("gfx") as keyof typeof PRESETS | null) ?? "medium"], inner.lightDir, seed);
    if (region === "highmark" && outpost !== "none") inner.worldView.applyDress?.({ outpost, rivalPost: 0, road: 0, telegraph: false, launch: false, name: "Quim's Rest", ...(worksOn ? { works: true } : {}) });
  } else if (region === "kessar") {
    // (the Stage builds Hollowmere's WorldView itself; until it builds through createRegionView, the region's own view is handed to it here)
    const inner = stage as unknown as { worldView?: RegionView; builtFor?: typeof world; lightDir: Vector3 };
    inner.builtFor = world;
    inner.worldView = createRegionView("kessar", stage.scene, world, PRESETS[(params.get("gfx") as keyof typeof PRESETS | null) ?? "medium"], inner.lightDir);
    inner.worldView.applyDress?.({
      outpost, rivalPost: Math.min(2, Math.max(0, Number(params.get("rivalpost") ?? 0))) as 0 | 1 | 2, road: Math.min(2, Math.max(0, Number(params.get("road") ?? 0))) as 0 | 1 | 2,
      telegraph, launch: params.get("launch") === "1", name: "Quim's Rest", ...(railway ? { railway: true } : {}), ...(worksOn ? { works: true } : {}),
    });
  } else {
    stage.buildWorld(world);
    // history=N: HQ keeps what the campaign has done (the first N endings of a scripted run), on the planning table, the strongbox and the back wall
    const n = Math.min(12, Math.max(0, Number(params.get("history") ?? 0)));
    if (n > 0) {
      const order = ["forced", "sabotaged", "seized", "rescued", "paid", "mediated", "burned", "bribed", "sided_ward", "provoked", "ransomed", "passed"] as const;
      const t = (r: string): ScenarioTemplateId => (Object.keys(TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[]).find((k) => (TEMPLATE_RESOLUTIONS[k] as readonly string[]).includes(r)) ?? "secure_crossing";
      let c = newCampaign(seed);
      for (const r of order.slice(0, n)) c = applyOutcome(c, { scenario: t(r), resolution: r, toll: 30, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
      let s = newSettlements();
      if (outpost !== "none") {
        for (let i = 0; i < 4; i++) s = deliverTo(s, "kessar", PropKind.CRATE, c, 1).s;
        s = { ...s, posts: { kessar: { ...s.posts.kessar!, stage: outpost } }, tech: { ...newTech(), road: Number(params.get("road") ?? 0) as 0 | 1 | 2, telegraph, launch: params.get("launch") === "1", railway, works: worksOn ? "kessar" : "", since: { ...newTech().since, road: 1, telegraph: 1, launch: 1, railway: 1, works: 1 } } };
      }
      stage.setHistory(historyPieces(c, s));
    }
  }

  const props = new PropViews(stage.scene, stage.outlines);
  const line = params.get("propline") === "1"; // one of each kind in a row, for reviewing the props
  const kinds = Object.keys(PROP_DEFS).map(Number) as PropKindId[];
  const spawns = params.get("props") === "0" ? [] : line ? kinds.map((k, i) => ({ kind: k, x: -0.3 * (kinds.length - 1) + i * 0.6, z: -3, yaw: 0.6 })) : regionProps(region, seed, world);
  // D-096: with the Triangulation's dress asked for (`trig=`), the theodolite in its case where the contract puts it, beside the landing's ore crates
  if (region === "vesper" && params.has("trig") && params.get("props") !== "0") spawns.push({ kind: PropKind.INSTRUMENT, x: VESPER_TRIG.theodolite.x, z: VESPER_TRIG.theodolite.z, yaw: 0.5 });
  // (each rests on its own half-height: a capsule's is its cylinder's plus its cap)
  const rest = (k: PropKindId): number => (PROP_DEFS[k].shape === "capsule" ? PROP_DEFS[k].half[1] + PROP_DEFS[k].half[0] : PROP_DEFS[k].half[1]);
  const fake = spawns.map((s, i) => ({ id: String(i), kind: s.kind, x: s.x, y: world.terrainHeight(s.x, s.z) + rest(s.kind as PropKindId) + ((s as { up?: number }).up ?? 0), z: s.z, yaw: s.yaw }));
  const byId = new Map(fake.map((p) => [p.id, p]));
  const syncProps = (): void =>
    props.sync({ forEach: (cb) => fake.forEach((p) => cb({ kind: p.kind, id: p.id } as never, p.id)) }, (p, f) => {
      const src = byId.get((p as unknown as { id: string }).id)!;
      switch (f) {
        case "x":
          return src.x;
        case "y":
          return src.y;
        case "z":
          return src.z;
        case "qy":
          return Math.sin(src.yaw / 2);
        case "qw":
          return Math.cos(src.yaw / 2);
        default:
          return 0;
      }
    });
  syncProps();

  // (the animator rewrites `root.position.y` with its own offset on every update, as CharacterActor knows: the ground is added back after it, or a figure on ground above 0 stands sunk in it. That was the
  // 'lineup figures sunk to the chest in region=kessar' finding: Kessar's ground is 0.5 m up and Hollowmere's spawn is at 0)
  const anims: CharacterAnimator[] = [];
  const standY: number[] = [];
  const rigs: { root: { position: { y: number } } }[] = [];
  const folkView = (params.get("view") ?? "game").startsWith("folk") || params.get("who") !== null;
  if (params.get("figures") !== "0" && !folkView) {
    for (let i = 0; i < 4; i++) {
      const rig = buildCharacter(generateCharacter(seed * 31 + i * 7919, i), { outline: stage.outlines });
      const sp = region !== "hollowmere" ? regionSpawn(region, i, 4) : spawnPoint(i, 4);
      const gy = world.terrainHeight(sp.x, sp.z);
      rig.root.position.set(sp.x, gy, sp.z);
      rig.root.rotation.y = Math.PI + (i - 1.5) * 0.35;
      stage.scene.add(rig.root);
      const anim = new CharacterAnimator(rig);
      for (let k = 0; k < 60; k++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      rig.root.position.y += gy;
      anims.push(anim);
      standY.push(gy);
      rigs.push(rig);
    }
  }

  const vec = (s: string | null): Vector3 | undefined => {
    if (!s) return undefined;
    const [x, y, z] = s.split(",").map(Number);
    return new Vector3(x, y, z);
  };
  const tagged = (tag: string) => world.obstacles.filter((o) => classifyObstacle(o) === tag);
  const nth = (tag: string): { x: number; z: number } => {
    const list = tagged(tag);
    return list[Number(params.get("i") ?? 0) % Math.max(1, list.length)] ?? { x: 20, z: 20 };
  };
  const hy = world.terrainHeight(HILL.x, HILL.z);
  const plan = ruinPlan(world.terrain);
  const towerAt = (a: number, r: number, y: number): Vector3 => new Vector3(plan.tower.x + Math.cos(plan.yaw + a) * r, plan.level + y, plan.tower.z + Math.sin(plan.yaw + a) * r);
  const bridgeMid = getBridge().segments[Math.floor(getBridge().segments.length / 2)]!;
  const post = getWayposts()[0]!;
  const views: Record<string, [Vector3, Vector3]> = {
    game: [new Vector3(2.6, 3.4, 7.6), new Vector3(2.1, 2.7, -3)],
    camp: [new Vector3(3, 6.5, 19), new Vector3(0, 1.2, -2)],
    tents: [new Vector3(-1.5, 2.2, 3.5), new Vector3(-8, 1.1, -0.6)],
    fire: [new Vector3(3.4, 1.7, -0.8), new Vector3(7, 0.7, -4)],
    flag: [new Vector3(5.5, 1.8, -3.5), new Vector3(2.6, 4.9, -8.4)],
    sign: [new Vector3(7.2, 1.9, -2.6), new Vector3(10.4, 2.0, 0.4)],
    wall: [new Vector3(0.5, 2.0, -3.5), new Vector3(0, 1.1, -12)],
    cart: [new Vector3(5, 2.2, 3.7), new Vector3(9.6, 1.0, 7.4)],
    luggage: [new Vector3(-1.2, 1.9, 6.2), new Vector3(-4.6, 0.8, 8.9)],
    crates: [new Vector3(2.2, 1.6, 3.2), new Vector3(4.6, 0.5, 6.2)],
    props: [new Vector3(0, 1.6, 2.5), new Vector3(0, 0.3, -6)],
    edge: [new Vector3(0, 3.2, 78), new Vector3(0, 14, 200)],
    hills: [new Vector3(0, 3.0, 40), new Vector3(-10, 22, -200)],
    sky: [new Vector3(0, 2, 0), new Vector3(-90, 55, 45)],
    table: [new Vector3(-0.6, 1.9, -3.6), new Vector3(-2.4, 0.8, -6.6)],
    scope: [new Vector3(9.4, 1.6, -4.3), new Vector3(11.6, 1.2, -6.6)],
    gramophone: [new Vector3(0.4, 1.5, 8.0), new Vector3(-1.2, 0.85, 9.9)],
    wash: [new Vector3(-8.8, 1.5, -1.5), new Vector3(-11.5, 1.6, 0.3)],
    hammock: [new Vector3(-5.2, 2.2, 8.2), new Vector3(-7.9, 1.0, 10.4)],
    lanterns: [new Vector3(-3.3, 1.9, -4.4), new Vector3(-0.6, 1.8, -7.3)],
    ruin: [new Vector3(6, 6, -24), new Vector3(34, hy + 2, -60)],
    tower: [new Vector3(HILL.x - 4, hy + 1.8, HILL.z + 18), new Vector3(HILL.x - 1.2, hy + 7, HILL.z)],
    colonnade: [new Vector3(HILL.x + 2, hy + 2.2, HILL.z + 9), new Vector3(HILL.x + 1, hy + 4, HILL.z - 5)],
    aqueduct: [new Vector3(6, 4.5, -36), new Vector3(24, 2, -30)],
    ford: [new Vector3(9, 2.6, -18), new Vector3(3, 0.2, -32)],
    pond: [new Vector3(-8, 3, -26), new Vector3(-20, 0, -36)],
    source: [new Vector3(19, 2.2, -22), new Vector3(24, 3.5, -28)],
    meadow: [new Vector3(11, 1.0, 25), new Vector3(16, 0.2, 16)],
    trail: [new Vector3(3, 2.4, 22), new Vector3(9, 0, 36)],
    stump: [new Vector3(0, 2, 0), new Vector3(0, 0, -6)],
    log: [new Vector3(0, 2, 0), new Vector3(0, 0, -6)],
    far: [new Vector3(0, 2.5, 60), new Vector3(0, 8, 130)],
    well: [new Vector3(WELL.x + 3.6, 2.2, WELL.z + 4.4), new Vector3(WELL.x, 0.9, WELL.z)],
    pen: [new Vector3(PEN.x + 8.5, 3.0, PEN.z + 9.5), new Vector3(PEN.x, 0.6, PEN.z)],
    bridge: [new Vector3(bridgeMid.x0 - 4, 2.6, bridgeMid.z0 + 6), new Vector3(bridgeMid.x0, -1.2, bridgeMid.z0)],
    waypost: [new Vector3(post.x + 4, 1.9, post.z + 4), new Vector3(post.x, 1.6, post.z)],
    door: [towerAt(0.3, plan.tower.r + 5, 1.7), towerAt(0, plan.tower.r, 1.5)],
    inside: [towerAt(0.05, plan.tower.r + 1.2, 1.7), towerAt(Math.PI, 1.6, 2.2)],
    dome: [towerAt(0.6, plan.tower.r + 9, 9), towerAt(0, 0, 11)],
    refractor: [new Vector3(plan.telescope.x + 4.5, hy + 2, plan.telescope.z + 4.5), new Vector3(plan.telescope.x, hy + 3.5, plan.telescope.z)],
    flock: [new Vector3(-9, 2.2, 27), new Vector3(-14, 0.5, 20)],
  };
  // the village: an overview from the way in, a map-like top view, the market, the jetty, and one per building (the door side, `d` metres out, `a` radians round)
  const vp = villagePlan(world.terrain);
  views.village = [new Vector3(14, 5.5, -32), new Vector3(-14, 1.5, -52)];
  views.vtop = [new Vector3(-14, 88, -47), new Vector3(-14.1, 0, -47)];
  views.vmarket = [new Vector3(-21, 3.2, -49.5), new Vector3(-21, 1.2, -61)];
  views.vjetty = [new Vector3(vp.jetty.x0 + 6, 3.2, vp.jetty.z0 - 5), new Vector3(vp.jetty.x1, vp.jetty.waterY, vp.jetty.z1)];
  views.vweir = [new Vector3(vp.weir.x + 7, 2.6, vp.weir.z - 5), new Vector3(vp.weir.x, vp.weir.crestY, vp.weir.z)];
  // Hollowmere's folk: the street and the plaza from the way in, the gate, the mill yard, the jetty, the well (the hour is `time=`)
  views.folk = [new Vector3(9, 4.4, -35), new Vector3(-15, 1.0, -54)];
  views.folkplaza = [new Vector3(-21, 3.4, -48.5), new Vector3(-21, 1.2, -58.5)];
  views.folkgate = [new Vector3(13, 2.6, -40.5), new Vector3(3, 1.7, -45.5)];
  views.folkmill = [new Vector3(-6.5, 2.6, -46), new Vector3(-1.5, 1.2, -41)];
  views.folkjetty = [new Vector3(-27, 2.6, -37.5), new Vector3(-22.6, 0, -41)];
  views.folkcast = [new Vector3(-21, 2.0, -52.6), new Vector3(-21, 1.0, -58.3)];
  views.folkwell = [new Vector3(-13, 2.4, -50), new Vector3(-18.5, 1.0, -55)];
  const dist = Number(params.get("d") ?? 13);
  const ang = Number(params.get("a") ?? 0.35);
  for (const b of vp.buildings) {
    const t = b.kind === "clock" ? 11 : b.kind === "hall" ? 8 : 4;
    const yaw = b.yaw + ang;
    views[`b-${b.id}`] = [new Vector3(b.x + Math.cos(yaw) * (b.hx + dist), b.ground + 2.6, b.z + Math.sin(yaw) * (b.hx + dist)), new Vector3(b.x, b.ground + t * 0.45, b.z)];
  }
  void JETTY;
  void MILL;
  // stump / log views find the nearest of that tag to the camp
  for (const [tag, key] of [["stump", "stump"], ["log", "log"]] as const) {
    const list = tagged(tag).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const o = list[Number(params.get("i") ?? 0) % Math.max(1, list.length)];
    if (o) {
      const y = world.terrainHeight(o.x, o.z);
      const d = Math.hypot(o.x, o.z) || 1;
      views[key] = [new Vector3(o.x - (o.x / d) * 3.4, y + 1.6, o.z - (o.z / d) * 3.4), new Vector3(o.x, y + 0.4, o.z)];
    }
  }
  for (const tag of ["tree", "rock", "snag"]) {
    const o = nth(tag);
    const y = world.terrainHeight(o.x, o.z);
    const d = Math.hypot(o.x, o.z) || 1;
    views[tag] = [new Vector3(o.x + (o.x / d) * 9, y + 2.2, o.z + (o.z / d) * 9), new Vector3(o.x, y + 3, o.z)];
  }
  // Kessar Reach: named vantage points (the landing you arrive at, the bridge from both banks and from under it, the gate, the ford, the camps)
  const ky = (x: number, z: number): number => world.terrainHeight(x, z);
  const kviews: Record<string, [Vector3, Vector3]> = {
    landing: [new Vector3(3, ky(0, 90) + 1.9, 97), new Vector3(0, ky(0, 70) + 4, 40)],
    outpost: [new Vector3(KO.site.x - 30, ky(KO.site.x - 30, KO.site.z + 6) + 11, KO.site.z + 20), new Vector3(KO.site.x, ky(KO.site.x, KO.site.z) + 1.5, KO.site.z)],
    rivalpost: [new Vector3(KO.rivalSite.x - 14, ky(KO.rivalSite.x - 14, KO.rivalSite.z + 8) + 5, KO.rivalSite.z + 12), new Vector3(KO.rivalSite.x, ky(KO.rivalSite.x, KO.rivalSite.z) + 2, KO.rivalSite.z)],
    wire: [new Vector3(14, ky(14, 70) + 3, 76), new Vector3(6, ky(6, 52) + 5, 50)],
    pier: [new Vector3(1.4, 1.9, 94), new Vector3(0, 0.6, 112)],
    boat: [new Vector3(-3, 1.6, 100), new Vector3(4.6, 1.2, 105)],
    bridge: [new Vector3(2.5, ky(0, 36) + 2.2, 38), new Vector3(0, 1.4, 20)],
    underbridge: [new Vector3(9, -2.4, 26), new Vector3(0, -2.4, 20)],
    toll: [new Vector3(1.5, ky(0, 2) + 1.8, 0), new Vector3(0, 1.8, 9)],
    gate: [new Vector3(3, ky(0, -28) + 2.2, -26), new Vector3(0, ky(0, -38) + 4.5, -38)],
    fort: [new Vector3(-16, ky(0, -12) + 3.4, -8), new Vector3(0, ky(0, -60) + 10, -60)],
    fortfar: [new Vector3(0, 6, 40), new Vector3(0, 12, -60)],
    ford: [new Vector3(30, 2.4, 34), new Vector3(46, -0.2, 20)],
    camp: [new Vector3(-22, ky(-22, 40) + 2.6, 40), new Vector3(-34, 1.4, 52)],
    powder: [new Vector3(6, 2.0, 37), new Vector3(10.5, 0.9, 42)],
    rim: [new Vector3(-30, 3.2, 38), new Vector3(-40, 0.4, 8)],
    top: [new Vector3(0, 150, 20), new Vector3(0, 0, 20)],
  };
  // Highmark: named vantage points (the quay you arrive at, the road across the grass, the herds, the foot of the hill and its five terraces, the gate and its Window, the court)
  const hviews: Record<string, [Vector3, Vector3]> = {
    landing: [new Vector3(3.2, ky(0, 118) + 1.9, 124), new Vector3(0, ky(0, 60) + 4, 40)],
    quay: [new Vector3(6, ky(0, 118) + 3.2, 112), new Vector3(2, 0.8, 128)],
    road: [new Vector3(5, ky(0, 70) + 2.2, 82), new Vector3(0, 11, -60)],
    grass: [new Vector3(-24, ky(-24, 36) + 2.4, 38), new Vector3(-46, 1.2, 22)],
    herds: [new Vector3(30, ky(30, 70) + 3.4, 76), new Vector3(52, 1.0, 50)],
    waiting: [new Vector3(-1, ky(-4, 70) + 1.9, 74), new Vector3(-8, 1.0, 62)],
    camp: [new Vector3(-44, ky(-44, 40) + 2.4, 40), new Vector3(-53, 1.3, 50)],
    foot: [new Vector3(14, ky(14, -4) + 2.0, -2), new Vector3(0, ky(0, -34) + 5, -34)],
    terraces: [new Vector3(46, ky(46, 14) + 3.4, 16), new Vector3(0, 7, -66)],
    granary: [new Vector3(-26, ky(-26, -26) + 2.6, -20), new Vector3(-44, 4.5, -52)],
    market: [new Vector3(-22, 8.4, -33), new Vector3(0, 6.5, -50)],
    ramp: [new Vector3(2.6, 8.4, -30), new Vector3(0, 8, -48)],
    gate: [new Vector3(3, 9.6, -42), new Vector3(0, 11.5, -58)],
    window: [new Vector3(-1.6, 11.2, -64), new Vector3(-4.2, 11, -59.8)],
    court: [new Vector3(0, 14.2, -76), new Vector3(0, 12.8, -97)],
    throne: [new Vector3(3.6, 13.0, -96), new Vector3(0, 12.8, -101.5)],
    palace: [new Vector3(0, 13.2, -83), new Vector3(0, 17, -107)],
    capital: [new Vector3(0, 5.2, 58), new Vector3(0, 12, -92)],
    capitalfar: [new Vector3(0, 8, 110), new Vector3(0, 11, -92)],
    plateau: [new Vector3(0, 40, -40), new Vector3(0, 8, -96)],
    top: [new Vector3(0, 190, 10), new Vector3(0, 0, 10)],
  };
  const [defCam, defAt] = (region === "kessar" ? kviews[params.get("view") ?? "landing"] : region === "highmark" ? hviews[params.get("view") ?? "capital"] : region === "vesper" ? vesperViews(ky)[params.get("view") ?? VESPER_DEFAULT_VIEW] : region === "saltmarket" ? saltmarketViews(ky)[params.get("view") ?? SALTMARKET_DEFAULT_VIEW] : undefined) ?? views[params.get("view") ?? "game"] ?? views.game!;
  const cam = vec(params.get("cam")) ?? defCam;
  const at = vec(params.get("at")) ?? defAt;
  stage.camera.fov = Number(params.get("fov") ?? 65);
  stage.camera.position.copy(cam);
  stage.camera.updateProjectionMatrix();
  stage.camera.lookAt(at);

  // name tags and speech slips need a layer and the camera (the game hands over its HUD; here a bare full-screen layer)
  if (params.get("tags") === "1" && typeof document !== "undefined") {
    const layer = document.createElement("div");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;font-size:16px";
    document.body.appendChild(layer);
    folkHints.layer = layer;
    folkHints.camera = stage.camera;
  }
  folkHints.seed = seed;
  // view=folkcast: the whole cast in a row in the plaza in the pose of their trade, whatever the hour (castFrom / castN pick who, castGap the spacing)
  const cast = params.get("view") === "folkcast";
  if (cast) {
    const from = Number(params.get("castFrom") ?? 0);
    const count = Number(params.get("castN") ?? 8);
    const gap = Number(params.get("castGap") ?? 1.5);
    const SIGNATURE: Record<string, [string, string]> = {
      guard: ["lean", "none"], miller: ["sack", "none"], smith: ["hammer", "none"], keeper: ["ring", "none"], ferryman: ["fish", "none"], seller: ["idle", "basket"], baker: ["idle", "loaves"],
      elder: ["idle", "none"], clockkeeper: ["lookup", "none"], registrar: ["write", "book"], fisher: ["fish", "none"], gardener: ["tend", "none"], beekeeper: ["hive", "none"],
      laundress: ["hang", "none"], lamplighter: ["lamp", "none"], watch: ["idle", "lantern"], child: ["play", "none"],
    };
    const folk = (stage["worldView"] as { folkView?: { cast: unknown } } | undefined)?.folkView;
    if (folk) {
      folk.cast = (i: number, out: import("@cb/shared").VillagerPose): boolean => {
        if (i < from || i >= from + count) return false;
        const k = i - from;
        const x = -21 + (k - (count - 1) / 2) * gap;
        const z = Number(params.get("castZ") ?? -58.3);
        const people = folkOf();
        const v = people?.folk.roster[i];
        const sig = SIGNATURE[v?.occupation ?? "guard"] ?? ["idle", "none"];
        out.x = x;
        out.z = z;
        out.y = world.terrainHeight(x, z);
        out.facing = Math.PI + 0.12 * (k % 2 ? 1 : -1) * (Number(params.get("castTurn") ?? 1));
        out.speed = 0;
        out.act = (params.get("act") ?? sig[0]) as never;
        out.carry = (params.get("carry") ?? sig[1]) as never;
        out.partner = -1;
        out.station = people ? people.folk.nav.index.get("plaza")! : 0;
        return true;
      };
    }
  }
  const who = params.get("who");
  const folkOf = (): { folk: import("@cb/shared").Folk; poses: readonly import("@cb/shared").VillagerPose[] } | undefined => (stage["worldView"] as { folkView?: { people?: { folk: import("@cb/shared").Folk; poses: readonly import("@cb/shared").VillagerPose[] } } } | undefined)?.folkView?.people;
  const followId = (): number => {
    const people = folkOf();
    if (!people || who === null) return -1;
    const n = Number(who);
    if (Number.isInteger(n) && who.trim() !== "") return n;
    return people.folk.roster.findIndex((v) => `${v.occupation} ${v.title} ${v.name}`.toLowerCase().includes(who.toLowerCase()));
  };
  const walkers: { x: number; z: number }[] = anims.length ? [0, 1, 2, 3].map((i) => (region !== "hollowmere" ? regionSpawn(region, i, 4) : spawnPoint(i, 4))) : [];
  for (const chunk of (params.get("push") ?? "").split(";")) {
    const [px, pz] = chunk.split(",").map(Number);
    if (Number.isFinite(px) && Number.isFinite(pz) && walkers.length < 4) walkers.push({ x: px!, z: pz! });
  }
  const info = stage.renderer.info;
  let frames = 0;
  const loop = (): void => {
    anims.forEach((a, i) => {
      a.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      rigs[i]!.root.position.y += standY[i]!;
    });
    const target = followId();
    const people = target >= 0 ? folkOf() : undefined;
    const pose = people?.poses[target];
    if (pose) {
      // follow one villager: `wa` radians round them from the front, `wd` metres away, camera `wh` up, looking at `wl`
      // the camera stands at `wd` metres round them at angle `wa` from the front, or at the nearest angle where it is not inside a wall
      const d0 = Number(params.get("wd") ?? 3.2);
      const a0 = pose.facing + Number(params.get("wa") ?? 0.55);
      let placed = false;
      for (const dd of [1, 0.75, 0.55]) {
        for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
          const a = a0 + off;
          const cx = pose.x - Math.sin(a) * d0 * dd;
          const cz = pose.z - Math.cos(a) * d0 * dd;
          if (standingHeight(world, cx, cz, world.terrainHeight(cx, cz) + 0.3, 0.5) === undefined) continue;
          cam.set(cx, pose.y + Number(params.get("wh") ?? 1.5), cz);
          placed = true;
          break;
        }
        if (placed) break;
      }
      at.set(pose.x, pose.y + Number(params.get("wl") ?? 1.05), pose.z);
      stage.camera.position.copy(cam);
      stage.camera.lookAt(at);
    }
    stage.setPushers(walkers);
    // D-038: the cutaway follows the camera (it is the "player" here) unless `viewer=x,z` puts it elsewhere or `viewer=none` switches it off
    const wv = (stage as unknown as { worldView?: RegionView }).worldView;
    if (wv?.setViewer && params.get("viewer") !== "none") {
      const vv = vec(params.get("viewer"));
      wv.setViewer(vv ? vv.x : cam.x, vv ? vv.z : cam.z);
    }
    stage.followShadow(new Vector3(cam.x * 0.5 + at.x * 0.5, 0, cam.z * 0.5 + at.z * 0.5));
    stage.render();
    frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as unknown as Record<string, unknown>).__showcase = {
    get ready() {
      return frames > 2;
    },
    /** (Stills tooling: move the camera without rebuilding the world, e.g. to walk a list of signs.) */
    look: (c: [number, number, number], a: [number, number, number]): void => {
      cam.set(c[0], c[1], c[2]);
      at.set(a[0], a[1], a[2]);
      stage.camera.position.copy(cam);
      stage.camera.lookAt(at);
    },
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, world: stage.worldStats, camp: CAMP.fire, anchors: region === "kessar" ? KA : undefined, folk: (stage["worldView"] as { folkView?: { stats: unknown } } | undefined)?.folkView?.stats }),
  };
}
