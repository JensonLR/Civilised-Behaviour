import { fillPrompt, onPromptChange } from "../input/glyphDom.ts";
import { deviceTracker, type InputDevice } from "../input/devices.ts";
import { emitSetting, getSkipTutorials, onSettingChange, readStored, writeStored } from "../settings.ts";
import { clearOrientProgress, getOrientProgress, setOrientProgress } from "./expeditions.ts";
import { ALL_DONE, ORIENT_STEPS, OrientationSampler, currentStep, doneCount, isActive, isDone, newOrientation, orientationStep, skipOrientation, type Device, type OrientStep, type OrientationState, type SheetKind } from "./orientationLogic.ts";
import { ORIENT_DONE, ORIENT_HINT, ORIENT_SKIP, ORIENT_STEP_NAME, ORIENT_TAG, ORIENT_TEXT, ORIENT_TITLE } from "./orientationCopy.ts";
import "./orientation.css";

/**
 * The orientation card (D-035, R; per campaign since D-039): a non-modal field document in the corner. It takes no input of its own (the page's controls keep working, nothing traps
 * focus: its one button is the Skip stamp), Esc or the Skip stamp (or the pad's Back button) dismisses it for good IN THIS CAMPAIGN, and its progress is kept with the campaign's entry
 * in the expeditions record (`expeditions.ts`, keyed by the join code), so every new campaign starts with the card and a reload or a resume carries on where you were. The global
 * "Never show tutorials" setting keeps it away everywhere. The pause sheet and the Field Manual replay it (`replayOrientation()`). Every string is set as text. The steps are
 * completed by `orientationLogic.ts` from what `Game` already knows (position, yaw, which sheet is open): this file only draws.
 */

/** Set by a replay asked for with no card running (the Field Manual opened at the front door): the next card to be built starts again from nothing. */
const REPLAY_NEXT = "cb.replayOrientation";
const DONE_LINGER_S = 7;
const PAD_BACK = 8;
let live = 0;

/** Has this campaign's orientation been skipped or finished? (The front door and the tests read it; the card itself reads the same record.) */
export function hasSeenOrientation(code: string): boolean {
  const p = getOrientProgress(code);
  return p !== undefined && (p.skipped || p.done === ALL_DONE);
}
/**
 * Asks the card to start again. A running card (in a campaign) does so now and forgets its stored progress; with none running (the front door) the NEXT card built does. The
 * pause sheet and the Field Manual's "Replay" button call this.
 */
export function replayOrientation(): void {
  if (live === 0) writeStored(REPLAY_NEXT, "1");
  emitSetting("replayOrientation");
}

/** The glyph family the card prints: the keyboard's, or the pad in use (the tracker's own, or the Xbox set when the game says "pad" before any pad press has been seen). */
const glyphDevice = (device: Device): InputDevice => {
  const e = deviceTracker.effective;
  if (e === "touch") return "touch"; // (D-049: a touch player is told about the on-screen buttons, whichever page the card was on)
  return device === "keyboard" ? "keyboard" : e === "keyboard" ? "xbox" : e;
};

