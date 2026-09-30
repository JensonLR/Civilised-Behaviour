import type { Rewind, RewindView } from "@colyseus/core";
import {
  BUTTON,
  CANNON,
  CANNON_SPOTS,
  CARRIED_MASK,
  COMBAT,
  FLAG,
  SURFACE,
  WEAPON,
  WEAPONS,
  aimDirection,
  angleDelta,
  blastDistance,
  blastFalloff,
  bodyCentre,
  cannonLoadRate,
  clamp,
  elevFromWire,
  isCarried,
  meleeDamage,
  meleeFan,
  newBodyHit,
  newWorldHit,
  pickZone,
  projectileLag,
  rangedDamage,
  rayBody,
  rayWorld,
  shotDirection,
  shotSeed,
  spreadFor,
  stepBallistic,
  weaponFromWire,
  yawFromWire,
  type Ballistic,
  type BlastDef,
  type BoomEvent,
  type BodyPose,
  type CannonStateType,
  type CollisionWorld,
  type HitMarkEvent,
  type ImpactEvent,
  type MeleeStats,
  type PlayerStateType,
  type RangedStats,
  type Rng,
  type ShotEvent,
  type SurfaceId,
  type WeaponDef,
  type WeaponId,
  type WorldHit,
  type ZoneId,
} from "@cb/shared";
import { metrics } from "../metrics.ts";
import type { PhysicsWorld, PropRayHit } from "../physics.ts";
import type { HitInfo } from "./Casualties.ts";

/** What combat needs from the room. Keeps the system testable and WorldRoom slim. */
export interface CombatHost {
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void; get(id: string): PlayerStateType | undefined };
  world: CollisionWorld;
  physics: PhysicsWorld;
  /** The single entry point for harm (Casualties.damage): wounds, downs and dismemberment all happen there. */
  damage(sessionId: string, amount: number, hit: HitInfo): void;
  /** Server-side lag compensation (Colyseus Rewind); undefined = shoot at live positions. */
  rewind: Rewind | undefined;
  friendlyFire(): boolean;
  worldSeed: number;
  rng: Rng;
  cannons: { forEach(cb: (c: CannonStateType, id: string) => void): void };
  emitShot(e: ShotEvent): void;
  emitImpact(e: ImpactEvent): void;
  emitBoom(e: BoomEvent): void;
  sendTo(sessionId: string, e: HitMarkEvent): void;
  /** Something loud happened at (x, z), audible to `radius` metres. Nothing listens yet (AI arrives with M4+); tests and metrics do. */
  noise?(x: number, z: number, radius: number, source: string): void;
}

/** A held button counts only while frames keep arriving (a stalled client cannot hold a rammer forever). */
const HOLD_STALE_MS = 1000;
/** Impact events per shot (a blunderbuss has 8 pellets; the eye cannot use more than a handful of puffs). */
const MAX_IMPACTS_PER_SHOT = 4;
/** Hits within the reach of the cannon crew are ignored beyond this vertical tolerance. */
const CREW_VERTICAL = 1.6;

const BUSY = FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.DRAGGED | FLAG.REVIVING | FLAG.OPERATING;

interface Swing {
  /** Seconds until the blow lands. */
  left: number;
  weapon: WeaponId;
  m: MeleeStats;
  yaw: number;
  elev: number;
  lagMs: number;
  key: number;
}

/** Server-only combat state of one player. What the client may see is copied into PlayerState by `sync`. */
interface PlayerCombat {
  owned: number;
  current: WeaponId | -1;
  mags: number[];
  reserve: number[];
  /** Seconds until the next attack, draw or switch is allowed. */
  ready: number;
  /** Seconds left of a reload, and its full length (0 = not reloading). */
  reloadLeft: number;
  reloadTotal: number;
  /** Seconds before another weapon change is accepted. */
  switchLock: number;
  swing: Swing | undefined;
  shots: number;
  aimYaw: number;
  aimElev: number;
  held: number;
  heldAt: number;
}

interface Pending {
  shooter: string;
  target: string;
  weapon: WeaponId;
  damage: number;
  zone: number;
  zoneDamage: number;
  dirX: number;
  dirZ: number;
  knock: number;
  stumble: number;
  point: { x: number; y: number; z: number };
}

interface Cannon {
  id: string;
  st: CannonStateType;
  x: number;
  y: number;
  z: number;
  restYaw: number;
  /** Exact loading progress 0..1 (the replicated byte is a rounding of it) and the fuse's seconds left. */
  load: number;
  fuse: number;
  lighter: string;
  operating: Set<string>;
  shotNo: number;
}

/** Struct-of-arrays pool of live rounds: nothing is allocated when a shot is fired or a ball flies. */
class Projectiles {
  readonly cap = COMBAT.maxProjectiles;
  live = 0;
  readonly alive = new Uint8Array(this.cap);
  readonly x = new Float64Array(this.cap);
  readonly y = new Float64Array(this.cap);
  readonly z = new Float64Array(this.cap);
  readonly vx = new Float64Array(this.cap);
  readonly vy = new Float64Array(this.cap);
  readonly vz = new Float64Array(this.cap);
  readonly age = new Float64Array(this.cap);
  readonly life = new Float64Array(this.cap);
  readonly travel = new Float64Array(this.cap);
  readonly lagMs = new Float64Array(this.cap);
  readonly weapon = new Uint8Array(this.cap);
  readonly key = new Uint32Array(this.cap);
  readonly owner: string[] = new Array<string>(this.cap).fill("");
  private cursor = 0;

