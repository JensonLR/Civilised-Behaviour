import { fillPrompt, onPromptChange } from "../input/glyphDom.ts";
import { deviceTracker, type InputDevice } from "../input/devices.ts";
import { emitSetting, onSettingChange, readStored, writeStored } from "../settings.ts";
import { ORIENT_STEPS, OrientationSampler, currentStep, doneCount, isActive, isDone, newOrientation, orientationStep, parseOrientation, serializeOrientation, skipOrientation, type Device, type OrientStep, type OrientationState, type SheetKind } from "./orientationLogic.ts";
import { ORIENT_DONE, ORIENT_HINT, ORIENT_SKIP, ORIENT_STEP_NAME, ORIENT_TAG, ORIENT_TEXT, ORIENT_TITLE } from "./orientationCopy.ts";
import "./orientation.css";

/**
 * The first-run orientation card (D-035, R): a non-modal field document in the corner. It takes no input of its own (the page's controls keep working, nothing traps focus: its one
 * button is the Skip stamp), Esc or the Skip stamp (or the pad's Back button) dismisses it for good, `cb.seenOrientation` remembers that in storage guarded by try/catch, and the
 * progress is kept (`cb.orientation`) so a reload resumes where you were. The Field Manual replays it (`replayOrientation()`). Every string is set as text. The steps are completed by
 * `orientationLogic.ts` from what `Game` already knows (position, yaw, which sheet is open): this file only draws.
 */

const SEEN = "cb.seenOrientation";
const PROGRESS = "cb.orientation";
const DONE_LINGER_S = 7;
const PAD_BACK = 8;

export const hasSeenOrientation = (): boolean => readStored(SEEN) === "1";
/** Asks a running card (in the game) to start again, and forgets that it was ever dismissed. The Field Manual's "Replay" button calls this. */
export function replayOrientation(): void {
  writeStored(SEEN, null);
  writeStored(PROGRESS, null);
  emitSetting("replayOrientation");
}

/** The glyph family the card prints: the keyboard's, or the pad in use (the tracker's own, or the Xbox set when the game says "pad" before any pad press has been seen). */
const glyphDevice = (device: Device): InputDevice => (device === "keyboard" ? "keyboard" : deviceTracker.effective === "keyboard" ? "xbox" : deviceTracker.effective);

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
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.visible && !e.repeat) this.skip(); // (no preventDefault: the pause screen still opens)
  };

  constructor(parent: HTMLElement) {
    this.state = hasSeenOrientation() ? { ...newOrientation(), skipped: true } : parseOrientation(readStored(PROGRESS));
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
    this.off = onSettingChange((k) => {
      if (k === "replayOrientation") this.restart();
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
      writeStored(PROGRESS, serializeOrientation(this.state));
      if (this.state.finished) writeStored(SEEN, "1");
      this.render();
    } else if (device !== this.device) {
      this.device = device;
      this.render();
    }
    this.setVisible(region === "hollowmere" && !down);
    if (device === "pad") this.pollBack();
  }

  /** Dismiss for good. */
  skip(): void {
    if (!isActive(this.state)) return;
    this.state = skipOrientation(this.state);
    writeStored(SEEN, "1");
    this.setVisible(false);
  }

  /** The Field Manual's replay: forget, start again. */
  restart(): void {
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
    this.off?.();
    this.offGlyphs?.();
    this.root.remove();
  }
}
