import { BoxGeometry, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, Vector3, type BufferGeometry, type Object3D, type Scene } from "three";
import { PALETTE, highmarkLevel, smoothstep, type CollisionWorld, type DayState, type RegionDress, type ScenarioView } from "@cb/shared";
import { atmoUniforms, motion } from "../atmosphere.ts";
import { createAmbientUniforms, buildBirds, buildLanternGlow, buildMotes, type AmbientUniforms } from "../ambient.ts";
import { acaciaGeometry, barleyGeometry, boulderGeometry, bushGeometry, grassTuftGeometry, pebbleGeometry, reedGeometry, type Lod } from "../flora.ts";
import { buildHills, buildTreeLine, createHillUniforms, hillMaterial, treeLineMaterial, type HillUniforms } from "../horizon.ts";
import { disposeTree } from "../kit.ts";
import { buildRain } from "../rain.ts";
import type { Item } from "../scatter.ts";
import { setRgb } from "../sky.ts";
import { WINDMILL } from "../windmill.ts";
import { MAX_PUSHERS, composeInstance, makeInstances, makeSolid, pushers, setToonLite, toonMaterial, worldTime, type InstanceSet } from "../toon.ts";
import type { WorldDetail, WorldStats } from "../WorldView.ts";
import type { RegionView } from "../regionView.ts";
import { RoofSet, doorGroups, type DoorMark } from "../rooms.ts";
import type { WaterUniforms } from "../water.ts";
import { buildHighmarkCloth, createHighmarkAtlas, highmarkClothMaterial } from "./cloth.ts";
import { buildHighmarkGround, buildHighmarkSkirt } from "./ground.ts";
import { Herds } from "./herds.ts";
import { planHighmarkScatter, type HighmarkScatter } from "./scatter.ts";
import type { HighmarkTerrain } from "./shared.ts";
import { landmarkFog, landmarkInk } from "./landmark.ts";
import { buildHighmarkSolid, type LanternRoom } from "./structures.ts";
import { buildHighmarkWater } from "./water.ts";
import { buildGranaryScale, buildScythes } from "./strikeProps.ts";
import { OutpostDress } from "../outpostDress.ts";

const WHITE = new Color(1, 1, 1);
/** The hill rings start 112 m out (HILL_RINGS[0]: 150 - 38); this scale puts that foot just past the ground mesh's half-side (bounds + 30). */
export const HILL_SCALE = 1.66;
const fract = (x: number): number => x - Math.floor(x);

interface SetOptions {
  shadow?: boolean;
  ink?: "small" | "medium" | "large";
  wind?: "none" | "tree" | "grass";
  noCull?: boolean;
  lod?: Lod;
}

/**
 * Highmark as a region view (D-036). The ground, the river's shader, the hill rings and the sky are the game's own (terrain paint and mesh pattern, `waterMaterial`, `buildHills`, the
 * Stage's day); what is Highmark's is its plan: the five terraces and the capital (one merged solid + its ink hull), the cloth (banners and signs, one draw), the acacia flats and
 * termite mounds, the long grass that bends away from walkers, the herds (ONE instanced draw, a pure function of the world clock), the lamps that burn at the harvest bell hour, and
 * the paint. Toon-shaded, instanced, ink-outlined, palette colours only. Same surface as WorldView and KessarView, so the Stage builds any of them the same way.
 */
