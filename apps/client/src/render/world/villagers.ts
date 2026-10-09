import { Group, type Camera, type Scene } from "three";
import { buildFolk, createFolkClock, createVillagerPose, hash3, hashFloat, parseWeatherKind, setFolkClock, standingHeight, villagerAt, villagerGreeting, villagerSays, weatherPreset, type CollisionWorld, type Folk, type FolkClock, type Speech, type VillagerPose } from "@cb/shared";
import type { CharacterSpec } from "@cb/procedural";
import type { Lod } from "@cb/procedural/three";
import { folkSpec } from "./villagerLooks.ts";
import { FolkOverlay } from "./villagerOverlay.ts";
import { FolkBody, createBodyState, type BodyState } from "./villagerPose.ts";
import { disposeProps } from "./villagerProps.ts";

/**
 * HOLLOWMERE'S FOLK on screen. The people themselves are the shared pure schedule (`villagerAt`): this file only dresses whoever the camera can
 * use. Every frame it asks the schedule where everybody is, ranks the visible ones by distance, and gives the nearest a full character (level of
 * detail 0, with the ink line), the next a lighter one (1), the rest a far silhouette (2), inside a budget of people, triangles and pose-cost
 * (`FolkBudget`, by graphics preset). Bodies are built on demand, at most one build or detail change per frame, and kept; a person out of range or
 * indoors is just a hidden root. Nothing here talks to the server, hits anything or gets hit: they are scenery, and bullets never look at them.
 *
 * Cosmetic reactions to the players (the walkers the grass bends away from) live here and nowhere else: heads turn to follow you, a villager
 * waves and says hello when you come near, and somebody in your way steps aside. They change no schedule and no shared state.
 */

/** How near (m) a walker passes somebody standing before stepping round them. */
const PASS_BY = 1.1;

export interface FolkBudget {
  /** How many of the roster (in priority order) are on the stage at all. */
  count: number;
  /** At most this many bodies are drawn at once, of which at most `lod0` in full detail and `lod1` in mid detail. */
  maxVisible: number;
  lod0: number;
  lod1: number;
  lod2: number;
  /** Distances (metres): full detail inside `near`, mid detail inside `mid`, a silhouette inside `far`, nothing beyond. */
  near: number;
  mid: number;
  far: number;
  /** Rough triangle ceiling for all bodies together. */
  tris: number;
  /** Ink outlines on the nearest bodies. */
  outlines: boolean;
}

export const FOLK_BUDGETS: Record<"low" | "medium" | "high", FolkBudget> = {
  low: { count: 6, maxVisible: 6, lod0: 1, lod1: 2, lod2: 3, near: 16, mid: 34, far: 70, tris: 26_000, outlines: false },
  medium: { count: 16, maxVisible: 14, lod0: 2, lod1: 4, lod2: 8, near: 20, mid: 45, far: 90, tris: 60_000, outlines: true },
  high: { count: 22, maxVisible: 18, lod0: 4, lod1: 6, lod2: 10, near: 20, mid: 45, far: 100, tris: 100_000, outlines: true },
};

/** Measured triangles per body by level (docs/PERFORMANCE.md, character second pass): without and with the ink line. */
export const FOLK_TRIS = { lod0: 11_800, lod0Ink: 15_500, lod1: 4_550, lod2: 1_400 } as const;

const HYST = 2.5;

/** The budget of a world detail (the presets map to low / medium / high by their outlines and ground cover). */
export function folkBudget(detail: { outlines: boolean; treeLine?: number }): FolkBudget {
  if (!detail.outlines) return FOLK_BUDGETS.low;
  return (detail.treeLine ?? 0) > 1200 ? FOLK_BUDGETS.high : FOLK_BUDGETS.medium;
}

/**
 * Who is drawn at which level of detail: `dist[i]` is the distance to villager i (Infinity when they are indoors), `cur[i]` the level they have now
 * (-1 = none, for a little hysteresis), the answer goes into `out[i]` (-1 = hidden, else 0..2). The nearest people get the best levels, each level
 * has a head-count limit, the whole is held under the triangle ceiling, and nothing farther than `far` is drawn. Pure and allocation-free.
 */
