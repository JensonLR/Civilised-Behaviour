import { Vector3 } from "three";
import { BUTTON, CASUALTY, FLAG, PROP_DEFS, ZONE, ZONE_NAMES, canCarry, carryRefusal, createInjuryMods, dressableZone, findDownedTarget, findInteractTarget, findWoundedTarget, injuryMods, yawToWire, type HitEvent, type LimbId, type PlayerStateType, type SeverEvent, type PropKindId } from "@cb/shared";
import type { Controls } from "../input/Controls.ts";
import type { Session } from "../net/Session.ts";
import { CameraRig } from "../render/CameraRig.ts";
import { CharacterActor } from "../render/CharacterActor.ts";
import { newEyeSample } from "../render/firstPerson.ts";
import { HitFx } from "../render/HitFx.ts";
import { ViewModel, modeFor, type ViewModelFrame } from "../render/ViewModel.ts";
import { RagdollWorld } from "../render/Ragdoll.ts";
import { BASE_SENSITIVITY, effectiveShake, getFov, getGore, getHeadBob, getReduceMotion, getHoldToSprint, getInvertY, getPadSensitivity, getSensitivity, getShowLimbs, getView, onSettingChange, setView } from "../settings.ts";
import { playSfx, setListener } from "../audio/index.ts";
import { getBindings, keyLabel } from "../input/bindings.ts";
import { FIRST_PERSON } from "../render/firstPerson.ts";
import { GameAudio } from "./GameAudio.ts";
import { LimbDebris } from "../render/LimbDebris.ts";
import { PropViews } from "../render/PropViews.ts";
import type { Stage } from "../render/Stage.ts";
import { noteFolk } from "../render/world/villagers.ts";
import { DebugOverlay } from "../ui/DebugOverlay.ts";
import { Hud } from "../ui/Hud.ts";
import { CombatView } from "./CombatView.ts";

interface Actor {
  body: CharacterActor;
  tag: HTMLDivElement;
}

const tmp = new Vector3();
const eyeSample = newEyeSample();
/** Up to four walkers the grass bends away from (reused every frame). */
const walkers = [0, 1, 2, 3].map(() => ({ x: 0, z: 0 }));

const injuries = createInjuryMods();

/** Prompt for dressing a standing comrade's worst dressable wound. */
function dressPrompt(use: string, patient: PlayerStateType | undefined): string {
  const zone = patient ? dressableZone(patient.wounds, patient.missing) : -1;
  return `Hold ${use}  Dress ${patient?.name ?? "comrade"}'s ${zone >= 0 ? ZONE_NAMES[zone] : "wound"}`;
}

/** Frame orchestration: fixed-step input, prediction, remote interpolation, camera, render. */
export class Game {
  readonly rig: CameraRig;
  readonly overlay: DebugOverlay;
  private readonly actors = new Map<string, Actor>();
  private readonly tagLayer: HTMLElement;
  private readonly props: PropViews;
  private readonly hud: Hud;
  private readonly hitFx: HitFx;
  /** Weapons, shots, projectiles, impacts, the cannon and the gunnery interface (game/CombatView.ts). */
  private readonly combat: CombatView;
  private readonly debris: LimbDebris;
  /** The first-person hands and weapon, drawn as a second pass over the world (render/ViewModel.ts). */
  private readonly viewmodel: ViewModel;
  private readonly vmFrame: ViewModelFrame = {
    weapon: -1, aiming: false, sprinting: false, speed: 0, grounded: true, reload: 0, mode: 0, yaw: 0, pitch: 0, shown: false,
    look: undefined, gore: "full", wounds: 0, missing: 0, userFov: 65, motion: 1, bob: 1,
  };
  /** Loaded lazily (Rapier's WASM only ships once we are in a game); until then knock-downs use the plain fall animation. */
  private ragdolls: RagdollWorld | undefined;
  private last = performance.now();
  private raf = 0;
  private running = false;
  private disposed = false;
  private pingTimer = 0;
  private readonly audio: GameAudio;
  private readonly offSettings: () => void;

