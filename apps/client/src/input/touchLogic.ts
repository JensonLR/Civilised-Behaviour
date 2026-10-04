import type { Stick2 } from "./padProfile.ts";

/**
 * TOUCH CONTROLS (D-049): the contract between the on-screen overlay (`TouchControls.ts`, the DOM) and `Controls` (which turns it into the same per-step intent as the keyboard and
 * the pad). The overlay only reports what the fingers are doing; every rule (what a tap or a hold of Use means, sprint, the toggles) lives in `Controls.pollTouch`, next to the pad's.
 *
 *   left thumb   a floating stick: it appears where the thumb lands; push it to the rim, forward, to run
 *   right thumb  drag anywhere free to look (on the command wheel: to point)
 *   buttons      FIRE (hold), AIM (toggle), JUMP, USE (tap: use what is in reach, else reload; hold: reload, or keep a revive going), CROUCH (toggle), MELEE, GRAB, THROW,
 *                ARMS (tap: next weapon; hold: put it away), ORDERS (hold: the command wheel), VIEW, PAUSE
 */
export type TouchButton = "fire" | "aim" | "jump" | "use" | "crouch" | "melee" | "grab" | "throw" | "weapon" | "orders" | "view" | "pause";
export const TOUCH_BUTTONS: readonly TouchButton[] = ["fire", "aim", "jump", "use", "crouch", "melee", "grab", "throw", "weapon", "orders", "view", "pause"];

/** What the overlay reports. `move` is shaped like the pad's left stick (x right, y DOWN, length 0..1). */
export interface TouchSource {
  /** The overlay is up and taking fingers (a touch player in the field, no sheet open). */
  readonly active: boolean;
  readonly down: Readonly<Record<TouchButton, boolean>>;
  readonly move: Stick2;
  /** Drains the look drag since the last call, in screen pixels (x right, y down). */
  takeLook(): [number, number];
  /**
   * Drains the buttons pressed since the last call (bit i = `TOUCH_BUTTONS[i]`), even if already let go: a tap shorter than a frame must not be lost (the first real-browser run lost
   * ARMS to it at a slow frame rate; a struggling phone's frames are as long as a quick tap). Optional: a source that never misses a press need not report.
   */
  takePressed?(): number;
  /** Told each frame whether something is in reach to use (the USE button reads RELOAD when not). Optional: test fakes need not draw. */
  showUse?(usable: boolean): void;
  /** D-068: told each frame what the player can do, so only the buttons that mean something are on the glass. Optional. */
  showContext?(c: TouchContext): void;
}

/**
 * D-068: what the player can do right now, told to the overlay each frame so it shows only the buttons that mean something (a phone held sideways had fourteen on the glass). FIRE,
 * JUMP, CROUCH, USE, ARMS, VIEW and PAUSE are always there; the rest come and go.
 */
export interface TouchContext {
  /** A weapon is in hand (not bare fists): MELEE. */
  armed: boolean;
  /** It shoots: AIM. */
  ranged: boolean;
  /** Something in the arms: THROW. */
  carrying: boolean;
  /** A fallen comrade in reach to drag, or one being dragged: GRAB. */
  grab: boolean;
  /** Hired hands to give orders to: ORDERS. */
  command: boolean;
}

/** The buttons a context hides (pure: the overlay applies it, the tests read it). */
export function hiddenFor(c: TouchContext): ReadonlySet<TouchButton> {
  const out = new Set<TouchButton>();
  if (!c.ranged) out.add("aim");
  if (!c.armed) out.add("melee");
  if (!c.carrying) out.add("throw");
  if (!c.grab) out.add("grab");
  if (!c.command) out.add("orders");
  return out;
}

export const TOUCH = {
  /** How far (CSS px) the thumb travels from where it landed to full deflection. */
  stickRadiusPx: 56,
  /** Fraction of the radius that does nothing (a resting thumb drifts). */
  dead: 0.12,
  /** Past this deflection, pushed FORWARD, the stick runs (no separate sprint button: a thumb is busy). */
  runAt: 0.92,
  /**
   * Screen pixels of drag to "mouse pixels" of look. A mouse sweeps a few hundred pixels for a half turn at the default sensitivity; a thumb on a phone has less room, so a drag turns
   * faster (a 400 px drag is about a half turn). The player's look sensitivity multiplies it as it does the mouse.
   */
  lookScale: 2.6,
} as const;

/**
 * The stick's reading for a thumb that landed at (ax, ay) and is now at (x, y): the offset over the radius, clamped to the unit circle, with the deadzone taken out and the rest
 * rescaled so the stick still reaches 1 at the rim. Pure, allocation-free (writes `out`).
 */
export function stickFrom(ax: number, ay: number, x: number, y: number, radius: number, out: Stick2, dead: number = TOUCH.dead): Stick2 {
  const dx = (x - ax) / radius;
  const dy = (y - ay) / radius;
  const m = Math.hypot(dx, dy);
  if (!Number.isFinite(m) || m <= dead) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  out.x = dx * k + 0;
  out.y = dy * k + 0;
  return out;
}

/** The thumb is pushed to the rim, and forward (up the screen): run. */
export function stickRuns(s: Stick2): boolean {
  return Math.hypot(s.x, s.y) >= TOUCH.runAt && s.y < -0.5;
}

/** Where a stick's anchor may sit so the whole ring stays on screen (a thumb landing in a corner moves the ring in, not off the edge). Pure. */
export function anchorWithin(x: number, y: number, radius: number, w: number, h: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, radius), Math.max(radius, w - radius)), y: Math.min(Math.max(y, radius), Math.max(radius, h - radius)) };
}
