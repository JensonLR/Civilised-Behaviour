import { CloseCode, Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  BUTTON,
  CASUALTY,
  CHARACTER,
  CollisionWorld,
  FLAG,
  INTERACT,
  PROP_DEFS,
  PropState,
  canCarry,
  carryRefusal,
  createInjuryMods,
  findInteractTarget,
  holdPosition,
  injuryMods,
  prosthesisFor,
  scatterProps,
  type MoveCommand,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
  SET_LOOK_MIN_INTERVAL_MS,
  seedFromString,
  MoveInput,
  PATCH_RATE_MS,
  PlayerState,
  Rng,
  TICK_RATE,
  WORLD_CLOCK,
  WorldState,
  createCharState,
  sanitizeDisplayName,
  spawnPoint,
  stepCharacter,
  type JoinOptions,
  type SavedMsg,
  type MoveInputType,
  type PlayerStateType,
  type PropKindId,
  type WorldStateType,
  type LimbId,
  type ZoneId,
  ZONE,
  CANNON,
  CANNON_SPOTS,
  COMBAT,
  CannonState,
  WEAPON,
  isCarried,
  NPC_CAP,
  NPC_SIDE,
  WEAPONS,
  applyOutcome,
  applyIncident,
  INCIDENT,
  INCIDENT_IDS,
  ACCIDENT_OWNER,
  HONOUR_TITLE,
  awardHonour,
  decorate,
  newDeeds,
  newHonours,
  titleOf,
  type Deeds,
  type HonoursState,
  KEG_CHAIN,
  KEG_FUSE,
  fuseTenths,
  remit,
  askingToll,
  answerParley,
  DAYS_IDLE_CAP,
  OUTPOST_STAGES,
  RESOLUTIONS,
  TEMPLATE_RESOLUTIONS,
  foundOutpost,
  type OutpostStage,
  type ResolutionId,
  ROOM_WORLD,
  isValidJoinCode,
  newPowers,
  newSettlements,
  raidAftermath,
  defendOutpost,
  parseParty,
  serializePowers,
  serializeSettlements,
  powersAfterOutcome,
  powersAfterSettlement,
  rivalAdvance,
  rivalPresence,
  regionClimate,
  powerEffects,
  regionWorldOpts,
  worldKey,
  techEffects,
  type PowersState,
  type RegionWorldOpts,
  type SettlementsState,
  type SettlementEvent,
  consequenceLines,
  createRegionWorld,
  findStation,
  isNpcKey,
  isRegionId,
  OUTPOST_SITES,
  isTemplateId,
  regionNavOptions,
  TEMPLATE_REGION,
  regionLanding,
  HUB_CREW_SPOT,
  DEMO,
  npcThink,
  followerThink,
  pickTemplate,
  regionMountSpots,
  MountState,
  NO_COMMAND,
  newParty,
  serializeParty,
  PropKind,
  REGIONS,
  hash3,
  type ScenarioTemplateId,
  leverageOf,
  newCampaign,
  npcKey,
  openParley,
  regionProps,
  peopleForNpc,
  regionSpawn,
  serializeCampaign,
  stationsFor,
  type BridgeState,
  type CampaignState,
  type PartyState,
  type NpcSpec,
  type RegionId,
  type ScenarioOutcome,
  type ScenarioView,
  startHourFor,
} from "@cb/shared";
import { HISTORY_KEYS, applyClientAppearance, applyPeople, decodeSpec, encodeSpec, generateCharacter, societyDress, specFromUntrusted } from "@cb/procedural";
import { log } from "../log.ts";
import { metrics } from "../metrics.ts";
import { Demo } from "../systems/Demo.ts";
import { tickProbe } from "../tickProbe.ts";
import { getRoomConfig } from "../roomConfig.ts";
import { PhysicsWorld, initRapier } from "../physics.ts";
import { Casualties, type HitInfo } from "../systems/Casualties.ts";
import { Cast } from "../systems/Cast.ts";
import { Combat } from "../systems/Combat.ts";
import { Followers } from "../systems/Followers.ts";
import { Incidents } from "../systems/Incidents.ts";
import { Mounts } from "../systems/Mounts.ts";
import { Scenario } from "../systems/Scenario.ts";
import { Audience } from "../systems/Audience.ts";
import { Outposts } from "../systems/Outposts.ts";
import { CAMPAIGN_CODECS } from "./campaignCodecs.ts";
import { CampaignSaver } from "../persistence/saver.ts";
import { canResume, identityKey, parseIdentity } from "../persistence/identity.ts";
import { createRecord } from "../persistence/record.ts";
import { idleDays, quarantineDamaged, restore, snapshot } from "../persistence/sections.ts";
import type { CampaignRecord, SaveResult } from "../persistence/types.ts";
import { Travel } from "../systems/Travel.ts";

/** Ticks of client silence/hitch the server tolerates (12 ticks = 400 ms). Used for BOTH the frame-budget burst and the idle threshold. */
const HITCH_TOLERANCE_TICKS = 12;

/**
 * Server state must be a pure function of the input sequence, so an empty tick skips the player
 * (client and server then agree exactly). Only after a genuine stall do we apply zero-input steps so
 * a stalled/disconnected player lands and comes to rest instead of hanging mid-air at speed.
 */
const IDLE_AFTER_TICKS = HITCH_TOLERANCE_TICKS;
const IDLE_COMMAND = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 } as const;

/**
 * Movement is a pure function of the input frames a player sends, so the server must bound how many it applies:
 * without a budget, a client sending 3 frames per step moved ~31% faster than allowed. A token bucket refills a little over
 * one frame per server tick (5% clock-drift tolerance) and holds up to 12 (400 ms) so genuine hitches, whose queued frames
 * arrive in a burst, are applied in full. Excess frames are dropped (never queued) and counted.
 */
const INPUT_BUDGET_REFILL = 1.05;
const INPUT_BUDGET_MAX = HITCH_TOLERANCE_TICKS;

/** Minimum gap between "you can't do that" notices to one player (a held key must not become a message flood). */
const REFUSAL_NOTICE_MS = 2000;

/** How often the world's age in the room state is refreshed (clients extrapolate in between; the clock and the weather are pure functions of it). */
const CLOCK_SYNC_MS = 4000;

/** How long a dropped player's slot is held for reconnection. */
const RECONNECT_WINDOW_S = 45;

/** A downed NPC stays where it fell this long, then is taken away (the dead do not pile up; the tally already counted them). */
const NPC_DOWNED_LINGER_S = 30;
/** NPC rows take slots from here up, so they never collide with a player's slot (0..MAX_PLAYERS-1) or each other. */
const NPC_SLOT_BASE = 16;
/** How near a map table or dock a player must stand to put a sailing to the vote. */
const MAP_REACH_SLACK = 4;
/** Minimum gap between accepted sailing proposals (any player): each one is announced to the whole room. */
const PROPOSE_COOLDOWN_MS = 1500;
/** Minimum gap between `saveNow` writes from the pause sheet (room-wide): a button is not a loop. */
const SAVE_ASK_COOLDOWN_MS = 1500;

function generateJoinCode(): string {
  const rng = new Rng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += JOIN_CODE_ALPHABET[Math.floor(rng.next() * JOIN_CODE_ALPHABET.length)];
  return out;
}

/**
 * One campaign session (1-4 players). Authoritative for everything that matters; clients only
 * send input frames and cosmetic requests. Movement is the shared pure step from @cb/shared.
 */
export class WorldRoom extends Room<{ state: WorldStateType; input: MoveInputType }> {
  override maxClients = MAX_PLAYERS;
  override patchRate = PATCH_RATE_MS;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override state = new WorldState();

  override inputs = this.defineInput(MoveInput, {
    // Never trust the wire: clamp stick axes (also closes the NaN poisoning hole).
    sanitize: { moveF: [-127, 127], moveR: [-127, 127] },
    // No `idle` policy on purpose: a tick with no input must NOT step the player, or the server
    // would run steps the client never predicted. See IDLE_AFTER_TICKS below and D-013.
  });

  private world!: CollisionWorld;
  private physics!: PhysicsWorld;
  private casualties!: Casualties;
  private combat!: Combat;
  /** Last buttons seen per player, for rising-edge detection (interact/throw). */
  private prevButtons = new Map<string, number>();
  /** sessionId -> prop id currently carried. */
  private carrying = new Map<string, string>();
  /** D-054: lit powder kegs (prop id -> seconds left and who lit it). */
  private readonly lit = new Map<string, { left: number; owner: string }>();
  private readonly hold = { x: 0, y: 0, z: 0 };
  private usedSlots = new Set<number>();
  private emptyTicks = new Map<string, number>();
  private lastSetLook = new Map<string, number>();
  private frameBudget = new Map<string, number>();
  /** Server-only copy of each player's `look.woodenLeg` (campaign history: 0 none, 1 left, 2 right), for the peg-leg flag. */
  private woodenLeg = new Map<string, number>();
  private lastRefusal = new Map<string, number>();
  private readonly mods = createInjuryMods();
  /** Monotonic time the world was created, and the last time `state.worldMs` was refreshed. */
  private bornAt = 0;
  private lastClockSync = 0;
  // --- the campaign (slice 1: docs/_notes/slice.md) ---
  private campaign!: CampaignState;
  /** D-035: the three minor powers, the relation map and the rival agent; the outposts and the latched tech. Each has its own JSON and revision on the wire. */
  private powers!: PowersState;
  private settlements!: SettlementsState;
  private audience!: Audience;
  private outposts!: Outposts;
  /** The saver of this campaign (undefined: nobody with a valid identity created it, so nothing is persisted) and the days of absence still to give the rival at the next commit. */
  private saver: CampaignSaver | undefined;
  private saveQueued = false;
  /** What the clients are told about the save (`saved` message): refreshed after every save the room makes. `at` is the last good save (epoch ms, 0 = none yet). */
  private saveView = { ok: true, at: 0 };
  private lastSaveAsk = -Infinity;
  private created = false;
  private pendingIdle = 0;
  /** Sections a NEWER build wrote (a downgrade): played on fresh values here, never saved over (the record keeps the newer data). */
  private heldSections: readonly string[] = [];
  /**
   * One room per saved campaign. `matchMaker.query` lags at both ends (a room's metadata arrives late; its listing is removed BEFORE `onDispose` has awaited the last save), so a
   * resume racing a creation, a twin resume or a room that is still flushing could load a stale revision and then lose every save to a conflict. This process-wide claim, taken
   * synchronously, closes the gap: a claim in `closing` state is waited for (the flush is a few ms), a live one refuses.
   */
  private static readonly campaignClaims = new Map<string, { closing: boolean }>();
  private claim: { code: string; mine: { closing: boolean } } | undefined;
  private travel!: Travel;
  /** The bounded web demo (D-036), enforced here: a region gate, warnings, a hard close, no persistence. Absent in every other room. */
  private demo: Demo | undefined;
  private scenario: Scenario | undefined;
  private cast!: Cast;
  private mounts!: Mounts;
  private followers!: Followers;
  private incidents!: Incidents;
  /** D-055: each member's honours (saved), each session's member key, and what each player has done in the contract under way. */
  private honours: HonoursState = newHonours();
  private readonly memberKey = new Map<string, string>();
  private readonly deeds = new Map<string, Deeds>();
  /** When the last shot was fired at anybody (simT): an incident waits for calm. */
  private lastShotT = -1e9;
  /** Dev/test override of the contract offered at Kessar (JoinOptions.scenario); absent in play, where `pickTemplate` decides. */
  private forcedTemplate: ScenarioTemplateId | undefined;
  /** What the manifest brought, charged when the ship left Hollowmere and applied at landfall. */
  private pendingPrep: ReturnType<Followers["prepCommit"]> | undefined;
  /** The last fixed step (s), and simulated seconds since the room began: NPC steps and the downed-NPC clock use them. */
  private tickDt = 1 / TICK_RATE;
  private simT = 0;
  private readonly npcDownedAt = new Map<string, number>();
  private lastPropose = -Infinity;
  /** The real party only (no NPC rows): what revive scans, the whole-party-down rout and the scenario count. `get` still finds any row. */
  private readonly party = {
    forEach: (cb: (p: PlayerStateType, id: string) => void): void => this.state.players.forEach((p, id) => { if (!p.npc) cb(p, id); }),
    get: (id: string): PlayerStateType | undefined => this.state.players.get(id),
  };

