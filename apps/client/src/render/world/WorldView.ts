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
import { PALETTE, Rng, classifyObstacle, coverDensity, hash3, inCampFootprint, inMeadow, treeSpecies, type CollisionWorld, type Obstacle } from "@cb/shared";
import { sharedToonRamp } from "@cb/procedural/three";
import { createAtlasTexture, createGlowTexture } from "./atlas.ts";
import { TREE_BASE_RADIUS, acaciaGeometry, boulderGeometry, broadleafGeometry, bushGeometry, flowerGeometry, grassTuftGeometry, pebbleGeometry, snagGeometry, type Lod } from "./flora.ts";
import { buildHills, buildSkirt } from "./horizon.ts";
import { disposeTree } from "./kit.ts";
import { buildBanners, buildFlame, buildLandmarks } from "./landmarks.ts";
import { buildTerrain, visualHeight } from "./terrain.ts";
import { composeInstance, makeInstances, makeSolid, toonMaterial, windify, worldTime, type InstanceSet } from "./toon.ts";
import { fogColour } from "./sky.ts";

/** What a graphics preset decides about the world. */
export interface WorldDetail {
  outlines: boolean;
  terrainSegments: number;
  grassTufts: number;
  flowers: number;
  bushes: number;
}

const W = PALETTE.world;
const h01 = (seed: number, a: number, b = 0): number => hash3(seed, Math.round(a * 100), Math.round(b * 100)) / 4294967296;

export interface WorldStats {
  /** Draw calls the world adds to a frame (main pass; shadow pass repeats the casters). */
  meshes: number;
  triangles: number;
  /** Triangles per named part (instances counted), for docs/PERFORMANCE.md. */
  parts: Record<string, number>;
}

const trianglesOf = (g: BufferGeometry, instances = 1): number => ((g.index ? g.index.count : g.attributes.position!.count) / 3) * instances;

/**
 * Everything static in the world, dressed from the shared deterministic obstacles: painted terrain, hill rings and a ground skirt,
 * three tree species, rocks, shrubs, wind-swept grass and flowers, and the expedition camp. Everything repeated is an
 * InstancedMesh; everything is toon-shaded with the characters' ramp; solid things get the characters' ink outline when the
 * preset asks for it. `update(t)` animates the wind, the pennant and the fire without allocating.
 */
