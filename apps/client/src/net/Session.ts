import { Client, type Room } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import {
  CollisionWorld,
  MoveInput,
  PREDICTED_FIELDS,
  ROOM_WORLD,
  WorldState,
  createArena,
  stepCharacter,
  type JoinOptions,
  type MoveCommand,
  type MoveInputType,
  type PlayerStateType,
  type PropStateType,
  type WorldStateType,
} from "@cb/shared";

export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:2567`;
}

function httpUrl(): string {
  return serverUrl().replace(/^ws/, "http");
}

/** Stable per-browser identity until the Steam adapter supplies a real one (PlatformIdentity). */
function identityToken(): string {
  try {
    let t = localStorage.getItem("cb.identity");
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem("cb.identity", t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}

export class JoinError extends Error {}

/** The SDK's InputHandle, narrowed to the one input schema this game sends. */
interface MoveHandle {
  readonly data: MoveInputType;
  send(): void;
}

/** Resolves a join code to a room id via the server's rate-limited lookup endpoint. */
async function resolveCode(code: string): Promise<string> {
  const res = await fetch(`${httpUrl()}/campaign/${encodeURIComponent(code.toUpperCase())}`);
  if (res.status === 404) throw new JoinError("No campaign with that code (or it is full).");
  if (res.status === 429) throw new JoinError("Too many attempts - wait a moment.");
  if (!res.ok) throw new JoinError("Invalid campaign code.");
  return ((await res.json()) as { roomId: string }).roomId;
}

export interface LocalPrediction {
  /** Current predicted (true) character state, mutated by the reconciler. */
  state: PlayerStateType;
  value(field: (typeof PREDICTED_FIELDS)[number]): number;
}

export class Session {
  readonly world: CollisionWorld;
  readonly predict: Predict<WorldStateType>;
  private readonly input: MoveHandle;
  private reconciler: ReturnType<Predict<WorldStateType>["reconciler"]> | undefined;
  /** Smoothed round-trip time in ms (SDK clock). */
  rttMs = 0;

  private constructor(
    readonly room: Room<WorldStateType>,
  ) {
    this.world = createArena(room.state.seed);
    this.predict = Predict.get(room, { mode: "lerp", delay: 100 }) as Predict<WorldStateType>;
    this.predict.attachAll("players", { x: "lerp", y: "lerp", z: "lerp", vx: "lerp", vz: "lerp", facing: { mode: "lerp", angle: true } } as never);
    this.predict.attachAll("props", { x: "lerp", y: "lerp", z: "lerp", qx: "lerp", qy: "lerp", qz: "lerp", qw: "lerp" } as never);
    this.input = room.input({ type: MoveInput, mode: "reliable" }) as unknown as MoveHandle;
  }

  /** Resolves once the first full state (seed, code, existing players) has been decoded. */
  private static stateReady(room: Room<WorldStateType>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (room.state.code) return resolve();
      const timer = setTimeout(() => reject(new JoinError("The server did not send the campaign state.")), 8000);
      room.onStateChange.once(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  static async create(name: string, look?: string): Promise<Session> {
    const client = new Client(serverUrl());
    const options: JoinOptions = { name, token: identityToken(), ...(look ? { look } : {}) };
    const room = await client.create<WorldStateType>(ROOM_WORLD, options, WorldState as never);
    await Session.stateReady(room);
    return new Session(room);
  }

  static async join(code: string, name: string, look?: string): Promise<Session> {
    const roomId = await resolveCode(code);
    const client = new Client(serverUrl());
    const options: JoinOptions = { name, token: identityToken(), ...(look ? { look } : {}) };
    try {
      const room = await client.joinById<WorldStateType>(roomId, options, WorldState as never);
      await Session.stateReady(room);
      return new Session(room);
    } catch (e) {
      throw new JoinError(e instanceof Error ? e.message : "Could not join campaign.");
    }
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get code(): string {
    return this.room.state.code;
  }

  /** Attaches the reconciler once our own player schema instance has arrived. */
  bindLocalPlayer(): PlayerStateType | undefined {
    const me = this.room.state.players.get(this.room.sessionId);
    if (!me || this.reconciler) return me;
    this.reconciler = this.predict.reconciler(me, {
      input: this.input,
      fields: PREDICTED_FIELDS as unknown as (keyof PlayerStateType & string)[],
      step: (ctx: { dt: number }, state: PlayerStateType, cmd: MoveInputType) =>
        stepCharacter(state, cmd as MoveCommand, ctx.dt, this.world),
      smoothMs: 65,
      // Turns on the SDK's drift telemetry (it is off unless watched). The tolerance is huge so it never warns.
      warnOnDivergence: 1e9,
    } as never);
    return me;
  }

  /** Reconciler drift vs the server (metres): `ema` persistent, `peak` worst. Zero means prediction matches. */
  get drift(): { ema: number; peak: number; lastCorrection: number } {
    const r = this.reconciler as unknown as { drift: { ema: number; peak: number }; lastCorrectionMag: number } | undefined;
    return { ema: r?.drift.ema ?? 0, peak: r?.drift.peak ?? 0, lastCorrection: r?.lastCorrectionMag ?? 0 };
  }

  get local(): PlayerStateType | undefined {
    return this.room.state.players.get(this.room.sessionId);
  }

  /** Predicted state of the local player (true state, for logic). */
  get predicted(): PlayerStateType | undefined {
    return this.reconciler?.state as PlayerStateType | undefined;
  }

  /** Smoothed render value for any player field (local: predicted+corrected, remote: interpolated). */
  value(player: PlayerStateType, field: (typeof PREDICTED_FIELDS)[number]): number {
    return this.predict.value(player as never, field as never);
  }

  /** Advances the fixed-step clock. Returns how many input steps are due this frame. */
  tick(now: number): number {
    return this.predict.tick(now);
  }

  sendInput(moveF: number, moveR: number, yaw: number, buttons: number): void {
    const d = this.input.data;
    d.moveF = moveF;
    d.moveR = moveR;
    d.yaw = yaw;
    d.buttons = buttons;
    this.input.send();
  }

  leave(): void {
    void this.room.leave(true);
  }
}
