import {
  BUTTON,
  CHARACTER,
  FLAG,
  LIMB,
  STEP_DT,
  hash3,
  wrapAngle,
  yawToWire,
  type CharState,
  type CollisionWorld,
  type MoveCommand,
  type PlayerStateType,
} from "@cb/shared";
import {
  BOLT_SECONDS,
  CARGO_POUNDS,
  MOUNT,
  MOUNT_CAP,
  MOUNT_FLAG,
  MOUNT_KIND,
  MOUNT_PHASE,
  WAGON,
  hitchPoint,
  mountReach,
  stepMounted,
  throwDamage,
  throwRisk,
  throwRoll,
  trailStep,
  wagonToWorld,
  type Trailer,
} from "@cb/shared";
import type { HitInfo } from "./Casualties.ts";

/**
 * Mounts: horses and wagons (D-034). The server owns every row of `WorldState.mounts`; clients draw them. Design (docs/_notes/expedition.md section 3):
 *  - a ridden horse is a picture of its RIDER'S predicted state (the rider's `MOUNTED` flag makes the shared movement step hand over to `stepMounted`), so there is no second
 *    predicted entity and nothing for a reconciler to fight: mounting and dismounting are flag flips the server makes, like CARRYING;
 *  - an unridden horse that is led or on a route is stepped HERE by the same `stepMounted` with a synthetic command (it collides, slopes and slows like any horse);
 *  - a wagon is a rigid trailer (`trailStep`) with four crate bays and two body bays; cargo moves with it (props through `physics.hold`, bodies through the drag's own velocity
 *    steering);
 *  - riders are THROWN by walls, blasts, blows and being downed (`throwRisk`, deterministic): MOUNTED|HITCHED clear, 0.6x velocity, a hop, a stumble, bounded damage;
 *  - everything a client can ask for arrives as INTERACT on a rising edge; every precondition is re-checked here and a refusal changes nothing.
 *
 * INTEGRATION (steps 0 and 3 of the expedition notes). Phase 0: `FLAG.MOUNTED/HITCHED/GALLOPING` = `MOUNT_FLAG`, `export * from "./mount.ts"` in shared/index.ts (then delete
 * `mountShared.ts` and the client's `render/mounts/shared.ts` and import from "@cb/shared"), `movement.ts` first line `if ((s.flags & FLAG.MOUNTED) !== 0 && !downed && !dragged)
 * { stepMounted(s, cmd, dt, world); return; }`, schema `MountState` + `WorldState.mounts`. Room: `new Mounts(host)` after Combat with the host fields below (`newRow` = `new
 * MountState()` with every numeric assigned; `takeHeld` = the existing dropHeld at zero speed; `releaseDrag` = make Casualties.releaseDrag public; `routePoints` = the cast's
 * routes); `handleInteraction` order casualties, combat, `mounts.onInteract`, stations, props; `mounts.tick(dt)` after the player loop and before `physics.step`;
 * `damagePlayer` -> `mounts.onHurt`; explosions -> `mounts.onBlast(sid, shoveSpeed)`; `Casualties.down` -> `mounts.onDown`; a leaving client -> `mounts.onLeave`;
 * `enterRegion` -> `mounts.dispose()` then `spawnHorse`/`spawnWagon` at `regionMountSpots(region)`. Combat lifts a mounted rider's hit zones by `riderBodyLift(hipHeight)`.
 */

/** A row of `WorldState.mounts` (the schema's `MountState`, structurally; plain objects in tests). */
export interface MountRow {
  kind: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  speed: number;
  rider: string;
  hitch: string;
  coat: number;
  phase: number;
  hp: number;
  cargo: number;
}

export interface MountRowMap {
  get(id: string): MountRow | undefined;
  set(id: string, row: MountRow): unknown;
  delete(id: string): unknown;
  forEach(cb: (row: MountRow, id: string) => void): void;
  readonly size: number;
}

/** What the mount system needs of the physics world: the held-prop calls (physics.ts). */
export interface MountPhysics {
  hold(id: string, holder: string): boolean;
  moveHeld(id: string, x: number, y: number, z: number, yaw: number): void;
  release(id: string, vx: number, vy: number, vz: number): void;
}

export interface MountsHost {
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void; get(id: string): PlayerStateType | undefined };
  rows: MountRowMap;
  /** A fresh row with every numeric assigned (a schema `MountState` in the room). */
  newRow(): MountRow;
  world(): CollisionWorld;
  physics: MountPhysics;
  damage(sid: string, amount: number, hit?: HitInfo): void;
  /** A refusal or an event line for one player (the room's `notice` message). */
  notice(sid: string, text: string): void;
  seed: number;
  /** Any person's row by key: a session id, or `npc:<id>` for a scripted leader or driver. */
  rowOf(key: string): PlayerStateType | undefined;
  /** The prop `sid` is carrying, released from their hands (CARRYING cleared, carrying map and the schema holder emptied, the body left free): the room's drop path at zero speed. */
  takeHeld(sid: string): string | undefined;
  /** Writes `PropState.holder` (so clients draw the crate where it is held). */
  setPropHolder(propId: string, holder: string): void;
  /** Whether a prop still exists (a scenario may consume a crate that is loaded). */
  propExists(propId: string): boolean;
  /** Casualties' `releaseDrag`: stop `draggerSid` dragging (clears DRAGGING and the body's DRAGGED), so the body can be loaded. */
  releaseDrag(draggerSid: string): void;
  /** A named route (the cast's `defineRoute`). */
  routePoints(name: string): readonly { x: number; z: number }[] | undefined;
}

