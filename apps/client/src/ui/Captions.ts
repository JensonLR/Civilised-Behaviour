import { onCaption } from "../audio/index.ts";

/**
 * Captions for key sounds, drawn as brief italic telegram slips low on the screen. Up to three at a time; a repeat of the line already showing
 * bumps a counter instead of stacking. Motion-free: lines simply appear and are removed (the stylesheet fades them unless motion is reduced).
 */
const MAX_LINES = 3;
const LIFETIME_MS = 2600;

export class Captions {
  private readonly root: HTMLElement;
  private readonly off: () => void;
  private readonly timers = new Map<HTMLElement, number>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "captions";
    this.root.setAttribute("role", "log");
    this.root.setAttribute("aria-live", "off"); // captions are for the eyes; a screen reader gets the HUD, not a stream of gunshots
    this.root.setAttribute("aria-label", "Captions");
    parent.appendChild(this.root);
    this.off = onCaption((t) => this.add(t));
  }

  private add(text: string): void {
    const last = this.root.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text) {
      const n = Number(last.dataset.count ?? "1") + 1;
      last.dataset.count = String(n);
      last.textContent = `${text} ×${n}`;
      this.arm(last);
      return;
    }
    const line = document.createElement("p");
    line.className = "caption";
    line.dataset.text = text;
    line.textContent = text;
    this.root.appendChild(line);
    while (this.root.children.length > MAX_LINES) this.drop(this.root.firstElementChild as HTMLElement);
    this.arm(line);
  }

  private arm(line: HTMLElement): void {
    window.clearTimeout(this.timers.get(line));
    this.timers.set(line, window.setTimeout(() => this.drop(line), LIFETIME_MS));
  }

  private drop(line: HTMLElement | null): void {
    if (!line) return;
    window.clearTimeout(this.timers.get(line));
    this.timers.delete(line);
    line.remove();
  }

  dispose(): void {
    this.off();
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.root.remove();
  }
}