export class HighmarkView implements RegionView {
  readonly root = new Group();
  readonly stats: WorldStats = { meshes: 0, triangles: 0, parts: {} };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly hillU: HillUniforms;
  private readonly ambientU: AmbientUniforms = createAmbientUniforms();
  private readonly tint = new Color(1, 1, 1);
  private water?: WaterUniforms;
  private rainMesh?: Mesh;
  private herds?: Herds;
  private readonly dress: OutpostDress;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly detail: WorldDetail,
    sun: Vector3,
    seed = 7,
  ) {
    this.root.name = "world";
    this.dress = new OutpostDress(this.root, world, detail.outlines, "highmark");
    setToonLite(detail.liteShading);
    scene.add(this.root);
    this.hillU = createHillUniforms(sun);
    const terrain = world.terrain as HighmarkTerrain;
    this.addGround(terrain);
    this.addHills();
    this.addScatter(planHighmarkScatter(world, detail));
    this.addSolid();
    this.addCloth(terrain);
    this.addHerds(seed);
    this.addWater(terrain);
    this.addAmbient();
    this.addStrikeProps();
    this.count();
  }

  // ---- D-046: the Reapers' Strike's scale (always: it is the granary's) and the Compact's laid-down scythes (only while the strike is on) --------------------------------------
  private scythes: Mesh[] = [];
  private addStrikeProps(): void {
    const mat = this.track(toonMaterial({}));
    const scale = buildGranaryScale(this.world);
    if (scale) makeSolid(this.root, this.track(scale), mat, { name: "granary_scale", outline: this.detail.outlines, ink: "small", castShadow: true });
    const scythes = buildScythes(this.world);
    if (scythes) {
      this.scythes = makeSolid(this.root, this.track(scythes), mat, { name: "scythes", outline: this.detail.outlines, ink: "small", castShadow: false });
      for (const m of this.scythes) m.visible = false;
    }
  }
  applyScenario(v: ScenarioView | undefined): void {
    const on = v?.template === "reapers_strike" && v.phase !== "resolved";
    for (const m of this.scythes) m.visible = on;
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

  private addGround(terrain: HighmarkTerrain): void {
    const segments = Math.round(this.detail.terrainSegments * 1.5); // (the terraces' risers are walls a metre and a half thick: a finer grid than the open plain's)
    const ground = new Mesh(this.track(buildHighmarkGround(terrain, segments)), this.track(toonMaterial({ puddles: this.detail.rain > 0, wetDark: 1 })));
    ground.name = "terrain";
    ground.receiveShadow = true;
    this.root.add(ground);
    const skirt = new Mesh(this.track(buildHighmarkSkirt()), this.track(toonMaterial({ fire: false, wetDark: 1 })));
    skirt.name = "skirt";
    this.root.add(skirt);
  }

  private addHills(): void {
    const hillGeo = buildHills();
    if (hillGeo.summit) {
      const sm = hillGeo.summit;
      const yaw = Math.atan2(sm.axisZ, sm.axisX);
      this.hillU.uSailPivot.value.set(sm.x + WINDMILL.hubX * Math.cos(yaw), sm.y - 0.6 + WINDMILL.hubY, sm.z + WINDMILL.hubX * Math.sin(yaw));
      this.hillU.uSailAxis.value.set(Math.cos(yaw), 0, Math.sin(yaw));
    }
    // The game's hill rings are built for Hollowmere's 90 m arena: their inner foot is 112 m out. Highmark's plain is 150 m, so the whole range (rings, tree line, snowy peaks) stands in a
    // group scaled until the first foot starts beyond the terrain mesh's edge: a bigger country, the same haze.
    const range = new Group();
    range.name = "range";
    range.scale.setScalar(HILL_SCALE);
    this.root.add(range);
    const hills = new Mesh(this.track(hillGeo.geometry), this.track(hillMaterial(this.hillU)));
    hills.name = "hills";
    hills.frustumCulled = false;
    range.add(hills);
    const line = buildTreeLine(hillGeo, this.track(treeLineMaterial(this.hillU)), this.detail.treeLine);
    if (line) {
      for (const m of [line.conifers, line.rounds]) {
        if (m.count === 0) continue;
        this.track(m.geometry);
        range.add(m);
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

  private addScatter(p: HighmarkScatter): void {
    const P = PALETTE.highmark;
    const W = PALETTE.world;
    // the acacia flats: flat-topped crowns in the savannah's green (the world's acacia shape, tinted)
    const crown = new Color(P.acaciaCrown);
    const base = new Color(W.crown);
    const tint = new Color(Math.min(crown.r / base.r, 1.4), Math.min(crown.g / base.g, 1.4), Math.min(crown.b / base.b, 1.4));
    const treeMat = this.track(toonMaterial({ wind: "tree" }));
    this.instanced("acacia", acaciaGeometry, treeMat, p.acacia, p.acacia.map((i) => this.varied(i.v, 0.16).multiply(tint)), { shadow: true, ink: "large", wind: "tree", lod: this.detail.treeLod });
    // thorn scrub in dry tints
    const gold = new Color(P.grassGoldDeep);
    const grassC = new Color(W.grass);
    const dry = new Color(Math.min(gold.r / grassC.r, 1.7), Math.min(gold.g / grassC.g, 1.7), Math.min(gold.b / grassC.b, 1.7));
    const bushMat = this.track(toonMaterial({ doubleSided: true }));
    this.instanced("bush", bushGeometry, bushMat, p.bushes, p.bushes.map((i) => this.varied(i.v, 0.2).multiply(dry)));
    // termite mounds: the boulder shape in earth
    const rockMat = this.track(toonMaterial({ wetDark: 1 }));
    const earth = new Color(P.termite);
    const rockC = new Color(W.boulder);
    const mound = new Color(Math.min(earth.r / rockC.r, 1.7), Math.min(earth.g / rockC.g, 1.7), Math.min(earth.b / rockC.b, 1.7)).lerp(WHITE, 0.4);
    this.instanced("mounds", boulderGeometry, rockMat, p.mounds, p.mounds.map((i) => this.varied(i.v, 0.12).multiply(mound)), { shadow: true, ink: "medium" });
    this.instanced("pebbles", () => pebbleGeometry(), rockMat, p.pebbles, p.pebbles.map((i) => this.varied(i.v, 0.3)));
    this.instanced("grass", () => grassTuftGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), p.grass, p.grass.map((i) => this.varied(i.v, 0.22).multiply(i.cls === 1 ? new Color(1.1, 1.0, 0.8) : dry)), { noCull: true });
    // D-046: the barley field (its own straw-and-pale-gold clumps; the instance colour only varies them a little)
    this.instanced("barley", () => barleyGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), p.barley, p.barley.map((i) => this.varied(i.v, 0.1)), { noCull: true });
    this.instanced("reeds", () => reedGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), p.reeds, p.reeds.map((i) => this.varied(i.v, 0.2)), { noCull: true });
  }

  // ---- the solid things, the cloth, the herds, the water ----------------------------------------------------------------------------------

  private addSolid(): void {
    const lod: Lod = this.detail.outlines ? 1 : 0;
    const solid = buildHighmarkSolid(this.world, lod);
    this.lamps = [...solid.lamps, { x: solid.lantern.x, y: solid.lantern.y, z: solid.lantern.z }]; // (the lit tower's lantern burns with the lamps)
    this.addLantern(solid.lantern);
    if (!solid.geometry) return;
    const hullSolid = this.detail.outlines ? buildHighmarkSolid(this.world, 0) : undefined;
    const hull = hullSolid?.geometry;
    this.track(solid.geometry);
    if (hull) this.track(hull);
    // the capital is a LANDMARK (landmark.ts): it keeps a share of its colour through the haze and its ink does not thin to nothing at 200 m
    const mat = landmarkFog(this.track(toonMaterial({ wetDark: 0.8 })));
    makeSolid(this.root, solid.geometry, mat, { name: "highmark", outline: false, castShadow: true });
    // D-038: the doors drawn, and the Assembly Hall's roof (one mesh with its own ink hull; the roof over the viewer is dropped)
    this.doors = solid.marks;
    doorGroups(this.root, solid.marks);
    if (solid.roofs) {
      this.roofSet = new RoofSet(this.root, solid.roofs, hullSolid?.roofs, mat, { name: "roofs", outline: this.detail.outlines, ink: "large", hullMaterial: this.detail.outlines ? landmarkInk() : undefined });
      for (const g of this.roofSet.geometries) this.track(g);
    }
    if (this.detail.outlines && hull) {
      const ink = new Mesh(hull, landmarkInk());
      ink.name = "highmark_outline";
      this.root.add(ink);
    }
  }
  private lamps: { x: number; y: number; z: number }[] = [];
  private roofSet?: RoofSet;
  private doors: DoorMark[] = [];

  /** Once a frame for the local player: the roof of the room the viewer stands in is lifted (docs/LEVEL_PLAN.md section 4, rule 7). */
  setViewer(x: number, z: number): void {
    this.roofSet?.setViewer(highmarkLevel().rooms, x, z);
  }
  /** The doors the view drew, and the roof set (for tests and tools). */
  get doorMarks(): readonly DoorMark[] {
    return this.doors;
  }
  get roofs(): RoofSet | undefined {
    return this.roofSet;
  }

  /** The lit tower's glass: an unlit pane that is slate by day and the lamps' amber at the harvest bell hour (`applyDay`), the one lit thing in the capital from the plain. */
  private addLantern(l: LanternRoom): void {
    const mat = landmarkFog(this.track(new MeshBasicMaterial({ color: this.lanternDark, fog: true })), 0.95); // (a light: the haze takes almost none of it)
    const mesh = new Mesh(this.track(new BoxGeometry(l.half * 2, l.height, l.half * 2)), mat);
    mesh.name = "palace-lantern";
    mesh.position.set(l.x, l.y, l.z);
    this.root.add(mesh);
    this.lantern = mat;
  }
  private lantern?: MeshBasicMaterial;
  private readonly lanternDark = new Color(PALETTE.highmark.lanternGlass);
  private readonly lanternLit = new Color(PALETTE.highmark.lampGlow);

  private addCloth(terrain: HighmarkTerrain): void {
    const geo = buildHighmarkCloth(terrain);
    if (!geo) return;
    const atlas = createHighmarkAtlas();
    if (atlas) this.track(atlas);
    const mesh = new Mesh(this.track(geo), this.track(highmarkClothMaterial(atlas)));
    mesh.name = "cloth";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // (the ripple moves vertices past the static bounds; one draw either way)
    this.root.add(mesh);
  }

  private addHerds(seed: number): void {
    // (the test preset keeps them: they are one draw, and a showcase of the region without its herds is not the region)
    this.herds = new Herds(this.root, this.world, seed, this.detail.outlines, this.detail.outlines ? 1 : 0, (x) => this.track(x));
    this.herds.update(0);
  }

  private addWater(terrain: HighmarkTerrain): void {
    const { mesh, uniforms } = buildHighmarkWater(terrain, this.detail.waterFx);
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
    // kites over the grass and the court
    const kites: Vector3[] = [];
    if (d.birds > 0) {
      const spots: [number, number][] = [[-40, 40], [44, 70], [0, -30], [-20, 90], [30, 10], [0, -100]];
      for (let i = 0; i < Math.min(spots.length, d.birds); i++) {
        const [x, z] = spots[i]!;
        kites.push(new Vector3(x, this.world.terrainHeight(x, z) + 14 + (i % 3) * 2, z));
      }
    }
    add(buildBirds(d.birds, this.ambientU, kites));
    // the lamps of the terraces: a candle's glow by day, a flame at the harvest bell hour
    add(buildLanternGlow(this.lamps.map((l) => new Vector3(l.x, l.y, l.z)), this.ambientU, this.lamps.map(() => 0)));
    const rain = buildRain(d.rain, this.ambientU.uBaseY);
    if (rain) {
      this.track(rain.geometry);
      this.track(rain.material as unknown as { dispose(): void });
      this.root.add(rain);
      this.rainMesh = rain;
    }
  }

  // ---- the dress: the Society's post on the grass west of the landing (D-056; swapped in place: outpostDress.ts) ------------------------------

  applyDress(d: RegionDress): void {
    if (this.dress.apply(d)) this.count();
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
    this.ambientU.uLamp.value = Math.max(d.fire, d.dusk * 0.9);   // the lamps are lit at the harvest bell hour
    this.lantern?.color.copy(this.lanternDark).lerp(this.lanternLit, this.ambientU.uLamp.value); // ... and so is the tower's glass
    this.ambientU.uLight.value.copy(this.tint);
    atmoUniforms.uHour.value = d.hours;
  }

  /** The grass and scrub bend away from up to four walkers (the same pusher slots the whole world uses). */
  setPushers(list: readonly { x: number; z: number }[], n = list.length): void {
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const u = pushers.value[i]!;
      if (i < n && i < list.length) u.set(list[i]!.x, list[i]!.z, 1.5, 1);
      else u.set(0, 0, 1, 0);
    }
  }

  update(t: number, camera?: { x: number; y?: number; z: number }, worldSec?: number): void {
    worldTime.value = t;
    this.hillU.uSailAngle.value = t * 0.32;
    if (camera) this.ambientU.uBaseY.value = this.world.terrainHeight(camera.x, camera.z);
    this.ambientU.uMotion.value = motion.value;
    if (this.rainMesh) this.rainMesh.visible = atmoUniforms.uRain.value > 0.01;
    this.herds?.update(worldSec ?? t);
  }

  dispose(): void {
    this.dress.clear();
    disposeTree(this.root as Object3D);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