export function planLods(dist: ArrayLike<number>, cur: ArrayLike<number>, n: number, b: FolkBudget, out: Int8Array, order: Int32Array): { visible: number; tris: number; lod: [number, number, number] } {
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = 1; i < n; i++) {
    const k = order[i]!;
    let j = i - 1;
    while (j >= 0 && dist[order[j]!]! > dist[k]!) {
      order[j + 1] = order[j]!;
      j--;
    }
    order[j + 1] = k;
  }
  let vis = 0;
  let tris = 0;
  const c: [number, number, number] = [0, 0, 0];
  const limit = [b.lod0, b.lod1, b.lod2];
  for (let r = 0; r < n; r++) {
    const i = order[r]!;
    out[i] = -1;
    const d = dist[i]!;
    const was = cur[i]!;
    if (!(d < b.far + (was >= 0 ? HYST : 0)) || vis >= b.maxVisible) continue;
    let want = d < b.near + (was === 0 ? HYST : 0) ? 0 : d < b.mid + (was >= 0 && was <= 1 ? HYST : 0) ? 1 : 2;
    for (;;) {
      if (want > 2) break;
      const cost = want === 0 ? (b.outlines ? FOLK_TRIS.lod0Ink : FOLK_TRIS.lod0) : want === 1 ? FOLK_TRIS.lod1 : FOLK_TRIS.lod2;
      if (c[want]! < limit[want]! && tris + cost <= b.tris) {
        out[i] = want;
        c[want]!++;
        tris += cost;
        vis++;
        break;
      }
      want++;
    }
  }
  return { visible: vis, tris, lod: c };
}

/** What the game tells the folk beyond what the world knows (set by `Game` once, and by review scenes). */
export interface FolkHints {
  seed: number;
  dayMinutes: number;
  /** The HUD layer and the camera, for name tags and speech (absent = no overlay). */
  layer: HTMLElement | undefined;
  camera: Camera | undefined;
}

export const folkHints: FolkHints = { seed: 7, dayMinutes: 30, layer: undefined, camera: undefined };

/** For `Game`: the room's seed and day length (the people are generated from the one and keep the hours of the other) and where to put name tags and speech. */
export function noteFolk(seed: number, dayMinutes: number, layer?: HTMLElement, camera?: Camera): void {
  folkHints.seed = seed;
  if (dayMinutes > 0) folkHints.dayMinutes = dayMinutes;
  if (layer) folkHints.layer = layer;
  if (camera) folkHints.camera = camera;
}

export interface FolkFrame {
  hours: number;
  worldSec: number;
  /** Rain falling now, 0..1 (cosmetic: umbrellas). */
  rain: number;
  /** The camera. */
  x: number;
  y: number;
  z: number;
  /** The players (grass pushers): heads follow them, hands wave to them. */
  walkers: readonly { x: number; z: number }[];
  walkerCount: number;
}

interface Slot {
  body: FolkBody | undefined;
  spec: CharacterSpec | undefined;
  lod: number;
  state: BodyState;
  umbrella: boolean;
  hue: number;
  waveT: number;
  waveCool: number;
  greetT: number;
  greet: string;
  lookAt: number;
  offX: number;
  offZ: number;
  talk: number;
}

export interface FolkStats {
  people: number;
  visible: number;
  lod: [number, number, number];
  triangles: number;
  builds: number;
  /** CPU ms of the last `update`. */
  ms: number;
}