  constructor(
    private readonly stage: Stage,
    private readonly session: Session,
    private readonly controls: Controls,
    hud: HTMLElement,
    debugEl: HTMLElement,
  ) {
    this.rig = new CameraRig(stage.camera, session.world, { fov: 65, sensitivity: 0.0022, invertY: false, shake: 1, headBob: getHeadBob() ? 1 : 0 });
    this.rig.setView(getView(), true);
    this.controls.settings.sensitivity = this.rig.settings.sensitivity;
    this.audio = new GameAudio((x, z) => session.world.terrainHeight(x, z));
    this.applySettings();
    this.offSettings = onSettingChange(() => this.applySettings());
    this.tagLayer = hud;
    this.props = new PropViews(stage.scene, stage.outlines);
    this.hud = new Hud(hud);
    this.hitFx = new HitFx(stage.scene, (x, z) => session.world.terrainHeight(x, z));
    this.debris = new LimbDebris(stage.scene, (x, z) => session.world.terrainHeight(x, z));
    this.viewmodel = new ViewModel(stage);
    this.combat = new CombatView(stage, session, controls, this.rig, () => this.actors, hud);
    this.combat.viewmodel = this.viewmodel;
    this.overlay = new DebugOverlay(debugEl, {
      renderer: stage.renderer,
      players: () => session.room.state.players.size,
      rttMs: () => session.rttMs,
      extra: () => {
        const d = session.drift;
        return `props ${this.props.count}  drift ema ${d.ema.toFixed(3)} peak ${d.peak.toFixed(3)} m`;
      },
    });
    controls.onToggleDebug = () => this.overlay.toggle();
    controls.onToggleView = () => setView(this.rig.toggleView());
    stage.buildWorld(session.world);

    RagdollWorld.create(session.world).then(
      (w) => {
        if (this.disposed) w.dispose();
        else this.ragdolls = w;
      },
      (err) => console.warn("ragdoll physics unavailable; knock-downs will use the plain fall animation", err),
    );
    session.room.onMessage("hit", (e: HitEvent) => this.onHit(e));
    session.room.onMessage("sever", (e: SeverEvent) => this.onSever(e));

    session.room.onMessage("notice", (m: { text: string }) => {
      this.hud.showNotice(m.text);
      playSfx("notice");
    });
    session.room.onMessage("pong", (m: { t: number }) => {
      const rtt = performance.now() - m.t;
      session.rttMs = session.rttMs === 0 ? rtt : session.rttMs * 0.8 + rtt * 0.2;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const a of this.actors.values()) this.removeActor(a);
    this.actors.clear();
    this.props.dispose();
    this.controls.onToggleView = undefined;
    this.offSettings();
    this.audio.dispose();
    this.hud.dispose();
    this.combat.dispose();
    this.viewmodel.dispose();
    this.hitFx.dispose();
    this.debris.dispose();
    this.disposed = true;
    this.ragdolls?.dispose();
    this.ragdolls = undefined;
  }

  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    const [lx, ly] = this.controls.drainLook(dt);
    this.rig.look(lx, ly);

    const me = this.session.bindLocalPlayer();
    if (me) {
      const steps = this.session.tick(now);
      const yaw = yawToWire(this.rig.yaw);
      this.combat.beginFrame();
      for (let i = 0; i < steps; i++) {
        const it = this.controls.sample();
        this.combat.sendInput(it, yaw);
        if ((it.buttons & BUTTON.THROW) !== 0) this.audio.localThrow();
      }
    }

    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      this.session.room.send("ping", { t: performance.now() });
    }

    this.ragdolls?.step(dt);
    this.syncActors(dt);
    this.hitFx.update(dt);
    this.debris.update(dt);
    this.combat.update(dt, this.controls.usingGamepad);
    this.props.sync(this.session.room.state.props, (p, f) => this.session.predict.value(p as never, f as never));
    this.updatePrompt();

