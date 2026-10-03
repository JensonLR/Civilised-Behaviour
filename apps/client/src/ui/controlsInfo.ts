import { ACTIONS, getBindings, keyLabel, type ActionId } from "../input/bindings.ts";
import { glyphFor, type InputDevice, type PadFamily, type PromptId } from "../input/devices.ts";

/** One row of a controls list: what to press, and what it does. `keys` are the labels (one per cap); `prompts` are the same controls as prompt ids, for the DOM glyph renderer. */
export interface ControlRow {
  keys: string[];
  what: string;
  prompts?: PromptId[];
}

/** The pad rows: each is a prompt (or two) and what it does. The controls themselves come from `glyphFor` (the player's own layout, the right family's shapes): none is written here. */
const PAD_ROWS: readonly { prompts: PromptId[]; what: string }[] = [
  { prompts: ["move"], what: "Move" },
  { prompts: ["look"], what: "Look" },
  { prompts: ["jump"], what: "Jump" },
  { prompts: ["crouch"], what: "Crouch" },
  { prompts: ["interact"], what: "Use, pick up, revive (a tap); reload when there is nothing to use" },
  { prompts: ["reload"], what: "Hold: reload, wherever you stand" },
  { prompts: ["melee"], what: "Melee" },
  { prompts: ["throw"], what: "Throw what you carry" },
  { prompts: ["grab"], what: "Grab or drag a comrade" },
  { prompts: ["aim"], what: "Aim (the camera goes over the shoulder)" },
  { prompts: ["fire"], what: "Fire" },
  { prompts: ["sprint"], what: "Sprint (press the left stick)" },
  { prompts: ["view"], what: "Hold: switch first / third person" },
  { prompts: ["weaponPrev", "weaponNext"], what: "Previous and next weapon" },
  { prompts: ["holster"], what: "Put the weapon away" },
  { prompts: ["command"], what: "Hold: command the hands (right stick picks, release sends)" },
  { prompts: ["pause"], what: "Pause" },
];

/** The gamepad layout for a pad family, as rows for the how-to card and the settings page. */
export const padRows = (device: PadFamily = "xbox"): ControlRow[] =>
  PAD_ROWS.map((r) => ({ keys: r.prompts.map((p) => glyphFor(p, device).label), what: r.what, prompts: r.prompts }));

const keys = (id: ActionId): string[] => getBindings()[id].filter(Boolean).map(keyLabel);
const word = (p: PromptId): string => glyphFor(p, "keyboard").label;

/** Keyboard and mouse rows for the how-to card, from the live bindings so a rebind shows up here at once. */
export function keyboardRows(): ControlRow[] {
  const b = keys;
  const move = ["forward", "left", "back", "right"].map((id) => keyLabel(getBindings()[id as ActionId][0]));
  return [
    { keys: move, what: "Move", prompts: ["move"] },
    { keys: [word("look")], what: "Look (click to capture the mouse)", prompts: ["look"] },
    { keys: b("sprint"), what: "Sprint", prompts: ["sprint"] },
    { keys: b("jump"), what: "Jump", prompts: ["jump"] },
    { keys: b("crouch"), what: "Crouch", prompts: ["crouch"] },
    { keys: b("interact"), what: "Use, pick up, revive", prompts: ["interact"] },
    { keys: b("grab"), what: "Grab or drag a comrade", prompts: ["grab"] },
    { keys: b("command"), what: "Hold: command the hired hands (mouse picks, release sends)", prompts: ["command"] },
    { keys: b("throw"), what: "Throw what you carry", prompts: ["throw"] },
    { keys: [word("fire")], what: "Fire", prompts: ["fire"] },
    { keys: [word("aim")], what: "Aim (the camera goes over the shoulder)", prompts: ["aim"] },
    { keys: b("reload"), what: "Reload", prompts: ["reload"] },
    { keys: b("melee"), what: "Melee", prompts: ["melee"] },
    { keys: b("view"), what: "Switch first / third person", prompts: ["view"] },
    { keys: [word("pause")], what: "Pause and options", prompts: ["pause"] },
  ];
}

/** Rows for the device in use. */
export const controlRows = (device: InputDevice): ControlRow[] => (device === "keyboard" ? keyboardRows() : device === "touch" ? touchRows() : padRows(device));

/** The touch overlay (D-049), as rows for the manual: the words are the ones drawn on the on-screen buttons (`TOUCH_LABEL`), none written twice. */
const TOUCH_ROWS: readonly { prompts: PromptId[]; what: string }[] = [
  { prompts: ["move"], what: "Move: the stick appears where your thumb lands, on the left" },
  { prompts: ["sprint"], what: "Run: push the stick to its rim, forward" },
  { prompts: ["look"], what: "Look: drag anywhere free on the right" },
  { prompts: ["fire"], what: "Fire (hold for as long as the gun allows)" },
  { prompts: ["aim"], what: "Aim over the shoulder (a tap on, a tap off)" },
  { prompts: ["jump"], what: "Jump" },
  { prompts: ["interact"], what: "Use, pick up, revive; reload when there is nothing to use" },
  { prompts: ["reload"], what: "Reload, wherever you stand" },
  { prompts: ["crouch"], what: "Crouch (a tap down, a tap up)" },
  { prompts: ["melee"], what: "Melee" },
  { prompts: ["grab"], what: "Grab or drag a comrade" },
  { prompts: ["throw"], what: "Throw what you carry" },
  { prompts: ["weaponNext"], what: "Next weapon (a tap); hold to put it away" },
  { prompts: ["command"], what: "Command the hands: hold, drag to pick, let go to send" },
  { prompts: ["view"], what: "Switch first / third person" },
  { prompts: ["pause"], what: "Pause" },
];
export const touchRows = (): ControlRow[] => TOUCH_ROWS.map((r) => ({ keys: r.prompts.map((p) => glyphFor(p, "touch").label), what: r.what, prompts: r.prompts }));

/** Groups for the rebinding list. */
export const ACTION_GROUPS: readonly string[] = [...new Set(ACTIONS.map((a) => a.group))];

/** The old fixed pad table (Settings.ts lists it): label and meaning per row, for the DEFAULT layout on the Xbox set. Kept so the settings screen keeps building; the how-to card uses `padRows`. */
export const PAD_LAYOUT: readonly { glyph: string; what: string }[] = padRows("xbox").map((r) => ({ glyph: r.keys.join(" "), what: r.what }));
