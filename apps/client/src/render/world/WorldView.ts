import {
  AdditiveBlending,
  BufferGeometry,
  Color,
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
import { CAMP, PALETTE, classifyObstacle, smoothstep, type CollisionWorld, type DayState, type LandscapeTerrain } from "@cb/shared";
import { sharedToonRamp, type WorldInkClass } from "@cb/procedural/three";
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
  fernGeometry,
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
import { lanternGlass } from "./camplife.ts";
import { buildRuins } from "./ruins.ts";
import { BLOOM_HUES, GRASS_DRY, GRASS_MEADOW, planScatter, type Item, type ScatterPlan } from "./scatter.ts";
import { setRgb } from "./sky.ts";
import { buildTerrain, trailMaskTexture, trailOverlayPatch } from "./terrain.ts";
import { buildFalls, buildWaterMesh, type WaterUniforms } from "./water.ts";
import { composeInstance, fireLight, makeInstances, makeSolid, MAX_PUSHERS, pushers, toonMaterial, worldTime, type InstanceSet, type WindKind } from "./toon.ts";

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
      this.addRuin();
      this.addWater();
      this.addAmbient(plan);
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
    const terrain = new Mesh(ground, this.track(toonMaterial({ colourPatch: patch })));
    terrain.name = "terrain";
    terrain.receiveShadow = true;
    this.root.add(terrain);

    const skirt = new Mesh(this.track(buildSkirt()), this.track(toonMaterial({ fire: false })));
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
    return set;
  }

  /** Per-instance colour multipliers: a gentle spread round 1 driven by one random number. */
  private varied(v: number, spread = 0.14): Color {
    return new Color(1 - spread * 0.5 + fract(v * 9.13) * spread, 1 - spread * 0.4 + fract(v * 4.71) * spread * 0.8, 1 - spread * 0.5 + fract(v * 7.37) * spread);
  }

  // ---- trees, rocks, timber, shrubs ----------------------------------------------------------------------------------------------

  private addTrees(p: ScatterPlan): void {
    const treeMat = this.track(toonMaterial({ wind: "tree" }));
    // Shrubs are not solid, so a camera can end up inside one. An ink hull seen from inside is a black screen, so shrubs carry no
    // hull (the shading and the toon ramp outline them well enough); double-sided so the inside of a bush is green, not a hole.
    const bushMat = this.track(toonMaterial({ doubleSided: true }));
    for (const kind of ["broadleaf", "acacia", "snag"] as const) {
      const build = kind === "broadleaf" ? broadleafGeometry : kind === "acacia" ? acaciaGeometry : snagGeometry;
      this.instanced(kind, build, treeMat, p[kind], p[kind].map((i) => this.varied(i.v, 0.16)), { shadow: true, ink: "large", wind: "tree" });
    }
    this.instanced("bush", bushGeometry, bushMat, p.bushes, p.bushes.map((i) => this.varied(i.v, 0.2)));
    this.instanced("berry-bush", berryBushGeometry, bushMat, p.berries, p.berries.map((i) => this.varied(i.v, 0.12)));
  }

  private addRocks(p: ScatterPlan): void {
    const rockMat = this.track(toonMaterial());
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
    const glass = lanternGlass(this.world);
    if (glass) {
      this.lanternMat = this.track(new MeshBasicMaterial({ vertexColors: true, fog: true }));
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
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float wave;\nuniform float uTime;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float w = wave * wave;
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
      const pool = new Mesh(this.track(new PlaneGeometry(7, 7)), this.pool);
      pool.name = "fire-pool";
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(o.x, y + 0.06, o.z);
      pool.renderOrder = 1;
      this.root.add(pool);
    }
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

  private addWater(): void {
    const t = this.world.terrain as Partial<LandscapeTerrain>;
    if (typeof t.channelLevel !== "function") return;
    const { mesh, uniforms } = buildWaterMesh(this.world.terrain as LandscapeTerrain, this.detail.waterFx);
    this.track(mesh.geometry);
    this.track(mesh.material as unknown as { dispose(): void });
    this.water = uniforms;
    this.root.add(mesh);
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
    add(buildLanternGlow(CAMP.lanterns.map((l) => new Vector3(l.x, this.world.terrainHeight(l.x, l.z) + l.y, l.z)), this.ambientU));
  }

  // ---- the day and the walkers -------------------------------------------------------------------------------------------------

  /** Lights the scenery for a moment of the day: hills, water, ambient life, the fire and the lanterns. */
  applyDay(d: DayState): void {
    setRgb(this.hillU.uFog.value, d.horizon);
    this.hillU.uSunDir.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    // one tint for everything not lit by the scene's lights: the light's colour, dimmed by how much sky is left
    setRgb(this.tint, d.sun);
    this.tint.lerp(WHITE, 0.4).multiplyScalar(0.42 + 0.58 * d.ambient);
    this.hillU.uTint.value.copy(this.tint);
    if (this.water) {
      this.water.uLight.value.copy(this.tint);
      this.water.uSun.value = 1 - d.night;
      this.water.uSunDir.value.set(d.lightDir.x, d.lightDir.y, d.lightDir.z);
    }
    this.ambientU.uDay.value = 1 - smoothstep(0.25, 0.85, d.night);
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
  update(t: number, camera?: { x: number; z: number }): void {
    worldTime.value = t;
    if (camera) this.ambientU.uBaseY.value = this.world.terrainHeight(camera.x, camera.z);
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
