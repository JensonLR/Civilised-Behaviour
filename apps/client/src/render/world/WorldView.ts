import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
  type Scene,
  type Texture,
} from "three";
import { PALETTE, autumnAt, buildFlock, classifyObstacle, smoothstep, type CollisionWorld, type DayState, type LandscapeTerrain } from "@cb/shared";
import { sharedToonRamp, type WorldInkClass } from "@cb/procedural/three";
import { atmoUniforms, motion } from "./atmosphere.ts";
import { createAtlasTexture, createGlowTexture } from "./atlas.ts";
import { createAmbientUniforms, buildBirds, buildButterflies, buildLanternGlow, buildMotes, buildSmoke, type AmbientUniforms, type SmokeSource } from "./ambient.ts";
import {
  acaciaGeometry,
  berryBushGeometry,
  boulderGeometry,
  broadleafGeometry,
  bushGeometry,
  cupGeometry,
  daisyGeometry,
  birchGeometry,
  fernGeometry,
  flagstoneGeometry,
  lilyGeometry,
  pineGeometry,
  grassTuftGeometry,
  logGeometry,
  mushroomGeometry,
  pebbleGeometry,
  reedGeometry,
  slabGeometry,
  snagGeometry,
  stumpGeometry,
  type Lod,
} from "./flora.ts";
import { buildHills, buildSkirt, buildTreeLine, createHillUniforms, hillMaterial, treeLineMaterial, type HillUniforms } from "./horizon.ts";
import { disposeTree } from "./kit.ts";
import { buildBanners, buildFlame, buildLandmarks } from "./landmarks.ts";
import { buildCampCloth, lanternGlass, lanternSpots } from "./camplife.ts";
import { buildRain } from "./rain.ts";
import { buildRuins } from "./ruins.ts";
import { buildAnimals, setAnimalGround, type Flock } from "./animals.ts";
import { buildClearing } from "./clearing.ts";
import { BLOOM_HUES, GRASS_DRY, GRASS_MEADOW, planScatter, type Item, type ScatterPlan } from "./scatter.ts";
import { setRgb } from "./sky.ts";
import { buildTerrain, trailMaskTexture, trailOverlayPatch } from "./terrain.ts";
import { buildFalls, buildWaterMesh, type WaterUniforms } from "./water.ts";
import { clothBasicMaterial, composeInstance, fireLight, makeInstances, makeSolid, MAX_PUSHERS, pushers, toonMaterial, worldTime, type InstanceSet, type WindKind } from "./toon.ts";

/** What a graphics preset decides about the world. */
export interface WorldDetail {
  outlines: boolean;
  terrainSegments: number;
  grassTufts: number;
  flowers: number;
  bushes: number;
  clutter: number;
  treeLine: number;
  trailOverlay: boolean;
  waterFx: boolean;
  motes: number;
  butterflies: number;
  birds: number;
  smoke: number;
  /** Rain streaks in the pool (0 builds none and no puddles: low keeps only the weather's tint and fog). */
  rain: number;
  /** Sheep and goats (0 builds none). */
  flock: number;
  /** Birch and pine as species of their own (each is one more instanced set); off = they stand as broadleaf and acacia. */
  species: boolean;
}

const W = PALETTE.world;
const WHITE = new Color(1, 1, 1);

export interface WorldStats {
  /** Draw calls the world adds to a frame (main pass; shadow pass repeats the casters). */
  meshes: number;
  triangles: number;
  /** Triangles per named part (instances counted), for docs/PERFORMANCE.md. */
  parts: Record<string, number>;
}

const trianglesOf = (g: BufferGeometry, instances = 1): number => ((g.index ? g.index.count : g.attributes.position!.count) / 3) * instances;
const fract = (x: number): number => x - Math.floor(x);

interface SetOptions {
  shadow?: boolean;
  ink?: WorldInkClass;
  wind?: WindKind;
  /** Skip frustum culling (one draw either way for a map-wide set). */
  noCull?: boolean;
  /** Leaves take the region's autumn (the material must have `season: true`). */
  season?: boolean;
}