const wrapPi = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export class Villagers {
  readonly root = new Group();
  readonly stats: FolkStats = { people: 0, visible: 0, lod: [0, 0, 0], triangles: 0, builds: 0, ms: 0 };
  private readonly budget: FolkBudget;
  private readonly review: boolean;
  private folk: Folk | undefined;
  private builtSeed = -1;
  private readonly clock: FolkClock = createFolkClock();
  private poses: VillagerPose[] = [];
  private slots: Slot[] = [];
  private dist = new Float64Array(32);
  private lodNow = new Int8Array(32).fill(-1);
  private lodWant = new Int8Array(32);
  private order = new Int32Array(32);
  private readonly forcedRain: number | undefined;
  private overlay: FolkOverlay;
  private overlayFor: unknown[] = [];
  private readonly speech: Speech = { text: "", u: 0 };
  private frame = 0;
  /** When the last body was built (ms): a cold build is 10-50 ms of JavaScript, so they are spread out rather than done in a burst. */
  private lastBuild = -1e9;

  constructor(
    scene: Scene,
    private readonly world: CollisionWorld,
    budget: FolkBudget,
    /** Milliseconds between cold builds of bodies (tests and review scenes pass 0). */
    private readonly buildGapMs = 140,
  ) {
    // review scenes: `?folkbudget=review` lifts every limit (all in full detail), `?folklod=1|2` forces one level for everybody
    let params = new URLSearchParams();
    try {
      params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
    } catch {
      params = new URLSearchParams();
    }
    this.review = params.get("folkbudget") === "review";
    if (this.review) budget = { ...budget, count: 22, maxVisible: 24, lod0: 24, lod1: 24, lod2: 24, near: params.get("folklod") === "1" ? 0 : params.get("folklod") === "2" ? -1 : 500, mid: params.get("folklod") === "2" ? -1 : 500, far: 500, tris: 1e9 };
    this.budget = budget;
    this.root.name = "folk";
    scene.add(this.root);
    let forced: number | undefined;
    try {
      const w = parseWeatherKind(new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("weather"));
      if (w) forced = weatherPreset(w).rain;
    } catch {
      forced = undefined;
    }
    this.forcedRain = forced;
    this.overlay = new FolkOverlay(folkHints.layer, folkHints.camera);
    this.overlayFor = [folkHints.layer, folkHints.camera];
  }

  /** The people (built on first use: the network and the routes take ~0.1 s, once per world and seed). */
  private ensure(): Folk {
    if (this.folk && this.builtSeed === folkHints.seed) return this.folk;
    for (const s of this.slots) s.body?.dispose();
    const folk = buildFolk(this.world, folkHints.seed);
    this.folk = folk;
    this.builtSeed = folkHints.seed;
    const n = Math.min(this.budget.count, folk.roster.length);
    this.slots = [];
    this.poses = [];
    for (let i = 0; i < n; i++) {
      this.poses.push(createVillagerPose());
      this.slots.push({ body: undefined, spec: undefined, lod: -1, state: createBodyState(), umbrella: hash3(folkHints.seed, i, 0x0b) % 5 < 3, hue: hash3(folkHints.seed, i, 0x0c) % 12, waveT: 0, waveCool: 4 + hashFloat(i, 1, 9) * 10, greetT: 0, greet: "", lookAt: 0, offX: 0, offZ: 0, talk: 0 });
    }
    if (this.dist.length < n) {
      this.dist = new Float64Array(n);
      this.lodNow = new Int8Array(n).fill(-1);
      this.lodWant = new Int8Array(n);
      this.order = new Int32Array(n);
    }
    this.lodNow.fill(-1);
    this.stats.people = n;
    return folk;
  }

  /**
   * Review only (`?showcase=world&view=folkcast`): puts villager `i` where the caller says instead of where the schedule does. Poses are copied in
   * each frame after the schedule has run; `undefined` clears it.
   */
  cast: ((i: number, out: VillagerPose) => boolean) | undefined;

  /** The roster and where everybody is right now (for review scenes and tests). */
  get people(): { folk: Folk; poses: readonly VillagerPose[] } | undefined {
    return this.folk ? { folk: this.folk, poses: this.poses } : undefined;
  }

  /** The pose state last fed to villager `i`'s body (tests, showcase). */
  stateOf(i: number): BodyState | undefined {
    return this.slots[i]?.state;
  }

  /** The body of villager `i`, if it exists (tests, showcase). */
  bodyOf(i: number): FolkBody | undefined {
    return this.slots[i]?.body;
  }

  update(dt: number, f: FolkFrame): void {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const folk = this.ensure();
    this.frame++;
    if (this.overlayFor[0] !== folkHints.layer || this.overlayFor[1] !== folkHints.camera) {
      // (the game names its HUD layer and camera after the world is built)
      this.overlay.dispose();
      this.overlay = new FolkOverlay(folkHints.layer, folkHints.camera);
      this.overlayFor = [folkHints.layer, folkHints.camera];
    }
    setFolkClock(this.clock, folkHints.seed, f.worldSec * 1000, f.hours, folkHints.dayMinutes, this.forcedRain);
    const n = this.slots.length;
    const roster = folk.roster;
    const stations = folk.nav.stations;
    for (let i = 0; i < n; i++) {
      const p = this.poses[i]!;
      villagerAt(folk, i, this.clock, p);
      if (this.cast) {
        if (!this.cast(i, p)) p.visible = false;
        else p.visible = true;
      }
      this.dist[i] = p.visible ? Math.hypot(p.x - f.x, p.z - f.z) : Infinity;
      this.lodNow[i] = this.slots[i]!.body && this.slots[i]!.lod >= 0 ? this.slots[i]!.lod : -1;
    }
    const plan = planLods(this.dist, this.lodNow, n, this.budget, this.lodWant, this.order);
    let builds = 0;
    let tris = 0;
    const counts: [number, number, number] = [0, 0, 0];
    this.overlay.begin();
    let bubbles = 0;
    let tags = 0;
    for (let r = 0; r < n; r++) {
      const i = this.order[r]!;
      const slot = this.slots[i]!;
      const want = this.lodWant[i]!;
      if (want < 0) {
        if (slot.body) slot.body.rig.root.visible = false;
        slot.lod = -1;
        continue;
      }
      const v = roster[i]!;
      const pose = this.poses[i]!;
      const nowMs = typeof performance !== "undefined" ? performance.now() : 0;
      const mayBuild = builds < 1 && nowMs - this.lastBuild > (this.review ? 0 : want === 2 ? this.buildGapMs * 0.4 : this.buildGapMs);
      if (!slot.body) {
        if (!mayBuild) continue; // one new body at a time, a little apart: a cold build is 10-50 ms
        slot.spec ??= folkSpec(v);
        slot.body = new FolkBody(slot.spec, v.scale, want as Lod, this.budget.outlines, this.root);
        builds++;
        this.lastBuild = nowMs;
        slot.lod = want;
      } else if (slot.body.lod !== want) {
        // (a coarser level is cheap, a finer one is a geometry build: it waits its turn)
        if (want > slot.body.lod || mayBuild) {
          const finer = want < slot.body.lod;
          slot.body.setLod(want as Lod);
          if (finer) {
            builds++;
            this.lastBuild = nowMs;
          }
        }
        slot.lod = slot.body.lod;
      }
      const body = slot.body!;
      body.rig.root.visible = true;
      slot.lod = body.lod;
      counts[body.lod]!++;
      tris += body.lod === 0 ? (this.budget.outlines ? FOLK_TRIS.lod0Ink : FOLK_TRIS.lod0) : body.lod === 1 ? FOLK_TRIS.lod1 : FOLK_TRIS.lod2;

      // ---- reactions to the players (cosmetic) ------------------------------------------------------------------------------------------
      const s = slot.state;
      let nearest = Infinity;
      let nx = 0;
      let nz = 0;
      for (let k = 0; k < f.walkerCount; k++) {
        const w = f.walkers[k]!;
        const d = Math.hypot(w.x - pose.x, w.z - pose.z);
        if (d < nearest) {
          nearest = d;
          nx = w.x;
          nz = w.z;
        }
      }
      const rel = nearest < 12 ? wrapPi(Math.atan2(-(nx - pose.x), -(nz - pose.z)) - pose.facing) : 0;
      const front = Math.abs(rel) < 2.0;
      slot.lookAt += ((nearest < 9 && front && pose.act !== "sleep" ? 1 : 0) - slot.lookAt) * Math.min(1, dt * 3);
      s.look = slot.lookAt;
      s.lookYaw = Math.max(-1.05, Math.min(1.05, rel * 0.85));
      s.lookPitch = 0.05;
      slot.waveCool -= dt;
      slot.waveT = Math.max(0, slot.waveT - dt);
      slot.greetT = Math.max(0, slot.greetT - dt);
      const idleish = pose.act === "idle" || pose.act === "lean" || pose.act === "shelter";
      if (nearest < 5.5 && front && idleish && slot.waveCool <= 0 && want <= 1) {
        slot.waveT = 2.4;
        slot.greetT = 4.2;
        slot.waveCool = 24 + hashFloat(i, this.frame >> 6, 3) * 20;
        slot.greet = villagerGreeting(v, Math.floor(f.worldSec / 30) + i);
      }
      s.wave = Math.min(1, slot.waveT / 0.4);
      // somebody in the way steps aside, if the ground beside them is fair
      let ox = 0;
      let oz = 0;
      if (pose.act === "walk" && nearest < 2.3 && pose.speed > 0.2) {
        const dx = pose.x - nx;
        const dz = pose.z - nz;
        const d = Math.hypot(dx, dz) || 1;
        const k = (1 - d / 2.3) * 0.75;
        ox = (dx / d) * k;
        oz = (dz / d) * k;
        if (standingHeight(this.world, pose.x + ox, pose.z + oz, pose.y) === undefined) ox = oz = 0;
      }
      // and a walker steps round anybody standing in the way (the schedule walks its paths as if nobody stood on them): sideways, on whichever side
      // of them the path already runs, so a walker heading straight at somebody is never pushed back and then forward
      if (pose.act === "walk" && pose.speed > 0.2) {
        const rx = Math.cos(pose.facing), rz = -Math.sin(pose.facing); // (across the way of travel)
        let sx = 0;
        let sz = 0;
        for (let j = 0; j < n; j++) {
          const q = this.poses[j]!;
          if (j === i || !q.visible || q.act === "walk") continue;
          const d = Math.hypot(pose.x - q.x, pose.z - q.z);
          if (d >= PASS_BY) continue;
          const side = (pose.x - q.x) * rx + (pose.z - q.z) * rz < -1e-3 ? -1 : 1;
          const k = (1 - d / PASS_BY) * 0.6 * side;
          sx += rx * k;
          sz += rz * k;
        }
        if ((sx !== 0 || sz !== 0) && standingHeight(this.world, pose.x + ox + sx, pose.z + oz + sz, pose.y) !== undefined) {
          ox += sx;
          oz += sz;
        }
      }
      slot.offX += (ox - slot.offX) * Math.min(1, dt * 4);
      slot.offZ += (oz - slot.offZ) * Math.min(1, dt * 4);

      // ---- pose ------------------------------------------------------------------------------------------------------------------------------
      // whoever has a seat sits (reading, writing or resting), whatever the schedule calls it; a bench's overflow stands beside it
      s.act = pose.seated && pose.act !== "walk" ? "sit" : pose.act;
      s.carry = pose.carry;
      s.speed = pose.speed / v.scale;
      s.t = f.worldSec + i * 1.37;
      s.rain = f.rain;
      s.umbrella = slot.umbrella;
      s.hue = slot.hue;
      s.cane = v.age === "elder";
      s.covered = stations[pose.station]?.sheltered === true || stations[pose.station]?.hidden === true;
      s.ground = pose.y;
      // a talker gestures while their slip is up
      s.talk = pose.act === "chat" ? slot.talk : 0;
      body.place(pose.x + slot.offX, pose.z + slot.offZ, pose.facing);
      if (body.lod < 2 || (this.frame + i) % 2 === 0) body.update(body.lod < 2 ? dt : dt * 2, s);

      // ---- overlay -------------------------------------------------------------------------------------------------------------------------------
      if (this.overlay.active && want <= 1) {
        const top = pose.y + body.rig.proportions.totalHeight * v.scale + 0.42;
        let text = "";
        let u = 0.5;
        if (slot.greetT > 0) {
          text = slot.greet;
          u = 1 - slot.greetT / 4.2;
        } else {
          const said = villagerSays(v, pose, f.worldSec, f.hours, f.rain, this.speech);
          if (said) {
            text = said.text;
            u = said.u;
          }
        }
        slot.talk += ((text ? 1 : 0) - slot.talk) * Math.min(1, dt * 6);
        if (text && bubbles < 3 && this.dist[i]! < 26) {
          this.overlay.bubble(i, text, pose.x, top, pose.z, u);
          bubbles++;
        } else if (!text) slot.talk = Math.max(0, slot.talk - dt * 4);
        if (tags < 2 && nearest < 4.2) {
          this.overlay.tag(i, v.name, pose.x, top - 0.12 - (text ? 0.5 : 0), pose.z);
          tags++;
        }
      }
    }
    this.overlay.end();
    this.stats.visible = plan.visible;
    this.stats.lod = counts;
    this.stats.triangles = tris;
    this.stats.builds = builds;
    if (typeof performance !== "undefined") this.stats.ms = performance.now() - t0;
  }

  dispose(): void {
    for (const s of this.slots) s.body?.dispose();
    this.slots = [];
    this.overlay.dispose();
    this.root.removeFromParent();
    disposeProps();
  }
}
