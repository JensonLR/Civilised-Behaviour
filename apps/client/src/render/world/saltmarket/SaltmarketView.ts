import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Matrix4, Mesh, MeshToonMaterial, SphereGeometry, Vector3, type Object3D, type Scene, type ShaderMaterial } from "three";
import { PALETTE, SALTMARKET_ANCHORS, saltmarketLevel, smoothstep, type CollisionWorld, type DayState, type RegionDress, type SaltmarketTerrain, type ScenarioView } from "./shared.ts";
import { atmoUniforms, bakeGroundHeights, motion } from "../atmosphere.ts";
import { createAmbientUniforms, buildBirds, buildLanternGlow, buildMotes, type AmbientUniforms } from "../ambient.ts";
import { grassTuftGeometry, reedGeometry, type Lod } from "../flora.ts";
import { Kit, disposeTree, topLit } from "../kit.ts";
import { buildRain } from "../rain.ts";
import type { Item } from "../scatter.ts";
import { setRgb } from "../sky.ts";
import { MAX_PUSHERS, composeInstance, makeInstances, makeSolid, pushers, setToonLite, toonMaterial, worldTime, type InstanceSet } from "../toon.ts";
import type { WorldDetail, WorldStats } from "../WorldView.ts";
import type { RegionView } from "../regionView.ts";
import { InteriorFill, RoofSet, doorGroups, type DoorMark } from "../rooms.ts";
import type { WaterUniforms } from "../water.ts";
import { buildSaltmarketCloth, createSaltmarketAtlas, saltmarketClothMaterial } from "./cloth.ts";
import { FLOOD, buildFloodMesh, floodTarget } from "./flood.ts";
import { buildSaltmarketGround, buildSaltmarketSkirt } from "./ground.ts";
import { buildDeltaHorizon } from "./horizon.ts";
import { planSaltmarketScatter, type SaltmarketScatter } from "./scatter.ts";
import { buildSaltmarketPlanks, buildSaltmarketSolid } from "./structures.ts";
import { buildSaltmarketWater } from "./water.ts";

const WHITE = new Color(1, 1, 1);
/** Peak intensity of the room's fill light (see `InteriorFill`): enough that a warehouse's planks and the customs desk read in a still at noon. */
const INTERIOR_FILL = 1.6;

/** Tamarisk scrub: three feathery lobes in the delta's own greys and olives (palette colours only), lit from above. */
function tamariskGeometry(lod: Lod): BufferGeometry {
  const P = PALETTE.saltmarket;
  const k = new Kit();
  const c = topLit(P.siltDark, P.reedDark, P.reedGreen, 0.4);
  for (const [x, y, z, r] of [[0, 0.5, 0, 0.9], [0.6, 0.38, 0.3, 0.6], [-0.5, 0.34, -0.3, 0.55]] as const) {
    k.add(new SphereGeometry(r, lod ? 9 : 6, lod ? 6 : 4), { at: [x, y, z], scale: [1, 0.75, 1], colour: c, flat: true, jitter: 0.07, seed: 31 + Math.round(x * 10) });
  }
  return k.build()!;
}
const fract = (x: number): number => x - Math.floor(x);

interface SetOptions {
  shadow?: boolean;
  ink?: "small" | "medium" | "large";
  wind?: "none" | "tree" | "grass";
  noCull?: boolean;
  lod?: Lod;
}

/**
 * The Saltmarket Delta as a region view (D-037, package D4; docs/_notes/regions34.md section 4). Same surface as WorldView, KessarView and HighmarkView, so the Stage builds any of them the same way:
 * the silt plain and its braided channels (the horizon line IS the silhouette: a ring of reed banks and far masts in place of hills), the stilted warehouses and boardwalks, the floating quay, the Customs House, the
 * Exchange and its flood, the reed cove, the cloth and signs, reeds and scatter that bend away from walkers, the lanterns that burn at dusk; toon-shaded, instanced, ink-outlined, palette colours only
 * (`PALETTE.saltmarket`), inside `SALTMARKET_VIEW_BUDGET` (meshes and triangles per preset), `dispose()` frees everything it made.
 *
 * `applyScenario` dresses the contract without ever touching collision: the Exchange's water follows the auction's clock (`flood.ts`: a pure function of `endsAtWorldMs - worldSec * 1000`) and is held where it
 * stood once the sale resolves.
 */
