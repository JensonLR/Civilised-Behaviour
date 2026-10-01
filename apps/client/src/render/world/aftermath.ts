import { DynamicDrawUsage, Group, InstancedMesh, Mesh, MeshToonMaterial, Object3D, type Scene } from "three";
import {
  AUDIT,
  PALETTE,
  checkProps,
  hashFloat,
  seedFromString,
  standY,
  type AuditDoor,
  type AuditProp,
  type AuditRoute,
  type CollisionWorld,
  type RegionId,
} from "@cb/shared";
import type { GoreLevel } from "@cb/procedural/three";
import { PartBuilder, addOutlineNormals, outlineMaterial, sharedToonRamp } from "@cb/procedural/three";
import type { DecalField } from "../decals/DecalField.ts";
import type { ShotFx } from "../weapons/ShotFx.ts";

/**
 * BATTLEFIELD AFTERMATH (D-038, package W): what a fight leaves lying about, as a deterministic function of the region, the seed and the casualty tally. Crows come to
 * what the guns left, hats lie where heads were, shells leave craters, scorched ground and wrecked crates, and the craters smoulder. The jolly world carries its
 * consequences on its face: the field you won on is a field you can read.
 *
 * `planAftermath` is PURE (no three.js, no clock): slot k of a kind is a fixed function of (region, seed, k), and the tally only decides how many slots are active, so a
 * bigger tally adds items and never moves the ones already there (a battle that goes on adds to the picture). Each slot picks the centre it belongs to by a weighted hash
 * (a new casualty site takes slots only where it wins, so existing items stay put), tries a dozen deterministic spots round it, and takes the first that PASSES THE LEVEL AUDIT'S
 * RULES, asked of the audit itself (`checkProps`): not inside a wall or any solid, not in a door's apron; the heavy items (a wrecked crate) also keep off the walked routes. A slot
 * with no good spot yields nothing (it never forces one). Gore Full / Reduced / Off: crows come to casualties only at Full (half as many at Reduced, none at Off); everything else is
 * wreckage and weather and shows at every level.
 *
 * `Aftermath` draws a plan: one instanced mesh per kind (hats, crows, crates, crater rims), scorch and craters into the decal field, smoke from the smouldering craters.
 * Wiring (the integrator, `docs/_notes/polish2.md` section 11 step 7): on `enterRegion` and when the casualty tally changes, `aftermath.show(planAftermath(...), gore)`;
 * `aftermath.update(dt)` each frame.
 */

export type AftermathKind = "crow" | "hat" | "crater" | "scorch" | "crate" | "smoke";

/** Where a thing happened: a casualty site (a body lies here) or a blast site (a shell fell here). `w` weights how many slots it wins (default 1). */
export interface AftermathCentre {
  x: number;
  z: number;
  kind: "casualty" | "blast";
  w?: number;
}

/** What the battle cost, as the casualty system counts it. */
export interface AftermathTally {
  dead: number;
  downed: number;
  /** Shells that landed (cannon rounds, bombs). */
  blasts: number;
  /** Fires burning (a torched tent, a lit fuse that found its mark). */
  fires?: number;
}

/** The level facts placement asks the audit about: the region's own collision world, its declared doors and its walked routes (the same data `RegionAuditInput` carries). */
export interface AftermathSite {
  region: RegionId;
  world: CollisionWorld;
  doors: readonly AuditDoor[];
  routes: readonly AuditRoute[];
}

