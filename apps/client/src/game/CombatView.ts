import { Vector3 } from "three";
import {
  BUTTON,
  CANNON,
  CRANK,
  CRANK_PHASE,
  CARRIED,
  COMBAT,
  FLAG,
  SURFACE,
  WEAPON,
  WEAPONS,
  aimDirection,
  bodyCentre,
  elevToWire,
  newWorldHit,
  rayWorld,
  shotDirection,
  shotSeed,
  spreadFor,
  wrapAngle,
  weaponToWire,
  yawToWire,
  type BodyPose,
  type BoomEvent,
  type CannonStateType,
  type HitEvent,
  type HitMarkEvent,
  type ImpactEvent,
  type PlayerStateType,
  type ShotEvent,
  type WeaponId,
} from "@cb/shared";
import type { Intent } from "../input/Controls.ts";
import type { Controls } from "../input/Controls.ts";
import type { Session } from "../net/Session.ts";
import type { CameraRig } from "../render/CameraRig.ts";
import type { ViewModel } from "../render/ViewModel.ts";
import type { ActorCombat, CharacterActor } from "../render/CharacterActor.ts";
import { Projectiles } from "../render/Projectiles.ts";
import type { Stage } from "../render/Stage.ts";
import { CannonView } from "../render/weapons/CannonView.ts";
import { CrankGunView } from "../render/weapons/CrankGunView.ts";
import { ShotFx } from "../render/weapons/ShotFx.ts";
import { IMPACT_SOUND, REPORT, fx as sfx } from "../render/weapons/sfx.ts";
import { aimSolve, crosshairDistance, reticleRadiusPx } from "../input/aim.ts";
import { getGfx } from "../settings.ts";
import type { GameAudio, ImpactMaterial } from "./GameAudio.ts";
import { CombatHud } from "../ui/CombatHud.ts";

/** Fewer or more effects by graphics preset. */
const FX_SCALE = { low: 0.5, medium: 1, high: 1.4, test: 0.5 } as const;

const BUSY = FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.DRAGGED | FLAG.REVIVING | FLAG.OPERATING;

interface ActorLike {
  body: CharacterActor;
}

const tmp = new Vector3();
const muzzle = new Vector3();
const mdir = new Vector3();
const shotV = { x: 0, y: 0, z: 0 };
const worldHit = newWorldHit();
const rayO = { x: 0, y: 0, z: 0 };
const rayD = { x: 0, y: 0, z: 0 };
/** Poses of the bodies the crosshair ray may meet (everyone standing but the local player); the array and its objects are reused every frame. */
const rayBodies: BodyPose[] = [];

/** The `WEAPON` ids in a carried mask, memoised (a mask is a handful of bits: the table is tiny and `actorCombat` allocates nothing after the first sight of a mask). */
const carriedCache = new Map<number, readonly number[]>();
export function carriedOf(mask: number): readonly number[] {
  let c = carriedCache.get(mask);
  if (!c) {
    c = CARRIED.filter((id) => (mask & (1 << id)) !== 0);
    carriedCache.set(mask, c);
  }
  return c;
}

/** The surface a round struck, as the audio's material words (cloth is a coat or a canvas: soft earth). */
const MATERIAL: readonly ImpactMaterial[] = ["earth", "wood", "metal", "stone", "earth", "flesh"];
/** How hard a weapon strikes 0..1, for the impact's weight. */
const WEAPON_POWER: Readonly<Record<number, number>> = { [WEAPON.PISTOL]: 0.4, [WEAPON.RIFLE]: 0.7, [WEAPON.BLUNDERBUSS]: 1, [WEAPON.CANNON]: 1 };

/**
 * Everything the player sees and feels of combat, in one place, so the frame loop only calls five methods:
 *  - `beginFrame`/`sendInput`: aim from the camera through the crosshair to a point in the world, then to a direction from the player's own eye
 *    (what the server shoots along), sent with the weapon wish; and the immediate, PREDICTED cosmetics of a shot (flash, smoke, tracer, sound, recoil)
 *    the moment the trigger is pulled - the server's confirmation only ever adds hits, wounds and ammunition;
 *  - the server events (`shot`, `impact`, `boom`, `hitmark`, `hit`) for everyone else's shots, all impacts and the explosion picture;
 *  - the cannon models; the projectile pictures; the armoury card, sight, hit markers and bearing marks.
 * Recoil is a picture (weapon kick in the animator, a camera kick that never touches the aim); it is not a movement input, so shooting cannot desync the
 * predicted body.
 */
