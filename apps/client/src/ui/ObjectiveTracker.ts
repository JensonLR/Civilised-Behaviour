import type { ScenarioView } from "@cb/shared";
import { typeset } from "./typeset.ts";
import "./objectiveTracker.css";

/** "m:ss", rounded up (a fuse with 0.2 s left still reads 0:01). Negative or non-finite reads 0:00. */
export function formatTimer(ms: number): string {
  const s = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** The card's heading before a contract names itself (and for an old server that sends no title). */
export const DEFAULT_TITLE = "Orders of the Day";
/** Under this many seconds the timer turns urgent (colour and weight, not just motion). */
export const URGENT_SECONDS = 15;

/**
 * The objective tracker: a small paper card listing the scenario's orders, the hint line and the one countdown that matters (fuse or rival).
 * The server owns the content (`ScenarioView`); this only shows it. `update` when the view changes, `tick` with the world clock a few times
 * a second. All text goes in as textContent (the view is data from the wire, never markup).
 */
export class ObjectiveTracker {
  private readonly root: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly hint: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly label: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly rows = new Map<string, HTMLLIElement>();
  private endsAt = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("section");
    this.root.className = "objectives";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Expedition orders");
    this.root.hidden = true;
    const h = document.createElement("h2");
    h.textContent = DEFAULT_TITLE;
    this.heading = h;
    this.list = document.createElement("ul");
    this.hint = document.createElement("p");
    this.hint.className = "hint";
    this.timer = document.createElement("div");
    this.timer.className = "timer";
    this.timer.setAttribute("role", "timer");
    this.timer.hidden = true;
    this.label = document.createElement("span");
    this.label.className = "label";
    this.clock = document.createElement("b");
    this.clock.className = "clock";
    this.timer.append(this.label, this.clock);
    this.root.append(h, this.list, this.hint, this.timer);
    parent.appendChild(this.root);
  }

  /** Show a new view (undefined or empty hides the card: outside a scenario there are no orders). */
  update(view: ScenarioView | undefined): void {
    if (!view || !Array.isArray(view.objectives) || view.objectives.length === 0) {
      this.root.hidden = true;
      this.endsAt = 0;
      return;
    }
    this.root.hidden = false;
    this.root.dataset.phase = String(view.phase);
    // the contract names itself ("The Cartwright's Cage", "Marker Stone No. 4"); data attributes let the stylesheet and the tests tell them apart
    const title = typeof view.title === "string" && view.title.trim() !== "" ? view.title.slice(0, 60) : DEFAULT_TITLE;
    if (this.heading.textContent !== title) this.heading.textContent = title;
    this.root.dataset.template = typeof view.template === "string" ? view.template : "";
    if (typeof view.complication === "string" && view.complication !== "none") this.root.dataset.complication = view.complication;
    else delete this.root.dataset.complication;
    const keep = new Set<string>();
    let prev: HTMLLIElement | undefined;
    for (const o of view.objectives) {
      const id = String(o.id);
      keep.add(id);
      let li = this.rows.get(id);
      if (!li) {
        li = document.createElement("li");
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.setAttribute("aria-hidden", "true");
        const sr = document.createElement("span");
        sr.className = "sr";
        const text = document.createElement("span");
        text.className = "text";
        li.append(mark, sr, text);
        this.rows.set(id, li);
      }
      li.classList.toggle("done", !!o.done);
      li.classList.toggle("optional", !!o.optional);
      const sr = li.children[1] as HTMLElement;
      const text = li.children[2] as HTMLElement;
      const srText = `${o.done ? "Done. " : ""}${o.optional ? "Optional. " : ""}`;
      if (sr.textContent !== srText) sr.textContent = srText;
      const t = String(o.text);
      if (text.textContent !== t) text.textContent = t;
      // keep the list in the server's order without rebuilding rows that did not move
      const want = prev ? prev.nextElementSibling : this.list.firstElementChild;
      if (want !== li) this.list.insertBefore(li, want);
      prev = li;
    }
    for (const [id, li] of this.rows) {
      if (!keep.has(id)) {
        li.remove();
        this.rows.delete(id);
      }
    }
    const hint = typeset(String(view.hint ?? ""));
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = hint === "";
    const label = String(view.timerLabel ?? "");
    if (this.label.textContent !== label) this.label.textContent = label;
    this.endsAt = Number.isFinite(view.endsAtWorldMs) && view.endsAtWorldMs > 0 && label !== "" ? view.endsAtWorldMs : 0;
    if (this.endsAt === 0) this.timer.hidden = true;
  }

  /** Advance the countdown against the world clock (call ~4 times a second; cheap when there is no timer). */
  tick(worldMs: number): void {
    if (this.endsAt === 0) return;
    const left = this.endsAt - worldMs;
    this.timer.hidden = left <= 0;
    if (left <= 0) return;
    const t = formatTimer(left);
    if (this.clock.textContent !== t) this.clock.textContent = t;
    this.timer.classList.toggle("urgent", left <= URGENT_SECONDS * 1000);
  }

  /** The phase of the orders on show ("" when none): the HUD stops offering the Warden once the matter is settled. */
  get visibleOrders(): string {
    return this.root.hidden ? "" : (this.root.dataset.phase ?? "");
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
    this.root.remove();
    this.rows.clear();
    this.endsAt = 0;
  }
}
