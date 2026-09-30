import { Color, Group, Matrix4, Mesh, MeshToonMaterial, Vector3, type BufferGeometry, type Object3D, type Scene } from "three";
import { PALETTE, smoothstep, type CollisionWorld, type DayState } from "@cb/shared";
import type { WorldInkClass } from "@cb/procedural/three";
import { atmoUniforms, motion } from "../atmosphere.ts";
import { createAmbientUniforms, buildBirds, buildMotes, type AmbientUniforms } from "../ambient.ts";
import { acaciaGeometry, boulderGeometry, bushGeometry, grassTuftGeometry, pebbleGeometry, type Lod } from "../flora.ts";
import { buildHills, buildTreeLine, createHillUniforms, hillMaterial, treeLineMaterial, type HillUniforms } from "../horizon.ts";
import { disposeTree } from "../kit.ts";
import { buildRain } from "../rain.ts";
import { planScatter, type Item, type ScatterPlan } from "../scatter.ts";
import { setRgb } from "../sky.ts";
import { WINDMILL } from "../windmill.ts";
import { MAX_PUSHERS, composeInstance, makeInstances, makeSolid, pushers, setToonLite, toonMaterial, worldTime, type InstanceSet } from "../toon.ts";
import type { WorldDetail, WorldStats } from "../WorldView.ts";
import type { RegionView } from "../regionView.ts";
import { buildKessarCloth, createKessarAtlas, kessarClothMaterial } from "./cloth.ts";
import { buildKessarGround, buildKessarSkirt, kessarCover } from "./ground.ts";
import { palmGeometry } from "./palms.ts";
import { kessarPlan, type KessarTerrain } from "./shared.ts";
import { buildKessarSolid } from "./structures.ts";
import { buildKessarWater } from "./water.ts";
import type { WaterUniforms } from "../water.ts";

const WHITE = new Color(1, 1, 1);
const fract = (x: number): number => x - Math.floor(x);

interface SetOptions {
  shadow?: boolean;
  ink?: WorldInkClass;
  wind?: "none" | "tree" | "grass";
  noCull?: boolean;
  lod?: Lod;
}

/**
 * Kessar Reach as a region view. The ground, the stream's shader, the scatter planner, the hill rings and the sky are the game's own (terrain paint and
 * mesh pattern, `waterMaterial`, `planScatter`, `buildHills`, the Stage's day); what is Kessar's is its plan: the fort, the bridge, the toll station, the
 * landing and the camps (one merged solid + its ink hull), the cloth (banners and signs, one draw), the palms, and the paint. Toon-shaded, instanced,
 * ink-outlined, palette colours only. Same surface as WorldView, so the Stage builds either one the same way.
 */