export class CombatView {
  readonly fx: ShotFx;
  /** The first-person hands and weapon, when there are any: the muzzle flash and smoke leave THEIR muzzle, and their recoil and blows play with the shot. */
  viewmodel: ViewModel | undefined;
  /** The audio of the frame loop (D-038): impacts by material, foley of handling the piece, blasts with their tails; absent = the plain weapon sounds. */
  audio: GameAudio | undefined;
  private lastWish = -2;
  /** Blasts heard lately as (x, z, time) triples (soot on bodies near them): a short ring, newest last. */
  private readonly blasts: number[] = [];
  /** Told once for every blast (x, z): the battlefield's ledger keeps its place (game/battleLedger.ts). */
  onBlast: ((x: number, z: number, radius: number) => void) | undefined;
  private readonly projectiles: Projectiles;
  private readonly hud: CombatHud;
  private readonly cannons = new Map<string, CannonView | CrankGunView>();
  private readonly elevSmooth = new Map<string, number>();
  private prevButtons = 0;
  /** Predicted shots and blows the server has not confirmed yet: its `shot` event for them is a duplicate of what is already on screen. */
  private pendingShots = 0;
  private pendingBlows = 0;
  private localReadyAt = 0;
  private lastCooldown = 0.5;
  /** D-041, as the server does: a squeeze made while the gun was not ready, kept while the trigger stays held, and the weapon the server last showed in hand (its change starts a draw). */
  private triggerPending = false;
  private drawnWire = 0;
  private bloom = 0;
  private lastReload = 0;
  private aimYaw = 0;
  private aimElev = 0;
  private aimDist = 100;
  private aimSeen = false;
  private time = 0;
  private lastPromptCannon: CannonStateType | undefined;

  constructor(
    private readonly stage: Stage,
    private readonly session: Session,
    private readonly controls: Controls,
    private readonly rig: CameraRig,
    private readonly actors: () => Map<string, ActorLike>,
    hudRoot: HTMLElement,
  ) {
    this.fx = new ShotFx(stage.scene, (x, z) => session.world.terrainHeight(x, z), FX_SCALE[getGfx()]);
    this.projectiles = new Projectiles(stage.scene, session.world, this.fx);
    // a round that goes by your head: hairline streaks (ShotFx.nearMiss) and a small flick of the lens, scaled by your shake setting
    this.fx.onNearMiss = (k) => this.rig.addShake(0.16 * k);
    this.hud = new CombatHud(hudRoot);
    const room = session.room;
    room.onMessage("shot", (e: ShotEvent) => this.onShot(e));
    room.onMessage("impact", (e: ImpactEvent) => this.onImpact(e));
    room.onMessage("boom", (e: BoomEvent) => this.onBoom(e));
    room.onMessage("hitmark", (e: HitMarkEvent) => {
      this.hud.hitMarker(e.zone, e.down, e.sever);
      if (e.down) this.actors().get(this.session.sessionId)?.body.cue("triumph", 2.2); // (D-084: you grin over the one you dropped)
      this.controls.rumble("hit", e.down ? 1 : 0.6);
    });
  }

  /** The region changed (sailing, or the bridge fell): rounds stop at the new ground. */
  setWorld(): void {
    this.projectiles.setWorld(this.session.world);
  }

  /** The graphics preset changed: fewer or more puffs from now on. */
  setPreset(): void {
    this.fx.scale = FX_SCALE[getGfx()];
  }

  // ---- state helpers -------------------------------------------------------------------------------------------------------------------------

  private get me(): PlayerStateType | undefined {
    return this.session.local;
  }

  private get predicted(): PlayerStateType | undefined {
    return this.session.predicted ?? this.session.local;
  }

  /** The weapon the player wants, if they own it (else none): the input sends this and the body is drawn with it at once. */
  private get wish(): number {
    const w = this.controls.weaponWish;
    const me = this.me;
    if (w < 0 || !me) return -1;
    return ((me.weapons ?? 0) & (1 << w)) !== 0 ? w : -1;
  }

  /** 0..1 how much a blast lately and nearby has sooted the air at (x, z): the nearest blast of the last 45 s, fading with distance (14 m) and with age. */
  blastNear(x: number, z: number): number {
    let k = 0;
    for (let i = 0; i < this.blasts.length; i += 3) {
      const age = this.time - this.blasts[i + 2]!;
      if (age > 45) continue;
      const d = Math.hypot(x - this.blasts[i]!, z - this.blasts[i + 1]!);
      k = Math.max(k, (1 - d / 14) * (1 - age / 45));
    }
    return k > 0 ? k : 0;
  }

  /** The weapon the player wants in hand (a `WEAPON` id) or -1: what the first-person viewmodel draws. */
  get wishWeapon(): number {
    return this.wish;
  }

