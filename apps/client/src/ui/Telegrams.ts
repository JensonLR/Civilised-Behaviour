import { TelegramQueue } from "./telegramQueue.ts";
import { typeset } from "./typeset.ts";

/**
 * The telegram stack: paper slips down the top of the picture, newest at the bottom, at most three at once, the rest waiting in a queue
 * (telegramQueue.ts). Slips slide in and fade out (not under reduced motion: the stylesheet turns animation off).
 */
export class Telegrams {
  /** (D-063: one slip at a time on a phone or a small window, two on a big screen: three slips covered the picture, and on a phone the sights) */
  readonly queue = new TelegramQueue(typeof window !== "undefined" && (window.innerHeight < 600 || window.innerWidth < 900 || window.matchMedia?.("(pointer: coarse)").matches) ? 1 : 2);
  /** Every dispatch, newest last (the last 40): the pause sheet lists them, so nothing a slip skipped or cut short is lost. */
  readonly log: string[] = [];
  private readonly root: HTMLElement;
  private readonly els = new Map<number, HTMLElement>();
  private timer = 0;
  private last = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "telegrams";
    this.root.setAttribute("role", "log");
    this.root.setAttribute("aria-live", "polite");
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  push(text: string, seconds?: number): void {
    if (!this.queue.push(text, seconds)) return;
    this.log.push(text.trim());
    if (this.log.length > 40) this.log.shift();
    this.render();
    if (!this.timer) {
      this.last = performance.now();
      this.timer = window.setInterval(() => this.step(), 250);
    }
  }

  private step(): void {
    const now = performance.now();
    const dt = (now - this.last) / 1000; // (uncapped: a background tab's interval runs once a second or slower, and a cap kept old news up for minutes)
    this.last = now;
    const changed = this.queue.tick(dt);
    for (const s of this.queue.shown) {
      const el = this.els.get(s.id);
      if (el) el.classList.toggle("leaving", s.life - s.age < 0.5);
    }
    if (changed) this.render();
    if (this.queue.shown.length === 0 && this.queue.queued === 0) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private render(): void {
    const live = new Set(this.queue.shown.map((s) => s.id));
    for (const [id, el] of this.els) {
      if (!live.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    for (const s of this.queue.shown) {
      if (this.els.has(s.id)) continue;
      const el = document.createElement("div");
      el.className = "telegram";
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = typeset(s.text);
      el.appendChild(body);
      this.root.appendChild(el);
      this.els.set(s.id, el);
    }
    this.root.hidden = this.els.size === 0;
    this.fold();
    const more = this.queue.queued;
    // the first slip wears the count of those still waiting (the stamp follows whichever slip is first)
    let first = true;
    for (const c of Array.from(this.root.children)) {
      if (first && more > 0) c.setAttribute("data-more", String(more));
      else c.removeAttribute("data-more");
      first = false;
    }
  }

  /**
   * Three slips on a 720-line screen reached past the middle, under the reticle, and a hit marker's word printed over a slip's text. When the stack would cross into
   * the aim zone (the middle of the picture, less 2.5 rem) every slip but the newest folds to one line: the older news has been read, the newest is whole.
   */
  private fold(): void {
    this.root.classList.remove("crowded");
    if (this.els.size < 2 || typeof window === "undefined") return;
    const limit = window.innerHeight / 2 - 2.5 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    if (this.root.getBoundingClientRect().bottom > limit) this.root.classList.add("crowded");
  }

  clear(): void {
    this.queue.clear();
    this.render();
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
