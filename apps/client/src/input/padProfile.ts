import { clamp } from "@cb/shared";
import { emitSetting, readStored, registerReset, writeStored } from "../settings.ts";
import type { PadControl } from "./devices.ts";

/**
 * THE PAD PROFILE (D-038, package I): everything about HOW a pad is read that is not a button's meaning in the world. Pure and DOM-free so it is tested to the letter and Controls only wires it.
 *
 *  - `shapeStick`: a RADIAL deadzone (a stick at rest with a worn spring never drifts a diagonal) with a response CURVE on the live range: the magnitude runs 0 at the deadzone's edge to
 *    exactly 1 at the rim, monotone, and an exponent above 1 gives fine control near the centre (aiming) and full speed at the rim (running). The direction is never bent.
 *  - `Gesture`: one button's tap / hold machine (a tap is released before `HOLD_S`; the hold fires ONCE when it is crossed). X uses it (tap = use, hold = reload), R3 (hold = switch view).
 *  - `PadBindings`: the rebindable face/shoulder/trigger/stick-click layout. EVERY action always keeps exactly one control; assigning a control another action holds SWAPS them (nothing is
 *    ever left unbound, nothing is double-booked); stored like the key bindings (only the differences from the defaults) and sanitised on the way in.
 *  - `rumble`: a short, capped haptic through `Gamepad.vibrationActuator` where the browser exposes one.
 */

// ---- stick shaping ----------------------------------------------------------------------------------------------------------------------------

export interface Stick2 {
  x: number;
  y: number;
}

/** Magnitude after the deadzone and the curve: 0 inside `dead`, 1 at and beyond the rim, `((m - dead) / (1 - dead)) ^ curve` between (monotone for any curve >= 1). */
export function stickMagnitude(m: number, dead: number, curve: number): number {
  const d = clamp(Number.isFinite(dead) ? dead : 0.18, 0, 0.95);
  if (!(m > d)) return 0;
  const t = Math.min(1, (m - d) / (1 - d));
  return Math.pow(t, Math.max(1, Number.isFinite(curve) ? curve : 1));
}

/** Shapes a raw stick (x right, y DOWN as the Gamepad API reports it) into `out`, direction unchanged, magnitude through `stickMagnitude`. Allocation-free; non-finite input reads as rest. */
export function shapeStick(x: number, y: number, dead: number, curve: number, out: Stick2): Stick2 {
  const m = Math.hypot(x, y);
  if (!Number.isFinite(m) || m === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const k = stickMagnitude(m, dead, curve) / m;
  out.x = x * k + 0; // (+ 0 turns a -0 into 0)
  out.y = y * k + 0;
  return out;
}

// ---- tap / hold -------------------------------------------------------------------------------------------------------------------------------

/** Seconds a button must stay down to count as a HOLD (a tap is anything shorter). */
export const HOLD_S = 0.3;

/**
 * One button's gesture. Call `update(down, dt)` once per frame; afterwards `pressed` is true for the frame the button went down, `tapped` for the frame it was released before `HOLD_S`,
 * `holdFired` for the one frame the hold time was crossed (once per press), `held` while it is down and `heldFor` how long. No allocation.
 */
export class Gesture {
  pressed = false;
  tapped = false;
  holdFired = false;
  released = false;
  held = false;
  heldFor = 0;
  private fired = false;

  constructor(readonly holdS: number = HOLD_S) {}

  update(down: boolean, dt: number): this {
    this.pressed = down && !this.held;
    this.tapped = false;
    this.holdFired = false;
    this.released = !down && this.held;
    if (down) {
      this.heldFor = this.pressed ? 0 : this.heldFor + Math.max(0, dt);
      if (!this.fired && this.heldFor >= this.holdS) {
        this.fired = true;
        this.holdFired = true;
      }
    } else if (this.held) {
      this.tapped = !this.fired;
      this.fired = false;
      this.heldFor = 0;
    }
    this.held = down;
    return this;
  }

  reset(): void {
    this.pressed = this.tapped = this.holdFired = this.released = this.held = this.fired = false;
    this.heldFor = 0;
  }
}

// ---- rebindable layout ------------------------------------------------------------------------------------------------------------------------

/** The actions a pad player can move to another control. (Reload rides on the Use control by tap and hold; the command wheel, weapon cycle, holster, pause and skip are fixed.) */
export type PadAction = "jump" | "crouch" | "interact" | "melee" | "throw" | "grab" | "sprint" | "view" | "aim" | "fire";

export const PAD_ACTIONS: readonly { id: PadAction; label: string }[] = [
  { id: "jump", label: "Jump" },
  { id: "crouch", label: "Crouch" },
  { id: "interact", label: "Use / reload" },
  { id: "melee", label: "Kick or melee" },
  { id: "throw", label: "Throw" },
  { id: "grab", label: "Grab / drag" },
  { id: "aim", label: "Aim" },
  { id: "fire", label: "Fire" },
  { id: "sprint", label: "Sprint" },
  { id: "view", label: "Switch view (hold)" },
];

/** The controls an action may sit on: face buttons, bumpers, triggers and the stick clicks. (The d-pad, Menu and View keep their fixed jobs.) */
export const PAD_BINDABLE: readonly PadButton[] = ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "l3", "r3"];

