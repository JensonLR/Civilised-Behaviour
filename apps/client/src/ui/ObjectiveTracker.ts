import type { ScenarioView } from "@cb/shared";
import { fillPrompt } from "../input/glyphDom.ts";
import { typeset } from "./typeset.ts";
import "./objectiveTracker.css";

/** "m:ss", rounded up (a fuse with 0.2 s left still reads 0:01). Negative or non-finite reads 0:00. */
export function formatTimer(ms: number): string {
  const s = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** The first unfinished objective a player must do (optional side-goals only when nothing else is left): the one the line shows (D-063). */
export function currentObjective(view: ScenarioView | undefined): { id: string; text: string } | undefined {
  if (!view || !Array.isArray(view.objectives)) return undefined;
  const main = view.objectives.find((o) => !o.done && !o.optional);
  const any = main ?? view.objectives.find((o) => !o.done);
  return any ? { id: String(any.id), text: String(any.text) } : undefined;
}

/** D-086: the server writes the control as "(Use)"; the card shows the key of the device in hand (the prompt token), redrawn when the device changes. */
export const withKeys = (text: string): string => text.replace(/\(Use\)/g, "({interact})");

/** The card's heading before a contract names itself (and for an old server that sends no title). */
export const DEFAULT_TITLE = "Orders of the Day";
/** Under this many seconds the timer turns urgent (colour and weight, not just motion). */
export const URGENT_SECONDS = 15;
/** D-098: how long a new rule stays on the card by itself; after that it shows while a weapon is out (when it matters), and the card is the one line. */
export const RULE_NEWS_MS = 20_000;

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
  private readonly dist: HTMLElement;
  private readonly rule: HTMLElement;
  private endsAt = 0;
  private ruleUntil = 0;
  private armed = false;

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
    this.dist = document.createElement("span");
    this.dist.className = "dist";
    // D-086: the contract's one rule that matters ("Hold your fire: ..."), while it still applies
    this.rule = document.createElement("p");
    this.rule.className = "rule";
    this.rule.hidden = true;
    this.root.append(h, this.list, this.dist, this.rule, this.hint, this.timer);
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
    const cur = currentObjective(view)?.id;
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
      li.classList.toggle("request", id === "society"); // (D-084: the Society's commission, shown under the line in play)
      li.classList.toggle("current", id === cur); // (D-063: the HUD shows this one line; the whole list is on the pause sheet)
      const sr = li.children[1] as HTMLElement;
      const text = li.children[2] as HTMLElement;
      const srText = `${o.done ? "Done. " : ""}${o.optional ? "Optional. " : ""}`;
      if (sr.textContent !== srText) sr.textContent = srText;
      fillPrompt(text, withKeys(String(o.text))); // (text from the wire, set as text nodes; only "(Use)" becomes a key glyph)
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
    const rule = typeset(String(view.rule ?? "")).slice(0, 200);
    if (this.rule.textContent !== rule) {
      this.rule.textContent = rule;
      this.ruleUntil = -1; // (its time as news starts at the first tick of play, not while the world is still being built)
    }
    this.refreshRule();
    const hint = typeset(String(view.hint ?? ""));
    if (this.hint.textContent !== hint) this.hint.textContent = hint;
    this.hint.hidden = hint === "";
    const label = String(view.timerLabel ?? "");
    if (this.label.textContent !== label) this.label.textContent = label;
    this.endsAt = Number.isFinite(view.endsAtWorldMs) && view.endsAtWorldMs > 0 && label !== "" ? view.endsAtWorldMs : 0;
    if (this.endsAt === 0) this.timer.hidden = true;
  }

  /** Whether the player has a weapon out (the contract's rule about fighting is shown while one is). */
  setArmed(on: boolean): void {
    if (on === this.armed) return;
    this.armed = on;
    this.refreshRule();
  }

  private refreshRule(): void {
    const show = this.rule.textContent !== "" && (this.armed || this.ruleUntil < 0 || performance.now() < this.ruleUntil);
    if (this.rule.hidden === show) this.rule.hidden = !show;
  }

  /** Metres to the current objective's place (-1 or 0: none shown), from the guide's marker. */
  setDistance(m: number): void {
    const t = m > 0 ? `${m} m` : "";
    if (this.dist.textContent !== t) this.dist.textContent = t;
  }

  /** Advance the countdown against the world clock (call ~4 times a second; cheap when there is no timer). */
  tick(worldMs: number): void {
    if (this.ruleUntil < 0) this.ruleUntil = performance.now() + RULE_NEWS_MS;
    this.refreshRule();
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
