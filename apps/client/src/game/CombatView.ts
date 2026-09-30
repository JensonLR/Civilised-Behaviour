import { Vector3 } from "three";
import {
  BUTTON,
  CANNON,
  CARRIED,
  COMBAT,
  FLAG,
  SURFACE,
  WEAPON,
  WEAPONS,
  aimDirection,
  bodyCentre,
  elevToWire,
  newBodyHit,
  newWorldHit,
  rayBody,
  rayWorld,
  shotDirection,
  shotSeed,
  spreadFor,
  weaponToWire,
  yawToWire,
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
import { ShotFx } from "../render/weapons/ShotFx.ts";
import { IMPACT_SOUND, REPORT, fx as sfx } from "../render/weapons/sfx.ts";
import { getBindings, keyLabel } from "../input/bindings.ts";
import { getGfx } from "../settings.ts";
import { CombatHud } from "../ui/CombatHud.ts";

/** Fewer or more effects by graphics preset. */
const FX_SCALE = { low: 0.5, medium: 1, high: 1.4 } as const;

const BUSY = FLAG.DOWNED | FLAG.CARRYING | FLAG.DRAGGING | FLAG.DRAGGED | FLAG.REVIVING | FLAG.OPERATING;

interface ActorLike {
  body: CharacterActor;
}

const tmp = new Vector3();
const muzzle = new Vector3();
const mdir = new Vector3();
const camDir = new Vector3();
const shotV = { x: 0, y: 0, z: 0 };
const worldHit = newWorldHit();
const bodyHit = newBodyHit();

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
  private readonly projectiles: Projectiles;
  private readonly hud: CombatHud;
  private readonly cannons = new Map<string, CannonView>();
  private readonly elevSmooth = new Map<string, number>();
  private prevButtons = 0;
  /** Predicted shots and blows the server has not confirmed yet: its `shot` event for them is a duplicate of what is already on screen. */
  private pendingShots = 0;
  private pendingBlows = 0;
  private localReadyAt = 0;
  private lastCooldown = 0.5;
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
    const world = session.world;
    this.fx = new ShotFx(stage.scene, (x, z) => world.terrainHeight(x, z), FX_SCALE[getGfx()]);
    this.projectiles = new Projectiles(stage.scene, world, this.fx);
    // a round that goes by your head: hairline streaks (ShotFx.nearMiss) and a small flick of the lens, scaled by your shake setting
    this.fx.onNearMiss = (k) => this.rig.addShake(0.16 * k);
    this.hud = new CombatHud(hudRoot);
    const room = session.room;
    room.onMessage("shot", (e: ShotEvent) => this.onShot(e));
    room.onMessage("impact", (e: ImpactEvent) => this.onImpact(e));
    room.onMessage("boom", (e: BoomEvent) => this.onBoom(e));
    room.onMessage("hitmark", (e: HitMarkEvent) => this.hud.hitMarker(e.zone, e.down, e.sever));
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
    return { weapon, elev, reload: p.reload ?? 0 };
  }

  // ---- aim ----------------------------------------------------------------------------------------------------------------------------------

  /** Finds what the crosshair is on (world, or a player) and the direction from the player's eye to it. Call once a frame, before the input steps. */
  beginFrame(): void {
    const me = this.predicted;
    if (!me) return;
    const cam = this.stage.camera;
    cam.getWorldDirection(camDir);
    const ox = cam.position.x;
    const oy = cam.position.y;
    const oz = cam.position.z;
    const range = 260;
    let t = range;
    if (rayWorld(this.session.world, ox, oy, oz, camDir.x, camDir.y, camDir.z, range, worldHit)) t = worldHit.t;
    const selfId = this.session.sessionId;
    this.session.room.state.players.forEach((p, id) => {
      if (id === selfId || (p.flags & FLAG.DOWNED) !== 0) return;
      const pose = { x: this.session.value(p, "x"), y: this.session.value(p, "y"), z: this.session.value(p, "z"), facing: this.session.value(p, "facing"), flags: p.flags };
      if (rayBody(pose, ox, oy, oz, camDir.x, camDir.y, camDir.z, t, 0.03, bodyHit) && bodyHit.t < t) t = bodyHit.t;
    });
    const px = ox + camDir.x * t;
    const py = oy + camDir.y * t;
    const pz = oz + camDir.z * t;
    const ex = this.session.value(me, "x");
    const ey = this.session.value(me, "y") + this.eyeHeight(me.flags);
    const ez = this.session.value(me, "z");
    const dx = px - ex;
    const dy = py - ey;
    const dz = pz - ez;
    const h = Math.hypot(dx, dz);
    if (h < 1.2) {
      // the point is at the player's feet (looking straight down, or against a wall): fall back to the camera's own direction
      this.aimYaw = Math.atan2(-camDir.x, -camDir.z);
      this.aimElev = Math.asin(Math.max(-1, Math.min(1, camDir.y)));
    } else {
      this.aimYaw = Math.atan2(-dx, -dz);
      this.aimElev = Math.atan2(dy, h);
    }
    this.aimDist = Math.hypot(dx, dy, dz);
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
    if (w < 0 || (me.flags & BUSY) !== 0) return;
    const def = WEAPONS[w as WeaponId];
    const now = performance.now();
    const melee = def.fire === "melee";
    const trigger = melee ? (it.buttons & (BUTTON.FIRE | BUTTON.MELEE)) !== 0 : (pressed & BUTTON.FIRE) !== 0;
    if (trigger && mine.weapon === w + 1 && now >= this.localReadyAt) {
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
    if (e.id.startsWith("cannon:")) return this.onCannonShot(e);
    const actor = this.actors().get(e.id)?.body;
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
    const r = WEAPONS[WEAPON.CANNON].ranged!;
    this.projectiles.spawn(WEAPON.CANNON, muzzle.x, muzzle.y, muzzle.z, e.dx * r.speed, e.dy * r.speed, e.dz * r.speed);
    sfx.sound("cannon_shot", { x: e.x, y: e.y, z: e.z });
    const d = Math.hypot(e.x - this.stage.camera.position.x, e.z - this.stage.camera.position.z);
    this.rig.addShake(Math.max(0, 1 - d / 70) * 0.9);
  }

  private onImpact(e: ImpactEvent): void {
    this.fx.impact(e.s as never, e.x, e.y, e.z, e.nx, e.ny, e.nz, e.w);
    const name = IMPACT_SOUND[e.s] ?? "impact_earth";
    sfx.sound(name, { x: e.x, y: e.y, z: e.z }, e.w === WEAPON.CANNON ? 1 : 0.8);
    void SURFACE;
  }

  private onBoom(e: BoomEvent): void {
    this.fx.explosion(e.x, e.y, e.z, e.radius);
    sfx.sound("explosion", { x: e.x, y: e.y, z: e.z });
    const d = Math.hypot(e.x - this.stage.camera.position.x, e.z - this.stage.camera.position.z);
    this.rig.addShake(Math.max(0, 1 - d / (e.radius * 8)) * 0.95);
    this.rig.addKick(Math.max(0, 1 - d / (e.radius * 6)) * 0.03);
  }

  /** The local player was hit: a bearing mark pointing at where it came from (the blow's push direction reversed, relative to the view). */
  onHit(e: HitEvent): void {
    if (e.id !== this.session.sessionId) return;
    // the push direction (dx, dz) points away from the attacker; the attacker is at -(dx, dz). Bearing relative to the camera yaw.
    const from = Math.atan2(e.dx, e.dz); // world heading of the direction TO the attacker, in the same yaw convention as the camera (0 = -Z)
    let rel = from - this.rig.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.hud.damageFrom(-rel, e.power); // (a positive yaw difference is to the LEFT of the view; the mark's rotation is clockwise)
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------------------------------

  update(dt: number, gamepad: boolean): void {
    this.time += dt;
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
        v = new CannonView(this.stage.scene, this.fx, this.stage.outlines);
        this.cannons.set(id, v);
      }
      v.update(dt, st);
    });
    this.projectiles.update(dt);
    this.fx.update(dt);
    this.hud.tick(dt);

    const mine = this.me;
    const me = this.predicted;
    if (!mine || !me) return;
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
      reloadKey: keyLabel(getBindings().reload[0]),
      busy,
    });
    // reload sounds: a click as it begins, the ram halfway, a click when the piece is charged
    const rl = mine.reload ?? 0;
    if (rl > 0 && this.lastReload === 0) sfx.sound("reload_click", this.eyeOf(me, tmp));
    if (rl >= 45 && this.lastReload < 45 && rl > 0) sfx.sound("reload_click", this.eyeOf(me, tmp), 0.8);
    if (rl === 0 && this.lastReload >= 50) sfx.sound("reload_click", this.eyeOf(me, tmp), 1);
    this.lastReload = rl;
    // the sight
    const r = def?.ranged;
    const armed = !!r && def!.id !== WEAPON.CANNON && !busy;
    let gap = 8;
    if (armed && r) {
      const speed = Math.hypot(this.session.value(me, "vx"), this.session.value(me, "vz"));
      const spread = spreadFor(r, { aiming: (me.flags & FLAG.AIMING) !== 0, speed, crouching: (me.flags & FLAG.CROUCHING) !== 0 }) + this.bloom;
      const fov = (this.stage.camera.fov * Math.PI) / 180;
      gap = (Math.tan(spread) * (window.innerHeight / 2)) / Math.tan(fov / 2);
    }
    this.hud.updateSight({ visible: armed || (!!def && def.fire === "melee" && !busy), gap: armed ? gap : 6, aiming: (me.flags & FLAG.AIMING) !== 0 });
    // the cannon card: when standing at a gun
    const c = this.cannonInReach(me);
    this.lastPromptCannon = c;
    this.hud.updateCannon(c ? { phase: c.phase, progress: c.progress, crew: c.crew, shells: c.shells, mine: (me.flags & FLAG.OPERATING) !== 0 } : undefined);
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
      if (Math.hypot(this.session.value(me, "x") - c.x, this.session.value(me, "z") - c.z) <= CANNON.crewRange + 0.6) found = c;
    });
    return found;
  }

  /** Contextual prompt for a gun in reach (the game shows it when nothing else needs saying). */
  cannonPrompt(use: string): string {
    const c = this.lastPromptCannon;
    if (!c || (this.predicted && (this.predicted.flags & (FLAG.CARRYING | FLAG.DOWNED)) !== 0)) return "";
    if (c.phase === 0) return c.shells > 0 ? `Hold ${use}  Load the cannon` : "The limber is empty";
    if (c.phase === 1) return `Hold ${use}  Ram the charge home`;
    if (c.phase === 2) return `Hold ${use} and press FIRE  Light the fuse`;
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
