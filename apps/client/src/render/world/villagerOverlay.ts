import { Vector3, type Camera } from "three";

/**
 * The little paper things that hang over a villager: a luggage-tag name (the game's own `.nametag`) when the camera is very near, and a telegram
 * slip with a line of speech now and then. Plain DOM in the HUD layer, pooled (a handful of elements ever exist), positioned each frame from the
 * camera; nothing is created or garbage-collected per frame. Style rides on the interface's CSS variables (paper, ink, brass), so it follows the
 * palette and the high-contrast setting like the rest of the interface. Without a layer (tests, the menu) it does nothing.
 */

const CSS = `
.folk-say{position:absolute;left:0;top:0;max-width:14.5rem;padding:.42rem .75rem .38rem;font-family:var(--type);font-size:.8rem;line-height:1.28;color:var(--ink);
background:linear-gradient(var(--field),var(--paper));border-top:3px double var(--ink);border-bottom:3px double var(--ink);box-shadow:0 6px 16px color-mix(in srgb,var(--scrim) 42%,transparent);
pointer-events:none;will-change:transform;white-space:normal;text-align:left;transition:opacity .25s;opacity:0}
.folk-say::before{content:"HOLLOWMERE";display:block;font-family:var(--display);font-size:.56rem;letter-spacing:.34em;color:var(--stamp);margin-bottom:.12rem}
.folk-say::after{content:"";position:absolute;left:50%;bottom:-.5rem;width:.7rem;height:.7rem;margin-left:-.35rem;background:var(--paper);transform:rotate(45deg);
border-right:2px solid var(--ink);border-bottom:2px solid var(--ink);clip-path:polygon(100% 0,100% 100%,0 100%)}
.folk-say[data-on="1"]{opacity:1}
@media (prefers-reduced-motion:reduce){.folk-say{transition:none}}
:root[data-contrast="high"] .folk-say{border-top-width:4px;border-bottom-width:4px}
`;

interface Slot {
  el: HTMLDivElement;
  key: number;
  text: string;
  used: boolean;
}

const v = new Vector3();

export class FolkOverlay {
  private readonly bubbles: Slot[] = [];
  private readonly tags: Slot[] = [];
  private styled = false;

  constructor(
    private readonly layer: HTMLElement | undefined,
    private readonly camera: Camera | undefined,
    private readonly maxBubbles = 3,
    private readonly maxTags = 2,
  ) {}

  get active(): boolean {
    return this.layer !== undefined && this.camera !== undefined && typeof document !== "undefined";
  }

  private ensureStyle(): void {
    if (this.styled || typeof document === "undefined") return;
    this.styled = true;
    if (document.getElementById("folk-css")) return;
    const st = document.createElement("style");
    st.id = "folk-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  private slot(list: Slot[], cls: string, max: number): Slot | undefined {
    for (const s of list) if (!s.used) return s;
    if (list.length >= max || !this.layer) return undefined;
    const el = document.createElement("div");
    el.className = cls;
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
    this.layer.appendChild(el);
    const s: Slot = { el, key: -1, text: "", used: false };
    list.push(s);
    return s;
  }

  /** Call first each frame; then `bubble` / `tag` for what to show; then `end`. */
  begin(): void {
    for (const s of this.bubbles) s.used = false;
    for (const s of this.tags) s.used = false;
    if (this.active) this.ensureStyle();
  }

  private place(s: Slot, x: number, y: number, z: number, dx = 0): boolean {
    v.set(x, y, z).project(this.camera!);
    if (v.z >= 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) return false;
    const px = ((v.x + 1) / 2) * window.innerWidth + dx;
    const py = ((1 - v.y) / 2) * window.innerHeight;
    s.el.style.transform = `translate(-50%, -100%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    return true;
  }

  /** A speech slip over a head; `u` (0..1) is how far through its time it is (it fades in and out at the ends). */
  bubble(key: number, text: string, x: number, y: number, z: number, u: number): void {
    if (!this.active) return;
    // (a slip that is already up keeps its element, so the text is not rewritten every frame)
    let s = this.bubbles.find((b) => b.key === key && !b.used);
    s ??= this.slot(this.bubbles, "folk-say", this.maxBubbles);
    if (!s) return;
    if (!this.place(s, x, y, z)) return;
    s.used = true;
    if (s.key !== key || s.text !== text) {
      s.key = key;
      s.text = text;
      s.el.textContent = text;
    }
    s.el.style.display = "block";
    s.el.dataset.on = u > 0.04 && u < 0.92 ? "1" : "0";
  }

  /** A luggage tag with a name over a head. */
  tag(key: number, name: string, x: number, y: number, z: number): void {
    if (!this.active) return;
    let s = this.tags.find((b) => b.key === key && !b.used);
    s ??= this.slot(this.tags, "nametag", this.maxTags);
    if (!s) return;
    if (!this.place(s, x, y, z)) return;
    s.used = true;
    if (s.key !== key) {
      s.key = key;
      s.text = name;
      s.el.textContent = name;
    }
    s.el.style.display = "block";
  }

  end(): void {
    for (const s of this.bubbles) if (!s.used && s.el.style.display !== "none") s.el.style.display = "none";
    for (const s of this.tags) if (!s.used && s.el.style.display !== "none") s.el.style.display = "none";
  }

  dispose(): void {
    for (const s of [...this.bubbles, ...this.tags]) s.el.remove();
    this.bubbles.length = 0;
    this.tags.length = 0;
  }
}
