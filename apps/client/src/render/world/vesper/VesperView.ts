import { Color, Group, Matrix4, Mesh, MeshToonMaterial, Vector3, type BufferGeometry, type Object3D, type Scene } from "three";
import { PALETTE, smoothstep, vesperLevel, type CollisionWorld, type DayState, type ScenarioView } from "@cb/shared";
import { atmoUniforms, bakeGroundHeights, motion } from "../atmosphere.ts";
import { createAmbientUniforms, buildBirds, buildLanternGlow, buildMotes, type AmbientUniforms } from "../ambient.ts";
import { bushGeometry, grassTuftGeometry, pebbleGeometry, reedGeometry, snagGeometry, type Lod } from "../flora.ts";
import { disposeTree } from "../kit.ts";
import { buildRain } from "../rain.ts";
import type { Item } from "../scatter.ts";
import { setRgb } from "../sky.ts";
import { MAX_PUSHERS, composeInstance, makeInstances, makeSolid, pushers, setToonLite, toonMaterial, worldTime, type InstanceSet } from "../toon.ts";
import type { WorldDetail, WorldStats } from "../WorldView.ts";
import type { RegionView } from "../regionView.ts";
import { buildVesperCloth, createVesperAtlas, vesperClothMaterial } from "./cloth.ts";
import { VesperDress } from "./dress.ts";
import { buildVesperGround, buildVesperSkirt, vesperStrataPatch } from "./ground.ts";
import { vesperBoulderGeometry, vesperSlabGeometry } from "./rocks.ts";
import { planVesperScatter, type VesperScatter } from "./scatter.ts";
import type { VesperTerrain } from "./shared.ts";
import { buildVesperSolid } from "./solid.ts";
import { addWindows, setWindowNight } from "../litWindows.ts";
import { InteriorFill, RoofSet, doorGroups, type DoorMark } from "../rooms.ts";
import { cullPlants } from "../plantCull.ts";
import { sheaveAt, sheaveGeometry } from "./works.ts";

const WHITE = new Color(1, 1, 1);
/** Peak intensity of the room's fill light (see `InteriorFill`): enough that a records room's shelves and floor read in a still at noon. */
const INTERIOR_FILL = 1.6;
const fract = (x: number): number => x - Math.floor(x);

interface SetOptions {
  shadow?: boolean;
  ink?: "small" | "medium" | "large";
  wind?: "none" | "tree" | "grass";
  noCull?: boolean;
  lod?: Lod;
}

/**
 * Vesper Gorge as a region view (D-037, package C3; docs/_notes/regions34.md section 3). Same surface as WorldView, KessarView and HighmarkView, so the Stage builds any of them the same way:
 * the ground (vertex paint plus a fragment patch that bands every cliff into strata: the cleft IS the silhouette), the plateau skirt, everything built merged into one solid and its ink hull (the Long
 * Cloister, the Assay House, the Company's yard, the headframe, the ore trestle and tipple, the ore line, the rock fall, the pegs, the wharf and barge), the sheave wheel that turns, the cloth
 * (banners and signs in one draw), the boulders, outcrops, scrub, tufts, dead trees and reeds, the lamps that burn at dusk, the dust and the birds, and the dress for the contract being played
 * (`applyScenario`: the fall shored, cut, opened, blasted, sealed or consecrated; the four pegs' flags). Toon-shaded, instanced, ink-outlined, palette colours only (`PALETTE.vesper`), inside
 * `VESPER_VIEW_BUDGET` per preset, `dispose()` frees everything it made.
 */
export class VesperView implements RegionView {
  readonly root = new Group();
  readonly stats: WorldStats = { meshes: 0, triangles: 0, parts: {} };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly ambientU: AmbientUniforms = createAmbientUniforms();
  private readonly tint = new Color(1, 1, 1);
  private rainMesh?: Mesh;
  private sheave?: Mesh;
  private sheaveHull?: Mesh;
  private dress?: VesperDress;
  private glows: { x: number; y: number; z: number; lit?: number }[] = [];
  private roofSet?: RoofSet;
  private doors: DoorMark[] = [];
  /** D-038 follow-up: the lamp-and-lime-wash light of the room (or gallery) the viewer stands in. */
  private readonly fill: InteriorFill;