/** Authored one-liners (pending developer review: AI_CONTENT_REGISTER). */
export const MOUNT_LINES = {
  throwWall: ["The horse expressed a view about the wall. You were not consulted.", "The wall won. The horse is, on the whole, relieved.", "Dismounted by masonry."],
  throwBlast: ["The horse took the blast personally, and then you off.", "The horse left the explosion; you followed, briefly, through the air."],
  throwBlow: ["The horse was struck, and strongly disagreed with your plan to stay on.", "Thrown. The Society's riding manual calls this 'an informal dismount'."],
  throwDown: ["You slide from the saddle, as the wounded do."],
  full: "The wagon is full. The Society's cargo regulations do not provide for optimism.",
  nothing: "There is nothing here to load.",
  taken: "That horse is spoken for.",
  hands: "You have no arms to hold the reins with.",
  busy: "Your hands are full of other business.",
  far: "Too far away to be useful.",
} as const;

interface Entity {
  id: string;
  kind: number;
  /** Horse: its own step state while nobody rides it (the rider's state is the horse's while ridden). Wagon: x/z = the axle. */
  state: CharState;
  trailer: Trailer;
  leader: string;
  route: string;
  routeIdx: number;
  routeDone: boolean;
  boltT: number;
  /** Wagon: the prop held at each crate bay, and the body (a session or `npc:` key) on each rack bay. */
  props: (string | undefined)[];
  bodies: (string | undefined)[];
  travelled: number;
}

const BAY_COUNT = WAGON.bays.length;
const BODY_BAYS = WAGON.bodyBays.length;
const tmp = { x: 0, z: 0 };
const hp = { x: 0, z: 0 };
const bayAt = { x: 0, z: 0 };

const cmd: MoveCommand = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };

const pick = <T>(list: readonly T[], seed: number, a: number, b: number): T => list[hash3(seed, a, b, 0x6c1e) % list.length]!;

export class Mounts {
  private readonly ents = new Map<string, Entity>();
  private nextId = 1;
  private tickNo = 0;
  /** Each rider's speed last tick: a wall shows up as speed shed in one tick. */
  private readonly lastSpeed = new Map<string, number>();
  /** After an unhitch the same press cannot hitch again for a moment (so INTERACT beside the tongue can unhitch, then dismount). */
  private readonly noHitchUntil = new Map<string, number>();

  constructor(private readonly host: MountsHost) {}

  // ---- the contract's API (MountApi) ------------------------------------------------------------------------------------------------------------------------------

  /** A horse standing at `at` (the loadout's horses at landfall). Returns its id, or "" when the room is at its cap. */
  spawnHorse(at: { x: number; z: number; yaw: number }, o: { coat: number; harness?: boolean }): string {
    if (this.host.rows.size >= MOUNT_CAP) return "";
    const id = `h${this.nextId++}`;
    const row = this.host.newRow();
    this.fill(row, MOUNT_KIND.horse, at.x, at.z, at.yaw, o.coat);
    this.host.rows.set(id, row);
    this.ents.set(id, this.entity(id, MOUNT_KIND.horse, row));
    return id;
  }

  /** A wagon at `at` carrying `crates` abstract cargo crates (0..4), with a harnessed horse in front of it when `horse`. Returns the wagon's id (or "" at the cap). */
  spawnWagon(at: { x: number; z: number; yaw: number }, o: { coat: number; crates: number; horse?: boolean }): string {
    if (this.host.rows.size + (o.horse ? 2 : 1) > MOUNT_CAP) return "";
    const id = `w${this.nextId++}`;
    const row = this.host.newRow();
    this.fill(row, MOUNT_KIND.wagon, at.x, at.z, at.yaw, o.coat);
    row.cargo = Math.max(0, Math.min(BAY_COUNT, Math.floor(Number.isFinite(o.crates) ? o.crates : 0)));
    row.hp = 100;
    this.host.rows.set(id, row);
    this.ents.set(id, this.entity(id, MOUNT_KIND.wagon, row));
    if (o.horse) {
      const f = at.yaw;
      const ahead = WAGON.len + WAGON.hitchBack;
      const hid = this.spawnHorse({ x: at.x - Math.sin(f) * ahead, z: at.z - Math.cos(f) * ahead, yaw: f }, { coat: o.coat * 7 + 3, harness: true });
      if (hid) this.hitch(hid, id);
    }
    return id;
  }

  /** The horse of `wagonId` follows `leaderKey` (a session id or `npc:<id>`) at ~1.8 m, the wagon behind it. */
  lead(wagonId: string, leaderKey: string): void {
    const horse = this.horseOf(wagonId);
    if (!horse) return;
    horse.leader = leaderKey;
    horse.route = "";
    this.setPhase(horse, MOUNT_PHASE.led);
  }

  /** The horse of `wagonId` walks the named route (the cast's `defineRoute`), then stands. */
  route(wagonId: string, name: string): void {
    const horse = this.horseOf(wagonId);
    if (!horse) return;
    horse.route = name;
    horse.routeIdx = 0;
    horse.routeDone = false;
    horse.leader = "";
    this.setPhase(horse, MOUNT_PHASE.led);
  }

  /** Whether the route of `wagonId` has been walked to its end. */
  routeDone(wagonId: string): boolean {
    const horse = this.horseOf(wagonId);
    return horse ? horse.routeDone : false;
  }

  pos(id: string): { x: number; z: number } | undefined {
    const e = this.ents.get(id);
    if (!e) return undefined;
    const r = this.host.rows.get(id);
    return r ? { x: r.x, z: r.z } : undefined;
  }