  /** Claims a free slot, or -1 when the pool is full. */
  spawn(): number {
    for (let k = 0; k < this.cap; k++) {
      const i = (this.cursor + k) % this.cap;
      if (this.alive[i] === 0) {
        this.cursor = i + 1;
        this.alive[i] = 1;
        this.live++;
        return i;
      }
    }
    return -1;
  }

  kill(i: number): void {
    if (this.alive[i] === 0) return;
    this.alive[i] = 0;
    this.live--;
  }
}

const shotDir = { x: 0, y: 0, z: 0 };
const aimDir = { x: 0, y: 0, z: 0 };

/** Result of casting one round along one segment. */
interface Cast {
  kind: "none" | "world" | "prop" | "player";
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceId;
  target: string;
  zone: number;
  prop: string;
}

const newCast = (): Cast => ({ kind: "none", t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, surface: SURFACE.EARTH, target: "", zone: 0, prop: "" });

/**
 * Weapons, projectiles, melee, explosions and the field cannon. Authoritative:
 *  - the client sends buttons, a weapon wish and an aim direction; everything else (ammo, cooldowns, reloads, which weapons a player owns,
 *    where a shot starts, what it hits, the damage) is decided here from server state;
 *  - every timer runs on SERVER ticks, so flooding input frames cannot fire faster (the input budget already bounds frames per tick, and a
 *    per-weapon cooldown bounds shots per second regardless);
 *  - hits on people are judged against where the SHOOTER saw them (lag compensation via Colyseus `Rewind`, clamped to COMBAT.rewindMaxMs)
 *    for hitscan, melee and the first instants of a projectile's flight, and against live positions after that;
 *  - all harm goes through `host.damage` (Casualties.damage) with a zone and a direction, so wounds, downing and dismemberment are unchanged.
 * Recoil, muzzle flash and smoke are cosmetic and client-side: nothing here feeds back into the predicted movement step, except the flags
 * FLAG.AIMING (derived from a button by the step itself) and FLAG.OPERATING (server-set while working a cannon, like REVIVING).
 */
export class Combat {
  private readonly pcs = new Map<string, PlayerCombat>();
  private readonly proj = new Projectiles();
  private readonly pending = new Map<number, Pending>();
  private readonly cannons: Cannon[] = [];
  private shotCounter = 1;
  /** Lag compensation on/off (a switch so the tests can show what it buys). */
  lagCompensation = true;
  // scratch
  private readonly cast = newCast();
  private readonly bodyHit = newBodyHit();
  private readonly worldHit: WorldHit = newWorldHit();
  private readonly propHit: PropRayHit = { id: "", t: 0, nx: 0, ny: 1, nz: 0 };
  private readonly ball: Ballistic = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private readonly pose: BodyPose = { x: 0, y: 0, z: 0, facing: 0, flags: 0 };
  private readonly pt = { x: 0, y: 0, z: 0 };
  private impactKey = -1;
  private impactCount = 0;
  private workers: string[] = [];
  /** Counters for tests and /metrics. */
  readonly stats = { shots: 0, swings: 0, hits: 0, blasts: 0, refused: 0, projectilesDropped: 0 };
  /** The rewind (ms) applied to the last shots, newest last (diagnostics: tests compare it with the RTT the client is under). */
  readonly lagLog: number[] = [];

