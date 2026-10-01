import { DEMO, demoPhase, demoRemainingS, type DemoPhase } from "@cb/shared";
import { parseDemoWarn } from "../platform/shared.ts";
import { DEMO_OVER, DEMO_TAG, DEMO_TAG_SR } from "./demoCopy.ts";
import "./demo.css";

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The demo's countdown tag (D-036, package D). The SERVER enforces the session (it warns at 10 and 2 minutes and closes every client with `DEMO.closeCode`); this only SHOWS it, from
 * the client's own clock started at `start()` and re-synchronised whenever a server warning arrives (`notice`), so a late joiner or a drifting clock is corrected by the authority.
 * Not interactive (nothing to focus), `role="timer"` (not announced every second) plus one polite status line that speaks only at the warnings. Text only, colours from the
 * palette variables, no motion beyond a colour change (and none under reduced motion).
 */
export class DemoBanner {
  private readonly root: HTMLElement;
  private readonly time: HTMLElement;
  private readonly sr: HTMLElement;
  private startedAtMs: number;
  private shown = "";
  private lastPhase: DemoPhase = "open";
  private readonly now: () => number;

  constructor(parent: HTMLElement, opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.startedAtMs = this.now();
    this.root = document.createElement("div");
    this.root.className = "demo-banner open";
    this.root.setAttribute("role", "timer");
    this.root.hidden = true;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = DEMO_TAG;
    this.time = document.createElement("span");
    this.time.className = "time";
    this.sr = document.createElement("span");
    this.sr.className = "sr-only";
    this.sr.setAttribute("role", "status");
    this.sr.setAttribute("aria-live", "polite");
    this.root.append(tag, this.time, this.sr);
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
  get remainingS(): number {
    return demoRemainingS(this.startedAtMs, this.now());
  }
  get phase(): DemoPhase {
    return demoPhase(this.remainingS);
  }

  /** The session began (the room was joined): the clock starts and the tag shows. */
  start(): void {
    this.startedAtMs = this.now();
    this.root.hidden = false;
    this.lastPhase = "open";
    this.shown = "";
    this.tick();
  }

  /**
   * Feed every server notice here. A demo warning re-synchronises the clock to the server's (and is announced once); returns true when the text was one (so the caller may still show it
   * as the telegram it is).
   */
  notice(text: unknown): boolean {
    const minutes = parseDemoWarn(text);
    if (minutes === undefined) return false;
    const left = Math.min(DEMO.sessionMinutes, minutes) * 60;
    this.startedAtMs = this.now() - (DEMO.sessionMinutes * 60 - left) * 1000;
    this.sr.textContent = DEMO_TAG_SR(minutes);
    this.shown = "";
    this.tick();
    return true;
  }

  /** Call about once a second (or every frame: it only touches the DOM when the shown second or the phase changes). */
  tick(): void {
    if (this.root.hidden) return;
    const s = this.remainingS;
    const phase = demoPhase(s);
    const text = phase === "over" ? DEMO_OVER : clock(s);
    if (text !== this.shown) {
      this.shown = text;
      this.time.textContent = text;
    }
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.root.classList.remove("open", "warn", "last", "over");
      this.root.classList.add(phase);
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }
}