    if (me) {
      tmp.set(this.session.value(me, "x"), this.session.value(me, "y"), this.session.value(me, "z"));
      setListener(tmp, this.rig.yaw);
      const mine = this.rig.wantsEye ? this.actors.get(this.session.sessionId) : undefined;
      this.rig.update(tmp, dt, this.controls.aiming, mine?.body.sampleEye(eyeSample), ((this.session.predicted?.flags ?? 0) & FLAG.DOWNED) !== 0);
      this.stage.followShadow(tmp);
    }
    this.updateViewmodel(dt, me !== undefined);
    this.stage.renderer.info.reset(); // (two passes a frame: the overlay's counters cover both)
    this.stage.render();
    this.viewmodel.render();
    this.overlay.frame(dt);
  }

  /** Feeds the first-person hands and weapon (after the camera has been placed for this frame), and lets the body's own arms give way to them. */
  private updateViewmodel(dt: number, haveMe: boolean): void {
    const mine = this.session.local;
    const pred = this.session.predicted ?? mine;
    const actor = this.actors.get(this.session.sessionId);
    const vm = this.vmFrame;
    const flags = pred?.flags ?? 0;
    const body = actor?.body;
    // on your feet, in first person: the hands are yours and the weapon in them. Downed or tumbling, the body's own arms are what you see lying there.
    vm.shown = haveMe && !!mine && !!body && this.rig.headHidden && (flags & (FLAG.DOWNED | FLAG.DRAGGED)) === 0 && !body.ragdolled;
    if (mine && pred) {
      const w = this.combat.wishWeapon;
      vm.weapon = w;
      vm.aiming = (flags & FLAG.AIMING) !== 0;
      vm.sprinting = (flags & FLAG.SPRINTING) !== 0;
      vm.speed = Math.hypot(this.session.value(pred, "vx"), this.session.value(pred, "vz"));
      vm.grounded = (flags & FLAG.GROUNDED) !== 0;
      vm.reload = mine.weapon === w + 1 ? (mine.reload ?? 0) / 100 : 0;
      vm.mode = modeFor((flags & FLAG.CARRYING) !== 0, (flags & FLAG.REVIVING) !== 0, (flags & FLAG.DRAGGING) !== 0, (flags & FLAG.OPERATING) !== 0);
      vm.yaw = this.rig.yaw;
      vm.pitch = this.rig.pitch;
      vm.look = mine.look;
      vm.gore = getGore();
      vm.wounds = mine.wounds;
      vm.missing = getShowLimbs() ? mine.missing : 0;
    }
    vm.userFov = getFov();
    vm.motion = getReduceMotion() ? 0.3 : 1;
    vm.bob = getHeadBob() ? 1 : 0;
    if (vm.shown) this.viewmodel.update(dt, vm);
    else if (this.viewmodel.active) this.viewmodel.update(dt, vm); // (lowers out of view, then stops drawing)
    body?.setViewmodel(this.viewmodel.active);
  }

  /** HUD + contextual prompt, from the same shared rules the server enforces (the server still validates). */
  private updatePrompt(): void {
    const me = this.session.predicted;
    const mine = this.session.local;
    if (!me || !mine) return;
    const pad = this.controls.usingGamepad;
    // the keys as the player has bound them (a rebind in the settings changes the prompts at once); the pad's layout is fixed
    const keys = getBindings();
    const use = pad ? "X" : keyLabel(keys.interact[0]);
    const grab = pad ? "RB" : keyLabel(keys.grab[0]);
    const throwKey = pad ? "LB" : keyLabel(keys.throw[0]);
    const players = this.session.room.state.players;
    const flags = me.flags;
    let prompt = "";
    let byMe = -1;
    let patientName = "";
    let reviverName = "";
    let dressing = false;
    let patientId: string | undefined;

    if (mine.reviver) reviverName = players.get(mine.reviver)?.name ?? "";
    if ((flags & FLAG.REVIVING) !== 0) {
      // Find whoever I am reviving: the downed player whose reviver is me.
      players.forEach((o, id) => {
        if (o.reviver === this.session.sessionId) {
          byMe = o.reviveProgress;
          patientName = players.get(id)?.name ?? "";
          patientId = id;
        }
      });
      prompt = `Hold ${use}...`;
      dressing = patientId !== undefined && (players.get(patientId)!.flags & FLAG.DOWNED) === 0;
    } else if ((flags & FLAG.DRAGGING) !== 0) {
      prompt = `${grab}  Let go`;
    } else if ((flags & FLAG.CARRYING) !== 0) {
      prompt = `${use}  Drop     ${throwKey}  Throw`;
    } else if ((flags & FLAG.DOWNED) === 0) {
      const downedId = findDownedTarget<string>(me, CASUALTY.reviveRange, (cb) =>
        players.forEach((o, id) => id !== this.session.sessionId && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
      );
      if (downedId !== undefined) {
        prompt = `Hold ${use}  Revive ${players.get(downedId)?.name ?? "comrade"}      ${grab}  Drag`;
      } else {
        const id = findInteractTarget<string>(me, (cb) => this.session.room.state.props.forEach((p, k) => cb(k, p)));
        const woundedId = findWoundedTarget<string>(me, CASUALTY.reviveRange, (cb) =>
          players.forEach((o, pid) => pid !== this.session.sessionId && (o.flags & FLAG.DRAGGED) === 0 && cb(pid, o)),
        );
        if (id !== undefined) {
          const kind = this.session.room.state.props.get(id)?.kind as PropKindId | undefined;
          // Same shared rule the server enforces on the pickup (injury.ts), so the prompt never promises what the server will refuse.
          injuryMods(mine.wounds, mine.missing, (flags & FLAG.PEG_LEG) !== 0, injuries);
          if (kind !== undefined && !canCarry(injuries, PROP_DEFS[kind].mass)) prompt = woundedId === undefined ? carryRefusal(injuries) : dressPrompt(use, players.get(woundedId));
          else prompt = `${use}  Pick up ${kind !== undefined ? PROP_DEFS[kind].name : "item"}`;
        } else if (woundedId !== undefined) {
          prompt = dressPrompt(use, players.get(woundedId));
        }
      }
    }
    if (prompt === "" && (flags & FLAG.DOWNED) === 0) prompt = this.combat.cannonPrompt(use);
    const showLimbs = getShowLimbs();
    this.hud.update({
      flags,
      health: mine.health,
      reviveProgressOnMe: mine.reviveProgress,
      reviveProgressByMe: byMe,
      prompt,
      reviverName,
      patientName,
      dressing,
      usingGamepad: pad,
      firstPerson: this.rig.headHidden,
      armed: this.combat.sightShown,
      wounds: mine.wounds,
      missing: showLimbs ? mine.missing : 0,
      yaw: this.rig.yaw,
      x: this.session.value(me, "x"),
      z: this.session.value(me, "z"),
    });
    this.audio.revive(byMe >= 0 ? byMe : mine.reviveProgress > 0 ? mine.reviveProgress : -1);
  }

  /** Live settings (settings screen): camera, sensitivity, shake, head bob, sprint mode. Also called once at start. */
  private applySettings(): void {
    const s = this.rig.settings;
    const fov = getFov();
    s.fov = fov;
    s.firstPersonFov = FIRST_PERSON.fov + (fov - 65);
    s.sensitivity = BASE_SENSITIVITY * getSensitivity();
    s.invertY = getInvertY();
    s.shake = effectiveShake();
    s.headBob = getHeadBob() ? 1 : 0;
    this.controls.settings.sensitivity = s.sensitivity;
    this.controls.settings.padSensitivity = getPadSensitivity();
    this.controls.settings.holdToSprint = getHoldToSprint();
    if (this.rig.mode !== getView()) this.rig.setView(getView());
    // the graphics preset, live: effect density, and the ink line on the figures already standing in the scene
    this.combat?.setPreset();
    for (const a of this.actors.values()) a.body.setOutline(this.stage.outlines);
  }

  private syncActors(dt: number): void {
    const players = this.session.room.state.players;
    const seen = new Set<string>();
    let walkerCount = 0;
    players.forEach((p: PlayerStateType, id: string) => {
      seen.add(id);
      let a = this.actors.get(id);
      if (!a) {
        a = this.addActor(p);
        this.actors.set(id, a);
      }
      const isMe = id === this.session.sessionId;
      const flags = isMe ? (this.session.predicted?.flags ?? p.flags) : p.flags;
      const x = this.session.value(p, "x");
      const y = this.session.value(p, "y");
      const z = this.session.value(p, "z");
      if (walkerCount < walkers.length && (p.flags & FLAG.DOWNED) === 0) {
        walkers[walkerCount]!.x = x;
        walkers[walkerCount++]!.z = z;
      }
      this.audio.actor(id, isMe, dt, x, y, z, this.session.value(p, "vx"), this.session.value(p, "vy"), this.session.value(p, "vz"), flags);
      a.body.setLook(p.look);
      if (isMe) a.body.setFirstPerson(this.rig.headHidden, this.rig.yaw); // own head, never the others'
      a.body.update(
        dt,
        { x, y, z, facing: this.session.value(p, "facing"), vx: this.session.value(p, "vx"), vz: this.session.value(p, "vz"), flags, wounds: p.wounds, missing: p.missing, combat: this.combat.actorCombat(id, p, isMe, dt) },
        getGore(),
        getShowLimbs(),
      );
      const status = (p.flags & FLAG.DOWNED) !== 0 ? " ✚ DOWN" : "";
      a.tag.textContent = (p.connected ? p.name : `${p.name} (reconnecting)`) + status;
      tmp.set(x, y + a.body.height + 0.55, z).project(this.stage.camera);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2 && !isMe;
      a.tag.style.display = visible ? "block" : "none";
      if (visible) {
        a.tag.style.transform = `translate(-50%, -100%) translate(${((tmp.x + 1) / 2) * window.innerWidth}px, ${((1 - tmp.y) / 2) * window.innerHeight}px)`;
      }
    });
    this.stage.setPushers(walkers, walkerCount);
    this.audio.sweep();
    const clock = this.session.room.state; // the server-owned world clock: every player sees the same hour and the same weather
    if (clock.worldMs !== undefined && clock.dayMinutes !== undefined) {
      this.stage.syncWorldClock(clock.seed, clock.worldMs, clock.dayStartHour, clock.dayMinutes);
      noteFolk(clock.seed, clock.dayMinutes, this.tagLayer, this.stage.camera); // Hollowmere's folk: their seed, their hours, and where name tags and speech go
    }
    for (const [id, a] of this.actors) {
      if (!seen.has(id)) {
        this.removeActor(a);
        this.actors.delete(id);
      }
    }
  }

  /** A blow landed (server event, cosmetic): spray, flinch, maybe a ragdoll fall, and a camera jolt if it was me. */
  private onHit(e: HitEvent): void {
    const a = this.actors.get(e.id);
    const p = this.session.room.state.players.get(e.id);
    if (!a || !p) return;
    const h = a.body.height;
    const frac = e.zone === ZONE.HEAD ? 0.92 : e.zone === ZONE.TORSO ? 0.62 : e.zone === ZONE.ARM_L || e.zone === ZONE.ARM_R ? 0.6 : 0.3;
    this.hitFx.burst(this.session.value(p, "x"), this.session.value(p, "y") + h * frac, this.session.value(p, "z"), e.dx, e.dz, e.power, getGore());
    if (getGore() === "off") this.combat.fx.bodyDust(this.session.value(p, "x"), this.session.value(p, "y") + h * frac, this.session.value(p, "z"), e.dx, e.dz, e.power);
    this.audio.hurt(this.session.value(p, "x"), this.session.value(p, "y") + h * frac, this.session.value(p, "z"), p.look, e.power, e.id === this.session.sessionId);
    a.body.hit(e, a.body.facing); // the heading as drawn: in first person the local body turns with the camera
    if (e.id === this.session.sessionId) this.rig.addShake(0.25 + e.power * 0.5);
    this.combat.onHit(e);
  }

  /**
   * A limb came off. The authoritative fact is the victim's `missing` bit (rendered as a stump by the actor); this is the cosmetic
   * half: a copy of the limb flies off as debris, blood sprays from the joint, and the camera jolts if it was yours.
   * With the personal "severed limbs" setting hidden, nothing gory is shown - only the jolt.
   */
  private onSever(e: SeverEvent): void {
    const a = this.actors.get(e.id);
    if (e.id === this.session.sessionId) this.rig.addShake(0.6 + e.power * 0.4);
    const victim = this.session.room.state.players.get(e.id);
    if (victim) this.audio.sever(this.session.value(victim, "x"), this.session.value(victim, "y") + 1, this.session.value(victim, "z"));
    if (!a || !getShowLimbs()) return;
    const piece = a.body.detachLimb(e.limb as LimbId);
    if (!piece) return;
    const gore = getGore();
    this.hitFx.burst(piece.position.x, piece.position.y, piece.position.z, e.dx, e.dz, 1, gore);
    this.debris.spawn(piece, e.dx, e.dz, e.power, gore);
  }

  private addActor(p: PlayerStateType): Actor {
    const body = new CharacterActor(this.stage.scene, p.look, p.slot + 1, this.stage.outlines, () => this.ragdolls);
    const tag = document.createElement("div");
    tag.className = "nametag";
    this.tagLayer.appendChild(tag);
    return { body, tag };
  }

  private removeActor(a: Actor): void {
    a.body.dispose();
    a.tag.remove();
  }
}