  /** Smashes (or burns out, `burn`) a wagon: its cargo is gone, its horse bolts. Wrecks are `phase` 4 with `hp` 0 (smashed) or 1 (burned out). */
  wreck(id: string, burn: boolean): void {
    const e = this.ents.get(id);
    const row = this.host.rows.get(id);
    if (!e || !row || e.kind !== MOUNT_KIND.wagon || row.phase === MOUNT_PHASE.wrecked) return;
    const horse = row.hitch ? this.ents.get(row.hitch) : undefined;
    if (horse) this.unhitch(horse.id);
    this.emptyWagon(e);
    row.cargo = 0;
    row.phase = MOUNT_PHASE.wrecked;
    row.hp = burn ? 1 : 0;
    row.speed = 0;
    if (horse) this.bolt(horse);
  }

  /** The convoy is taken: the abstract cargo is emptied and its value returned (`CARGO_POUNDS` a crate) to pay into the purse. Props already loaded stay on it. */
  seize(id: string, by: string): number {
    const e = this.ents.get(id);
    const row = this.host.rows.get(id);
    if (!e || !row || e.kind !== MOUNT_KIND.wagon || row.phase === MOUNT_PHASE.wrecked || row.cargo <= 0) return 0;
    const pounds = row.cargo * CARGO_POUNDS;
    row.cargo = 0;
    void by;
    return pounds;
  }

  remove(id: string): void {
    const e = this.ents.get(id);
    if (!e) return;
    const row = this.host.rows.get(id);
    if (row?.rider) this.dismountFlags(this.host.players.get(row.rider));
    if (e.kind === MOUNT_KIND.wagon) {
      const horse = row?.hitch ? this.ents.get(row.hitch) : undefined;
      if (horse) this.unhitch(horse.id);
      this.emptyWagon(e);
    } else if (row?.hitch) this.unhitch(id);
    this.ents.delete(id);
    this.host.rows.delete(id);
  }

  // ---- the room's hooks -------------------------------------------------------------------------------------------------------------------------------------------

  /**
   * INTERACT (rising edge) from `sid`. Returns true when the press was taken. Order: mounted riders hitch, unhitch or dismount; people holding a prop load it into a wagon;
   * people dragging a body load it; otherwise unload at a bay, or mount the nearest free horse. Anything that does not apply returns false so the room goes on to stations and props.
   */
  onInteract(sid: string, p: PlayerStateType, held: string | undefined): boolean {
    if (this.ents.size === 0) return false;
    if ((p.flags & MOUNT_FLAG.MOUNTED) !== 0) return this.onMountedInteract(sid, p);
    if ((p.flags & (FLAG.DOWNED | FLAG.DRAGGED)) !== 0) return false;
    if (held) return this.loadProp(sid, p, held);
    if ((p.flags & FLAG.DRAGGING) !== 0) return this.loadDragged(sid, p);
    if (this.unload(sid, p)) return true;
    return this.mount(sid, p);
  }

  /** A hit landed on a rider (`dmg` points). A hard enough blow unseats them (the roll is deterministic: seed, tick, slot). */
  onHurt(sid: string, dmg: number, hit?: HitInfo): void {
    void hit;
    const p = this.host.players.get(sid);
    if (!p || (p.flags & MOUNT_FLAG.MOUNTED) === 0 || !(dmg > 0)) return;
    const speed = Math.hypot(p.vx, p.vz);
    if (throwRisk(speed, speed, dmg / 8, p.wounds, throwRoll(this.host.seed, this.tickNo, p.slot), p.missing)) this.throwRider(sid, p, "blow");
  }

  /** A blast pushed a rider (`power` in m/s of shove, the same scale as a wall's shed speed). */
  onBlast(sid: string, power: number): void {
    const p = this.host.players.get(sid);
    if (!p || (p.flags & MOUNT_FLAG.MOUNTED) === 0 || !(power > 0)) return;
    const speed = Math.hypot(p.vx, p.vz);
    if (throwRisk(speed, speed, power, p.wounds, throwRoll(this.host.seed, this.tickNo, p.slot), p.missing)) this.throwRider(sid, p, "blast");
  }

  /** The rider was put down: they slide off (a throw with no extra damage). Call from Casualties' down path. */
  onDown(sid: string): void {
    const p = this.host.players.get(sid);
    if (p && (p.flags & MOUNT_FLAG.MOUNTED) !== 0) this.throwRider(sid, p, "down");
  }

  /** A person left the room (disconnect): they dismount where they are, and a body they were carried as is set down. */
  onLeave(sid: string): void {
    const p = this.host.players.get(sid);
    if (p && (p.flags & MOUNT_FLAG.MOUNTED) !== 0) this.dismount(sid, p, false);
    this.lastSpeed.delete(sid);
    this.noHitchUntil.delete(sid);
    for (const e of this.ents.values()) {
      if (e.kind !== MOUNT_KIND.wagon) continue;
      for (let i = 0; i < BODY_BAYS; i++) if (e.bodies[i] === sid) this.freeBody(e, i);
    }
  }

  /** Region change or room close: everything goes, riders come down, loaded bodies are set down. */
  dispose(): void {
    for (const id of [...this.ents.keys()]) this.remove(id);
    this.host.players.forEach((p) => (p.flags &= ~(MOUNT_FLAG.MOUNTED | MOUNT_FLAG.HITCHED | MOUNT_FLAG.GALLOPING)));
    this.lastSpeed.clear();
    this.noHitchUntil.clear();
  }

