import type { Device, OrientStep } from "./orientationLogic.ts";

/**
 * The words of the first-run orientation card (D-035, R). Authored copy, pending developer review (docs/AI_CONTENT_REGISTER.md). `{prompt}` tokens (`{move}`, `{use}`, `{skip}`: any `PromptId`, see input/glyphDom.ts) become the glyph of the device in use, from the player's
 * LIVE bindings (a rebind or a change of device shows up at once); no key or button name is written here. The Society takes orientation seriously, in the way it takes everything it can bill for.
 */

export const ORIENT_TITLE = "Form 1: Arrival";
export const ORIENT_TAG = "Field orientation, to be completed on the premises";
export const ORIENT_SKIP = "Skip orientation";
export const ORIENT_DONE = "Orientation complete. The Society notes your attendance and regrets nothing.";
export const ORIENT_REPLAY = "Replay the orientation";

export const ORIENT_HINT: Readonly<Record<Device, string>> = {
  keyboard: "{skip} skips it for good. The Field Manual (F1) has it again.",
  pad: "{skip} skips it for good. The Field Manual has it again.",
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

