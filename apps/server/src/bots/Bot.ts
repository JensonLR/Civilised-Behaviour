import { Client, type Room } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import {
  COMBAT,
  INTERP_DELAY_MS,
  MoveInput,
  PREDICTED_FIELDS,
  ROOM_WORLD,
  WorldState,
  createRegionWorld,
  elevToWire,
  isRegionId,
  type JoinOptions,
  stepCharacter,
  weaponToWire,
  yawToWire,
  type CollisionWorld,
  type MoveCommand,
  type MoveInputType,
  type PlayerStateType,
  type WorldStateType,
  regionWorldOpts, type RegionWorldOpts, type RegionId,
} from "@cb/shared";

export interface BotFrame {
  moveF: number;
  moveR: number;
  /** Camera yaw in radians. */
  yaw: number;
  buttons: number;
  /** Combat: the direction of a shot (defaults to the camera yaw / level), and the weapon wanted in hand (weapons.ts id; -1 or absent = none). */
  aimYaw?: number;
  aimElev?: number;
  weapon?: number;
}

/** Decides what the bot does on a given local input tick. `bot` gives access to what THIS client displays (rendered positions of others). */
export type Behaviour = (tick: number, self: PlayerStateType, bot: Bot) => BotFrame;

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
  /**
   * Reconciler drift in POSITION, metres: persistent component (ema) and the worst recent correction (peak), folded per reconcile exactly as the SDK folds its own (ema 0.1, peak x0.9).
   * Not the SDK's meter: that one takes the largest change over every predicted field, so a server-owned flag (a crate picked up, a crouch) read as 10 "metres" on every carrying route.
   */
  driftEma: number;
  driftPeak: number;
  /** Largest per-reconcile POSITION correction (x/y/z only), metres. Flag flips (down, carry...) are not "corrections". */
  correctionMax: number;
  /** Mean positional correction per reconcile after warm-up, metres. */
  correctionMean: number;
  /** D-047: every counted correction with the bot's tick (capped), so a test can tell the one-off snap at a server-forced change of motion from steady tracking. */
  corrections: { tick: number; mag: number }[];
}

/**
 * Headless client with the same prediction wiring as the browser (`net/Session.ts`): used for
 * netcode verification under simulated latency and for load tests. Lives in the server package
 * because it is test/ops tooling, never shipped to players.
 */
