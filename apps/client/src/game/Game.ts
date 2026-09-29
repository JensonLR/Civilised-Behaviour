import { Vector3 } from "three";
import { CASUALTY, FLAG, PROP_DEFS, ZONE, findDownedTarget, findInteractTarget, yawToWire, type HitEvent, type LimbId, type PlayerStateType, type SeverEvent, type PropKindId } from "@cb/shared";
import type { Controls } from "../input/Controls.ts";
import type { Session } from "../net/Session.ts";
import { CameraRig } from "../render/CameraRig.ts";
import { CharacterActor } from "../render/CharacterActor.ts";
import { HitFx } from "../render/HitFx.ts";
import { RagdollWorld } from "../render/Ragdoll.ts";
import { getGore, getShowLimbs } from "../settings.ts";
import { LimbDebris } from "../render/LimbDebris.ts";
import { PropViews } from "../render/PropViews.ts";
import type { Stage } from "../render/Stage.ts";
import { DebugOverlay } from "../ui/DebugOverlay.ts";
import { Hud } from "../ui/Hud.ts";

interface Actor {
  body: CharacterActor;
  tag: HTMLDivElement;
}

const tmp = new Vector3();

/** Frame orchestration: fixed-step input, prediction, remote interpolation, camera, render. */
export class Game {
  readonly rig: CameraRig;
  readonly overlay: DebugOverlay;
  private readonly actors = new Map<string, Actor>();
  private readonly tagLayer: HTMLElement;
  private readonly props: PropViews;
  private readonly hud: Hud;
  private readonly hitFx: HitFx;
  private readonly debris: LimbDebris;
  /** Loaded lazily (Rapier's WASM only ships once we are in a game); until then knock-downs use the plain fall animation. */
  private ragdolls: RagdollWorld | undefined;
  private last = performance.now();
  private raf = 0;
  private running = false;
  private disposed = false;
  private pingTimer = 0;

  constructor(
    private readonly stage: Stage,
    private readonly session: Session,
    private readonly controls: Controls,
    hud: HTMLElement,
    debugEl: HTMLElement,
  ) {
    this.rig = new CameraRig(stage.camera, session.world, { fov: 65, sensitivity: 0.0022, invertY: false, shake: 1 });
    this.controls.settings.sensitivity = this.rig.settings.sensitivity;
    this.tagLayer = hud;
    this.props = new PropViews(stage.scene);
    this.hud = new Hud(hud);
    this.hitFx = new HitFx(stage.scene, (x, z) => session.world.terrainHeight(x, z));
    this.debris = new LimbDebris(stage.scene, (x, z) => session.world.terrainHeight(x, z));
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

    session.room.onMessage("notice", (m: { text: string }) => this.hud.showNotice(m.text));
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
    this.hud.dispose();
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
      for (let i = 0; i < steps; i++) {
        const it = this.controls.sample();
        this.session.sendInput(it.moveF, it.moveR, yaw, it.buttons);
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
    this.props.sync(this.session.room.state.props, (p, f) => this.session.predict.value(p as never, f as never));
    this.updatePrompt();

    if (me) {
      tmp.set(this.session.value(me, "x"), this.session.value(me, "y"), this.session.value(me, "z"));
      this.rig.update(tmp, dt, this.controls.aiming);
      this.stage.followShadow(tmp);
    }
    this.stage.render();
    this.overlay.frame(dt);
  }

  /** HUD + contextual prompt, from the same shared rules the server enforces (the server still validates). */
  private updatePrompt(): void {
    const me = this.session.predicted;
    const mine = this.session.local;
    if (!me || !mine) return;
    const pad = this.controls.usingGamepad;
    const use = pad ? "X" : "E";
    const grab = pad ? "RB" : "F";
    const players = this.session.room.state.players;
    const flags = me.flags;
    let prompt = "";
    let byMe = -1;
    let patientName = "";
    let reviverName = "";

    if (mine.reviver) reviverName = players.get(mine.reviver)?.name ?? "";
    if ((flags & FLAG.REVIVING) !== 0) {
      // Find whoever I am reviving: the downed player whose reviver is me.
      players.forEach((o, id) => {
        if (o.reviver === this.session.sessionId) {
          byMe = o.reviveProgress;
          patientName = players.get(id)?.name ?? "";
        }
      });
      prompt = `Hold ${use}...`;
    } else if ((flags & FLAG.DRAGGING) !== 0) {
      prompt = `${grab}  Let go`;
    } else if ((flags & FLAG.CARRYING) !== 0) {
      prompt = `${use}  Drop     ${pad ? "LB" : "G"}  Throw`;
    } else if ((flags & FLAG.DOWNED) === 0) {
      const downedId = findDownedTarget<string>(me, CASUALTY.reviveRange, (cb) =>
        players.forEach((o, id) => id !== this.session.sessionId && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
      );
      if (downedId !== undefined) {
        prompt = `Hold ${use}  Revive ${players.get(downedId)?.name ?? "comrade"}      ${grab}  Drag`;
      } else {
        const id = findInteractTarget<string>(me, (cb) => this.session.room.state.props.forEach((p, k) => cb(k, p)));
        if (id !== undefined) {
          const kind = this.session.room.state.props.get(id)?.kind as PropKindId | undefined;
          prompt = `${use}  Pick up ${kind !== undefined ? PROP_DEFS[kind].name : "item"}`;
        }
      }
    }
    const showLimbs = getShowLimbs();
    this.hud.update({
      flags,
      health: mine.health,
      reviveProgressOnMe: mine.reviveProgress,
      reviveProgressByMe: byMe,
      prompt,
      reviverName,
      patientName,
      usingGamepad: pad,
      wounds: mine.wounds,
      missing: showLimbs ? mine.missing : 0,
    });
  }

  private syncActors(dt: number): void {
    const players = this.session.room.state.players;
    const seen = new Set<string>();
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
      a.body.setLook(p.look);
      a.body.update(
        dt,
        { x, y, z, facing: this.session.value(p, "facing"), vx: this.session.value(p, "vx"), vz: this.session.value(p, "vz"), flags, wounds: p.wounds, missing: p.missing },
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
    const facing = this.session.value(p, "facing");
    const h = a.body.height;
    const frac = e.zone === ZONE.HEAD ? 0.92 : e.zone === ZONE.TORSO ? 0.62 : e.zone === ZONE.ARM_L || e.zone === ZONE.ARM_R ? 0.6 : 0.3;
    this.hitFx.burst(this.session.value(p, "x"), this.session.value(p, "y") + h * frac, this.session.value(p, "z"), e.dx, e.dz, e.power, getGore());
    a.body.hit(e, facing);
    if (e.id === this.session.sessionId) this.rig.addShake(0.25 + e.power * 0.5);
  }

  /**
   * A limb came off. The authoritative fact is the victim's `missing` bit (rendered as a stump by the actor); this is the cosmetic
   * half: a copy of the limb flies off as debris, blood sprays from the joint, and the camera jolts if it was yours.
   * With the personal "severed limbs" setting hidden, nothing gory is shown - only the jolt.
   */
  private onSever(e: SeverEvent): void {
    const a = this.actors.get(e.id);
    if (e.id === this.session.sessionId) this.rig.addShake(0.6 + e.power * 0.4);
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