  private eyeHeight(flags: number): number {
    return (flags & FLAG.CROUCHING) !== 0 ? COMBAT.eyeHeightCrouch : COMBAT.eyeHeight;
  }

  /** What the body should draw for a player: their weapon, its elevation, the reload. The local body shows its wish at once. */
  actorCombat(id: string, p: PlayerStateType, isMe: boolean, dt: number): ActorCombat {
    let weapon = p.weapon ?? 0;
    let elev = (p.aim ?? 0) / 80;
    if (isMe) {
      const w = this.wish;
      weapon = w < 0 ? 0 : w + 1;
      elev = this.aimElev;
    } else {
      const prev = this.elevSmooth.get(id) ?? elev;
      elev = prev + (elev - prev) * (1 - Math.exp(-dt * 14));
      this.elevSmooth.set(id, elev);
    }
    return { weapon, elev, reload: p.reload ?? 0, carried: carriedOf(p.weapons ?? 0) };
  }

  // ---- aim ----------------------------------------------------------------------------------------------------------------------------------

  /** The yaw of the aim ray (where the shot leaves the eye: `aimSolve` against the crosshair), or undefined before the first frame has solved one. The local body is drawn turned to it while aiming (`CharacterActor.setAimYaw`). */
  get aimHeading(): number | undefined {
    return this.aimSeen ? this.aimYaw : undefined;
  }


  /**
   * Finds what the crosshair is on (the first solid or body along the ray through the middle of the picture) and solves the shot from the player's own eye through that point
   * (`aimSolve`, input/aim.ts): what is under the crosshair is what the round meets at any range, in third person (the camera sits beside the head) and in first. Call once a frame, before
   * the input steps. The result is kept inside the server's yaw slack around the CURRENT view yaw, so the server never has to clamp it.
   */
  beginFrame(): void {
    const me = this.predicted;
    if (!me) return;
    this.rig.crosshairRay(rayO, rayD);
    const selfId = this.session.sessionId;
    let n = 0;
    this.session.room.state.players.forEach((p, id) => {
      if (id === selfId || (p.flags & FLAG.DOWNED) !== 0) return;
      const pose = (rayBodies[n] ??= { x: 0, y: 0, z: 0, facing: 0, flags: 0 });
      pose.x = this.session.value(p, "x");
      pose.y = this.session.value(p, "y");
      pose.z = this.session.value(p, "z");
      pose.facing = this.session.value(p, "facing");
      pose.flags = p.flags;
      n++;
    });
    rayBodies.length = n;
    const t = crosshairDistance(this.session.world, rayO, rayD, rayBodies, 260, 0.03);
    tmp.set(this.session.value(me, "x"), this.session.value(me, "y") + this.eyeHeight(me.flags), this.session.value(me, "z"));
    const s = aimSolve(tmp, rayO, rayD, t);
    const off = wrapAngle(s.yaw - this.rig.yaw);
    const max = COMBAT.aimYawSlack * 0.98;
    this.aimYaw = Math.abs(off) > max ? wrapAngle(this.rig.yaw + Math.sign(off) * max) : s.yaw;
    this.aimElev = s.elev;
    this.aimDist = Math.hypot(s.point.x - tmp.x, s.point.y - tmp.y, s.point.z - tmp.z);
    this.aimSeen = true;
  }

  // ---- input --------------------------------------------------------------------------------------------------------------------------------

