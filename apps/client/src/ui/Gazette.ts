import { typeset } from "./typeset.ts";

/**
 * D-084: the casualty column. The server prints the notable moments of a fight (a limb, a body thrown by powder, a keg chain, a colleague shot, a commission met) as one
 * dry line each, at most one every couple of seconds; this shows them down the left of the picture, newest at the bottom, each for a few seconds, at most three at once
 * (two on a phone). Print, not a panel: no box, the paper halo every HUD letter wears. All text goes in as textContent (wire data, never markup).
 */
export const GAZETTE_SECONDS = 7;

export class Gazette {
  private readonly root: HTMLElement;
  private readonly lines: { el: HTMLElement; until: number }[] = [];
  private timer = 0;
  /** Every line this session (the last 30), newest last: the pause sheet can list them. */
  readonly log: string[] = [];
  private readonly max: number;

  constructor(parent: HTMLElement, small = typeof window !== "undefined" && (window.innerHeight < 600 || window.innerWidth < 900 || !!window.matchMedia?.("(pointer: coarse)").matches)) {
    this.max = small ? 2 : 3;
    this.root = document.createElement("div");
    this.root.className = "gazette";
    this.root.setAttribute("role", "log");
    this.root.setAttribute("aria-live", "polite");
    this.root.setAttribute("aria-label", "Casualty column");
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  push(text: unknown, now = performance.now()): void {
    const t = typeset(String(text ?? "").trim()).slice(0, 220);
    if (t === "") return;
    this.log.push(t);
    if (this.log.length > 30) this.log.shift();
    const el = document.createElement("p");
    el.className = "line";
    el.textContent = t;
    this.root.appendChild(el);
    this.lines.push({ el, until: now + GAZETTE_SECONDS * 1000 });
    while (this.lines.length > this.max) this.lines.shift()!.el.remove();
    this.root.hidden = false;
    if (!this.timer && typeof window !== "undefined") this.timer = window.setInterval(() => this.step(), 250);
  }

  /** Retires lines whose time is up (the last half-second fades: the stylesheet's `leaving`). */
  step(now = performance.now()): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]!;
      if (now >= l.until) {
        l.el.remove();
        this.lines.splice(i, 1);
      } else l.el.classList.toggle("leaving", l.until - now < 500);
    }
    if (this.lines.length === 0) {
      this.root.hidden = true;
      if (this.timer) window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  /** Lines on screen now (tests, the pause sheet). */
  get shown(): readonly string[] {
    return this.lines.map((l) => l.el.textContent ?? "");
  }

  dispose(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.root.remove();
  }
}
