import { CAMP } from "@cb/shared";

/**
 * The first-run orientation (D-035, R): six small things a new player is shown how to do at HQ, each COMPLETED BY WHAT THE GAME ALREADY KNOWS (where you stand, where the camera
 * looks, which sheet is open), so no new event exists anywhere to feed it. Pure: the machine is a monotone fold over samples (steps tick off in any order and stay ticked), the
 * sampler turns the frame's raw numbers into the sample's totals with no allocation, and both are tested as tables. The card (Orientation.ts) only draws the state.
 */

export const ORIENT_STEPS = ["move", "look", "pin", "board", "supply", "map"] as const;
export type OrientStep = (typeof ORIENT_STEPS)[number];
const BIT: Readonly<Record<OrientStep, number>> = { move: 1, look: 2, pin: 4, board: 8, supply: 16, map: 32 };
export const ALL_DONE = 63;

export type SheetKind = "none" | "paper" | "loadout" | "map" | "other";
export type Device = "keyboard" | "pad";

/** How far, how much and how long: the bars the first two steps and the pin step must clear. */
export const ORIENT_BARS = {
  /** Metres walked at HQ. */
  walked: 6,
  /** Radians the camera has turned in total (about 70 degrees). */
  turned: 1.2,
  /** Seconds the survey table has sat within `pinCone` of dead ahead. */
  pinSeconds: 0.6,
  /** Half-angle (radians) of the cone "dead ahead" means: about 20 degrees; the compass strip shows 75 either side, so a pin on the strip is easy to centre. */
  pinCone: 0.35,
  /** The pin is on the strip only within this many metres (the whole camp and more). */
  pinRange: 60,
  /** A frame that moves the body farther than this is a teleport (a region change, a respawn), not a walk. */
  maxStep: 4,
} as const;

export interface OrientationState {
  /** Bitmask of the steps done. */
  readonly done: number;
  readonly skipped: boolean;
  readonly finished: boolean;
}

export const newOrientation = (): OrientationState => ({ done: 0, skipped: false, finished: false });

/**
 * What the host knows this frame (`OrientationSampler` makes it). The bars are cleared or not (booleans, not running totals: a number stored into an object every frame is boxed by the
 * engine, so the totals live in the sampler's typed array and the sample only changes when a bar is crossed).
 */
export interface OrientationSample {
  /** `ORIENT_BARS.walked` metres covered at HQ. */
  walked: boolean;
  /** `ORIENT_BARS.turned` radians of looking about. */
  turned: boolean;
  /** The survey table has sat dead ahead for `ORIENT_BARS.pinSeconds`. */
  pinned: boolean;
  sheet: SheetKind;
  region: string;
  down: boolean;
  device: Device;
}

/** The first step not yet done, or undefined when all are. */
export function currentStep(s: OrientationState): OrientStep | undefined {
  for (const id of ORIENT_STEPS) if ((s.done & BIT[id]) === 0) return id;
  return undefined;
}

export const isDone = (s: OrientationState, id: OrientStep): boolean => (s.done & BIT[id]) !== 0;
export const doneCount = (s: OrientationState): number => ORIENT_STEPS.reduce((n, id) => n + (isDone(s, id) ? 1 : 0), 0);
/** The orientation card shows while it is neither skipped nor finished. */
export const isActive = (s: OrientationState): boolean => !s.skipped && !s.finished;

/**
 * One step of the fold. Returns the SAME object when nothing changed (so a frame with nothing new allocates nothing). Frozen away from HQ and while down: the steps are about the
 * camp, and a player who has been shot has other concerns. A skipped or finished orientation never moves again.
 */
export function orientationStep(s: OrientationState, a: OrientationSample): OrientationState {
  if (s.skipped || s.finished) return s;
  if (a.region !== "hollowmere" || a.down) return s;
  let d = s.done;
  if (a.walked) d |= BIT.move;
  if (a.turned) d |= BIT.look;
  if (a.pinned) d |= BIT.pin;
  if (a.sheet === "paper") d |= BIT.board;
  if (a.sheet === "loadout") d |= BIT.supply;
  // (whoever has the map room open has found it, however they got there: the step that asks you to find it must never outlive the one that asks you to open it, D-040)
  if (a.sheet === "map") d |= BIT.map | BIT.pin;
  if (d === s.done) return s;
  return { done: d, skipped: false, finished: d === ALL_DONE };
}