  /** Sends one input step, with the aim and the weapon wish, and shows the predicted picture of any trigger pull it contains. */
  sendInput(it: Intent, yaw: number): void {
    const aim = this.aimSeen ? { yaw: yawToWire(this.aimYaw), elev: elevToWire(this.aimElev), weapon: weaponToWire(this.wish as WeaponId | -1) } : { yaw, elev: 0, weapon: weaponToWire(this.wish as WeaponId | -1) };
    this.session.sendInput(it.moveF, it.moveR, yaw, it.buttons, aim);
    const pressed = it.buttons & ~this.prevButtons;
    this.prevButtons = it.buttons;
    const me = this.predicted;
    const mine = this.me;
    if (!me || !mine) return;
    const w = this.wish;
    const now = performance.now();
    // the server has put another weapon in hand: it is being drawn, and a squeeze now waits for it (Combat.handleSwitch)
    if (mine.weapon !== this.drawnWire) {
      this.drawnWire = mine.weapon;
      const drawn = mine.weapon > 0 ? WEAPONS[(mine.weapon - 1) as WeaponId] : undefined;
      if (drawn) this.localReadyAt = Math.max(this.localReadyAt, now + Math.max(drawn.drawSeconds, COMBAT.switchSeconds) * 1000 * 0.94);
      this.triggerPending = false;
    }
    // (D-092: Use held at the crank gun makes the trigger the gun's from the first frame, before the server's OPERATING comes back: the hand weapon is never predicted)
    if (w < 0 || (me.flags & BUSY) !== 0 || ((it.buttons & BUTTON.INTERACT) !== 0 && this.lastPromptCannon?.kind === 1)) {
      this.triggerPending = false;
      return;
    }
    const def = WEAPONS[w as WeaponId];
    const melee = def.fire === "melee";
    if (melee || (it.buttons & BUTTON.FIRE) === 0) this.triggerPending = false;
    else if ((pressed & BUTTON.FIRE) !== 0 && now < this.localReadyAt) this.triggerPending = true;
    const trigger = melee ? (it.buttons & (BUTTON.FIRE | BUTTON.MELEE)) !== 0 : (pressed & BUTTON.FIRE) !== 0 || (this.triggerPending && now >= this.localReadyAt);
    if (trigger && mine.weapon === w + 1 && now >= this.localReadyAt) {
      this.triggerPending = false;
      if (melee) this.predictBlow(w, def.melee!.windup, def.melee!.cooldown, false);
      else if (def.ranged && (mine.ammo ?? 0) - this.pendingShots > 0 && (mine.reload ?? 0) === 0) this.predictShot(w, me);
    }
    if (!melee && (pressed & BUTTON.MELEE) !== 0 && now >= this.localReadyAt) this.predictBlow(w, def.melee?.windup ?? 0.2, def.melee?.cooldown ?? 0.9, true);
  }

  private predictBlow(w: number, windup: number, cooldown: number, bash: boolean): void {
    const id = this.session.sessionId;
    const a = this.actors().get(id);
    if (!a) return;
    this.localReadyAt = performance.now() + cooldown * 1000 * 0.94;
    this.lastCooldown = cooldown;
    this.pendingBlows++;
    a.body.swingWeapon(w, bash);
    this.viewmodel?.swing(windup, bash);
    // the whoosh at the start; the server's timing of the hit is its own
    sfx.sound("sabre_swing", this.eyeOf(this.predicted!, tmp), bash ? 0.6 : 0.9);
    void windup;
  }

  /** A handling sound at the local player's hands: `foley_<name>` when the audio is wired, else the old click. */
  private handle(name: "holster" | "draw" | "powder" | "ramrod" | "cock", me: PlayerStateType, volume: number): void {
    const e = this.eyeOf(me, tmp);
    if (this.audio) this.audio.foley(name, e.x, e.y, e.z, volume);
    else if (name !== "holster" && name !== "draw") sfx.sound("reload_click", e, volume);
  }

  private eyeOf(p: PlayerStateType, out: Vector3): Vector3 {
    return out.set(this.session.value(p, "x"), this.session.value(p, "y") + this.eyeHeight(p.flags), this.session.value(p, "z"));
  }

  private predictShot(w: number, me: PlayerStateType): void {
    const mine = this.me!;
    const def = WEAPONS[w as WeaponId];
    const r = def.ranged!;
    const a = this.actors().get(this.session.sessionId);
    if (!a) return;
    const speed = Math.hypot(this.session.value(me, "vx"), this.session.value(me, "vz"));
    const spread = spreadFor(r, { aiming: (me.flags & FLAG.AIMING) !== 0, speed, crouching: (me.flags & FLAG.CROUCHING) !== 0 });
    const seed = shotSeed(this.session.room.state.seed, mine.slot, ((mine.shots ?? 0) + this.pendingShots) & 255);
    this.pendingShots++;
    this.localReadyAt = performance.now() + r.cooldown * 1000 * 0.94;
    this.lastCooldown = r.cooldown;
    this.bloom = Math.min(0.06, this.bloom + r.recoil * 0.25);
    a.body.fireWeapon(w);
    this.viewmodel?.fire(w);
    const eye = this.eyeOf(me, tmp);
    this.showShot(w, seed, spread, eye.x, eye.y, eye.z, this.aimYaw, this.aimElev, a.body, true);
    // recoil as a picture: the lens kicks, a little shake; the aim itself is never moved
    this.rig.addKick(r.recoil * 0.55, (Math.random() - 0.5) * r.recoil * 0.25);
    this.rig.addShake(Math.min(0.6, r.recoil * 3));
    this.controls.rumble("shot", Math.min(1, 0.4 + r.recoil * 3));
  }

  // ---- shots (predicted and reported) ----------------------------------------------------------------------------------------------------------

