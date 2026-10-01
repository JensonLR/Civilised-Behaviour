import { emitSetting, readStored, writeStored } from "../settings.ts";
import { connectedPadFamily, deviceTracker, type InputDevice } from "../input/devices.ts";
import { glyphEl, onPromptChange } from "../input/glyphDom.ts";
import { keyboardRows, padRows, type ControlRow } from "./controlsInfo.ts";
import { Modal, h } from "./modal.ts";
import { sheetHints } from "./sheetHints.ts";
import { openSettings } from "./Settings.ts";
import { replayOrientation } from "./Orientation.ts";
import { ORIENT_REPLAY } from "./orientationCopy.ts";

/**
 * "Field Manual": a one-page how-to-play card. It lists the controls for the input device the player is actually using (a connected gamepad
 * wins over the keyboard, and the choice can be flipped), reads key names from the live bindings, and opens by itself once on a first
 * expedition. Reachable from the menu and the pause screen.
 */

const SEEN = "cb.seenHowTo";
export const hasSeenHowTo = (): boolean => readStored(SEEN) === "1";
export const markHowToSeen = (): void => {
  writeStored(SEEN, "1");
  emitSetting("seenHowTo");
};

export type Device = "keyboard" | "pad";

/** Which device to show first: a connected standard gamepad means a pad player; otherwise keyboard and mouse. */
export function detectDevice(pads: readonly (Pick<Gamepad, "connected" | "mapping"> | null)[] | undefined = typeof navigator !== "undefined" ? navigator.getGamepads?.() : undefined): Device {
  return pads && [...pads].some((p) => p?.connected && p.mapping === "standard") ? "pad" : "keyboard";
}

const STEPS: readonly string[] = [
  "Found an expedition, or present a five-letter code to join a party of up to four.",
  "Mind your comrades. A fallen explorer can be revived, dressed, dragged or carried; leave them and the Society will hear of it.",
  "The territory remembers what you did to it. Behave accordingly, or as near as you can manage.",
];

class HowToCard {
  private readonly modal = new Modal("howto", "howto", "howto-title");
  private device: Device = "keyboard";
  private readonly list = h("dl", { class: "keys" });
  private readonly kb = h("button", { type: "button", "aria-pressed": "true" }, "Keyboard & mouse");
  private readonly pad = h("button", { type: "button", "aria-pressed": "false" }, "Gamepad");

  constructor() {
    const done = h("button", { type: "button", class: "primary", "data-autofocus": true }, "Understood");
    done.addEventListener("click", () => this.close());
    const opts = h("button", { type: "button" }, "Options");
    opts.addEventListener("click", () => openSettings(opts, "controls"));
    // the first-run orientation again (the card in the game picks it up now, or at the next expedition)
    const replay = h("button", { type: "button", "data-act": "replay-orientation" }, ORIENT_REPLAY);
    replay.addEventListener("click", () => {
      replayOrientation();
      this.close();
    });
    this.kb.addEventListener("click", () => this.show("keyboard"));
    this.pad.addEventListener("click", () => this.show("pad"));
    this.modal.panel.append(
      h("p", { class: "society" }, "The Imperial Cartographic & Improvement Society"),
      h("h2", { id: "howto-title" }, "Field Manual"),
      h("p", { class: "tag" }, "Being a brief guide to conduct in the field"),
      h(
        "div",
        { class: "body" },
        h("ol", { class: "steps" }, ...STEPS.map((s) => h("li", {}, s))),
        h("div", { class: "seg", role: "group", "aria-label": "Show controls for" }, this.kb, this.pad),
        this.list,
      ),
      h("div", { class: "actions" }, opts, replay, done),
      sheetHints().el,
    );
    this.modal.onClose = () => markHowToSeen();
    // a pad picked up (or put down) while the card is open: the list follows, no reload
    onPromptChange((e) => {
      if (this.modal.isOpen) this.show(e === "keyboard" ? "keyboard" : "pad");
    });
  }

  /** The pad family whose shapes the pad list draws: the one in use, else the connected pad's, else the Xbox set. */
  private family(): Exclude<InputDevice, "keyboard"> {
    const e = deviceTracker.effective;
    return e !== "keyboard" ? e : connectedPadFamily() ?? "xbox";
  }

  private show(d: Device): void {
    this.device = d;
    this.kb.setAttribute("aria-pressed", String(d === "keyboard"));
    this.pad.setAttribute("aria-pressed", String(d === "pad"));
    this.list.className = d === "pad" ? "keys pads" : "keys";
    const fam = this.family();
    const rows: ControlRow[] = d === "keyboard" ? keyboardRows() : padRows(fam);
    this.list.replaceChildren(
      ...rows.map((r) =>
        h(
          "div",
          {},
          // keyboard: one key cap per bound key (two keys are two caps); pad: the glyph of each control, shaped for the family in use and for the player's own layout
          h("dt", {}, ...(d === "pad" && r.prompts ? r.prompts.map((p) => glyphEl(p, fam)) : r.keys.map((k) => h("kbd", { class: "glyph glyph-key" }, k)))),
          h("dd", {}, r.what),
        ),
      ),
    );
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(opener?: HTMLElement | null): void {
    this.show(deviceTracker.device !== "keyboard" ? "pad" : detectDevice());
    this.modal.open(opener);
  }

  close(): void {
    this.modal.close();
  }

  get current(): Device {
    return this.device;
  }
}

let card: HowToCard | undefined;
export function openHowTo(opener?: HTMLElement | null): void {
  (card ??= new HowToCard()).open(opener);
}