export const skipOrientation = (s: OrientationState): OrientationState => (s.skipped ? s : { ...s, skipped: true });

/** A stored state, read back: anything that is not a plain non-negative mask within range is a fresh start (never throws). */
export function parseOrientation(raw: unknown): OrientationState {
  if (typeof raw !== "string" || raw.length > 64) return newOrientation();
  try {
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== "object") return newOrientation();
    const o = j as Record<string, unknown>;
    const done = typeof o.done === "number" && Number.isInteger(o.done) && o.done >= 0 && o.done <= ALL_DONE ? o.done : 0;
    const skipped = o.skipped === true;
    return { done, skipped, finished: done === ALL_DONE };
  } catch {
    return newOrientation();
  }
}

export const serializeOrientation = (s: OrientationState): string => JSON.stringify({ done: s.done, skipped: s.skipped });

// ---- the sampler -------------------------------------------------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const WALKED = 0;
const TURNED = 1;
const SEEN = 2;
const LX = 3;
const LZ = 4;
const LYAW = 5;
const HAVE = 6;

/**
 * Turns the frame's raw position and camera yaw into the sample's totals. State is a typed array: `feed` allocates nothing. The first call only learns where you stand (a spawn is not a
 * walk). `sample` is the one reused object the machine reads.
 */
export class OrientationSampler {
  private readonly f = new Float64Array(7);
  readonly sample: OrientationSample = { walked: false, turned: false, pinned: false, sheet: "none", region: "hollowmere", down: false, device: "keyboard" };

  /** The running totals (tests and the debug overlay read them; the machine does not). */
  get walkedMetres(): number {
    return this.f[WALKED]!;
  }
  get turnedRadians(): number {
    return this.f[TURNED]!;
  }
  get tableSeconds(): number {
    return this.f[SEEN]!;
  }

  constructor(private readonly table: { x: number; z: number } = CAMP.mapTable) {}

  feed(dt: number, x: number, z: number, yaw: number, region: string, sheet: SheetKind, down: boolean, device: Device): OrientationSample {
    const f = this.f;
    const sm = this.sample;
    sm.region = region;
    sm.sheet = sheet;
    sm.down = down;
    sm.device = device;
    if (!Number.isFinite(x + z + yaw) || !(dt >= 0) || !Number.isFinite(dt)) return sm;
    if (f[HAVE] === 0) {
      f[HAVE] = 1;
    } else if (region === "hollowmere" && !down) {
      const dx = x - f[LX]!;
      const dz = z - f[LZ]!;
      const step = Math.sqrt(dx * dx + dz * dz);
      if (step <= ORIENT_BARS.maxStep) f[WALKED] = f[WALKED]! + step;
      // (inline wraps, not calls: a call that returns a double may box it, and this runs every frame)
      let dy = yaw - f[LYAW]!;
      dy -= TAU * Math.floor((dy + Math.PI) / TAU);
      f[TURNED] = f[TURNED]! + Math.abs(dy);
      // the survey table dead ahead and within range of the strip, for long enough
      const tx = this.table.x - x;
      const tz = this.table.z - z;
      const near = tx * tx + tz * tz <= ORIENT_BARS.pinRange * ORIENT_BARS.pinRange;
      let off = Math.atan2(-tx, -tz) - yaw; // the camera's yaw convention (compassLogic.yawTo): 0 looks down -Z, positive turns left
      off -= TAU * Math.floor((off + Math.PI) / TAU);
      if (near && Math.abs(off) <= ORIENT_BARS.pinCone) f[SEEN] = f[SEEN]! + dt;
      else f[SEEN] = Math.max(0, f[SEEN]! - dt * 2); // looking away lets it drain: a glance in passing is not finding it
    }
    f[LX] = x;
    f[LZ] = z;
    f[LYAW] = yaw;
    if (f[WALKED]! >= ORIENT_BARS.walked) sm.walked = true;
    if (f[TURNED]! >= ORIENT_BARS.turned) sm.turned = true;
    sm.pinned = sm.pinned || f[SEEN]! >= ORIENT_BARS.pinSeconds;
    return sm;
  }

  /** Forgets everything (the replay from the Field Manual). */
  reset(): void {
    this.f.fill(0);
    const sm = this.sample;
    sm.walked = sm.turned = sm.pinned = false;
  }
}
