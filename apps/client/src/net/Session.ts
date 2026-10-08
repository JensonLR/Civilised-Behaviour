import { Client, type Room } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import { SaveTracker } from "./saveStatus.ts";
import {
  CollisionWorld,
  INTERP_DELAY_MS,
  MoveInput,
  PREDICTED_FIELDS,
  ROOM_WORLD,
  WorldState,
  createRegionWorld,
  isRegionId,
  parseCampaign,
  regionWorldOpts,
  worldKey,
  stepCharacter,
  type RegionWorldOpts,
  type BridgeState,
  type RegionId,
  type ScenarioTemplateId,
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

export function httpUrl(): string {
  return serverUrl().replace(/^ws/, "http");
}

/**
 * Self-service erasure (PRIVACY_DATA_MAP): the server forgets this browser's memberships (every campaign it was in; a campaign left with nobody goes), then this browser forgets
 * its identity and its list of expeditions (the settings stay: they are preferences, not records). Offered only at the front door: a room in play would save the membership
 * straight back. Never throws.
 */
export async function eraseMyRecords(): Promise<{ ok: true; campaigns: number } | { ok: false; reason: "offline" | "busy" | "refused" }> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("cb.identity");
  } catch {
    // storage blocked: nothing of ours was kept here either
  }
  let campaigns = 0;
  if (token) {
    try {
      const res = await fetch(`${httpUrl()}/privacy/erase`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity: token }) });
      if (res.status === 429) return { ok: false, reason: "busy" };
      if (!res.ok) return { ok: false, reason: "refused" };
      const body = (await res.json()) as { campaigns?: unknown };
      campaigns = typeof body.campaigns === "number" && Number.isFinite(body.campaigns) ? Math.max(0, Math.round(body.campaigns)) : 0;
    } catch {
      return { ok: false, reason: "offline" };
    }
  }
  try {
    localStorage.removeItem("cb.identity");
    localStorage.removeItem("cb.expeditions");
  } catch {
    // (blocked storage holds nothing to clear)
  }
  return { ok: true, campaigns };
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
  /** The analytic world the local player walks on: the region's, with the crossing as the campaign has it. Swapped on landfall and when a bridge falls. */
  world: CollisionWorld;
  readonly predict: Predict<WorldStateType>;
  private readonly input: MoveHandle;
  private reconciler: ReturnType<Predict<WorldStateType>["reconciler"]> | undefined;
  /** Smoothed round-trip time in ms (SDK clock). */
  rttMs = 0;
  /** Where the campaign's save stands (the server says after every save; the pause sheet can ask for one). Listening starts the moment the room object exists, so the welcome is not missed. */
  readonly saves: SaveTracker;

  private constructor(
    readonly room: Room<WorldStateType>,
    saves?: SaveTracker,
  ) {
    this.saves = saves ?? new SaveTracker();
    this.world = Session.worldFor(room.state.region, room.state.seed, Session.worldOptsOf(room.state));
    this.predict = Predict.get(room, { mode: "lerp", delay: INTERP_DELAY_MS }) as Predict<WorldStateType>;
    this.predict.attachAll("players", { x: "lerp", y: "lerp", z: "lerp", vx: "lerp", vz: "lerp", facing: { mode: "lerp", angle: true } } as never);
    this.predict.attachAll("props", { x: "lerp", y: "lerp", z: "lerp", qx: "lerp", qy: "lerp", qz: "lerp", qw: "lerp" } as never);
    this.input = room.input({ type: MoveInput, mode: "reliable" }) as unknown as MoveHandle;
  }

  /** The region the server says we are in (Hollowmere until told otherwise). */
  get region(): RegionId {
    return isRegionId(this.room.state.region) ? this.room.state.region : "hollowmere";
  }

  static bridgeOf(campaignJson: string | undefined): BridgeState {
    return (campaignJson ? parseCampaign(campaignJson)?.crossing.bridge : undefined) ?? "intact";
  }

  /** What the collision world depends on, read from the two replicated JSON strings (the server calls the same function): bridge, outpost stage, telegraph (D-035), for the region the room stands in (D-056). */
  static worldOptsOf(st: { campaign?: string; settlements?: string; region?: string }): RegionWorldOpts {
    return regionWorldOpts(st.campaign ?? "", st.settlements ?? "", isRegionId(st.region) ? st.region : "hollowmere");
  }

  /** The world's identity: the Game rebuilds the collision world and the scenery only when it changes. */
  static worldKeyOf(st: { campaign?: string; settlements?: string; region?: string }): string {
    return worldKey(Session.worldOptsOf(st));
  }

  static worldFor(region: string | undefined, seed: number, opts: RegionWorldOpts | BridgeState): CollisionWorld {
    return createRegionWorld(isRegionId(region) ? region : "hollowmere", seed, typeof opts === "string" ? { bridge: opts } : opts);
  }

  /** Rebuilds the local world for the current region and crossing (landfall, or the bridge came down). The reconciler's step reads `this.world` each time. */
  refreshWorld(): CollisionWorld {
    this.world = Session.worldFor(this.room.state.region, this.room.state.seed, Session.worldOptsOf(this.room.state));
    return this.world;
  }

  private static listenForSaves(room: Room<WorldStateType>): SaveTracker {
    const saves = new SaveTracker();
    room.onMessage("saved", (m: unknown) => saves.onSaved(m));
    return saves;
  }

  /** Saves the campaign's ledger now (the server rate-limits and answers); settles with where the save stands. */
  saveNow(): ReturnType<SaveTracker["request"]> {
    return this.saves.request(() => this.room.send("saveNow", {}));
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

  /**
   * Creates a campaign, or (with `rules.resume`, a join code) resumes a saved one. The server loads the record for a former member only and answers every refusal with the same
   * message, so a code cannot be probed (D-035).
   */
  static async create(name: string, look?: string, rules: { dismemberment?: boolean; region?: RegionId; scenario?: ScenarioTemplateId; resume?: string } = {}): Promise<Session> {
    const client = new Client(serverUrl());
    const options: JoinOptions = {
      name,
      token: identityToken(),
      ...(look ? { look } : {}),
      ...(rules.dismemberment === undefined ? {} : { dismemberment: rules.dismemberment }),
      ...(rules.region ? { region: rules.region } : {}),
      ...(rules.scenario ? { scenario: rules.scenario } : {}),
      ...(rules.resume ? { resume: rules.resume.toUpperCase() } : {}),
    };
    const room = await client.create<WorldStateType>(ROOM_WORLD, options, WorldState as never);
    const saves = Session.listenForSaves(room);
    await Session.stateReady(room);
    return new Session(room, saves);
  }

  static async join(code: string, name: string, look?: string): Promise<Session> {
    const roomId = await resolveCode(code);
    const client = new Client(serverUrl());
    const options: JoinOptions = { name, token: identityToken(), ...(look ? { look } : {}) };
    try {
      const room = await client.joinById<WorldStateType>(roomId, options, WorldState as never);
      const saves = Session.listenForSaves(room);
      await Session.stateReady(room);
      return new Session(room, saves);
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
      // Turns on the SDK's correction telemetry (it is off unless watched). The tolerance is huge so it never warns.
      warnOnDivergence: 1e9,
      onReconcile: () => this.foldDrift(),
    } as never);
    return me;
  }

  private readonly posDrift = { ema: 0, peak: 0, last: 0 };
  /** One reconcile's POSITION correction, folded as the SDK folds its drift (ema 0.1, peak x0.9): the SDK's own meter counts every predicted field, so a flag (a crate, a crouch) read as metres. */
  private foldDrift(): void {
    const c = (this.reconciler as unknown as { lastCorrection?: Record<string, number> } | undefined)?.lastCorrection;
    if (!c) return;
    const x = c.x ?? 0, y = c.y ?? 0, z = c.z ?? 0;
    const mag = Math.sqrt(x * x + y * y + z * z);
    const d = this.posDrift;
    d.ema += (mag - d.ema) * 0.1;
    d.peak = Math.max(mag, d.peak * 0.9);
    d.last = mag;
  }

  /** Prediction drift vs the server in POSITION (metres): `ema` persistent, `peak` worst recent, `lastCorrection` the latest. Zero means prediction matches. */
  get drift(): { ema: number; peak: number; lastCorrection: number } {
    return { ema: this.posDrift.ema, peak: this.posDrift.peak, lastCorrection: this.posDrift.last };
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

  /** `aim` is the combat part of the frame: the shot direction (wire yaw, wire elevation) and the weapon wanted in hand (weaponToWire). */
  sendInput(moveF: number, moveR: number, yaw: number, buttons: number, aim?: { yaw: number; elev: number; weapon: number }): void {
    const d = this.input.data;
    d.moveF = moveF;
    d.moveR = moveR;
    d.yaw = yaw;
    d.buttons = buttons;
    if (aim) {
      d.aimYaw = aim.yaw;
      d.aimElev = aim.elev;
      d.weapon = aim.weapon;
    }
    this.input.send();
  }

  leave(): void {
    void this.room.leave(true);
  }
}
