import { Vector3 } from "three";
import { CAMP, FLAG, HILL, JETTY, MILL, PEN, WELL, classifyObstacle, createArena, getBridge, getWayposts, ruinPlan, scatterProps, spawnPoint, villagePlan } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter } from "@cb/procedural/three";
import { PropViews } from "../render/PropViews.ts";
import { Stage } from "../render/Stage.ts";

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
 *   seed=N     arena seed (default 7)
 *   cam=x,y,z&at=x,y,z   explicit camera and target (metres)
 *   fov=N      vertical field of view (default 65 like the game)
 *   gfx=low|medium|high
 *   figures=0  hide the figures
 *   props=0    no props (world-only draw-call and triangle counts)
 *   propline=1 one crate, barrel, bottle and chair in a row at (0, -3) instead of the scatter
 */
export function runWorld(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const stage = new Stage(canvas, (params.get("gfx") as "low" | "medium" | "high" | null) ?? "medium");
  const seed = Number(params.get("seed") ?? 7);
  const world = createArena(seed);
  stage.buildWorld(world);

  const props = new PropViews(stage.scene, stage.outlines);
  const line = params.get("propline") === "1"; // one of each kind in a row, for reviewing the props
  const fake = params.get("props") === "0" ? [] : (line ? [0, 1, 2, 3].map((k, i) => ({ kind: k as 0 | 1 | 2 | 3, x: -0.9 + i * 0.6, z: -3, yaw: 0.6 })) : scatterProps(seed, world.terrain, 14)).map((s, i) => ({ id: String(i), kind: s.kind, x: s.x, y: world.terrainHeight(s.x, s.z) + 0.4, z: s.z, yaw: s.yaw }));
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

  const anims: CharacterAnimator[] = [];
  if (params.get("figures") !== "0") {
    for (let i = 0; i < 4; i++) {
      const rig = buildCharacter(generateCharacter(seed * 31 + i * 7919, i), { outline: stage.outlines });
      const sp = spawnPoint(i, 4);
      rig.root.position.set(sp.x, world.terrainHeight(sp.x, sp.z), sp.z);
      rig.root.rotation.y = Math.PI + (i - 1.5) * 0.35;
      stage.scene.add(rig.root);
      const anim = new CharacterAnimator(rig);
      for (let k = 0; k < 60; k++) anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
      anims.push(anim);
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
  const [defCam, defAt] = views[params.get("view") ?? "game"] ?? views.game!;
  const cam = vec(params.get("cam")) ?? defCam;
  const at = vec(params.get("at")) ?? defAt;
  stage.camera.fov = Number(params.get("fov") ?? 65);
  stage.camera.position.copy(cam);
  stage.camera.updateProjectionMatrix();
  stage.camera.lookAt(at);

  const walkers: { x: number; z: number }[] = anims.length ? [0, 1, 2, 3].map((i) => spawnPoint(i, 4)) : [];
  for (const chunk of (params.get("push") ?? "").split(";")) {
    const [px, pz] = chunk.split(",").map(Number);
    if (Number.isFinite(px) && Number.isFinite(pz) && walkers.length < 4) walkers.push({ x: px!, z: pz! });
  }
  const info = stage.renderer.info;
  let frames = 0;
  const loop = (): void => {
    for (const a of anims) a.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    stage.setPushers(walkers);
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
    stats: () => ({ calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, world: stage.worldStats, camp: CAMP.fire }),
  };
}
