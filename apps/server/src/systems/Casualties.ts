import {
  BUTTON,
  CASUALTY,
  CollisionWorld,
  FLAG,
  LIMB,
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
  setWound,
  severChance,
  severityForDamage,
  woundLevel,
  zoneLimb,
  wrapAngle,
  type HitEvent,
  type LimbId,
  type SeverEvent,
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
}

/** Where and from which way a blow landed. Both optional: unaimed hits get a seeded random zone and direction. */
export interface HitInfo {
  zone?: ZoneId;
  /** Horizontal direction the blow pushes the victim (need not be normalised). */
  dirX?: number;
  dirZ?: number;
}

interface Revive {
  /** "revive" a downed comrade, or "dress" a wound on a standing one (same hold, different target rules and reward). */
  kind: "revive" | "dress";
  target: string;
  /** 0..1 */
  progress: number;
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
    this.host.emitHit({ id: sessionId, zone, dx: dx / len, dz: dz / len, power, down });
    // A heavy blow to a limb (helped by how cut up it already is) can take it off. The roll only happens when there is a chance,
    // so unrelated hits never consume randomness.
    const target = zoneLimb(zone);
    if (target !== undefined && this.host.dismemberment() && (p.missing & target) === 0) {
      const chance = severChance(amount, levelBefore);
      if (chance > 0 && this.host.rng.chance(chance)) this.sever(sessionId, target, dx / len, dz / len, power);
    }
    if (down) this.down(sessionId, p);
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
      else this.startDrag(sessionId, p);
    }
    if (pressed & BUTTON.INTERACT && (p.flags & (FLAG.CARRYING | FLAG.DRAGGING)) === 0 && !this.revives.has(sessionId)) {
      return this.startRevive(sessionId, p);
    }
    return false;
  }

  // ---- revive -------------------------------------------------------------------------------------------------

  private startRevive(reviverId: string, reviver: PlayerStateType): boolean {
    const targetId = findDownedTarget<string>(reviver, CASUALTY.reviveRange, (cb) =>
      this.host.players.forEach((o, id) => id !== reviverId && !this.isBeingRevived(id) && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
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
      this.host.players.forEach((o, id) => id !== reviverId && !this.isBeingRevived(id) && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
    );
    if (targetId === undefined) return false;
    this.revives.set(reviverId, { kind: "dress", target: targetId, progress: 0 });
    reviver.flags |= FLAG.REVIVING;
    const target = this.host.players.get(targetId)!;
    target.reviver = reviverId;
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

  private startDrag(draggerId: string, dragger: PlayerStateType): void {
    if ((dragger.flags & (FLAG.CARRYING | FLAG.REVIVING)) !== 0) return;
    const targetId = findDownedTarget<string>(dragger, CASUALTY.dragRange, (cb) =>
      this.host.players.forEach((o, id) => id !== draggerId && !this.isBeingRevived(id) && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
    );
    if (targetId === undefined) return;
    const target = this.host.players.get(targetId)!;
    this.drags.set(draggerId, targetId);
    dragger.flags |= FLAG.DRAGGING;
    target.flags |= FLAG.DRAGGED;
    target.dragger = draggerId;
  }

  private releaseDrag(draggerId: string): void {
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
    }
  }

  /** The body `targetId` is no longer draggable (revived / gone): free whoever holds it. */
  private releaseDragOf(targetId: string): void {
    for (const [dragger, t] of [...this.drags]) if (t === targetId) this.releaseDrag(dragger);
  }

  // ---- per-tick simulation --------------------------------------------------------------------------------------------------------

  tick(dt: number): void {
    // Revives: progress only while the reviver keeps holding INTERACT, stays in reach, and both are in the right state.
    for (const [reviverId, r] of [...this.revives]) {
      const reviver = this.host.players.get(reviverId);
      const target = this.host.players.get(r.target);
      const held = this.buttons.get(reviverId);
      const holding = held !== undefined && (held.bits & BUTTON.INTERACT) !== 0 && Date.now() - held.at < HOLD_STALE_MS;
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
      }
    }

    // Drags: steer each body toward a spot behind its dragger, or let go if the bond is broken.
    for (const [draggerId, targetId] of [...this.drags]) {
      const dragger = this.host.players.get(draggerId);
      const target = this.host.players.get(targetId);
      if (!dragger || !target || (dragger.flags & FLAG.DOWNED) !== 0 || (target.flags & FLAG.DOWNED) === 0 || horizontal(dragger, target) > CASUALTY.dragBreakRange) {
        this.releaseDrag(draggerId);
        continue;
      }
      const wantX = dragger.x + Math.sin(dragger.facing) * CASUALTY.dragDistance;
      const wantZ = dragger.z + Math.cos(dragger.facing) * CASUALTY.dragDistance;
      let vx = dragger.vx + (wantX - target.x) * 8;
      let vz = dragger.vz + (wantZ - target.z) * 8;
      const m = Math.hypot(vx, vz);
      if (m > 8) {
        vx = (vx / m) * 8;
        vz = (vz / m) * 8;
      }
      target.vx = vx;
      target.vz = vz;
      // Head toward the dragger: the body lies on its back, so it faces away from them.
      target.facing = wrapAngle(dragger.facing + Math.PI);
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
