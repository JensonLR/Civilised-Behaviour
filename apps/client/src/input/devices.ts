import type { GlyphPreference } from "../settings.ts";
import { ACTIONS, getBindings, keyLabel, type ActionId } from "./bindings.ts";

/**
 * THE INPUT DEVICE AND GLYPH CONTRACT (D-038, docs/_notes/polish2.md section 5). One module answers "which device is the player using right now" and "what do I print for this
 * prompt on that device", so the HUD, the how-to card, every sheet, the parley, the command wheel, the orientation card and the pause screen never hard-code "E" or "(X)" again.
 *
 *   const device = tracker.device;                    // "keyboard" | "xbox" | "playstation"
 *   const g = glyphFor("interact", device);           // { kind: "pad", control: "x", label: "X", name: "X button", shape: "x-button" }  or  { kind: "key", label: "E", ... }
 *   el.textContent = promptText("Use", "interact", device);   // "Use [X]"
 *
 * Package I owns this file after the landing and fills in the detection and the DOM glyph rendering; the NAMES here are the integration contract and do not change.
 */

/** The three glyph families. A pad that is neither Xbox nor PlayStation shows the Xbox set (the layout is the W3C standard mapping either way). */
export type InputDevice = "keyboard" | "xbox" | "playstation";
export const INPUT_DEVICES: readonly InputDevice[] = ["keyboard", "xbox", "playstation"];

/** The player's glyph choice: "auto" follows the last-used device (defined with the other settings, re-exported here). */
export { GLYPH_PREFERENCES, type GlyphPreference } from "../settings.ts";

/** Controls of the W3C "standard" gamepad mapping (index in `Gamepad.buttons` / axes noted in `PAD_INDEX`). */
export type PadControl = "a" | "b" | "x" | "y" | "lb" | "rb" | "lt" | "rt" | "back" | "start" | "l3" | "r3" | "up" | "down" | "left" | "right" | "ls" | "rs";

/** `Gamepad.buttons[i]` of each control (sticks are axes 0-1 and 2-3; "ls" and "rs" have no button of their own, their clicks are l3 and r3). */
export const PAD_INDEX: Readonly<Record<Exclude<PadControl, "ls" | "rs">, number>> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15,
};

/** What each family prints for a control. `label` is the short text on the glyph; `name` is the words for a screen reader and for captions. */
export interface PadGlyph {
  label: string;
  name: string;
  /** A CSS class suffix the glyph renderer styles (`.glyph-xbox-a`, `.glyph-ps-cross`): a coloured disc, a shape, a trigger. */
  shape: string;
}

const XBOX: Readonly<Record<PadControl, PadGlyph>> = {
  a: { label: "A", name: "A button", shape: "xbox-a" }, b: { label: "B", name: "B button", shape: "xbox-b" }, x: { label: "X", name: "X button", shape: "xbox-x" }, y: { label: "Y", name: "Y button", shape: "xbox-y" },
  lb: { label: "LB", name: "left bumper", shape: "bumper" }, rb: { label: "RB", name: "right bumper", shape: "bumper" }, lt: { label: "LT", name: "left trigger", shape: "trigger" }, rt: { label: "RT", name: "right trigger", shape: "trigger" },
  back: { label: "View", name: "View button", shape: "small" }, start: { label: "Menu", name: "Menu button", shape: "small" }, l3: { label: "L3", name: "left stick click", shape: "stick-click" }, r3: { label: "R3", name: "right stick click", shape: "stick-click" },
  up: { label: "Up", name: "d-pad up", shape: "dpad-up" }, down: { label: "Down", name: "d-pad down", shape: "dpad-down" }, left: { label: "Left", name: "d-pad left", shape: "dpad-left" }, right: { label: "Right", name: "d-pad right", shape: "dpad-right" },
  ls: { label: "L", name: "left stick", shape: "stick" }, rs: { label: "R", name: "right stick", shape: "stick" },
};