  /** Once per room tick, after the players have stepped and before the physics step. */
  tick(dt: number): void {
    this.tickNo++;
    const world = this.host.world();
    // riders: the horse copies the rider; a wall at speed unseats them
    for (const e of this.ents.values()) {
      if (e.kind !== MOUNT_KIND.horse) continue;
      const row = this.host.rows.get(e.id);
      if (!row) continue;
      if (row.rider) this.tickRidden(e, row, dt);
      else if (row.phase === MOUNT_PHASE.led) this.tickLed(e, row, dt, world);
      else if (row.phase === MOUNT_PHASE.bolting) this.tickBolting(e, row, dt, world);
      else {
        row.speed = 0;
        e.state.vx = e.state.vz = 0;
        e.state.y = world.groundHeight(e.state.x, e.state.z, e.state.y + CHARACTER.snapDistance);
        row.y = e.state.y;
      }
    }
    // wagons: follow their horse, carry their cargo
    for (const e of this.ents.values()) if (e.kind === MOUNT_KIND.wagon) this.tickWagon(e, dt, world);
  }

  // ---- ridden horses ---------------------------------------------------------------------------------------------------------------------------------------------

  private tickRidden(e: Entity, row: MountRow, dt: number): void {
    const p = this.host.players.get(row.rider);
    if (!p || (p.flags & MOUNT_FLAG.MOUNTED) === 0) {
      // the rider is gone (left, was teleported, lost the flag): the horse stands where it is
      if (p) this.dismountFlags(p);
      this.release(e, row);
      return;
    }
    const speedNow = Math.hypot(p.vx, p.vz);
    const prev = this.lastSpeed.get(row.rider) ?? speedNow;
    this.lastSpeed.set(row.rider, speedNow);
    // keep HITCHED honest: the flag exists only while this horse has a wagon behind it
    if (row.hitch) p.flags |= MOUNT_FLAG.HITCHED;
    else p.flags &= ~MOUNT_FLAG.HITCHED;
    // a wall: the speed shed in one tick
    if (prev - speedNow >= MOUNT.throwFrom + 1.5 && throwRisk(prev, speedNow, 0, p.wounds, throwRoll(this.host.seed, this.tickNo, p.slot), p.missing)) {
      this.throwRider(row.rider, p, "wall", prev);
      return;
    }
    this.copyFromRider(e, row, p);
    void dt;
  }

  private copyFromRider(e: Entity, row: MountRow, p: PlayerStateType): void {
    row.x = p.x;
    row.y = p.y;
    row.z = p.z;
    row.facing = p.facing;
    row.speed = Math.hypot(p.vx, p.vz);
    e.state.x = p.x;
    e.state.y = p.y;
    e.state.z = p.z;
    e.state.facing = p.facing;
    e.state.vx = p.vx;
    e.state.vz = p.vz;
  }

  // ---- led, routed and bolting horses ----------------------------------------------------------------------------------------------------------------------------

  private tickLed(e: Entity, row: MountRow, dt: number, world: CollisionWorld): void {
    let tx = e.state.x;
    let tz = e.state.z;
    let want = 0; // 0 stand, 1 walk, 2 trot, 3 gallop
    if (e.leader) {
      const lead = this.host.rowOf(e.leader);
      if (!lead || (lead.flags & FLAG.DOWNED) !== 0) want = 0;
      else {
        // follows its leader at 1.8 m: stops there, walks up close, trots past 4 m, gallops past 14 m
        const dx = lead.x - e.state.x;
        const dz = lead.z - e.state.z;
        const d = Math.hypot(dx, dz);
        tx = lead.x;
        tz = lead.z;
        want = d < 1.8 ? 0 : d < 4 ? 1 : d < 14 ? 2 : 3;
      }
    } else if (e.route) {
      const pts = this.host.routePoints(e.route);
      if (pts && pts.length > 0 && !e.routeDone) {
        let i = Math.min(e.routeIdx, pts.length - 1);
        while (i < pts.length - 1 && Math.hypot(pts[i]!.x - e.state.x, pts[i]!.z - e.state.z) < 2.5) i++;
        e.routeIdx = i;
        const last = i === pts.length - 1;
        const dx = pts[i]!.x - e.state.x;
        const dz = pts[i]!.z - e.state.z;
        if (last && Math.hypot(dx, dz) < 2.5) e.routeDone = true;
        else {
          tx = pts[i]!.x;
          tz = pts[i]!.z;
          want = 1; // a convoy walks
        }
      }
    }
    this.driveHorse(e, row, dt, world, tx, tz, want);
  }

  private tickBolting(e: Entity, row: MountRow, dt: number, world: CollisionWorld): void {
    e.boltT -= dt;
    if (e.boltT <= 0) {
      this.setPhase(e, MOUNT_PHASE.loose);
      row.speed = 0;
      return;
    }
    // it runs the way it faces
    const f = e.state.facing;
    this.driveHorse(e, row, dt, world, e.state.x - Math.sin(f) * 20, e.state.z - Math.cos(f) * 20, 3);
  }

