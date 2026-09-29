import { Client, type Room } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import {
  MoveInput,
  PREDICTED_FIELDS,
  ROOM_WORLD,
  WorldState,
  createArena,
  stepCharacter,
  yawToWire,
  type CollisionWorld,
  type MoveCommand,
  type MoveInputType,
  type PlayerStateType,
  type WorldStateType,
} from "@cb/shared";

export interface BotFrame {
  moveF: number;
  moveR: number;
  /** Camera yaw in radians. */
  yaw: number;
  buttons: number;
}

/** Decides what the bot does on a given local input tick. */
export type Behaviour = (tick: number, self: PlayerStateType) => BotFrame;

interface MoveHandle {
  readonly data: MoveInputType;
  send(): void;
}

export interface BotStats {
  ticks: number;
  /** Rendered-position change per frame that the bot's own velocity does not explain (visible "pops"), metres. */
  popMax: number;
  popP99: number;
  popCount: number;
  /** Reconciler drift: persistent component (ema) and worst single divergence (peak) vs the server, metres. */
  driftEma: number;
  driftPeak: number;
  /** Largest per-reconcile POSITION correction (x/y/z only), metres. Flag flips (down, carry...) are not "corrections". */
  correctionMax: number;
  /** Mean positional correction per reconcile after warm-up, metres. */
  correctionMean: number;
}

/**
 * Headless client with the same prediction wiring as the browser (`net/Session.ts`): used for
 * netcode verification under simulated latency and for load tests. Lives in the server package
 * because it is test/ops tooling, never shipped to players.
 */
export class Bot {
  readonly world: CollisionWorld;
  private readonly predict: Predict<WorldStateType>;
  private readonly input: MoveHandle;
  private readonly pops: number[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickNo = 0;
  private correctionMax = 0;
  private correctionSum = 0;
  private correctionCount = 0;
  private lastReconcileSeq = -1;
  private lastRender: { x: number; z: number; t: number } | undefined;
  private reconciler: ReturnType<Predict<WorldStateType>["reconciler"]> | undefined;

  private constructor(
    readonly room: Room<WorldStateType>,
    private readonly behaviour: Behaviour,
  ) {
    this.world = createArena(room.state.seed);
    this.predict = Predict.get(room, { mode: "lerp", delay: 100 }) as Predict<WorldStateType>;
    this.input = room.input({ type: MoveInput, mode: "reliable" }) as unknown as MoveHandle;
  }

  static async create(url: string, name: string, behaviour: Behaviour): Promise<Bot> {
    const room = await new Client(url).create<WorldStateType>(ROOM_WORLD, { name }, WorldState as never);
    return Bot.ready(room, behaviour);
  }

  static async joinById(url: string, roomId: string, name: string, behaviour: Behaviour): Promise<Bot> {
    const room = await new Client(url).joinById<WorldStateType>(roomId, { name }, WorldState as never);
    return Bot.ready(room, behaviour);
  }

  private static async ready(room: Room<WorldStateType>, behaviour: Behaviour): Promise<Bot> {
    if (!room.state.code) await new Promise<void>((r) => room.onStateChange.once(() => r()));
    return new Bot(room, behaviour);
  }

  get self(): PlayerStateType | undefined {
    return this.room.state.players.get(this.room.sessionId);
  }

  /** Predicted (locally simulated) state, or undefined until the player exists. */
  get predicted(): PlayerStateType | undefined {
    return this.reconciler?.state as PlayerStateType | undefined;
  }

  start(): void {
    this.timer = setInterval(() => this.frame(), 1000 / 60);
  }

  /** Simulates a client hitch (GC pause, tab throttle): no frames for `ms`, then the fixed-step clock bursts to catch up. */
  async hitch(ms: number): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await new Promise((r) => setTimeout(r, ms));
    this.start();
  }

  async stop(): Promise<BotStats> {
    if (this.timer) clearInterval(this.timer);
    await this.room.leave(true);
    return this.stats();
  }