  /** Once a frame for the local player: the roof of the room (or the gallery) the viewer stands in is lifted (docs/LEVEL_PLAN.md section 4, rule 7). */
  setViewer(x: number, z: number): void {
    const level = vesperLevel();
    this.fill.enter(this.roofSet?.setViewer(level.rooms, x, z), level, this.world);
  }
  /** The doors the view drew, and the roof set (for tests and tools). */
  get doorMarks(): readonly DoorMark[] {
    return this.doors;
  }
  get roofs(): RoofSet | undefined {
    return this.roofSet;
  }

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly detail: WorldDetail,
    _sun: Vector3,
    _seed = 7,
  ) {
    this.root.name = "world";
    this.fill = this.track(new InteriorFill(PALETTE.vesper.companyCream, PALETTE.vesper.timberLight, INTERIOR_FILL));
    setToonLite(detail.liteShading);
    if (!detail.liteShading) bakeGroundHeights(world); // D-079: the scenery darkens where it meets the ground
    scene.add(this.root);
    const terrain = world.terrain as VesperTerrain;
    this.addGround(terrain);
    this.addScatter(planVesperScatter(world, detail));
    this.addSolid();
    this.addSheave();
    this.addCloth(terrain);
    this.dress = new VesperDress(this.root, world, detail, (x) => this.track(x));
    this.addAmbient();
    cullPlants(this.root); // (no plant grows through anything built)
    this.count();
    // (a dev hook for stills: ?fall=open|dug|blasted|sealed|consecrated and ?pegs=party,rival,none,party dress the scenery without a room; harmless in a game)
    this.applyScenario(dressFromUrl());
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

  // ---- ground ---------------------------------------------------------------------------------------------------------------------------

  private addGround(terrain: VesperTerrain): void {
    const segments = Math.round(this.detail.terrainSegments * 1.5);   // (the cliffs are steep: a finer grid than the open plain's)
    const ground = new Mesh(this.track(buildVesperGround(terrain, segments)), this.track(toonMaterial({ colourPatch: vesperStrataPatch(), puddles: this.detail.rain > 0, wetDark: 1, fade: false })));
    ground.name = "terrain";
    ground.receiveShadow = true;
    this.root.add(ground);
    const skirt = new Mesh(this.track(buildVesperSkirt(terrain)), this.track(toonMaterial({ fire: false, wetDark: 1, fade: false, colourPatch: vesperStrataPatch() })));
    skirt.name = "skirt";
    this.root.add(skirt);
  }

  // ---- instanced scenery -----------------------------------------------------------------------------------------------------------------

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

  private addScatter(p: VesperScatter): void {
    const P = PALETTE.vesper;
    const rockMat = this.track(toonMaterial({ wetDark: 1 }));
    this.instanced("boulders", vesperBoulderGeometry, rockMat, p.boulders, p.boulders.map((i) => this.varied(i.v, 0.14)), { shadow: true, ink: "medium", lod: this.detail.outlines ? 1 : 0 });
    this.instanced("outcrops", vesperSlabGeometry, rockMat, p.slabs, p.slabs.map((i) => this.varied(i.v, 0.16)), { shadow: true, ink: "medium" });
    this.instanced("pebbles", () => pebbleGeometry(), rockMat, p.pebbles, p.pebbles.map((i) => this.varied(i.v, 0.3)));
    // tints: the game's green shrub, tuft, dead tree and reed become dry scrub, straw, bleached wood and seep-green by instance colour
    const W = PALETTE.world;
    const ratio = (target: number, base: number, cap = 2.4): Color => {
      const a = new Color(target), b = new Color(base);
      return new Color(Math.min(a.r / b.r, cap), Math.min(a.g / b.g, cap), Math.min(a.b / b.b, cap));
    };
    const scrub = ratio(P.scree, W.crown, 3.2);
    const straw = ratio(P.plank, W.grass, 2.6);
    const bleach = ratio(P.strataBone, W.snag, 1.4);
    const seep = ratio(P.plank, W.reed, 2.2);
    const bushMat = this.track(toonMaterial({ doubleSided: true }));
    this.instanced("scrub", bushGeometry, bushMat, p.bushes, p.bushes.map((i) => this.varied(i.v, 0.2).multiply(scrub)));
    this.instanced("tufts", () => grassTuftGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), p.grass, p.grass.map((i) => this.varied(i.v, 0.2).multiply(straw)), { noCull: true });
    this.instanced("snags", snagGeometry, this.track(toonMaterial({ wind: "none", wetDark: 0.8 })), p.snags, p.snags.map((i) => this.varied(i.v, 0.12).multiply(bleach)), { shadow: true, ink: "medium", lod: this.detail.treeLod });
    this.instanced("reeds", () => reedGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), p.reeds, p.reeds.map((i) => this.varied(i.v, 0.2).multiply(seep)), { noCull: true });
  }

  // ---- the solid things, the wheel, the cloth ----------------------------------------------------------------------------------------------

  private addSolid(): void {
    const lod: Lod = this.detail.outlines ? 1 : 0;
    const solid = buildVesperSolid(this.world, lod);
    this.glows = solid.glows;
    addWindows(this.root, solid.panes, (x) => this.track(x)); // (D-089)
    if (!solid.geometry) return;
    const hullSolid = this.detail.outlines ? buildVesperSolid(this.world, 0) : undefined;
    const hull = hullSolid?.geometry;
    this.track(solid.geometry);
    if (hull) this.track(hull);
    const mat = this.track(toonMaterial({ wetDark: 0.8 }));
    makeSolid(this.root, solid.geometry, mat, { name: "vesper", outline: this.detail.outlines, ink: "medium", hullGeometry: hull, castShadow: true });
    // D-038: the doors drawn, and the roofs of the cloister's gallery and the Records Room (one mesh; the one over the viewer is dropped)
    this.doors = solid.marks;
    doorGroups(this.root, solid.marks);
    if (solid.roofs) {
      this.roofSet = new RoofSet(this.root, solid.roofs, hullSolid?.roofs, mat, { name: "roofs", outline: this.detail.outlines, ink: "medium" });
      for (const g of this.roofSet.geometries) this.track(g);
    }
  }

  /** The headframe's sheave wheel: its own mesh (and ink hull), turned by `update`. */
  private addSheave(): void {
    const at = sheaveAt();
    const lod: Lod = this.detail.outlines ? 1 : 0;
    const geo = this.track(sheaveGeometry(lod));
    const out = makeSolid(this.root, geo, this.track(toonMaterial({ wetDark: 0.5 })), { name: "sheave", outline: this.detail.outlines, ink: "medium", castShadow: true });
    for (const m of out) m.position.set(at.x, at.y, at.z);
    this.sheave = out[0];
    this.sheaveHull = out[1];
  }

  private addCloth(terrain: VesperTerrain): void {
    const geo = buildVesperCloth(terrain);
    if (!geo) return;
    const atlas = createVesperAtlas();
    if (atlas) this.track(atlas);
    const mesh = new Mesh(this.track(geo), this.track(vesperClothMaterial(atlas)));
    mesh.name = "cloth";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;   // (the ripple moves vertices past the static bounds; one draw either way)
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
    // vultures, or what the Guild calls "the bereavement liaison": a few wide circlers over the gorge
    const kites: Vector3[] = [];
    if (d.birds > 0) {
      const spots: [number, number][] = [[0, 60], [-10, -20], [14, -70], [-24, 20], [8, 100], [0, -50]];
      for (let i = 0; i < Math.min(spots.length, d.birds); i++) {
        const [x, z] = spots[i]!;
        kites.push(new Vector3(x, this.world.terrainHeight(x, z) + 24 + (i % 3) * 5, z));
      }
    }
    add(buildBirds(d.birds, this.ambientU, kites));
    add(buildLanternGlow(this.glows.map((l) => new Vector3(l.x, l.y, l.z)), this.ambientU, this.glows.map((l) => l.lit ?? 0)));
    const rain = buildRain(d.rain, this.ambientU.uBaseY);
    if (rain) {
      this.track(rain.geometry);
      this.track(rain.material as unknown as { dispose(): void });
      this.root.add(rain);
      this.rainMesh = rain;
    }
  }

  // ---- the contract being played ---------------------------------------------------------------------------------------------------------

  applyScenario(v: ScenarioView | undefined): void {
    this.dress?.apply(v);
  }

  /** (The tests ask what the dress shows.) */
  shownDress(): string[] {
    return this.dress?.shown() ?? [];
  }

  // ---- the day ---------------------------------------------------------------------------------------------------------------------------

  applyDay(d: DayState): void {
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    setRgb(atmoUniforms.uSheen.value, d.mid);
    atmoUniforms.uSheen.value.lerp(this.tint.set(1, 1, 1), 0.5 * d.flash).multiplyScalar(0.62 + 0.6 * d.flash);
    atmoUniforms.uSunDirW.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    setRgb(atmoUniforms.uSunColW.value, d.sun).multiplyScalar(Math.min(1, d.sunIntensity / 3) * (1 - 0.8 * d.cover) + d.flash);
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    const fine = 1 - Math.min(1, d.rain * 1.6 + Math.max(0, d.cover - 0.7));
    this.ambientU.uDay.value = (1 - smoothstep(0.25, 0.85, d.night)) * fine;
    this.ambientU.uFly.value = 0;
    this.ambientU.uLamp.value = Math.max(d.fire, d.dusk * 0.9);   // the Guild's lamps and the headframe's work-light burn at dusk
    setWindowNight(this.ambientU.uLamp.value);
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

  update(t: number, camera?: { x: number; y?: number; z: number }, _worldSec?: number): void {
    worldTime.value = t;
    this.fill.update(t);
    if (camera) this.ambientU.uBaseY.value = this.world.terrainHeight(camera.x, camera.z);
    this.ambientU.uMotion.value = motion.value;
    if (this.rainMesh) this.rainMesh.visible = atmoUniforms.uRain.value > 0.01;
    // the sheave turns (a slow winding; none at all under reduced motion)
    const a = t * 0.5 * motion.value;
    if (this.sheave) this.sheave.rotation.z = a;
    if (this.sheaveHull) this.sheaveHull.rotation.z = a;
  }

  dispose(): void {
    disposeTree(this.root as Object3D);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/** A dev hook for stills (`?fall=...&pegs=...`): a made-up published view for the dress. `undefined` when the URL asks for nothing. */
export function dressFromUrl(): ScenarioView | undefined {
  if (typeof location === "undefined") return undefined;
  const q = new URLSearchParams(location.search);
  const fall = q.get("fall"), pegs = q.get("pegs");
  if (fall === null && pegs === null) return undefined;
  const objectives: ScenarioView["objectives"] = [];
  const mine = fall !== null;
  let resolution: ScenarioView["resolution"];
  if (mine) {
    if (fall === "dug" || fall === "dug_out") resolution = "dug_out";
    else if (fall === "blasted" || fall === "blasted_through") resolution = "blasted_through";
    else if (fall === "sealed") resolution = "sealed";
    else if (fall === "consecrated") resolution = "consecrated";
    objectives.push({ id: "timber", text: `Shore the fall with timber (3 of 3)`, done: true });
    objectives.push({ id: "dig", text: `Dig by hand (${fall === "open" ? 60 : 100}%)`, done: false });
  } else {
    (pegs ?? "").split(",").forEach((w, i) => {
      if (i < 4) objectives.push({ id: `peg-${i}`, text: w === "rival" ? "Peg (Syndicate's)" : "Peg", done: w === "party" });
    });
  }
  const v: ScenarioView = { phase: "waiting", objectives, hint: "", timerLabel: "", endsAtWorldMs: 0, template: mine ? "mine_rescue" : "claim_race", title: mine ? "The Lower Gallery" : "The Claim Race" };
  if (resolution) v.resolution = resolution;
  return v;
}
