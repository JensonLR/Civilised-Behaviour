import { CloseCode, Room, type Client } from "@colyseus/core";
import {
  CHARACTER,
  CollisionWorld,
  FLAG,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  MAX_MESSAGES_PER_SECOND,
  MAX_PLAYERS,
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
  type WorldStateType,
} from "@cb/shared";
import { log } from "../log.ts";
import { metrics } from "../metrics.ts";

/**
 * Server state must be a pure function of the input sequence, so an empty tick skips the player
 * (client and server then agree exactly). Only after a genuine stall do we apply zero-input steps so
 * a stalled/disconnected player lands and comes to rest instead of hanging mid-air at speed.
 */
const IDLE_AFTER_TICKS = 6;
const IDLE_COMMAND = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 } as const;

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
  private usedSlots = new Set<number>();
  private emptyTicks = new Map<string, number>();

  override onCreate(options: JoinOptions): void {
    const seed = Number.isInteger(options?.seed) ? (options.seed as number) >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.state.seed = seed;
    this.state.code = generateJoinCode();
    this.world = createArena(seed);
    void this.setMetadata({ code: this.state.code });
    // Campaigns are friends-first: unlisted, reachable only via join code or direct room id.
    void this.setPrivate(true);
    metrics.rooms++;
    log.info("room.create", { roomId: this.roomId, code: this.state.code, seed });

    this.setFixedTimestep((ctx) => {
      const t0 = performance.now();
      this.state.players.forEach((player, sessionId) => {
        const frames = this.inputs.get(sessionId).drain();
        if (frames.length > 0) {
          this.emptyTicks.set(sessionId, 0);
          for (const cmd of frames) stepCharacter(player, cmd, ctx.dt, this.world);
          return;
        }
        const empty = (this.emptyTicks.get(sessionId) ?? 0) + 1;
        this.emptyTicks.set(sessionId, empty);
        if (empty > IDLE_AFTER_TICKS) stepCharacter(player, IDLE_COMMAND, ctx.dt, this.world);
      });
      const ms = performance.now() - t0;
      metrics.recordTick(ms);
      if (ms > ctx.dtMs) {
        metrics.tickOverruns++;
        log.warn("room.tick_overrun", { roomId: this.roomId, ms: Math.round(ms * 100) / 100, budgetMs: ctx.dtMs });
      }
    }, TICK_RATE);

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
    const sp = spawnPoint(slot, MAX_PLAYERS);
    const c = createCharState(sp.x, sp.z, this.world);
    Object.assign(player, c);
    this.state.players.set(client.sessionId, player);
    metrics.players++;
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
    this.usedSlots.delete(player.slot);
    this.emptyTicks.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    metrics.players--;
    log.info("room.leave", { roomId: this.roomId, sessionId: client.sessionId, consented });
  }

  override onDispose(): void {
    metrics.rooms--;
    log.info("room.dispose", { roomId: this.roomId, code: this.state.code });
  }

  private freeSlot(): number {
    for (let i = 0; i < MAX_PLAYERS; i++) if (!this.usedSlots.has(i)) return i;
    return MAX_PLAYERS - 1;
  }
}

export { CHARACTER, FLAG };