export class KessarView implements RegionView {
  readonly root = new Group();
  readonly stats: WorldStats = { meshes: 0, triangles: 0, parts: {} };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly hillU: HillUniforms;
  private readonly ambientU: AmbientUniforms = createAmbientUniforms();
  private readonly tint = new Color(1, 1, 1);
  private water?: WaterUniforms;
  private rainMesh?: Mesh;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly detail: WorldDetail,
    sun: Vector3,
  ) {
    this.root.name = "world";
    setToonLite(detail.liteShading);
    scene.add(this.root);
    this.hillU = createHillUniforms(sun);
    const terrain = world.terrain as KessarTerrain;
    this.addGround(terrain);
    this.addHills();
    const plan = planScatter(world, detail);
    this.addScatter(plan);
    this.addPalms();
    this.addSolid();
    this.addCloth(terrain);
    this.addWater(terrain);
    this.addAmbient();
    this.count();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private count(): void {
    let meshes = 0;
    let tris = 0;
    this.root.traverse((o) => {
      const m = o as Mesh & { isInstancedMesh?: boolean; count?: number; isPoints?: boolean };
      if (!(m as { isMesh?: boolean }).isMesh && !(o as { isSprite?: boolean }).isSprite && !m.isPoints) return;
      meshes++;
      if (m.geometry) {
        const g = m.geometry as BufferGeometry;
        const t = m.isPoints ? 0 : ((g.index ? g.index.count : g.attributes.position!.count) / 3) * (m.isInstancedMesh ? (m.count ?? 1) : 1);
        tris += t;
        this.stats.parts[o.name || o.type] = Math.round(t);
      }
    });
    this.stats.meshes = meshes;
    this.stats.triangles = Math.round(tris);
  }

  // ---- ground, hills ----------------------------------------------------------------------------------------------------------------

  private addGround(terrain: KessarTerrain): void {
    const segments = Math.round(this.detail.terrainSegments * 1.2); // (the gorge's walls are two metres wide: a finer grid than the open meadow's)
    const ground = new Mesh(this.track(buildKessarGround(terrain, segments)), this.track(toonMaterial({ puddles: this.detail.rain > 0, wetDark: 1 })));
    ground.name = "terrain";
    ground.receiveShadow = true;
    this.root.add(ground);
    const skirt = new Mesh(this.track(buildKessarSkirt()), this.track(toonMaterial({ fire: false, wetDark: 1 })));
    skirt.name = "skirt";
    this.root.add(skirt);
  }

  private addHills(): void {
    const hillGeo = buildHills();
    if (hillGeo.summit) {
      const sm = hillGeo.summit;
      // (the distant windmill's sails turn about a hub on the second summit, as in Hollowmere)
      const yaw = Math.atan2(sm.axisZ, sm.axisX);
      this.hillU.uSailPivot.value.set(sm.x + WINDMILL.hubX * Math.cos(yaw), sm.y - 0.6 + WINDMILL.hubY, sm.z + WINDMILL.hubX * Math.sin(yaw));
      this.hillU.uSailAxis.value.set(Math.cos(yaw), 0, Math.sin(yaw));
    }
    const hills = new Mesh(this.track(hillGeo.geometry), this.track(hillMaterial(this.hillU)));
    hills.name = "hills";
    hills.frustumCulled = false;
    this.root.add(hills);
    const line = buildTreeLine(hillGeo, this.track(treeLineMaterial(this.hillU)), this.detail.treeLine);
    if (line) {
      for (const m of [line.conifers, line.rounds]) {
        if (m.count === 0) continue;
        this.track(m.geometry);
        this.root.add(m);
      }
    }
  }

  // ---- instanced scenery -------------------------------------------------------------------------------------------------------------

  private instanced(name: string, build: (lod: Lod) => BufferGeometry, material: MeshToonMaterial, items: readonly Item[], colours: Color[] | undefined, o: SetOptions = {}): InstanceSet | undefined {
    if (items.length === 0) return undefined;
    const mats = items.map((it) => composeInstance(new Matrix4(), it.x, it.y, it.z, it.yaw, it.sx, it.sy, it.sz, it.tiltX ?? 0, it.tiltZ ?? 0));
    const geo = this.track(build(o.lod ?? 1));
    const ink = this.detail.outlines && o.ink !== undefined;
    const hull = ink ? this.track(build(0)) : undefined;
    const set = makeInstances(this.root, geo, material, mats, colours, { name, castShadow: o.shadow ?? false, outline: ink, ink: o.ink, wind: o.wind, hullGeometry: hull });
    if (set && o.noCull) set.mesh.frustumCulled = false;
    return set;
  }

  private varied(v: number, spread = 0.14): Color {
    return new Color(1 - spread * 0.5 + fract(v * 9.13) * spread, 1 - spread * 0.4 + fract(v * 4.71) * spread * 0.8, 1 - spread * 0.5 + fract(v * 7.37) * spread);
  }

  private addScatter(p: ScatterPlan): void {
    const W = PALETTE.world;
    const K = PALETTE.kessar;
    // the country is scrub: acacias of every species' spot, bushes and tufts in dry tints
    const dry = new Color(K.scrubDry);
    const grassC = new Color(W.grass);
    const dryTint = new Color(Math.min(dry.r / grassC.r, 1.5), Math.min(dry.g / grassC.g, 1.5), Math.min(dry.b / grassC.b, 1.5));
    const trees = [...p.acacia, ...p.broadleaf, ...p.birch, ...p.pine];
    const treeMat = this.track(toonMaterial({ wind: "tree" }));
    this.instanced("acacia", acaciaGeometry, treeMat, trees, trees.map((i) => this.varied(i.v, 0.16).multiply(dryTint)), { shadow: true, ink: "large", wind: "tree", lod: this.detail.treeLod });
    const bushMat = this.track(toonMaterial({ doubleSided: true }));
    this.instanced("bush", bushGeometry, bushMat, p.bushes, p.bushes.map((i) => this.varied(i.v, 0.2).multiply(dryTint)));
    const rockMat = this.track(toonMaterial({ wetDark: 1 }));
    this.instanced("rock", boulderGeometry, rockMat, p.rocks, p.rocks.map((i) => this.varied(i.v, 0.14)), { shadow: true, ink: "medium" });
    this.instanced("pebbles", () => pebbleGeometry(), rockMat, p.pebbles, p.pebbles.map((i) => this.varied(i.v, 0.3)));
    const grass = p.grass.filter((i) => fract(i.v * 17.3) < kessarCover(i.x, i.z, this.world.terrainHeight(i.x, i.z), 0) * 1.2);
    this.instanced("grass", () => grassTuftGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), grass, grass.map((i) => this.varied(i.v, 0.22).multiply(dryTint)), { noCull: true });
  }

  private addPalms(): void {
    const items: Item[] = kessarPlan().palms.map((p, i) => ({ x: p.x, y: this.world.terrainHeight(p.x, p.z), z: p.z, yaw: p.yaw, sx: p.s, sy: p.s, sz: p.s, cls: 0, v: fract(i * 0.618) }));
    this.instanced("palms", palmGeometry, this.track(toonMaterial({ wind: "tree" })), items, items.map((i) => this.varied(i.v, 0.14)), { shadow: true, ink: "large", wind: "tree", lod: this.detail.treeLod });
  }

  // ---- the solid things, the cloth, the water ---------------------------------------------------------------------------------------------------

  private addSolid(): void {
    const lod: Lod = this.detail.outlines ? 1 : 0;
    const solid = buildKessarSolid(this.world, lod);
    if (!solid.geometry) return;
    const hull = this.detail.outlines ? buildKessarSolid(this.world, 0).geometry : undefined;
    this.track(solid.geometry);
    if (hull) this.track(hull);
    makeSolid(this.root, solid.geometry, this.track(toonMaterial({ wetDark: 0.8 })), { name: "kessar", outline: this.detail.outlines, ink: "medium", hullGeometry: hull, castShadow: true });
  }

  private addCloth(terrain: KessarTerrain): void {
    const geo = buildKessarCloth(terrain);
    if (!geo) return;
    const atlas = createKessarAtlas();
    if (atlas) this.track(atlas);
    const mesh = new Mesh(this.track(geo), this.track(kessarClothMaterial(atlas)));
    mesh.name = "cloth";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // (the ripple moves vertices past the static bounds; one draw either way)
    this.root.add(mesh);
  }

  private addWater(terrain: KessarTerrain): void {
    const { mesh, uniforms } = buildKessarWater(terrain, this.detail.waterFx);
    this.track(mesh.geometry);
    this.track(mesh.material as unknown as { dispose(): void });
    this.water = uniforms;
    this.root.add(mesh);
  }

  private addAmbient(): void {
    const d = this.detail;
    const add = (o: Object3D | undefined): void => {
      if (!o) return;
      this.root.add(o);
      const m = o as Mesh;
      if (m.geometry) this.track(m.geometry);
      this.track(m.material as unknown as { dispose(): void });
    };
    add(buildMotes(d.motes, this.ambientU));
    // gulls over the landing and the gorge
    const gulls: Vector3[] = [];
    if (d.birds > 0) {
      const spots: [number, number][] = [[0, 104], [-18, 100], [16, 108], [0, 26], [40, 24], [-30, 40]];
      for (let i = 0; i < Math.min(spots.length, d.birds); i++) {
        const [x, z] = spots[i]!;
        gulls.push(new Vector3(x, this.world.terrainHeight(x, z) + 9 + (i % 3) * 1.6, z));
      }
    }
    add(buildBirds(d.birds, this.ambientU, gulls));
    const rain = buildRain(d.rain, this.ambientU.uBaseY);
    if (rain) {
      this.track(rain.geometry);
      this.track(rain.material as unknown as { dispose(): void });
      this.root.add(rain);
      this.rainMesh = rain;
    }
  }

  // ---- the day ---------------------------------------------------------------------------------------------------------------------------

  applyDay(d: DayState): void {
    setRgb(this.hillU.uFog.value, d.horizon);
    this.hillU.uSunDir.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    this.hillU.uExtraFog.value = Math.max(0, d.fogDensity - 0.0105);
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    this.hillU.uTint.value.copy(this.tint);
    if (this.water) {
      this.water.uLight.value.copy(this.tint).multiplyScalar(1 - 0.5 * d.night);
      this.water.uSun.value = 1 - d.night;
      this.water.uSunDir.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    }
    setRgb(atmoUniforms.uSheen.value, d.mid);
    atmoUniforms.uSheen.value.lerp(this.tint.set(1, 1, 1), 0.5 * d.flash).multiplyScalar(0.62 + 0.6 * d.flash);
    atmoUniforms.uSunDirW.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    setRgb(atmoUniforms.uSunColW.value, d.sun).multiplyScalar(Math.min(1, d.sunIntensity / 3) * (1 - 0.8 * d.cover) + d.flash);
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    const fine = 1 - Math.min(1, d.rain * 1.6 + Math.max(0, d.cover - 0.7));
    this.ambientU.uDay.value = (1 - smoothstep(0.25, 0.85, d.night)) * fine;
    this.ambientU.uFly.value = Math.max(d.dusk * 0.85, d.night);
    this.ambientU.uLamp.value = d.fire;
    this.ambientU.uLight.value.copy(this.tint);
    atmoUniforms.uHour.value = d.hours;
  }

  /** The grass and scrub bend away from up to four walkers (the same pusher slots the whole world uses). */
  setPushers(list: readonly { x: number; z: number }[], n = list.length): void {
    // (the shared uniform array of toon.ts: the same slots WorldView fills)
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const u = pushers.value[i]!;
      if (i < n && i < list.length) u.set(list[i]!.x, list[i]!.z, 1.5, 1);
      else u.set(0, 0, 1, 0);
    }
  }

  update(t: number, camera?: { x: number; y?: number; z: number }): void {
    worldTime.value = t;
    this.hillU.uSailAngle.value = t * 0.32;
    if (camera) this.ambientU.uBaseY.value = this.world.terrainHeight(camera.x, camera.z);
    this.ambientU.uMotion.value = motion.value;
    if (this.rainMesh) this.rainMesh.visible = atmoUniforms.uRain.value > 0.01;
  }

  dispose(): void {
    disposeTree(this.root as Object3D);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