  constructor(private readonly host: CombatHost) {
    let i = 0;
    host.cannons.forEach((st) => {
      const spot = CANNON_SPOTS[i]!;
      this.cannons.push({ id: `cannon:${i}`, st, x: st.x, y: st.y, z: st.z, restYaw: spot.yaw, load: 0, fuse: 0, lighter: "", operating: new Set(), shotNo: 0 });
      i++;
    });
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------------------------------

  onJoin(sessionId: string, p: PlayerStateType): void {
    const pc: PlayerCombat = {
      owned: CARRIED_MASK,
      current: -1,
      mags: WEAPON_LIST.map((id) => (WEAPONS[id].ranged?.magazine ?? 0)),
      reserve: WEAPON_LIST.map((id) => WEAPONS[id].ranged?.startReserve ?? 0),
      ready: 0,
      reloadLeft: 0,
      reloadTotal: 0,
      switchLock: 0,
      swing: undefined,
      shots: 0,
      aimYaw: 0,
      aimElev: 0,
      held: 0,
      heldAt: 0,
    };
    this.pcs.set(sessionId, pc);
    this.sync(p, pc);
  }

  onLeave(sessionId: string): void {
    this.pcs.delete(sessionId);
    for (const c of this.cannons) c.operating.delete(sessionId);
    for (let i = 0; i < this.proj.cap; i++) if (this.proj.alive[i] === 1 && this.proj.owner[i] === sessionId) this.proj.owner[i] = "";
  }

  /** QA and campaign hook: gives weapons (all when `id` is undefined) and refills their ammunition. Server-side only. */
  give(sessionId: string, id?: WeaponId): boolean {
    const pc = this.pcs.get(sessionId);
    if (!pc) return false;
    const list = id === undefined ? WEAPON_LIST.filter((w) => isCarried(w)) : isCarried(id) ? [id] : [];
    if (list.length === 0) return false;
    for (const w of list) {
      pc.owned |= 1 << w;
      const r = WEAPONS[w].ranged;
      if (r) {
        pc.mags[w] = r.magazine;
        pc.reserve[w] = r.reserveMax;
      }
    }
    const p = this.host.players.get(sessionId);
    if (p) this.sync(p, pc);
    return true;
  }

  /** Read-only view for tests and diagnostics. */
  inspect(sessionId: string): { owned: number; current: number; mag: number[]; reserve: number[]; ready: number; reloadLeft: number; shots: number } | undefined {
    const pc = this.pcs.get(sessionId);
    return pc && { owned: pc.owned, current: pc.current, mag: [...pc.mags], reserve: [...pc.reserve], ready: pc.ready, reloadLeft: pc.reloadLeft, shots: pc.shots };
  }

  /** Test hook: removes a weapon from a player's kit (the server owns the kit; clients can only ask). */
  takeAway(sessionId: string, id: WeaponId): void {
    const pc = this.pcs.get(sessionId);
    if (pc) pc.owned &= ~(1 << id);
  }

  get liveProjectiles(): number {
    return this.proj.live;
  }

  // ---- input --------------------------------------------------------------------------------------------------------------------

  /**
   * One input frame, AFTER the movement step. `pressed` is the rising-edge button mask. Returns true when this frame's INTERACT press
   * was taken by a cannon crew (so a prop beside the gun is not also picked up).
   */
  onFrame(
    sessionId: string,
    p: PlayerStateType,
    cmd: { yaw: number; buttons: number; aimYaw?: number; aimElev?: number; weapon?: number },
    pressed: number,
  ): boolean {
    const pc = this.pcs.get(sessionId);
    if (!pc) return false;
    pc.held = cmd.buttons;
    pc.heldAt = Date.now();
    // The shot's direction may differ a little from the camera (the crosshair is where the player looks; the muzzle is elsewhere), never by much.
    const camYaw = yawFromWire(cmd.yaw);
    const wanted = typeof cmd.aimYaw === "number" ? yawFromWire(cmd.aimYaw) : camYaw;
    pc.aimYaw = camYaw + clamp(angleDelta(camYaw, wanted), -COMBAT.aimYawSlack, COMBAT.aimYawSlack);
    pc.aimElev = elevFromWire(cmd.aimElev ?? 0);
    p.aim = Math.round(clamp(pc.aimElev, -1.5, 1.5) * 80);

    // A cannon crew takes the INTERACT press: the hold that follows is the work.
    let consumed = false;
    if ((pressed & BUTTON.INTERACT) !== 0 && (p.flags & (FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.REVIVING | FLAG.DRAGGED)) === 0) {
      const c = this.cannonNear(p);
      if (c && c.st.phase !== 3) consumed = true;
    }
    // Lighting the fuse: FIRE while working a loaded gun.
    if ((pressed & BUTTON.FIRE) !== 0 && (cmd.buttons & BUTTON.INTERACT) !== 0) {
      const c = this.cannonNear(p);
      if (c && c.st.phase === 2 && (p.flags & FLAG.DOWNED) === 0) {
        c.st.phase = 3;
        c.fuse = CANNON.fuseSeconds;
        c.lighter = sessionId;
        this.sync(p, pc);
        return true;
      }
    }

    if ((p.flags & BUSY) !== 0) {
      this.cancelActions(pc);
      return consumed;
    }
    this.handleSwitch(pc, weaponFromWire(cmd.weapon ?? 0));
    const def = pc.current >= 0 ? WEAPONS[pc.current as WeaponId] : undefined;

    if ((pressed & BUTTON.RELOAD) !== 0) this.startReload(pc, def);
    if (def?.fire === "melee") {
      // Blades and sticks swing on the press and keep swinging while it is held (each swing waits out the cooldown).
      if ((cmd.buttons & (BUTTON.FIRE | BUTTON.MELEE)) !== 0) this.beginSwing(sessionId, p, pc, def, def.melee!);
    } else {
      if ((pressed & BUTTON.FIRE) !== 0 && def?.ranged) this.fire(sessionId, p, pc, def, def.ranged);
      if ((pressed & BUTTON.MELEE) !== 0) {
        const bash = (def ?? WEAPONS[WEAPON.FISTS]).melee;
        if (bash) this.beginSwing(sessionId, p, pc, def ?? WEAPONS[WEAPON.FISTS], bash);
      }
    }
    this.sync(p, pc);
    return consumed;
  }

  private cancelActions(pc: PlayerCombat): void {
    pc.swing = undefined;
    pc.reloadLeft = 0;
    pc.reloadTotal = 0;
  }

  /** The wish for a weapon: accepted only for what the player owns, at most once per switchSeconds, and it costs a draw time. */
  private handleSwitch(pc: PlayerCombat, wish: WeaponId | -1): void {
    if (wish === pc.current) return;
    if (wish >= 0 && (!isCarried(wish) || (pc.owned & (1 << wish)) === 0)) {
      this.stats.refused++;
      return;
    }
    if (pc.switchLock > 0) return;
    pc.current = wish;
    pc.switchLock = COMBAT.switchSeconds;
    this.cancelActions(pc); // a reload in progress is abandoned; a swing in the air is lost
    const draw = wish >= 0 ? WEAPONS[wish as WeaponId].drawSeconds : 0.25;
    // Changing weapon never shortens a wait already in force (no swapping away the cooldown of the last shot).
    pc.ready = Math.max(pc.ready, draw, COMBAT.switchSeconds);
  }

  private startReload(pc: PlayerCombat, def: WeaponDef | undefined): void {
    const r = def?.ranged;
    if (!def || !r || def.id === WEAPON.CANNON || pc.reloadLeft > 0) return;
    if (pc.mags[def.id]! >= r.magazine || pc.reserve[def.id]! <= 0) return;
    pc.reloadLeft = r.reload;
    pc.reloadTotal = r.reload;
  }

  // ---- shooting -----------------------------------------------------------------------------------------------------------------

  private eye(p: PlayerStateType, out: { x: number; y: number; z: number }): void {
    out.x = p.x;
    out.y = p.y + ((p.flags & FLAG.CROUCHING) !== 0 ? COMBAT.eyeHeightCrouch : COMBAT.eyeHeight);
    out.z = p.z;
  }

  private fire(sessionId: string, p: PlayerStateType, pc: PlayerCombat, def: WeaponDef, r: RangedStats): void {
    if (pc.ready > 0 || pc.reloadLeft > 0 || def.id === WEAPON.CANNON) return;
    if (pc.mags[def.id]! <= 0) {
      this.stats.refused++;
      this.startReload(pc, def); // a click on an empty gun starts the reload
      return;
    }
    pc.mags[def.id]!--;
    pc.ready = r.cooldown;
    const shotNo = pc.shots++;
    p.shots = pc.shots & 255;
    const seed = shotSeed(this.host.worldSeed, p.slot, shotNo & 255); // (the client only ever sees the counter's low byte: PlayerState.shots)
    const speed = Math.hypot(p.vx, p.vz);
    const spread = spreadFor(r, { aiming: (p.flags & FLAG.AIMING) !== 0, speed, crouching: (p.flags & FLAG.CROUCHING) !== 0 });
    this.eye(p, this.pt);
    const ox = this.pt.x;
    const oy = this.pt.y;
    const oz = this.pt.z;
    aimDirection(pc.aimYaw, pc.aimElev, aimDir);
    this.stats.shots++;
    metrics.shotsFired++;
    this.host.emitShot({ id: sessionId, w: def.id, x: ox, y: oy, z: oz, dx: aimDir.x, dy: aimDir.y, dz: aimDir.z, seed, spread });
    this.host.noise?.(p.x, p.z, def.noise, sessionId);

    // Where the shooter saw the world when they pulled the trigger.
    const view = this.viewOf(sessionId);
    const lagMs = view ? this.lagOf(view) : 0;
    if (this.lagLog.push(lagMs) > 64) this.lagLog.shift();
    const key = this.shotCounter++ >>> 0;
    for (let i = 0; i < r.pellets; i++) {
      shotDirection(pc.aimYaw, pc.aimElev, spread, seed, i, shotDir);
      if (def.fire === "hitscan") this.hitscan(sessionId, def, r, ox, oy, oz, shotDir.x, shotDir.y, shotDir.z, view, key);
      else this.launch(sessionId, def, r, ox, oy, oz, shotDir.x, shotDir.y, shotDir.z, lagMs, key);
    }
  }

  private viewOf(sessionId: string): RewindView | undefined {
    const rw = this.host.rewind;
    return rw && this.lagCompensation ? rw.lastSeenBy(sessionId) : undefined;
  }

  /** Milliseconds between "now" (the newest recorded state) and the moment the shooter's view reads, never above the rewind clamp. */
  private lagOf(view: RewindView): number {
    const rw = this.host.rewind!;
    return clamp(rw.lastRecordedAt - view.time, 0, COMBAT.rewindMaxMs);
  }

  private poseOf(p: PlayerStateType, view: RewindView | undefined): BodyPose {
    const o = this.pose;
    if (view) {
      o.x = view.value(p, "x");
      o.y = view.value(p, "y");
      o.z = view.value(p, "z");
      o.facing = view.value(p, "facing");
      o.flags = view.value(p, "flags");
    } else {
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
      o.facing = p.facing;
      o.flags = p.flags;
    }
    return o;
  }

  /**
   * Casts one ray/segment against the world, the free props and (unless `skipPlayers`) every other standing player, at the poses `view`
   * gives (or live when undefined). Fills `this.cast` with the NEAREST thing hit.
   */
  private castSegment(shooter: string, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, radius: number, view: RewindView | undefined): Cast {
    const c = this.cast;
    c.kind = "none";
    c.t = maxT;
    let best = maxT;
    if (rayWorld(this.host.world, ox, oy, oz, dx, dy, dz, best, this.worldHit) && this.worldHit.t < best) {
      best = this.worldHit.t;
      c.kind = "world";
      c.t = best;
      c.nx = this.worldHit.nx;
      c.ny = this.worldHit.ny;
      c.nz = this.worldHit.nz;
      c.surface = this.worldHit.surface;
    }
    if (this.host.physics.raycastProp(ox, oy, oz, dx, dy, dz, best, this.propHit) && this.propHit.t < best) {
      best = this.propHit.t;
      c.kind = "prop";
      c.t = best;
      c.prop = this.propHit.id;
      c.nx = this.propHit.nx;
      c.ny = this.propHit.ny;
      c.nz = this.propHit.nz;
      c.surface = SURFACE.WOOD;
    }
    // Comrades are only a target when friendly fire is on (otherwise rounds pass through them: nobody ever blocks a shot they cannot be hurt by).
    if (this.host.friendlyFire()) {
      this.host.players.forEach((t, id) => {
        if (id === shooter || (t.flags & FLAG.DOWNED) !== 0 || !t.connected) return;
        const pose = this.poseOf(t, view);
        if (rayBody(pose, ox, oy, oz, dx, dy, dz, best, radius, this.bodyHit) && this.bodyHit.t < best) {
          best = this.bodyHit.t;
          c.kind = "player";
          c.t = best;
          c.target = id;
          c.zone = this.bodyHit.zone;
        }
      });
    }
    if (c.kind !== "none") {
      c.x = ox + dx * c.t;
      c.y = oy + dy * c.t;
      c.z = oz + dz * c.t;
    }
    return c;
  }

  /** Test hook: told, for every hitscan round, how far the ray passed from each other player's chest in the rewound view and in the live one. */
  diag: ((info: { lagMs: number; missRewound: number; missLive: number; viewTime: number; recorded: number }) => void) | undefined;

  private hitscan(shooter: string, def: WeaponDef, r: RangedStats, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, view: RewindView | undefined, key: number): void {
    if (this.diag && view) {
      const c = { x: 0, y: 0, z: 0 };
      this.host.players.forEach((t, id) => {
        if (id === shooter) return;
        const miss = (p: BodyPose): number => {
          bodyCentre(p, c);
          const vx = c.x - ox;
          const vy = c.y - oy;
          const vz = c.z - oz;
          const along = vx * dx + vy * dy + vz * dz;
          return Math.hypot(vx - dx * along, vy - dy * along, vz - dz * along);
        };
        const rewound = miss({ ...this.poseOf(t, view) });
        const live = miss({ ...this.poseOf(t, undefined) });
        this.diag!({ lagMs: this.lagOf(view), missRewound: rewound, missLive: live, viewTime: view.time, recorded: this.host.rewind!.lastRecordedAt });
      });
    }
    const c = this.castSegment(shooter, ox, oy, oz, dx, dy, dz, r.range, r.radius, view);
    this.apply(shooter, def, r, c, dx, dy, dz, c.t, key);
  }

  /** Consequences of a round reaching something at `dist` metres from the muzzle. */
  private apply(shooter: string, def: WeaponDef, r: RangedStats, c: Cast, dx: number, dy: number, dz: number, dist: number, key: number): void {
    if (c.kind === "none") return;
    if (c.kind === "player") {
      this.addHit(shooter, c.target, def.id, rangedDamage(r, c.zone, dist), c.zone, dx, dz, r.knock, r.stumble, c.x, c.y, c.z, key);
      if (r.blast) this.explode(shooter, def.id, r.blast, c.x, c.y, c.z, c.target);
      return;
    }
    if (c.kind === "prop") {
      this.host.physics.shoveProp(c.prop, dx, dy + 0.15, dz, r.propImpulse / r.pellets, c.x, c.y, c.z, COMBAT.maxPropSpeed);
      this.impact(shooter, c, def.id, key);
    } else {
      this.impact(shooter, c, def.id, key);
    }
    if (r.blast) this.explode(shooter, def.id, r.blast, c.x - dx * 0.05, c.y - dy * 0.05 + 0.05, c.z - dz * 0.05, "");
  }

  private impact(shooter: string, c: Cast, weapon: WeaponId, key: number): void {
    if (key !== this.impactKey) {
      this.impactKey = key;
      this.impactCount = 0;
    }
    if (this.impactCount++ >= MAX_IMPACTS_PER_SHOT) return;
    this.host.emitImpact({ id: shooter, x: c.x, y: c.y, z: c.z, nx: c.nx, ny: c.ny, nz: c.nz, s: c.surface, w: weapon });
  }

  private addHit(shooter: string, target: string, weapon: WeaponId, damage: number, zone: number, dx: number, dz: number, knock: number, stumble: number, x: number, y: number, z: number, key: number): void {
    const t = this.host.players.get(target);
    if (!t || !(damage > 0)) return;
    const k = key * 8 + (t.slot & 7);
    let h = this.pending.get(k);
    if (!h) {
      h = { shooter, target, weapon, damage: 0, zone, zoneDamage: 0, dirX: 0, dirZ: 0, knock: 0, stumble: 0, point: { x, y, z } };
      this.pending.set(k, h);
    }
    h.damage += damage;
    if (damage > h.zoneDamage) {
      h.zoneDamage = damage;
      h.zone = zone;
      h.point.x = x;
      h.point.y = y;
      h.point.z = z;
    }
    h.dirX += dx;
    h.dirZ += dz;
    h.knock = Math.max(h.knock, knock);
    h.stumble = Math.max(h.stumble, stumble);
  }

  /** Turns the hits gathered this tick into damage: one wound event per shot per victim, however many pellets landed. */
  private flush(): void {
    if (this.pending.size === 0) return;
    for (const h of this.pending.values()) {
      const t = this.host.players.get(h.target);
      if (!t) continue;
      const def = WEAPONS[h.weapon];
      let dirX = h.dirX;
      let dirZ = h.dirZ;
      let len = Math.hypot(dirX, dirZ);
      if (len < 1e-6) {
        const s = this.host.players.get(h.shooter);
        dirX = s ? t.x - s.x : 0;
        dirZ = s ? t.z - s.z : -1;
        len = Math.hypot(dirX, dirZ) || 1;
      }
      dirX /= len;
      dirZ /= len;
      const self = h.shooter === h.target;
      const damage = h.damage * (self ? Math.min(def.ffScale, 0.5) : def.ffScale);
      const before = t.missing;
      this.host.damage(h.target, damage, { zone: h.zone as ZoneId, dirX, dirZ, severBias: def.severBias });
      this.knock(t, dirX, dirZ, h.knock, h.stumble, 0);
      this.stats.hits++;
      metrics.hitsLanded++;
      if (!self) this.host.sendTo(h.shooter, { zone: h.zone, down: (t.flags & FLAG.DOWNED) !== 0, sever: t.missing !== before });
    }
    this.pending.clear();
  }

  /** Adds velocity to a person (bounded) and takes some of their control for a moment. The predicted state simply adopts it. */
  private knock(t: PlayerStateType, dirX: number, dirZ: number, speed: number, stumble: number, lift: number): void {
    if ((t.flags & FLAG.DOWNED) !== 0) return;
    if (speed > 0) {
      const s = Math.min(speed, COMBAT.maxKnock);
      t.vx += dirX * s;
      t.vz += dirZ * s;
    }
    if (lift > 0) {
      t.vy = Math.max(t.vy, Math.min(lift, COMBAT.maxKnock));
      t.flags &= ~FLAG.GROUNDED;
    }
    if (stumble > 0) t.stumble = Math.max(t.stumble, stumble);
  }

  // ---- projectiles --------------------------------------------------------------------------------------------------------------

  private launch(shooter: string, def: WeaponDef, r: RangedStats, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, lagMs: number, key: number): void {
    const P = this.proj;
    const i = P.spawn();
    if (i < 0) {
      this.stats.projectilesDropped++;
      return;
    }
    P.x[i] = ox;
    P.y[i] = oy;
    P.z[i] = oz;
    P.vx[i] = dx * r.speed;
    P.vy[i] = dy * r.speed;
    P.vz[i] = dz * r.speed;
    P.age[i] = 0;
    P.life[i] = r.range / r.speed;
    P.travel[i] = 0;
    P.lagMs[i] = lagMs;
    P.weapon[i] = def.id;
    P.key[i] = key;
    P.owner[i] = shooter;
  }

  private stepProjectiles(dt: number): void {
    const P = this.proj;
    if (P.live === 0) return;
    const rw = this.host.rewind;
    for (let i = 0; i < P.cap; i++) {
      if (P.alive[i] === 0) continue;
      const def = WEAPONS[P.weapon[i] as WeaponId];
      const r = def.ranged!;
      const ox = P.x[i]!;
      const oy = P.y[i]!;
      const oz = P.z[i]!;
      const b = this.ball;
      b.x = ox;
      b.y = oy;
      b.z = oz;
      b.vx = P.vx[i]!;
      b.vy = P.vy[i]!;
      b.vz = P.vz[i]!;
      stepBallistic(b, dt, r.gravity);
      const sx = b.x - ox;
      const sy = b.y - oy;
      const sz = b.z - oz;
      const len = Math.hypot(sx, sy, sz);
      P.age[i]! += dt;
      P.x[i] = b.x;
      P.y[i] = b.y;
      P.z[i] = b.z;
      P.vx[i] = b.vx;
      P.vy[i] = b.vy;
      P.vz[i] = b.vz;
      if (len > 1e-9) {
        // The first instants of a flight are judged in the shooter's view of the world, fading to live positions (COMBAT.projectileRewindSeconds).
        const age = P.age[i]! - dt;
        const lag = projectileLag(P.lagMs[i]!, age);
        const view = rw && this.lagCompensation && lag > 1 ? rw.at(rw.lastRecordedAt - lag) : undefined;
        const ux = sx / len;
        const uy = sy / len;
        const uz = sz / len;
        const c = this.castSegment(P.owner[i]!, ox, oy, oz, ux, uy, uz, len, r.radius, view);
        if (c.kind !== "none") {
          const dist = P.travel[i]! + c.t;
          // A pellet or ball whose owner has left still lands; it just has nobody to credit.
          this.apply(P.owner[i]!, def, r, c, ux, uy, uz, dist, P.key[i]!);
          P.kill(i);
          continue;
        }
        P.travel[i]! += len;
      }
      if (P.age[i]! >= P.life[i]! || Math.hypot(b.x, b.z) > this.host.world.boundsRadius + 60) P.kill(i);
    }
  }

  // ---- melee --------------------------------------------------------------------------------------------------------------------

  private beginSwing(sessionId: string, p: PlayerStateType, pc: PlayerCombat, def: WeaponDef, m: MeleeStats): void {
    if (pc.ready > 0 || pc.reloadLeft > 0 || pc.swing) return;
    pc.ready = m.cooldown;
    pc.shots++;
    p.shots = pc.shots & 255;
    this.stats.swings++;
    const view = this.viewOf(sessionId);
    pc.swing = { left: m.windup, weapon: def.id, m, yaw: pc.aimYaw, elev: pc.aimElev, lagMs: view ? this.lagOf(view) : 0, key: this.shotCounter++ >>> 0 };
    aimDirection(pc.aimYaw, pc.aimElev, aimDir);
    this.eye(p, this.pt);
    // (the swing's whoosh is heard as a shot event with the melee weapon's id; no ammunition is involved)
    this.host.emitShot({ id: sessionId, w: def.id, x: this.pt.x, y: this.pt.y - 0.35, z: this.pt.z, dx: aimDir.x, dy: aimDir.y, dz: aimDir.z, seed: pc.shots, spread: 0, m: true });
    this.host.noise?.(p.x, p.z, def.noise, sessionId);
  }

  private resolveSwing(sessionId: string, p: PlayerStateType, s: Swing): void {
    const m = s.m;
    const def = WEAPONS[s.weapon];
    const rw = this.host.rewind;
    const view = rw && this.lagCompensation && s.lagMs > 1 ? rw.at(rw.lastRecordedAt - s.lagMs) : undefined;
    const ox = p.x;
    const oz = p.z;
    const crouch = (p.flags & FLAG.CROUCHING) !== 0;
    const oy = p.y + (crouch ? 0.8 : 1.2);
    let struck = 0;
    const hits: { id: string; t: number; zone: number; x: number; y: number; z: number }[] = [];
    if (this.host.friendlyFire()) {
      this.host.players.forEach((t, id) => {
        if (id === sessionId || (t.flags & FLAG.DOWNED) !== 0 || !t.connected) return;
        const pose = this.poseOf(t, view);
        if (!meleeFan(pose, ox, oy, oz, s.yaw, s.elev, m.reach, m.arcHalf, 0.08, this.bodyHit)) return;
        // A wall between the blade and the man stops it.
        const h = this.bodyHit;
        const ex = h.x - ox;
        const ey = h.y - oy;
        const ez = h.z - oz;
        const l = Math.hypot(ex, ey, ez) || 1;
        if (rayWorld(this.host.world, ox, oy, oz, ex / l, ey / l, ez / l, Math.max(0, l - 0.1), this.worldHit)) return;
        hits.push({ id, t: h.t, zone: h.zone, x: h.x, y: h.y, z: h.z });
      });
    }
    hits.sort((a, b) => a.t - b.t);
    for (const h of hits) {
      if (struck >= m.cleave) break;
      struck++;
      const t = this.host.players.get(h.id)!;
      const dx = t.x - ox;
      const dz = t.z - oz;
      const l = Math.hypot(dx, dz) || 1;
      this.addHit(sessionId, h.id, def.id, meleeDamage(m, h.zone), h.zone, dx / l, dz / l, m.knock, m.stumble, h.x, h.y, h.z, s.key);
    }
    // Props in the arc are shoved (nearest one per ray of the fan's middle heights).
    if (struck < m.cleave) {
      for (const off of [-0.5, 0, 0.5]) {
        const y = s.yaw + off * m.arcHalf;
        const dx = -Math.sin(y);
        const dz = -Math.cos(y);
        if (this.host.physics.raycastProp(ox, oy - 0.3, oz, dx, 0, dz, m.reach, this.propHit)) {
          this.host.physics.shoveProp(this.propHit.id, dx, 0.25, dz, m.knock * 6, ox + dx * this.propHit.t, oy - 0.3, oz + dz * this.propHit.t, COMBAT.maxPropSpeed);
          break;
        }
      }
    }
  }

  // ---- explosions ------------------------------------------------------------------------------------------------------------------

  /**
   * A blast at (x,y,z): falloff damage and a shove for everyone standing (and the shooter), shoves for props, a cosmetic event.
   * `direct` is a victim that already took the projectile itself and is skipped. Cover matters: a wall between the blast and a person
   * takes most of the sting out.
   */
  explode(owner: string, weapon: WeaponId, b: BlastDef, x: number, y: number, z: number, direct: string): void {
    this.stats.blasts++;
    this.host.emitBoom({ x, y, z, radius: b.radius });
    this.host.noise?.(x, z, WEAPONS[weapon].noise, owner);
    const ff = this.host.friendlyFire();
    const centre = { x: 0, y: 0, z: 0 };
    const key = this.shotCounter++ >>> 0;
    this.host.players.forEach((t, id) => {
      if (id === direct || (t.flags & FLAG.DOWNED) !== 0 || !t.connected) return;
      const self = id === owner;
      if (!self && !ff) return;
      const pose = this.poseOf(t, undefined);
      const d = blastDistance(pose, x, y, z);
      let f = blastFalloff(d, b.radius);
      if (f <= 0) return;
      bodyCentre(pose, centre);
      const dx = centre.x - x;
      const dy = centre.y - y;
      const dz = centre.z - z;
      const l = Math.hypot(dx, dy, dz);
      if (l > 0.3 && rayWorld(this.host.world, x, y + 0.2, z, dx / l, dy / l, dz / l, l - 0.25, this.worldHit)) f *= 0.3; // behind cover
      const h = Math.hypot(dx, dz) || 1;
      const dirX = dx / h;
      const dirZ = dz / h;
      const zone = pickZone(this.host.rng);
      // (the blast is unaimed: the zone is a seeded roll, so a campaign seed reproduces its casualties)
      this.addHit(owner, id, weapon, b.damage * f, zone, dirX, dirZ, b.knock * f, Math.max(0.8, 1.2 * f), t.x, t.y + 1, t.z, key);
      // Lift: a blast throws people up as well as away.
      this.knock(t, 0, 0, 0, 0, b.knock * 0.55 * f);
    });
    // Props: everything within the radius is shoved away from the centre, lighter things faster.
    for (const [id, pb] of this.host.physics.props) {
      if (pb.holder !== "") continue;
      const tr = pb.body.translation();
      const dx = tr.x - x;
      const dy = tr.y - y;
      const dz = tr.z - z;
      const d = Math.hypot(dx, dy, dz);
      const f = blastFalloff(d, b.radius);
      if (f <= 0) continue;
      const l = d || 1;
      this.host.physics.shoveProp(id, dx / l, dy / l + 0.5, dz / l, b.propImpulse * f, tr.x, tr.y, tr.z, COMBAT.maxPropSpeed);
    }
  }

  // ---- the cannon -----------------------------------------------------------------------------------------------------------------

  private cannonNear(p: PlayerStateType): Cannon | undefined {
    for (const c of this.cannons) {
      if (Math.hypot(p.x - c.x, p.z - c.z) <= CANNON.crewRange && Math.abs(p.y - c.y) <= CREW_VERTICAL) return c;
    }
    return undefined;
  }

  private tickCannons(dt: number): void {
    const now = Date.now();
    for (const c of this.cannons) {
      // Who is working it: standing, in reach, holding INTERACT with fresh frames.
      const workers = this.workers;
      workers.length = 0;
      this.host.players.forEach((p, id) => {
        const pc = this.pcs.get(id);
        if (!pc || !p.connected) return;
        if ((p.flags & (FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.REVIVING | FLAG.DRAGGED)) !== 0) return;
        if (Math.hypot(p.x - c.x, p.z - c.z) > CANNON.crewRange + 0.3 || Math.abs(p.y - c.y) > CREW_VERTICAL) return;
        if ((pc.held & BUTTON.INTERACT) === 0 || now - pc.heldAt > HOLD_STALE_MS) return;
        if (c.st.phase === 3) return; // once the fuse is lit, everybody get clear
        workers.push(id);
      });
      // OPERATING flag: on for the crew, off for whoever stopped.
      for (const id of c.operating) {
        if (!workers.includes(id)) {
          const p = this.host.players.get(id);
          if (p) p.flags &= ~FLAG.OPERATING;
          c.operating.delete(id);
        }
      }
      for (const id of workers) {
        const p = this.host.players.get(id);
        if (p && (p.flags & FLAG.OPERATING) === 0) p.flags |= FLAG.OPERATING;
        c.operating.add(id);
      }
      const crew = workers.length;
      if (c.st.crew !== crew) c.st.crew = crew;
      const st = c.st;
      if (st.phase === 0 && crew > 0 && st.shells > 0) {
        st.phase = 1;
        c.load = 0;
      }
      if (st.phase === 1) {
        c.load = Math.min(1, c.load + cannonLoadRate(crew) * dt);
        const pct = Math.floor(c.load * 100);
        if (st.progress !== pct) st.progress = pct;
        if (c.load >= 1) {
          st.phase = 2;
          st.shells = Math.max(0, st.shells - 1);
          st.progress = 100;
        }
      } else if (st.phase === 2 && crew > 0) {
        // Laying: the barrel follows the first crew member's aim at a rate that depends on how many hands are on the trail.
        const lead = this.pcs.get(workers[0]!)!;
        const rate = (crew >= 2 ? CANNON.slewCrew : CANNON.slewSolo) * dt;
        const wantYaw = c.restYaw + clamp(angleDelta(c.restYaw, lead.aimYaw), -CANNON.traverse, CANNON.traverse);
        const nYaw = st.yaw + clamp(angleDelta(st.yaw, wantYaw), -rate, rate);
        const nElev = st.elev + clamp(clamp(lead.aimElev, CANNON.elevMin, CANNON.elevMax) - st.elev, -rate, rate);
        if (nYaw !== st.yaw) st.yaw = nYaw;
        if (nElev !== st.elev) st.elev = nElev;
      } else if (st.phase === 3) {
        c.fuse -= dt;
        st.progress = clamp(Math.round((1 - c.fuse / CANNON.fuseSeconds) * 100), 0, 100);
        if (c.fuse <= 0) this.discharge(c);
      }
    }
  }

  private discharge(c: Cannon): void {
    const st = c.st;
    const def = WEAPONS[WEAPON.CANNON];
    const r = def.ranged!;
    const seed = shotSeed(this.host.worldSeed, 100 + this.cannons.indexOf(c), c.shotNo++);
    aimDirection(st.yaw, st.elev, aimDir);
    shotDirection(st.yaw, st.elev, r.spread, seed, 0, shotDir);
    const ox = c.x + aimDir.x * CANNON.barrel;
    const oy = c.y + CANNON.trunnion + aimDir.y * CANNON.barrel;
    const oz = c.z + aimDir.z * CANNON.barrel;
    this.host.emitShot({ id: c.id, w: WEAPON.CANNON, x: ox, y: oy, z: oz, dx: shotDir.x, dy: shotDir.y, dz: shotDir.z, seed, spread: r.spread });
    this.host.noise?.(c.x, c.z, def.noise, c.lighter);
    this.launch(c.lighter, def, r, ox, oy, oz, shotDir.x, shotDir.y, shotDir.z, 0, this.shotCounter++ >>> 0);
    st.phase = 0;
    st.progress = 0;
    c.load = 0;
    st.fired = (st.fired + 1) & 255;
    this.stats.shots++;
    metrics.shotsFired++;
  }

  // ---- per tick -----------------------------------------------------------------------------------------------------------------

  tick(dt: number): void {
    this.host.players.forEach((p, id) => {
      const pc = this.pcs.get(id);
      if (!pc) return;
      if ((p.flags & FLAG.DOWNED) !== 0) this.cancelActions(pc);
      pc.ready = Math.max(0, pc.ready - dt);
      pc.switchLock = Math.max(0, pc.switchLock - dt);
      if (pc.reloadLeft > 0) {
        pc.reloadLeft -= dt;
        if (pc.reloadLeft <= 0 && pc.current >= 0) {
          const id2 = pc.current as WeaponId;
          const r = WEAPONS[id2].ranged!;
          const add = Math.min(r.magazine - pc.mags[id2]!, pc.reserve[id2]!);
          pc.mags[id2]! += add;
          pc.reserve[id2]! -= add;
          pc.reloadLeft = 0;
          pc.reloadTotal = 0;
        }
      }
      if (pc.swing) {
        pc.swing.left -= dt;
        if (pc.swing.left <= 0) {
          const s = pc.swing;
          pc.swing = undefined;
          if ((p.flags & BUSY) === 0) this.resolveSwing(id, p, s);
        }
      }
      this.sync(p, pc);
    });
    this.tickCannons(dt);
    this.stepProjectiles(dt);
    this.flush();
  }

  /** Copies what clients may see into replicated state, touching a field only when it changed (schema writes cost bandwidth). */
  private sync(p: PlayerStateType, pc: PlayerCombat): void {
    const w = pc.current < 0 ? 0 : pc.current + 1;
    if (p.weapon !== w) p.weapon = w;
    if (p.weapons !== pc.owned) p.weapons = pc.owned;
    const cur = pc.current;
    const ammo = cur >= 0 ? pc.mags[cur]! : 0;
    const reserve = cur >= 0 ? pc.reserve[cur]! : 0;
    if (p.ammo !== ammo) p.ammo = ammo;
    if (p.reserve !== reserve) p.reserve = reserve;
    const rel = pc.reloadLeft > 0 && pc.reloadTotal > 0 ? Math.min(99, Math.max(1, Math.round((1 - pc.reloadLeft / pc.reloadTotal) * 100))) : 0;
    if (p.reload !== rel) p.reload = rel;
  }
}

const WEAPON_LIST: readonly WeaponId[] = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA, WEAPON.CANNON, WEAPON.FISTS];