export interface AftermathItem {
  /** Stable: `kind#slot`. The same id is the same item across plans (an item never moves once placed). */
  id: string;
  kind: AftermathKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Plan radius, metres (the footprint the audit's rules were asked about). */
  r: number;
  /** 0..1 variety (which hat, which way a crow faces its peck, how deep a crater). */
  v: number;
  /** Index into the centres it belongs to. */
  centre: number;
  /** Smoke only: how strongly (0..1) it still smoulders. Craters that smoulder also carry it. */
  smoulder: number;
}

export interface AftermathInput {
  region: RegionId;
  seed: number;
  tally: AftermathTally;
  centres: readonly AftermathCentre[];
  gore: GoreLevel;
  site: AftermathSite;
}

/** The most of each kind a field shows (the picture stays a picture, and the budget stays small). */
export const AFTERMATH_MAX = { crow: 10, hat: 8, crater: 6, scorch: 8, crate: 5, smoke: 4 } as const;

/** Plan radius and the distance band from its centre (metres) by kind, and whether the item is solid (a wreck you could trip on: it keeps off walked routes too). */
const SPEC: Record<AftermathKind, { r: number; near: number; far: number; solid: boolean; tries: number }> = {
  hat: { r: 0.22, near: 0.7, far: 3.6, solid: false, tries: 12 },
  crow: { r: 0.25, near: 2.2, far: 7, solid: false, tries: 12 },
  crater: { r: 1.1, near: 0, far: 1.4, solid: false, tries: 12 },
  scorch: { r: 1.4, near: 0.4, far: 3.2, solid: false, tries: 12 },
  crate: { r: 0.5, near: 3.2, far: 6.5, solid: true, tries: 14 },
  smoke: { r: 0.3, near: 0, far: 0, solid: false, tries: 1 },
};

/** Terrain below this is under water (rivers, the delta's channels): nothing is dropped there. */
export const WATERLINE = -0.2;

/** How many slots of a kind are active for a tally, by gore level. */
export function aftermathCount(kind: AftermathKind, t: AftermathTally, gore: GoreLevel): number {
  const dead = Math.max(0, Math.floor(t.dead));
  const downed = Math.max(0, Math.floor(t.downed));
  const blasts = Math.max(0, Math.floor(t.blasts));
  const fires = Math.max(0, Math.floor(t.fires ?? 0));
  const cap = (n: number, max: number): number => Math.max(0, Math.min(max, Math.floor(n)));
  switch (kind) {
    case "hat":
      return cap(Math.ceil(dead * 0.7 + downed * 0.3), AFTERMATH_MAX.hat);
    case "crow":
      return gore === "off" ? 0 : gore === "reduced" ? cap(dead + downed * 0.5, AFTERMATH_MAX.crow / 2) : cap(dead * 2 + downed, AFTERMATH_MAX.crow);
    case "crater":
      return cap(blasts, AFTERMATH_MAX.crater);
    case "scorch":
      return cap(blasts * 1.5 + fires, AFTERMATH_MAX.scorch);
    case "crate":
      return cap(blasts * 0.8 + dead * 0.15, AFTERMATH_MAX.crate);
    case "smoke":
      return cap(Math.ceil(blasts / 2) + (fires > 0 ? 1 : 0), AFTERMATH_MAX.smoke);
  }
}

const KIND_SEED: Record<AftermathKind, number> = { crow: 1, hat: 2, crater: 3, scorch: 4, crate: 5, smoke: 6 };
const KINDS: readonly AftermathKind[] = ["crater", "crate", "scorch", "hat", "crow", "smoke"];

/** Is this spot good for an item of this kind and radius? The audit's own prop rules decide (a solid, a door's apron; a solid item also keeps off the routes). */
function passes(site: AftermathSite, kind: AftermathKind, x: number, z: number, r: number, scratch: AuditProp[]): boolean {
  const p = scratch[0]!;
  p.id = `aftermath:${kind}`;
  p.x = x;
  p.z = z;
  p.r = r;
  const found = checkProps(site.region, site.world, scratch, site.doors, SPEC[kind].solid ? site.routes : []);
  for (const f of found) if (f.severity === "error" || (SPEC[kind].solid && f.kind === "prop-on-path")) return false;
  return true;
}

/**
 * The aftermath of a fight. Deterministic in (region, seed, tally, centres, gore, site); monotone in the tally. Returns the items in a stable order (craters first, then
 * the rest by kind and slot).
 */
export function planAftermath(input: AftermathInput): AftermathItem[] {
  const { site, centres, tally, gore } = input;
  const out: AftermathItem[] = [];
  const casualty: number[] = [];
  const blast: number[] = [];
  centres.forEach((c, i) => (c.kind === "casualty" ? casualty : blast).push(i));
  if (centres.length === 0) return out;
  const base = (seedFromString(input.region) ^ Math.imul(input.seed | 0, 0x9e3779b1)) >>> 0;
  const scratch: AuditProp[] = [{ id: "", x: 0, z: 0, r: 0 }];
  const placed: AftermathItem[] = [];
  const craterOf: AftermathItem[] = [];
  for (const kind of KINDS) {
    const n = aftermathCount(kind, tally, gore);
    const spec = SPEC[kind];
    // (blast kinds belong to blast sites, casualty kinds to casualty sites; when a tally has no site of the wanted sort the other sort will do, so a battle with no recorded site still shows)
    const wanted = kind === "hat" || kind === "crow" ? casualty : blast;
    const pool = wanted.length > 0 ? wanted : centres.map((_, i) => i);
    for (let slot = 0; slot < n; slot++) {
      const s = (base ^ Math.imul(KIND_SEED[kind], 0x85ebca6b)) >>> 0;
      if (kind === "smoke") {
        // smoke stands on crater `slot` (and nowhere else: which craters exist never depends on how many there are, so a smoke column never moves when another crater lands)
        const host = craterOf[slot];
        if (host) out.push({ id: `smoke#${slot}`, kind, x: host.x, y: host.y + 0.15, z: host.z, yaw: 0, r: 0.3, v: hashFloat(s, slot, 9), centre: host.centre, smoulder: 1 - slot * 0.15 });
        continue;
      }
      // the centre this slot belongs to: the highest weighted hash (rendezvous), so a new site only takes slots it wins
      let best = pool[0]!;
      let bestScore = -1;
      for (const ci of pool) {
        const score = hashFloat(s, slot, 100 + ci) * (centres[ci]!.w ?? 1);
        if (score > bestScore) {
          bestScore = score;
          best = ci;
        }
      }
      const c = centres[best]!;
      for (let k = 0; k < spec.tries; k++) {
        const ang = hashFloat(s, slot, 200 + k * 3) * Math.PI * 2;
        const rad = spec.near + (spec.far - spec.near) * Math.sqrt(hashFloat(s, slot, 201 + k * 3));
        const x = c.x + Math.cos(ang) * rad;
        const z = c.z + Math.sin(ang) * rad;
        const ground = site.world.terrainHeight(x, z);
        if (!Number.isFinite(ground) || ground < WATERLINE) continue;
        const r = spec.r * (kind === "crater" || kind === "scorch" ? 0.75 + 0.5 * hashFloat(s, slot, 400) : 1);
        if (!passes(site, kind, x, z, r, scratch)) continue;
        const y = standY(site.world, x, z);
        // ground marks lie on the ground, not on a jetty's planks or a bridge's deck
        if ((kind === "crater" || kind === "scorch") && Math.abs(y - ground) > 0.3) continue;
        // not on top of another of its own kind (their footprints and a hand's width): ONLY its own kind, so no item ever depends on one that a bigger tally adds
        let clear = true;
        for (const o of placed) if (o.kind === kind && Math.hypot(o.x - x, o.z - z) < o.r + r + 0.3) clear = false;
        if (!clear) continue;
        const item: AftermathItem = {
          id: `${kind}#${slot}`,
          kind,
          x,
          y,
          z,
          yaw: hashFloat(s, slot, 300 + k) * Math.PI * 2,
          r,
          v: hashFloat(s, slot, 500),
          centre: best,
          smoulder: kind === "crater" ? 1 - Math.min(0.8, slot * 0.2) : 0,
        };
        placed.push(item);
        out.push(item);
        if (kind === "crater") craterOf.push(item);
        break;
      }
    }
  }
  return out;
}

/** True when two plans agree on every item the smaller one holds (the monotone property: more casualties add, they never move). */
export function planExtends(small: readonly AftermathItem[], big: readonly AftermathItem[]): boolean {
  const by = new Map(big.map((i) => [i.id, i]));
  return small.every((s) => {
    const b = by.get(s.id);
    return b !== undefined && b.x === s.x && b.z === s.z && b.yaw === s.yaw;
  });
}

// ---- drawing ------------------------------------------------------------------------------------------------------------------------------------

const dummy = new Object3D();

function hatGeometry(sun: boolean) {
  const b = new PartBuilder();
  if (sun) {
    // a sun helmet: a pale dome, a brim all round, a gold band
    b.sphere(0.2, PALETTE.material.cream, [0, 0.07, 0], [1, 0.8, 1]);
    b.cylinder(0.3, 0.3, 0.025, PALETTE.material.cream, [0, 0.0, 0]);
    b.cylinder(0.205, 0.205, 0.035, PALETTE.trim.sashGold, [0, 0.04, 0]);
  } else {
    // a top hat: a tall black crown with a band, a narrow brim, a dent
    b.cylinder(0.14, 0.15, 0.24, PALETTE.material.soot, [0, 0.13, 0]);
    b.cylinder(0.24, 0.24, 0.025, PALETTE.material.soot, [0, 0.0, 0]);
    b.cylinder(0.152, 0.152, 0.045, PALETTE.trim.sashRed, [0, 0.04, 0]);
  }
  return b.build()!;
}

function crowGeometry() {
  const b = new PartBuilder();
  const ink = PALETTE.material.soot;
  b.sphere(0.12, ink, [0, 0.15, 0], [0.85, 0.8, 1.45]); // the body
  b.sphere(0.075, ink, [0, 0.23, -0.17]); // the head
  b.cone(0.03, 0.12, PALETTE.camp.charred, [0, 0.22, -0.3], [-Math.PI / 2, 0, 0]); // the beak
  b.box(0.12, 0.025, 0.2, ink, [0, 0.14, 0.2], [0.25, 0, 0]); // the tail
  b.box(0.05, 0.05, 0.2, PALETTE.camp.charred, [0.1, 0.16, 0.0], [0, 0, -0.2]); // folded wings
  b.box(0.05, 0.05, 0.2, PALETTE.camp.charred, [-0.1, 0.16, 0.0], [0, 0, 0.2]);
  b.cylinder(0.012, 0.012, 0.1, PALETTE.camp.charred, [0.04, 0.05, 0.03]); // the legs
  b.cylinder(0.012, 0.012, 0.1, PALETTE.camp.charred, [-0.04, 0.05, 0.03]);
  return b.build()!;
}

function crateGeometry() {
  const b = new PartBuilder();
  const W = PALETTE.props;
  // a smashed crate: the floor, two side boards still up, planks thrown out, a loose band
  b.box(0.7, 0.05, 0.7, W.crateDark, [0, 0.03, 0]);
  b.box(0.7, 0.4, 0.05, W.crate, [0, 0.23, -0.33], [0.1, 0, 0]);
  b.box(0.05, 0.28, 0.7, W.crate, [0.33, 0.17, 0], [0, 0, -0.18]);
  b.box(0.5, 0.045, 0.1, W.crate, [-0.55, 0.03, 0.3], [0, 0.6, 0.05]);
  b.box(0.45, 0.045, 0.1, W.crateDark, [0.15, 0.03, 0.62], [0, -0.3, 0.04]);
  b.box(0.3, 0.045, 0.09, W.crate, [-0.2, 0.15, 0.2], [0.3, 0.4, 0.5]);
  b.box(0.04, 0.04, 0.55, W.crateBand, [0, 0.07, 0.1], [0, 0.2, 0]);
  return b.build()!;
}

function rimGeometry() {
  const b = new PartBuilder();
  // the lip of a crater: a flattened ring of thrown earth with a few clods, radius 1 (scaled per crater)
  b.torus(1, 0.1, PALETTE.world.dirt, [0, 0.02, 0], [Math.PI / 2, 0, 0], [1, 1, 0.55]);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    b.sphere(0.09 + 0.04 * ((i * 7) % 3), PALETTE.world.dirtDark, [Math.cos(a) * 1.08, 0.04, Math.sin(a) * 1.08], [1, 0.6, 1]);
  }
  return b.build()!;
}

