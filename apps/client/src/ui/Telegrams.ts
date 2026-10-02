import { TelegramQueue } from "./telegramQueue.ts";
import { typeset } from "./typeset.ts";

/**
 * The telegram stack: paper slips down the top of the picture, newest at the bottom, at most three at once, the rest waiting in a queue
 * (telegramQueue.ts). Slips slide in and fade out (not under reduced motion: the stylesheet turns animation off).
 */
export class Telegrams {
  /** (a short window shows fewer at once: three slips would cover the picture on an 800 x 450 screen) */
  readonly queue = new TelegramQueue(typeof window !== "undefined" && window.innerHeight < 560 ? 2 : 3);
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
    this.render();
    if (!this.timer) {
      this.last = performance.now();
      this.timer = window.setInterval(() => this.step(), 250);
    }
  }

  private step(): void {
    const now = performance.now();
    const dt = Math.min(1, (now - this.last) / 1000);
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
    const more = this.queue.queued;
    // the first slip wears the count of those still waiting (the stamp follows whichever slip is first)
    let first = true;
    for (const c of Array.from(this.root.children)) {
      if (first && more > 0) c.setAttribute("data-more", String(more));
      else c.removeAttribute("data-more");
      first = false;
    }
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
