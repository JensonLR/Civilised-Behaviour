import { BUTTON } from "@cb/shared";
import { emitSetting, readStored, registerReset, writeStored } from "../settings.ts";

/**
 * Keyboard bindings: the table of actions, their default keys, the persisted overrides and the pure rules for changing them (conflicts,
 * reserved keys, "an action must keep at least one key"). Each action has two slots, a primary and an alternate, so WASD and the arrows both
 * work by default and either can be rebound. Mouse buttons and the gamepad are fixed layouts and are documented, not rebindable, here.
 * Controls.ts asks this module which keys mean what, so rebinding takes effect at once, in the menu and in the field.
 */

export type ActionId =
  | "forward" | "back" | "left" | "right"
  | "sprint" | "crouch" | "jump"
  | "interact" | "reload" | "melee" | "throw" | "grab"
  | "view";

export type Slot = 0 | 1;
export type KeyPair = readonly [string, string];

export interface ActionDef {
  id: ActionId;
  label: string;
  group: "Movement" | "Actions" | "Camera";
  /** Default primary and alternate `KeyboardEvent.code` ("" = none). */
  defaults: KeyPair;
  /** Wire button set while the key is held (movement axes and the view toggle have none). */
  button?: number;
  /** A press must never be lost between two input samples (see Controls' latch). */
  tap?: boolean;
}

/** The order here is the order the settings screen lists them in. */
export const ACTIONS: readonly ActionDef[] = [
  { id: "forward", label: "Move forward", group: "Movement", defaults: ["KeyW", "ArrowUp"] },
  { id: "back", label: "Move back", group: "Movement", defaults: ["KeyS", "ArrowDown"] },
  { id: "left", label: "Move left", group: "Movement", defaults: ["KeyA", "ArrowLeft"] },
  { id: "right", label: "Move right", group: "Movement", defaults: ["KeyD", "ArrowRight"] },
  { id: "sprint", label: "Sprint", group: "Movement", defaults: ["ShiftLeft", ""], button: BUTTON.SPRINT },
  { id: "crouch", label: "Crouch", group: "Movement", defaults: ["ControlLeft", "KeyC"], button: BUTTON.CROUCH },
  { id: "jump", label: "Jump", group: "Movement", defaults: ["Space", ""], button: BUTTON.JUMP, tap: true },
  { id: "interact", label: "Use / pick up / revive", group: "Actions", defaults: ["KeyE", ""], button: BUTTON.INTERACT, tap: true },
  { id: "reload", label: "Reload", group: "Actions", defaults: ["KeyR", ""], button: BUTTON.RELOAD, tap: true },
  { id: "melee", label: "Melee", group: "Actions", defaults: ["KeyV", ""], button: BUTTON.MELEE, tap: true },
  { id: "throw", label: "Throw", group: "Actions", defaults: ["KeyG", ""], button: BUTTON.THROW, tap: true },
  { id: "grab", label: "Grab / drag", group: "Actions", defaults: ["KeyF", ""], button: BUTTON.GRAB, tap: true },
  { id: "view", label: "Switch first / third person", group: "Camera", defaults: ["KeyX", ""] },
];

const BY_ID = new Map<ActionId, ActionDef>(ACTIONS.map((a) => [a.id, a]));
export const actionDef = (id: ActionId): ActionDef => BY_ID.get(id)!;

/** Keys nobody may bind: Escape opens the pause screen, F3 the stats, and the function keys belong to the browser / Steam overlay. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(["Escape", "F1", "F3", "F5", "F11", "F12", "Tab", "MetaLeft", "MetaRight", "ContextMenu"]);
export const isReserved = (code: string): boolean => RESERVED_CODES.has(code);

export type Bindings = Record<ActionId, [string, string]>;

export function defaultBindings(): Bindings {
  const b = {} as Bindings;
  for (const a of ACTIONS) b[a.id] = [a.defaults[0], a.defaults[1]];
  return b;
}
export const cloneBindings = (b: Bindings): Bindings => {
  const c = {} as Bindings;
  for (const a of ACTIONS) c[a.id] = [b[a.id][0], b[a.id][1]];
  return c;
};

export interface Conflict {
  action: ActionId;
  slot: Slot;
}

/** Which action/slot already uses `code`, ignoring the slot being assigned. */
export function findConflict(b: Bindings, action: ActionId, slot: Slot, code: string): Conflict | undefined {
  if (!code) return undefined;
  for (const a of ACTIONS) {
    for (const s of [0, 1] as const) {
      if (a.id === action && s === slot) continue;
      if (b[a.id][s] === code) return { action: a.id, slot: s };
    }
  }
  return undefined;
}

export type Assign =
  | { ok: true; bindings: Bindings; displaced?: Conflict }
  | { ok: false; reason: "reserved" | "conflict" | "last-key"; conflict?: Conflict };

/**
 * Binds `code` to `action`'s `slot` (an empty code clears it). Conflicts are never silent: with `resolve` unset a clash returns the conflict
 * so the interface can ask; `"swap"` gives the other action this slot's old key, `"replace"` unbinds the other action's slot.
 * An action can never be left with no key at all (nothing would be able to move you).
 */
