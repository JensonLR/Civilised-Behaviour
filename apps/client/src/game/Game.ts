import { Vector3 } from "three";
import { seedFromString } from "@cb/shared";
import { isDemo, wishlistLink } from "../platform/flags.ts";
import type { PlatformLink } from "../platform/PlatformLink.ts";
import { DemoBanner } from "../ui/DemoBanner.ts";
import { Wishlist } from "../ui/Wishlist.ts";
import { DEMO, FOUNDATION_CRATES, KESSAR_OUTPOST, STAGE_LABEL, audiencesAt, campaignMapOf, foundationStatus, historyPieces, mapPins, newPowers, newSettlements, parsePowers, parseSettlements, pickTemplate, powerEffects, powersDispatches, reachableRegions, regionDressOf, rivalPresence, rivalSighting, settlementDispatches, settlementNews, techEffects, templateNote, type CampaignMapData, type PowersState, type SettlementsState, BUTTON, CASUALTY, COMMAND_IDS, FLAG, MOUNT, NPC, NPC_SIDE, NO_COMMAND, PROP_DEFS, ZONE, ZONE_NAMES, canCarry, findStation, generatePaper, hirePool, isRegionId, moraleBand, newCampaign, newParty, parseCampaign, parseParty, PropKind, newWorldHit, rayWorld, type CommandId, type CommandMsg, type PartyState, type CampaignState, type ParleyView, type RegionId, type ScenarioView, carryRefusal, createInjuryMods, dressableZone, findDownedTarget, findInteractTarget, findWoundedTarget, injuryMods, yawToWire, type HitEvent, type LimbId, type PlayerStateType, type SeverEvent, type PropKindId, LEVEL_ADAPTERS, COMBAT, clamp, objectiveMark, regionMarks } from "@cb/shared";
import { AIM, assistLook, type AssistOut, type AssistTarget } from "../input/aim.ts";
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
import { regionSurface, surfaceAt } from "../audio/surface.ts";
import { newSignals, type MusicSignals } from "../audio/musicLayers.ts";
import { getAtmosphere } from "../render/world/atmosphere.ts";
import { Aftermath, planAftermath, type AftermathItem, type AftermathSite } from "../render/world/aftermath.ts";
import { BattleLedger } from "./battleLedger.ts";
import { MusicSignaller } from "./musicSignals.ts";
import { FIRST_PERSON } from "../render/firstPerson.ts";
import { GameAudio } from "./GameAudio.ts";
import { ContentAudio } from "./ContentAudio.ts";
import { LimbDebris } from "../render/LimbDebris.ts";
import { MountView, type RiderPoseLike } from "../render/mounts/MountView.ts";
import { Orientation } from "../ui/Orientation.ts";
import type { SheetKind } from "../ui/orientationLogic.ts";
import { PlateCache } from "./plates.ts";
import { MountPrompter } from "../render/mounts/mountPrompt.ts";
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
  /** Stable number for this body's drag trail in the decal field. */
  key: number;
  /** What the world is doing to this body (mud, a blast, rain, water): refreshed a few times a second, read every frame by the actor's `stepExposure`. */
  ground: { mud: number; blast: number; rain: number; washing: boolean };
  groundIn: number;
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
  private readonly mountPrompter: MountPrompter;
  /** The first-run orientation card (D-035, R): completed from state the frame already has, never modal. */
  private readonly orientation: Orientation;
  private readonly plates = new PlateCache(HAND_ROLES);
  /** Seconds of frame time, for the plates' ray cache. */
  private plateClock = 0;
  private readonly riderScratch: RiderPoseLike = { x: 0, y: 0, z: 0, facing: 0, vx: 0, vz: 0, vy: 0, flags: 0 };
  /** The supply manifest sheet (station "loadout") and the command wheel for the hired hands. */
  private readonly loadout: LoadoutSheet;
  private readonly wheel: CommandWheel;
  private partyRev = -1;
  private party: PartyState = newParty();
  private readonly props: PropViews;
  private readonly hud: Hud;
  private readonly hitFx: HitFx;
  /** The field remembers what a fight cost (game/battleLedger.ts) and the aftermath draws it (crows, hats, craters, crates, smoke): re-planned only when the ledger, the gore setting or the region changes. */
  private readonly ledger = new BattleLedger();
  private readonly aftermath: Aftermath;
  /** What the last plan was made from (three scalars, compared every frame: no string is built in the frame loop). */
  private aftermathFor = { region: "" as string, rev: -1, gore: "" as string };
  private aftermathSite: { key: string; site: AftermathSite } | undefined;
  /** The adaptive score hears the field through these (game/musicSignals.ts), once a frame. */
  private readonly signaller = new MusicSignaller();
  private readonly signals: MusicSignals;
  private readonly signalView = { rows: undefined as unknown as { forEach(cb: (row: never, id: string) => void): void }, me: "", x: 0, z: 0, region: "hollowmere" as RegionId, phase: "" as ScenarioView["phase"] | "", parley: false, frozen: false };
  private scenarioPhase: ScenarioView["phase"] | "" = "";
  /** Pad aim assist (D-038): the hostile rows it may pull toward, its output and how far it has already moved the aim from where the player pointed. */
  private readonly assistTargets: AssistTarget[] = [];
  private readonly assistOut: AssistOut = { dYaw: 0, dElev: 0, slow: 1, id: "" };
  private assistYaw = 0;
  private assistElev = 0;
  /** Is there something in reach the Use control would act on, and is it a hold (revive, dress, load)? Set by `updatePrompt`, read by the pad's Use/Reload split (input/Controls.ts). */
  private usable = false;
  private useHold = false;
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
  /** Hoofbeats, the sailing, the paper, the day bell and the gun crew, from replicated state only (D-035). */
  private readonly content = new ContentAudio({ outpostSite: () => KESSAR_OUTPOST.site });
  private readonly offSettings: () => void;
  // --- the campaign layer: map room, sailing, parley, the paper, the orders of the day ---
  private readonly mapRoom: MapRoom;
  private readonly sailing: Sailing;
  private readonly parley: Parley;
  private readonly paper: NewspaperView;
  private readonly tracker: ObjectiveTracker;
  private builtRegion: RegionId;
  /** The running contract's view (the tracker's), for the heading strip's objective flag. */
  private scenarioView: ScenarioView | undefined;
  private building = false;
  /** `regionReady` has been sent for the landfall in progress (reset when the sailing machine leaves the arriving phase). */
  private arrivalSent = false;
  private sailRelease: (() => void) | undefined;
  private travelSig = "";
  private mapSig = "";
  private campaign: CampaignState | undefined;
  private campaignRev = -1;
  /** D-035: the powers and the settlements, parsed from their JSON when their revision moves; and the identity of the collision world last built (bridge, outpost stage, telegraph). */
  private powers: PowersState | undefined;
  private powersRev = -1;
  private settlements: SettlementsState | undefined;
  private settlementsRev = -1;
  private builtKey: string;
  private campaignRevSeen = -2;
  private scenarioRev = -1;
  private lastWorldMs = 0;
  private lastWorldPerf = 0;
  private trackerClock = 0;
  /** D-036: the demo's countdown tag and the card it ends on (the SERVER enforces the session and closes the room with `DEMO.closeCode`; this only shows it), and the storefront seam. */
  private readonly demoBanner: DemoBanner | undefined;
  private wishlist: Wishlist | undefined;
  private presenceSig = "";

  constructor(
    private readonly stage: Stage,
    private readonly session: Session,
    private readonly controls: Controls,
    hud: HTMLElement,
    debugEl: HTMLElement,
    private readonly link?: PlatformLink,
  ) {
    this.rig = new CameraRig(stage.camera, session.world, { fov: 65, sensitivity: 0.0022, invertY: false, shake: 1, headBob: getHeadBob() ? 1 : 0 });
    this.rig.setView(getView(), true);
    this.controls.settings.sensitivity = this.rig.settings.sensitivity;
    this.audio = new GameAudio((x, z) => session.world.terrainHeight(x, z));
    this.signals = newSignals(session.region);
    this.builtRegion = session.region;
    this.builtKey = NetSession.worldKeyOf(session.room.state);
    this.applySettings();
    this.offSettings = onSettingChange(() => this.applySettings());
    // name plates and speech slips live in their own layer at the BOTTOM of the HUD, so every card (tracker, telegrams, orientation) covers them, never the reverse (D-040)
    this.tagLayer = document.createElement("div");
    this.tagLayer.className = "taglayer";
    hud.prepend(this.tagLayer);
    this.props = new PropViews(stage.scene, stage.outlines);
    this.tags = new NameTags(this.tagLayer);
    this.mountView = new MountView(stage.scene, { outline: stage.outlines });
    this.mountPrompter = new MountPrompter(session.room.state, () => session.sessionId);
    this.hud = new Hud(hud);
    this.hud.setCompass(regionMarks(this.builtRegion));
    this.hitFx = new HitFx(stage.scene, (x, z) => session.world.terrainHeight(x, z));
    this.hitFx.attachDecals(stage.decals); // blood stays, spreads and dries (render/decals), at the player's Gore level
    this.debris = new LimbDebris(stage.scene, (x, z) => session.world.terrainHeight(x, z));
    this.debris.onLand = (x, z, vx, vz) => {
      stage.decals.bloodPool(x, z, 0.28, 0.7);
      stage.decals.spatterAt(x, z, vx, vz, 0.32);
      this.audio.bloodOnGround(x, session.world.terrainHeight(x, z), z);
    };
    this.viewmodel = new ViewModel(stage);
    this.combat = new CombatView(stage, session, controls, this.rig, () => this.actors, hud);
    this.combat.viewmodel = this.viewmodel;
    this.combat.audio = this.audio;
    this.combat.onBlast = (x, z) => this.ledger.noteBlast(x, z);
    this.aftermath = new Aftermath(stage.scene, this.combat.fx, stage.decals, stage.outlines);
    controls.canInteract = () => this.usable;
    controls.holdInteract = () => this.useHold;
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
    stage.buildWorld(session.world, session.region, session.room.state.seed);
    this.loadRagdolls();
    this.mapRoom = new MapRoom(document.body);
    this.sailing = new Sailing(document.body);
    this.parley = new Parley(document.body);
    this.paper = new NewspaperView(document.body);
    this.tracker = new ObjectiveTracker(hud);
    this.orientation = new Orientation(hud, session.code); // (per campaign: the card is remembered under the join code, D-039)
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

    if (isDemo()) {
      this.demoBanner = new DemoBanner(document.body);
      session.room.onLeave((code) => {
        if (code === DEMO.closeCode) this.endDemo();
      });
    }
    session.room.onMessage("notice", (m: { text: string }) => {
      this.demoBanner?.notice(m.text); // (a demo warning re-synchronises the countdown to the server's; it is still shown as the telegram it is)
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

  /** The server closed the demo room: the licence has expired. The card is a Modal (Escape, pad B), and closing it returns to the front door. */
  endDemo(): void {
    if (this.wishlist) return;
    this.demoBanner?.hide();
    this.wishlist = new Wishlist({ url: wishlistLink(), onClose: () => location.assign(location.pathname) });
    this.wishlist.show();
  }

  /** Where the player is, as plain data for the storefront's presence line: only sent when something it shows changed. */
  private syncPresence(): void {
    if (!this.link) return;
    const st = this.session.room.state;
    const sig = `${st.region}|${st.travelPhase}|${st.partyRev}|${st.campaignRev}|${st.players.size}`;
    if (sig === this.presenceSig) return;
    this.presenceSig = sig;
    let party = 0;
    st.players.forEach((p) => {
      if (!p.npc && p.connected) party++;
    });
    const region = this.session.region;
    this.link.presence({ where: (st.travelPhase ?? 0) >= 2 ? "sailing" : region === "hollowmere" ? "hq" : "region", region, party: Math.max(1, party), day: this.campaign?.day ?? 0, joinCode: st.code });
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
    this.mapRoom.open(mapRoomView(st, this.campaign, this.session.local?.slot, this.campaignMapData(), this.presence()), {
      propose: (to) => room.send("travelPropose", { to }),
      ready: (on) => room.send("travelReady", { ready: on }),
      cancel: () => room.send("travelCancel", {}),
      close: () => {},
      audience: (power) => room.send("audienceOpen", { power }),
    });
  }

  /** What the Syndicate has in the field now (the contract on offer depends on it, here exactly as on the server). */
  private presence(): ReturnType<typeof rivalPresence> | undefined {
    return this.campaign ? rivalPresence(this.campaign, this.powers ?? newPowers(this.session.room.state.seed)) : undefined;
  }

  /** What the campaign map shows (shared `campaignMapOf`): outposts, the Syndicate's last sighting, the powers and who is asking for the party, the contract on offer, what is latched. */
  private campaignMapData(): CampaignMapData | undefined {
    const c = this.campaign;
    if (!c) return undefined;
    const st = this.session.room.state;
    const p = this.powers ?? newPowers(st.seed);
    const s = this.settlements ?? newSettlements();
    const intel = techEffects(s.tech).intelDays + powerEffects(p).intelDays;
    const asking = audiencesAt(c, p).map((a) => a.power);
    // the contract on offer in each place the party can sail to (the same pure rule the server runs on landfall; the hub has none)
    const presence = rivalPresence(c, p);
    const offers: Partial<Record<RegionId, { title: string; brief: string }>> = {};
    for (const id of reachableRegions()) {
      const offer = id === "hollowmere" ? undefined : pickTemplate(c, id, st.seed, presence);
      if (offer) offers[id] = templateNote(offer);
    }
    const here = isRegionId(st.region) ? st.region : "hollowmere";
    return campaignMapOf(c, s, rivalSighting(c, p, intel), mapPins(c, p, asking), offers, s.tech, here, p.rival.posts);
  }

  /** What HQ keeps of the campaign, and what is built in the field: pushed to the Stage whenever the ledger, the powers or the settlements move. */
  private applyCampaignVisuals(): void {
    const c = this.campaign;
    if (!c) return;
    const s = this.settlements ?? newSettlements();
    const p = this.powers ?? newPowers(this.session.room.state.seed);
    this.stage.setDress(regionDressOf(s, p.rival, "kessar"));
    this.stage.setHistory(historyPieces(c, s));
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
    const seed = this.session.room.state.seed;
    const p = this.powers ?? newPowers(seed);
    const s = this.settlements ?? newSettlements();
    // the powers' and the outposts' dispatches print first (D-035): the Syndicate's goal from the day it is set, the newest of the powers' log, the newest of the outpost's news
    const dispatches = [...powersDispatches(p, seed, 2), ...settlementDispatches(s, settlementNews(s).slice(0, 1), seed)].slice(0, 3);
    this.paper.show(generatePaper(c, seed, { dispatches }), () => {});
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
    else this.parley.open(m.view, (i) => room.send("parleyPick", { option: i }), () => room.send("parleyClose", {}), this.builtRegion, this.scenarioView?.template);
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
    let visuals = false;
    if ((st.powersRev ?? 0) !== this.powersRev) {
      this.powersRev = st.powersRev ?? 0;
      this.powers = st.powers ? parsePowers(st.powers) : undefined;
      visuals = true;
    }
    if ((st.settlementsRev ?? 0) !== this.settlementsRev) {
      this.settlementsRev = st.settlementsRev ?? 0;
      this.settlements = st.settlements ? parseSettlements(st.settlements) : undefined;
      visuals = true;
    }
    if (visuals || this.campaignRevSeen !== this.campaignRev) {
      this.campaignRevSeen = this.campaignRev;
      this.applyCampaignVisuals();
      this.link?.campaign(st.campaign, st.powers, st.settlements); // each newly earned achievement is unlocked once (a no-op on the web)
    }
    this.syncPresence();
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
      this.scenarioView = view;
      this.refreshCompass();
      this.scenarioPhase = view?.phase ?? "";
      this.stage.setScenario(view);   // (D-037: the region's scenery may dress it: a fall, a flood)
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
    // the collision world is a pure function of (region, bridge, outpost stage, telegraph): rebuild only when that identity changes (the scenery's own dress swaps in place)
    const key = NetSession.worldKeyOf(st);
    const region = this.session.region;
    if (!this.building && (region !== this.builtRegion || key !== this.builtKey)) void this.rebuildWorld();
    // a client that is already standing in the new region when the landing is announced (it joined or came back mid-landfall) has nothing to build: say so, or everyone waits out the timeout
    if (phase !== 3) this.arrivalSent = false;
    else if (!this.building && !this.arrivalSent && region === this.builtRegion && isRegionId(st.region)) this.sendArrival(st.region);
    // the map room follows the vote
    if (this.mapRoom.isOpen) {
      const v = mapRoomView(st, this.campaign, this.session.local?.slot, this.campaignMapData(), this.presence());
      const msig = JSON.stringify([v.phase, v.to, v.ready, v.regions.map((r) => r.here), v.campaign]);
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
      this.stage.buildWorld(world, region, st.seed);
      if (region !== this.builtRegion) {
        // a new shore: nothing of the old field's fight is here, and the music starts from a baseline (nothing already on the field counts as a shot or a death)
        this.ledger.reset();
        this.signaller.reset();
        this.aftermath.show([], getGore());
        this.aftermathFor.rev = -1;
        this.aftermathSite = undefined;
      }
      this.builtRegion = region;
      this.refreshCompass();
      this.builtKey = NetSession.worldKeyOf(st);
      this.applyCampaignVisuals();
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
    this.demoBanner?.start();
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
    this.content.dispose();
    this.hud.dispose();
    this.combat.dispose();
    this.viewmodel.dispose();
    this.hitFx.dispose();
    this.debris.dispose();
    this.aftermath.dispose();
    this.controls.canInteract = () => true;
    this.controls.holdInteract = () => false;
    this.controls.lookSlow = 1;
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
    this.orientation.dispose();
    this.loadout.dispose();
    this.wheel.dispose();
    this.tags.dispose();
    this.tagLayer.remove();
    this.mountView.dispose();
    this.demoBanner?.dispose();
    this.wishlist?.dispose();
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
    this.applyAssist(dt);

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
    this.aftermath.update(dt);
    this.ledger.note(this.session.room.state.players);
    this.syncAftermath(dt);
    this.combat.update(dt, this.controls.usingGamepad);
    this.props.sync(this.session.room.state.props, (p, f) => this.session.predict.value(p as never, f as never));
    this.updatePrompt();
    this.syncCampaign(now);
    this.demoBanner?.tick();
    this.content.update(dt, this.session.room.state);
    this.updateMusic(dt, me);
    if (this.orientation.active) {
      const pf = this.session.predicted;
      if (pf) this.orientation.tick(dt, this.session.value(pf, "x"), this.session.value(pf, "z"), this.rig.yaw, this.builtRegion, this.orientationSample(), (pf.flags & FLAG.DOWNED) !== 0, this.controls.usingGamepad ? "pad" : "keyboard");
    }

    if (me) {
      tmp.set(this.session.value(me, "x"), this.session.value(me, "y"), this.session.value(me, "z"));
      setListener(tmp, this.rig.yaw);
      this.stage.setViewer(tmp.x, tmp.z); // a room's roof lifts while you are inside it (docs/LEVEL_PLAN.md section 4, rule 7)
      const pf = this.session.predicted;
      this.rig.mounted = pf !== undefined && (pf.flags & FLAG.MOUNTED) !== 0;
      this.rig.mountSpeed01 = pf ? Math.hypot(this.session.value(pf, "vx"), this.session.value(pf, "vz")) / MOUNT.gallop : 0;
      const mine = this.rig.wantsEye ? this.actors.get(this.session.sessionId) : undefined;
      this.rig.ready = this.combat.firearmReady;
      this.rig.update(tmp, dt, this.controls.aiming, mine?.body.sampleEye(eyeSample), ((this.session.predicted?.flags ?? 0) & FLAG.DOWNED) !== 0);
      this.stage.followShadow(tmp);
    }
    this.updateViewmodel(dt, me !== undefined);
    this.stage.renderer.info.reset(); // (two passes a frame: the overlay's counters cover both)
    this.stage.render();
    this.viewmodel.render();
    this.overlay.frame(dt);
  }

  /** Which full-screen sheet is open, for the orientation card (it ticks the notice board, the supply manifest and the map room off from this). */
  private orientationSample(): SheetKind {
    if (this.paper.isOpen) return "paper";
    if (this.loadout.isOpen) return "loadout";
    if (this.mapRoom.isOpen) return "map";
    return this.parley.isOpen ? "other" : "none";
  }

  /** The adaptive score hears the field: the rows, the scenario's phase, a parley open, a sheet owning the screen (game/musicSignals.ts, audio/musicLayers.ts). `GameAudio.update` does the rest (and honours Adaptive music). */
  private updateMusic(dt: number, me: unknown): void {
    const st = this.session.room.state;
    const v = this.signalView;
    const pf = this.session.predicted;
    v.rows = st.players as never;
    v.me = this.session.sessionId;
    v.x = me && pf ? this.session.value(pf, "x") : 0;
    v.z = me && pf ? this.session.value(pf, "z") : 0;
    v.region = this.builtRegion;
    v.phase = this.scenarioPhase;
    v.parley = this.parley.isOpen;
    v.frozen = (st.travelPhase ?? 0) >= 2 || this.mapRoom.isOpen || this.paper.isOpen || this.loadout.isOpen;
    this.signaller.update(dt, v as never, this.signals);
    this.audio.update(dt, this.signals);
  }

  /**
   * Pad aim assist (PAD ONLY, setting `aimAssist`): while aiming, a hostile near the crosshair pulls the aim toward its chest as a RATE and slows the look stick (`assistLook`, input/aim.ts). The
   * total pull is kept inside `AIM.assist.maxPull`, a fifth of the server's slack, so the server never sees an aim it would not take from a steady hand. The mouse never gets any.
   */
  private applyAssist(dt: number): void {
    const c = this.controls;
    const me = this.session.predicted;
    if (!c.aiming || !c.assistOn || !me || this.wheel.isOpen) {
      c.lookSlow = 1;
      this.assistYaw = 0;
      this.assistElev = 0;
      return;
    }
    const targets = this.assistTargets;
    let n = 0;
    this.session.room.state.players.forEach((p, id) => {
      if (id === this.session.sessionId || !p.npc || (p.flags & FLAG.DOWNED) !== 0) return;
      const side = NPC_SIDE[p.npc];
      if (!side || !FOE_SIDES.has(side)) return;
      const t = (targets[n] ??= { id: "", x: 0, y: 0, z: 0, r: 0.45 });
      t.id = id;
      t.x = this.session.value(p, "x");
      t.y = this.session.value(p, "y") + 1.2;
      t.z = this.session.value(p, "z");
      n++;
    });
    targets.length = n;
    tmp.set(this.session.value(me, "x"), this.session.value(me, "y") + ((me.flags & FLAG.CROUCHING) !== 0 ? COMBAT.eyeHeightCrouch : COMBAT.eyeHeight), this.session.value(me, "z"));
    const out = assistLook(tmp, this.rig.yaw, -this.rig.pitch, targets, true, this.assistOut);
    c.lookSlow = out.slow;
    if (out.id === "") {
      this.assistYaw = 0;
      this.assistElev = 0;
      return;
    }
    const max = AIM.assist.maxPull;
    const ny = clamp(this.assistYaw + out.dYaw * dt, -max, max);
    const ne = clamp(this.assistElev + out.dElev * dt, -max, max);
    this.rig.nudge(ny - this.assistYaw, ne - this.assistElev);
    this.assistYaw = ny;
    this.assistElev = ne;
  }

  /**
   * The battlefield's aftermath: when the ledger (a new casualty or blast), the gore setting or the region changes, plan it again (pure, deterministic, audited placement) and put it on the field
   * (`Aftermath.show` keeps what is already there where it is). The audit adapter supplies the doors and routes the plan keeps clear of (built once per region and seed, on the first need).
   */
  private syncAftermath(dt: number): void {
    void dt;
    const gore = getGore();
    const was = this.aftermathFor;
    if (was.region === this.builtRegion && was.rev === this.ledger.revision && was.gore === gore) return;
    was.region = this.builtRegion;
    was.rev = this.ledger.revision;
    was.gore = gore;
    const t = this.ledger.tally;
    let items: readonly AftermathItem[] = [];
    if (t.dead + t.downed + t.blasts > 0) {
      const seed = this.session.room.state.seed;
      const key = `${this.builtRegion}|${seed}`;
      if (this.aftermathSite?.key !== key) {
        const audit = LEVEL_ADAPTERS[this.builtRegion](seed);
        this.aftermathSite = { key, site: { region: this.builtRegion, world: this.session.world, doors: audit.doors, routes: audit.routes } };
      }
      items = planAftermath({ region: this.builtRegion, seed, tally: t, centres: this.ledger.centres, gore, site: this.aftermathSite.site });
    }
    this.aftermath.show(items, gore);
  }

  /** What the world is doing to a body standing at (x, y, z): the ground (mud in wet weather and in the delta, water to wash in), rain, and a blast lately near. Refreshed a few times a second per body. */
  private refreshGround(a: Actor, x: number, y: number, z: number): void {
    const g = a.ground;
    const surf = regionSurface(this.builtRegion, surfaceAt(x, z, y - this.session.world.terrainHeight(x, z)));
    const atm = getAtmosphere();
    g.rain = atm.rain;
    g.washing = surf === "water";
    g.mud = surf === "mud" ? 0.9 : surf === "grass" || surf === "dirt" ? Math.min(1, atm.wet * 0.9 + (surf === "dirt" ? 0.15 : 0)) : 0;
    g.blast = this.combat.blastNear(x, z);
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
    // prompt TOKENS (input/glyphDom.ts): the HUD draws each as the glyph of the device in use and the player's own binding, and draws it again when they pick up the other device
    const use = "{interact}";
    const grab = "{grab}";
    const throwKey = "{throw}";
    let foundation = false;
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
      const spot = this.builtRegion !== "hollowmere" ? findStation(this.builtRegion, this.session.value(me, "x"), this.session.value(me, "z"), me.facing) : undefined;
      const heldKind = this.heldKind();
      prompt = spot?.kind === "pier" && heldKind === PropKind.BARREL ? `${use}  Light the charge     ${throwKey}  Throw` : spot?.kind === "foundation" ? `${use}  ${this.foundationText(heldKind as PropKindId | undefined)}     ${throwKey}  Throw` : `${use}  Drop     ${throwKey}  Throw`;
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
      if (st && st.kind === "foundation") {
        prompt = this.foundationText(undefined);
        foundation = true;
      }
      else if (st && st.kind !== "pier") prompt = `${use}  ${st.prompt}`;
    }
    // what the pad's Use control will do this frame: a tap is Use only when there is something to use, otherwise it reloads (input/Controls.ts)
    this.usable = foundation || prompt.includes(use);
    this.useHold = prompt.startsWith(`Hold ${use}`);
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
    return this.mountPrompter.now(this.session.value(me, "x"), this.session.value(me, "z"), me.facing, flags, mine.missing);
  }

  /** The heading strip follows the shore you stand on and the contract's next goal (D-040: it showed the hub's places everywhere). */
  private refreshCompass(): void {
    this.hud.setCompass(regionMarks(this.builtRegion), this.builtRegion === "hollowmere" ? undefined : objectiveMark(this.builtRegion, this.scenarioView));
  }

  /** The words at the outpost's foundation (D-035): how many crates are down, what the carried thing will do. */
  private foundationText(held: PropKindId | undefined): string {
    const f = foundationStatus(this.settlements ?? newSettlements(), "kessar");
    const name = this.settlements?.posts.kessar?.name ?? "the outpost";
    if (f.standing) {
      if (held === undefined) return `${name}: ${STAGE_LABEL[this.settlements!.posts.kessar!.stage]}. Carry crates, barrels and chairs here to keep it alive.`;
      return held === PropKind.BOTTLE ? "A bottle does not found anything" : `Deliver the ${PROP_DEFS[held].name} to ${name}`;
    }
    const n = Math.min(FOUNDATION_CRATES, f.crates + 1);
    if (held === undefined) return `The foundation: ${f.crates} of ${FOUNDATION_CRATES} crates down${f.ruined ? " (a ruin to raise again)" : ""}. Carry a crate here.`;
    return held === PropKind.CRATE ? `Deliver the crate (${n} of ${FOUNDATION_CRATES})` : "Only crates found a camp";
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
    this.stage.setGore(getGore());
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
    this.plateClock += dt;
    this.plates.beginFrame();
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
      if (isMe) a.body.setAimYaw(this.combat.aimHeading); // third person: the body turns to the aim ray while the sight is up
      a.groundIn -= dt;
      if (a.groundIn <= 0) {
        a.groundIn = 0.25 + (a.key & 7) * 0.02; // (spread over frames: bodies do not all look at the ground in the same one)
        this.refreshGround(a, x, y, z);
      }
      a.body.update(
        dt,
        { x, y, z, facing: this.session.value(p, "facing"), vx: this.session.value(p, "vx"), vz: this.session.value(p, "vz"), flags, wounds: p.wounds, missing: p.missing, combat: this.combat.actorCombat(id, p, isMe, dt), ride: this.mountView.rideInput(id), ground: a.ground, torch: p.npc === NPC.RAIDER },
        getGore(),
        getShowLimbs(),
      );
      // a body dragged across the field leaves its trail (the pool under a bleeding body is the hit's; this is the smear behind a rescue)
      if ((flags & FLAG.DRAGGED) !== 0) {
        const vx = this.session.value(p, "vx");
        const vz = this.session.value(p, "vz");
        if (vx * vx + vz * vz > 0.04) this.stage.decals.drag(a.key, x, z, vx, vz, p.wounds !== 0 ? 0.6 : 0.1);
      }
      if (!isMe) this.plate(id, p, a, x, y, z);
    });
    this.plates.endFrame();
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

  /** One name plate: the shared rule says whether it can sit where it points (never clamped); hired hands carry their order and their nerve. The text and the sight ray are cached (plates.ts). */
  private plate(id: string, p: PlayerStateType, a: Actor, x: number, y: number, z: number): void {
    const down = (p.flags & FLAG.DOWNED) !== 0;
    const text = this.plates.text(id, p);
    tmp.set(x, y + a.body.height + 0.55, z).project(this.stage.camera);
    const cam = this.stage.camera.position;
    const dist = Math.sqrt((x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2); // not Math.hypot: it allocates per call
    const topPx = ((1 - tmp.y) / 2) * window.innerHeight;
    // a soldier's plate reaches farther while the camera can see him (a wall in between keeps it short); the ray is cached per NPC for 0.15 s and spread over frames
    let inSight = false;
    if (p.npc !== 0 && dist <= 26) {
      if (this.plates.due(id, this.plateClock)) this.plates.report(id, !rayWorld(this.session.world, cam.x, cam.y, cam.z, (x - cam.x) / dist, (y + 1.2 - cam.y) / dist, (z - cam.z) / dist, dist - 0.6, aimHit));
      inSight = this.plates.sight(id);
    }
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
    const key = seedFromString(`${p.slot}:${p.name}:${p.npc}`) & 0xffff;
    return { body, key, ground: { mud: 0, blast: 0, rain: 0, washing: false }, groundIn: (key & 15) * 0.015 };
  }

  private removeActor(a: Actor): void {
    a.body.dispose();
  }
}
