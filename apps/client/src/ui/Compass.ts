import { regionMarks, type MarkIcon, type PlaceMark, type RegionId } from "@cb/shared";
import { DEG, TICKS, distanceText, headingDegrees, headingName, isCardinal, isPoint, stackRows, stripPlace, wrapPi, yawTo, type StripPlace } from "./compassLogic.ts";

/** The hub's places (the strip at HQ): camp, Hollowmere, the Observatory, the map room (the survey table) and the dock (the boat). */
export const compassPins = (): readonly PlaceMark[] => regionMarks("hollowmere");

/** Marks for the places: shapes, never colours, tell them apart. */
const ICONS: Record<MarkIcon, string> = {
  camp: `<path d="M2 15 12 3l10 12z"/><path d="M12 15v-5" class="k"/>`,
  village: `<path d="M3 14 12 6l9 8v6H3z"/><path d="M16 4v5h3V6z"/>`,
  observatory: `<path d="M6 21V11a6 6 0 0 1 12 0v10z"/><path d="M12 5v-3" class="k"/>`,
  // a survey unrolled on a table, and a pier running out over water
  map: `<path d="M3 6h18v12H3z"/><path d="M7 10h6M7 13h10" class="k"/>`,
  dock: `<path d="M3 11h18v3H3z"/><path d="M6 14v6M12 14v6M18 14v6" class="k"/>`,
  // a crenellated tower; a striped bar on a post; a pediment on columns; a headframe over a shaft; a long hall; reeds; a ridge tent
  fort: `<path d="M5 21V7h3v2h2V7h4v2h2V7h3v14z"/><path d="M10 21v-5h4v5" class="k"/>`,
  bar: `<path d="M3 9h3v12H3z"/><path d="M6 10h15v3H6z"/><path d="M10 10v3M14 10v3M18 10v3" class="k"/>`,
  court: `<path d="M2 9 12 3l10 6z"/><path d="M4 10h3v9H4zM10.5 10h3v9h-3zM17 10h3v9h-3zM2 19h20v2H2z"/>`,
  mine: `<path d="M5 21 12 3l7 18h-3l-4-11-4 11z"/><path d="M8 13h8" class="k"/><circle cx="12" cy="5" r="2"/>`,
  hall: `<path d="M2 10 12 4l10 6v11H2z"/><path d="M6 21v-6M10 21v-6M14 21v-6M18 21v-6" class="k"/>`,
  reeds: `<path d="M5 21c0-6 1-11 2-16l1 0c-1 5-1 10-1 16zM11 21c0-7 0-12 1-18h1c-1 6-1 11 0 18zM17 21c0-5 0-9 1-14h1c-1 5-1 9 0 14z"/><path d="M2 19h20" class="k"/>`,
  tent: `<path d="M1 20 12 5l11 15z"/><path d="M12 20v-7" class="k"/>`,
  // the objective: a survey flag on a pole
  goal: `<path d="M5 2h2v20H5z"/><path d="M7 3h13l-3 4 3 4H7z"/>`,
};

/** How close to the notch (fraction of the half-strip) a place must sit for its name to be shown: about 10 degrees. */
const NAME_AT = 0.14;

interface MarkEl {
  lm: PlaceMark;
  el: HTMLElement;
  dist: HTMLElement;
  last: string;
  edge: string;
  named: string;
  row: string;
  goal: boolean;
}

/**
 * The heading strip: a brass ruler at the top of the picture with the compass points, a notch for the way you look and a mark for each place of the
 * region you stand in (D-040: the playtest found the hub's places on every shore) plus the running contract's objective (a flag). Everything is placed
 * from the shared plans and the camera's yaw; nothing comes from the server. Each mark is a shape AND a word, never a colour: a place shows its NAME
 * only while it sits near the notch (and the objective always), so five places never pile their words on each other; chips that would still touch are
 * stacked in rows below the strip. Marks off the strip are pinned to its edge as an arrow, so it still says which way to turn.
 */
export class Compass {
  static readonly SPAN = 150;
  private readonly root: HTMLElement;
  private readonly marksEl: HTMLElement;
  private readonly ticks: { deg: number; el: HTMLElement }[] = [];
  private marks: MarkEl[] = [];
  private readonly readout: HTMLElement;
  private readonly readName: HTMLElement;
  private readonly readDeg: HTMLElement;
  private lastYaw = NaN;
  private lastDeg = -1;
  private readonly place: StripPlace = { x: 0, inside: true };
  private lastX = NaN;
  private lastZ = NaN;
  private chips: { x: number; width: number }[] = [];
  private readonly rows: number[] = [];
  private key = "";
  /** The strip's width in em (chips are sized in em); measured after the first layout and on every resize. */
  private stripEm = 0;
  private readonly onResize = (): void => {
    this.stripEm = 0;
    this.lastDeg = -1;
  };

  constructor(parent: HTMLElement, region: RegionId = "hollowmere") {
    this.root = document.createElement("div");
    this.root.className = "compass";
    this.root.setAttribute("role", "img");
    this.root.setAttribute("aria-label", "Heading");
    this.root.innerHTML = `<div class="strip"></div><div class="readout" aria-hidden="true"><span class="hn"></span> <span class="deg"></span></div><div class="marks" aria-hidden="true"></div>`;
    const strip = this.root.querySelector<HTMLElement>(".strip")!;
    this.marksEl = this.root.querySelector<HTMLElement>(".marks")!;
    this.readout = this.root.querySelector<HTMLElement>(".readout")!;
    this.readName = this.readout.querySelector<HTMLElement>(".hn")!;
    this.readDeg = this.readout.querySelector<HTMLElement>(".deg")!;
    for (const deg of TICKS) {
      const el = document.createElement("i");
      el.className = `tick${isCardinal(deg) ? " card" : isPoint(deg) ? " pt" : ""}`;
      if (isPoint(deg)) el.dataset.label = headingName(deg);
      el.dataset.n = deg === 0 ? "1" : "";
      strip.appendChild(el);
      this.ticks.push({ deg, el });
    }
    this.setMarks(regionMarks(region));
    parent.appendChild(this.root);
    window.addEventListener("resize", this.onResize);
  }

