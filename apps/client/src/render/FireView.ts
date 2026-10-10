import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CircleGeometry, Color, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D,
  LatheGeometry, Quaternion, Vector2, Vector3, type Scene,
} from "three";
import { FIRE, FireGrid, PALETTE, decodeBurning, decodeBurnt, hash3, windAt, type CollisionWorld, type RegionId } from "@cb/shared";
import { setFireLamps, FIRE_LAMPS } from "./world/lampLight.ts";

/**
 * D-103: fire that spreads, as the clients see it. The server's grid arrives as two strings (`WorldState.fire`, the cells burning now; `WorldState.scorch`, the ground already
 * burnt). Each burning cell is three tongues of flame (the torch's cones, in the same toon colours) flickering and leaning with the world's wind (`windAt`: the same wind the
 * server's spread used), with a glow on the ground; smoke and embers rise from it and drift downwind; burnt cells are scorched patches laid on the slope of the ground. People
 * alight burn with the same tongues up their bodies. The nearest burning places light their surroundings through the lanterns' shader slots (lampLight.ts).
 *
 * Everything is pooled and capped (the server caps the burning cells; the scorch, the smoke and the embers have their own caps). A frame allocates nothing; decoding a changed string
 * (at most twice a second) may.
 */

const C = PALETTE.camp;
const TONGUES = 3;
const PERSON_TONGUES = 5;
const MAX_PEOPLE = 12;
const MAX_TONGUES = FIRE.maxBurning * TONGUES + MAX_PEOPLE * PERSON_TONGUES;
const MAX_SCORCH = 4096;
const MAX_SMOKE = 140;
const MAX_EMBERS = 110;
/** Smoke puffs and embers born per burning cell per second (the pools cap the total). */
const SMOKE_RATE = 0.9;
const EMBER_RATE = 0.8;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const qt = new Quaternion();
const p3 = new Vector3();
const s3 = new Vector3();
const up = new Vector3(0, 1, 0);
const nrm = new Vector3();
const col = new Color();
const dummy = new Object3D();

/** One burning person as the view needs them: where their feet are and how much fire is left on them (seconds). */
export interface BurningPerson {
  x: number;
  y: number;
  z: number;
  left: number;
  seed: number;
}

export class FireView {
  private grid: FireGrid | undefined;
  private gridKey = "";
  private world: CollisionWorld | undefined;
  private seed = 0;
  private lastBurning = "\u0000";
  private lastScorch = "\u0000";
  /** The burning cells (ascending) and when each caught (seconds of the view's clock), for the flare-up. */
  private readonly cells = new Int32Array(FIRE.maxBurning);
  private nCells = 0;
  private readonly caught = new Map<number, number>();
  private readonly scorched = new Set<number>();
  private readonly people: BurningPerson[] = Array.from({ length: MAX_PEOPLE }, () => ({ x: 0, y: 0, z: 0, left: 0, seed: 0 }));
  private nPeople = 0;
  private t = 0;
  private readonly wind = { x: 0, z: 1 };
  private camX = 0;
  private camY = -1000;
  private camZ = 0;