export function assign(b: Bindings, action: ActionId, slot: Slot, code: string, resolve?: "swap" | "replace"): Assign {
  if (code && isReserved(code)) return { ok: false, reason: "reserved" };
  const next = cloneBindings(b);
  if (!code) {
    next[action][slot] = "";
    if (!next[action][0] && !next[action][1]) return { ok: false, reason: "last-key" };
    return { ok: true, bindings: next };
  }
  if (b[action][slot] === code) return { ok: true, bindings: next };
  const clash = findConflict(b, action, slot, code);
  if (clash && clash.action === action) {
    // The same action's other slot already has this key: move it here, leaving the other slot empty.
    next[action][clash.slot] = "";
    next[action][slot] = code;
    return { ok: true, bindings: next };
  }
  if (clash) {
    if (!resolve) return { ok: false, reason: "conflict", conflict: clash };
    const old = b[action][slot];
    next[clash.action][clash.slot] = resolve === "swap" ? old : "";
    next[action][slot] = code;
    if (!next[clash.action][0] && !next[clash.action][1]) return { ok: false, reason: "last-key", conflict: clash };
    return { ok: true, bindings: next, displaced: clash };
  }
  next[action][slot] = code;
  return { ok: true, bindings: next };
}

/** Validates a stored value: unknown actions and non-strings are dropped; any duplicate or reserved key sends the whole set back to defaults. */
export function sanitizeBindings(raw: unknown): Bindings {
  const b = defaultBindings();
  if (!raw || typeof raw !== "object") return b;
  const seen = new Set<string>();
  const merged = defaultBindings();
  for (const a of ACTIONS) {
    const v = (raw as Record<string, unknown>)[a.id];
    if (!Array.isArray(v)) continue;
    for (const s of [0, 1] as const) {
      const code = v[s];
      if (typeof code === "string" && code.length < 32) merged[a.id][s] = code;
    }
  }
  for (const a of ACTIONS) {
    if (!merged[a.id][0] && !merged[a.id][1]) return b;
    for (const s of [0, 1] as const) {
      const c = merged[a.id][s];
      if (!c) continue;
      if (isReserved(c) || seen.has(c)) return b;
      seen.add(c);
    }
  }
  return merged;
}

/** Human label for a `KeyboardEvent.code`: "KeyW" -> "W", "ArrowUp" -> "Up", "ShiftLeft" -> "Left Shift". */
export function keyLabel(code: string): string {
  if (!code) return "unbound";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: "Space", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl", AltLeft: "Left Alt", AltRight: "Right Alt",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter", Backspace: "Backspace", CapsLock: "Caps Lock",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
  };
  return named[code] ?? code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ---- runtime -------------------------------------------------------------------------------------------------------------------------

const STORE = "cb.bindings";
let active: Bindings | undefined;

/** Sanitised bindings from storage (or defaults). */
export function loadBindings(): Bindings {
  const raw = readStored(STORE);
  if (!raw) return defaultBindings();
  try {
    return sanitizeBindings(JSON.parse(raw));
  } catch {
    return defaultBindings();
  }
}

export function getBindings(): Bindings {
  return (active ??= loadBindings());
}

/** Stores only what differs from the defaults, so a future change of default keys still reaches players who never rebound. */
export function setBindings(b: Bindings): void {
  active = cloneBindings(b);
  const diff: Partial<Bindings> = {};
  const def = defaultBindings();
  for (const a of ACTIONS) if (b[a.id][0] !== def[a.id][0] || b[a.id][1] !== def[a.id][1]) diff[a.id] = [b[a.id][0], b[a.id][1]];
  writeStored(STORE, Object.keys(diff).length ? JSON.stringify(diff) : null);
  rebuild();
  emitSetting("bindings");
}
export function resetBindings(): void {
  setBindings(defaultBindings());
}
registerReset(() => {
  active = defaultBindings();
  writeStored(STORE, null);
  rebuild();
});

// Derived lookups for Controls, rebuilt on change: code -> tap button, and for each action its two codes.
const tapByCode = new Map<string, number>();
const actionByCode = new Map<string, ActionId>();
function rebuild(): void {
  tapByCode.clear();
  actionByCode.clear();
  const b = getBindings();
  for (const a of ACTIONS) {
    for (const s of [0, 1] as const) {
      const c = b[a.id][s];
      if (!c) continue;
      actionByCode.set(c, a.id);
      if (a.tap && a.button) tapByCode.set(c, a.button);
    }
  }
}
rebuild();

/** Wire button to latch when `code` goes down (0 if it is not a tap action). */
export const tapButtonFor = (code: string): number => tapByCode.get(code) ?? 0;
export const actionForCode = (code: string): ActionId | undefined => actionByCode.get(code);

/** True while any key bound to `action` is held. `held` is the set of `KeyboardEvent.code`s currently down. */
export function isHeld(held: ReadonlySet<string>, action: ActionId): boolean {
  const b = getBindings()[action];
  return (b[0] !== "" && held.has(b[0])) || (b[1] !== "" && held.has(b[1]));
}

/** Buttons whose keys are held: OR of the wire bits of every held-button action. */
export function heldButtons(held: ReadonlySet<string>): number {
  let out = 0;
  for (const a of ACTIONS) if (a.button && isHeld(held, a.id)) out |= a.button;
  return out;
}