interface Pool {
  mesh: InstancedMesh;
  max: number;
}

/** Draws a plan. Cheap to rebuild (a few dozen instances): `show` replaces what is on the field, keeping only items whose ids it already drew where they were. */
export class Aftermath {
  readonly root = new Group();
  private readonly pools: Record<"hat" | "sun" | "crow" | "crate" | "rim", Pool>;
  private items: readonly AftermathItem[] = [];
  private shown = new Set<string>();
  private time = 0;
  private smokeClock = 0;
  private readonly born = new Map<string, number>();
  private readonly materials: MeshToonMaterial[] = [];

  constructor(
    scene: Scene,
    private readonly shot?: ShotFx,
    private readonly decals?: DecalField,
    outline = true,
  ) {
    const ramp = sharedToonRamp();
    const make = (geo: ReturnType<typeof hatGeometry>, max: number, name: string): Pool => {
      addOutlineNormals(geo);
      const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
      this.materials.push(mat);
      const mesh = new InstancedMesh(geo, mat, max);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.root.add(mesh);
      if (outline) {
        const ink = new InstancedMesh(geo, outlineMaterial(), max);
        ink.instanceMatrix = mesh.instanceMatrix;
        ink.count = 0;
        ink.frustumCulled = false;
        ink.name = `${name}_ink`;
        mesh.userData.ink = ink;
        this.root.add(ink);
      }
      return { mesh, max };
    };
    this.pools = {
      hat: make(hatGeometry(false), AFTERMATH_MAX.hat, "aftermath_hats"),
      sun: make(hatGeometry(true), AFTERMATH_MAX.hat, "aftermath_helmets"),
      crow: make(crowGeometry(), AFTERMATH_MAX.crow, "aftermath_crows"),
      crate: make(crateGeometry(), AFTERMATH_MAX.crate, "aftermath_crates"),
      rim: make(rimGeometry(), AFTERMATH_MAX.crater, "aftermath_rims"),
    };
    this.root.name = "aftermath";
    scene.add(this.root);
  }