  /**
   * Draws a discharge: sound, flash and smoke at the muzzle (or, if the shooter's weapon is not on screen, at the origin), and the path of every pellet
   * from the muzzle toward where the eye's ray will land (a tracer for a hitscan round, a flying ball for the rest).
   */
  private showShot(w: number, seed: number, spread: number, ox: number, oy: number, oz: number, yaw: number, elev: number, actor: CharacterActor | undefined, own: boolean): void {
    const def = WEAPONS[w as WeaponId];
    const r = def.ranged;
    if (!r) return;
    // your own shot in first person leaves the viewmodel's muzzle (where the gun is on the screen), not the hidden body's
    const vm = own && this.viewmodel?.active ? this.viewmodel : undefined;
    const fromVm = vm?.muzzleWorld(muzzle);
    const m = fromVm ?? actor?.muzzleWorld(muzzle);
    const mx = m ? m.x : ox;
    const my = m ? m.y - (m ? 0 : 0.2) : oy - 0.2;
    const mz = m ? m.z : oz;
    let dx: number;
    let dy: number;
    let dz: number;
    if (m && (fromVm || actor)) {
      if (fromVm) vm!.muzzleDirection(mdir);
      else actor!.muzzleDirection(mdir);
      dx = mdir.x;
      dy = mdir.y;
      dz = mdir.z;
    } else {
      aimDirection(yaw, elev, shotV);
      dx = shotV.x;
      dy = shotV.y;
      dz = shotV.z;
    }
    this.fx.muzzle(w, mx, my, mz, dx, dy, dz);
    sfx.sound(REPORT[w] ?? "pistol_shot", { x: mx, y: my, z: mz }, own ? 1 : undefined);
    for (let i = 0; i < r.pellets; i++) {
      shotDirection(yaw, elev, spread, seed, i, shotV);
      // where this pellet's ray from the eye ends: the world, or a convergence point ahead
      let t = Math.min(r.range, 60);
      if (rayWorld(this.session.world, ox, oy, oz, shotV.x, shotV.y, shotV.z, r.range, worldHit)) t = Math.min(worldHit.t, r.speed === 0 ? r.range : 60);
      else if (r.speed === 0) t = 200;
      const qx = ox + shotV.x * t;
      const qy = oy + shotV.y * t;
      const qz = oz + shotV.z * t;
      if (r.speed === 0) {
        this.fx.tracer(mx, my, mz, qx, qy, qz, w);
        if (!own) this.fx.nearMiss(mx, my, mz, qx, qy, qz);
      } else {
        const vx = qx - mx;
        const vy = qy - my;
        const vz = qz - mz;
        const l = Math.hypot(vx, vy, vz) || 1;
        this.projectiles.spawn(w, mx, my, mz, (vx / l) * r.speed, (vy / l) * r.speed, (vz / l) * r.speed);
      }
    }
  }

  private onShot(e: ShotEvent): void {
    const isMe = e.id === this.session.sessionId;
    if (e.id.startsWith("cannon:")) return e.w === WEAPON.CRANK ? this.onCrankShot(e) : this.onCannonShot(e);
    const actor = this.actors().get(e.id)?.body;
    actor?.cue("angry", 0.8); // (D-084: teeth set as the shot goes)
    if (e.m) {
      if (isMe && this.pendingBlows > 0) {
        this.pendingBlows--;
        return;
      }
      const bash = (WEAPONS[e.w as WeaponId]?.fire ?? "melee") !== "melee";
      actor?.swingWeapon(e.w, bash);
      sfx.sound("sabre_swing", { x: e.x, y: e.y, z: e.z }, bash ? 0.6 : 0.9);
      return;
    }
    if (isMe && this.pendingShots > 0) {
      this.pendingShots--;
      return;
    }
    actor?.fireWeapon(e.w);
    const yaw = Math.atan2(-e.dx, -e.dz);
    const elev = Math.asin(Math.max(-1, Math.min(1, e.dy)));
    this.showShot(e.w, e.seed, e.spread, e.x, e.y, e.z, yaw, elev, actor, isMe);
  }

  private onCannonShot(e: ShotEvent): void {
    const idx = e.id.slice(7);
    const view = this.cannons.get(idx);
    if (view) view.muzzle(muzzle, mdir);
    else muzzle.set(e.x, e.y, e.z), mdir.set(e.dx, e.dy, e.dz);
    this.fx.muzzle(WEAPON.CANNON, muzzle.x, muzzle.y, muzzle.z, mdir.x, mdir.y, mdir.z);
    this.audio?.blast("cannon", e.x, e.y, e.z);
    const r = WEAPONS[WEAPON.CANNON].ranged!;
    this.projectiles.spawn(WEAPON.CANNON, muzzle.x, muzzle.y, muzzle.z, e.dx * r.speed, e.dy * r.speed, e.dz * r.speed);
    if (!this.audio) sfx.sound("cannon_shot", { x: e.x, y: e.y, z: e.z });
    const d = Math.hypot(e.x - this.stage.camera.position.x, e.z - this.stage.camera.position.z);
    this.rig.addShake(Math.max(0, 1 - d / 70) * 0.9);
    this.controls.rumble("blast", Math.max(0, 1 - d / 70));
  }