const PLAYSTATION: Readonly<Record<PadControl, PadGlyph>> = {
  ...XBOX,
  a: { label: "✕", name: "Cross button", shape: "ps-cross" }, b: { label: "○", name: "Circle button", shape: "ps-circle" }, x: { label: "□", name: "Square button", shape: "ps-square" }, y: { label: "△", name: "Triangle button", shape: "ps-triangle" },
  lb: { label: "L1", name: "L1 bumper", shape: "bumper" }, rb: { label: "R1", name: "R1 bumper", shape: "bumper" }, lt: { label: "L2", name: "L2 trigger", shape: "trigger" }, rt: { label: "R2", name: "R2 trigger", shape: "trigger" },
  back: { label: "Share", name: "Create button", shape: "small" }, start: { label: "Options", name: "Options button", shape: "small" },
};

export const PAD_GLYPHS: Readonly<Record<"xbox" | "playstation", Readonly<Record<PadControl, PadGlyph>>>> = { xbox: XBOX, playstation: PLAYSTATION };

/**
 * Every prompt the interface can print: the rebindable actions plus the fixed ones the sheets use. A new prompt is added HERE (and in `PROMPT_PAD`) or the contract test fails.
 */
export type PromptId =
  | ActionId
  | "aim" | "fire" | "pause" | "confirm" | "cancel" | "skip" | "tabPrev" | "tabNext" | "menuUp" | "menuDown" | "menuLeft" | "menuRight" | "look" | "move"
  | "weaponPrev" | "weaponNext" | "holster" | "wheelPick";

export const PROMPT_IDS: readonly PromptId[] = [
  ...ACTIONS.map((a) => a.id),
  "aim", "fire", "pause", "confirm", "cancel", "skip", "tabPrev", "tabNext", "menuUp", "menuDown", "menuLeft", "menuRight", "look", "move", "weaponPrev", "weaponNext", "holster", "wheelPick",
];

/**
 * The pad half of the layout: which control each prompt is on (v2; the pad rework in section 5 of the note may change a DEFAULT here, never a name). The keyboard half is the live
 * rebindable table (bindings.ts) plus the fixed keys in `PROMPT_KEY`. `null` = this prompt has no pad control (the glyph resolver returns a word instead).
 * Rule the test enforces: within one CONTEXT no two prompts share a control. Contexts: "play" (in the field), "sheet" (menus and sheets), "wheel" (the command wheel).
 */
export type PromptContext = "play" | "sheet" | "wheel";
export const PROMPT_PAD: Readonly<Record<PromptId, { control: PadControl; contexts: readonly PromptContext[]; hold?: boolean } | null>> = {
  forward: { control: "ls", contexts: ["play"] }, back: { control: "ls", contexts: ["play"] }, left: { control: "ls", contexts: ["play"] }, right: { control: "ls", contexts: ["play"] },
  sprint: { control: "l3", contexts: ["play"] }, crouch: { control: "b", contexts: ["play"] }, jump: { control: "a", contexts: ["play"] },
  interact: { control: "x", contexts: ["play"] }, reload: { control: "x", contexts: ["play"], hold: true }, melee: { control: "y", contexts: ["play"] }, throw: { control: "lb", contexts: ["play"] },
  grab: { control: "rb", contexts: ["play"] }, command: { control: "down", contexts: ["play"], hold: true }, view: { control: "r3", contexts: ["play"], hold: true },
  aim: { control: "lt", contexts: ["play"] }, fire: { control: "rt", contexts: ["play"] }, pause: { control: "start", contexts: ["play"] }, confirm: { control: "a", contexts: ["sheet", "wheel"] },
  cancel: { control: "b", contexts: ["sheet", "wheel"] },
  skip: { control: "back", contexts: ["sheet"] }, tabPrev: { control: "lb", contexts: ["sheet"] }, tabNext: { control: "rb", contexts: ["sheet"] },
  menuUp: { control: "up", contexts: ["sheet"] }, menuDown: { control: "down", contexts: ["sheet"] }, menuLeft: { control: "left", contexts: ["sheet"] }, menuRight: { control: "right", contexts: ["sheet"] },
  look: { control: "rs", contexts: ["play"] }, move: { control: "ls", contexts: ["play"] }, weaponPrev: { control: "left", contexts: ["play"] }, weaponNext: { control: "right", contexts: ["play"] },
  holster: { control: "up", contexts: ["play"] }, wheelPick: { control: "rs", contexts: ["wheel"] },
};