export class Orientation {
  private state: OrientationState;
  private readonly sampler = new OrientationSampler();
  private readonly root: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly rows = new Map<OrientStep, { li: HTMLLIElement; what: HTMLElement }>();
  private readonly hint: HTMLElement;
  private readonly doneLine: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private visible = false;
  private device: Device = "keyboard";
  private doneFor = 0;
  private padHeld = false;
  private off: (() => void) | undefined;
  private offGlyphs: (() => void) | undefined;
  /** Nothing is written, and the card stays down, while the global "Never show tutorials" is on (a replay on purpose lifts it for this card). */
  private suppressed: boolean;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.visible && !e.repeat) this.skip(); // (no preventDefault: the pause screen still opens)
  };

  constructor(
    parent: HTMLElement,
    private readonly code: string,
  ) {
    writeStored("cb.seenOrientation", null); // (D-039: the old per-browser flags are retired; a profile that skipped once must meet the card in its next new campaign)
    writeStored("cb.orientation", null);
    const replay = readStored(REPLAY_NEXT) === "1";
    if (replay) writeStored(REPLAY_NEXT, null);
    this.suppressed = getSkipTutorials() && !replay;
    const saved = replay ? undefined : getOrientProgress(code);
    if (replay) clearOrientProgress(code);
    // (a finished card does not linger again on a resume: it comes back as skipped)
    this.state = this.suppressed ? { ...newOrientation(), skipped: true } : saved ? { done: saved.done, skipped: saved.skipped || saved.done === ALL_DONE, finished: saved.done === ALL_DONE } : newOrientation();
    this.root = document.createElement("section");
    this.root.className = "orientation";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-label", "Field orientation");
    this.root.hidden = true;
    const society = document.createElement("p");
    society.className = "society";
    society.textContent = "The Imperial Cartographic & Improvement Society";
    const title = document.createElement("h2");
    title.textContent = ORIENT_TITLE;
    const tag = document.createElement("p");
    tag.className = "tag";
    tag.textContent = ORIENT_TAG;
    this.list = document.createElement("ol");
    for (const id of ORIENT_STEPS) {
      const li = document.createElement("li");
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = ORIENT_STEP_NAME[id];
      const what = document.createElement("span");
      what.className = "what";
      li.append(mark, name, what);
      this.list.appendChild(li);
      this.rows.set(id, { li, what });
    }
    this.doneLine = document.createElement("p");
    this.doneLine.className = "done-line";
    this.doneLine.textContent = ORIENT_DONE;
    this.doneLine.hidden = true;
    this.hint = document.createElement("p");
    this.hint.className = "hint";
    this.skipBtn = document.createElement("button");
    this.skipBtn.type = "button";
    this.skipBtn.className = "skip";
    this.skipBtn.textContent = ORIENT_SKIP;
    this.skipBtn.addEventListener("click", () => this.skip());
    const foot = document.createElement("div");
    foot.className = "foot";
    foot.append(this.hint, this.skipBtn);
    this.root.append(society, title, tag, this.list, this.doneLine, foot);
    parent.appendChild(this.root);
    window.addEventListener("keydown", this.onKey);
    live++;
    this.off = onSettingChange((k) => {
      if (k === "replayOrientation") this.restart();
      else if (k === "skipTutorials" && getSkipTutorials()) {
        this.suppressed = true;
        this.skip(false);
      }
    });
    this.offGlyphs = onPromptChange(() => this.render()); // a change of device or binding: every line is written again with the new glyphs
    this.render();
  }

  /** Showing, and not yet skipped or finished. */
  get active(): boolean {
    return isActive(this.state);
  }

  get current(): OrientationState {
    return this.state;
  }

  /**
   * Once a frame. `sheet` is whichever full-screen sheet is open (the game knows), `device` the input in use. Allocates nothing while nothing changes (the machine returns the same
   * state, the render is skipped).
   */
  tick(dt: number, x: number, z: number, yaw: number, region: string, sheet: SheetKind, down: boolean, device: Device): void {
    if (!isActive(this.state)) {
      if (this.state.finished && !this.state.skipped && this.doneFor < DONE_LINGER_S) {
        this.doneFor += dt;
        if (this.doneFor >= DONE_LINGER_S) this.setVisible(false);
      }
      return;
    }
    const before = this.state;
    this.state = orientationStep(this.state, this.sampler.feed(dt, x, z, yaw, region, sheet, down, device));
    if (this.state !== before) {
      this.save();
      this.render();
    } else if (device !== this.device) {
      this.device = device;
      this.render();
    }
    this.setVisible(region === "hollowmere" && !down);
    if (device === "pad") this.pollBack();
  }

  /** Dismiss for good (in this campaign; `remember` false when the global setting did it, which is not this campaign's choice). */
  skip(remember = true): void {
    if (!isActive(this.state)) return;
    this.state = skipOrientation(this.state);
    if (remember) this.save();
    this.setVisible(false);
  }

  private save(): void {
    if (!this.suppressed) setOrientProgress(this.code, { done: this.state.done, skipped: this.state.skipped });
  }

  /** The replay (pause sheet, Field Manual): forget this campaign's progress, start again. */
  restart(): void {
    this.suppressed = false;
    clearOrientProgress(this.code);
    this.state = newOrientation();
    this.sampler.reset();
    this.doneFor = 0;
    this.render();
  }

  private pollBack(): void {
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : undefined;
    let held = false;
    if (pads) for (const p of pads) if (p?.connected && p.buttons[PAD_BACK]?.pressed) held = true;
    if (held && !this.padHeld) this.skip();
    this.padHeld = held;
  }

  private setVisible(v: boolean): void {
    const show = v && (isActive(this.state) || (this.state.finished && !this.state.skipped && this.doneFor < DONE_LINGER_S));
    if (show !== this.visible) {
      this.visible = show;
      this.root.hidden = !show;
    }
  }

  private render(): void {
    const cur = currentStep(this.state);
    const gd = glyphDevice(this.device);
    for (const id of ORIENT_STEPS) {
      const r = this.rows.get(id)!;
      r.li.className = `${isDone(this.state, id) ? "done" : ""}${id === cur ? " current" : ""}`.trim();
      if (id === cur) r.li.setAttribute("aria-current", "step");
      else r.li.removeAttribute("aria-current");
      fillPrompt(r.what, ORIENT_TEXT[id][this.device], gd);
    }
    fillPrompt(this.hint, ORIENT_HINT[this.device], gd);
    this.doneLine.hidden = !this.state.finished;
    this.root.setAttribute("aria-label", `Field orientation, ${doneCount(this.state)} of ${ORIENT_STEPS.length} done`);
    this.skipBtn.hidden = this.state.finished;
    this.setVisible(this.visible || (isActive(this.state) && !this.root.hidden));
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    live = Math.max(0, live - 1);
    this.off?.();
    this.offGlyphs?.();
    this.root.remove();
  }
}
