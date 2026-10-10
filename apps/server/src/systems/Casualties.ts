import {
  BUTTON,
  CASUALTY,
  CollisionWorld,
  FLAG,
  LIMB,
  REACT,
  WEAPON,
  WOUNDS,
  addWound,
  capWounds,
  dressWound,
  dressableZone,
  findDownedTarget,
  findWoundedTarget,
  ZONE,
  isLimb,
  isZone,
  limbZone,
  pickZone,
  LASSO,
  dragHurt,
  findRopeTarget,
  newWorldHit,
  packReact,
  BOOT,
  rayWorld,
  reactKind,
  reactOverrides,
  reactRight,
  reactSeconds,
  reactionFor,
  setWound,
  severChance,
  severityForDamage,
  woundLevel,
  zoneLimb,
  wrapAngle,
  type HitEvent,
  type LassoEvent,
  type LimbId,
  type SeverEvent,
  type WeaponId,
  type PlayerStateType,
  type Rng,
  type ZoneId,
} from "@cb/shared";
import { log } from "../log.ts";

/** What the casualty system needs from the room; keeps it testable and WorldRoom slim. */
export interface CasualtyHost {
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void; get(id: string): PlayerStateType | undefined };
  world: CollisionWorld;
  /** Release whatever prop the player is carrying (called when they go down). */
  dropHeldProp(sessionId: string): void;
  /** Where a player wakes up after a rout. */
  routSpawn(slot: number): { x: number; z: number };
  notify(text: string): void;
  /** D-055: a revive or a dressing was finished by `by` on `target` (the honours list counts them). Optional: test hosts need not. */
  helped?(by: string, target: string, kind: "revive" | "dress"): void;
  /** Seeded randomness for unaimed hits (zone, direction), so a campaign seed reproduces its injuries. */
  rng: Rng;
  /** Tell clients about a hit (cosmetic: flinch, blood, ragdoll impulse). */
  emitHit(e: HitEvent): void;
  /** Tell clients a limb came off (cosmetic companion of PlayerState.missing). */
  emitSever(e: SeverEvent): void;
  /** Whether this campaign allows limbs to be severed. */
  dismemberment(): boolean;
  /** The lost-limb mask of a player changed: refresh anything derived from it (the peg-leg flag). */
  limbsChanged(sessionId: string): void;
  /**
   * Who can be helped: the party AND its hired hands (a human may revive, dress and drag a fallen hand). Absent: `players`. The rout still counts `players` only,
   * so a party of one downed human with a standing hand is still routed.
   */
  scan?: { forEach(cb: (p: PlayerStateType, id: string) => void): void };
  /**
   * D-104: a blow to the arm knocked the weapon out of an NPC's hand (`right`: the right arm; dx, dz: the way the blow pushed). The room takes the weapon away and puts up
   * the fists (Combat, Cast). Optional: test hosts need not.
   */
  disarm?(id: string, right: boolean, dx: number, dz: number): void;
  /** D-106: every row (the party AND the NPCs: a lariat is thrown at anyone on his feet). Absent: no lariat. */
  rows?: { forEach(cb: (p: PlayerStateType, id: string) => void): void };
  /** D-106: a loop was thrown (cosmetic: the clients fly it). */
  emitLasso?(e: LassoEvent): void;
  /** D-106: `by` roped `target` (Cast: the fright; Mayhem: the bill). */
  roped?(by: string, target: string): void;
}