  /**
   * D-092: a round from the crank gun: a small flash at the barrels' mouths, a tracer along the round's own line (the server's spread, from the event's seed, as
   * every hitscan is drawn), the report, and a little shake if it is close. Eight of these a second while the handle turns.
   */
  private onCrankShot(e: ShotEvent): void {
    const view = this.cannons.get(e.id.slice(7));
    if (view) view.muzzle(muzzle, mdir);
    else muzzle.set(e.x, e.y, e.z), mdir.set(e.dx, e.dy, e.dz);
    this.fx.muzzle(WEAPON.CRANK, muzzle.x, muzzle.y, muzzle.z, mdir.x, mdir.y, mdir.z);
    sfx.sound(REPORT[WEAPON.CRANK] ?? "pistol_shot", { x: muzzle.x, y: muzzle.y, z: muzzle.z });
    const r = WEAPONS[WEAPON.CRANK].ranged!;
    const yaw = Math.atan2(-e.dx, -e.dz);
    const elev = Math.asin(Math.max(-1, Math.min(1, e.dy)));
    shotDirection(yaw, elev, e.spread, e.seed, 0, shotV);
    let t = r.range;
    if (rayWorld(this.session.world, e.x, e.y, e.z, shotV.x, shotV.y, shotV.z, r.range, worldHit)) t = worldHit.t;
    this.fx.tracer(muzzle.x, muzzle.y, muzzle.z, e.x + shotV.x * t, e.y + shotV.y * t, e.z + shotV.z * t, WEAPON.CRANK);
    const d = Math.hypot(e.x - this.stage.camera.position.x, e.z - this.stage.camera.position.z);
    this.rig.addShake(Math.max(0, 1 - d / 25) * 0.08);
  }

  private onImpact(e: ImpactEvent): void {
    this.fx.impact(e.s as never, e.x, e.y, e.z, e.nx, e.ny, e.nz, e.w);
    if (this.audio) this.audio.impact(MATERIAL[e.s] ?? "earth", e.x, e.y, e.z, WEAPON_POWER[e.w] ?? 0.5); // splinter, chip, ring, thud or the wet blow (the Gore setting picks its version)
    else sfx.sound(IMPACT_SOUND[e.s] ?? "impact_earth", { x: e.x, y: e.y, z: e.z }, e.w === WEAPON.CANNON ? 1 : 0.8);
    void SURFACE;
  }

