import { CAMP, hqPins } from "@cb/shared";
import { DEG, TICKS, distanceText, headingDegrees, headingName, headingName16, isCardinal, isPoint, landmarks, stackRows, stripPlace, wrapPi, yawTo, type Landmark, type StripPlace } from "./compassLogic.ts";

/** The strip's places: the three the expedition knows from the first minute, and the two it keeps asking about: the map room (the survey table) and the dock (the boat). */
export const compassPins = (): readonly Landmark[] => [...landmarks(), ...hqPins(CAMP.mapTable)];

/** Marks for the three known places: a tent, a house with a chimney, a domed tower. Shapes, not colours, tell them apart. */
const ICONS: Record<string, string> = {
  camp: `<path d="M2 15 12 3l10 12z"/><path d="M12 15v-5" class="k"/>`,
  village: `<path d="M3 14 12 6l9 8v6H3z"/><path d="M16 4v5h3V6z"/>`,
  observatory: `<path d="M6 21V11a6 6 0 0 1 12 0v10z"/><path d="M12 5v-3" class="k"/>`,
  // a survey unrolled on a table, and a pier running out over water: shapes, never colours
  map: `<path d="M3 6h18v12H3z"/><path d="M7 10h6M7 13h10" class="k"/>`,
  dock: `<path d="M3 11h18v3H3z"/><path d="M6 14v6M12 14v6M18 14v6" class="k"/>`,
};

/**
 * The heading strip: a brass ruler at the top of the picture with the compass points, a notch for the way you look and a mark for each place the
 * expedition knows (camp, Hollowmere, the Observatory) with its distance in metres. Everything is placed from the shared landscape data and the
 * camera's yaw; nothing comes from the server. Each mark is a shape AND a word, never a colour. Marks off the strip are pinned to its edge with
 * an arrow, so it still says which way to turn.
 */
export class Compass {
  static readonly SPAN = 150;
  private readonly root: HTMLElement;
  private readonly ticks: { deg: number; el: HTMLElement }[] = [];
  private readonly marks: { lm: Landmark; el: HTMLElement; dist: HTMLElement; last: string; edge: string }[] = [];
  private readonly readout: HTMLElement;
  private lastYaw = NaN;
  private lastDeg = -1;
  private readonly place: StripPlace = { x: 0, inside: true };
  private lastX = NaN;
  private lastZ = NaN;
  private readonly chips = compassPins().map(() => ({ x: 0, width: 0 }));
  private readonly rows: number[] = [];
  /** The strip's width in em (chips are sized in em); measured after the first layout and on every resize. */
  private stripEm = 0;
  private readonly onResize = (): void => {
    this.stripEm = 0;
    this.lastDeg = -1;
  };

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "compass";
    this.root.setAttribute("role", "img");
    this.root.setAttribute("aria-label", "Heading");
    this.root.innerHTML = `<div class="strip"></div><div class="readout" aria-hidden="true"></div><div class="marks" aria-hidden="true"></div>`;
    const strip = this.root.querySelector<HTMLElement>(".strip")!;
    const marks = this.root.querySelector<HTMLElement>(".marks")!;
    this.readout = this.root.querySelector<HTMLElement>(".readout")!;
    for (const deg of TICKS) {
      const el = document.createElement("i");
      el.className = `tick${isCardinal(deg) ? " card" : isPoint(deg) ? " pt" : ""}`;
      if (isPoint(deg)) el.dataset.label = headingName(deg);
      el.dataset.n = deg === 0 ? "1" : "";
      strip.appendChild(el);
      this.ticks.push({ deg, el });
    }
    for (const lm of compassPins()) {
      const el = document.createElement("div");
      el.className = "mark";
      el.dataset.id = lm.id;
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[lm.id] ?? ""}</svg><span class="name">${lm.label}</span><span class="dist"></span>`;
      marks.appendChild(el);
      this.marks.push({ lm, el, dist: el.querySelector<HTMLElement>(".dist")!, last: "", edge: "" });
    }
    parent.appendChild(this.root);
    window.addEventListener("resize", this.onResize);
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
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]!;
      stripPlace(yaw, yawTo(x, z, m.lm.x, m.lm.z), span, this.place);
      m.el.style.left = `${50 + this.place.x * 50}%`;
      const c = this.chips[i]!;
      c.x = this.place.x * 0.5 + 0.5;
      // (a chip is about 5 em of icon and distance plus 0.45 em a letter of name)
      c.width = (6.5 + 0.62 * m.lm.label.length) / this.stripEm;
      const edge = this.place.inside ? "" : this.place.x < 0 ? "l" : "r";
      if (edge !== m.edge) {
        m.edge = edge;
        m.el.dataset.edge = edge;
      }
      const text = distanceText(Math.hypot(m.lm.x - x, m.lm.z - z));
      if (text !== m.last) {
        m.last = text;
        m.dist.textContent = text;
      }
    }
    const deg = headingDegrees(yaw);
    if (deg !== this.lastDeg) {
      this.lastDeg = deg;
      this.readout.textContent = `${headingName(deg)} ${String(deg).padStart(3, "0")}°`;
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