  stats(): BotStats {
    const sorted = [...this.pops].sort((a, b) => a - b);
    return {
      ticks: this.tickNo,
      popMax: sorted[sorted.length - 1] ?? 0,
      popP99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      popCount: this.pops.filter((p) => p > 0.05).length,
      driftEma: this.reconciler?.drift.ema ?? 0,
      driftPeak: this.reconciler?.drift.peak ?? 0,
      correctionMax: this.correctionMax,
      correctionMean: this.correctionCount ? this.correctionSum / this.correctionCount : 0,
    };
  }

  private frame(): void {
    const me = this.self;
    if (!me) return;
    if (!this.reconciler) {
      this.reconciler = this.predict.reconciler(me, {
        input: this.input,
        fields: PREDICTED_FIELDS as unknown as (keyof PlayerStateType & string)[],
        step: (ctx: { dt: number }, state: PlayerStateType, cmd: MoveInputType) =>
          stepCharacter(state, cmd as MoveCommand, ctx.dt, this.world),
        smoothMs: 65,
        // Enables drift telemetry (it is off unless watched); the tolerance is huge so it never warns.
        warnOnDivergence: 1e9,
      } as never);
    }
    const now = performance.now();
    const steps = this.predict.tick(now);
    for (let i = 0; i < steps; i++) {
      const f = this.behaviour(this.tickNo++, me);
      const d = this.input.data;
      d.moveF = Math.round(Math.max(-1, Math.min(1, f.moveF)) * 127);
      d.moveR = Math.round(Math.max(-1, Math.min(1, f.moveR)) * 127);
      d.yaw = yawToWire(f.yaw);
      d.buttons = f.buttons;
      this.input.send();
    }
    // Skip the first 2 s: the spawn snap (client starts at default state, server truth arrives) is expected.
    // Only positional fields count: server-owned flag changes (going down, carrying...) adopt as "corrections" of 16..256
    // in the reconciler's own numbers but are not visible prediction error.
    const rc = this.reconciler as unknown as { reconcileSeq: number; lastCorrection: Record<string, number> };
    if (this.tickNo > 60 && rc.reconcileSeq !== this.lastReconcileSeq) {
      const c = rc.lastCorrection;
      const mag = Math.hypot(c.x ?? 0, c.y ?? 0, c.z ?? 0);
      this.correctionMax = Math.max(this.correctionMax, mag);
      this.correctionSum += mag;
      this.correctionCount++;
    }
    this.lastReconcileSeq = rc.reconcileSeq;
    // Measure what a player would see: rendered position vs. what the bot's velocity explains.
    const x = this.predict.value(me as never, "x" as never);
    const z = this.predict.value(me as never, "z" as never);
    const t = now / 1000;
    if (this.lastRender) {
      const dt = t - this.lastRender.t;
      const st = this.reconciler.state as PlayerStateType;
      const vx = st.vx;
      const vz = st.vz;
      const dx = x - this.lastRender.x - vx * dt;
      const dz = z - this.lastRender.z - vz * dt;
      // Ignore frames where the fixed-step clock caught up (render interpolation lags one step).
      this.pops.push(Math.hypot(dx, dz));
    }
    this.lastRender = { x, z, t };
  }
}

/** Walks a wide circle in the flat spawn clearing: no collisions, so all error is netcode. */
export const circleWalker: Behaviour = (tick) => ({
  moveF: 1,
  moveR: 0,
  yaw: (tick / 30) * 0.6,
  buttons: 0,
});

/** Runs into the stone wall at z=-12, slides along it, backs off, repeats: exercises collision prediction. */
export const wallBumper: Behaviour = (tick) => {
  const phase = Math.floor(tick / 60) % 4;
  return {
    moveF: phase === 3 ? -0.8 : 1,
    moveR: phase === 1 ? 0.7 : phase === 2 ? -0.7 : 0,
    yaw: 0,
    buttons: phase === 2 ? 1 /* sprint */ : 0,
  };
};

export { PREDICTED_FIELDS };