export class WorldView {
  readonly root = new Group();
  private readonly disposables: { dispose(): void }[] = [];
  private flame?: Mesh;
  private glow?: SpriteMaterial;
  readonly stats: WorldStats = { meshes: 0, triangles: 0, parts: {} };

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly detail: WorldDetail,
    private readonly sun: Vector3,
  ) {
    this.root.name = "world";
    scene.add(this.root);
    const fog = fogColour();
    this.addTerrain(fog);
    if (world.obstacles.length > 0) {
      this.addTrees();
      this.addRocks();
      this.addGroundCover();
      this.addCamp();
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
      const m = o as Mesh & { isInstancedMesh?: boolean; count?: number };
      if (!(m as { isMesh?: boolean }).isMesh && !(o as { isSprite?: boolean }).isSprite) return;
      meshes++;
      if (m.geometry) {
        const t = trianglesOf(m.geometry, m.isInstancedMesh ? (m.count ?? 1) : 1);
        tris += t;
        this.stats.parts[o.name || o.type] = Math.round(t);
      }
    });
    this.stats.meshes = meshes;
    this.stats.triangles = Math.round(tris);
  }

  // ---- ground, hills, skirt ---------------------------------------------------------------------------------------------------

  private addTerrain(fog: Color): void {
    const ground = this.track(buildTerrain(this.world.terrain, this.detail.terrainSegments));
    const mat = this.track(toonMaterial());
    const terrain = new Mesh(ground, mat);
    terrain.name = "terrain";
    terrain.receiveShadow = true;
    this.root.add(terrain);

    const skirt = new Mesh(this.track(buildSkirt()), this.track(toonMaterial()));
    skirt.name = "skirt";
    skirt.receiveShadow = false;
    this.root.add(skirt);

    const hills = new Mesh(this.track(buildHills(fog, this.sun)), this.track(new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide })));
    hills.name = "hills";
    hills.frustumCulled = false;
    this.root.add(hills);
  }

  // ---- trees, rocks, shrubs ----------------------------------------------------------------------------------------------------

  private instanced(
    name: string,
    build: (lod: Lod) => BufferGeometry,
    material: MeshToonMaterial,
    mats: Matrix4[],
    cols: Color[] | undefined,
    shadow: boolean,
  ): InstanceSet | undefined {
    if (mats.length === 0) return undefined;
    const geo = this.track(build(1));
    const hull = this.detail.outlines ? this.track(build(0)) : undefined;
    return makeInstances(this.root, geo, material, mats, cols, { name, castShadow: shadow, outline: this.detail.outlines, hullGeometry: hull });
  }

  private addTrees(): void {
    const groups: Record<"broadleaf" | "acacia" | "snag", { mats: Matrix4[]; cols: Color[] }> = {
      broadleaf: { mats: [], cols: [] },
      acacia: { mats: [], cols: [] },
      snag: { mats: [], cols: [] },
    };
    const bushMats: Matrix4[] = [];
    const bushCols: Color[] = [];
    const rng = new Rng(0xb05e);
    for (const o of this.world.obstacles) {
      const tag = classifyObstacle(o);
      if (o.kind !== "circle" || (tag !== "tree" && tag !== "snag")) continue;
      const kind = tag === "snag" ? "snag" : treeSpecies(o.x, o.z);
      const y = this.world.terrainHeight(o.x, o.z);
      const s = (o.r / TREE_BASE_RADIUS) * (0.94 + h01(1, o.x, o.z) * 0.14);
      const tall = kind === "snag" ? ((o.y1 - y) / 5.4) * (0.95 + h01(2, o.x, o.z) * 0.1) : s * (0.86 + h01(2, o.x, o.z) * 0.3);
      const sw = kind === "snag" ? Math.max(o.r / 0.28, 0.7) : s;
      const g = groups[kind];
      g.mats.push(composeInstance(new Matrix4(), o.x, y, o.z, h01(3, o.x, o.z) * Math.PI * 2, sw, tall, sw, (h01(4, o.x, o.z) - 0.5) * 0.07, (h01(5, o.x, o.z) - 0.5) * 0.07));
      const t = h01(6, o.x, o.z);
      g.cols.push(new Color(0.9 + t * 0.16, 0.92 + h01(7, o.x, o.z) * 0.12, 0.88 + h01(8, o.x, o.z) * 0.14));
      if (kind !== "snag" && this.detail.bushes > 0 && h01(9, o.x, o.z) < 0.55) {
        const a = h01(10, o.x, o.z) * Math.PI * 2;
        const d = o.r + 1.4 + h01(11, o.x, o.z) * 1.6;
        const bx = o.x + Math.cos(a) * d;
        const bz = o.z + Math.sin(a) * d;
        this.pushBush(bushMats, bushCols, bx, bz, rng);
      }
    }
    // Distant trees beyond the playable edge (no collision, nobody can walk there): they stop the map ending in a blank meadow.
    const far = new Rng(0xfa12);
    for (let g = 0; g < 7; g++) {
      const a = far.range(0, Math.PI * 2);
      const cx = Math.cos(a) * far.range(100, 130);
      const cz = Math.sin(a) * far.range(100, 130);
      for (let i = 0; i < 9; i++) {
        const t = far.range(0, Math.PI * 2);
        const d = 12 * Math.sqrt(far.next());
        const x = cx + Math.cos(t) * d;
        const z = cz + Math.sin(t) * d;
        const kind = treeSpecies(x, z);
        const s = 0.9 + far.next() * 0.55;
        const gr = groups[kind];
        gr.mats.push(composeInstance(new Matrix4(), x, visualHeight(this.world.terrainHeight(x, z), x, z), z, far.range(0, 6.28), s, s * (0.9 + far.next() * 0.3), s));
        gr.cols.push(new Color(0.9 + far.next() * 0.16, 0.92 + far.next() * 0.12, 0.88 + far.next() * 0.14));
      }
    }
    // lone shrubs in the open
    for (let i = 0, placed = 0; placed < this.detail.bushes * 0.5 && i < this.detail.bushes * 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = 16 + 72 * Math.sqrt(rng.next());
      const bx = Math.cos(a) * d;
      const bz = Math.sin(a) * d;
      if (this.blocked(bx, bz, 1.2)) continue;
      this.pushBush(bushMats, bushCols, bx, bz, rng);
      placed++;
    }
    const treeMat = this.track(toonMaterial());
    this.instanced("broadleaf", broadleafGeometry, treeMat, groups.broadleaf.mats, groups.broadleaf.cols, true);
    this.instanced("acacia", acaciaGeometry, treeMat, groups.acacia.mats, groups.acacia.cols, true);
    this.instanced("snag", snagGeometry, treeMat, groups.snag.mats, groups.snag.cols, true);
    const cap = this.detail.bushes;
    this.instanced("bush", bushGeometry, treeMat, bushMats.slice(0, cap), bushCols.slice(0, cap), false);
  }

  private pushBush(mats: Matrix4[], cols: Color[], x: number, z: number, rng: Rng): void {
    if (this.blocked(x, z, 0.6)) return;
    const y = this.world.terrainHeight(x, z);
    const s = 0.8 + rng.next() * 0.9;
    mats.push(composeInstance(new Matrix4(), x, y - 0.05, z, rng.next() * 6.28, s * (0.9 + rng.next() * 0.3), s * (0.7 + rng.next() * 0.5), s));
    cols.push(new Color(0.85 + rng.next() * 0.2, 0.9 + rng.next() * 0.15, 0.85 + rng.next() * 0.12));
  }

  private blocked(x: number, z: number, margin: number): boolean {
    let hit = false;
    this.world.forEachNear(x, z, (o: Obstacle) => {
      const r = o.kind === "circle" ? o.r : Math.hypot(o.hx, o.hz);
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + margin) ** 2) hit = true;
    });
    return hit || inCampFootprint(x, z, margin);
  }

  private addRocks(): void {
    const mats: Matrix4[] = [];
    const cols: Color[] = [];
    const pebMats: Matrix4[] = [];
    const pebCols: Color[] = [];
    const rng = new Rng(0x70c5);
    const pebble = (x: number, z: number, s: number): void => {
      const y = this.world.terrainHeight(x, z);
      pebMats.push(composeInstance(new Matrix4(), x, y - s * 0.15, z, rng.next() * 6.28, s * (0.9 + rng.next() * 0.5), s * (0.6 + rng.next() * 0.4), s * (0.9 + rng.next() * 0.4)));
      pebCols.push(new Color(0.82 + rng.next() * 0.3, 0.82 + rng.next() * 0.28, 0.8 + rng.next() * 0.28));
    };
    for (const o of this.world.obstacles) {
      if (o.kind !== "circle" || classifyObstacle(o) !== "rock") continue;
      const y = this.world.terrainHeight(o.x, o.z);
      const h = o.y1 - y;
      const sx = o.r * (1.0 + (h01(1, o.x, o.z) - 0.5) * 0.24);
      const sz = o.r * (1.0 + (h01(2, o.x, o.z) - 0.5) * 0.24);
      mats.push(composeInstance(new Matrix4(), o.x, y - 0.02, o.z, h01(3, o.x, o.z) * Math.PI * 2, sx * 1.04, (h / 1.2) * (0.92 + h01(4, o.x, o.z) * 0.16), sz * 1.04, (h01(5, o.x, o.z) - 0.5) * 0.12, (h01(6, o.x, o.z) - 0.5) * 0.12));
      cols.push(new Color(0.9 + h01(7, o.x, o.z) * 0.14, 0.9 + h01(8, o.x, o.z) * 0.12, 0.9 + h01(9, o.x, o.z) * 0.1));
      // gravel and pebbles gather round the bigger rocks
      if (o.r > 0.7 && h01(10, o.x, o.z) < 0.7) {
        const n = 3 + Math.floor(h01(11, o.x, o.z) * 5);
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, Math.PI * 2);
          const d = o.r * rng.range(1.25, 2.3);
          const px = o.x + Math.cos(a) * d;
          const pz = o.z + Math.sin(a) * d;
          if (!this.blocked(px, pz, 0.15)) pebble(px, pz, rng.range(0.1, 0.3));
        }
      }
    }
    // a few pebbles round the clearing
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(9, 26);
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      if (!this.blocked(px, pz, 0.3)) pebble(px, pz, rng.range(0.07, 0.17));
    }
    const rockMat = this.track(toonMaterial());
    this.instanced("rock", boulderGeometry, rockMat, mats, cols, true);
    if (pebMats.length) makeInstances(this.root, this.track(pebbleGeometry()), rockMat, pebMats, pebCols, { name: "pebbles", castShadow: false });
  }

  // ---- grass and flowers ------------------------------------------------------------------------------------------------------

  private addGroundCover(): void {
    const rng = new Rng(0x9a55);
    const grassMats: Matrix4[] = [];
    const grassCols: Color[] = [];
    const flowerMats: Matrix4[] = [];
    const flowerCols: Color[] = [];
    const grass = new Color(W.grass);
    // Tints that turn the tuft's green into the dry or meadow palette colour when multiplied in.
    const ratio = (to: number): Color => {
      const c = new Color(to);
      return c.setRGB(Math.min(c.r / grass.r, 1.5), Math.min(c.g / grass.g, 1.5), Math.min(c.b / grass.b, 1.5));
    };
    const dryTint = ratio(W.dry);
    const meadowTint = ratio(W.meadow);
    const blooms = [W.bloomRed, W.bloomYellow, W.bloomBlue, W.bloomWhite, W.bloomYellow, W.bloomWhite].map((h) => new Color(h));
    const e = 0.6;
    const slopeAt = (x: number, z: number, h: number): number => Math.hypot(this.world.terrainHeight(x + e, z) - h, this.world.terrainHeight(x, z + e) - h) / e;
    const wantGrass = this.detail.grassTufts;
    const wantFlowers = this.detail.flowers;
    for (let tries = 0; (grassMats.length < wantGrass || flowerMats.length < wantFlowers) && tries < (wantGrass + wantFlowers) * 4; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = 90 * Math.pow(rng.next(), 1.2);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const h = this.world.terrainHeight(x, z);
      const dens = coverDensity(x, z, slopeAt(x, z, h));
      const roll = rng.next();
      if (roll > dens) continue;
      if (this.blocked(x, z, 0.35)) continue;
      const flower = inMeadow(x, z) && flowerMats.length < wantFlowers && rng.chance(0.3);
      if (flower) {
        const s = 0.8 + rng.next() * 0.8;
        flowerMats.push(composeInstance(new Matrix4(), x, h - 0.02, z, rng.next() * 6.28, s, s, s));
        flowerCols.push(blooms[Math.floor(rng.next() * blooms.length)]!.clone().multiplyScalar(1.3 + rng.next() * 0.2)); // blooms glow a little: toon light would otherwise dull them
      } else if (grassMats.length < wantGrass) {
        const s = 0.6 + rng.next() * 0.6;
        grassMats.push(composeInstance(new Matrix4(), x, h - 0.03, z, rng.next() * 6.28, s * (0.9 + rng.next() * 0.3), s * (0.8 + rng.next() * 0.6), s * (0.9 + rng.next() * 0.3)));
        const c = new Color(0.86 + rng.next() * 0.22, 0.88 + rng.next() * 0.2, 0.86 + rng.next() * 0.16);
        if (inMeadow(x, z)) c.multiply(meadowTint);
        else if (h > 1.4 && rng.chance(0.7)) c.multiply(dryTint);
        else if (rng.chance(0.12)) c.multiply(dryTint);
        grassCols.push(c);
      }
    }
    const grassMat = this.track(toonMaterial({ doubleSided: true, wind: 0.24 }));
    if (grassMats.length) {
      const set = makeInstances(this.root, this.track(grassTuftGeometry()), grassMat, grassMats, grassCols, { name: "grass", castShadow: false });
      if (set) set.mesh.frustumCulled = false;
    }
    const flowerMat = this.track(toonMaterial({ doubleSided: true }));
    windify(flowerMat, 0.18);
    if (flowerMats.length) {
      const set = makeInstances(this.root, this.track(flowerGeometry()), flowerMat, flowerMats, flowerCols, { name: "flowers", castShadow: false });
      if (set) set.mesh.frustumCulled = false;
    }
  }

  // ---- the camp ---------------------------------------------------------------------------------------------------------------

  private addCamp(): void {
    const geo = buildLandmarks(this.world, 1);
    if (geo) {
      const hull = this.detail.outlines ? buildLandmarks(this.world, 0) : undefined;
      this.track(geo);
      if (hull) this.track(hull);
      makeSolid(this.root, geo, this.track(toonMaterial()), { name: "camp", outline: this.detail.outlines, hullGeometry: hull, castShadow: true });
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
      const flame = new Mesh(this.track(buildFlame()), this.track(new MeshBasicMaterial({ vertexColors: true, fog: false })));
      flame.name = "flame";
      flame.position.set(o.x, y + 0.14, o.z);
      flame.scale.setScalar(1);
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
      const poolMat = this.track(new MeshBasicMaterial({ map: tex, color: PALETTE.camp.glow, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.32 }));
      const pool = new Mesh(this.track(new PlaneGeometry(7, 7)), poolMat);
      pool.name = "fire-pool";
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(o.x, y + 0.06, o.z);
      pool.renderOrder = 1;
      this.root.add(pool);
    }
  }

  /** Wind, pennant, flame and glow. Cheap: it only writes a few numbers. */
  update(t: number): void {
    worldTime.value = t;
    if (this.flame) {
      this.flame.scale.set(1 + 0.06 * Math.sin(t * 11.3), 0.95 + 0.14 * Math.sin(t * 7.1) + 0.07 * Math.sin(t * 17.9), 1 + 0.06 * Math.cos(t * 9.2));
      this.flame.rotation.y = t * 0.7;
    }
    if (this.glow) this.glow.opacity = 0.58 + 0.08 * Math.sin(t * 9.7) + 0.04 * Math.sin(t * 23.1);
  }

  dispose(): void {
    disposeTree(this.root as Object3D);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