  private readonly outer: InstancedMesh;
  private readonly core: InstancedMesh;
  private readonly glow: InstancedMesh;
  private readonly scorch: InstancedMesh;
  private readonly smoke: InstancedMesh;
  private readonly embers: InstancedMesh;
  private readonly smokeP: Particle[] = Array.from({ length: MAX_SMOKE }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 0, size: 1 }));
  private readonly emberP: Particle[] = Array.from({ length: MAX_EMBERS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 0, size: 1 }));
  private smokeDebt = 0;
  private emberDebt = 0;
  private spawnSeq = 0;
  private readonly lampXyz = new Float32Array(FIRE_LAMPS * 3);
  private readonly lampLit = new Float32Array(FIRE_LAMPS);
  /** Told whenever the scorched ground grows (the stage chars the plants on it). */
  onScorch: ((burnt: (x: number, z: number) => boolean) => void) | undefined;

  constructor(private readonly scene: Scene) {
    // a tongue of flame: a lathed teardrop (full low down, drawn to a point), its brighter core inside it
    const outerGeo = tongueGeometry(0.34, 1, 8);
    const coreGeo = tongueGeometry(0.17, 0.6, 7);
    this.outer = this.instanced(outerGeo, new MeshBasicMaterial({ color: C.flameOuter, transparent: true, opacity: 0.9, depthWrite: false }), MAX_TONGUES, "fire_outer");
    this.core = this.instanced(coreGeo, new MeshBasicMaterial({ color: C.flameMid, transparent: true, opacity: 0.92, depthWrite: false }), MAX_TONGUES, "fire_core");
    // the glow under the flames: a soft disc, bright in the middle and black (nothing, added) at the rim
    const glowGeo = new CircleGeometry(1, 12);
    glowGeo.rotateX(-Math.PI / 2);
    const gpos = glowGeo.getAttribute("position");
    const gcol = new Float32Array(gpos.count * 3);
    const g = new Color(C.glow);
    for (let i = 0; i < gpos.count; i++) {
      const k = Math.hypot(gpos.getX(i), gpos.getZ(i)) < 0.01 ? 1 : 0;
      gcol[i * 3] = g.r * k;
      gcol[i * 3 + 1] = g.g * k;
      gcol[i * 3 + 2] = g.b * k;
    }
    glowGeo.setAttribute("color", new BufferAttribute(gcol, 3));
    this.glow = this.instanced(glowGeo, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending }), FIRE.maxBurning, "fire_glow");
    // scorch: a ragged dark blot per burnt cell, larger than the cell, solid in the middle and fading to nothing at a ragged rim, so neighbours run together into one burn
    const scorchGeo = scorchBlot();
    const smat = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.scorch = this.instanced(scorchGeo, smat, MAX_SCORCH, "fire_scorch");
    this.scorch.renderOrder = -1;
    this.smoke = this.instanced(new IcosahedronGeometry(1, 1), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }), MAX_SMOKE, "fire_smoke");
    this.embers = this.instanced(new IcosahedronGeometry(0.035, 0), new MeshBasicMaterial({ color: C.flameMid }), MAX_EMBERS, "fire_embers");
  }

  private instanced(geo: BufferGeometry, mat: MeshBasicMaterial, n: number, name: string): InstancedMesh {
    const m = new InstancedMesh(geo, mat, n);
    m.name = name;
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.castShadow = false;
    m.receiveShadow = false;
    // (the colour buffer exists from the start, so a first setColorAt never swaps the material's program mid-game)
    m.setColorAt(0, col.set(0xffffff));
    this.scene.add(m);
    return m;
  }

  /** The region the strings describe (a new region, or a rebuilt world: the scorch is forgotten with the old grid). */
  setRegion(region: RegionId, world: CollisionWorld, seed: number): void {
    this.world = world;
    this.seed = seed;
    const key = `${region}:${seed}`;
    if (key === this.gridKey && this.grid) {
      this.grid.world = world;
      return;
    }
    this.gridKey = key;
    this.grid = new FireGrid(world, region, seed);
    this.nCells = 0;
    this.caught.clear();
    this.scorched.clear();
    this.scorch.count = 0;
    this.lastBurning = "\u0000";
    this.lastScorch = "\u0000";
  }

  /** The server's two strings (cheap to call every frame: nothing is decoded unless one changed). */
  sync(burning: string, scorch: string): void {
    const g = this.grid;
    if (!g) return;
    if (burning !== this.lastBurning) {
      this.lastBurning = burning;
      const before = this.nCells;
      // cells that just went out are scorched now (the scorch string follows within two seconds)
      const was = this.cells.slice(0, before);
      this.nCells = 0;
      decodeBurning(burning, g.cells, (c) => {
        if (this.nCells < this.cells.length) this.cells[this.nCells++] = c;
        if (!this.caught.has(c)) this.caught.set(c, this.t);
      });
      const now = new Set(this.cells.subarray(0, this.nCells));
      let grew = false;
      for (const c of was) {
        if (now.has(c)) continue;
        this.caught.delete(c);
        if (!this.scorched.has(c)) {
          this.addScorch(c);
          grew = true;
        }
      }
      if (grew) this.tellScorch();
    }
    if (scorch !== this.lastScorch) {
      this.lastScorch = scorch;
      let grew = false;
      if (scorch === "") {
        this.scorched.clear();
        this.scorch.count = 0;
      } else
        decodeBurnt(scorch, g.cells, (c) => {
          if (!this.scorched.has(c)) {
            this.addScorch(c);
            grew = true;
          }
        });
      if (grew) this.tellScorch();
      this.scorch.instanceMatrix.needsUpdate = true;
      if (this.scorch.instanceColor) this.scorch.instanceColor.needsUpdate = true;
    }
  }

  private tellScorch(): void {
    const g = this.grid;
    if (!g || !this.onScorch) return;
    this.onScorch((x, z) => this.scorched.has(g.cellAt(x, z)));
  }

  /** Whether the ground at (x, z) is scorched (for the plants). */
  scorchedAt(x: number, z: number): boolean {
    return this.grid !== undefined && this.scorched.has(this.grid.cellAt(x, z));
  }

  private addScorch(c: number): void {
    const g = this.grid;
    const w = this.world;
    if (!g || !w || this.scorched.size >= MAX_SCORCH) return;
    this.scorched.add(c);
    const i = this.scorch.count++;
    const h = hash3(this.seed ^ 0x5c0, c, 1);
    const x = g.centreX(c) + ((h & 255) / 255 - 0.5) * 0.6;
    const z = g.centreZ(c) + (((h >> 8) & 255) / 255 - 0.5) * 0.6;
    const e = 0.7;
    const y0 = w.terrainHeight(x, z);
    nrm.set(w.terrainHeight(x - e, z) - w.terrainHeight(x + e, z), 2 * e, w.terrainHeight(x, z - e) - w.terrainHeight(x, z + e)).normalize();
    q.setFromUnitVectors(up, nrm);
    dummy.quaternion.copy(q);
    dummy.rotateY(((h >> 16) & 255) / 255 * Math.PI * 2);
    const r = FIRE.cell * (0.95 + (((h >> 24) & 255) / 255) * 0.25);
    dummy.position.set(x, y0 + 0.035, z);
    dummy.scale.set(r, 1, r * (0.8 + ((h >> 4) & 15) / 60));
    dummy.updateMatrix();
    this.scorch.setMatrixAt(i, dummy.matrix);
    // most of it charred black-brown, a few patches pale with ash
    if (((h >> 12) & 7) === 0) col.set(C.scorchAsh);
    else col.set(C.charred).multiplyScalar(0.5 + ((h >> 20) & 15) / 90);
    this.scorch.setColorAt(i, col);
  }

  /** People alight this frame (positions of their feet, seconds of fire left). */
  setPeople(list: readonly BurningPerson[], n: number): void {
    this.nPeople = Math.min(MAX_PEOPLE, n);
    for (let i = 0; i < this.nPeople; i++) {
      const s = list[i]!;
      const d = this.people[i]!;
      d.x = s.x;
      d.y = s.y;
      d.z = s.z;
      d.left = s.left;
      d.seed = s.seed;
    }
  }

  /** How many cells burn, and the distance from (x, z) to the nearest (Infinity when none): the crackle's loudness. */
  nearest(x: number, z: number): { d: number; n: number } {
    const g = this.grid;
    let best = Infinity;
    for (let k = 0; g && k < this.nCells; k++) {
      const c = this.cells[k]!;
      const d = Math.hypot(g.centreX(c) - x, g.centreZ(c) - z);
      if (d < best) best = d;
    }
    for (let i = 0; i < this.nPeople; i++) best = Math.min(best, Math.hypot(this.people[i]!.x - x, this.people[i]!.z - z));
    near.d = best;
    near.n = this.nCells + this.nPeople;
    return near;
  }

  get burningCells(): number {
    return this.nCells;
  }

  /** One frame. `cam` is where the lens is: smoke right against it thins away, so a player downwind of a fire still sees where they are going. */
  update(dt: number, worldMs: number, cam?: { x: number; y: number; z: number }): void {
    this.t += dt;
    if (cam) {
      this.camX = cam.x;
      this.camY = cam.y;
      this.camZ = cam.z;
    }
    const g = this.grid;
    const w = this.world;
    windAt(this.seed, worldMs, this.wind);
    const lean = 0.28;
    let n = 0;
    if (g && w) {
      for (let k = 0; k < this.nCells; k++) {
        const c = this.cells[k]!;
        const age = this.t - (this.caught.get(c) ?? this.t);
        const grow = Math.min(1, 0.35 + age * 1.6);
        const fuel = 0.55 + 0.45 * g.fuelOf(c);
        for (let j = 0; j < TONGUES; j++) {
          const h = hash3(this.seed ^ 0xf1a, c, j);
          const x = g.centreX(c) + ((h & 255) / 255 - 0.5) * 1.5;
          const z = g.centreZ(c) + (((h >> 8) & 255) / 255 - 0.5) * 1.5;
          const ph = ((h >> 16) & 255) / 40;
          const flick = 0.78 + 0.22 * Math.sin(this.t * (11 + j * 2.3) + ph) * Math.sin(this.t * 6.1 + ph * 1.7);
          const tall = (0.55 + (((h >> 24) & 255) / 255) * 0.8) * fuel * grow * flick;
          n = this.tongue(n, x, w.terrainHeight(x, z) - 0.05, z, tall, 0.9 + 0.3 * flick, lean * (0.7 + ((h >> 3) & 7) / 14), ph);
        }
        this.placeGlow(k, g.centreX(c), w.terrainHeight(g.centreX(c), g.centreZ(c)) + 0.06, g.centreZ(c), 1.3 + 0.25 * Math.sin(this.t * 9 + c));
      }
      this.glow.count = this.nCells;
      this.glow.instanceMatrix.needsUpdate = true;
    } else this.glow.count = 0;
    // people alight: tongues up the body, bigger while the fire on them is fresh
    for (let i = 0; i < this.nPeople; i++) {
      const p = this.people[i]!;
      const strength = Math.min(1, p.left / 2);
      for (let j = 0; j < PERSON_TONGUES; j++) {
        const a = j * 2.4 + p.seed * 0.01;
        const flick = 0.75 + 0.25 * Math.sin(this.t * (13 + j) + a * 3);
        const x = p.x + Math.cos(a) * 0.17;
        const z = p.z + Math.sin(a) * 0.17;
        const y = p.y + 0.2 + j * 0.28;
        n = this.tongue(n, x, y, z, (0.45 + 0.25 * flick) * (0.5 + 0.5 * strength), 0.75, lean * 1.6, a);
      }
    }
    this.outer.count = n;
    this.core.count = n;
    this.outer.instanceMatrix.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    this.particles(dt);
    this.lamps();
  }

  /** One tongue (outer teardrop and its core), turned by `twist` and leaning downwind. Returns the next free slot. */
  private tongue(n: number, x: number, y: number, z: number, tall: number, wide: number, lean: number, twist: number): number {
    if (n >= MAX_TONGUES) return n;
    // lean: tip the tongue's up axis towards the wind, then turn it on that axis (no two tongues show the same facets)
    p3.set(this.wind.x * lean, 1, this.wind.z * lean).normalize();
    q.setFromUnitVectors(up, p3);
    qt.setFromAxisAngle(up, twist);
    q.multiply(qt);
    s3.set(wide, tall, wide);
    m4.compose(p3.set(x, y, z), q, s3);
    this.outer.setMatrixAt(n, m4);
    s3.set(wide * 0.95, tall * 0.9, wide * 0.95);
    m4.compose(p3, q, s3);
    this.core.setMatrixAt(n, m4);
    return n + 1;
  }

  private placeGlow(k: number, x: number, y: number, z: number, r: number): void {
    m4.makeScale(r, 1, r);
    m4.setPosition(x, y, z);
    this.glow.setMatrixAt(k, m4);
  }

  private particles(dt: number): void {
    const g = this.grid;
    const w = this.world;
    const sources = this.nCells + this.nPeople;
    // births
    if (g && w && sources > 0) {
      this.smokeDebt += sources * SMOKE_RATE * dt;
      this.emberDebt += sources * EMBER_RATE * dt;
      while (this.smokeDebt >= 1) {
        this.smokeDebt -= 1;
        this.spawn(this.smokeP, true);
      }
      while (this.emberDebt >= 1) {
        this.emberDebt -= 1;
        this.spawn(this.emberP, false);
      }
    } else {
      this.smokeDebt = 0;
      this.emberDebt = 0;
    }
    // smoke: rises, slows, drifts downwind, swells, darker near the ground and paler as it thins
    let n = 0;
    for (const p of this.smokeP) {
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) continue;
      const u = p.age / p.life;
      p.vx += (this.wind.x * 2.2 - p.vx) * dt * 0.6;
      p.vz += (this.wind.z * 2.2 - p.vz) * dt * 0.6;
      p.vy *= 1 - dt * 0.25;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const dc = Math.sqrt((p.x - this.camX) ** 2 + (p.y - this.camY) ** 2 + (p.z - this.camZ) ** 2);
      const nearLens = dc < 7 ? Math.max(0, (dc - 2.5) / 4.5) : 1; // (thins away against the lens)
      const s = p.size * (0.5 + u * 1.6) * (u > 0.85 ? (1 - u) / 0.15 : 1) * nearLens;
      m4.makeScale(s, s * 0.8, s);
      m4.setPosition(p.x, p.y, p.z);
      this.smoke.setMatrixAt(n, m4);
      this.smoke.setColorAt(n, col.set(C.fireSmoke).lerp(tmpC.set(C.fireSmokeLight), 0.25 + 0.75 * u));
      n++;
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
    // embers: quick, bright, wandering up and away
    n = 0;
    for (const p of this.emberP) {
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx += (this.wind.x * 3 - p.vx) * dt * 0.8 + Math.sin(p.age * 13 + p.size * 7) * dt * 2;
      p.vz += (this.wind.z * 3 - p.vz) * dt * 0.8 + Math.cos(p.age * 11 + p.size * 5) * dt * 2;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const s = (1 - p.age / p.life) * p.size;
      m4.makeScale(s, s, s);
      m4.setPosition(p.x, p.y, p.z);
      this.embers.setMatrixAt(n, m4);
      n++;
    }
    this.embers.count = n;
    this.embers.instanceMatrix.needsUpdate = true;
  }

  /** A particle from a random source (a burning cell or a burning person), recycled from the pool's first dead slot. */
  private spawn(pool: Particle[], smoke: boolean): void {
    const g = this.grid;
    const w = this.world;
    if (!g || !w) return;
    let slot: Particle | undefined;
    for (const p of pool) {
      if (p.age >= p.life) {
        slot = p;
        break;
      }
    }
    if (!slot) return;
    const h = hash3(this.seed ^ 0x5e0, this.spawnSeq++, smoke ? 1 : 2);
    const sources = this.nCells + this.nPeople;
    const pick = Math.floor(byteOf(h, 0) * sources) % Math.max(1, sources);
    let x: number;
    let y: number;
    let z: number;
    if (pick < this.nCells) {
      const c = this.cells[pick]!;
      x = g.centreX(c) + (byteOf(h, 8) - 0.5) * 1.6;
      z = g.centreZ(c) + (byteOf(h, 16) - 0.5) * 1.6;
      y = w.terrainHeight(x, z) + 1.1 + byteOf(h, 24) * 0.6;
    } else {
      const p = this.people[pick - this.nCells]!;
      x = p.x;
      y = p.y + 1.2;
      z = p.z;
    }
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.age = 0;
    if (smoke) {
      slot.vx = (byteOf(h, 4) - 0.5) * 0.4;
      slot.vz = (byteOf(h, 12) - 0.5) * 0.4;
      slot.vy = 1.9 + byteOf(h, 20) * 1.1;
      slot.life = 3 + byteOf(h, 2) * 2.2;
      slot.size = 0.45 + byteOf(h, 10) * 0.4;
    } else {
      slot.vx = (byteOf(h, 4) - 0.5) * 1.2;
      slot.vz = (byteOf(h, 12) - 0.5) * 1.2;
      slot.vy = 2 + byteOf(h, 20) * 2.5;
      slot.life = 0.8 + byteOf(h, 2) * 1.4;
      slot.size = 0.7 + byteOf(h, 10) * 0.6;
    }
  }

  /** The burning places that light the ground: spread-out cells (at least 7 m apart), the brightest first. */
  private lamps(): void {
    const g = this.grid;
    const w = this.world;
    let n = 0;
    for (let k = 0; g && w && k < this.nCells && n < FIRE_LAMPS; k++) {
      const c = this.cells[(k * 7919) % this.nCells]!;
      const x = g.centreX(c);
      const z = g.centreZ(c);
      let clear = true;
      for (let i = 0; i < n; i++) if ((this.lampXyz[i * 3]! - x) ** 2 + (this.lampXyz[i * 3 + 2]! - z) ** 2 < 49) clear = false;
      if (!clear) continue;
      this.lampXyz[n * 3] = x;
      this.lampXyz[n * 3 + 1] = w.terrainHeight(x, z) + 1;
      this.lampXyz[n * 3 + 2] = z;
      this.lampLit[n] = 0.85 + 0.15 * Math.sin(this.t * 10 + c);
      n++;
    }
    setFireLamps(this.lampXyz, this.lampLit, n);
  }

  dispose(): void {
    for (const m of [this.outer, this.core, this.glow, this.scorch, this.smoke, this.embers]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    setFireLamps(this.lampXyz, this.lampLit, 0);
  }
}

