import { CloseCode, Room, type Client } from "@colyseus/core";
import {
  BUTTON,
  CASUALTY,
  CHARACTER,
  CollisionWorld,
  FLAG,
  INTERACT,
  PropState,
  findInteractTarget,
  holdPosition,
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
  WorldState,
  createArena,
  createCharState,
  sanitizeDisplayName,
  spawnPoint,
  stepCharacter,
  type JoinOptions,
  type MoveInputType,
  type PlayerStateType,
  type WorldStateType,
  type ZoneId,
} from "@cb/shared";
import { HISTORY_KEYS, applyClientAppearance, decodeSpec, encodeSpec, specFromUntrusted } from "@cb/procedural";
import { log } from "../log.ts";
import { metrics } from "../metrics.ts";
import { getRoomConfig } from "../roomConfig.ts";
import { PhysicsWorld, initRapier } from "../physics.ts";
import { Casualties, type HitInfo } from "../systems/Casualties.ts";

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

/** How long a dropped player's slot is held for reconnection. */
const RECONNECT_WINDOW_S = 45;

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
  /** Last buttons seen per player, for rising-edge detection (interact/throw). */
  private prevButtons = new Map<string, number>();
  /** sessionId -> prop id currently carried. */
  private carrying = new Map<string, string>();
  private readonly hold = { x: 0, y: 0, z: 0 };
  private usedSlots = new Set<number>();
  private emptyTicks = new Map<string, number>();
  private lastSetLook = new Map<string, number>();
  private frameBudget = new Map<string, number>();

  override async onCreate(options: JoinOptions): Promise<void> {
    const seed = Number.isInteger(options?.seed) ? (options.seed as number) >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.state.seed = seed;
    this.state.code = generateJoinCode();
    this.world = createArena(seed);
    await initRapier();
    this.physics = new PhysicsWorld(this.world);
    for (const spawn of scatterProps(seed, this.world.terrain, 14)) {
      const body = this.physics.spawnProp(spawn, this.world.terrainHeight(spawn.x, spawn.z));
      if (!body) continue;
      const ps = new PropState();
      ps.kind = spawn.kind;
      ps.holder = "";
      this.state.props.set(body.id, ps);
      this.writeProp(body.id, true);
    }
    metrics.physicsBodies += this.physics.props.size;
    this.casualties = new Casualties(
      {
        players: this.state.players,
        world: this.world,
        dropHeldProp: (sid) => {
          const p = this.state.players.get(sid);
          if (p) this.dropHeld(sid, p);
        },
        routSpawn: (slot) => spawnPoint(slot, MAX_PLAYERS),
        notify: (text) => this.broadcast("notice", { text }),
        rng: new Rng(seed ^ 0x5eed_c0de),
        emitHit: (e) => this.broadcast("hit", e),
      },
      { routSeconds: getRoomConfig().routSeconds },
    );
    void this.setMetadata({ code: this.state.code });
    // Campaigns are friends-first: unlisted, reachable only via join code or direct room id.
    void this.setPrivate(true);
    metrics.rooms++;
    log.info("room.create", { roomId: this.roomId, code: this.state.code, seed });

    this.setFixedTimestep((ctx) => {
      const t0 = performance.now();
      this.state.players.forEach((player, sessionId) => {
        let frames = this.inputs.get(sessionId).drain();
        const budget = Math.min(INPUT_BUDGET_MAX, (this.frameBudget.get(sessionId) ?? INPUT_BUDGET_MAX) + INPUT_BUDGET_REFILL);
        const allowed = Math.floor(budget);
        if (frames.length > allowed) {
          metrics.inputFramesDropped += frames.length - allowed;
          frames = frames.slice(0, allowed);
        }
        this.frameBudget.set(sessionId, budget - frames.length);
        if (frames.length > 0) {
          this.emptyTicks.set(sessionId, 0);
          for (const cmd of frames) {
            stepCharacter(player, cmd, ctx.dt, this.world);
            this.handleInteraction(sessionId, player, cmd);
          }
        } else {
          const empty = (this.emptyTicks.get(sessionId) ?? 0) + 1;
          this.emptyTicks.set(sessionId, empty);
          if (empty > IDLE_AFTER_TICKS) stepCharacter(player, IDLE_COMMAND, ctx.dt, this.world);
        }
        this.physics.syncPlayer(sessionId, player.x, player.y, player.z, (player.flags & (FLAG.CROUCHING | FLAG.DOWNED)) !== 0);
        const held = this.carrying.get(sessionId);
        if (held) {
          holdPosition(player, this.hold);
          this.physics.moveHeld(held, this.hold.x, this.hold.y, this.hold.z, player.facing);
        }
      });
      this.casualties.tick(ctx.dt);
      this.physics.step(ctx.dt);
      for (const [id, pb] of this.physics.props) if (pb.holder !== "" || !pb.body.isSleeping()) this.writeProp(id, false);
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
    player.title = "";
    player.health = CASUALTY.maxHealth;
    player.wounds = 0; // numeric schema fields decode as undefined until first assigned
    player.reviveProgress = 0;
    player.reviver = "";
    player.dragger = "";
    const sp = spawnPoint(slot, MAX_PLAYERS);
    const c = createCharState(sp.x, sp.z, this.world);
    Object.assign(player, c);
    this.state.players.set(client.sessionId, player);
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
    this.dropHeld(client.sessionId, player);
    this.physics.removePlayer(client.sessionId);
    metrics.physicsBodies--;
    this.prevButtons.delete(client.sessionId);
    this.usedSlots.delete(player.slot);
    this.emptyTicks.delete(client.sessionId);
    this.lastSetLook.delete(client.sessionId);
    this.frameBudget.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    metrics.players--;
    log.info("room.leave", { roomId: this.roomId, sessionId: client.sessionId, consented });
  }

  override onDispose(): void {
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
    if (pressed === 0) return;
    const held = this.carrying.get(sessionId);

    if (held) {
      if (pressed & (BUTTON.INTERACT | BUTTON.THROW)) {
        const throwing = (pressed & BUTTON.THROW) !== 0;
        const dirX = -Math.sin(player.facing);
        const dirZ = -Math.cos(player.facing);
        this.physics.release(
          held,
          player.vx + (throwing ? dirX * INTERACT.throwSpeed : 0),
          throwing ? INTERACT.throwLift : 0,
          player.vz + (throwing ? dirZ * INTERACT.throwSpeed : 0),
        );
        this.finishHold(sessionId, held, player);
      }
      return;
    }
    if (pressed & BUTTON.INTERACT) {
      const target = findInteractTarget<string>(player, (cb) => this.state.props.forEach((p, id) => cb(id, p)));
      if (target === undefined || !this.physics.hold(target, sessionId)) return;
      this.carrying.set(sessionId, target);
      player.flags |= FLAG.CARRYING;
      const ps = this.state.props.get(target);
      if (ps) ps.holder = sessionId;
    }
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
    player.look = encodeSpec(applyClientAppearance(current, incoming));
  }

  /** The single entry point for harm (weapons, explosions, friendly fire, debug). Health 0 puts a player down, never out. */
  damagePlayer(sessionId: string, amount: number, hit?: HitInfo): void {
    this.casualties.damage(sessionId, amount, hit);
  }

  /** QA-only commands (see docs/NETWORKING.md). Registered only when config.debugCommands is true. */
  private debugCommand(client: Client, cmd: string | undefined): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (cmd === "hurt") this.damagePlayer(client.sessionId, 40);
    else if (cmd === "down") this.damagePlayer(client.sessionId, 1000);
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
