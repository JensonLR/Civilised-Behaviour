import { Vector3 } from "three";
import { BUTTON, CASUALTY, COMMAND_IDS, FLAG, MOUNT, NPC, NPC_SIDE, NO_COMMAND, PROP_DEFS, ZONE, ZONE_NAMES, canCarry, findStation, generatePaper, hirePool, isRegionId, moraleBand, newCampaign, newParty, parseCampaign, parseParty, PropKind, newWorldHit, rayWorld, type CommandId, type CommandMsg, type PartyState, type CampaignState, type ParleyView, type RegionId, type ScenarioView, carryRefusal, createInjuryMods, dressableZone, findDownedTarget, findInteractTarget, findWoundedTarget, injuryMods, yawToWire, type HitEvent, type LimbId, type PlayerStateType, type SeverEvent, type PropKindId } from "@cb/shared";
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
import { MountView, type RiderPoseLike } from "../render/mounts/MountView.ts";
import { mountPrompt } from "../render/mounts/mountPrompt.ts";
import { PropViews } from "../render/PropViews.ts";
import type { Stage } from "../render/Stage.ts";
import { noteFolk } from "../render/world/villagers.ts";
import { DebugOverlay } from "../ui/DebugOverlay.ts";
import { CommandWheel, WHEEL_STAMPS } from "../ui/CommandWheel.ts";
import { Hud } from "../ui/Hud.ts";
import { LoadoutSheet } from "../ui/Loadout.ts";
import { MapRoom } from "../ui/MapRoom.ts";
import { NameTags } from "../ui/nameTags.ts";
import { NewspaperView } from "../ui/Newspaper.ts";
import { ObjectiveTracker } from "../ui/ObjectiveTracker.ts";
import { Parley } from "../ui/Parley.ts";
import { Sailing } from "../ui/Sailing.ts";
import { holdInput } from "../ui/modal.ts";
import { Session as NetSession } from "../net/Session.ts";
import { mapRoomView } from "./campaignView.ts";
import { CombatView } from "./CombatView.ts";

interface Actor {
  body: CharacterActor;
}

const tmp = new Vector3();
const eyeSample = newEyeSample();
/** Up to four walkers the grass bends away from (reused every frame). */
const walkers = [0, 1, 2, 3].map(() => ({ x: 0, z: 0 }));

