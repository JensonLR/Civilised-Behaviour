import { REGIONS } from "../render/world/kessar/shared.ts";
import "./mapRoom.css";

const LINES = [
  "The Society regrets nothing.",
  "Form 7 (Sailing, Amended) has been filed with the sea.",
  "Tea is served at every bell. The bells are not rung.",
  "The captain reports fair weather and unfair prices.",
  "Somebody has packed the theodolites under the bacon.",
  "The sea has been thanked for its cooperation.",
] as const;
const BELLS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"] as const;

/**
 * The Sailing card: the full-screen interlude while the boat crosses (the server discards inputs for the six seconds) and while this machine builds the
 * new shore. Shown on travel phases 2 and 3; the integrator holds the controls off for as long as it is up. All text is set as text; reduced motion
 * stills the waves (the stylesheet). `show` may be called every second with the seconds left.
 */
export class Sailing {
  private readonly root: HTMLElement;
  private readonly where: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly line: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "sailing";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.hidden = true;
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h2");
    title.textContent = "At Sea";
    this.where = document.createElement("p");
    this.where.className = "where";
    this.clock = document.createElement("p");
    this.clock.className = "clock";
    this.line = document.createElement("p");
    this.line.className = "line";
    const waves = document.createElement("div");
    waves.className = "waves";
    waves.setAttribute("aria-hidden", "true");
    card.append(title, this.where, this.clock, this.line, waves);
    this.root.appendChild(card);
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** `to` is a region's name (or its id). `left` is the seconds until landfall. */
  show(to: string, left: number): void {
    const name = (REGIONS as Record<string, { name: string } | undefined>)[to]?.name ?? to;
    this.root.hidden = false;
    this.root.classList.remove("arriving");
    this.where.textContent = `Bound for ${name}`;
    const s = Number.isFinite(left) && left > 0 ? Math.ceil(left) : 0;
    // the crossing kept in ship's bells, one a second (it read "Landfall in 2 seconds", which is not how a day's sail is told; D-040 took the seconds off the chart)
    this.clock.textContent = s > 0 ? `${BELLS[Math.min(s, BELLS.length) - 1]} ${s === 1 ? "bell" : "bells"} to landfall` : "Landfall";
    this.line.textContent = LINES[Math.abs(Math.floor(s / 3)) % LINES.length]!;
  }

  /** The boat has landed; this machine is building the shore. */
  arriving(): void {
    this.root.hidden = false;
    this.root.classList.add("arriving");
    this.clock.textContent = "Unloading the civilisation...";
    this.line.textContent = "The Society reminds members that the locals have long memories, good aim and a lawyer.";
  }

  hide(): void {
    this.root.hidden = true;
    this.root.classList.remove("arriving");
  }

  dispose(): void {
    this.root.remove();
  }
}