  private onBoom(e: BoomEvent): void {
    this.fx.explosion(e.x, e.y, e.z, e.radius);
    // D-084: everyone in earshot starts and looks at it
    for (const a of this.actors().values()) {
      const p = a.body.root.position;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d > 0.5 && d < 16) {
        a.body.cue("surprise", 1.3);
        a.body.lookAt(e.x, e.z, 2.6);
      }
    }
    this.stage.decals.blast(e.x, e.z, Math.max(0.9, e.radius * 0.55)); // the scorch stays on the field (it is the first thing the battlefield's aftermath is made of)
    if (this.audio) this.audio.blast("explosion", e.x, e.y, e.z);
    else sfx.sound("explosion", { x: e.x, y: e.y, z: e.z });
    this.blasts.push(e.x, e.z, this.time);
    if (this.blasts.length > 24) this.blasts.splice(0, 3);
    this.onBlast?.(e.x, e.z, e.radius);
    const d = Math.hypot(e.x - this.stage.camera.position.x, e.z - this.stage.camera.position.z);
    this.controls.rumble("blast", Math.max(0.15, 1 - d / (e.radius * 8)));
    this.rig.addShake(Math.max(0, 1 - d / (e.radius * 8)) * 0.95);
    this.rig.addKick(Math.max(0, 1 - d / (e.radius * 6)) * 0.03);
  }

  /** D-097: the bridge's fall, as the span's pieces land (seconds from now, where, into water or not): a splash or a burst of rubble each, on the shared timetable. */
  private readonly landings: { t: number; x: number; y: number; z: number; water: boolean; size: number; blast?: boolean }[] = [];

  /**
   * D-097: the bridge has gone (the charge's own blast came as a `boom`). Over it: the long dust of a span coming down, the sound of it going into the gorge, a heavier shake than
   * any keg, and each piece's landing when it lands.
   */
  bridgeFell(x: number, y: number, z: number, spanW: number, spanL: number, landings: readonly { at: number; x: number; y: number; z: number; water: boolean; size: number }[]): void {
    this.fx.collapseDust(x, y, z, spanW, spanL);
    sfx.sound("bridge_collapse", { x, y, z });
    // the span's masonry blows out along it a beat after the charge: two more bursts, either side of the mid-span, as the arches go
    this.landings.push({ t: this.time + 0.12, x, y: y + 1.2, z: z - spanL * 0.22, water: false, size: 7, blast: true }, { t: this.time + 0.3, x, y: y + 1.2, z: z + spanL * 0.22, water: false, size: 7, blast: true });
    for (const l of landings) this.landings.push({ t: this.time + l.at, x: l.x, y: l.y, z: l.z, water: l.water, size: l.size });
    const d = Math.hypot(x - this.stage.camera.position.x, z - this.stage.camera.position.z);
    this.rig.addShake(Math.max(0.25, 1 - d / 90));
    this.controls.rumble("blast", Math.max(0.3, 1 - d / 90));
  }

  /** The local player was hit: a bearing mark pointing at where it came from (the blow's push direction reversed, relative to the view). */
  onHit(e: HitEvent): void {
    if (e.id !== this.session.sessionId) return;
    this.controls.rumble("hurt", Math.min(1, 0.4 + e.power));
    // the push direction (dx, dz) points away from the attacker; the attacker is at -(dx, dz). Bearing relative to the camera yaw.
    const from = Math.atan2(e.dx, e.dz); // world heading of the direction TO the attacker, in the same yaw convention as the camera (0 = -Z)
    let rel = from - this.rig.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.hud.damageFrom(-rel, e.power); // (a positive yaw difference is to the LEFT of the view; the mark's rotation is clockwise)
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------------------------------

  update(dt: number, gamepad: boolean): void {
    this.time += dt;
    for (let i = this.landings.length - 1; i >= 0; i--) {
      const l = this.landings[i]!;
      if (this.time < l.t) continue;
      if (l.blast) this.fx.explosion(l.x, l.y, l.z, l.size);
      else if (l.water) this.fx.splash(l.x, l.y, l.z, l.size);
      else this.fx.rubble(l.x, l.y, l.z, l.size);
      this.landings.splice(i, 1);
    }
    const cam = this.stage.camera.position;
    this.fx.listener.x = cam.x;
    this.fx.listener.y = cam.y;
    this.fx.listener.z = cam.z;
    this.fx.listener.valid = true;
    this.bloom = Math.max(0, this.bloom - dt * 0.09);
    // cannons: create views for the replicated fixtures, follow their state
    this.session.room.state.cannons?.forEach((st, id) => {
      let v = this.cannons.get(id);
      if (!v) {
        v = st.kind === 1 ? new CrankGunView(this.stage.scene, this.stage.outlines) : new CannonView(this.stage.scene, this.fx, this.stage.outlines);
        this.cannons.set(id, v);
      }
      v.update(dt, st);
    });
    // a region without the field gun (Kessar Reach): its views go with it
    if (this.cannons.size > (this.session.room.state.cannons?.size ?? 0)) {
      for (const [id, v] of this.cannons) {
        if (!this.session.room.state.cannons?.has(id)) {
          v.dispose();
          this.cannons.delete(id);
        }
      }
    }
    this.projectiles.update(dt);
    this.fx.update(dt);
    this.hud.tick(dt);

    const mine = this.me;
    const me = this.predicted;
    if (!mine || !me) {
      // no local row (a rejoin in flight): the sight and the cannon's card must not stand frozen from the last frame
      this.hud.updateSight({ visible: false, gap: 0, aiming: false });
      this.hud.updateCannon(undefined);
      this.lastPromptCannon = undefined;
      return;
    }
    const w = this.wish;
    const def = w >= 0 ? WEAPONS[w as WeaponId] : undefined;
    const busy = (me.flags & BUSY) !== 0;
    const now = performance.now();
    const wait = now < this.localReadyAt && this.lastCooldown > 0 ? (this.localReadyAt - now) / (this.lastCooldown * 1000) : 0;
    const shown = mine.weapon === w + 1 ? w : mine.weapon > 0 ? mine.weapon - 1 : -1;
    this.hud.updateArms({
      weapon: w >= 0 ? w : shown,
      owned: mine.weapons ?? 0,
      ammo: mine.weapon === w + 1 ? (mine.ammo ?? 0) : 0,
      reserve: mine.weapon === w + 1 ? (mine.reserve ?? 0) : 0,
      reload: mine.reload ?? 0,
      wait: Math.min(1, wait),
      gamepad,
      busy,
    });
    // handling sounds: the draw and the holster as the wish changes, then the powder, the ram halfway and the cock when the piece is charged (the plain click without the audio)
    if (w !== this.lastWish) {
      if (this.lastWish !== -2) this.handle(w < 0 ? "holster" : "draw", me, 0.8);
      this.lastWish = w;
    }
    const rl = mine.reload ?? 0;
    if (rl > 0 && this.lastReload === 0) this.handle("powder", me, 1);
    if (rl >= 45 && this.lastReload < 45 && rl > 0) this.handle("ramrod", me, 0.8);
    if (rl === 0 && this.lastReload >= 50) this.handle("cock", me, 1);
    this.lastReload = rl;
    // the sight
    const r = def?.ranged;
    const armed = !!r && def!.id !== WEAPON.CANNON && !busy;
    let gap = 8;
    if (armed && r) {
      const speed = Math.hypot(this.session.value(me, "vx"), this.session.value(me, "vz"));
      const spread = spreadFor(r, { aiming: (me.flags & FLAG.AIMING) !== 0, speed, crouching: (me.flags & FLAG.CROUCHING) !== 0 }) + this.bloom;
      gap = reticleRadiusPx(spread, this.stage.camera.fov, window.innerHeight, (me.flags & FLAG.AIMING) !== 0); // the circle IS the spread cone, projected (and a dot when aimed and still)
    }
    this.hud.updateSight({ visible: armed || (!!def && def.fire === "melee" && !busy), gap: armed ? gap : 6, aiming: (me.flags & FLAG.AIMING) !== 0 });
    // the cannon card: when standing at a gun
    const c = this.cannonInReach(me);
    this.lastPromptCannon = c;
    this.hud.updateCannon(c ? { kind: c.kind, phase: c.phase, progress: c.progress, crew: c.crew, shells: c.shells, mine: (me.flags & FLAG.OPERATING) !== 0 } : undefined);
  }

  /** A firearm (not a blade, not bare hands) is wanted in hand and the body can use it: the follow camera takes its "ready" view (D-040). */
  get firearmReady(): boolean {
    const w = this.wish;
    const me = this.predicted;
    if (w < 0 || !me || (me.flags & (FLAG.DOWNED | FLAG.OPERATING)) !== 0) return false;
    const def = WEAPONS[w as WeaponId];
    return !!def && def.fire !== "melee";
  }

  /** True when the sight, not the first-person dot, is drawing the crosshair (the plain dot then stays hidden). */
  get sightShown(): boolean {
    const w = this.wish;
    const me = this.predicted;
    return w >= 0 && !!me && (me.flags & BUSY) === 0;
  }

  private cannonInReach(me: PlayerStateType): CannonStateType | undefined {
    let found: CannonStateType | undefined;
    this.session.room.state.cannons?.forEach((c) => {
      if (Math.hypot(this.session.value(me, "x") - c.x, this.session.value(me, "z") - c.z) <= (c.kind === 1 ? CRANK.crewRange : CANNON.crewRange) + 0.6) found = c;
    });
    return found;
  }

  /** Contextual prompt for a gun in reach (the game shows it when nothing else needs saying). */
  cannonPrompt(use: string): string {
    const c = this.lastPromptCannon;
    if (!c || (this.predicted && (this.predicted.flags & (FLAG.CARRYING | FLAG.DOWNED)) !== 0)) return "";
    if (c.kind === 1) {
      // D-092: the crank gun
      if (c.phase === CRANK_PHASE.READY) return `Hold ${use} and {fire}  Turn the crank gun's handle`;
      if (c.phase === CRANK_PHASE.CHANGING) return `Hold ${use}  Change the hopper (let go of {fire})`;
      if (c.phase === CRANK_PHASE.JAMMED) return `Hold ${use}  Clear the jam (let go of {fire})`;
      return "The crank gun is out of rounds";
    }
    if (c.phase === 0) return c.shells > 0 ? `Hold ${use}  Load the cannon` : "The limber is empty";
    if (c.phase === 1) return `Hold ${use}  Ram the charge home`;
    if (c.phase === 2) return `Hold ${use} and press {fire}  Light the fuse`;
    return "Stand clear!";
  }

  dispose(): void {
    this.fx.dispose();
    this.projectiles.dispose();
    this.hud.dispose();
    for (const v of this.cannons.values()) v.dispose();
    this.cannons.clear();
    void CARRIED;
  }
}
