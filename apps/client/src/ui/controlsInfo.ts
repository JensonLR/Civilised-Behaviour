import { ACTIONS, getBindings, keyLabel, type ActionId } from "../input/bindings.ts";

/** One row of a controls list: what to press, and what it does. */
export interface ControlRow {
  keys: string[];
  what: string;
}

/** The gamepad layout (fixed; standard mapping, see input/Controls.ts). Shown in the settings screen and the how-to card. */
export const PAD_LAYOUT: readonly { glyph: string; what: string }[] = [
  { glyph: "L", what: "Move" },
  { glyph: "R", what: "Look" },
  { glyph: "A", what: "Jump" },
  { glyph: "B", what: "Crouch" },
  { glyph: "X", what: "Use, pick up, revive, reload" },
  { glyph: "Y", what: "Melee" },
  { glyph: "LB", what: "Throw" },
  { glyph: "RB", what: "Grab or drag" },
  { glyph: "LT", what: "Aim" },
  { glyph: "RT", what: "Fire" },
  { glyph: "L3", what: "Sprint (press the left stick)" },
  { glyph: "R3", what: "Switch first / third person" },
  { glyph: "D-pad down", what: "Hold: command the hands (right stick picks, release sends)" },
  { glyph: "Start", what: "Pause" },
];

const keys = (id: ActionId): string[] => getBindings()[id].filter(Boolean).map(keyLabel);

/** Keyboard and mouse rows for the how-to card, from the live bindings so a rebind shows up here at once. */
export function keyboardRows(): ControlRow[] {
  const b = keys;
  const move = ["forward", "left", "back", "right"].map((id) => keyLabel(getBindings()[id as ActionId][0]));
  return [
    { keys: move, what: "Move" },
    { keys: ["Mouse"], what: "Look (click to capture the mouse)" },
    { keys: b("sprint"), what: "Sprint" },
    { keys: b("jump"), what: "Jump" },
    { keys: b("crouch"), what: "Crouch" },
    { keys: b("interact"), what: "Use, pick up, revive" },
    { keys: b("grab"), what: "Grab or drag a comrade" },
    { keys: b("command"), what: "Hold: command the hired hands (mouse picks, release sends)" },
    { keys: b("throw"), what: "Throw what you carry" },
    { keys: ["Left mouse"], what: "Fire" },
    { keys: ["Right mouse"], what: "Aim" },
    { keys: b("reload"), what: "Reload" },
    { keys: b("melee"), what: "Melee" },
    { keys: b("view"), what: "Switch first / third person" },
    { keys: ["Esc"], what: "Pause and options" },
  ];
}

export const padRows = (): ControlRow[] => PAD_LAYOUT.map((p) => ({ keys: [p.glyph], what: p.what }));

/** Groups for the rebinding list. */
export const ACTION_GROUPS: readonly string[] = [...new Set(ACTIONS.map((a) => a.group))];
