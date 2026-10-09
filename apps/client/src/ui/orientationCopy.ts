import type { Device, OrientStep } from "./orientationLogic.ts";

/**
 * The words of the first-run orientation card (D-035, R). Authored copy, pending developer review (docs/AI_CONTENT_REGISTER.md). `{prompt}` tokens (`{move}`, `{use}`, `{skip}`: any `PromptId`, see input/glyphDom.ts) become the glyph of the device in use, from the player's
 * LIVE bindings (a rebind or a change of device shows up at once); no key or button name is written here. The Society takes orientation seriously, in the way it takes everything it can bill for.
 */

// D-063: the card's first job is to say what the game IS (a fresh player was lost): who you are, what you do, and that the line under the heading strip always says what next.
export const ORIENT_TITLE = "Welcome to the Society";
export const ORIENT_TAG = "You explore for the Society of Pall Mall, London. Sail with up to three friends, take contracts, and settle them by talk, money, force or a very large lie.";
export const ORIENT_SKIP = "Understood";
export const ORIENT_DONE = "Orientation complete. The Society notes your attendance.";
export const ORIENT_REPLAY = "Replay tutorial";

export const ORIENT_HINT: Readonly<Record<Device, string>> = {
  keyboard: "{skip} skips this. The pause sheet can replay it.",
  pad: "{skip} skips this. The pause sheet can replay it.",
};

export const ORIENT_TEXT: Readonly<Record<OrientStep, Readonly<Record<Device, string>>>> = {
  move: {
    keyboard: "Walk a few paces about the camp ({move}).",
    pad: "Walk a few paces about the camp ({move}).",
  },
  look: {
    keyboard: "Look all the way round with the mouse.",
    pad: "Look all the way round with {look}.",
  },
  pin: {
    keyboard: "Turn until the \"Map room\" pin on the compass is straight ahead.",
    pad: "Turn until the \"Map room\" pin on the compass is straight ahead.",
  },
  board: {
    keyboard: "Read the notice board by the big tent ({use}).",
    pad: "Read the notice board by the big tent ({use}).",
  },
  supply: {
    keyboard: "Open the supplies at the stack of crates ({use}). Everything is billed.",
    pad: "Open the supplies at the stack of crates ({use}). Everything is billed.",
  },
  map: {
    keyboard: "Open the map at the survey table ({use}) and choose where to sail.",
    pad: "Open the map at the survey table ({use}) and choose where to sail.",
  },
};

export const ORIENT_STEP_NAME: Readonly<Record<OrientStep, string>> = {
  move: "Walk",
  look: "Look",
  pin: "Find the map room",
  board: "Read the notice board",
  supply: "Open the supplies",
  map: "Open the map",
};