  /** The items on the field now. */
  get current(): readonly AftermathItem[] {
    return this.items;
  }

  /** Draw calls this costs (a mesh, and its ink if drawn, per kind in use). */
  get drawCalls(): number {
    let n = 0;
    for (const p of Object.values(this.pools)) {
      if (p.mesh.count > 0) n += p.mesh.userData.ink ? 2 : 1;
    }
    return n;
  }

  /** Puts a plan on the field. Items new to the field also leave their ground marks (scorch, craters) in the decal field. */
  show(items: readonly AftermathItem[], gore: GoreLevel): void {
    void gore; // (the plan already honours it: crows are not planned at Off)
    const counts = { hat: 0, sun: 0, crow: 0, crate: 0, rim: 0 };
    const next = new Set<string>();
    for (const it of items) {
      next.add(it.id);
      if (!this.shown.has(it.id)) {
        this.born.set(it.id, this.time);
        if (it.kind === "crater") this.decals?.blast(it.x, it.z, it.r * 1.15);
        if (it.kind === "scorch") this.decals?.blast(it.x, it.z, it.r);
      }
      let pool: keyof typeof counts | undefined;
      switch (it.kind) {
        case "hat":
          pool = it.v < 0.5 ? "hat" : "sun";
          break;
        case "crow":
          pool = "crow";
          break;
        case "crate":
          pool = "crate";
          break;
        case "crater":
          pool = "rim";
          break;
        default:
          break;
      }
      if (!pool) continue;
      const p = this.pools[pool];
      if (counts[pool] >= p.max) continue;
      const k = counts[pool]++;
      this.place(pool, k, it, 0);
    }
    for (const [name, p] of Object.entries(this.pools) as [keyof typeof counts, Pool][]) {
      p.mesh.count = counts[name];
      const ink = p.mesh.userData.ink as InstancedMesh | undefined;
      if (ink) ink.count = counts[name];
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    this.items = items;
    this.shown = next;
  }

  private place(pool: "hat" | "sun" | "crow" | "crate" | "rim", k: number, it: AftermathItem, t: number): void {
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, it.yaw, 0);
    dummy.scale.setScalar(1);
    switch (pool) {
      case "hat":
      case "sun":
        // a hat lies on its side, a little tilted, its crown toward where it flew
        dummy.rotation.set(Math.PI / 2 - 0.15 + it.v * 0.3, it.yaw, 0.2 * (it.v - 0.5), "YXZ");
        dummy.position.y += pool === "hat" ? 0.15 : 0.12;
        break;
      case "crow": {
        // pecking: head down and up on its own beat; every so often a hop
        const beat = this.time * (1.6 + it.v * 1.2) + it.v * 40 + t;
        const peck = Math.max(0, Math.sin(beat)) ** 3;
        dummy.rotation.set(peck * 0.55, it.yaw, 0);
        const hop = Math.max(0, Math.sin(this.time * 0.35 + it.v * 20)) ** 12;
        dummy.position.y += hop * 0.12;
        break;
      }
      case "crate":
        dummy.rotation.set(0, it.yaw, 0);
        break;
      case "rim":
        dummy.scale.setScalar(it.r);
        break;
    }
    dummy.updateMatrix();
    this.pools[pool].mesh.setMatrixAt(k, dummy.matrix);
  }

  /** Crows peck and hop; the smouldering craters breathe smoke while they are fresh (fading over a minute and a half of the field being in view). */
  update(dt: number): void {
    this.time += dt;
    let k = 0;
    for (const it of this.items) {
      if (it.kind === "crow" && k < this.pools.crow.max) this.place("crow", k++, it, 0);
    }
    if (k > 0) this.pools.crow.mesh.instanceMatrix.needsUpdate = true;
    if (!this.shot) return;
    this.smokeClock += dt;
    if (this.smokeClock < 0.45) return;
    this.smokeClock = 0;
    for (const it of this.items) {
      if (it.kind !== "smoke") continue;
      const age = this.time - (this.born.get(it.id) ?? this.time);
      const strength = it.smoulder / (1 + age / 40);
      if (strength > 0.12) this.shot.ballSmoke(it.x, it.y + 0.3, it.z);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof Mesh || o instanceof InstancedMesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

/** The audit's standard numbers this module relies on (re-exported so the test can state them): the apron depth a door keeps clear. */
export const AFTERMATH_APRON = AUDIT.apronDepth;