/** A control with a button of its own (the sticks' clicks are l3 and r3). */
export type PadButton = Exclude<PadControl, "ls" | "rs">;
export type PadBindings = Record<PadAction, PadButton>;

/** The v2 layout of docs/_notes/polish2.md section 5. */
export const DEFAULT_PAD_BINDINGS: Readonly<PadBindings> = {
  jump: "a", crouch: "b", interact: "x", melee: "y", throw: "lb", grab: "rb", aim: "lt", fire: "rt", sprint: "l3", view: "r3",
};

export const defaultPadBindings = (): PadBindings => ({ ...DEFAULT_PAD_BINDINGS });

const isAction = (v: string): v is PadAction => PAD_ACTIONS.some((a) => a.id === v);
const isBindable = (v: unknown): v is PadButton => typeof v === "string" && (PAD_BINDABLE as readonly string[]).includes(v);

/** Gives `action` the control `to`. If another action holds `to`, it takes `action`'s old control (a swap), so every action keeps exactly one control and no two share one. Pure. */
export function assignPad(b: Readonly<PadBindings>, action: PadAction, to: PadButton): { bindings: PadBindings; swapped?: PadAction } {
  const next = { ...b };
  if (!isBindable(to) || b[action] === to) return { bindings: next };
  const other = PAD_ACTIONS.find((a) => a.id !== action && b[a.id] === to)?.id;
  const old = b[action];
  next[action] = to;
  if (other) {
    next[other] = old;
    return { bindings: next, swapped: other };
  }
  return { bindings: next };
}

/** Validates a stored value: unknown actions and controls are dropped; a duplicate (or a non-bindable control) sends the whole set back to the defaults. */
export function sanitizePadBindings(raw: unknown): PadBindings {
  const merged = defaultPadBindings();
  if (!raw || typeof raw !== "object") return merged;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isAction(k) && isBindable(v)) merged[k] = v;
  const seen = new Set<PadButton>();
  for (const a of PAD_ACTIONS) {
    if (seen.has(merged[a.id])) return defaultPadBindings();
    seen.add(merged[a.id]);
  }
  return merged;
}

const STORE = "cb.padBindings";
let active: PadBindings | undefined;

export function loadPadBindings(): PadBindings {
  const raw = readStored(STORE);
  if (!raw) return defaultPadBindings();
  try {
    return sanitizePadBindings(JSON.parse(raw));
  } catch {
    return defaultPadBindings();
  }
}

export function getPadBindings(): Readonly<PadBindings> {
  return (active ??= loadPadBindings());
}

/** Stores only what differs from the defaults, so a later change of default reaches players who never rebound. */
export function setPadBindings(b: Readonly<PadBindings>): void {
  active = sanitizePadBindings(b);
  const diff: Partial<PadBindings> = {};
  for (const a of PAD_ACTIONS) if (active[a.id] !== DEFAULT_PAD_BINDINGS[a.id]) diff[a.id] = active[a.id];
  writeStored(STORE, Object.keys(diff).length ? JSON.stringify(diff) : null);
  emitSetting("padBindings");
}
export const resetPadBindings = (): void => setPadBindings(defaultPadBindings());
registerReset(() => {
  active = defaultPadBindings();
  writeStored(STORE, null);
});

/** The action a control currently carries, or undefined (the d-pad, Menu and View, or a control nothing is bound to is impossible: every bindable control has an action). */
export function actionOfControl(control: PadControl, b: Readonly<PadBindings> = getPadBindings()): PadAction | undefined {
  for (const a of PAD_ACTIONS) if (b[a.id] === control) return a.id;
  return undefined;
}

// ---- rumble -----------------------------------------------------------------------------------------------------------------------------------

export type RumbleKind = "shot" | "hit" | "hurt" | "blast";

/** Duration (ms) and the two motors' strength (0..1) of each haptic: short and capped, so a rifle never buzzes the hand numb. */
export const RUMBLE: Readonly<Record<RumbleKind, { ms: number; weak: number; strong: number }>> = {
  shot: { ms: 70, weak: 0.35, strong: 0.5 },
  hit: { ms: 45, weak: 0.5, strong: 0.15 },
  hurt: { ms: 160, weak: 0.5, strong: 0.8 },
  blast: { ms: 260, weak: 0.7, strong: 1 },
};

interface Haptics {
  vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> } | null;
}
type AnyPad = { vibrationActuator?: unknown };

/** Plays `kind` on `pad` where it can vibrate; a missing actuator or a rejected effect is silently nothing. `scale` 0..1 weakens it (a far blast). */
export function rumble(pad: AnyPad | null | undefined, kind: RumbleKind, scale = 1): boolean {
  const act = (pad as Haptics | null | undefined)?.vibrationActuator;
  if (!act?.playEffect) return false;
  const r = RUMBLE[kind];
  const s = clamp(scale, 0, 1);
  if (s <= 0) return false;
  try {
    void act.playEffect("dual-rumble", { duration: r.ms, startDelay: 0, weakMagnitude: r.weak * s, strongMagnitude: r.strong * s })?.catch?.(() => undefined);
    return true;
  } catch {
    return false;
  }
}