  /** Steps an unridden horse toward (tx, tz) with a synthetic stick (`want`: 0 stand, 1 walk, 2 trot, 3 gallop) through the shared mounted step. */
  private driveHorse(e: Entity, row: MountRow, dt: number, world: CollisionWorld, tx: number, tz: number, want: number): void {
    const s = e.state;
    s.flags |= MOUNT_FLAG.MOUNTED;
    if (row.hitch) s.flags |= MOUNT_FLAG.HITCHED;
    else s.flags &= ~MOUNT_FLAG.HITCHED;
    const heading = Math.atan2(-(tx - s.x), -(tz - s.z));
    cmd.yaw = yawToWire(heading);
    cmd.moveR = 0;
    cmd.moveF = want === 0 ? 0 : want === 1 ? 50 : 127;
    cmd.buttons = want === 3 ? BUTTON.SPRINT : 0;
    // (the shared step runs at the fixed rate; a longer room tick is stepped in whole sub-steps so a gait never depends on frame time)
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, STEP_DT);
      stepMounted(s, cmd, h, world);
      left -= h;
    }
    row.x = s.x;
    row.y = s.y;
    row.z = s.z;
    row.facing = s.facing;
    row.speed = Math.hypot(s.vx, s.vz);
  }

  // ---- wagons ------------------------------------------------------------------------------------------------------------------------------------------------------

  private tickWagon(e: Entity, dt: number, world: CollisionWorld): void {
    const row = this.host.rows.get(e.id);
    if (!row) return;
    const t = e.trailer;
    const horse = row.hitch ? this.host.rows.get(row.hitch) : undefined;
    const px = t.x;
    const pz = t.z;
    if (horse && row.phase !== MOUNT_PHASE.wrecked) {
      hitchPoint(horse.x, horse.z, horse.facing, hp);
      const ok = trailStep(t, hp.x, hp.z, dt, world);
      // the trace snaps if the wagon is wedged and the horse has gone on: it is let go rather than dragged through a wall
      if (!ok && Math.hypot(t.x - hp.x, t.z - hp.z) > WAGON.len + 2.5) this.unhitch(row.hitch);
    }
    const moved = Math.hypot(t.x - px, t.z - pz);
    e.travelled += moved;
    row.x = t.x;
    row.z = t.z;
    row.y = t.y ?? world.groundHeight(t.x, t.z, world.terrainHeight(t.x, t.z) + 0.3);
    t.y = row.y;
    row.facing = t.facing;
    row.speed = dt > 0 ? moved / dt : 0;
    // cargo: props at their bays, bodies steered to theirs
    for (let i = 0; i < BAY_COUNT; i++) {
      const id = e.props[i];
      if (!id) continue;
      if (!this.host.propExists(id)) {
        e.props[i] = undefined;
        continue;
      }
      const b = WAGON.bays[i]!;
      wagonToWorld(t, b.x, b.z, bayAt);
      this.host.physics.moveHeld(id, bayAt.x, row.y + b.y, bayAt.z, t.facing);
    }
    for (let i = 0; i < BODY_BAYS; i++) {
      const key = e.bodies[i];
      if (!key) continue;
      const body = this.host.rowOf(key);
      if (!body || (body.flags & FLAG.DOWNED) === 0 || (body.flags & FLAG.DRAGGED) === 0 || body.dragger !== `wagon:${e.id}`) {
        if (body && body.dragger === `wagon:${e.id}`) this.clearLoaded(body);
        e.bodies[i] = undefined;
        continue;
      }
      const b = WAGON.bodyBays[i]!;
      wagonToWorld(t, b.x, b.z, bayAt);
      // the same velocity steering a drag uses: a spring toward the spot, capped
      let vx = row.speed > 0 ? (t.x - px) / Math.max(dt, 1e-6) : 0;
      let vz = row.speed > 0 ? (t.z - pz) / Math.max(dt, 1e-6) : 0;
      vx += (bayAt.x - body.x) * 8;
      vz += (bayAt.z - body.z) * 8;
      const m = Math.hypot(vx, vz);
      if (m > 14) {
        vx = (vx / m) * 14;
        vz = (vz / m) * 14;
      }
      body.vx = vx;
      body.vz = vz;
      body.facing = wrapAngle(t.facing);
    }
  }

  // ---- interaction: mounted ----------------------------------------------------------------------------------------------------------------------------------------

  private onMountedInteract(sid: string, p: PlayerStateType): boolean {
    const horse = this.horseOfRider(sid);
    if (!horse) {
      // flagged as mounted with no horse (a stale flag): clear it rather than trap them
      this.dismountFlags(p);
      return true;
    }
    const row = this.host.rows.get(horse.id)!;
    // hitch / unhitch beside the tongue: a free wagon whose tongue end is within reach of the horse's collar, or the one already behind it
    if (row.hitch) {
      this.unhitch(horse.id);
      p.flags &= ~MOUNT_FLAG.HITCHED;
      this.noHitchUntil.set(sid, this.tickNo + 45);
      return true;
    }
    hitchPoint(p.x, p.z, p.facing, hp);
    const canHitch = this.tickNo >= (this.noHitchUntil.get(sid) ?? 0);
    for (const w of canHitch ? this.ents.values() : []) {
      if (w.kind !== MOUNT_KIND.wagon) continue;
      const wr = this.host.rows.get(w.id);
      if (!wr || wr.hitch || wr.phase === MOUNT_PHASE.wrecked) continue;
      // the tongue's end: `len` ahead of the axle, along the wagon's facing
      const tx = w.trailer.x - Math.sin(w.trailer.facing) * WAGON.len;
      const tz = w.trailer.z - Math.cos(w.trailer.facing) * WAGON.len;
      if (mountReach(hp.x, hp.z, tx, tz, MOUNT.reach)) {
        this.hitch(horse.id, w.id);
        p.flags |= MOUNT_FLAG.HITCHED;
        return true;
      }
    }
    this.dismount(sid, p, true);
    return true;
  }

  private dismount(sid: string, p: PlayerStateType, keepVelocity: boolean): void {
    const horse = this.horseOfRider(sid);
    const world = this.host.world();
    // placed 1 m to the left of the horse, resolved against the world; 40% of the speed is kept
    const lx = -Math.cos(p.facing);
    const lz = Math.sin(p.facing);
    tmp.x = p.x + lx * 1.0;
    tmp.z = p.z + lz * 1.0;
    world.resolveXZ(tmp, p.y, CHARACTER.radius, CHARACTER.height);
    p.x = tmp.x;
    p.z = tmp.z;
    p.y = world.groundHeight(p.x, p.z, p.y + CHARACTER.stepHeight);
    const k = keepVelocity ? 0.4 : 0;
    p.vx *= k;
    p.vz *= k;
    this.dismountFlags(p);
    this.lastSpeed.delete(sid);
    if (horse) {
      const row = this.host.rows.get(horse.id);
      if (row) this.release(horse, row);
    }
  }

  private dismountFlags(p: PlayerStateType | undefined): void {
    if (p) p.flags &= ~(MOUNT_FLAG.MOUNTED | MOUNT_FLAG.HITCHED | MOUNT_FLAG.GALLOPING);
  }

  /** The horse stands where its rider left it. */
  private release(e: Entity, row: MountRow): void {
    row.rider = "";
    row.phase = MOUNT_PHASE.loose;
    row.speed = 0;
    e.state.vx = e.state.vz = 0;
    e.leader = "";
    e.route = "";
  }

  private throwRider(sid: string, p: PlayerStateType, why: "wall" | "blast" | "blow" | "down", speedBefore?: number): void {
    const horse = this.horseOfRider(sid);
    const speed = speedBefore ?? Math.hypot(p.vx, p.vz);
    this.dismountFlags(p);
    this.lastSpeed.delete(sid);
    const k = MOUNT.thrown.velScale;
    p.vx *= k;
    p.vz *= k;
    p.vy = MOUNT.thrown.vy;
    p.stumble = MOUNT.thrown.stumble;
    p.flags &= ~(FLAG.GROUNDED | FLAG.JUMP_LATCH);
    if (horse) {
      const row = this.host.rows.get(horse.id);
      if (row) {
        row.rider = "";
        this.bolt(horse);
      }
    }
    const lines = why === "wall" ? MOUNT_LINES.throwWall : why === "blast" ? MOUNT_LINES.throwBlast : why === "blow" ? MOUNT_LINES.throwBlow : MOUNT_LINES.throwDown;
    if (why !== "down") {
      this.host.notice(sid, pick(lines, this.host.seed, this.tickNo, p.slot));
      const dmg = throwDamage(speed);
      if (dmg > 0) this.host.damage(sid, dmg, { by: "mount" });
    }
  }

  private bolt(horse: Entity): void {
    // spooked: it bolts away from where it was going (more or less: the heading is turned round by a deterministic wobble)
    horse.state.facing = wrapAngle(horse.state.facing + Math.PI + ((hash3(this.host.seed, this.tickNo, horse.id.length, 0xb017) % 1000) / 1000 - 0.5) * 1.2);
    horse.boltT = BOLT_SECONDS;
    horse.leader = "";
    horse.route = "";
    this.setPhase(horse, MOUNT_PHASE.bolting);
  }

  // ---- interaction: mounting ----------------------------------------------------------------------------------------------------------------------------------------

  private mount(sid: string, p: PlayerStateType): boolean {
    // the nearest free horse in reach
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== MOUNT_KIND.horse) continue;
      const row = this.host.rows.get(e.id);
      if (!row || row.rider || row.phase === MOUNT_PHASE.wrecked) continue;
      const d = Math.hypot(row.x - p.x, row.z - p.z);
      if (mountReach(p.x, p.z, row.x, row.z) && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    if (!best) {
      // a horse that is ridden, or out of reach, is simply not there for you: no notice for the far, a plain one for the taken
      for (const e of this.ents.values()) {
        const row = this.host.rows.get(e.id);
        if (e.kind === MOUNT_KIND.horse && row?.rider && mountReach(p.x, p.z, row.x, row.z)) {
          this.host.notice(sid, MOUNT_LINES.taken);
          return true;
        }
      }
      return false;
    }
    if ((p.flags & (FLAG.CARRYING | FLAG.REVIVING | FLAG.OPERATING | FLAG.DRAGGING | FLAG.DOWNED | FLAG.DRAGGED)) !== 0) {
      this.host.notice(sid, MOUNT_LINES.busy);
      return true;
    }
    if (p.missing !== undefined && (p.missing & (LIMB.ARM_L | LIMB.ARM_R)) === (LIMB.ARM_L | LIMB.ARM_R)) {
      this.host.notice(sid, MOUNT_LINES.hands);
      return true;
    }
    const row = this.host.rows.get(best.id)!;
    // the HORSE is placed at the rider and takes the rider's facing: no predicted rider field moves except `flags`
    row.x = p.x;
    row.y = p.y;
    row.z = p.z;
    row.facing = p.facing;
    row.rider = sid;
    row.phase = MOUNT_PHASE.ridden;
    best.leader = "";
    best.route = "";
    p.flags |= MOUNT_FLAG.MOUNTED;
    if (row.hitch) p.flags |= MOUNT_FLAG.HITCHED;
    p.flags &= ~(FLAG.CROUCHING | FLAG.SPRINTING);
    this.lastSpeed.set(sid, Math.hypot(p.vx, p.vz));
    this.copyFromRider(best, row, p);
    return true;
  }

  // ---- interaction: cargo --------------------------------------------------------------------------------------------------------------------------------------------

  private nearestWagon(p: { x: number; z: number }, reach: number): Entity | undefined {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== MOUNT_KIND.wagon) continue;
      const row = this.host.rows.get(e.id);
      if (!row || row.phase === MOUNT_PHASE.wrecked) continue;
      const d = Math.hypot(row.x - p.x, row.z - p.z);
      if (d <= reach && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private loadProp(sid: string, p: PlayerStateType, held: string): boolean {
    const w = this.nearestWagon(p, WAGON.loadReach);
    if (!w) return false; // not at a wagon: the room drops or throws it as usual
    const row = this.host.rows.get(w.id)!;
    // nearest FREE bay: the first `cargo` bays are taken by the abstract cargo
    let bay = -1;
    let bayD = Infinity;
    for (let i = row.cargo; i < BAY_COUNT; i++) {
      if (w.props[i]) continue;
      const b = WAGON.bays[i]!;
      wagonToWorld(w.trailer, b.x, b.z, bayAt);
      const d = Math.hypot(bayAt.x - p.x, bayAt.z - p.z);
      if (d < bayD) {
        bay = i;
        bayD = d;
      }
    }
    if (bay < 0) {
      this.host.notice(sid, MOUNT_LINES.full);
      return true;
    }
    const id = this.host.takeHeld(sid);
    if (!id || id !== held) {
      // (the room's hold state disagreed with ours: nothing was loaded)
      if (id) this.host.setPropHolder(id, "");
      return true;
    }
    if (!this.host.physics.hold(id, `wagon:${w.id}`)) return true;
    this.host.setPropHolder(id, `wagon:${w.id}`);
    w.props[bay] = id;
    return true;
  }

  private loadDragged(sid: string, p: PlayerStateType): boolean {
    const w = this.nearestWagon(p, WAGON.loadReach);
    if (!w) return false;
    let free = -1;
    for (let i = 0; i < BODY_BAYS; i++) if (!w.bodies[i]) free = i;
    // the body being dragged (the dragger is named on the body's row)
    let key: string | undefined;
    let body: PlayerStateType | undefined;
    this.host.players.forEach((o, id) => {
      if (!key && o.dragger === sid && (o.flags & FLAG.DRAGGED) !== 0 && (o.flags & FLAG.DOWNED) !== 0) {
        key = id;
        body = o;
      }
    });
    if (!key || !body) return false;
    if (free < 0) {
      this.host.notice(sid, MOUNT_LINES.full);
      return true;
    }
    this.host.releaseDrag(sid);
    body.flags |= FLAG.DRAGGED;
    body.dragger = `wagon:${w.id}`;
    w.bodies[free] = key;
    return true;
  }

  private unload(sid: string, p: PlayerStateType): boolean {
    for (const w of this.ents.values()) {
      if (w.kind !== MOUNT_KIND.wagon) continue;
      const row = this.host.rows.get(w.id);
      if (!row) continue;
      // crates first (the nearest bay within reach of the unloader), then bodies
      let bestI = -1;
      let bestD: number = WAGON.bayReach;
      for (let i = 0; i < BAY_COUNT; i++) {
        if (!w.props[i]) continue;
        const b = WAGON.bays[i]!;
        wagonToWorld(w.trailer, b.x, b.z, bayAt);
        const d = Math.hypot(bayAt.x - p.x, bayAt.z - p.z);
        if (d <= bestD) {
          bestI = i;
          bestD = d;
        }
      }
      if (bestI >= 0) {
        this.freeProp(w, bestI, p);
        return true;
      }
      let bodyI = -1;
      let bodyD: number = WAGON.bayReach + 0.6;
      for (let i = 0; i < BODY_BAYS; i++) {
        if (!w.bodies[i]) continue;
        const b = WAGON.bodyBays[i]!;
        wagonToWorld(w.trailer, b.x, b.z, bayAt);
        const d = Math.hypot(bayAt.x - p.x, bayAt.z - p.z);
        if (d <= bodyD) {
          bodyI = i;
          bodyD = d;
        }
      }
      if (bodyI >= 0) {
        this.freeBody(w, bodyI, p);
        return true;
      }
    }
    return false;
  }

  private freeProp(w: Entity, i: number, near?: { x: number; z: number }): void {
    const id = w.props[i];
    w.props[i] = undefined;
    if (!id) return;
    if (!this.host.propExists(id)) return;
    const row = this.host.rows.get(w.id);
    const b = WAGON.bays[i]!;
    wagonToWorld(w.trailer, b.x, b.z, bayAt);
    let x = bayAt.x;
    let z = bayAt.z;
    if (near) {
      // set down beside the wagon, on the unloader's side
      const dx = near.x - x;
      const dz = near.z - z;
      const d = Math.hypot(dx, dz) || 1;
      x += (dx / d) * 0.9;
      z += (dz / d) * 0.9;
    }
    const y = (row?.y ?? 0) + 0.6;
    this.host.physics.moveHeld(id, x, y, z, w.trailer.facing);
    this.host.physics.release(id, 0, 0, 0);
    this.host.setPropHolder(id, "");
  }

  private freeBody(w: Entity, i: number, near?: { x: number; z: number }): void {
    const key = w.bodies[i];
    w.bodies[i] = undefined;
    if (!key) return;
    const body = this.host.rowOf(key);
    if (!body) return;
    if (body.dragger === `wagon:${w.id}`) this.clearLoaded(body);
    // lay them down beside the wagon
    const b = WAGON.bodyBays[i]!;
    wagonToWorld(w.trailer, b.x, b.z, bayAt);
    let x = bayAt.x;
    let z = bayAt.z;
    if (near) {
      const dx = near.x - x;
      const dz = near.z - z;
      const d = Math.hypot(dx, dz) || 1;
      x += (dx / d) * 1.3;
      z += (dz / d) * 1.3;
    }
    tmp.x = x;
    tmp.z = z;
    this.host.world().resolveXZ(tmp, body.y, CHARACTER.radius, CHARACTER.crouchHeight);
    body.x = tmp.x;
    body.z = tmp.z;
    body.vx = 0;
    body.vz = 0;
  }

  private clearLoaded(body: PlayerStateType): void {
    body.flags &= ~FLAG.DRAGGED;
    body.dragger = "";
  }

  private emptyWagon(e: Entity): void {
    for (let i = 0; i < BAY_COUNT; i++) {
      const id = e.props[i];
      if (id && this.host.propExists(id)) {
        const row = this.host.rows.get(e.id);
        this.host.physics.moveHeld(id, e.trailer.x, (row?.y ?? 0) + 1.2, e.trailer.z, e.trailer.facing);
        this.host.physics.release(id, 0, 1.5, 0);
        this.host.setPropHolder(id, "");
      }
      e.props[i] = undefined;
    }
    for (let i = 0; i < BODY_BAYS; i++) if (e.bodies[i]) this.freeBody(e, i);
  }

  // ---- hitching ----------------------------------------------------------------------------------------------------------------------------------------------------

  private hitch(horseId: string, wagonId: string): void {
    const hr = this.host.rows.get(horseId);
    const wr = this.host.rows.get(wagonId);
    const w = this.ents.get(wagonId);
    if (!hr || !wr || !w || hr.hitch || wr.hitch) return;
    hr.hitch = wagonId;
    wr.hitch = horseId;
    // the wagon is set behind the horse (its axle `len` from the collar), facing the way the horse faces
    hitchPoint(hr.x, hr.z, hr.facing, hp);
    w.trailer.x = hp.x + Math.sin(hr.facing) * WAGON.len;
    w.trailer.z = hp.z + Math.cos(hr.facing) * WAGON.len;
    w.trailer.facing = hr.facing;
    w.trailer.y = hr.y;
    if (hr.rider) {
      const rider = this.host.players.get(hr.rider);
      if (rider) rider.flags |= MOUNT_FLAG.HITCHED;
    }
  }

  private unhitch(horseId: string): void {
    const hr = this.host.rows.get(horseId);
    if (!hr || !hr.hitch) return;
    const wr = this.host.rows.get(hr.hitch);
    if (wr) wr.hitch = "";
    hr.hitch = "";
    if (hr.rider) {
      const rider = this.host.players.get(hr.rider);
      if (rider) rider.flags &= ~MOUNT_FLAG.HITCHED;
    }
    const e = this.ents.get(horseId);
    if (e) e.state.flags &= ~MOUNT_FLAG.HITCHED;
  }

  // ---- bookkeeping ---------------------------------------------------------------------------------------------------------------------------------------------------

  private fill(row: MountRow, kind: number, x: number, z: number, yaw: number, coat: number): void {
    const world = this.host.world();
    row.kind = kind;
    row.x = x;
    row.z = z;
    row.y = world.groundHeight(x, z, world.terrainHeight(x, z) + 0.3);
    row.facing = yaw;
    row.speed = 0;
    row.rider = "";
    row.hitch = "";
    row.coat = coat >>> 0;
    row.phase = MOUNT_PHASE.loose;
    row.hp = 100;
    row.cargo = 0;
  }

  private entity(id: string, kind: number, row: MountRow): Entity {
    return {
      id,
      kind,
      state: { x: row.x, y: row.y, z: row.z, vx: 0, vy: 0, vz: 0, facing: row.facing, flags: FLAG.GROUNDED | MOUNT_FLAG.MOUNTED, stumble: 0, wounds: 0, missing: 0 },
      trailer: { x: row.x, z: row.z, facing: row.facing, y: row.y },
      leader: "",
      route: "",
      routeIdx: 0,
      routeDone: false,
      boltT: 0,
      props: new Array<string | undefined>(BAY_COUNT).fill(undefined),
      bodies: new Array<string | undefined>(BODY_BAYS).fill(undefined),
      travelled: 0,
    };
  }

  private setPhase(e: Entity, phase: number): void {
    const row = this.host.rows.get(e.id);
    if (row) row.phase = phase;
  }

  private horseOf(wagonId: string): Entity | undefined {
    const wr = this.host.rows.get(wagonId);
    return wr?.hitch ? this.ents.get(wr.hitch) : undefined;
  }

  private horseOfRider(sid: string): Entity | undefined {
    for (const e of this.ents.values()) {
      if (e.kind !== MOUNT_KIND.horse) continue;
      if (this.host.rows.get(e.id)?.rider === sid) return e;
    }
    return undefined;
  }

  /** Test and room introspection. */
  get count(): number {
    return this.ents.size;
  }
  /** The prop at each crate bay and the body at each rack bay of a wagon (copies). */
  cargoOf(wagonId: string): { props: (string | undefined)[]; bodies: (string | undefined)[] } | undefined {
    const e = this.ents.get(wagonId);
    return e ? { props: [...e.props], bodies: [...e.bodies] } : undefined;
  }
}

