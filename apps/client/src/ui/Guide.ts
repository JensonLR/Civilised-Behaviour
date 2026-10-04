import { typeset } from "./typeset.ts";

/**
 * Direction on screen (D-063): the "Next" line under the heading strip and a marker over the place it names. The line is drawn here only when the contract's own orders are not
 * on show (at camp, with nothing to do here, a contract settled): with a contract running, the orders card IS the line (ui/ObjectiveTracker.ts, the same place and look), so the
 * player never reads the same instruction twice. The marker is always this class's: an ink flag over the goal with its distance, held to the edge of the picture with an arrow
 * when the goal is behind or off to the side. Game feeds both from game/guidance.ts; nothing here allocates per frame.
 */
export class Guide {
  private readonly line: HTMLElement;
  private readonly lineText: HTMLElement;
  private readonly lineDist: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly markLabel: HTMLElement;
  private readonly markDist: HTMLElement;
  private text = "";
  private label = "";
  private dist = -1;
  private lineDistShown = -1;
  private quietOn = false;
  /** Where the marker stands on screen this frame (CSS px), and whether it is there as a flag over the place (not hidden, not held at the edge). */
  markX = 0;
  markY = 0;
  markOver = false;

  constructor(parent: HTMLElement) {
    this.line = document.createElement("div");
    this.line.className = "guide";
    this.line.setAttribute("role", "status");
    this.line.hidden = true;
    const kicker = document.createElement("span");
    kicker.className = "kicker";
    kicker.textContent = "Next";
    this.lineText = document.createElement("span");
    this.lineText.className = "text";
    this.lineDist = document.createElement("span");
    this.lineDist.className = "dist";
    this.line.append(kicker, this.lineText, this.lineDist);
    this.mark = document.createElement("div");
    this.mark.className = "goalmark";
    this.mark.setAttribute("aria-hidden", "true");
    this.mark.hidden = true;
    this.mark.innerHTML = `<svg class="flag" viewBox="0 0 24 32"><path class="pole" d="M5 2 V30"/><path class="cloth" d="M6 3 L21 8 L6 14 Z"/></svg><svg class="arrow" viewBox="0 0 24 24"><path d="M21 12 L5 4 L10 12 L5 20 Z"/></svg><span class="label"></span><span class="mdist"></span>`;
    this.markLabel = this.mark.querySelector<HTMLElement>(".label")!;
    this.markDist = this.mark.querySelector<HTMLElement>(".mdist")!;
    parent.append(this.line, this.mark);
  }

  /** The line (undefined hides it). `showLine` false when the orders card is the line. */
  setLine(text: string | undefined, showLine: boolean): void {
    const t = text ? typeset(text) : "";
    if (t !== this.text) {
      this.text = t;
      this.lineText.textContent = t;
    }
    this.line.hidden = !showLine || t === "";
  }

  /**
   * The marker, once a frame. `ndcX/ndcY` the goal's projected position (-1..1), `behind` when it is behind the camera, `dist` metres to it (-1: no goal). Within `nearM` the
   * marker steps aside: you are there.
   */
  place(ndcX: number, ndcY: number, behind: boolean, dist: number, label: string, nearM = 4, topPx = 0): void {
    if (dist < 0 || dist < nearM) {
      this.markOver = false;
      if (!this.mark.hidden) this.mark.hidden = true;
      this.setLineDist(dist < 0 ? -1 : 0);
      return;
    }
    if (this.mark.hidden) this.mark.hidden = false;
    if (label !== this.label) {
      this.label = label;
      this.markLabel.textContent = label;
    }
    const m = Math.round(dist);
    if (m !== this.dist) {
      this.dist = m;
      this.markDist.textContent = `${m} m`;
    }
    this.setLineDist(m);
    // on screen: over the place. Off it (or behind): held inside the edge, the arrow pointing the way to turn
    let x = ndcX;
    let y = ndcY;
    if (behind) {
      x = -x;
      y = -Math.abs(y) - 1; // (behind you reads as "turn round": the marker sits at the foot of the picture, on the side to turn)
    }
    const edge = Math.max(Math.abs(x) / 0.86, Math.abs(y) / 0.72);
    const off = behind || edge > 1;
    if (off) {
      x /= Math.max(edge, 1e-6);
      y /= Math.max(edge, 1e-6);
    }
    this.mark.classList.toggle("off", off);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const px = (x * 0.5 + 0.5) * w;
    // (never over the line under the heading strip: a goal on the horizon straight ahead projected onto the words; the flag stands just below them instead)
    const py = Math.max((-y * 0.5 + 0.5) * h, topPx);
    this.mark.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    this.markX = px;
    this.markY = py;
    this.markOver = !off;
    if (off) this.mark.style.setProperty("--turn", `${Math.atan2(-y, x).toFixed(3)}rad`);
  }

  private setLineDist(m: number): void {
    if (m === this.lineDistShown) return;
    this.lineDistShown = m;
    this.lineDist.textContent = m > 0 ? `${m} m` : "";
  }

  /** D-074: the marker stands over somebody whose name plate is up: the flag alone (its name and distance were the plate's and the line's twice over). */
  quiet(on: boolean): void {
    if (on === this.quietOn) return;
    this.quietOn = on;
    this.mark.classList.toggle("quiet", on);
  }

  hide(): void {
    this.markOver = false;
    this.line.hidden = true;
    this.mark.hidden = true;
  }

  get lineShown(): boolean {
    return !this.line.hidden;
  }

  get markShown(): boolean {
    return !this.mark.hidden;
  }

  dispose(): void {
    this.line.remove();
    this.mark.remove();
  }
}