/** Fixed keyboard / mouse inputs (not in the rebindable table), as the words printed on a key cap. */
export const PROMPT_KEY: Readonly<Partial<Record<PromptId, string>>> = {
  aim: "Right mouse", fire: "Left mouse", pause: "Esc", confirm: "Enter", cancel: "Esc", skip: "Esc", tabPrev: "Q", tabNext: "E", menuUp: "Up", menuDown: "Down", menuLeft: "Left", menuRight: "Right",
  look: "Mouse", move: "W A S D", weaponPrev: "Wheel up", weaponNext: "Wheel down", holster: "0", wheelPick: "Mouse",
};

export type Glyph =
  | { kind: "key"; label: string; name: string }
  | { kind: "pad"; control: PadControl; label: string; name: string; shape: string; hold: boolean };

/** What to print for `prompt` on `device`. Keyboard prompts read the live bindings (a rebind shows up at once); an unbound action reads "unbound". Never throws. */
export function glyphFor(prompt: PromptId, device: InputDevice): Glyph {
  if (device === "keyboard") {
    const action = ACTIONS.find((a) => a.id === prompt);
    if (action) {
      const keys = getBindings()[action.id].filter(Boolean);
      const label = keys.length ? keyLabel(keys[0]!) : "unbound";
      return { kind: "key", label, name: `${label} key` };
    }
    const fixed = PROMPT_KEY[prompt] ?? prompt;
    return { kind: "key", label: fixed, name: fixed };
  }
  const p = PROMPT_PAD[prompt];
  if (!p) return { kind: "key", label: prompt, name: prompt };
  const g = PAD_GLYPHS[device][p.control];
  return { kind: "pad", control: p.control, label: g.label, name: g.name, shape: g.shape, hold: p.hold === true };
}

/** "Use [X]" / "Use [E]" / "Hold [R3] to switch view": a sentence with the glyph's text in brackets (the DOM renderer swaps the brackets for a glyph element). */
export function promptText(verb: string, prompt: PromptId, device: InputDevice): string {
  const g = glyphFor(prompt, device);
  return g.kind === "pad" && g.hold ? `Hold [${g.label}] to ${verb.charAt(0).toLowerCase()}${verb.slice(1)}` : `${verb} [${g.label}]`;
}

/** Classifies a `Gamepad.id` string: Sony pads report "054c" or "DualShock" / "DualSense" / "Wireless Controller"; everything else shows the Xbox set. */
export function padFamily(id: string): "xbox" | "playstation" {
  return /054c|dualshock|dualsense|playstation|wireless controller/i.test(id) ? "playstation" : "xbox";
}

/**
 * Last-used-device tracking. `note` is called by the input layer on any meaningful input (a key, a mouse move or click, a pad button or a stick past its deadzone); the tracker switches
 * only on a real change and calls `onChange` once. A glyph preference other than "auto" pins the device (`effective`). Pure; the DOM and the Gamepad API stay in Controls.
 */
export class DeviceTracker {
  private last: InputDevice = "keyboard";
  private pref: GlyphPreference = "auto";
  private readonly listeners = new Set<(d: InputDevice) => void>();

  get device(): InputDevice {
    return this.last;
  }
  /** The device whose glyphs to print: the pinned one, else the last used. */
  get effective(): InputDevice {
    return this.pref === "auto" ? this.last : this.pref;
  }
  setPreference(p: GlyphPreference): void {
    const before = this.effective;
    this.pref = p;
    if (this.effective !== before) this.emit();
  }
  /** Records an input from `device` (for a pad pass the family from `padFamily(gamepad.id)`). */
  note(device: InputDevice): void {
    if (device === this.last) return;
    const before = this.effective;
    this.last = device;
    if (this.effective !== before) this.emit();
  }
  onChange(fn: (d: InputDevice) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of [...this.listeners]) fn(this.effective);
  }
}

/** The one tracker the game and every UI module share. */
export const deviceTracker = new DeviceTracker();