export class SaltmarketView implements RegionView {
  readonly root = new Group();
  readonly stats: WorldStats = { meshes: 0, triangles: 0, parts: {} };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly ambientU: AmbientUniforms = createAmbientUniforms();
  private readonly tint = new Color(1, 1, 1);
  private readonly world: CollisionWorld;
  private water?: WaterUniforms;
  private waterMaterial?: ShaderMaterial;
  private rainMesh?: Mesh;
  private flood?: Mesh;
  private scenario?: ScenarioView;
  /** The flood's level now (metres above the hall's floor): `floodTarget`'s, held once the sale has ended. */
  private level: number = FLOOD.base;
  private lamps: { x: number; y: number; z: number; lit?: number }[] = [];
  /** D-038: the roofs of the interiors (the cutaway), and the doors the view drew. */
  private roofSet?: RoofSet;
  private doors: DoorMark[] = [];
  /** D-038 follow-up: the lamp-and-lime-wash light of the room the viewer stands in. */
  private readonly fill: InteriorFill;

  constructor(
    private readonly scene: Scene,
    world: CollisionWorld,
    private readonly detail: WorldDetail,
    _sun: Vector3,
    _seed = 7,
  ) {
    this.world = world;
    this.root.name = "world";
    this.fill = new InteriorFill(this.root, PALETTE.saltmarket.salt, PALETTE.saltmarket.tarPlankLight, INTERIOR_FILL);
    setToonLite(detail.liteShading);
    if (!detail.liteShading) bakeGroundHeights(world); // D-079: the scenery darkens where it meets the ground
    scene.add(this.root);
    const terrain = world.terrain as SaltmarketTerrain;
    this.addGround(terrain);
    this.addHorizon();
    this.addScatter(planSaltmarketScatter(world, detail));
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

  // ---- ground, horizon --------------------------------------------------------------------------------------------------------------

  private addGround(terrain: SaltmarketTerrain): void {
    const segments = Math.round(this.detail.terrainSegments * 1.35);   // (the cuts' banks are a metre and a bit wide: a finer grid than the open plain's)
    this.segments = segments;
    const ground = new Mesh(this.track(buildSaltmarketGround(terrain, segments)), this.track(toonMaterial({ puddles: this.detail.rain > 0, wetDark: 1, fade: false })));
    ground.name = "terrain";
    ground.receiveShadow = true;
    this.root.add(ground);
    const skirt = new Mesh(this.track(buildSaltmarketSkirt()), this.track(toonMaterial({ fire: false, wetDark: 1, fade: false })));
    skirt.name = "skirt";
    this.root.add(skirt);
  }
  private segments = 0;

  private addHorizon(): void {
    const h = new Mesh(this.track(buildDeltaHorizon()), this.track(toonMaterial({ fire: false, doubleSided: true })));
    h.name = "horizon";
    h.frustumCulled = false;
    this.root.add(h);
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

  /** A multiplier that turns the game's stock plant colour into the delta's: target / base per channel, clamped. */
  private retint(target: number | Color, base: number, k = 1.5): Color {
    const t = new Color(target), b = new Color(base);
    return new Color(Math.min(t.r / b.r, k), Math.min(t.g / b.g, k), Math.min(t.b / b.b, k));
  }

  private addScatter(p: SaltmarketScatter): void {
    const P = PALETTE.saltmarket;
    const W = PALETTE.world;
    const reedTint = this.retint(P.reed, W.reed);
    const reedMat = this.track(toonMaterial({ doubleSided: true, wind: "grass" }));
    this.instanced("reeds", () => reedGeometry(), reedMat, p.reeds, p.reeds.map((i) => this.varied(i.v, 0.22).multiply(i.v > 0.72 ? this.retint(P.reedGreen, W.reed) : reedTint)), { noCull: true });
    const sedgeTint = this.retint(P.reedGreen, W.grass);
    const dryTint = this.retint(P.thatch, W.grass);
    const grassMat = this.track(toonMaterial({ doubleSided: true, wind: "grass" }));
    this.instanced("sedge", () => grassTuftGeometry(), grassMat, p.sedge, p.sedge.map((i) => this.varied(i.v, 0.22).multiply(i.cls === 1 ? dryTint : sedgeTint)), { noCull: true });
    const bushMat = this.track(toonMaterial({ doubleSided: true }));
    this.instanced("tamarisk", tamariskGeometry, bushMat, p.bushes, p.bushes.map((i) => this.varied(i.v, 0.2)));   // (the delta's own shape and colours: a drab grey-olive feather of scrub, not the game's green)
    if (p.stakes.length > 0) {
      const stake = (): BufferGeometry => {
        const g = new CylinderGeometry(0.05, 0.07, 1, 5, 1);
        g.translate(0, 0.5, 0);
        const n = g.attributes.position!.count;
        const c = new Color(P.pilingDark);
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const t = g.attributes.position!.getY(i);
          const cc = c.clone().lerp(new Color(P.pilingLight), t * 0.6);
          col[i * 3] = cc.r;
          col[i * 3 + 1] = cc.g;
          col[i * 3 + 2] = cc.b;
        }
        g.setAttribute("color", new BufferAttribute(col, 3));
        return g;
      };
      this.instanced("stakes", stake, this.track(toonMaterial({ wetDark: 0.4 })), p.stakes, undefined);
    }
  }

  // ---- the solid things, the cloth, the water -------------------------------------------------------------------------------------------

  private addSolid(): void {
    const lod: Lod = this.detail.outlines ? 1 : 0;
    const solid = buildSaltmarketSolid(this.world, lod);
    this.lamps = solid.lamps;
    this.doors = solid.marks;
    doorGroups(this.root, solid.marks);
    const hullSolid = this.detail.outlines ? buildSaltmarketSolid(this.world, 0) : undefined;
    const hulls = hullSolid?.geometries;
    const mat = this.track(toonMaterial({ wetDark: 0.8 }));
    // the interiors' roofs: one mesh (and one ink hull) in which the roof over the room the viewer is in is dropped
    if (solid.roofs) {
      this.roofSet = new RoofSet(this.root, solid.roofs, hullSolid?.roofs, mat, { name: "roofs", outline: this.detail.outlines, ink: "medium" });
      for (const g of this.roofSet.geometries) this.track(g);
    }
    solid.geometries.forEach((g, i) => {
      if (!g) return;
      this.track(g);
      const hull = hulls?.[i];
      if (hull) this.track(hull);
      makeSolid(this.root, g, mat, { name: `delta${i}`, outline: this.detail.outlines, ink: "medium", hullGeometry: hull, castShadow: true });
    });
    // the boardwalk planks: their own draws, without ink (a plank is a plank)
    const plankMat = this.track(toonMaterial({ wetDark: 0.8 }));
    buildSaltmarketPlanks(this.world, lod).forEach((g, i) => {
      if (!g) return;
      this.track(g);
      const m = new Mesh(g, plankMat);
      m.name = `planks${i}`;
      m.receiveShadow = true;
      this.root.add(m);
    });
  }

  private addCloth(terrain: SaltmarketTerrain): void {
    const geo = buildSaltmarketCloth(terrain);
    if (!geo) return;
    const atlas = createSaltmarketAtlas();
    if (atlas) this.track(atlas);
    const mesh = new Mesh(this.track(geo), this.track(saltmarketClothMaterial(atlas)));
    mesh.name = "cloth";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // (the ripple moves vertices past the static bounds; one draw either way)
    this.root.add(mesh);
  }

  private addWater(terrain: SaltmarketTerrain): void {
    const w = buildSaltmarketWater(terrain, this.segments, this.detail.waterFx);
    if (!w) return;
    this.track(w.mesh.geometry);
    this.track(w.material as unknown as { dispose(): void });
    this.water = w.uniforms;
    this.waterMaterial = w.material;
    this.root.add(w.mesh);
    // the Exchange's flood shares the material (and so the day's light): a surface over the hall that rises with the tide
    const E = SALTMARKET_ANCHORS.exchange;
    this.flood = buildFloodMesh(w.material, this.world.terrainHeight(E.x, E.z));
    this.track(this.flood.geometry);
    this.root.add(this.flood);
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
    // egrets and herons over the flats
    const wheel: Vector3[] = [];
    if (d.birds > 0) {
      const spots: [number, number][] = [[-50, 20], [60, -30], [10, -70], [-80, -40], [90, 40], [0, 70]];
      for (let i = 0; i < Math.min(spots.length, d.birds); i++) {
        const [x, z] = spots[i]!;
        wheel.push(new Vector3(x, this.world.terrainHeight(x, z) + 9 + (i % 3) * 2, z));
      }
    }
    add(buildBirds(d.birds, this.ambientU, wheel));
    // the lanterns: a candle's glow by day, a flame at dusk
    add(buildLanternGlow(this.lamps.map((l) => new Vector3(l.x, l.y, l.z)), this.ambientU, this.lamps.map((l) => l.lit ?? 0)));
    const rain = buildRain(d.rain, this.ambientU.uBaseY);
    if (rain) {
      this.track(rain.geometry);
      this.track(rain.material as unknown as { dispose(): void });
      this.root.add(rain);
      this.rainMesh = rain;
    }
  }

  // ---- the dress: the delta has no outpost (the Society builds at Kessar only) ------------------------------------------------------------

  applyDress(_d: RegionDress): void {
    /* not this slice: an outpost in the delta is not in D-037 */
  }

  /** The contract on show (or none): the Exchange's water follows it. Never collision. */
  applyScenario(v: ScenarioView | undefined): void {
    this.scenario = v;
    if (!v || v.template !== "flooded_market") this.level = FLOOD.base;
    this.setLevel(this.level);
  }

  /** Once a frame for the local player: the roof of the room the viewer stands in is lifted (docs/LEVEL_PLAN.md section 4, rule 7). */
  setViewer(x: number, z: number): void {
    this.fill.setInside(this.roofSet?.setViewer(saltmarketLevel().rooms, x, z) !== undefined);
  }

  /** The doors the view drew (for tests and tools). */
  get doorMarks(): readonly DoorMark[] {
    return this.doors;
  }

  /** The roof set (for tests and tools). */
  get roofs(): RoofSet | undefined {
    return this.roofSet;
  }

  /** The flood's current level above the hall's floor, metres (for tests and tooling). */
  get floodLevel(): number {
    return this.level;
  }

  private setLevel(l: number): void {
    this.level = l;
    if (this.flood) this.flood.position.y = (this.flood.userData.floorY as number) + l;
  }

  // ---- the day ---------------------------------------------------------------------------------------------------------------------------

  applyDay(d: DayState): void {
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
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
    this.ambientU.uFly.value = Math.max(d.dusk * 0.85, d.night) * (1 - d.rain); // (no fireflies out in the rain)
    this.ambientU.uLamp.value = Math.max(d.fire, d.dusk * 0.9);   // the lanterns are lit at dusk
    this.ambientU.uLight.value.copy(this.tint);
    atmoUniforms.uHour.value = d.hours;
  }

  /** The reeds and sedge bend away from up to four walkers (the same pusher slots the whole world uses). */
  setPushers(list: readonly { x: number; z: number }[], n = list.length): void {
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const u = pushers.value[i]!;
      if (i < n && i < list.length) u.set(list[i]!.x, list[i]!.z, 1.5, 1);
      else u.set(0, 0, 1, 0);
    }
  }

  update(t: number, camera?: { x: number; y?: number; z: number }, worldSec?: number): void {
    worldTime.value = t;
    this.fill.update(t);
    if (camera) this.ambientU.uBaseY.value = this.world.terrainHeight(camera.x, camera.z);
    this.ambientU.uMotion.value = motion.value;
    if (this.rainMesh) this.rainMesh.visible = atmoUniforms.uRain.value > 0.01;
    // the flood: while the auction runs it is a pure function of its clock, and it never goes down; after the sale the view holds it
    const target = floodTarget(this.scenario, worldSec ?? t, this.level);
    if (target !== this.level && (target > this.level || !this.scenario || this.scenario.template !== "flooded_market")) this.setLevel(target);
  }

  dispose(): void {
    disposeTree(this.root as Object3D);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