const injuries = createInjuryMods();
const aimHit = newWorldHit();
const camDir = new Vector3();
/** Sides a hired hand may be sent at (never the party, never a bystander). */
const FOE_SIDES: ReadonlySet<string> = new Set(["ward", "rival", "outlaw"]);
const HAND_ROLES: ReadonlySet<number> = new Set([NPC.PORTER, NPC.HIRED_RIFLE, NPC.SURGEON]);

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
  /** Name plates: culled, never clamped (shared/nameTag.ts). */
  private readonly tags: NameTags;
  /** Horses and wagons: drawn from `WorldState.mounts`, a ridden horse from its rider's predicted state. */
  private readonly mountView: MountView;
  private readonly riderScratch: RiderPoseLike = { x: 0, y: 0, z: 0, facing: 0, vx: 0, vz: 0, vy: 0, flags: 0 };
  /** The supply manifest sheet (station "loadout") and the command wheel for the hired hands. */
  private readonly loadout: LoadoutSheet;
  private readonly wheel: CommandWheel;
  private partyRev = -1;
  private party: PartyState = newParty();
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
  // --- the campaign layer: map room, sailing, parley, the paper, the orders of the day ---
  private readonly mapRoom: MapRoom;
  private readonly sailing: Sailing;
  private readonly parley: Parley;
  private readonly paper: NewspaperView;
  private readonly tracker: ObjectiveTracker;
  private builtRegion: RegionId;
  private builtBridge: string;
  private building = false;
  /** `regionReady` has been sent for the landfall in progress (reset when the sailing machine leaves the arriving phase). */
  private arrivalSent = false;
  private sailRelease: (() => void) | undefined;
  private travelSig = "";
  private mapSig = "";
  private campaign: CampaignState | undefined;
  private campaignRev = -1;
  private scenarioRev = -1;
  private lastWorldMs = 0;
  private lastWorldPerf = 0;
  private trackerClock = 0;

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
    this.builtRegion = session.region;
    this.builtBridge = NetSession.bridgeOf(session.room.state.campaign);
    this.applySettings();
    this.offSettings = onSettingChange(() => this.applySettings());
    this.tagLayer = hud;
    this.props = new PropViews(stage.scene, stage.outlines);
    this.tags = new NameTags(hud);
    this.mountView = new MountView(stage.scene, { outline: stage.outlines });
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
    stage.buildWorld(session.world, session.region);
    this.loadRagdolls();
    this.mapRoom = new MapRoom(document.body);
    this.sailing = new Sailing(document.body);
    this.parley = new Parley(document.body);
    this.paper = new NewspaperView(document.body);
    this.tracker = new ObjectiveTracker(hud);
    this.loadout = new LoadoutSheet(document.body);
    this.wheel = new CommandWheel(document.body, (c) => this.sendCommand(c));
    controls.onCommand = (phase) => this.onCommandKey(phase);
    session.room.onMessage("station", (m: { kind?: string }) => {
      if (m?.kind === "map") this.openMap();
      else if (m?.kind === "paper") this.openPaper();
      else if (m?.kind === "loadout") this.openLoadout();
    });
    session.room.onMessage("parley", (m: { view?: ParleyView; line?: string; closed?: boolean }) => this.onParley(m));
    session.room.onMessage("hit", (e: HitEvent) => this.onHit(e));
    session.room.onMessage("sever", (e: SeverEvent) => this.onSever(e));

    session.room.onMessage("notice", (m: { text: string }) => {
      // The hands' answer to an order ("Obeyed." / "Refused. ...") is the wheel's own plain line, not a notice.
      if (/^(Obeyed|Refused)\b/.test(m.text)) this.wheel.setResult(m.text);
      else this.hud.showNotice(m.text);
      playSfx("notice");
    });
    session.room.onMessage("pong", (m: { t: number }) => {
      const rtt = performance.now() - m.t;
      session.rttMs = session.rttMs === 0 ? rtt : session.rttMs * 0.8 + rtt * 0.2;
    });
  }

  /** Loads (or reloads, after a region change) the ragdoll physics world for the ground the local player stands on. */
  private loadRagdolls(): void {
    const old = this.ragdolls;
    this.ragdolls = undefined;
    old?.dispose();
    RagdollWorld.create(this.session.world).then(
      (w) => {
        if (this.disposed || this.ragdolls) w.dispose();
        else this.ragdolls = w;
      },
      (err) => console.warn("ragdoll physics unavailable; knock-downs will use the plain fall animation", err),
    );
  }

  // ---- the campaign layer -----------------------------------------------------------------------------------------------------------------

  private get worldNowMs(): number {
    return this.lastWorldMs + (performance.now() - this.lastWorldPerf);
  }

  private openMap(): void {
    const st = this.session.room.state;
    const room = this.session.room;
    this.mapRoom.open(mapRoomView(st, this.campaign, this.session.local?.slot), {
      propose: (to) => room.send("travelPropose", { to }),
      ready: (on) => room.send("travelReady", { ready: on }),
      cancel: () => room.send("travelCancel", {}),
      close: () => {},
    });
  }

  // ---- the expedition: the manifest sheet, the hired hands, the command wheel -------------------------------------------------------------------

  private loadoutView(): Parameters<LoadoutSheet["open"]>[0] {
    const st = this.session.room.state;
    let humans = 0;
    st.players.forEach((p) => {
      if (!p.npc && p.connected) humans++;
    });
    return {
      loadout: this.party.loadout,
      purse: this.campaign?.purse ?? 0,
      humans,
      roster: this.party.roster,
      pool: hirePool(st.seed, this.campaign?.day ?? 0, this.party),
    };
  }

  private openLoadout(): void {
    const room = this.session.room;
    this.loadout.open(this.loadoutView(), {
      set: (loadout) => room.send("loadoutSet", { loadout }),
      hire: (id, on) => room.send("hire", { id, on }),
      confirm: () => this.hud.showNotice("Manifest filed. It is charged when the ship leaves, and not before."),
      close: () => {},
    });
  }

  /** Hired hands on the ground now, and which orders they can take (a porter is the only hand that fetches). */
  private hands(): { count: number; porter: boolean } {
    let count = 0;
    let porter = false;
    this.session.room.state.players.forEach((p) => {
      if (!HAND_ROLES.has(p.npc) || (p.flags & FLAG.DOWNED) !== 0) return;
      count++;
      if (p.npc === NPC.PORTER) porter = true;
    });
    return { count, porter };
  }

  private onCommandKey(phase: "down" | "up"): void {
    if (phase === "up") {
      this.wheel.release();
      this.controls.wheelOpen = this.wheel.isOpen;
      return;
    }
    if (this.wheel.isOpen || this.controls.blocked) return;
    const me = this.session.predicted;
    if (!me || (me.flags & FLAG.DOWNED) !== 0) return;
    const hands = this.hands();
    if (hands.count === 0) {
      this.hud.showNotice("There is nobody on the payroll to command. This is, for once, the Society's fault.");
      return;
    }
    this.wheel.setAvailable(WHEEL_STAMPS.map((s) => s.id).filter((id) => id !== "fetch" || hands.porter));
    this.wheel.open();
    this.controls.wheelOpen = true;
  }

  /** An order from the wheel: the point or the target comes from where the camera looks. The server re-checks everything (range, standing, targets). */
  private sendCommand(c: CommandId): void {
    const st = this.session.room.state;
    const me = this.session.predicted;
    if (!me) return;
    const msg: CommandMsg = { intent: c };
    const cam = this.stage.camera;
    cam.getWorldDirection(camDir);
    if (c === "hold") {
      const x = this.session.value(me, "x") - Math.sin(this.rig.yaw) * 8;
      const z = this.session.value(me, "z") - Math.cos(this.rig.yaw) * 8;
      msg.at = { x, z };
    } else if (c === "attack") {
      let best = 0.985;
      let id: string | undefined;
      st.players.forEach((p, key) => {
        const side = NPC_SIDE[p.npc];
        if (!p.npc || side === undefined || !FOE_SIDES.has(side) || (p.flags & FLAG.DOWNED) !== 0) return;
        const d = this.aim(p.x, p.y + 1.2, p.z, 60);
        if (d > best) {
          best = d;
          id = key;
        }
      });
      if (id === undefined) {
        this.hud.showNotice("Nobody in the sights to be attacked. The hands await a more specific grievance.");
        return;
      }
      msg.target = id;
    } else if (c === "fetch") {
      let best = 0.97;
      let id: string | undefined;
      st.props.forEach((p, key) => {
        if (p.holder !== "") return;
        const d = this.aim(p.x, p.y, p.z, 30);
        if (d > best) {
          best = d;
          id = key;
        }
      });
      if (id === undefined) {
        this.hud.showNotice("Nothing in the sights to fetch.");
        return;
      }
      msg.target = id;
    }
    this.session.room.send("command", msg);
  }

  /** How squarely the camera looks at a point (cosine of the angle off its axis; 0 when too far, behind, or behind a wall). */
  private aim(x: number, y: number, z: number, maxDist: number): number {
    const cam = this.stage.camera.position;
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5 || d > maxDist) return 0;
    const dot = (dx * camDir.x + dy * camDir.y + dz * camDir.z) / d;
    if (dot < 0.9) return 0;
    if (rayWorld(this.session.world, cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d - 0.6, aimHit)) return 0;
    return dot;
  }

  private riderPose = (sid: string): RiderPoseLike | undefined => {
    const p = this.session.room.state.players.get(sid);
    if (!p) return undefined;
    const r = this.riderScratch;
    const me = sid === this.session.sessionId;
    r.x = this.session.value(p, "x");
    r.y = this.session.value(p, "y");
    r.z = this.session.value(p, "z");
    r.facing = this.session.value(p, "facing");
    r.vx = this.session.value(p, "vx");
    r.vz = this.session.value(p, "vz");
    r.vy = this.session.value(p, "vy");
    r.flags = me ? (this.session.predicted?.flags ?? p.flags) : p.flags;
    return r;
  };

  private openPaper(): void {
    const c = this.campaign ?? newCampaign(this.session.room.state.seed);
    this.paper.show(generatePaper(c, this.session.room.state.seed), () => {});
  }

  private onParley(m: { view?: ParleyView; line?: string; closed?: boolean }): void {
    const room = this.session.room;
    if (m?.closed) {
      this.parley.closeUi();
      if (m.line) this.hud.showNotice(m.line);
      return;
    }
    if (!m?.view) return;
    if (this.parley.isOpen) this.parley.update(m.view);
    else this.parley.open(m.view, (i) => room.send("parleyPick", { option: i }), () => room.send("parleyClose", {}));
  }

  /** Follows the room's campaign fields: the sailing card, a new region or a fallen bridge (rebuild the world), the orders of the day, the map room. */
  private syncCampaign(now: number): void {
    const st = this.session.room.state;
    if (st.worldMs !== this.lastWorldMs) {
      this.lastWorldMs = st.worldMs ?? 0;
      this.lastWorldPerf = now;
    }
    if ((st.campaignRev ?? 0) !== this.campaignRev) {
      this.campaignRev = st.campaignRev ?? 0;
      this.campaign = st.campaign ? parseCampaign(st.campaign) : undefined;
      if (this.loadout.isOpen) this.loadout.update(this.loadoutView());
    }
    if ((st.partyRev ?? 0) !== this.partyRev) {
      this.partyRev = st.partyRev ?? 0;
      this.party = parseParty(st.party) ?? newParty();
      if (this.loadout.isOpen) this.loadout.update(this.loadoutView());
    }
    if ((st.scenarioRev ?? 0) !== this.scenarioRev) {
      this.scenarioRev = st.scenarioRev ?? 0;
      let view: ScenarioView | undefined;
      try {
        view = st.scenario ? (JSON.parse(st.scenario) as ScenarioView) : undefined;
      } catch {
        view = undefined;
      }
      this.tracker.update(view);
    }
    this.trackerClock -= 1;
    if (this.trackerClock <= 0) {
      this.trackerClock = 8; // (~4 Hz at 30 fps)
      this.tracker.tick(this.worldNowMs);
    }
    // the sailing: the card, the controls held off, the old sheets closed
    const phase = st.travelPhase ?? 0;
    const sig = `${phase}|${st.travelTo}|${Math.ceil(st.travelLeft ?? 0)}`;
    if (sig !== this.travelSig) {
      this.travelSig = sig;
      if (phase >= 2) {
        this.sailRelease ??= holdInput();
        this.parley.closeUi();
        this.paper.hide();
        this.loadout.closeUi();
        this.wheel.cancel();
        this.controls.wheelOpen = false;
        if (phase === 2) this.sailing.show(st.travelTo, st.travelLeft ?? 0);
        else this.sailing.arriving();
      } else if (this.sailRelease) {
        this.sailRelease();
        this.sailRelease = undefined;
        this.sailing.hide();
      }
    }
    // landfall (or a bridge that fell): the ground under us is a different one
    const bridge = NetSession.bridgeOf(st.campaign);
    const region = this.session.region;
    if (!this.building && (region !== this.builtRegion || bridge !== this.builtBridge)) void this.rebuildWorld();
    // a client that is already standing in the new region when the landing is announced (it joined or came back mid-landfall) has nothing to build: say so, or everyone waits out the timeout
    if (phase !== 3) this.arrivalSent = false;
    else if (!this.building && !this.arrivalSent && region === this.builtRegion && isRegionId(st.region)) this.sendArrival(st.region);
    // the map room follows the vote
    if (this.mapRoom.isOpen) {
      const v = mapRoomView(st, this.campaign, this.session.local?.slot);
      const msig = JSON.stringify([v.phase, v.to, v.ready, v.regions.map((r) => r.here)]);
      if (msig !== this.mapSig) {
        this.mapSig = msig;
        this.mapRoom.update(v);
      }
    }
  }

  private sendArrival(region: RegionId): void {
    this.arrivalSent = true;
    this.session.room.send("regionReady", { region });
  }

  /** New region or a fallen bridge: build the local world and scenery, link the shaders, then (if we were sailing) tell the server we are ashore. */
  private async rebuildWorld(): Promise<void> {
    this.building = true;
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let the card paint before the synchronous build
      const st = this.session.room.state;
      const region = this.session.region;
      const world = this.session.refreshWorld();
      this.rig.setWorld(world);
      this.combat.setWorld();
      this.stage.buildWorld(world, region);
      this.builtRegion = region;
      this.builtBridge = NetSession.bridgeOf(st.campaign);
      this.loadRagdolls();
      await this.stage.precompile();
      if ((st.travelPhase ?? 0) === 3 && isRegionId(st.region)) this.sendArrival(st.region);
    } finally {
      this.building = false;
    }
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
    this.sailRelease?.();
    this.sailRelease = undefined;
    this.mapRoom.dispose();
    this.sailing.dispose();
    this.parley.dispose();
    this.paper.dispose();
    this.tracker.dispose();
    this.loadout.dispose();
    this.wheel.dispose();
    this.tags.dispose();
    this.mountView.dispose();
    this.controls.onCommand = undefined;
    this.controls.wheelOpen = false;
  }

  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    const [lx, ly] = this.controls.drainLook(dt);
    this.controls.wheelOpen = this.wheel.isOpen;
    if (this.wheel.isOpen) {
      // while the command wheel is held the mouse (or the right stick) chooses a stamp, and the camera stays put
      if (this.controls.usingGamepad) this.wheel.stick(this.controls.padStick.x, this.controls.padStick.y);
      else this.wheel.nudge(lx, ly);
    } else this.rig.look(lx, ly);

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
    this.mountView.update(dt, this.session.room.state.mounts, this.riderPose);
    this.syncActors(dt);
    this.hitFx.update(dt);
    this.debris.update(dt);
    this.combat.update(dt, this.controls.usingGamepad);
    this.props.sync(this.session.room.state.props, (p, f) => this.session.predict.value(p as never, f as never));
    this.updatePrompt();
    this.syncCampaign(now);

    if (me) {
      tmp.set(this.session.value(me, "x"), this.session.value(me, "y"), this.session.value(me, "z"));
      setListener(tmp, this.rig.yaw);
      const pf = this.session.predicted;
      this.rig.mounted = pf !== undefined && (pf.flags & FLAG.MOUNTED) !== 0;
      this.rig.mountSpeed01 = pf ? Math.hypot(this.session.value(pf, "vx"), this.session.value(pf, "vz")) / MOUNT.gallop : 0;
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
    // horses and wagons (the same rules, in the same order, as the server's Mounts.onInteract)
    const mp = this.mountPromptNow(me, mine, flags);
    if ((flags & FLAG.MOUNTED) !== 0) {
      prompt = `${use}  ${mp ?? "Dismount"}`;
    } else if ((flags & FLAG.REVIVING) !== 0) {
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
      prompt = mp !== undefined ? `${use}  ${mp}     ${grab}  Let go` : `${grab}  Let go`;
    } else if ((flags & FLAG.CARRYING) !== 0 && mp !== undefined) {
      prompt = `${use}  ${mp}     ${throwKey}  Throw`;
    } else if ((flags & FLAG.CARRYING) !== 0) {
      // a barrel at the pier is a fuse waiting to be lit (the server checks the barrel and the range; this only says what the key will do)
      const spot = this.builtRegion === "kessar" ? findStation("kessar", this.session.value(me, "x"), this.session.value(me, "z"), me.facing) : undefined;
      const heldKind = this.heldKind();
      prompt = spot?.kind === "pier" && heldKind === PropKind.BARREL ? `${use}  Light the charge     ${throwKey}  Throw` : `${use}  Drop     ${throwKey}  Throw`;
    } else if ((flags & FLAG.DOWNED) === 0) {
      const downedId = findDownedTarget<string>(me, CASUALTY.reviveRange, (cb) =>
        players.forEach((o, id) => id !== this.session.sessionId && (o.flags & FLAG.DRAGGED) === 0 && cb(id, o)),
      );
      if (downedId !== undefined) {
        prompt = `Hold ${use}  Revive ${players.get(downedId)?.name ?? "comrade"}      ${grab}  Drag`;
      } else if (mp !== undefined) {
        prompt = `${use}  ${mp}`;
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
    if (prompt === "" && (flags & FLAG.DOWNED) === 0 && this.tracker.visibleOrders !== "resolved") {
      // the places you can USE: the map table, the notice board, the dock, the Warden (same shared table the server checks)
      const st = findStation(this.builtRegion, this.session.value(me, "x"), this.session.value(me, "z"), me.facing);
      if (st && st.kind !== "pier") prompt = `${use}  ${st.prompt}`;
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

  private mountPromptNow(me: NonNullable<Game["session"]["predicted"]>, mine: PlayerStateType, flags: number): string | undefined {
    const st = this.session.room.state;
    if (st.mounts.size === 0) return undefined;
    const rows: (readonly [string, Parameters<typeof mountPrompt>[1] extends Iterable<readonly [string, infer R]> ? R : never])[] = [];
    st.mounts.forEach((row, id) => rows.push([id, row]));
    return mountPrompt(
      { x: this.session.value(me, "x"), z: this.session.value(me, "z"), facing: me.facing, flags, missing: mine.missing, sessionId: this.session.sessionId, holding: (flags & FLAG.CARRYING) !== 0 },
      rows,
      {
        props: (wid) => {
          let n = 0;
          st.props.forEach((p) => {
            if (p.holder === `wagon:${wid}`) n++;
          });
          return n;
        },
        bodies: (wid) => {
          let n = 0;
          st.players.forEach((p) => {
            if (p.dragger === `wagon:${wid}`) n++;
          });
          return n;
        },
      },
    );
  }

  /** The kind of prop the local player is holding, if any. */
  private heldKind(): number | undefined {
    let kind: number | undefined;
    this.session.room.state.props.forEach((p) => {
      if (p.holder === this.session.sessionId) kind = p.kind;
    });
    return kind;
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
    this.mountView?.setOutline(this.stage.outlines);
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
      // a downed body strapped to a wagon's rack rides above the boards
      const y = this.session.value(p, "y") + this.mountView.bodyLift(p.dragger);
      const z = this.session.value(p, "z");
      if (walkerCount < walkers.length && !p.npc && (p.flags & FLAG.DOWNED) === 0) {
        walkers[walkerCount]!.x = x;
        walkers[walkerCount++]!.z = z;
      }
      this.audio.actor(id, isMe, dt, x, y, z, this.session.value(p, "vx"), this.session.value(p, "vy"), this.session.value(p, "vz"), flags);
      a.body.setLook(p.look);
      if (isMe) a.body.setFirstPerson(this.rig.headHidden, this.rig.yaw); // own head, never the others'
      a.body.update(
        dt,
        { x, y, z, facing: this.session.value(p, "facing"), vx: this.session.value(p, "vx"), vz: this.session.value(p, "vz"), flags, wounds: p.wounds, missing: p.missing, combat: this.combat.actorCombat(id, p, isMe, dt), ride: this.mountView.rideInput(id) },
        getGore(),
        getShowLimbs(),
      );
      if (!isMe) this.plate(id, p, a, x, y, z);
    });
    this.tags.sweep(seen);
    this.stage.setPushers(walkers, walkerCount);
    this.audio.sweep();
    const clock = this.session.room.state; // the server-owned world clock: every player sees the same hour and the same weather
    if (clock.worldMs !== undefined && clock.dayMinutes !== undefined) {
      this.stage.syncWorldClock(clock.seed, clock.worldMs, clock.dayStartHour, clock.dayMinutes);
      if (this.builtRegion === "hollowmere") noteFolk(clock.seed, clock.dayMinutes, this.tagLayer, this.stage.camera); // Hollowmere's folk: their seed, their hours, and where name tags and speech go
    }
    for (const [id, a] of this.actors) {
      if (!seen.has(id)) {
        this.removeActor(a);
        this.actors.delete(id);
      }
    }
  }

  /** One name plate: the shared rule says whether it can sit where it points (never clamped); hired hands carry their order and their nerve. */
  private plate(id: string, p: PlayerStateType, a: Actor, x: number, y: number, z: number): void {
    const down = (p.flags & FLAG.DOWNED) !== 0;
    let text = (p.connected ? p.name : `${p.name} (reconnecting)`) + (down ? " ✚ DOWN" : "");
    if (HAND_ROLES.has(p.npc) && !down) {
      const order = p.cmd < COMMAND_IDS.length ? COMMAND_IDS[p.cmd]! : "follow";
      text += ` · ${order} · ${moraleBand(p.morale)}`;
    }
    tmp.set(x, y + a.body.height + 0.55, z).project(this.stage.camera);
    const cam = this.stage.camera.position;
    const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const topPx = ((1 - tmp.y) / 2) * window.innerHeight;
    // a soldier's plate reaches farther while the camera can see him (a wall in between keeps it short)
    const inSight = p.npc !== 0 && dist <= 26 && !rayWorld(this.session.world, cam.x, cam.y, cam.z, (x - cam.x) / dist, (y + 1.2 - cam.y) / dist, (z - cam.z) / dist, dist - 0.6, aimHit);
    this.tags.update(id, text, p.npc, down, dist, tmp, topPx, inSight);
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
    return { body };
  }

  private removeActor(a: Actor): void {
    a.body.dispose();
  }
}
