import { Vector3 } from "three";
import { FLAG, PROP_DEFS, findInteractTarget, yawToWire, type PlayerStateType, type PropKindId } from "@cb/shared";
import type { Controls } from "../input/Controls.ts";
import type { Session } from "../net/Session.ts";
import { CameraRig } from "../render/CameraRig.ts";
import { CharacterActor } from "../render/CharacterActor.ts";
import { PropViews } from "../render/PropViews.ts";
import type { Stage } from "../render/Stage.ts";
import { DebugOverlay } from "../ui/DebugOverlay.ts";

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
  private readonly prompt: HTMLDivElement;
  private last = performance.now();
  private raf = 0;
  private running = false;
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
    this.prompt = document.createElement("div");
    this.prompt.className = "prompt";
    this.prompt.hidden = true;
    hud.appendChild(this.prompt);
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
    this.prompt.remove();
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

    this.syncActors(dt);
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

  /** Contextual prompt from the same shared rule the server enforces (the server still validates). */
  private updatePrompt(): void {
    const me = this.session.predicted;
    if (!me) return;
    const pad = this.controls.usingGamepad;
    let text = "";
    if ((me.flags & FLAG.CARRYING) !== 0) {
      text = `${pad ? "X" : "E"}  Drop     ${pad ? "LB" : "G"}  Throw`;
    } else {
      const id = findInteractTarget<string>(me, (cb) => this.session.room.state.props.forEach((p, k) => cb(k, p)));
      if (id !== undefined) {
        const kind = this.session.room.state.props.get(id)?.kind as PropKindId | undefined;
        text = `${pad ? "X" : "E"}  Pick up ${kind !== undefined ? PROP_DEFS[kind].name : "item"}`;
      }
    }
    this.prompt.hidden = text === "";
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
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
      const speed = Math.hypot(this.session.value(p, "vx"), this.session.value(p, "vz"));
      a.body.setLook(p.look);
      a.body.update(dt, x, y, z, this.session.value(p, "facing"), speed, flags);
      a.tag.textContent = p.connected ? p.name : `${p.name} (reconnecting)`;
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

  private addActor(p: PlayerStateType): Actor {
    const body = new CharacterActor(this.stage.scene, p.look, p.slot + 1);
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