  /** The places to point at (the region's) and the objective (the running contract's first unfinished goal), rebuilt only when they change. */
  setMarks(places: readonly PlaceMark[], goal?: PlaceMark): void {
    // (a place the objective flag already stands on is not drawn twice)
    const all = goal ? [...places.filter((p) => Math.hypot(p.x - goal.x, p.z - goal.z) > 4), goal] : [...places];
    const key = all.map((m) => `${m.id}|${m.label}|${m.x.toFixed(1)}|${m.z.toFixed(1)}`).join(";");
    if (key === this.key) return;
    this.key = key;
    this.marksEl.textContent = "";
    this.marks = all.map((lm, i) => {
      const el = document.createElement("div");
      el.className = "mark";
      el.dataset.id = lm.id;
      const isGoal = goal !== undefined && i === all.length - 1;
      if (isGoal) el.dataset.goal = "1";
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[lm.icon] ?? ""}</svg><span class="name"></span><span class="dist"></span>`;
      el.querySelector<HTMLElement>(".name")!.textContent = lm.label;
      this.marksEl.appendChild(el);
      return { lm, el, dist: el.querySelector<HTMLElement>(".dist")!, last: "", edge: "", named: "", row: "", goal: isGoal };
    });
    this.chips = this.marks.map(() => ({ x: 0, width: 0 }));
    this.lastDeg = -1;
    this.lastX = NaN;
  }

  /** Once a frame: the camera's yaw and where you stand (world x, z). Writes only what changed. */
  update(yaw: number, x: number, z: number): void {
    const moved = Math.abs(wrapPi(yaw - this.lastYaw)) > 0.0009 || !(Math.abs(x - this.lastX) < 0.5 && Math.abs(z - this.lastZ) < 0.5);
    if (!moved && this.lastDeg >= 0) return;
    this.lastX = x;
    this.lastZ = z;
    this.lastYaw = yaw;
    const span = Compass.SPAN;
    if (this.stripEm === 0) {
      const w = this.root.getBoundingClientRect().width;
      const fs = parseFloat(getComputedStyle(this.root).fontSize) || 16;
      this.stripEm = w > 0 ? w / fs : 20;
    }
    for (const t of this.ticks) {
      stripPlace(yaw, -t.deg / DEG, span, this.place);
      const el = t.el;
      if (!this.place.inside) {
        if (el.style.display !== "none") el.style.display = "none";
        continue;
      }
      if (el.style.display === "none") el.style.display = "";
      el.style.left = `${50 + this.place.x * 50}%`;
    }
    // the place nearest the notch (inside NAME_AT) is the one whose name is shown; of two in nearly the same direction, the nearer in metres
    let nearest = -1;
    let nearestScore = Infinity;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      stripPlace(yaw, yawTo(x, z, m.lm.x, m.lm.z), span, this.place);
      this.chips[i]!.x = this.place.x;
      const score = Math.abs(this.place.x) + Math.hypot(m.lm.x - x, m.lm.z - z) / 4000;
      if (this.place.inside && !m.goal && Math.abs(this.place.x) < NAME_AT && score < nearestScore) {
        nearestScore = score;
        nearest = i;
      }
    }
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      const px = this.chips[i]!.x;
      const inside = Math.abs(px) < 1;
      const edge = inside ? "" : px < 0 ? "l" : "r";
      if (edge !== m.edge) {
        m.edge = edge;
        m.el.dataset.edge = edge;
      }
      const named = inside && (m.goal || i === nearest) ? "1" : "";
      if (named !== m.named) {
        m.named = named;
        m.el.dataset.named = named;
      }
      m.el.style.left = `${50 + px * 50}%`;
      const text = distanceText(Math.hypot(m.lm.x - x, m.lm.z - z));
      if (text !== m.last) {
        m.last = text;
        m.dist.textContent = text;
      }
      // (measured in the game's fonts: a chip is 2 em of icon, padding and border, its distance at about 0.45 em a character, and its small-caps name at
      // about 0.5 em a letter when shown; an edge arrow is the icon alone)
      const c = this.chips[i]!;
      const em = !inside ? 2.3 : 2.0 + 0.45 * text.length + (named ? 0.5 * m.lm.label.length : 0);
      c.width = em / this.stripEm;
      // edges are stacked like the rest, at their pinned spot
      c.x = (edge === "l" ? -1 + c.width : edge === "r" ? 1 - c.width : px) * 0.5 + 0.5;
    }
    stackRows(this.chips, 0.3 / this.stripEm, 4, this.rows);
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      const row = String(this.rows[i] ?? 0);
      if (row !== m.row) {
        m.row = row;
        m.el.dataset.row = row;
      }
    }
    const deg = headingDegrees(yaw);
    if (deg !== this.lastDeg) {
      this.lastDeg = deg;
      // (the figures in the typewriter face: the display face's old-style figures read "N ooo")
      this.readName.textContent = headingName(deg);
      this.readDeg.textContent = `${String(deg).padStart(3, "0")}°`;
      this.root.setAttribute("aria-label", `Heading ${headingName(deg)}, ${deg} degrees`);
    }
  }

  set hidden(v: boolean) {
    this.root.hidden = v;
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
  }
}
