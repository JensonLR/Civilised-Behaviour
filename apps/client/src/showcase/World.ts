import { Vector3 } from "three";
import { CAMP, FLAG, classifyObstacle, createArena, scatterProps, spawnPoint } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter } from "@cb/procedural/three";
import { PropViews } from "../render/PropViews.ts";
import { Stage } from "../render/Stage.ts";

/**
 * World review scene (`?showcase=world`): the real arena (same seed -> same layout as the game) with a few figures for scale and
 * the server's scattered props, seen from named vantage points. Deterministic stills; never a perf number (software GL).
 *   view=game|camp|tents|fire|flag|sign|wall|cart|luggage|crates|props|tree|rock|snag|edge|hills|sky   (default game)
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
  };
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

  const info = stage.renderer.info;
  let frames = 0;
  const loop = (): void => {
    for (const a of anims) a.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
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