/**
 * Everything static in the world, dressed from the shared deterministic obstacles: painted terrain with footpaths, the stream, hill
 * rings with a tree line, three tree species that sway, rocks, shrubs, meadows of flowers, ferns, reeds and toadstools, the expedition
 * camp, the Observatory ruin, and the ambient life. Everything repeated is an InstancedMesh; everything is toon-shaded with the
 * characters' ramp; solid things get a (thinner) ink outline when the preset asks for it. `applyDay` lights the scenery for a moment of
 * the day, `update` animates wind, fire and life without allocating.
 */
export class WorldView {
  readonly root = new Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly hillU: HillUniforms;
  private readonly ambientU: AmbientUniforms = createAmbientUniforms();
  private readonly tint = new Color(1, 1, 1);
  private flame?: Mesh;
  private glow?: SpriteMaterial;
  private pool?: MeshBasicMaterial;
  private lanternMat?: MeshBasicMaterial;
  private water?: WaterUniforms;
  private fireLevel = 0;
  readonly stats: WorldStats = { meshes: 0, triangles: 0, parts: {} };

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly detail: WorldDetail,
    sun: Vector3,
  ) {
    this.root.name = "world";
    scene.add(this.root);
    this.hillU = createHillUniforms(sun);
    this.addTerrain();
    if (world.obstacles.length > 0) {
      const plan = planScatter(world, detail);
      this.addTrees(plan);
      this.addRocks(plan);
      this.addTimber(plan);
      this.addGroundCover(plan);
      this.addCamp();
      this.addClearing(plan);
      this.addRuin();
      this.lilies = this.detail.rain > 0 ? plan.lilies : []; // (low has no lily pads)
      this.addWater();
      this.addAmbient(plan);
      this.addRain();
      this.addFlock();
    }
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
        const t = m.isPoints ? 0 : trianglesOf(m.geometry, m.isInstancedMesh ? (m.count ?? 1) : 1);
        tris += t;
        this.stats.parts[o.name || o.type] = Math.round(t);
      }
    });
    this.stats.meshes = meshes;
    this.stats.triangles = Math.round(tris);
  }

  // ---- ground, hills, skirt ---------------------------------------------------------------------------------------------------

  private addTerrain(): void {
    const ground = this.track(buildTerrain(this.world.terrain, this.detail.terrainSegments));
    let patch: ReturnType<typeof trailOverlayPatch> | undefined;
    if (this.detail.trailOverlay && this.world.obstacles.length > 0) {
      const mask = this.track(trailMaskTexture());
      patch = trailOverlayPatch(mask);
    }
    const terrain = new Mesh(ground, this.track(toonMaterial({ colourPatch: patch, puddles: this.detail.rain > 0, wetDark: 1 })));
    terrain.name = "terrain";
    terrain.receiveShadow = true;
    this.root.add(terrain);

    const skirt = new Mesh(this.track(buildSkirt()), this.track(toonMaterial({ fire: false, wetDark: 1 })));
    skirt.name = "skirt";
    skirt.receiveShadow = false;
    this.root.add(skirt);

    const hillGeo = buildHills();
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

  // ---- instancing helpers ------------------------------------------------------------------------------------------------------

  private instanced(name: string, build: (lod: Lod) => BufferGeometry, material: MeshToonMaterial, items: readonly Item[], colours: Color[] | undefined, o: SetOptions = {}): InstanceSet | undefined {
    if (items.length === 0) return undefined;
    const mats = items.map((it) => composeInstance(new Matrix4(), it.x, it.y, it.z, it.yaw, it.sx, it.sy, it.sz, it.tiltX ?? 0, it.tiltZ ?? 0));
    const geo = this.track(build(1));
    const ink = this.detail.outlines && o.ink !== undefined;
    const hull = ink ? this.track(build(0)) : undefined;
    const set = makeInstances(this.root, geo, material, mats, colours, { name, castShadow: o.shadow ?? false, outline: ink, ink: o.ink, wind: o.wind, hullGeometry: hull });
    if (set && o.noCull) set.mesh.frustumCulled = false;
    if (set && o.season) {
      const a = new Float32Array(items.length * 2);
      const au = { amount: 0, hue: 0 };
      items.forEach((it, i) => {
        autumnAt(it.x, it.z, au);
        // most leaves in a turned patch have turned; a few holdouts stay green
        a[i * 2] = au.amount * (0.7 + 0.3 * fract(it.v * 3.7)) * (fract(it.v * 13.1) < 0.9 ? 1 : 0);
        a[i * 2 + 1] = Math.min(0.999, au.hue * 0.75 + fract(it.v * 5.3) * 0.25);
      });
      set.mesh.geometry.setAttribute("aSeason", new InstancedBufferAttribute(a, 2));
    }
    return set;
  }

  /** Per-instance colour multipliers: a gentle spread round 1 driven by one random number. */
  private varied(v: number, spread = 0.14): Color {
    return new Color(1 - spread * 0.5 + fract(v * 9.13) * spread, 1 - spread * 0.4 + fract(v * 4.71) * spread * 0.8, 1 - spread * 0.5 + fract(v * 7.37) * spread);
  }

  // ---- trees, rocks, timber, shrubs ----------------------------------------------------------------------------------------------

  private addTrees(p: ScatterPlan): void {
    const treeMat = this.track(toonMaterial({ wind: "tree", season: true }));
    const pineMat = this.track(toonMaterial({ wind: "tree" }));
    // Shrubs are not solid, so a camera can end up inside one. An ink hull seen from inside is a black screen, so shrubs carry no
    // hull (the shading and the toon ramp outline them well enough); double-sided so the inside of a bush is green, not a hole.
    const bushMat = this.track(toonMaterial({ doubleSided: true, season: true }));
    // (low keeps four instanced sets fewer: birch stands as broadleaf and pine as acacia)
    const kinds: { key: "broadleaf" | "acacia" | "birch" | "pine" | "snag"; build: (lod: Lod) => BufferGeometry; items: Item[]; mat: MeshToonMaterial; season: boolean }[] = [
      { key: "broadleaf", build: broadleafGeometry, items: this.detail.species ? p.broadleaf : [...p.broadleaf, ...p.birch], mat: treeMat, season: true },
      { key: "acacia", build: acaciaGeometry, items: this.detail.species ? p.acacia : [...p.acacia, ...p.pine], mat: treeMat, season: true },
      { key: "snag", build: snagGeometry, items: p.snag, mat: pineMat, season: false },
    ];
    if (this.detail.species) {
      kinds.push({ key: "birch", build: birchGeometry, items: p.birch, mat: treeMat, season: true }, { key: "pine", build: pineGeometry, items: p.pine, mat: pineMat, season: false });
    }
    for (const k of kinds) this.instanced(k.key, k.build, k.mat, k.items, k.items.map((i) => this.varied(i.v, 0.16)), { shadow: true, ink: "large", wind: "tree", season: k.season });
    this.instanced("bush", bushGeometry, bushMat, p.bushes, p.bushes.map((i) => this.varied(i.v, 0.2)), { season: true });
    this.instanced("berry-bush", berryBushGeometry, bushMat, p.berries, p.berries.map((i) => this.varied(i.v, 0.12)), { season: true });
  }

  private addRocks(p: ScatterPlan): void {
    const rockMat = this.track(toonMaterial({ wetDark: 1 }));
    this.instanced("rock", boulderGeometry, rockMat, p.rocks, p.rocks.map((i) => this.varied(i.v, 0.14)), { shadow: true, ink: "medium" });
    this.instanced("slab", slabGeometry, rockMat, p.slabs, p.slabs.map((i) => this.varied(i.v, 0.12)), { shadow: true, ink: "medium" });
    this.instanced("pebbles", () => pebbleGeometry(), rockMat, p.pebbles, p.pebbles.map((i) => this.varied(i.v, 0.3)));
  }

  private addTimber(p: ScatterPlan): void {
    const mat = this.track(toonMaterial());
    this.instanced("stump", stumpGeometry, mat, p.stumps, p.stumps.map((i) => this.varied(i.v, 0.14)), { shadow: true, ink: "small" });
    this.instanced("log", logGeometry, mat, p.logs, p.logs.map((i) => this.varied(i.v, 0.14)), { shadow: true, ink: "small" });
  }

  // ---- grass, flowers, ferns, reeds, toadstools ----------------------------------------------------------------------------------

  private addGroundCover(p: ScatterPlan): void {
    const grass = new Color(W.grass);
    // Tints that turn the tuft's green into the dry or meadow palette colour when multiplied in.
    const ratio = (to: number): Color => {
      const c = new Color(to);
      return c.setRGB(Math.min(c.r / grass.r, 1.5), Math.min(c.g / grass.g, 1.5), Math.min(c.b / grass.b, 1.5));
    };
    const dryTint = ratio(W.dry);
    const meadowTint = ratio(W.meadow);
    const grassCols = p.grass.map((i) => {
      const c = this.varied(i.v, 0.22);
      if (i.cls === GRASS_MEADOW) c.multiply(meadowTint);
      else if (i.cls === GRASS_DRY) c.multiply(dryTint);
      return c;
    });
    this.instanced("grass", () => grassTuftGeometry(), this.track(toonMaterial({ doubleSided: true, wind: "grass" })), p.grass, grassCols, { noCull: true });

    const bloomHex = [W.bloomRed, W.bloomYellow, W.bloomBlue, W.bloomWhite, W.bloomViolet];
    const cupHex = [W.bloomRed, W.bloomYellow, W.bloomBlue, W.bloomWhite, W.bloomPink];
    if (bloomHex.length !== BLOOM_HUES) throw new Error("bloom palette out of step with BLOOM_HUES");
    // blooms glow a little: toon light would otherwise dull them
    const bloomCol = (hex: number[], i: Item): Color => new Color(hex[i.cls % hex.length]!).multiplyScalar(1.28 + fract(i.v * 5.3) * 0.2);
    const floraMat = this.track(toonMaterial({ doubleSided: true, wind: "flora", tinted: true }));
    this.instanced("daisies", () => daisyGeometry(), floraMat, p.daisies, p.daisies.map((i) => bloomCol(bloomHex, i)), { noCull: true });
    this.instanced("cups", () => cupGeometry(), floraMat, p.cups, p.cups.map((i) => bloomCol(cupHex, i)), { noCull: true });

    const fernMat = this.track(toonMaterial({ doubleSided: true, wind: "flora" }));
    this.instanced("ferns", () => fernGeometry(), fernMat, p.ferns, p.ferns.map((i) => this.varied(i.v, 0.24)), { noCull: true });
    const reedMat = this.track(toonMaterial({ doubleSided: true, wind: "reed" }));
    this.instanced("reeds", () => reedGeometry(), reedMat, p.reeds, p.reeds.map((i) => this.varied(i.v, 0.2)), { noCull: true });
    const capMat = this.track(toonMaterial({ doubleSided: true }));
    this.instanced("toadstools", () => mushroomGeometry(), capMat, p.mushrooms, p.mushrooms.map((i) => this.varied(i.v, 0.2)), { noCull: true });
  }

  // ---- the camp ---------------------------------------------------------------------------------------------------------------

  private addCamp(): void {
    const geo = buildLandmarks(this.world, 1);
    if (geo) {
      const hull = this.detail.outlines ? buildLandmarks(this.world, 0) : undefined;
      this.track(geo);
      if (hull) this.track(hull);
      makeSolid(this.root, geo, this.track(toonMaterial()), { name: "camp", outline: this.detail.outlines, ink: "medium", hullGeometry: hull, castShadow: true });
    }
    // the washing, the hammock's canvas and the lanterns' chains and frames move in the wind: their own geometry, shadow and ink
    const cloth = buildCampCloth(this.world, 1);
    if (cloth) {
      const clothHull = this.detail.outlines ? buildCampCloth(this.world, 0) : undefined;
      this.track(cloth);
      if (clothHull) this.track(clothHull);
      makeSolid(this.root, cloth, this.track(toonMaterial({ wind: "cloth", doubleSided: true })), { name: "camp-cloth", outline: this.detail.outlines, ink: "small", hullGeometry: clothHull, castShadow: true, wind: "cloth" });
    }
    const glass = lanternGlass(this.world);
    if (glass) {
      this.lanternMat = this.track(clothBasicMaterial());
      const m = new Mesh(this.track(glass), this.lanternMat);
      m.name = "lantern-glass";
      this.root.add(m);
    }
    const banners = buildBanners(this.world);
    if (banners) {
      const map = this.track(createAtlasTexture());
      const mat = this.track(new MeshToonMaterial({ map, alphaTest: 0.5, side: DoubleSide, gradientMap: sharedToonRamp() }));
      mat.onBeforeCompile = (shader): void => {
        shader.uniforms.uTime = worldTime;
        shader.uniforms.uWindK = atmoUniforms.uWindK;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float wave;\nuniform float uTime;\nuniform float uWindK;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float w = wave * wave * uWindK; // the wind (and the motion preference) sets how hard the pennant streams and flaps
            transformed.z += (sin(uTime * 3.2 - position.x * 2.6) * 0.16 + sin(uTime * 5.3 - position.x * 4.1) * 0.05) * w;
            transformed.y += sin(uTime * 2.4 - position.x * 2.0) * 0.06 * w - 0.05 * w;`,
          );
      };
      mat.customProgramCacheKey = (): string => "banner";
      const mesh = new Mesh(banners, mat);
      mesh.name = "banners";
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.track(banners);
      this.root.add(mesh);
    }
    for (const o of this.world.obstacles) {
      if (classifyObstacle(o) !== "fire") continue;
      const y = this.world.terrainHeight(o.x, o.z);
      fireLight.uFirePos.value.set(o.x, y + 0.6, o.z);
      const flame = new Mesh(this.track(buildFlame()), this.track(new MeshBasicMaterial({ vertexColors: true, fog: false })));
      flame.name = "flame";
      flame.position.set(o.x, y + 0.14, o.z);
      this.root.add(flame);
      this.flame = flame;
      const tex: Texture = this.track(createGlowTexture());
      const glow = new SpriteMaterial({ map: tex, color: PALETTE.camp.glow, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.6 });
      this.glow = this.track(glow);
      const sprite = new Sprite(glow);
      sprite.name = "fire-glow";
      sprite.position.set(o.x, y + 0.8, o.z);
      sprite.scale.setScalar(3.4);
      this.root.add(sprite);
      this.pool = this.track(new MeshBasicMaterial({ map: tex, color: PALETTE.camp.glow, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.32 }));
      // the pool of firelight lies ON the ground (a flat plane would be clipped by every swell into a hard-edged ellipse)
      const poolGeo = new PlaneGeometry(7, 7, 14, 14);
      poolGeo.rotateX(-Math.PI / 2);
      const pp = poolGeo.attributes.position!;
      for (let i = 0; i < pp.count; i++) pp.setY(i, this.world.terrainHeight(o.x + pp.getX(i), o.z + pp.getZ(i)) - y + 0.07);
      const pool = new Mesh(this.track(poolGeo), this.pool);
      pool.name = "fire-pool";
      pool.position.set(o.x, y, o.z);
      pool.renderOrder = 1;
      this.root.add(pool);
    }
  }

  // ---- the well, the pen, the signposts, the footbridge, the flagstones ---------------------------------------------------------------

  private addClearing(p: ScatterPlan): void {
    const geo = buildClearing(this.world, 1);
    if (geo) {
      const hull = this.detail.outlines ? buildClearing(this.world, 0) : undefined;
      this.track(geo);
      if (hull) this.track(hull);
      makeSolid(this.root, geo, this.track(toonMaterial({ wetDark: 0.8 })), { name: "clearing", outline: this.detail.outlines, ink: "small", hullGeometry: hull, castShadow: true });
    }
    // flat stepping stones: in the ford and round the well
    const stoneMat = this.track(toonMaterial({ wetDark: 1 }));
    this.instanced("flagstones", () => flagstoneGeometry(), stoneMat, p.flagstones, p.flagstones.map((i) => this.varied(i.v, 0.16)), { noCull: true });
  }

  // ---- the flock -------------------------------------------------------------------------------------------------------------------------

  private flock?: Flock;

  private addFlock(): void {
    if (this.detail.flock <= 0) return;
    setAnimalGround(this.world);
    const flock = buildAnimals(buildFlock(this.world), this.detail.outlines);
    if (!flock) return;
    for (const m of flock.meshes()) this.root.add(m);
    for (const set of flock.sets) {
      this.track(set.mesh.geometry);
      this.track(set.mesh.material as unknown as { dispose(): void });
    }
    this.flock = flock;
    flock.update(0);
  }

  // ---- the Observatory ---------------------------------------------------------------------------------------------------------

  private addRuin(): void {
    const geo = buildRuins(this.world.terrain, 1);
    if (!geo) return;
    const hull = this.detail.outlines ? buildRuins(this.world.terrain, 0) : undefined;
    this.track(geo);
    if (hull) this.track(hull);
    makeSolid(this.root, geo, this.track(toonMaterial()), { name: "ruin", outline: this.detail.outlines, ink: "large", hullGeometry: hull, castShadow: true });
  }

  // ---- water -------------------------------------------------------------------------------------------------------------------

  private lilies: Item[] = [];

  private addWater(): void {
    const t = this.world.terrain as Partial<LandscapeTerrain>;
    if (typeof t.channelLevel !== "function") return;
    const { mesh, uniforms } = buildWaterMesh(this.world.terrain as LandscapeTerrain, this.detail.waterFx);
    this.track(mesh.geometry);
    this.track(mesh.material as unknown as { dispose(): void });
    this.water = uniforms;
    this.root.add(mesh);
    if (this.lilies.length > 0) this.instanced("lilies", () => lilyGeometry(), this.track(toonMaterial({ doubleSided: true, fire: false, wetDark: 0.3 })), this.lilies, this.lilies.map((i) => this.varied(i.v, 0.25)), { noCull: true });
    const falls = buildFalls(this.world.terrain as LandscapeTerrain);
    if (falls) {
      this.track(falls.geometry);
      this.track(falls.material as unknown as { dispose(): void });
      // the falls share the stream's light tint
      (falls.material as unknown as { uniforms: Record<string, unknown> }).uniforms.uLight = uniforms.uLight;
      this.root.add(falls);
    }
  }

  // ---- ambient life ------------------------------------------------------------------------------------------------------------

  private addAmbient(p: ScatterPlan): void {
    const d = this.detail;
    const add = (o: Object3D | undefined): void => {
      if (!o) return;
      this.root.add(o);
      const m = o as Mesh;
      if (m.geometry) this.track(m.geometry);
      this.track(m.material as unknown as { dispose(): void });
    };
    add(buildMotes(d.motes, this.ambientU));
    add(buildButterflies(p.butterflies.map((b) => new Vector3(b.x, b.y, b.z)), d.butterflies, this.ambientU));
    add(buildBirds(d.birds, this.ambientU));
    const sources: SmokeSource[] = [];
    if (d.smoke > 0) {
      for (const o of this.world.obstacles) {
        if (classifyObstacle(o) !== "fire") continue;
        const y = this.world.terrainHeight(o.x, o.z);
        sources.push({ at: new Vector3(o.x, y + 0.6, o.z), kind: 0, puffs: Math.max(4, Math.round(d.smoke * 0.72)) });
        sources.push({ at: new Vector3(o.x, y + 1.2, o.z), kind: 1, puffs: Math.max(3, Math.round(d.smoke * 0.28)) });
      }
    }
    add(buildSmoke(sources, this.ambientU));
    // lantern glows (cheap; kept on every preset so the camp still lights up at dusk)
    const spots = lanternSpots(this.world);
    add(buildLanternGlow(spots.map((l) => new Vector3(l.x, this.world.terrainHeight(l.x, l.z) + l.y, l.z)), this.ambientU, spots.map((_, i) => (i === spots.length - 1 ? 0.7 : 0))));
  }

  // ---- rain -----------------------------------------------------------------------------------------------------------------------

  private rainMesh?: Mesh;

  private addRain(): void {
    const rain = buildRain(this.detail.rain, this.ambientU.uBaseY);
    if (!rain) return;
    this.track(rain.geometry);
    this.track(rain.material as unknown as { dispose(): void });
    this.root.add(rain);
    this.rainMesh = rain;
  }

  // ---- the day and the walkers -------------------------------------------------------------------------------------------------

  /** Lights the scenery for a moment of the day: hills, water, ambient life, the fire and the lanterns. */
  applyDay(d: DayState): void {
    setRgb(this.hillU.uFog.value, d.horizon);
    this.hillU.uSunDir.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    this.hillU.uExtraFog.value = Math.max(0, d.fogDensity - 0.0105); // the weather's fog on top of the day's
    // one tint for everything not lit by the scene's lights: the light's colour, dimmed by how much sky is left
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    this.hillU.uTint.value.copy(this.tint);
    if (this.water) {
      this.water.uLight.value.copy(this.tint);
      this.water.uSun.value = 1 - d.night;
      this.water.uSunDir.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    }
    // Weather on the ground: puddles mirror the (already weathered) sky and glint with the light; the light is the sun's or the moon's
    // colour, dimmed by the cloud, plus any lightning
    setRgb(atmoUniforms.uSheen.value, d.mid);
    atmoUniforms.uSheen.value.lerp(this.tint.set(1, 1, 1), 0.5 * d.flash).multiplyScalar(0.62 + 0.6 * d.flash);
    atmoUniforms.uSunDirW.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    setRgb(atmoUniforms.uSunColW.value, d.sun).multiplyScalar(Math.min(1, d.sunIntensity / 3) * (1 - 0.8 * d.cover) + d.flash);
    // recompute the shared tint (the sheen borrowed it above)
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    // butterflies, birds and pollen stay in when it rains
    const fine = 1 - Math.min(1, d.rain * 1.6 + Math.max(0, d.cover - 0.7));
    this.ambientU.uDay.value = (1 - smoothstep(0.25, 0.85, d.night)) * fine;
    this.ambientU.uFly.value = Math.max(d.dusk * 0.85, d.night);
    this.ambientU.uLamp.value = d.fire;
    this.ambientU.uLight.value.copy(this.tint);
    fireLight.uFireI.value = d.fire;
    this.fireLevel = d.fire;
    if (this.lanternMat) this.lanternMat.color.setScalar(0.52 + 0.48 * d.fire);
  }

  /** Up to four things the grass and flowers bend away from. Entries past `n` are cleared. */
  setPushers(list: readonly { x: number; z: number }[], n = list.length): void {
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const u = pushers.value[i]!;
      if (i < n && i < list.length) u.set(list[i]!.x, list[i]!.z, 1.5, 1);
      else u.set(0, 0, 1, 0);
    }
  }

  /** Wind, pennant, flame and glow. Cheap: it only writes a few numbers. */
  update(t: number, camera?: { x: number; z: number }, worldSec = t): void {
    worldTime.value = t;
    this.flock?.update(worldSec);
    if (camera) this.ambientU.uBaseY.value = this.world.terrainHeight(camera.x, camera.z);
    this.ambientU.uMotion.value = motion.value;
    if (this.rainMesh) this.rainMesh.visible = atmoUniforms.uRain.value > 0.01;
    const lit = 0.3 + 0.7 * this.fireLevel;
    if (this.flame) {
      this.flame.scale.set(1 + 0.06 * Math.sin(t * 11.3), 0.95 + 0.14 * Math.sin(t * 7.1) + 0.07 * Math.sin(t * 17.9), 1 + 0.06 * Math.cos(t * 9.2));
      this.flame.rotation.y = t * 0.7;
    }
    if (this.glow) this.glow.opacity = (0.5 + 0.08 * Math.sin(t * 9.7) + 0.04 * Math.sin(t * 23.1)) * lit * (0.55 + 0.45 * this.fireLevel) + 0.08 * this.fireLevel;
    if (this.pool) this.pool.opacity = 0.34 * lit * this.fireLevel + 0.1;
  }

  dispose(): void {
    disposeTree(this.root as Object3D);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