const near = { d: Infinity, n: 0 };

/** A tongue of flame: a lathe round a teardrop profile `tall` high and `r` wide at its fullest, base at 0, open at the bottom (it stands in the grass). */
function tongueGeometry(r: number, tall: number, segments: number): BufferGeometry {
  const profile = [
    [0.55, 0], [0.92, 0.12], [1, 0.3], [0.86, 0.5], [0.58, 0.68], [0.3, 0.84], [0.05, 1],
  ].map(([w, h]) => new Vector2(w! * r, h! * tall));
  return new LatheGeometry(profile, segments);
}

/**
 * The scorch's shape: a flat blot with a ragged rim (eleven spokes of varying length), RGBA vertex colours white in the middle and transparent at the rim, so the instance colour
 * tints it and overlapping blots blend into one burn with no hard edge.
 */
function scorchBlot(): BufferGeometry {
  const spokes = 11;
  const pos: number[] = [0, 0, 0];
  const colour: number[] = [1, 1, 1, 1];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const r = 0.78 + 0.22 * (((hash3(0x5c07, i, 3) & 255) / 255) * 2 - 1);
    // a ring half way out, still solid, then the ragged rim, transparent
    pos.push(Math.cos(a) * r * 0.55, 0, Math.sin(a) * r * 0.55);
    colour.push(1, 1, 1, 0.95);
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    colour.push(1, 1, 1, 0);
  }
  const index: number[] = [];
  for (let i = 0; i < spokes; i++) {
    const j = (i + 1) % spokes;
    const inI = 1 + i * 2, outI = inI + 1, inJ = 1 + j * 2, outJ = inJ + 1;
    index.push(0, inJ, inI, inI, inJ, outJ, inI, outJ, outI);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(colour), 4));
  g.setIndex(index);
  return g;
}
/** Byte `k` bits up of a hash, as 0..1. */
const byteOf = (h: number, k: number): number => ((h >>> k) & 255) / 255;
const tmpC = new Color();