/** Where and from which way a blow landed. Both optional: unaimed hits get a seeded random zone and direction. */
export interface HitInfo {
  zone?: ZoneId;
  /** Horizontal direction the blow pushes the victim (need not be normalised). */
  dirX?: number;
  dirZ?: number;
  /**
   * Multiplies the damage used ONLY for the dismemberment roll (a sabre cuts limbs off more readily than its damage suggests; an umbrella
   * never does). Default 1. The sever rules themselves (`severChance`) are untouched.
   */
  severBias?: number;
  /** Who dealt it (a session id or an `npc:` row key), when known: the campaign layer reads it to tell a declaration of war from an accident. */
  by?: string;
  /** 0..1, blasts only: how hard it threw the body up (carried to the clients on the hit event; cosmetic). */
  lift?: number;
  /** D-084: what dealt it (the gazette and the Society's requests tell a sabre from an umbrella). */
  weapon?: WeaponId;
  /** D-103: the flames (the hit event says so: the clients draw no blood for it). */
  burn?: boolean;
  /** D-105: a coup de grace (the hit event says so: the clients throw more blood). */
  finisher?: boolean;
  /** D-108: a boot (he goes over on his back, wherever it landed; the hit event says so: the clients lay him flat). */
  boot?: boolean;
  /** D-111: a horse went through him (floored as by a boot; the hit event says both, so the clients lay him flat and hear the hooves). */
  trample?: boolean;
  /** D-108: what a thrown body met (a wall at speed, the ground from a height; the hit event says so: the clients hear the crunch). */
  splat?: boolean;
}

interface Revive {
  /** "revive" a downed comrade, or "dress" a wound on a standing one (same hold, different target rules and reward). */
  kind: "revive" | "dress";
  target: string;
  /** 0..1 */
  progress: number;
  /** A hired surgeon's work: it needs no held button (nobody is pressing one), everything else is checked as for a human. */
  auto?: boolean;
}

/** A held button counts only while frames keep arriving (a stalled client cannot hold forever), but must tolerate real hitches. */
const HOLD_STALE_MS = 1000; // tolerates 300+ ms client hitches (measured on loaded software-GL runs); cancels a frozen client

const horizontal = (a: PlayerStateType, b: PlayerStateType): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Health, downing, reviving and dragging. Design rules:
 *  - Players go DOWN, never dead: a downed player can always be revived, dragged and carried home.
 *  - Timers run on SERVER ticks using the last known button state, not on input frames, so a client that floods
 *    frames cannot speed up (or skip) a revive.
 *  - Nothing here trusts the client beyond its button bits; range, state and ownership are re-checked every tick.
 */
export class Casualties {
  /** Last button bits per player and when they arrived (server clock). Stale holds expire, see HOLD_STALE_MS. */
  private readonly buttons = new Map<string, { bits: number; at: number }>();
  private readonly revives = new Map<string, Revive>(); // reviver -> revive
  private readonly drags = new Map<string, string>(); // dragger -> dragged
  private routTimer = 0;
  /** D-104: seconds left of each body's hit reaction (PlayerState.react tells its kind; this times it). */
  private readonly reacts = new Map<string, number>();
  /** D-106: men held on a rope (by row): seconds before one on his feet works loose, and damage owed for being hauled too fast. */
  private readonly ropes = new Map<string, { left: number; owed: number }>();
  /** D-106: loops in the air (by thrower): at whom, and seconds until they land. And when each thrower may throw again (sim seconds). */
  private readonly throws = new Map<string, { target: string; left: number }>();
  private readonly ropeReady = new Map<string, number>();
  private simT = 0;

  constructor(
    private readonly host: CasualtyHost,
    private readonly opts: { routSeconds: number } = { routSeconds: CASUALTY.routSeconds },
  ) {}

  // ---- damage entry point (weapons, explosions, friendly fire and debug commands all come through here) ----