  /** Who can be helped (revived, dressed, dragged): the party and its hired hands, never an enemy. */
  private readonly helpable = {
    forEach: (cb: (p: PlayerStateType, id: string) => void): void => this.state.players.forEach((p, id) => { if (!p.npc || NPC_SIDE[p.npc] === "party" || this.incidents?.owns(id)) cb(p, id); }),   // (D-052: and an incident's wounded traveller)
  };

  override async onCreate(options: JoinOptions): Promise<void> {
    // RESUME (D-035): a saved campaign comes back by its join code, for a former member only; every refusal is the same error (no enumeration).
    const resume = await this.resumeFrom(options);
    // a creator-chosen seed is a QA lever like `region`: the seed also seeds combat, casualties and the hire pool, so in production a creator could pick a known world (security review, D-048)
    const seed = resume ? resume.rec.seed : getRoomConfig().debugCommands && Number.isInteger(options?.seed) ? (options.seed as number) >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.state.seed = seed;
    this.state.code = resume ? resume.rec.code : await this.freshJoinCode();
    // Campaign rule: the server default, which the creator may switch off (never on when the server has it off).
    this.state.dismemberment = getRoomConfig().dismemberment && options?.dismemberment !== false;
    // Same shape for friendly fire (GDD: default on, the host can disable): never on when the server has it off.
    this.state.friendlyFire = getRoomConfig().friendlyFire && options?.friendlyFire !== false;
    // The world clock: hour of day and weather are pure functions of the seed and how old the world is (see shared daycycle.ts / weather.ts).
    // Clients learn the age from `worldMs`, refreshed every few seconds and on join, and extrapolate with their own monotonic clock.
    const cfg = getRoomConfig();
    this.state.dayStartHour = cfg.dayStartHour ?? WORLD_CLOCK.defaultStartHour;
    this.state.dayMinutes = cfg.dayMinutes ?? WORLD_CLOCK.defaultDayMinutes;
    this.bornAt = performance.now();
    this.syncClock(true);
    // The campaign is server-owned state: one per room, mutated only by scenario outcomes (commitOutcome).
    this.campaign = resume ? (resume.values.campaign as CampaignState) : newCampaign(seed);
    this.powers = resume ? (resume.values.powers as PowersState) : newPowers(seed);
    this.settlements = resume ? (resume.values.settlements as SettlementsState) : newSettlements();
    // owed days: the ones a previous visit saved unpaid, plus the absence since that save (capped: a long absence and an uneventful visit never stack past the cap)
    this.pendingIdle = resume ? Math.min(DAYS_IDLE_CAP, ((resume.values.idle as number | undefined) ?? 0) + resume.idle) : 0;
    this.honours = resume ? ((resume.values.honours as HonoursState | undefined) ?? newHonours()) : newHonours();
    this.heldSections = resume?.newer ?? [];
    // `region` and `scenario` are QA levers: production (debugCommands off) ignores them, whatever the client sends. A resumed campaign always starts at HQ.
    const dev = cfg.debugCommands;
    const region: RegionId = !resume && dev && isRegionId(options?.region) ? options.region : "hollowmere";
    await initRapier();
    this.state.region = region;
    this.state.travelPhase = 0;
    this.state.travelTo = region;
    this.state.travelReady = 0;
    this.state.travelLeft = 0;
    this.state.campaign = serializeCampaign(this.campaign);
    this.state.campaignRev = 0;
    this.state.scenario = "";
    this.state.scenarioRev = 0;
    this.state.party = serializeParty(resume ? (resume.values.party as PartyState) : newParty());
    this.state.partyRev = 0;
    this.state.powers = serializePowers(this.powers);
    this.state.powersRev = 0;
    this.state.settlements = serializeSettlements(this.settlements);
    this.state.settlementsRev = 0;
    const demoCfg = cfg.demo;
    if (demoCfg?.enabled) {
      this.demo = new Demo(
        { now: () => Date.now(), startedAtMs: Date.now(), notice: (text) => this.broadcast("notice", { text }), closeAll: (code) => this.clients.forEach((c) => c.leave(code)) },
        { sessionSeconds: demoCfg.sessionSeconds },
      );
    }
    await this.bindSaver(options, resume);
    this.forcedTemplate = dev && isTemplateId(options?.scenario) ? options.scenario : undefined;
    this.buildRegion(region);
    this.travel = new Travel({
      connectedSlots: () => this.connectedSlots(),
      current: () => this.state.region as RegionId,
      enterRegion: (to) => this.enterRegion(to),
      notice: (text) => this.broadcast("notice", { text }),
      sync: (st) => {
        const sailing = st.phase === 2 && this.state.travelPhase < 2;
        this.state.travelPhase = st.phase;
        this.state.travelTo = st.to;
        this.state.travelReady = st.ready & 0xff;
        this.state.travelLeft = Math.min(255, Math.max(0, Math.ceil(st.left)));
        if (sailing) this.onSail();
      },
      // the steam launch (D-035): a latched piece of infrastructure, not a menu item
      sailSeconds: () => techEffects(this.settlements.tech).sailSeconds,
    });
    const room = this;
    this.casualties = new Casualties(
      {
        players: this.party,
        get world() {
          return room.world;
        },
        dropHeldProp: (sid) => {
          const p = this.state.players.get(sid);
          if (p) this.dropHeld(sid, p);
        },
        routSpawn: (slot) => regionSpawn(this.state.region as RegionId, slot, MAX_PLAYERS),
        notify: (text) => this.broadcast("notice", { text }),
        // D-055: a finished revive or dressing is a deed (an incident's traveller got up counts as kindness on the road, D-052)
        helped: (by, target) => {
          if (by === target) return;
          const d = this.deedsOf(by);
          if (d) this.incidents?.owns(target) ? d.kindness++ : d.helped++;
        },
        rng: new Rng(seed ^ 0x5eed_c0de),
        emitHit: (e) => this.broadcast("hit", e),
        emitSever: (e) => this.broadcast("sever", e),
        dismemberment: () => this.state.dismemberment,
        limbsChanged: (sid) => this.refreshProsthetic(sid),
        scan: this.helpable,
      },
      { routSeconds: getRoomConfig().routSeconds },
    );
    // Lag compensation (docs/_notes/combat.md): Colyseus records each player's pose as clients receive it and rewinds to the shooter's view.
    // Position is interpolated between snapshots (as the clients draw it); heading and stance are held (they change in steps).
    const rewind = this.allowRewindState({ maxRewindMs: COMBAT.rewindMaxMs });
    rewind.attachAll(this.state.players, { fields: ["x", "y", "z"], mode: "snapshot", maxRewindMs: COMBAT.rewindMaxMs });
    rewind.attachAll(this.state.players, { fields: ["facing", "flags"], mode: "snapshot", interpolate: "step", maxRewindMs: COMBAT.rewindMaxMs });
    this.combat = new Combat({
      players: this.state.players,
      get world() {
        return room.world;
      },
      get physics() {
        return room.physics;
      },
      damage: (sid, amount, hit) => this.damagePlayer(sid, amount, hit),
      rewind,
      friendlyFire: () => this.state.friendlyFire,
      worldSeed: seed,
      rng: new Rng(seed ^ 0xc0ffee42),
      cannons: this.state.cannons,
      emitShot: (e) => this.broadcast("shot", e),
      emitImpact: (e) => this.broadcast("impact", e),
      emitBoom: (e) => this.broadcast("boom", e),
      sendTo: (sid, e) => this.clients.getById(sid)?.send("hitmark", e),
      // A report is heard by the cast (civilians bolt, soldiers start) and by the site (the noise meter).
      noise: (x, z, radius, src) => {
        this.cast.noise(x, z, radius, src);
        this.scenario?.onNoise(x, z, radius, src);
      },
      hostile: (shooter, target) => shooter === ACCIDENT_OWNER || this.cast.hostileTo(shooter, target), // (D-071: an accident's powder respects no side)
      // being shot at: the site hears a declaration, and a soldier who saw nobody goes and looks where it came from (D-041)
      shotAt: (shooter, target) => {
        this.lastShotT = this.simT;
        this.incidents?.onHurt(target);
        this.scenario?.onShotAt(shooter, target);
        this.cast.shotFrom(target, shooter);
      },
      blasted: (id, speed) => this.mounts.onBlast(id, speed),
      propShot: (id, shooter) => this.propShot(id, shooter),
      toss: (id, dx, dz, power, lift, dmg, bias) => this.casualties.toss(id, dx, dz, power, lift, dmg, bias),
      blastAt: (owner, x, y, z, radius) => this.powderCatches(owner, x, y, z, radius),
    });
    // The cast runs every NPC row (garrison, rivals, deserters, hostages, hired hands) through the same step a player takes; the brains plug in here.
    this.cast = new Cast({
      cry: (key) => this.broadcast("cry", { id: key }), // (D-073: a voice of panic, cosmetic)
      players: this.party,
      spawnNpc: (spec) => this.spawnNpc(spec),
      removeNpc: (key) => this.removeNpc(key),
      stepNpc: (key, cmd) => this.stepNpc(key, cmd),
      world: () => this.world,
      // The SIM clock (not the wall clock): two rooms with the same seed and inputs stay identical however the host stalls.
      worldMs: () => this.simT * 1000,
      seed,
      fear: () => this.campaign.factions.ward.fear,
      brains: { garrison: npcThink, follower: followerThink },
      navOptions: (w) => regionNavOptions(this.state.region as RegionId, w),
    });
    this.mounts = new Mounts({
      players: this.state.players,
      rows: this.state.mounts,
      newRow: () => {
        const r = new MountState();
        r.kind = 0;
        r.x = r.y = r.z = r.facing = r.speed = 0;
        r.rider = "";
        r.hitch = "";
        r.coat = 0;
        r.phase = 0;
        r.hp = 100;
        r.cargo = 0;
        return r;
      },
      world: () => this.world,
      get physics() {
        return room.physics;
      },
      damage: (sid, amount, hit) => this.damagePlayer(sid, amount, hit),
      notice: (sid, text) => this.clients.getById(sid)?.send("notice", { text }),
      seed,
      rowOf: (key) => this.state.players.get(key),
      takeHeld: (sid) => {
        const held = this.carrying.get(sid);
        const p = this.state.players.get(sid);
        if (!held || !p) return undefined;
        this.physics.release(held, 0, 0, 0);
        this.finishHold(sid, held, p);
        return held;
      },
      setPropHolder: (id, holder) => {
        const ps = this.state.props.get(id);
        if (ps) ps.holder = holder;
      },
      propExists: (id) => this.state.props.has(id),
      releaseDrag: (sid) => this.casualties.releaseDrag(sid),
      routePoints: (name) => this.cast.routePoints(name),
    });
    this.followers = new Followers({
      players: this.party,
      cast: this.cast,
      brainOf: (id) => this.cast.brainOf(id),
      purse: () => this.campaign.purse,
      spend: (n) => this.spend(n),
      getParty: () => this.state.party,
      setParty: (json) => {
        this.state.party = json;
        this.state.partyRev = (this.state.partyRev + 1) & 0xffff;
        this.persist();
      },
      bonusKg: () => techEffects(this.settlements.tech).capacityKg,
      dress: (medic, target) => this.casualties.assist(medic, target, "dress"),
      revive: (medic, target) => this.casualties.assist(medic, target, "revive"),
      propPos: (id) => {
        const ps = this.state.props.get(id);
        return ps && ps.holder === "" ? { x: ps.x, z: ps.z } : undefined;
      },
      holdProp: (key, id) => this.npcHold(key, id),
      dropProp: (key) => {
        const p = this.state.players.get(key);
        if (p) this.dropHeld(key, p);
      },
      notice: (sid, text) => (sid === "*" ? this.broadcast("notice", { text }) : this.clients.getById(sid)?.send("notice", { text })),
      prepOpen: () => this.state.region === "hollowmere" && this.state.travelPhase < 2,
      atSupply: (sid) => this.atSupply(sid),
      inBounds: (x, z) => Math.hypot(x, z) <= REGIONS[this.state.region as RegionId].bounds,
      day: () => this.campaign.day,
      nowS: () => this.simT,
      seed,
    });
    // D-052: chaos during play (one incident per contract at most, dealt when it starts; the room only routes and commits)
    this.incidents = new Incidents({
      party: this.party,
      cast: this.cast,
      campaign: () => this.campaign,
      region: () => this.state.region as RegionId,
      bounds: () => REGIONS[this.state.region as RegionId].bounds,
      seed,
      notice: (text) => this.broadcast("notice", { text }),
      hostiles: () => {
        const out: { x: number; z: number }[] = [];
        this.state.players.forEach((p) => {
          const side = p.npc ? NPC_SIDE[p.npc] : undefined;
          if (side && side !== "party" && side !== "neutral" && (p.flags & FLAG.DOWNED) === 0) out.push({ x: p.x, z: p.z });
        });
        return out;
      },
      land: (x, z) => {
        const wd = (this.world.terrain as { waterDepth?: (x: number, z: number) => number }).waterDepth;
        return (this.cast.openAt?.(x, z) ?? true) && (wd === undefined || wd(x, z) <= 0);
      },
      fighting: () => this.simT - this.lastShotT < INCIDENT.calmS || this.scenario?.phase === "fighting" || this.scenario?.phase === "escalated",
      join: (name, lookSeed, at) => this.followers.join(name, lookSeed, at),
      looseHorse: (at) => this.mounts.spawnHorse({ x: at.x, z: at.z, yaw: 0 }, { coat: (this.state.seed ^ 0x40) >>> 0 }),
      riderOf: (id) => this.state.mounts.get(id)?.rider ?? "",
      // D-071: the overturned powder wagon's kegs, in a ring round the wreck, the first one fizzing (the accident's: it respects no side)
      spillKegs: (at, n, ring, fuseS) => {
        const out: string[] = [];
        const turn = ((this.state.seed >>> 3) % 628) / 100;
        for (let k = 0; k < n; k++) {
          const a = turn + (k / n) * Math.PI * 2;
          const id = this.spawnPropAt(PropKind.BARREL, at.x + Math.cos(a) * ring, at.z + Math.sin(a) * ring);
          if (id) out.push(id);
        }
        const first = out[0];
        const ps = first ? this.state.props.get(first) : undefined;
        if (first && ps) {
          this.lit.set(first, { left: fuseS, owner: ACCIDENT_OWNER });
          ps.fuse = fuseTenths(fuseS);
        }
        return out;
      },
      propLive: (id) => this.state.props.has(id),
      propLit: (id) => this.lit.has(id),
      kind: (sid) => {
        const d = this.deedsOf(sid);
        if (d) d.kindness++;
      },
      hasRoom: () => this.followers.hasRoom,
    });
    this.outposts = new Outposts({
      players: this.party,
      region: () => this.state.region as RegionId,
      settlements: () => this.settlements,
      setSettlements: (s, ev) => this.commitSettlements(s, ev),
      campaign: () => this.campaign,
      climate: () => regionClimate(this.campaign, this.powers, this.state.region as RegionId),
      propKind: (id) => this.state.props.get(id)?.kind,
      consumeProp: (id) => this.consumeProp(id),
      notice: (text) => this.broadcast("notice", { text }),
      send: (sid, type, msg) => this.clients.getById(sid)?.send(type, msg),
      rebuildWorld: () => this.rebuildWorld(),
      busy: () => this.travel.busy,
      day: () => this.campaign.day,
      seed,
    });
    this.audience = new Audience({
      campaign: () => this.campaign,
      powers: () => this.powers,
      atMapRoom: (sid) => {
        const p = this.state.players.get(sid);
        return !!p && !p.npc && this.state.region === "hollowmere" && this.atMapRoom(p);
      },
      send: (sid, type, msg) => this.clients.getById(sid)?.send(type, msg),
      commit: (c, p) => this.commitAudience(c, p),
      players: this.party,
      nowMs: () => this.simT * 1000,
      seed,
    });
    this.startScenario(region);
    this.landfall(region);
    void this.setMetadata({ code: this.state.code });
    // Campaigns are friends-first: unlisted, reachable only via join code or direct room id.
    void this.setPrivate(true);
    metrics.rooms++;
    this.created = true;
    log.info("room.create", { roomId: this.roomId, code: this.state.code, seed });

    this.setFixedTimestep((ctx) => {
      const t0 = performance.now();
      tickProbe.start();
      this.demo?.tick();
      this.tickDt = ctx.dt;
      this.simT += ctx.dt;
      this.outposts.tick(ctx.dt);
      const sailing = this.travel.busy;
      this.state.players.forEach((player, sessionId) => {
        if (player.npc) return; // NPC rows are stepped by the scenario, through the same step a player uses
        if (sailing) {
          // Sailing and landfall: nobody moves or acts, and what the client sent meanwhile was for the old world (never queued for the new one).
          const n = this.inputs.get(sessionId).size;
          if (n > 0) this.inputs.get(sessionId).take(n);
          return;
        }
        // Frames are taken one at a time (not drained) so the lag-compensation stamp of each is the stamp of THAT frame (Rewind.lastSeenBy).
        const acc = this.inputs.get(sessionId);
        const budget = Math.min(INPUT_BUDGET_MAX, (this.frameBudget.get(sessionId) ?? INPUT_BUDGET_MAX) + INPUT_BUDGET_REFILL);
        const allowed = Math.floor(budget);
        const pending = acc.size;
        const take = Math.min(pending, allowed);
        if (pending > take) metrics.inputFramesDropped += pending - take;
        this.frameBudget.set(sessionId, budget - take);
        if (take > 0) {
          this.emptyTicks.set(sessionId, 0);
          for (let i = 0; i < take; i++) {
            const cmd = acc.next();
            if (!cmd) break;
            stepCharacter(player, cmd, ctx.dt, this.world);
            this.handleInteraction(sessionId, player, cmd);
          }
          if (pending > take) acc.take(pending - take); // over budget: consumed (the ack moves on) but never simulated
        } else {
          const empty = (this.emptyTicks.get(sessionId) ?? 0) + 1;
          this.emptyTicks.set(sessionId, empty);
          if (empty > IDLE_AFTER_TICKS) stepCharacter(player, IDLE_COMMAND, ctx.dt, this.world);
        }
        this.physics.syncPlayer(sessionId, player.x, player.y, player.z, (player.flags & (FLAG.CROUCHING | FLAG.DOWNED)) !== 0);
        const held = this.carrying.get(sessionId);
        if (held) {
          // Injuries can change under a carrier's hands (an arm lost or gashed to grievous): whatever they can no longer lift falls.
          const kind = this.state.props.get(held)?.kind as PropKindId | undefined;
          injuryMods(player.wounds, player.missing, (player.flags & FLAG.PEG_LEG) !== 0, this.mods);
          if (kind !== undefined && !canCarry(this.mods, PROP_DEFS[kind]?.mass ?? 0)) {
            this.dropHeld(sessionId, player);
            this.refuse(sessionId, `It slips from your grasp. ${carryRefusal(this.mods)}`);
          } else {
            holdPosition(player, this.hold);
            this.physics.moveHeld(held, this.hold.x, this.hold.y, this.hold.z, player.facing);
          }
        }
      });
      tickProbe.lap("inputs");
      if (!sailing) this.mounts.tick(ctx.dt); // after the players stepped, before the physics (a ridden horse copies its rider; a wagon trails its horse)
      tickProbe.lap("mounts");
      this.carryNpcProps();
      this.syncClock(false);
      tickProbe.lap("other");
      if (!sailing) {
        this.scenario?.tick(ctx.dt);
        this.incidents.tick(ctx.dt);
        this.audience.tick();
        tickProbe.lap("scenario");
        this.cast.tick(ctx.dt);
        tickProbe.lap("cast");
        this.followers.tick(ctx.dt);
        tickProbe.lap("followers");
      }
      this.reapNpcs();
      this.casualties.tick(ctx.dt);
      tickProbe.lap("casualties");
      this.combat.tick(ctx.dt);
      tickProbe.lap("combat");
      this.physics.step(ctx.dt);
      this.burnFuses(ctx.dt);
      tickProbe.lap("physics");
      for (const [id, pb] of this.physics.props) if (pb.holder !== "" || !pb.body.isSleeping()) this.writeProp(id, false);
      tickProbe.lap("props");
      this.travel.tick(ctx.dt); // last: a landfall swaps the world, which nothing above may still be holding
      tickProbe.lap("travel");
      const ms = performance.now() - t0;
      metrics.recordTick(ms);
      if (ms > ctx.dtMs) {
        metrics.tickOverruns++;
        log.warn("room.tick_overrun", { roomId: this.roomId, ms: Math.round(ms * 100) / 100, budgetMs: ctx.dtMs });
      }
    }, TICK_RATE);

    if (getRoomConfig().debugCommands) {
      log.warn("room.debug_enabled", { roomId: this.roomId });
      this.onMessage("debug", (client, msg: { cmd?: string }) => this.debugCommand(client, msg?.cmd));
    }

    this.onMessage("setLook", (client, msg: { look?: unknown }) => this.handleSetLook(client, msg?.look));

    // Sailing and the parley. Every payload is hostile until the machine that owns it accepts it (out-of-phase, stale and forged messages are ignored there).
    this.onMessage("travelPropose", (client, msg: { to?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.npc || (p.flags & FLAG.DOWNED) !== 0 || !this.atMapRoom(p)) return; // a downed comrade cannot put the party to sea
      const now = performance.now();
      if (now - this.lastPropose < PROPOSE_COOLDOWN_MS) return; // propose/cancel is a broadcast: not a thing to loop
      this.lastPropose = now;
      if (this.state.region === "hollowmere" && this.state.travelPhase === 0) {
        // The manifest is checked again here, and again when the ship leaves; what does not fit is left on the quay then (trimLoadout), so this only warns.
        const chk = this.followers.check();
        if (!chk.ok) this.refuse(client.sessionId, `The quartermaster notes: ${chk.problems.join(" ")} What does not fit stays on the quay.`);
      }
      if (this.demo && !this.demo.regionAllowed(msg?.to)) return; // the demo's region gate lives here, on the server
      this.travel.propose(client.sessionId, p.slot, msg?.to);
    });
    this.onMessage("travelReady", (client, msg: { ready?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (p) this.travel.ready(p.slot, msg?.ready);
    });
    this.onMessage("travelCancel", () => this.travel.cancel());
    this.onMessage("regionReady", (client, msg: { region?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (p && isRegionId(msg?.region)) this.travel.regionReady(p.slot, msg.region);
    });
    this.onMessage("parleyPick", (client, msg: { option?: unknown }) => {
      if (this.audience.has(client.sessionId)) this.audience.onPick(client.sessionId, msg?.option); // an audience at HQ takes the answer
      else if (typeof msg?.option === "number") this.scenario?.onPick(client.sessionId, msg.option);
    });
    this.onMessage("parleyClose", (client) => {
      if (!this.audience.onClose(client.sessionId)) this.scenario?.onParleyClose(client.sessionId);
    });
    // An audience with a power (D-035): only at the map table or the dock, only for a power that is asking today; the answers ride the parley messages above.
    this.onMessage("audienceOpen", (client, msg: { power?: unknown }) => this.audience.open(client.sessionId, msg?.power));
    // The expedition's prep and orders. Each is hostile until the Followers system's parsers and checks accept it (sender standing, rate, range, targets).
    this.onMessage("loadoutSet", (client, msg: unknown) => void this.followers.onLoadoutSet(client.sessionId, msg));
    this.onMessage("hire", (client, msg: unknown) => void this.followers.onHire(client.sessionId, msg));
    this.onMessage("command", (client, msg: unknown) => void this.followers.onCommand(client.sessionId, msg));

    this.onMessage("saveNow", (client) => void this.onSaveNow(client));

    this.onMessage("ping", (client, msg: { t?: number }) => {
      client.send("pong", { t: typeof msg?.t === "number" ? msg.t : 0, serverTime: Date.now() });
    });
  }

  override onJoin(client: Client, options: JoinOptions): void {
    if (this.demo?.ended) throw new ServerError(DEMO.closeCode, "This demo session has ended."); // (the clock does not restart for a rejoin)
    const slot = this.freeSlot();
    this.usedSlots.add(slot);
    const player = new PlayerState();
    player.name = sanitizeDisplayName(options?.name);
    player.slot = slot;
    player.connected = true;
    // Untrusted look -> valid canonical spec; a fresh join never carries history (that is campaign-owned).
    const incoming = societyDress(specFromUntrusted(options?.look, seedFromString(client.sessionId))); // (D-065: an explorer never wears a people's dress)
    const blank = { ...incoming };
    for (const k of HISTORY_KEYS) blank[k] = 0;
    player.look = encodeSpec(blank);
    this.woodenLeg.set(client.sessionId, blank.woodenLeg);
    player.title = "";
    player.health = CASUALTY.maxHealth;
    player.wounds = 0; // numeric schema fields decode as undefined until first assigned
    player.missing = 0;
    player.reviveProgress = 0;
    player.reviver = "";
    player.dragger = "";
    const sp = regionSpawn(this.state.region as RegionId, slot, MAX_PLAYERS);
    const c = createCharState(sp.x, sp.z, this.world);
    Object.assign(player, c);
    this.state.players.set(client.sessionId, player);
    player.shots = 0; // numeric schema fields decode as undefined until first assigned
    player.aim = 0;
    player.npc = 0;
    player.cmd = NO_COMMAND;
    player.morale = 0;
    this.combat.onJoin(client.sessionId, player);
    if (this.saver) {
      const id = parseIdentity(options?.token);
      if (id) {
        const key = this.saver.addMember(id); // an HMAC key, never the id; saved with the next save
        // (honours are kept only for those in the book: a joiner a full book could not take is never remembered, so nothing of theirs is either)
        if (this.saver.record?.members.includes(key)) this.memberKey.set(client.sessionId, key);
        player.title = titleOf(this.honours, key); // D-055: a member wears the latest honour this campaign gave them
        this.persist();
      }
    }
    client.send("saved", this.savedMsg()); // (a joiner learns at once whether this campaign is kept; the next save refreshes it)
    this.syncClock(true); // a joiner's first state must carry a fresh world age
    metrics.players++;
    metrics.physicsBodies++;
    log.info("room.join", { roomId: this.roomId, sessionId: client.sessionId, slot, name: player.name });
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const consented = code === CloseCode.CONSENTED || (this.demo !== undefined && code === DEMO.closeCode); // (a demo's end is a close nobody reconnects into)
    if (!consented) {
      player.connected = false;
      this.travel.onLeave(player.slot); // a vote this player was blocking, or a landfall they were holding up, may now be complete
      try {
        await this.allowReconnection(client, RECONNECT_WINDOW_S);
        player.connected = true;
        metrics.reconnects++;
        log.info("room.reconnect", { roomId: this.roomId, sessionId: client.sessionId });
        return;
      } catch {
        metrics.reconnectFailures++;
        log.info("room.reconnect_expired", { roomId: this.roomId, sessionId: client.sessionId });
      }
    }
    this.mounts.onLeave(client.sessionId); // a rider comes down where he is
    this.audience.onLeave(client.sessionId);
    this.outposts.onLeave(client.sessionId);
    this.followers.onLeave(client.sessionId);
    this.casualties.onLeave(client.sessionId);
    this.combat.onLeave(client.sessionId);
    this.dropHeld(client.sessionId, player);
    this.physics.removePlayer(client.sessionId);
    metrics.physicsBodies--;
    this.prevButtons.delete(client.sessionId);
    this.usedSlots.delete(player.slot);
    this.emptyTicks.delete(client.sessionId);
    this.lastSetLook.delete(client.sessionId);
    this.frameBudget.delete(client.sessionId);
    this.woodenLeg.delete(client.sessionId);
    this.lastRefusal.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.memberKey.delete(client.sessionId);
    this.deeds.delete(client.sessionId);
    this.travel.onLeave(player.slot);
    metrics.players--;
    this.persist(); // (also when the last player leaves: the campaign is on disk before the room goes)
    log.info("room.leave", { roomId: this.roomId, sessionId: client.sessionId, consented });
  }

  // ---- persistence (D-035): the ledger is saved, the live world is not ---------------------------------------------------------------------------------

  /**
   * `options.resume`: load the saved campaign for that join code. Only a former member (by identity key) may; an unknown code, a stranger, a bad token and a campaign that is
   * already live all get the SAME error, so a join code cannot be probed. Absent option = a new campaign (returns undefined).
   */
  private async resumeFrom(options: JoinOptions): Promise<{ rec: CampaignRecord; values: Record<string, unknown>; idle: number; newer: string[] } | undefined> {
    if (options?.resume === undefined) return undefined;
    const deny = (why: string): never => {
      this.releaseClaim();
      log.info("room.resume_denied", { roomId: this.roomId, why });
      // (Colyseus uses the code as the HTTP status of the matchmaking answer: 4004 made the router throw a RangeError and the client never saw this text; 404 is what the lookup endpoint says too)
      throw new ServerError(404, "No expedition by that code is waiting for you.");
    };
    const rt = getRoomConfig().persistence;
    if (getRoomConfig().demo?.enabled) return deny("demo"); // a demo saves nothing, so there is nothing to resume
    const code = typeof options.resume === "string" ? options.resume.toUpperCase() : "";
    const id = parseIdentity(options.token);
    if (!rt || !isValidJoinCode(code) || !id) return deny("request");
    const store = await rt.store();
    const key = identityKey(id, rt.cfg.pepper);
    // membership FIRST, touching no claim: a stranger holding a known code used to take the campaign's claim for the length of a store read, so a member resuming at
    // that moment was told the campaign was live (security review, D-048; floodable)
    const member = async (): Promise<CampaignRecord | undefined> => {
      const r = await store.findByCode(code);
      return r && canResume(r, key) ? r : undefined;
    };
    // (a room of this campaign still writing its last save may not have written its FIRST yet: then the answer waits for it, below; otherwise no record, no claim)
    if (!(await member()) && !WorldRoom.campaignClaims.get(code)?.closing) return deny("not a member");
    let other = WorldRoom.campaignClaims.get(code);
    for (let i = 0; other?.closing && i < 200; i++) {
      await new Promise((r) => setTimeout(r, 25)); // a room of this campaign is writing its last save: wait for it, then load what it wrote
      other = WorldRoom.campaignClaims.get(code);
    }
    if (other) return deny("live");
    this.takeClaim(code); // (synchronous after the last await: two resumes cannot both pass)
    // and load again under the claim: a closing room may have saved since the first read, and the room must start from the LAST save
    const rec = await member();
    if (!rec) return deny("not a member");
    const live = await matchMaker.query({ name: ROOM_WORLD });
    if (live.some((r) => r.roomId !== this.roomId && (r.metadata as { code?: string } | undefined)?.code === code)) return deny("live");
    const r = restore(CAMPAIGN_CODECS, rec);
    if (r.repaired.length) log.warn("room.resume_repaired", { roomId: this.roomId, sections: r.repaired });
    log.info("room.resume", { roomId: this.roomId, code, rev: rec.rev });
    if (r.newer.length) log.warn("room.resume_newer_sections", { roomId: this.roomId, sections: r.newer, note: "written by a newer build; kept untouched, not saved over" });
    // a section damaged at this version is replaced by a fresh one, so keep its bytes first (as `damaged_<key>`, carried verbatim by every later save)
    const q = quarantineDamaged(rec, r);
    if (q.kept.length || q.skipped.length) log.warn("room.resume_damaged_kept", { roomId: this.roomId, kept: q.kept, skipped: q.skipped });
    return { rec: { ...rec, sections: q.sections, sectionVersions: q.sectionVersions }, values: r.values, idle: idleDays(rec.savedAt, Date.now()), newer: r.newer };
  }

  private takeClaim(code: string): void {
    this.releaseClaim();
    const mine = { closing: false };
    WorldRoom.campaignClaims.set(code, mine);
    this.claim = { code, mine };
  }

  private releaseClaim(): void {
    const c = this.claim;
    this.claim = undefined;
    if (c && WorldRoom.campaignClaims.get(c.code) === c.mine) WorldRoom.campaignClaims.delete(c.code);
  }

  /** A join code no live room and no saved campaign already uses. */
  private async freshJoinCode(): Promise<string> {
    const rt = getRoomConfig().persistence;
    let code = generateJoinCode();
    if (!rt) return code;
    try {
      const store = await rt.store();
      for (let i = 0; i < 12 && (await store.findByCode(code)); i++) code = generateJoinCode();
    } catch {
      /* a store that cannot answer must not stop a campaign from starting */
    }
    return code;
  }

  /** Attach the saver: a resumed record, or a fresh one owned by the creator's identity key. Without a valid identity nothing is persisted (and nobody could resume it anyway). */
  private async bindSaver(options: JoinOptions, resume: { rec: CampaignRecord } | undefined): Promise<void> {
    const rt = getRoomConfig().persistence;
    const id = parseIdentity(options?.token);
    if (!rt || !id || getRoomConfig().demo?.enabled) return; // (a demo campaign is never saved: no record, no claim, nothing to find later)
    try {
      const store = await rt.store();
      const saver = new CampaignSaver(store, { now: () => Date.now(), log, pepper: rt.cfg.pepper });
      if (resume) {
        saver.bind(resume.rec);
        this.saveView = { ok: true, at: resume.rec.savedAt };
      }
      else saver.bind(createRecord({ code: this.state.code, seed: this.state.seed, owner: identityKey(id, rt.cfg.pepper) }));
      this.saver = saver;
      if (!resume) this.takeClaim(this.state.code); // (a resume took its claim before it loaded the record)
      if (!resume) void this.persistNow(); // the record exists from the first moment (a campaign nobody played is still resumable by its creator)
    } catch (e) {
      log.error("room.saver_unavailable", { roomId: this.roomId, err: e instanceof Error ? e.name : "error" });
    }
  }

  /** Save the ledger soon (once per tick however many things changed). Never throws into the room. */
  private persist(): void {
    if (!this.saver || this.saveQueued) return;
    this.saveQueued = true;
    queueMicrotask(() => {
      this.saveQueued = false;
      void this.persistNow();
    });
  }

  private persistNow(): Promise<SaveResult | undefined> {
    if (!this.saver) return Promise.resolve(undefined);
    try {
      const live: Record<string, unknown> = { campaign: this.campaign, party: parseParty(this.state.party) ?? newParty(), powers: this.powers, settlements: this.settlements, idle: this.pendingIdle, honours: this.honours };
      for (const k of this.heldSections) delete live[k]; // (a section a newer build wrote is not ours to overwrite)
      const snap = snapshot(CAMPAIGN_CODECS, live);
      return this.saver.saveNow(snap).then((r) => {
        this.noteSave(r);
        return r;
      });
    } catch (e) {
      metrics.saveFailures++;
      log.error("room.save_failed", { roomId: this.roomId, err: e instanceof Error ? e.name : "error" });
      return Promise.resolve(undefined);
    }
  }

  /** What the party is told about the save: whether this room keeps anything at all, whether the last attempt went through, and when the last good one landed. */
  private savedMsg(asked = false): SavedMsg {
    return { kept: this.saver !== undefined, ok: this.saveView.ok, at: this.saveView.at, ...(asked ? { asked: true } : {}) };
  }

  private noteSave(r: SaveResult): void {
    this.saveView = { ok: r.ok, at: r.ok ? Date.now() : this.saveView.at };
    try {
      if (this.clients.length > 0) this.broadcast("saved", this.savedMsg());
    } catch {
      /* a room that is going away has nobody left to tell */
    }
  }

  /** `saveNow` from a player (the pause sheet): write the ledger now and answer THAT client with how it went. Rate limited; a refusal answers with the standing view and writes nothing. */
  private async onSaveNow(client: Client): Promise<void> {
    const reply = (): void => {
      try {
        client.send("saved", this.savedMsg(true));
      } catch {
        /* the sender left while the save was in flight */
      }
    };
    const p = this.state.players.get(client.sessionId);
    const now = performance.now();
    if (!this.saver || !p || p.npc || now - this.lastSaveAsk < SAVE_ASK_COOLDOWN_MS) return reply();
    this.lastSaveAsk = now;
    await this.persistNow();
    reply();
  }

  /** Refreshes `state.worldMs` (the world's age) at most every CLOCK_SYNC_MS unless forced. */
  private syncClock(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastClockSync < CLOCK_SYNC_MS) return;
    this.lastClockSync = now;
    this.state.worldMs = now - this.bornAt;
  }

  override async onDispose(): Promise<void> {
    if (this.claim) this.claim.mine.closing = true; // (a resume of this campaign now waits for the last save below)
    try {
      void this.persistNow();
      this.scenario?.dispose();
      this.scenario = undefined;
      this.mounts?.dispose();
      if (this.created) metrics.rooms--; // (a creation that was refused, e.g. a resume nobody may make, never counted)
      if (this.physics) {
        metrics.physicsBodies -= this.physics.props.size; // player capsules are released in onLeave
        this.physics.dispose();
      }
      log.info("room.dispose", { roomId: this.roomId, code: this.state.code });
      await this.saver?.flush(5000); // the last save is awaited (5 s cap): the campaign survives the room
    } finally {
      this.releaseClaim();
    }
  }

  /**
   * Server-authoritative interaction, evaluated per input frame on rising button edges only:
   * INTERACT picks up the best target in reach (shared rule) or drops what is held; THROW hurls it.
   */
  private handleInteraction(sessionId: string, player: PlayerStateType, cmd: MoveCommand): void {
    const prev = this.prevButtons.get(sessionId) ?? 0;
    this.prevButtons.set(sessionId, cmd.buttons);
    const pressed = cmd.buttons & ~prev;
    // Casualty rules run first: downed players may not use props, and reviving a teammate outranks picking things up.
    if (this.casualties.onFrame(sessionId, player, cmd.buttons, pressed)) return;
    // Weapons, blows and the cannon crew (a crew takes the INTERACT press, so a prop beside the gun stays put).
    if (this.combat.onFrame(sessionId, player, cmd, pressed)) return;
    if (pressed === 0) return;
    const held = this.carrying.get(sessionId);
    // Horses and wagons come before the places you can USE: a rider's INTERACT dismounts him however near the map table is.
    if ((pressed & BUTTON.INTERACT) !== 0 && this.mounts.onInteract(sessionId, player, held)) return;
    // The places you can USE come before props: the Warden and the pier (scenario), then the map table, notice board and dock.
    if ((pressed & BUTTON.INTERACT) !== 0 && this.useStation(sessionId, player, held)) return;

    if (held) {
      // D-054: RELOAD with a keg in your arms lights its fuse (then throw it, or do not dawdle)
      if ((pressed & BUTTON.RELOAD) !== 0 && this.state.props.get(held)?.kind === PropKind.BARREL && !this.lit.has(held)) {
        this.lightKeg(held, sessionId);
        return;
      }
      if (pressed & (BUTTON.INTERACT | BUTTON.THROW)) {
        // Throw strength comes from the arms (injury.ts): a maimed thrower lobs weakly; with no throw strength it is just a drop.
        injuryMods(player.wounds, player.missing, (player.flags & FLAG.PEG_LEG) !== 0, this.mods);
        const throwing = (pressed & BUTTON.THROW) !== 0 && this.mods.throwMul > 0;
        const dirX = -Math.sin(player.facing);
        const dirZ = -Math.cos(player.facing);
        this.physics.release(
          held,
          player.vx + (throwing ? dirX * INTERACT.throwSpeed * this.mods.throwMul : 0),
          throwing ? INTERACT.throwLift * this.mods.throwMul : 0,
          player.vz + (throwing ? dirZ * INTERACT.throwSpeed * this.mods.throwMul : 0),
        );
        this.finishHold(sessionId, held, player);
      }
      return;
    }
    if (pressed & BUTTON.INTERACT) {
      const target = findInteractTarget<string>(player, (cb) => this.state.props.forEach((p, id) => cb(id, p)));
      if (target === undefined) {
        this.casualties.tryDress(sessionId, player); // nothing to lift: a wounded comrade in reach may be dressed instead
        return;
      }
      // The server decides what these arms can lift; a crafted INTERACT from a maimed body gets a refusal, never the prop.
      injuryMods(player.wounds, player.missing, (player.flags & FLAG.PEG_LEG) !== 0, this.mods);
      const def = PROP_DEFS[(this.state.props.get(target)?.kind ?? -1) as PropKindId];
      if (!def || !canCarry(this.mods, def.mass)) {
        if (!this.casualties.tryDress(sessionId, player)) this.refuse(sessionId, carryRefusal(this.mods));
        return;
      }
      if (!this.physics.hold(target, sessionId)) return;
      this.carrying.set(sessionId, target);
      player.flags |= FLAG.CARRYING;
      const ps = this.state.props.get(target);
      if (ps) ps.holder = sessionId;
    }
  }

  /** INTERACT at a station. Returns true when the press was taken. The scenario checks its own ranges; the map/paper/dock come from the shared station table. */
  private useStation(sessionId: string, player: PlayerStateType, held: string | undefined): boolean {
    if (this.travel.busy) return true;
    if (!held && this.incidents.onInteract(sessionId, player)) return true; // (a courier's dispatch, a deserter's offer: D-052)
    if (this.scenario?.onInteract(sessionId, player, held)) return true;
    if (this.outposts.onInteract(sessionId, player, held)) return true; // a carried crate at the foundation (D-035)
    if (held) return false; // arms full: a carried prop is dropped or thrown, never "used" on a table
    const st = findStation(this.state.region as RegionId, player.x, player.z, player.facing);
    if (!st) return false;
    if (st.kind === "map" || st.kind === "dock") this.clients.getById(sessionId)?.send("station", { kind: "map" });
    else if (st.kind === "paper") this.clients.getById(sessionId)?.send("station", { kind: "paper" });
    else if (st.kind === "loadout") this.clients.getById(sessionId)?.send("station", { kind: "loadout" });
    else return false; // pier / warden belong to the scenario, the foundation to the outposts (it needs a carried prop)
    return true;
  }

  /** A sailing may only be put to the vote from the map table or the dock (the client offers it there; the server does not take its word for it). */
  private atMapRoom(p: PlayerStateType): boolean {
    for (const st of stationsFor(this.state.region as RegionId)) {
      if ((st.kind === "map" || st.kind === "dock") && Math.hypot(p.x - st.x, p.z - st.z) <= st.r + MAP_REACH_SLACK) return true;
    }
    return false;
  }

  /** The manifest and the hire list are decided at the supply table: the sender's ROW (never a client claim) within the loadout station's reach. */
  private atSupply(sid: string): boolean {
    const p = this.state.players.get(sid);
    if (!p || p.npc) return false;
    for (const st of stationsFor(this.state.region as RegionId)) {
      if (st.kind === "loadout" && Math.hypot(p.x - st.x, p.z - st.z) <= st.r + MAP_REACH_SLACK) return true;
    }
    return false;
  }

  /** Bitmask of the real slots currently in the room (NPCs and dropped connections are not). */
  private connectedSlots(): number {
    let m = 0;
    this.state.players.forEach((p) => {
      if (!p.npc && p.connected) m |= 1 << p.slot;
    });
    return m;
  }

  // ---- regions ---------------------------------------------------------------------------------------------------------------------------

  /** Builds the world, physics, props and fixtures of `id` (the room holds exactly one active region). Callers have already torn down the old one. */
  private buildRegion(id: RegionId): void {
    const seed = this.state.seed;
    this.world = createRegionWorld(id, seed, this.worldOpts());
    this.physics = new PhysicsWorld(this.world);
    this.state.props.clear();
    for (const spawn of regionProps(id, seed, this.world)) {
      const body = this.physics.spawnProp(spawn, this.world.terrainHeight(spawn.x, spawn.z));
      if (!body) continue;
      const ps = new PropState();
      ps.kind = spawn.kind;
      ps.holder = "";
      ps.fuse = 0;
      this.state.props.set(body.id, ps);
      this.writeProp(body.id, true);
    }
    metrics.physicsBodies += this.physics.props.size;
    // Field cannon(s): fixtures of the Hollowmere camp, replicated so every client can draw them, load them and watch the fuse. Kessar's wall guns are display only.
    this.state.cannons.clear();
    if (id === "hollowmere") {
      CANNON_SPOTS.forEach((spot, i) => {
        const cs = new CannonState();
        cs.x = spot.x;
        cs.z = spot.z;
        cs.y = this.world.terrainHeight(spot.x, spot.z);
        cs.yaw = spot.yaw;
        cs.elev = 0.12;
        cs.phase = 0;
        cs.progress = 0;
        cs.crew = 0;
        cs.shells = CANNON.shells;
        cs.fired = 0;
        this.state.cannons.set(String(i), cs);
      });
    }
    this.combat?.rebuildCannons();
  }

  /** Kessar Reach carries one contract per visit (`pickTemplate`: the ledger decides, never the same one twice running); Hollowmere has none. Called once the room's systems exist (the cast is spawned through them). */
  private startScenario(id: RegionId): void {
    if (id === "hollowmere") return; // the hub carries no contract, whatever a dev override says
    const template = this.forcedTemplate ?? pickTemplate(this.campaign, id, this.state.seed, rivalPresence(this.campaign, this.powers));
    if (template === undefined) return;
    this.scenario = new Scenario(this.scenarioHost(), template);
    this.scenario.start();
    this.incidents.begin(template);
    this.deeds.clear(); // (honours count from a contract's start: D-055)
  }

  /** The sailing has finished: tear the old region down, stand the new one up, put everybody on its landing. Runs at the end of a server tick. */
  private enterRegion(to: RegionId): void {
    // Sailing away COMMITS what happened (D-034 rule 1): the template decides (nothing, `abandoned`, `sabotaged`, its own ending); the hands are paid or not in the same breath.
    this.scenario?.leave();
    this.scenario?.dispose();
    this.scenario = undefined;
    this.incidents.reset();
    this.followers.endExpedition();
    this.cast.despawn();
    this.mounts.dispose();
    this.npcDownedAt.clear();
    this.publishScenario("");
    // Nobody carries anything across the water; a revive or drag in progress is over.
    this.carrying.clear();
    this.state.players.forEach((p, sid) => {
      if (p.npc) return;
      p.flags &= ~(FLAG.CARRYING | FLAG.OPERATING);
      this.casualties.onLeave(sid);
      this.prevButtons.delete(sid);
      this.emptyTicks.set(sid, 0);
    });
    const old = this.physics;
    metrics.physicsBodies -= old.props.size;
    old.dispose();
    this.lit.clear(); // (a fuse does not cross the water: the next region's props may reuse the ids)
    this.state.region = to;
    this.buildRegion(to);
    this.startScenario(to);
    this.landfall(to);
    // Everyone lands on the arrival ring at rest. (The client snaps its prediction when the region changes; see net/Session.ts.)
    this.state.players.forEach((p) => {
      if (p.npc) return;
      const at = regionSpawn(to, p.slot, MAX_PLAYERS);
      const c = createCharState(at.x, at.z, this.world);
      p.x = c.x;
      p.y = c.y;
      p.z = c.z;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.stumble = 0;
      p.facing = 0;
    });
    log.info("room.region", { roomId: this.roomId, region: to });
  }

  // ---- the campaign: outcomes, scenario host, NPC rows -------------------------------------------------------------------------------------

  private publishScenario(json: string): void {
    if (this.state.scenario === json) return;
    this.state.scenario = json;
    this.state.scenarioRev = (this.state.scenarioRev + 1) & 0xffff;
  }

  /** A scenario resolved: the campaign changes (one rules table in shared/factions.ts), everyone is told what the Ward made of it. */
  private commitOutcome(o: ScenarioOutcome): void {
    const before = this.campaign;
    // The pipeline (D-035): ledger -> the powers' relations -> the rival's days (absence gives it whole idle days, once) -> the outposts' day -> what the outposts mean to the
    // powers -> publish everything -> save. Each step is a pure function in shared/; this method only orders them and publishes.
    let c = applyOutcome(before, o);
    let p = powersAfterOutcome(before, c, this.powers, o);
    // D-052: what became of this run's incident (the courier's arrears, a helped traveller's goodwill, the record the paper prints) rides on the same commit
    const incident = this.incidents.take(before.day + 1);
    if (incident) ({ c, p } = applyIncident(c, p, incident));
    // D-040: the Society pays for the story (by the column-inch), so an honest campaign is never stranded at HQ with an empty purse
    const pay = remit(c, o);
    c = pay.c;
    // D-045: a Raid on the Post was the Syndicate's raid, played: it is spent before the rival's days run (so it never lands twice), and the post takes what the ending says
    const raided = raidAftermath(p, o);
    p = raided.p;
    const idle = this.pendingIdle;
    this.pendingIdle = 0;
    const adv = rivalAdvance(c, p, c.day + idle);
    c = adv.c;
    p = adv.p;
    const events: SettlementEvent[] = [];
    this.campaign = c;
    this.powers = p;
    if (raided.raid) events.push(...this.outposts.raid("kessar", c.day));
    if (raided.defended) this.commitSettlements(defendOutpost(this.settlements, "kessar"), []);
    for (const e of adv.events) if (e.kind === "raided_outpost") events.push(...this.outposts.raid(e.region, e.day));
    events.push(...this.outposts.evolve(c.day, (r) => regionClimate(c, p, r)));   // (each post in its own region's weather, D-056; the outposts publish themselves and tell the powers: commitSettlements)
    this.publishCampaign();
    this.publishPowers();
    // D-040: what the ending did arrives as ONE debrief telegram, a line each (the playtest's bribe sent six slips in a row and buried the field under paper)
    const debrief = [pay.line, ...consequenceLines(before, this.campaign).slice(0, 3)];
    for (const e of events) if (e.kind === "promoted" || e.kind === "demoted" || e.kind === "abandoned" || e.kind === "raided" || e.kind === "telegraph" || e.kind === "launch") debrief.push(this.settlementLine(e));
    // Wages, wounds and desertions of the hired hands, AFTER the outcome (a reward is in the purse before it is spent).
    debrief.push(...this.followers.settle(o).slice(0, 4));
    const honoured = this.awardHonours(o);
    if (honoured) debrief.push(honoured);
    this.persist(); // (the honours section changed with the titles)
    this.broadcast("notice", { text: debrief.join("\n") });
    log.info("campaign.outcome", { roomId: this.roomId, resolution: o.resolution, day: this.campaign.day });
  }

  private publishCampaign(): void {
    this.state.campaign = serializeCampaign(this.campaign);
    this.state.campaignRev = (this.state.campaignRev + 1) & 0xffff;
    this.persist();
  }

  private publishPowers(): void {
    const json = serializePowers(this.powers);
    if (json === this.state.powers) return;
    this.state.powers = json;
    this.state.powersRev = (this.state.powersRev + 1) & 0xffff;
    this.persist();
  }

  private publishSettlements(): void {
    const json = serializeSettlements(this.settlements);
    if (json === this.state.settlements) return;
    this.state.settlements = json;
    this.state.settlementsRev = (this.state.settlementsRev + 1) & 0xffff;
    this.persist();
  }

  /** A line for a notice about what an outpost event means (the paper says it better, later). */
  private settlementLine(e: SettlementEvent): string {
    const stage = e.stage.replace(/_/g, " ");
    switch (e.kind) {
      case "promoted": return `${e.name} is now a ${stage}.`;
      case "demoted": return `${e.name} has slipped back to a ${stage}.`;
      case "abandoned": return `${e.name} has been given up to the grass.`;
      case "raided": return `${e.name} was visited in the night. It is being described as an inspection.`;
      case "telegraph": return `The telegraph reaches ${e.name}.`;
      case "launch": return `A steam launch now serves ${e.name}.`;
      default: return `${e.name}: ${e.kind}.`;
    }
  }

  /** Outposts changed (a delivery, the daily rules, a raid): publish, tell the powers what it means, save. */
  private commitSettlements(s: SettlementsState, events: readonly SettlementEvent[]): void {
    this.settlements = s;
    this.publishSettlements();
    if (events.length) {
      this.powers = powersAfterSettlement(this.campaign, this.powers, events);
      this.publishPowers();
    }
  }

  /** An audience ended: the purse and the powers moved together. */
  private commitAudience(c: CampaignState, p: PowersState): void {
    this.campaign = c;
    this.powers = p;
    this.publishCampaign();
    this.publishPowers();
  }

  /** Credits the purse (a standing deal that cheapens the manifest). */
  private credit(n: number): void {
    if (!(n > 0)) return;
    this.campaign = { ...this.campaign, purse: Math.min(99999, this.campaign.purse + Math.floor(n)) };
    this.publishCampaign();
  }

  /** Takes pounds out of the purse (the manifest at sailing, a signing fee). Never below zero. */
  private spend(n: number): void {
    if (!(n > 0)) return;
    this.campaign = { ...this.campaign, purse: Math.max(0, this.campaign.purse - Math.floor(n)) };
    this.publishCampaign();
  }

  private scenarioHost(): ConstructorParameters<typeof Scenario>[0] {
    return {
      players: this.party,
      worldMs: () => performance.now() - this.bornAt,
      campaign: () => this.campaign,
      commit: (o) => this.commitOutcome(o),
      cast: this.cast,
      mounts: this.mounts,
      explode: (x, y, z, radius, owner) => {
        const b = WEAPONS[WEAPON.CANNON].ranged!.blast!;
        this.combat.explode(owner, WEAPON.CANNON, { ...b, radius }, x, y, z, "");
      },
      consumeProp: (id) => this.consumeProp(id),
      propKind: (id) => this.state.props.get(id)?.kind,
      propPos: (id) => {
        const ps = this.state.props.get(id);
        return ps ? { x: ps.x, y: ps.y, z: ps.z } : undefined;
      },
      propsNear: (x, z, r, kind) => {
        const out: string[] = [];
        this.state.props.forEach((ps, id) => {
          if (ps.holder === "" && (kind === undefined || ps.kind === kind) && Math.hypot(ps.x - x, ps.z - z) <= r) out.push(id);
        });
        return out;
      },
      spawnProp: (kind, x, z) => this.spawnPropAt(kind, x, z),
      rebuildBridge: (b) => this.rebuildWorld(b),
      publish: (v: ScenarioView) => this.publishScenario(JSON.stringify(v)),
      send: (sid, type, msg) => this.clients.getById(sid)?.send(type, msg),
      // the Ward's price carries what the Guild says about you at funerals (powers' flags); the Syndicate's presence shapes who is met
      negotiation: {
        askingToll: (c) => askingToll(c, this.powers),
        leverageOf,
        openParley: (c, lv, seed) => openParley(c, lv, seed, this.powers),
        answerParley: (c, lv, seed, view, option) => answerParley(c, lv, seed, view, option, this.powers),
      },
      // D-047: and the party's own post where the contract is played, so a raid meets the walls that stand
      rivalPresence: () => {
        const r = rivalPresence(this.campaign, this.powers);
        const post = isRegionId(this.state.region) ? this.settlements.posts[this.state.region as RegionId]?.stage : undefined;
        return post && post !== "none" ? { ...r, partyPost: post } : r;
      },
      seed: this.state.seed,
      groundY: (x, z) => this.world.terrainHeight(x, z),
    };
  }

  /**
   * The collision world depends on (bridge, outpost stage, telegraph) (D-035: `regionWorldOpts`, the same function the clients call). The charge has brought the bridge down
   * (`bridge` overrides what the ledger has not caught up with yet), or an outpost was founded or promoted: new analytic world (what people walk on) and new static colliders
   * (what props land on), then EVERY row (players, NPCs, mounts) is pushed out of whatever solid now stands where it is. The delivery yard is free at every stage, so nobody delivering is trapped.
   */
  private rebuildWorld(bridge?: BridgeState): void {
    const opts = this.worldOpts();
    this.world = createRegionWorld(this.state.region as RegionId, this.state.seed, bridge ? { ...opts, bridge } : opts);
    this.physics.replaceStatic(this.world);
    const pos = { x: 0, z: 0 };
    this.state.players.forEach((p) => {
      pos.x = p.x;
      pos.z = p.z;
      if (this.world.resolveXZ(pos, p.y, CHARACTER.radius, CHARACTER.height)) {
        p.x = pos.x;
        p.z = pos.z;
        p.vx = p.vz = 0;
      }
    });
    this.state.mounts.forEach((m) => {
      pos.x = m.x;
      pos.z = m.z;
      if (this.world.resolveXZ(pos, m.y, 0.8, 1.6)) {
        m.x = pos.x;
        m.z = pos.z;
      }
    });
  }

  /**
   * What the collision world is built from: the LEDGER and the settlements as the room holds them, never the last published strings. Inside `commitOutcome` the ledger moves
   * first and is published last, so a rebuild there (an outpost promoted by the same ending that brought the bridge down) must not read the old bridge off `state.campaign`.
   * Once published the two are the same text, which is what the clients build from.
   */
  private worldOpts(): RegionWorldOpts {
    return regionWorldOpts(serializeCampaign(this.campaign), serializeSettlements(this.settlements), this.state.region as RegionId);
  }

  private consumeProp(id: string): void {
    this.lit.delete(id);
    const ps = this.state.props.get(id);
    if (!ps) return;
    const holder = ps.holder;
    if (holder) {
      this.carrying.delete(holder);
      const hp = this.state.players.get(holder);
      if (hp) hp.flags &= ~FLAG.CARRYING;
      this.physics.release(id, 0, 0, 0);
    }
    this.physics.removeProp(id);
    this.state.props.delete(id);
    metrics.physicsBodies--;
  }

  /** A free prop of `kind` at (x, z), on the ground (scenario sites, the powder kegs of the manifest). */
  private spawnPropAt(kind: number, x: number, z: number): string | undefined {
    if (!(kind in PROP_DEFS)) return undefined;
    const body = this.physics.spawnProp({ kind: kind as PropKindId, x, z, yaw: hash3(this.state.seed, Math.round(x * 4), Math.round(z * 4)) / 4294967296 * Math.PI * 2 }, this.world.terrainHeight(x, z));
    if (!body) return undefined;
    const ps = new PropState();
    ps.kind = kind;
    ps.holder = "";
    ps.fuse = 0;
    this.state.props.set(body.id, ps);
    this.writeProp(body.id, true);
    metrics.physicsBodies++;
    return body.id;
  }

  /** A barrel is a powder keg: a ranged round into one sets it off (the convoy's `burned` ending, a very bad idea at the landing). The site hears of it before it goes. */
  private propShot(id: string, shooter: string): void {
    const ps = this.state.props.get(id);
    if (!ps || ps.kind !== PropKind.BARREL || ps.holder !== "") return;
    this.kegBlast(id, shooter);
  }

  /** A keg goes off where it is (shot, or its fuse ran out: in the air, on the ground, or in somebody's arms), credited to `owner`. The site hears of it first. */
  private kegBlast(id: string, owner: string): void {
    const ps = this.state.props.get(id);
    if (!ps) return;
    const at = { x: ps.x, y: ps.y, z: ps.z };
    this.scenario?.onProp("destroyed", id);
    this.consumeProp(id);
    const b = WEAPONS[WEAPON.CANNON].ranged!.blast!;
    this.combat.explode(owner, WEAPON.CANNON, { ...b, radius: KEG_FUSE.radius, damage: Math.round(b.damage * KEG_FUSE.damageMul) }, at.x, at.y, at.z, "");
  }

  /**
   * D-064: powder catches. Every keg a blast reaches (loose, or in somebody's arms) is lit on a short fuse that grows with its distance (KEG_CHAIN), credited to whoever set off the
   * first: a stack goes up as a ripple. A keg already burning keeps the shorter of its fuse and the new one.
   */
  private powderCatches(owner: string, x: number, y: number, z: number, radius: number): void {
    const reach = radius * KEG_CHAIN.reach;
    this.state.props.forEach((ps, id) => {
      if (ps.kind !== PropKind.BARREL) return;
      const d = Math.hypot(ps.x - x, ps.y - y, ps.z - z);
      if (d > reach) return;
      const left = KEG_CHAIN.base + d * KEG_CHAIN.perMetre;
      const f = this.lit.get(id);
      if (f && f.left <= left) return;
      this.lit.set(id, { left, owner: f?.owner ?? owner });
      ps.fuse = fuseTenths(left);
    });
  }

  /** D-055: what a member did this contract (created on first use). */
  private deedsOf(sid: string): Deeds | undefined {
    const p = this.state.players.get(sid);
    if (!p || p.npc) return undefined;
    let d = this.deeds.get(sid);
    if (!d) this.deeds.set(sid, (d = newDeeds()));
    return d;
  }

  /** D-055: somebody went down: a member counts it against themselves, and a member who put down an enemy counts it for themselves. */
  private noteDown(victim: string, p: PlayerStateType, by: string): void {
    if (!p.npc) {
      const d = this.deedsOf(victim);
      if (d) d.downed++;
      return;
    }
    const side = NPC_SIDE[p.npc];
    if (by && side !== "party" && side !== "neutral") {
      const d = this.deedsOf(by);
      if (d) d.foesDowned++;
    }
  }

  /** D-055, at the commit: each member present earns at most one honour from their own deeds; the latest is worn, the last three are kept. Returns the debrief line. */
  private awardHonours(o: ScenarioOutcome): string {
    const named: string[] = [];
    this.party.forEach((p, sid) => {
      const h = awardHonour(this.deeds.get(sid) ?? newDeeds(), o);
      if (!h) return;
      const key = this.memberKey.get(sid);
      if (key) this.honours = decorate(this.honours, key, h);
      p.title = HONOUR_TITLE[h];
      named.push(`${p.name}, ${HONOUR_TITLE[h]}`);
    });
    this.deeds.clear();
    return named.length ? `The Society's honours: ${named.join("; ")}.` : "";
  }

  /** D-054: the fuse is lit. Everyone near hears it (the clients draw the sparks and play the hiss from `PropState.fuse`). */
  private lightKeg(id: string, by: string): void {
    const ps = this.state.props.get(id);
    if (!ps) return;
    this.lit.set(id, { left: KEG_FUSE.seconds, owner: by });
    const d = this.deedsOf(by);
    if (d) d.kegs++;
    ps.fuse = fuseTenths(KEG_FUSE.seconds);
  }

  /** Burns the lit fuses down; a fuse that reaches the powder sets the keg off where it is. */
  private burnFuses(dt: number): void {
    if (this.lit.size === 0) return;
    const due: [string, string][] = [];
    for (const [id, f] of this.lit) {
      f.left -= dt;
      const ps = this.state.props.get(id);
      if (!ps) {
        this.lit.delete(id);
        continue;
      }
      const t = fuseTenths(f.left);
      if (ps.fuse !== t) ps.fuse = t;
      if (f.left <= 0) due.push([id, f.owner]);
    }
    for (const [id, owner] of due) this.kegBlast(id, owner);
  }

  /** A hired porter picks a prop up (the same hold a player uses, keyed by the row). */
  private npcHold(key: string, id: string): boolean {
    const p = this.state.players.get(key);
    const ps = this.state.props.get(id);
    if (!p || !p.npc || !ps || ps.holder !== "" || this.carrying.has(key) || (p.flags & FLAG.DOWNED) !== 0) return false;
    if (!this.physics.props.has(id)) return false;
    if (!this.physics.hold(id, key)) return false;
    this.carrying.set(key, id);
    p.flags |= FLAG.CARRYING;
    ps.holder = key;
    return true;
  }

  /** Props carried by hired hands ride in their arms (the player loop does the same for people). */
  private carryNpcProps(): void {
    if (this.carrying.size === 0) return;
    for (const [key, id] of this.carrying) {
      if (!isNpcKey(key)) continue;
      const p = this.state.players.get(key);
      if (!p) continue;
      holdPosition(p, this.hold);
      this.physics.moveHeld(id, this.hold.x, this.hold.y, this.hold.z, p.facing);
    }
  }

  /** The ship leaves Hollowmere: the manifest is trimmed to the purse and the load, charged ONCE, and its effects wait for landfall. Sailing home carries no manifest. */
  private onSail(): void {
    this.pendingPrep = this.state.region === "hollowmere" ? this.followers.prepCommit() : undefined;
    // a standing deal (the Houses' weather policy, the Granges' grain) cheapens the manifest; a strike or a markup makes it dearer (D-035)
    const pct = powerEffects(this.powers).manifestPct;
    const charged = this.pendingPrep?.charged ?? 0;
    const delta = Math.round((charged * pct) / 100);
    if (delta > 0) this.spend(delta);
    else if (delta < 0) this.credit(-delta);
    if (delta !== 0) this.broadcast("notice", { text: delta < 0 ? `A standing arrangement takes £${-delta} off the manifest.` : `The quay adds £${delta} to the manifest, for reasons it has put in writing.` });
  }

  /**
   * Everybody is ashore. Hollowmere: the stable (two horses and a wagon by the supply pyramid, always there). Anywhere else: what the manifest brought: rounds for every
   * firearm, kegs at the landing, the horses and the wagon on the ring behind it, and the hired hands round the party.
   */
  private landfall(to: RegionId): void {
    const spots = regionMountSpots(to);
    if (to === "hollowmere") {
      for (const h of spots.horses) this.mounts.spawnHorse(h, { coat: hash3(this.state.seed, Math.round(h.x), 0x4c01) });
      this.mounts.spawnWagon(spots.wagon, { coat: hash3(this.state.seed, 7, 0x4c02), crates: 0, horse: false });
      // D-047: the hired hands come home with the party (they used to exist only on a foreign shore: hired at the table, never seen at home)
      this.followers.home(HUB_CREW_SPOT);
      return;
    }
    const prep = this.pendingPrep;
    this.pendingPrep = undefined;
    if (!prep) return;
    const fx = prep.effects;
    const land = regionLanding(to);
    this.followers.landfall(land);
    this.state.players.forEach((p, sid) => {
      if (!p.npc && fx.reserveMul > 1) this.combat.scaleReserve(sid, fx.reserveMul);
    });
    for (let i = 0; i < fx.kegs; i++) this.spawnPropAt(PropKind.BARREL, land.x - 3 + i * 1.2, land.z - 4);
    let free = fx.horses;
    if (fx.wagon) {
      this.mounts.spawnWagon(spots.wagon, { coat: hash3(this.state.seed, 7, 0x4c02), crates: 0, horse: true });
      free = Math.max(0, free - 1);
    }
    for (let i = 0; i < free && i < spots.horses.length; i++) this.mounts.spawnHorse(spots.horses[i]!, { coat: hash3(this.state.seed, i, 0x4c03) });
  }

  private spawnNpc(spec: NpcSpec): boolean {
    const key = npcKey(spec.id);
    if (this.state.players.has(key)) return false;
    let count = 0;
    const used = new Set<number>();
    this.state.players.forEach((p) => {
      if (!p.npc) return;
      count++;
      used.add(p.slot);
    });
    if (count >= NPC_CAP) return false;
    let slot = NPC_SLOT_BASE;
    while (used.has(slot)) slot++;
    const p = new PlayerState();
    p.name = spec.name;
    p.slot = slot;
    p.connected = true;
    p.look = this.npcLook(spec);
    p.title = "";
    p.health = CASUALTY.maxHealth;
    p.reviveProgress = 0;
    p.reviver = "";
    p.dragger = "";
    const c = createCharState(spec.post.x, spec.post.z, this.world);
    Object.assign(p, c);
    p.facing = Math.PI; // facing the bridge from the north bank, the Syndicate from the south: near enough; npcDecide turns them
    p.npc = spec.role;
    this.state.players.set(key, p);
    p.shots = 0;
    p.aim = 0;
    p.cmd = NO_COMMAND;
    p.morale = 0;
    this.combat.onJoin(key, p);
    return true;
  }

  /**
   * The authored look of an NPC: a seeded character, drawn as one of the region's FICTIONAL native peoples when its role or spec says so (D-038: `spec.people ?? peopleForNpc(role, region)`;
   * the Society's, the Syndicate's and the Company's folk stay the colonial caricature), with the spec's patch laid over it (clamped, canonical). `look` is already a string on the wire:
   * no schema change, and the client draws exactly what the server named.
   */
  private npcLook(spec: NpcSpec): string {
    const people = spec.people ?? peopleForNpc(spec.role, this.state.region as RegionId);
    const base = people ? applyPeople(generateCharacter(spec.lookSeed), people, spec.lookSeed) : generateCharacter(spec.lookSeed);
    if (!spec.look) return encodeSpec(base);
    try {
      return encodeSpec(specFromUntrusted(encodeSpec({ ...base, ...spec.look }), spec.lookSeed));
    } catch {
      return encodeSpec(base);
    }
  }

  private removeNpc(key: string): void {
    const p = this.state.players.get(key);
    if (!p) return;
    const held = this.carrying.get(key);
    if (held) this.dropHeld(key, p);
    this.casualties.onLeave(key);
    this.combat.onLeave(key);
    this.physics.removePlayer(key);
    this.prevButtons.delete(key);
    this.npcDownedAt.delete(key);
    this.state.players.delete(key);
  }

  /** One step of an NPC: the SAME movement step and combat path a player's input frame takes. */
  private stepNpc(key: string, cmd: MoveCommand): void {
    const p = this.state.players.get(key);
    if (!p || !p.npc) return;
    stepCharacter(p, cmd, this.tickDt, this.world);
    const prev = this.prevButtons.get(key) ?? 0;
    this.prevButtons.set(key, cmd.buttons);
    this.combat.onFrame(key, p, cmd, cmd.buttons & ~prev);
    this.combat.topUp(key); // an NPC's powder does not run out mid-skirmish (the balance was tuned so)
    this.physics.syncPlayer(key, p.x, p.y, p.z, (p.flags & (FLAG.CROUCHING | FLAG.DOWNED)) !== 0);
  }

  /** A downed NPC stays down (it is never revived) and is taken away after NPC_DOWNED_LINGER_S. */
  private reapNpcs(): void {
    let any = false;
    this.state.players.forEach((p) => {
      if (p.npc) any = true;
    });
    if (!any) return;
    const gone: string[] = [];
    this.state.players.forEach((p, id) => {
      if (!p.npc || NPC_SIDE[p.npc] === "party" || this.incidents.owns(id)) return; // a downed hired hand (or an incident's traveller, D-052) lies where he fell until someone revives him
      if ((p.flags & FLAG.DOWNED) === 0) return;
      const at = this.npcDownedAt.get(id);
      if (at === undefined) this.npcDownedAt.set(id, this.simT);
      else if (this.simT - at >= NPC_DOWNED_LINGER_S) gone.push(id);
    });
    for (const id of gone) this.removeNpc(id);
  }

  /** Tells one player why the server said no. Rate limited: it is a courtesy, not a channel. */
  private refuse(sessionId: string, text: string): void {
    const now = Date.now();
    if (now - (this.lastRefusal.get(sessionId) ?? 0) < REFUSAL_NOTICE_MS) return;
    this.lastRefusal.set(sessionId, now);
    this.clients.getById(sessionId)?.send("notice", { text });
  }

  /** Raises/lowers FLAG.PEG_LEG: a wooden leg only counts where a leg is actually missing. Flags are predicted, so this rides the normal state path. */
  private refreshProsthetic(sessionId: string): void {
    const p = this.state.players.get(sessionId);
    if (!p) return;
    const peg = prosthesisFor(this.woodenLeg.get(sessionId) ?? 0, p.missing);
    const next = peg ? p.flags | FLAG.PEG_LEG : p.flags & ~FLAG.PEG_LEG;
    if (next !== p.flags) p.flags = next;
  }

  /** Rate-limited appearance change. Appearance comes from the client; campaign history never does. */
  private handleSetLook(client: Client, look: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const now = Date.now();
    if (now - (this.lastSetLook.get(client.sessionId) ?? 0) < SET_LOOK_MIN_INTERVAL_MS) return;
    const incoming = decodeSpec(look);
    const current = decodeSpec(player.look);
    if (!incoming || !current) return;
    this.lastSetLook.set(client.sessionId, now);
    const next = applyClientAppearance(current, incoming);
    player.look = encodeSpec(next);
    this.woodenLeg.set(client.sessionId, next.woodenLeg); // history is server-owned, so this never changes here; kept in step anyway
    this.refreshProsthetic(client.sessionId);
  }

  /** The single entry point for harm (weapons, explosions, friendly fire, debug). Health 0 puts a player down, never out. */
  damagePlayer(sessionId: string, amount: number, hit?: HitInfo): void {
    const p = this.state.players.get(sessionId);
    const wasDown = p !== undefined && (p.flags & FLAG.DOWNED) !== 0;
    this.casualties.damage(sessionId, amount, hit);
    if (p && !wasDown) {
      const down = (p.flags & FLAG.DOWNED) !== 0;
      this.scenario?.onDamage(sessionId, hit?.by ?? "", hit?.zone ?? -1, down);
      if (hit?.by) this.incidents?.onHurt(sessionId);
      if (down) this.noteDown(sessionId, p, hit?.by ?? "");
      if (hit?.by) this.cast.shotFrom(sessionId, hit.by);
      if (down) this.mounts.onDown(sessionId); // he slides from the saddle
      else this.mounts.onHurt(sessionId, amount, hit); // a hard enough blow unseats him
    }
  }

  /** QA-only commands (see docs/NETWORKING.md). Registered only when config.debugCommands is true. */
  private debugCommand(client: Client, cmd: string | undefined): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (cmd === "hurt") this.damagePlayer(client.sessionId, 40);
    else if (cmd === "down") this.damagePlayer(client.sessionId, 1000, { zone: ZONE.TORSO }); // (a random zone at 1000 damage would take a limb)
    else if (cmd?.startsWith("sever:")) this.casualties.sever(client.sessionId, Number(cmd.slice(6)) as LimbId, -Math.sin(player.facing), -Math.cos(player.facing));
    else if (cmd === "restore") this.casualties.restoreLimbs(client.sessionId);
    else if (cmd?.startsWith("give:")) {
      // give:all | give:<weapon id> : owns it and refills its ammunition (QA; the campaign layer will grant weapons and crates of shot)
      const arg = cmd.slice(5);
      if (arg === "all") this.combat.give(client.sessionId);
      else if (isCarried(Number(arg))) this.combat.give(client.sessionId, Number(arg) as never);
    }
    else if (cmd?.startsWith("hour:")) {
      // set the world's clock to this hour now (renders and QA at night, at dusk); the day count follows the clock, as it would
      const h = Number(cmd.slice(5));
      if (Number.isFinite(h)) {
        this.syncClock(true);
        this.state.dayStartHour = startHourFor(h, this.state.worldMs, this.state.dayMinutes);
      }
    } else if (cmd?.startsWith("tp:")) {
      // tp:<x>:<z>[:<facing>] : stand somewhere (QA, screenshots)
      const [, x, z, f] = cmd.split(":");
      if (Number.isFinite(Number(x)) && Number.isFinite(Number(z))) {
        player.x = Number(x);
        player.z = Number(z);
        player.y = this.world.terrainHeight(player.x, player.z);
        player.facing = Number(f) || 0;
        player.vx = player.vz = 0;
      }
    }
    else if (cmd?.startsWith("outcome:")) {
      // outcome:<resolution> : commit a synthetic ending of the matching contract (QA + e2e: a campaign with a history without walking three crossings; the same pipeline a real ending takes)
      const r = cmd.slice(8);
      if (!(RESOLUTIONS as readonly string[]).includes(r)) return;
      const template = (Object.keys(TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[]).find((t) => (TEMPLATE_RESOLUTIONS[t] as readonly string[]).includes(r)) ?? "secure_crossing";
      this.commitOutcome({
        scenario: template, ...(TEMPLATE_REGION[template] !== "kessar" ? { region: TEMPLATE_REGION[template] } : {}), resolution: r as ResolutionId, toll: 40, paid: 0, bridge: this.campaign.crossing.bridge, brokePromise: false, seconds: 1,
        tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
      });
    }
    else if (cmd?.startsWith("incident:")) {
      // incident:<id> : this run's incident is <id> and happens now, calm or not (QA + tests: the real one waits a minute or two and for 20 s without a shot)
      const id = cmd.slice(9);
      if (this.scenario && (INCIDENT_IDS as readonly string[]).includes(id)) this.incidents.force(id as (typeof INCIDENT_IDS)[number]);
    }
    else if (cmd?.startsWith("outpost:")) {
      // outpost:<stage>[@<region>] : the Society's outpost (at Kessar unless a region with a site is named, D-056) exists at once at that stage (QA + e2e: the four crates are walked in resume.test)
      const [st, at = "kessar"] = cmd.slice(8).split("@");
      const stage = st as OutpostStage;
      if (!(OUTPOST_STAGES as readonly string[]).includes(stage) || stage === "none" || !isRegionId(at) || !OUTPOST_SITES[at]) return;
      const base = foundOutpost(this.settlements, at, this.campaign, this.state.seed).posts[at]!;
      const events: SettlementEvent[] = [{ kind: "founded", day: this.campaign.day, region: at, stage, name: base.name }];
      this.commitSettlements({ ...this.settlements, posts: { ...this.settlements.posts, [at]: { ...base, stage, supply: 60, security: 50, trade: 50 } } }, events);
      this.rebuildWorld();
      // (QA: a contract nothing has happened in yet starts again, so it sees the post as it would have in play, where the post is founded long before)
      if (this.state.region === "kessar" && this.scenario && this.scenario.phase === "planning" && this.scenario.resolution === undefined) {
        this.scenario.dispose();
        this.scenario = undefined;
        this.startScenario("kessar");
      }
    }
    else if (cmd === "nearCannon") {
      // Stand at the breech of the first cannon, looking down the barrel.
      const c = this.state.cannons.get("0");
      if (!c) return;
      player.x = c.x - Math.sin(c.yaw) * -2.2;
      player.z = c.z - Math.cos(c.yaw) * -2.2;
      player.y = this.world.terrainHeight(player.x, player.z);
      player.facing = c.yaw;
      player.vx = player.vz = 0;
    }
    else if (cmd?.startsWith("peg:")) {
      // peg:<0|1|2> fits a wooden leg (campaign history is server-owned; this stands in for the future campaign layer)
      const spec = decodeSpec(player.look);
      const side = Number(cmd.slice(4));
      if (!spec || !(side === 0 || side === 1 || side === 2)) return;
      spec.woodenLeg = side;
      player.look = encodeSpec(spec);
      this.woodenLeg.set(client.sessionId, side);
      this.refreshProsthetic(client.sessionId);
    }
    else if (cmd?.startsWith("hit:")) {
      // hit:<zone>:<amount>, pushed from behind the player's facing (QA + e2e: reproducible wounds and knock direction)
      const [, z, a] = cmd.split(":");
      this.damagePlayer(client.sessionId, Number(a) || 10, { zone: Number(z) as ZoneId, dirX: -Math.sin(player.facing), dirZ: -Math.cos(player.facing) });
    }
    else if (cmd === "nearDowned") {
      // Stand beside the nearest downed teammate, facing them.
      let best: PlayerStateType | undefined;
      let bestD = Infinity;
      this.state.players.forEach((o, id) => {
        if (id === client.sessionId || (o.flags & FLAG.DOWNED) === 0) return;
        const d = Math.hypot(o.x - player.x, o.z - player.z);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      });
      if (!best) return;
      player.x = best.x;
      player.z = best.z + 1.0;
      player.y = best.y;
      player.facing = 0;
      player.vx = 0;
      player.vz = 0;
    } else if (cmd === "keg") {
      // D-054 QA: a powder keg a step ahead (to light, throw and watch)
      this.spawnPropAt(PropKind.BARREL, player.x - Math.sin(player.facing) * 1.3, player.z - Math.cos(player.facing) * 1.3);
    } else if (cmd === "powder") {
      // D-064 QA: a row of five kegs from 6 m ahead, 1.8 m apart, the nearest lit on a 2 s fuse (to watch the powder catch)
      const fx = -Math.sin(player.facing);
      const fz = -Math.cos(player.facing);
      let first: string | undefined;
      for (let k = 0; k < 5; k++) {
        const id = this.spawnPropAt(PropKind.BARREL, player.x + fx * (6 + k * 1.8), player.z + fz * (6 + k * 1.8));
        first ??= id;
      }
      if (first) {
        this.lit.set(first, { left: 2, owner: client.sessionId });
        const ps = this.state.props.get(first);
        if (ps) ps.fuse = fuseTenths(2);
      }
    } else if (cmd === "nearProp") {
      // Stand 1.2 m south of the closest free prop, facing it.
      let best: { x: number; y: number; z: number } | undefined;
      let bestD = Infinity;
      this.state.props.forEach((p) => {
        if (p.holder) return;
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      });
      if (!best) return;
      player.x = best.x;
      player.z = best.z + 1.2;
      player.y = best.y - 0.3;
      player.facing = 0;
      player.vx = 0;
      player.vz = 0;
    }
  }

  private finishHold(sessionId: string, propId: string, player: PlayerStateType): void {
    this.carrying.delete(sessionId);
    player.flags &= ~FLAG.CARRYING;
    const ps = this.state.props.get(propId);
    if (ps) ps.holder = "";
  }

  /** Drops whatever a departing player carries, where it hangs. */
  private dropHeld(sessionId: string, player: PlayerStateType): void {
    const held = this.carrying.get(sessionId);
    if (!held) return;
    this.physics.release(held, 0, 0, 0);
    this.finishHold(sessionId, held, player);
  }

  /** Copies a body's pose into replicated state, skipping sub-millimetre jitter to save bandwidth. */
  private writeProp(id: string, force: boolean): void {
    const pb = this.physics.props.get(id);
    const ps = this.state.props.get(id);
    if (!pb || !ps) return;
    const t = pb.body.translation();
    const q = pb.body.rotation();
    const eps = 0.002;
    if (force || Math.abs(ps.x - t.x) > eps || Math.abs(ps.y - t.y) > eps || Math.abs(ps.z - t.z) > eps) {
      ps.x = t.x;
      ps.y = t.y;
      ps.z = t.z;
    }
    if (force || Math.abs(ps.qx - q.x) > 0.002 || Math.abs(ps.qy - q.y) > 0.002 || Math.abs(ps.qz - q.z) > 0.002 || Math.abs(ps.qw - q.w) > 0.002) {
      ps.qx = q.x;
      ps.qy = q.y;
      ps.qz = q.z;
      ps.qw = q.w;
    }
  }

  private freeSlot(): number {
    for (let i = 0; i < MAX_PLAYERS; i++) if (!this.usedSlots.has(i)) return i;
    return MAX_PLAYERS - 1;
  }
}

export { CHARACTER, FLAG };
