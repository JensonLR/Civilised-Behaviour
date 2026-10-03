import type { Device, OrientStep } from "./orientationLogic.ts";

/**
 * The words of the first-run orientation card (D-035, R). Authored copy, pending developer review (docs/AI_CONTENT_REGISTER.md). `{prompt}` tokens (`{move}`, `{use}`, `{skip}`: any `PromptId`, see input/glyphDom.ts) become the glyph of the device in use, from the player's
 * LIVE bindings (a rebind or a change of device shows up at once); no key or button name is written here. The Society takes orientation seriously, in the way it takes everything it can bill for.
 */

// D-063: the card's first job is to say what the game IS (a fresh player was lost): who you are, what you do, and that the line under the heading strip always says what next.
export const ORIENT_TITLE = "Welcome to the Society";
export const ORIENT_TAG = "You are an explorer of the Imperial Cartographic & Improvement Society. With up to three friends you sail from this camp to lands that were managing perfectly well, take a contract, and settle it: by talk, money, force or a very large lie. The locals have opinions, and long memories. The line under the compass always says what to do next.";
export const ORIENT_SKIP = "Understood";
export const ORIENT_DONE = "Orientation complete. The Society notes your attendance and regrets nothing.";
export const ORIENT_REPLAY = "Replay tutorial";

export const ORIENT_HINT: Readonly<Record<Device, string>> = {
  keyboard: "{skip} skips it for this campaign. The pause sheet and the Field Manual (F1) have it again.",
  pad: "{skip} skips it for this campaign. The pause sheet and the Field Manual have it again.",
};

export const ORIENT_TEXT: Readonly<Record<OrientStep, Readonly<Record<Device, string>>>> = {
  move: {
    keyboard: "Stretch your legs: walk a few paces about the camp ({move}).",
    pad: "Stretch your legs: walk a few paces about the camp ({move}).",
  },
  look: {
    keyboard: "Look about you: turn right round with the mouse, as one does at a view.",
    pad: "Look about you: turn right round with {look}, as one does at a view.",
  },
  pin: {
    keyboard: "Find the survey table: turn until its pin, \"Map room\", sits dead ahead on the heading strip.",
    pad: "Find the survey table: turn until its pin, \"Map room\", sits dead ahead on the heading strip.",
  },
  board: {
    keyboard: "Read the notice board by the marquee ({use}). Do not argue with it.",
    pad: "Read the notice board by the marquee ({use}). Do not argue with it.",
  },
  supply: {
    keyboard: "Open the supply manifest at the crate pyramid ({use}). Everything is billed; the horses are not consulted.",
    pad: "Open the supply manifest at the crate pyramid ({use}). Everything is billed; the horses are not consulted.",
  },
  map: {
    keyboard: "Consult the map room at the survey table ({use}). The boat is optional; the paperwork is not.",
    pad: "Consult the map room at the survey table ({use}). The boat is optional; the paperwork is not.",
  },
};

export const ORIENT_STEP_NAME: Readonly<Record<OrientStep, string>> = {
  move: "Walk",
  look: "Look",
  pin: "Find the map room",
  board: "Read the notice board",
  supply: "Open the supply manifest",
  map: "Open the map room",
};