  damage(sessionId: string, amount: number, hit: HitInfo = {}): void {
    const p = this.host.players.get(sessionId);
    if (!p || (p.flags & FLAG.DOWNED) !== 0 || !(amount > 0)) return;
    p.health = Math.max(0, Math.round(p.health - amount));

    // Where it landed and how badly it marked them. Wounds are server-owned state; everything visual derives from them.
    let zone = isZone(hit.zone) ? hit.zone : pickZone(this.host.rng);
    const limb = zoneLimb(zone);
    if (!isZone(hit.zone) && limb !== undefined && (p.missing & limb) !== 0) zone = ZONE.TORSO; // an unaimed blow does not pick on a stump
    const levelBefore = woundLevel(p.wounds, zone);
    p.wounds = addWound(p.wounds, zone, severityForDamage(amount));
    let dx = hit.dirX ?? 0;
    let dz = hit.dirZ ?? 0;
    let len = Math.hypot(dx, dz);
    if (!(len > 1e-6)) {
      const a = this.host.rng.next() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
      len = 1;
    }
    const down = p.health === 0;
    const power = Math.min(1, amount / 60);
    const lift = hit.lift !== undefined && hit.lift > 0 ? Math.min(1, hit.lift) : 0;
    const ev: HitEvent = lift > 0 ? { id: sessionId, zone, dx: dx / len, dz: dz / len, power, down, lift } : { id: sessionId, zone, dx: dx / len, dz: dz / len, power, down };
    if (hit.burn) ev.burn = true;
    if (hit.finisher) ev.fin = true;
    if (hit.boot || hit.trample) ev.boot = true;
    if (hit.trample) ev.trample = true;
    if (hit.splat) ev.splat = true;
    // D-104: the reaction is decided before the event goes out, so a blow that knocks the weapon away says so (a client at a few frames a second can miss the
    // stagger's 0.9 s on the state; it cannot miss the message)
    const next = down || hit.burn ? 0 : this.reactionTo(p, zone, amount, hit.boot === true || hit.trample === true);
    if (next !== 0 && reactKind(next) === REACT.DISARMED) ev.disarm = reactRight(next) ? 2 : 1;
    this.host.emitHit(ev);
    // A heavy blow to a limb (helped by how cut up it already is) can take it off. The roll only happens when there is a chance,
    // so unrelated hits never consume randomness.
    const target = zoneLimb(zone);
    // (D-094: a beast's "limbs" are its legs; it is shot down, never taken apart)
    if (target !== undefined && (p.flags & FLAG.BEAST) === 0 && this.host.dismemberment() && (p.missing & target) === 0) {
      const chance = severChance(amount * Math.max(0, hit.severBias ?? 1), levelBefore);
      if (chance > 0 && this.host.rng.chance(chance)) this.sever(sessionId, target, dx / len, dz / len, power);
    }
    if (down) this.down(sessionId, p);
    else if (next !== 0) this.react(sessionId, p, next, dx / len, dz / len);
  }

  /**
   * D-104: where it landed decides what the blow does to the body (hitReaction.ts): down on that knee, doubled over, or the weapon knocked away. NPC rows only, never a
   * beast or a rider or a man at a crank gun (see the header of hitReaction.ts for why the players do not). The packed reaction this blow puts on him, or 0 for none.
   */
  private reactionTo(p: PlayerStateType, zone: ZoneId, amount: number, boot: boolean): number {
    if (p.npc === 0 || (p.flags & (FLAG.BEAST | FLAG.MOUNTED | FLAG.OPERATING | FLAG.DRAGGED)) !== 0) return 0;
    const armed = p.weapon !== 0 && p.weapon !== WEAPON.FISTS + 1;
    // (D-108: a boot puts him on the ground wherever it lands)
    const next = boot ? packReact(REACT.FLOORED, false, BOOT.floorS) : reactionFor(zone, amount, armed);
    return reactOverrides(next, p.react) ? next : 0;
  }

  /** Puts the reaction `next` (from `reactionTo`, decided when the blow landed) on `id`; a disarming one has the room take the weapon away. */
  private react(id: string, p: PlayerStateType, next: number, dx: number, dz: number): void {
    p.react = next;
    this.reacts.set(id, reactSeconds(next));
    if (reactKind(next) === REACT.DISARMED) this.host.disarm?.(id, reactRight(next), dx, dz);
  }

  /** D-104: the reaction in force on `id` (0 = none). */
  reactionOf(id: string): number {
    return this.reacts.has(id) ? (this.host.players.get(id)?.react ?? 0) : 0;
  }

