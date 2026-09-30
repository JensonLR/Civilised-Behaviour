import { CloseCode, Room, type Client } from "@colyseus/core";
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
  WEAPONS,
  applyOutcome,
  askingToll,
  answerParley,
  consequenceLines,
  createRegionWorld,
  findStation,
  isNpcKey,
  isRegionId,
  leverageOf,
  newCampaign,
  npcKey,
  openParley,
  regionProps,
  regionSpawn,
  serializeCampaign,
  stationsFor,
  type BridgeState,
  type CampaignState,
  type NpcSpec,
  type RegionId,
  type ScenarioOutcome,
  type ScenarioView,
} from "@cb/shared";
import { HISTORY_KEYS, applyClientAppearance, decodeSpec, encodeSpec, generateCharacter, specFromUntrusted } from "@cb/procedural";
import { log } from "../log.ts";
import { metrics } from "../metrics.ts";
import { getRoomConfig } from "../roomConfig.ts";
import { PhysicsWorld, initRapier } from "../physics.ts";
import { Casualties, type HitInfo } from "../systems/Casualties.ts";
import { Combat } from "../systems/Combat.ts";
import { Scenario } from "../systems/Scenario.ts";
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
  private travel!: Travel;
  private scenario: Scenario | undefined;
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

  override async onCreate(options: JoinOptions): Promise<void> {
    const seed = Number.isInteger(options?.seed) ? (options.seed as number) >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.state.seed = seed;
    this.state.code = generateJoinCode();
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
    this.campaign = newCampaign(seed);
    const region: RegionId = isRegionId(options?.region) ? options.region : "hollowmere";
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
    this.buildRegion(region);
    this.travel = new Travel({
      connectedSlots: () => this.connectedSlots(),
      current: () => this.state.region as RegionId,
      enterRegion: (to) => this.enterRegion(to),
      notice: (text) => this.broadcast("notice", { text }),
      sync: (st) => {
        this.state.travelPhase = st.phase;
        this.state.travelTo = st.to;
        this.state.travelReady = st.ready & 0xff;
        this.state.travelLeft = Math.min(255, Math.max(0, Math.ceil(st.left)));
      },
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
        rng: new Rng(seed ^ 0x5eed_c0de),
        emitHit: (e) => this.broadcast("hit", e),
        emitSever: (e) => this.broadcast("sever", e),
        dismemberment: () => this.state.dismemberment,
        limbsChanged: (sid) => this.refreshProsthetic(sid),
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
    });
    this.startScenario(region);
    void this.setMetadata({ code: this.state.code });
    // Campaigns are friends-first: unlisted, reachable only via join code or direct room id.
    void this.setPrivate(true);
    metrics.rooms++;
    log.info("room.create", { roomId: this.roomId, code: this.state.code, seed });

    this.setFixedTimestep((ctx) => {
      const t0 = performance.now();
      this.tickDt = ctx.dt;
      this.simT += ctx.dt;
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
      this.syncClock(false);
      if (!sailing) this.scenario?.tick(ctx.dt);
      this.reapNpcs();
      this.casualties.tick(ctx.dt);
      this.combat.tick(ctx.dt);
      this.physics.step(ctx.dt);
      for (const [id, pb] of this.physics.props) if (pb.holder !== "" || !pb.body.isSleeping()) this.writeProp(id, false);
      this.travel.tick(ctx.dt); // last: a landfall swaps the world, which nothing above may still be holding
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
      if (typeof msg?.option === "number") this.scenario?.onPick(client.sessionId, msg.option);
    });
    this.onMessage("parleyClose", (client) => this.scenario?.onParleyClose(client.sessionId));

    this.onMessage("ping", (client, msg: { t?: number }) => {
      client.send("pong", { t: typeof msg?.t === "number" ? msg.t : 0, serverTime: Date.now() });
    });
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const slot = this.freeSlot();
    this.usedSlots.add(slot);
    const player = new PlayerState();
    player.name = sanitizeDisplayName(options?.name);
    player.slot = slot;
    player.connected = true;
    // Untrusted look -> valid canonical spec; a fresh join never carries history (that is campaign-owned).
    const incoming = specFromUntrusted(options?.look, seedFromString(client.sessionId));
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
    this.combat.onJoin(client.sessionId, player);
    this.syncClock(true); // a joiner's first state must carry a fresh world age
    metrics.players++;
    metrics.physicsBodies++;
    log.info("room.join", { roomId: this.roomId, sessionId: client.sessionId, slot, name: player.name });
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const consented = code === CloseCode.CONSENTED;
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
    this.travel.onLeave(player.slot);
    metrics.players--;
    log.info("room.leave", { roomId: this.roomId, sessionId: client.sessionId, consented });
  }

  /** Refreshes `state.worldMs` (the world's age) at most every CLOCK_SYNC_MS unless forced. */
  private syncClock(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastClockSync < CLOCK_SYNC_MS) return;
    this.lastClockSync = now;
    this.state.worldMs = now - this.bornAt;
  }

  override onDispose(): void {
    this.scenario?.dispose();
    this.scenario = undefined;
    metrics.rooms--;
    if (this.physics) {
      metrics.physicsBodies -= this.physics.props.size; // player capsules are released in onLeave
      this.physics.dispose();
    }
    log.info("room.dispose", { roomId: this.roomId, code: this.state.code });
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
    // The places you can USE come before props: the Warden and the pier (scenario), then the map table, notice board and dock.
    if ((pressed & BUTTON.INTERACT) !== 0 && this.useStation(sessionId, player, held)) return;

    if (held) {
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
    if (this.scenario?.onInteract(sessionId, player, held)) return true;
    if (held) return false; // arms full: a carried prop is dropped or thrown, never "used" on a table
    const st = findStation(this.state.region as RegionId, player.x, player.z, player.facing);
    if (!st) return false;
    if (st.kind === "map" || st.kind === "dock") this.clients.getById(sessionId)?.send("station", { kind: "map" });
    else if (st.kind === "paper") this.clients.getById(sessionId)?.send("station", { kind: "paper" });
    else return false; // pier / warden belong to the scenario
    return true;
  }

  /** A sailing may only be put to the vote from the map table or the dock (the client offers it there; the server does not take its word for it). */
  private atMapRoom(p: PlayerStateType): boolean {
    for (const st of stationsFor(this.state.region as RegionId)) {
      if ((st.kind === "map" || st.kind === "dock") && Math.hypot(p.x - st.x, p.z - st.z) <= st.r + MAP_REACH_SLACK) return true;
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
    const bridge = this.campaign.crossing.bridge;
    this.world = createRegionWorld(id, seed, { bridge });
    this.physics = new PhysicsWorld(this.world);
    this.state.props.clear();
    for (const spawn of regionProps(id, seed, this.world)) {
      const body = this.physics.spawnProp(spawn, this.world.terrainHeight(spawn.x, spawn.z));
      if (!body) continue;
      const ps = new PropState();
      ps.kind = spawn.kind;
      ps.holder = "";
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

  /** Kessar Reach carries the crossing scenario; Hollowmere has none. Called once the room's systems exist (the cast is spawned through them). */
  private startScenario(id: RegionId): void {
    if (id !== "kessar") return;
    this.scenario = new Scenario(this.scenarioHost());
    this.scenario.start();
  }

  /** The sailing has finished: tear the old region down, stand the new one up, put everybody on its landing. Runs at the end of a server tick. */
  private enterRegion(to: RegionId): void {
    this.scenario?.dispose();
    this.scenario = undefined;
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
    this.state.region = to;
    this.buildRegion(to);
    this.startScenario(to);
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
    this.campaign = applyOutcome(before, o);
    this.state.campaign = serializeCampaign(this.campaign);
    this.state.campaignRev = (this.state.campaignRev + 1) & 0xffff;
    for (const line of consequenceLines(before, this.campaign).slice(0, 3)) this.broadcast("notice", { text: line });
    log.info("campaign.outcome", { roomId: this.roomId, resolution: o.resolution, day: this.campaign.day });
  }

  private scenarioHost(): ConstructorParameters<typeof Scenario>[0] {
    return {
      players: this.party,
      worldMs: () => performance.now() - this.bornAt,
      campaign: () => this.campaign,
      commit: (o) => this.commitOutcome(o),
      spawnNpc: (spec) => this.spawnNpc(spec),
      removeNpc: (key) => this.removeNpc(key),
      stepNpc: (key, cmd) => this.stepNpc(key, cmd),
      explode: (x, y, z, radius) => {
        const b = WEAPONS[WEAPON.CANNON].ranged!.blast!;
        this.combat.explode("", WEAPON.CANNON, { ...b, radius }, x, y, z, "");
      },
      consumeProp: (id) => this.consumeProp(id),
      propKind: (id) => this.state.props.get(id)?.kind,
      rebuildBridge: (b) => this.rebuildBridge(b),
      publish: (v: ScenarioView) => this.publishScenario(JSON.stringify(v)),
      send: (sid, type, msg) => this.clients.getById(sid)?.send(type, msg),
      negotiation: { askingToll, leverageOf, openParley, answerParley },
      seed: this.state.seed,
      groundY: (x, z) => this.world.terrainHeight(x, z),
    };
  }

  /** The charge brought the bridge down: new analytic world (what people walk on) and new static colliders (what props land on). */
  private rebuildBridge(bridge: BridgeState): void {
    this.world = createRegionWorld(this.state.region as RegionId, this.state.seed, { bridge });
    this.physics.replaceStatic(this.world);
  }

  private consumeProp(id: string): void {
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
    p.look = encodeSpec(generateCharacter(spec.lookSeed));
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
    this.combat.onJoin(key, p);
    return true;
  }

  private removeNpc(key: string): void {
    const p = this.state.players.get(key);
    if (!p) return;
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
      if (!p.npc) return;
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
    if (p && !wasDown) this.scenario?.onDamage(sessionId, hit?.by ?? "", hit?.zone ?? -1, (p.flags & FLAG.DOWNED) !== 0);
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
    else if (cmd?.startsWith("tp:")) {
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