export class Bot {
  /** The region's world with the crossing as the campaign has it: follows the room through sailing and a fallen bridge, as the browser does. */
  world: CollisionWorld;
  private worldKey = "";
  private readonly predict: Predict<WorldStateType>;
  private readonly input: MoveHandle;
  private readonly pops: number[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickNo = 0;
  private correctionMax = 0;
  private readonly posDrift = { ema: 0, peak: 0 };
  private correctionSum = 0;
  private correctionCount = 0;
  private readonly correctionLog: { tick: number; mag: number }[] = [];
  private lastReconcileSeq = -1;
  private lastRender: { x: number; z: number; t: number } | undefined;
  private reconciler: ReturnType<Predict<WorldStateType>["reconciler"]> | undefined;

  private constructor(
    readonly room: Room<WorldStateType>,
    private readonly behaviour: Behaviour,
  ) {
    this.world = this.freshWorld();
    this.predict = Predict.get(room, { mode: "lerp", delay: INTERP_DELAY_MS }) as Predict<WorldStateType>;
    // Remote players are drawn interpolated INTERP_DELAY_MS behind, exactly as in the browser (net/Session.ts): what a bot "sees" is what a player sees.
    this.predict.attachAll("players", { x: "lerp", y: "lerp", z: "lerp", vx: "lerp", vz: "lerp", facing: { mode: "lerp", angle: true } } as never);
    this.input = room.input({ type: MoveInput, mode: "reliable" }) as unknown as MoveHandle;
  }

  static async create(url: string, name: string, behaviour: Behaviour, extra: Partial<JoinOptions> = {}): Promise<Bot> {
    const room = await new Client(url).create<WorldStateType>(ROOM_WORLD, { name, ...extra }, WorldState as never);
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

  /** The world as the room builds it (`regionWorldOpts`: the crossing's bridge AND the outpost's stage and wire), keyed so a change rebuilds it. */
  private worldSpec(): { region: RegionId; opts: RegionWorldOpts; key: string } {
    const st = this.room.state;
    const region = isRegionId(st.region) ? st.region : "hollowmere";
    const opts = regionWorldOpts(st.campaign ?? "", st.settlements ?? "", region, st.powers ?? "");
    return { region, opts, key: `${region}|${opts.bridge ?? "intact"}|${opts.outpost ?? "none"}|${opts.telegraph ? 1 : 0}` };
  }

  private freshWorld(): CollisionWorld {
    const w = this.worldSpec();
    this.worldKey = w.key;
    return createRegionWorld(w.region, this.room.state.seed, w.opts);
  }

  /** Rebuilds the world when the region, the crossing or the outpost changed (the reconciler's step reads `this.world` each time). */
  private syncWorld(): void {
    if (this.worldSpec().key !== this.worldKey) this.world = this.freshWorld();
  }

  get self(): PlayerStateType | undefined {
    return this.room.state.players.get(this.room.sessionId);
  }

  /**
   * Where THIS client draws another player right now: the SDK's interpolated (lerp, INTERP_DELAY_MS behind) value, i.e. exactly what a human
   * would aim at. This is the reference for "hits land where the shooter saw them".
   */
  rendered(p: PlayerStateType): { x: number; y: number; z: number; facing: number } {
    const v = (f: string) => this.predict.value(p as never, f as never) as number;
    return { x: v("x"), y: v("y"), z: v("z"), facing: v("facing") };
  }

  /** The server-side ids and states of everyone else in the room. */
  others(): [string, PlayerStateType][] {
    const out: [string, PlayerStateType][] = [];
    this.room.state.players.forEach((p, id) => id !== this.room.sessionId && out.push([id, p]));
    return out;
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
      driftEma: this.posDrift.ema,
      driftPeak: this.posDrift.peak,
      correctionMax: this.correctionMax,
      correctionMean: this.correctionCount ? this.correctionSum / this.correctionCount : 0,
      corrections: this.correctionLog.slice(),
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
    this.syncWorld();
    const now = performance.now();
    const steps = this.predict.tick(now);
    for (let i = 0; i < steps; i++) {
      const f = this.behaviour(this.tickNo++, me, this);
      const d = this.input.data;
      d.moveF = Math.round(Math.max(-1, Math.min(1, f.moveF)) * 127);
      d.moveR = Math.round(Math.max(-1, Math.min(1, f.moveR)) * 127);
      d.yaw = yawToWire(f.yaw);
      d.buttons = f.buttons;
      d.aimYaw = yawToWire(f.aimYaw ?? f.yaw);
      d.aimElev = elevToWire(f.aimElev ?? 0);
      d.weapon = weaponToWire((f.weapon ?? -1) as never);
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
      this.posDrift.ema += (mag - this.posDrift.ema) * 0.1;
      this.posDrift.peak = Math.max(mag, this.posDrift.peak * 0.9);
      this.correctionSum += mag;
      this.correctionCount++;
      if (this.correctionLog.length < 4096) this.correctionLog.push({ tick: this.tickNo, mag });
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

/** Yaw and elevation that point from the eye of a body standing at (x, y, z) at a world point (the aim a human's crosshair would give). */
export function aimAt(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { aimYaw: number; aimElev: number } {
  const eye = from.y + COMBAT.eyeHeight;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return { aimYaw: Math.atan2(-dx, -dz), aimElev: Math.atan2(to.y - eye, Math.hypot(dx, dz)) };
}

export { PREDICTED_FIELDS };