  /**
   * D-064: a blast caught somebody already down. Nothing about their health changes (the downed are past harm: revive or rout decides them), but the body is THROWN (a cosmetic hit
   * event the clients ragdoll), and a fallen ENEMY or stranger (an NPC row) may come apart: the same sever roll a blow to that limb would get. A downed member of the party is only
   * thrown; their limbs answer to blows they took standing (a lost limb is a campaign scar, never a cannon's afterthought on a body that could not dodge).
   */
  toss(sessionId: string, dirX: number, dirZ: number, power: number, lift: number, severDamage: number, severBias = 1): void {
    const p = this.host.players.get(sessionId);
    if (!p || (p.flags & FLAG.DOWNED) === 0 || !(power > 0)) return;
    let dx = dirX;
    let dz = dirZ;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      dx /= len;
      dz /= len;
    } else {
      dx = 0;
      dz = 1;
    }
    const zone = pickZone(this.host.rng);
    const pw = Math.min(1, power);
    this.host.emitHit({ id: sessionId, zone, dx, dz, power: pw, down: true, lift: Math.max(0, Math.min(1, lift)) });
    const target = zoneLimb(zone);
    if (p.npc === 0 || (p.flags & FLAG.BEAST) !== 0 || target === undefined || !this.host.dismemberment() || (p.missing & target) !== 0) return;
    const chance = severChance(severDamage * Math.max(0, severBias), woundLevel(p.wounds, zone));
    if (chance > 0 && this.host.rng.chance(chance)) this.sever(sessionId, target, dx, dz, pw);
  }

  /** Takes a limb off (state + event). Also the entry point for scripted losses (campaign events, debug). No-op if already gone. */
  sever(sessionId: string, limb: LimbId, dirX = 0, dirZ = 1, power = 0.8): boolean {
    const p = this.host.players.get(sessionId);
    if (!p || !isLimb(limb) || (p.missing & limb) !== 0) return false;
    p.missing |= limb;
    p.wounds = setWound(p.wounds, limbZone(limb), 3); // the stump stays grievously wounded
    this.host.limbsChanged(sessionId);
    this.host.emitSever({ id: sessionId, limb, dx: dirX, dz: dirZ, power });
    log.info("casualty.sever", { sessionId, limb });
    return true;
  }

  /**
   * Restores every lost limb. DEBUG ONLY: nothing in play calls this (revive and rout patch wounds but never regrow a limb; a
   * later campaign layer may offer prosthetics, never regrowth).
   */
  restoreLimbs(sessionId: string): void {
    const p = this.host.players.get(sessionId);
    if (!p) return;
    p.missing = 0;
    this.host.limbsChanged(sessionId);
  }

  down(sessionId: string, p: PlayerStateType): void {
    p.health = 0;
    this.host.dropHeldProp(sessionId);
    this.cancelRevive(sessionId);
    this.releaseDrag(sessionId);
    // Anyone reviving THIS player stops; if this player was being dragged they stay dragged (their dragger keeps hold).
    for (const [reviver, r] of [...this.revives]) if (r.target === sessionId) this.cancelRevive(reviver);
    p.flags = (p.flags | FLAG.DOWNED) & ~(FLAG.CARRYING | FLAG.REVIVING | FLAG.DRAGGING | FLAG.CROUCHING | FLAG.SPRINTING);
    p.vx = 0;
    p.vz = 0;
    p.react = 0; // (the downed pose takes over from a stagger)
    this.reacts.delete(sessionId);
    log.info("casualty.down", { sessionId });
  }

  private standUp(sessionId: string, p: PlayerStateType, health: number): void {
    p.health = health;
    p.flags &= ~(FLAG.DOWNED | FLAG.DRAGGED);
    p.reviveProgress = 0;
    p.reviver = "";
    p.wounds = capWounds(p.wounds, WOUNDS.revivedCap); // patched up, not cured: the scars of the day stay visible
    this.releaseDragOf(sessionId);
  }

  // ---- input frames -------------------------------------------------------------------------------------------

  /**
   * Called for every input frame after the movement step. `pressed` = rising-edge button mask.
   * Returns true when the frame's INTERACT press was consumed here (so props are not also picked up),
   * or the player is downed and may not use props at all.
   */
  onFrame(sessionId: string, p: PlayerStateType, buttons: number, pressed: number): boolean {
    this.buttons.set(sessionId, { bits: buttons, at: Date.now() });
    if ((p.flags & FLAG.DOWNED) !== 0) return true; // the downed can crawl and wait; nothing else

    if (pressed & BUTTON.GRAB) {
      if (this.drags.has(sessionId)) this.releaseDrag(sessionId);
      else if (!this.startDrag(sessionId, p)) this.throwRope(sessionId, p); // (D-106: nobody down in reach: the lariat, at whoever it is aimed at)
    }
    if (pressed & BUTTON.INTERACT && (p.flags & (FLAG.CARRYING | FLAG.DRAGGING)) === 0 && !this.revives.has(sessionId)) {
      return this.startRevive(sessionId, p);
    }
    return false;
  }

  // ---- revive -------------------------------------------------------------------------------------------------

  private startRevive(reviverId: string, reviver: PlayerStateType): boolean {
    const targetId = findDownedTarget<string>(reviver, CASUALTY.reviveRange, (cb) =>
      this.scan().forEach((o, id) => id !== reviverId && !this.isBeingRevived(id) && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
    );
    if (targetId === undefined) return false;
    this.revives.set(reviverId, { kind: "revive", target: targetId, progress: 0 });
    reviver.flags |= FLAG.REVIVING;
    const target = this.host.players.get(targetId)!;
    target.reviver = reviverId;
    target.reviveProgress = 0;
    return true;
  }

  /**
   * Field dressing: the same hold as a revive, on a standing comrade with a wound above its dressing floor. Called by the room
   * when an INTERACT press found nothing else to do (a downed comrade or a prop in reach wins). Returns whether a dressing began.
   */
  tryDress(reviverId: string, reviver: PlayerStateType): boolean {
    if ((reviver.flags & (FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.REVIVING | FLAG.DRAGGED)) !== 0 || this.revives.has(reviverId)) return false;
    const targetId = findWoundedTarget<string>(reviver, CASUALTY.reviveRange, (cb) =>
      this.scan().forEach((o, id) => id !== reviverId && !this.isBeingRevived(id) && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
    );
    if (targetId === undefined) return false;
    this.revives.set(reviverId, { kind: "dress", target: targetId, progress: 0 });
    reviver.flags |= FLAG.REVIVING;
    const target = this.host.players.get(targetId)!;
    target.reviver = reviverId;
    target.reviveProgress = 0;
    return true;
  }

  private scan(): { forEach(cb: (p: PlayerStateType, id: string) => void): void } {
    return this.host.scan ?? this.host.players;
  }

  /**
   * A hired surgeon works on `targetId` (called every tick while he is in reach; no button is held). Returns true while the work is under way, or has just
   * been started. Every rule of a human's revive/dress applies: standing medic, right patient, in reach, nobody else already on it.
   */
  assist(medicId: string, targetId: string, kind: "revive" | "dress"): boolean {
    const medic = this.host.players.get(medicId);
    const target = this.host.players.get(targetId);
    if (!medic || !target || medicId === targetId) return false;
    const cur = this.revives.get(medicId);
    if (cur) return cur.target === targetId && cur.kind === kind;
    if ((medic.flags & (FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.REVIVING | FLAG.DRAGGED)) !== 0 || this.isBeingRevived(targetId)) return false;
    if (horizontal(medic, target) > CASUALTY.reviveRange || Math.abs(medic.y - target.y) > 1.6) return false;
    const ok = kind === "revive"
      ? (target.flags & (FLAG.DOWNED | FLAG.DRAGGED)) === FLAG.DOWNED
      : (target.flags & (FLAG.DOWNED | FLAG.DRAGGED)) === 0 && dressableZone(target.wounds, target.missing) >= 0;
    if (!ok) return false;
    this.revives.set(medicId, { kind, target: targetId, progress: 0, auto: true });
    medic.flags |= FLAG.REVIVING;
    target.reviver = medicId;
    target.reviveProgress = 0;
    return true;
  }

  private isBeingRevived(targetId: string): boolean {
    for (const r of this.revives.values()) if (r.target === targetId) return true;
    return false;
  }

  private cancelRevive(reviverId: string): void {
    const r = this.revives.get(reviverId);
    if (!r) return;
    this.revives.delete(reviverId);
    const reviver = this.host.players.get(reviverId);
    if (reviver) reviver.flags &= ~FLAG.REVIVING;
    const target = this.host.players.get(r.target);
    if (target) {
      target.reviver = "";
      target.reviveProgress = 0;
    }
  }

  // ---- drag ---------------------------------------------------------------------------------------------------------

  private startDrag(draggerId: string, dragger: PlayerStateType): boolean {
    if ((dragger.flags & (FLAG.CARRYING | FLAG.REVIVING)) !== 0) return false;
    const targetId = findDownedTarget<string>(dragger, CASUALTY.dragRange, (cb) =>
      this.scan().forEach((o, id) => id !== draggerId && !this.isBeingRevived(id) && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
    );
    if (targetId === undefined) return false;
    const target = this.host.players.get(targetId)!;
    this.drags.set(draggerId, targetId);
    dragger.flags |= FLAG.DRAGGING;
    target.flags |= FLAG.DRAGGED;
    target.dragger = draggerId;
    return true;
  }

  // ---- D-106: the lariat -------------------------------------------------------------------------------------------------------------

  /** Rows a loop cannot take: down, held, a beast, a rider, a man at a crank gun. */
  private static readonly UNROPEABLE = FLAG.DOWNED | FLAG.DRAGGED | FLAG.BEAST | FLAG.MOUNTED | FLAG.OPERATING;

  /** Throws a loop at the man the thrower faces (lasso.ts `findRopeTarget`), if there is one in reach and nothing between; it lands `LASSO.throwS` later. */
  private throwRope(id: string, p: PlayerStateType): void {
    const rows = this.host.rows;
    if (!rows || (p.flags & (FLAG.CARRYING | FLAG.REVIVING | FLAG.DRAGGING | FLAG.OPERATING)) !== 0 || this.throws.has(id) || this.simT < (this.ropeReady.get(id) ?? 0)) return;
    this.ropeReady.set(id, this.simT + LASSO.cooldown);
    const target = findRopeTarget<string>(p, (cb) => rows.forEach((o, k) => k !== id && cb(k, o)), Casualties.UNROPEABLE);
    const t = target !== undefined ? this.host.players.get(target) : undefined;
    const hy = p.y + 1.3;
    let tx: number;
    let ty: number;
    let tz: number;
    let hit = false;
    if (t) {
      tx = t.x;
      ty = t.y + 1.1;
      tz = t.z;
      const dx = tx - p.x;
      const dy = ty - hy;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      hit = !rayWorld(this.host.world, p.x, hy, p.z, dx / d, dy / d, dz / d, d, this.ropeHit); // (a wall between stops the loop)
    } else {
      // thrown at nobody: the loop sails out to its reach and falls
      tx = p.x - Math.sin(p.facing) * LASSO.range * 0.7;
      tz = p.z - Math.cos(p.facing) * LASSO.range * 0.7;
      ty = this.host.world.terrainHeight(tx, tz);
    }
    this.host.emitLasso?.({ by: id, x: p.x, y: hy, z: p.z, tx, ty, tz, hit });
    if (hit && target !== undefined) this.throws.set(id, { target, left: LASSO.throwS });
  }
  private readonly ropeHit = newWorldHit();

  /** The loop lands: if he is still there to be caught (on his feet, free, within reach), he is roped and hauled from now on. */
  private landRope(byId: string, targetId: string): void {
    const by = this.host.players.get(byId);
    const t = this.host.players.get(targetId);
    if (!by || !t || (by.flags & (FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING)) !== 0 || (t.flags & Casualties.UNROPEABLE) !== 0) return;
    if (horizontal(by, t) > LASSO.range * 1.25) return;
    this.drags.set(byId, targetId);
    by.flags |= FLAG.DRAGGING;
    t.flags |= FLAG.DRAGGED;
    t.dragger = byId;
    t.roped = 1;
    t.react = 0; // (the rope's pose takes over from a stagger)
    this.reacts.delete(targetId);
    this.ropes.set(targetId, { left: LASSO.holdS, owed: 0 });
    this.host.roped?.(byId, targetId);
  }

  /** D-106: whether `id` is held on a rope now. */
  isRoped(id: string): boolean {
    return this.ropes.has(id);
  }

  /** Public so the mount system can free a body before loading it onto a wagon. */
  releaseDrag(draggerId: string): void {
    const targetId = this.drags.get(draggerId);
    if (targetId === undefined) return;
    this.drags.delete(draggerId);
    const dragger = this.host.players.get(draggerId);
    if (dragger) dragger.flags &= ~FLAG.DRAGGING;
    const target = this.host.players.get(targetId);
    if (target) {
      target.flags &= ~FLAG.DRAGGED;
      target.dragger = "";
      target.vx = 0;
      target.vz = 0;
      if (this.ropes.delete(targetId)) {
        // D-106: off the rope. A man on his feet lies a moment, then gets up (the floored pose, as a leg shot leaves him)
        if (target.roped !== 0) target.roped = 0;
        if ((target.flags & FLAG.DOWNED) === 0) {
          target.react = packReact(REACT.FLOORED, false, LASSO.getUpS);
          this.reacts.set(targetId, LASSO.getUpS);
        }
      }
    }
  }

  /** The body `targetId` is no longer draggable (revived / gone): free whoever holds it. */
  private releaseDragOf(targetId: string): void {
    for (const [dragger, t] of [...this.drags]) if (t === targetId) this.releaseDrag(dragger);
  }

  // ---- per-tick simulation --------------------------------------------------------------------------------------------------------

  tick(dt: number): void {
    this.simT += dt;
    // D-106: loops in the air land
    for (const [by, th] of this.throws) {
      th.left -= dt;
      if (th.left > 0) continue;
      this.throws.delete(by);
      this.landRope(by, th.target);
    }
    // D-104: hit reactions run out (a row that left takes its timer with it)
    for (const [id, left] of this.reacts) {
      const p = this.host.players.get(id);
      const t = left - dt;
      if (!p || t <= 0 || (p.flags & FLAG.DOWNED) !== 0) {
        this.reacts.delete(id);
        if (p && p.react !== 0) p.react = 0;
      } else this.reacts.set(id, t);
    }
    // Revives: progress only while the reviver keeps holding INTERACT, stays in reach, and both are in the right state.
    for (const [reviverId, r] of [...this.revives]) {
      const reviver = this.host.players.get(reviverId);
      const target = this.host.players.get(r.target);
      const held = this.buttons.get(reviverId);
      const holding = r.auto === true || held !== undefined && (held.bits & BUTTON.INTERACT) !== 0 && Date.now() - held.at < HOLD_STALE_MS;
      // A revive needs a downed (not dragged) patient; a dressing needs a standing one who still has a wound worth dressing.
      const patientOk =
        target !== undefined &&
        (r.kind === "revive"
          ? (target.flags & (FLAG.DOWNED | FLAG.DRAGGED)) === FLAG.DOWNED
          : (target.flags & (FLAG.DOWNED | FLAG.DRAGGED)) === 0 && dressableZone(target.wounds, target.missing) >= 0);
      const valid =
        reviver !== undefined &&
        target !== undefined &&
        (reviver.flags & FLAG.DOWNED) === 0 &&
        patientOk &&
        holding &&
        horizontal(reviver, target) <= CASUALTY.reviveRange + 0.4;
      if (!valid) {
        this.cancelRevive(reviverId);
        continue;
      }
      r.progress += dt / (r.kind === "revive" ? CASUALTY.reviveSeconds : CASUALTY.dressSeconds);
      target.reviveProgress = Math.min(100, Math.floor(r.progress * 100));
      if (r.progress >= 1) {
        const kind = r.kind;
        this.cancelRevive(reviverId);
        if (kind === "revive") {
          this.standUp(r.target, target, CASUALTY.reviveHealth);
          log.info("casualty.revived", { target: r.target, by: reviverId });
        } else {
          target.wounds = dressWound(target.wounds, target.missing); // one level, bounded by the floors (injury.ts)
          log.info("casualty.dressed", { target: r.target, by: reviverId });
        }
        this.host.helped?.(reviverId, r.target, kind);
      }
    }

    // Drags: steer each body toward a spot behind its dragger, or let go if the bond is broken. (D-106: a rope is a longer, stronger drag, on a man who need not be down.)
    for (const [draggerId, targetId] of [...this.drags]) {
      const dragger = this.host.players.get(draggerId);
      const target = this.host.players.get(targetId);
      const rope = this.ropes.get(targetId);
      if (!dragger || !target || (dragger.flags & FLAG.DOWNED) !== 0 || (rope === undefined && (target.flags & FLAG.DOWNED) === 0) || horizontal(dragger, target) > (rope ? LASSO.breakRange : CASUALTY.dragBreakRange)) {
        this.releaseDrag(draggerId);
        continue;
      }
      if (rope && (target.flags & FLAG.DOWNED) === 0) {
        rope.left -= dt;
        if (rope.left <= 0) {
          this.releaseDrag(draggerId); // (he has worked the loop loose)
          continue;
        }
      }
      let vx: number;
      let vz: number;
      if (rope) {
        // a rope pulls only when it is taut: along the line to the one holding it, as far as he is past its length; slack, he lies where he is
        // (a hand on the collar instead holds the body at a spot behind the dragger, below)
        const dx = dragger.x - target.x;
        const dz = dragger.z - target.z;
        const d = Math.hypot(dx, dz) || 1;
        const pull = Math.min(LASSO.pullSpeed, Math.max(0, (d - LASSO.length) * 6));
        vx = (dx / d) * pull;
        vz = (dz / d) * pull;
      } else {
        const wantX = dragger.x + Math.sin(dragger.facing) * CASUALTY.dragDistance;
        const wantZ = dragger.z + Math.cos(dragger.facing) * CASUALTY.dragDistance;
        vx = dragger.vx + (wantX - target.x) * 8;
        vz = dragger.vz + (wantZ - target.z) * 8;
        const m = Math.hypot(vx, vz);
        if (m > 8) {
          vx = (vx / m) * 8;
          vz = (vz / m) * 8;
        }
      }
      // D-106: hauled faster than a run, the ground takes its toll, in bites (the hit events throw the blood; the drag leaves the trail)
      if (rope && (target.flags & FLAG.DOWNED) === 0) {
        rope.owed += dragHurt(Math.hypot(dragger.vx, dragger.vz)) * dt; // (the pace of the one hauling: the jerk of the catch itself is not a gallop)
        if (rope.owed >= 4) {
          const bite = Math.floor(rope.owed);
          rope.owed -= bite;
          this.damage(targetId, bite, { zone: ZONE.TORSO, dirX: vx, dirZ: vz, by: draggerId });
          if (!this.drags.has(draggerId)) continue; // (the bite put him down and something let go)
        }
      }
      target.vx = vx;
      target.vz = vz;
      // Head toward the dragger: the body lies on its back, so it faces away from them. (On a rope: away from the one holding it, along the rope.)
      target.facing = rope ? Math.atan2(dragger.x - target.x, dragger.z - target.z) : wrapAngle(dragger.facing + Math.PI); // (forward is (-sin, -cos): away from her)
    }

    this.tickRout(dt);
  }

  /** If every connected player is down, nobody can save anyone: after a beat the party is hauled back up together. */
  private tickRout(dt: number): void {
    let connected = 0;
    let down = 0;
    this.host.players.forEach((p) => {
      if (!p.connected) return;
      connected++;
      if ((p.flags & FLAG.DOWNED) !== 0) down++;
    });
    if (connected === 0 || down < connected) {
      this.routTimer = 0;
      return;
    }
    this.routTimer += dt;
    if (this.routTimer < this.opts.routSeconds) return;
    this.routTimer = 0;
    for (const id of [...this.revives.keys()]) this.cancelRevive(id);
    for (const id of [...this.drags.keys()]) this.releaseDrag(id);
    this.host.players.forEach((p, id) => {
      if ((p.flags & FLAG.DOWNED) === 0) return;
      this.standUp(id, p, CASUALTY.routHealth);
      const at = this.host.routSpawn(p.slot);
      p.x = at.x;
      p.z = at.z;
      p.y = this.host.world.groundHeight(at.x, at.z, 1e6);
      p.vx = 0;
      p.vz = 0;
    });
    this.host.notify("The expedition was routed. A decisive strategic repositioning was declared.");
    log.info("casualty.rout", {});
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------------------------------

  onLeave(sessionId: string): void {
    this.cancelRevive(sessionId);
    this.releaseDrag(sessionId);
    for (const [reviver, r] of [...this.revives]) if (r.target === sessionId) this.cancelRevive(reviver);
    this.releaseDragOf(sessionId);
    this.buttons.delete(sessionId);
  }

  /** For tests/diagnostics. */
  get activeRevives(): number {
    return this.revives.size;
  }
  get activeDrags(): number {
    return this.drags.size;
  }
}
