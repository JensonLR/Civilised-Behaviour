// The shared rule lives in packages/shared/src/nameTag.ts. (Relative import until the integrator adds `export * from "./nameTag.ts"` to the shared index.)
import { tagState, type TagState } from "@cb/shared";

/**
 * Name plates (D-034 rule 3): one `div.nametag` per actor, shown only where `tagState` says a plate can sit (in front, inside the frame, below the
 * compass band, in range for its role), faded over the last quarter of its range. Culled, never clamped. DOM writes happen only when something changed.
 * `update` once per actor per frame; `sweep` once per frame with every id that still exists.
 */

interface Plate { el: HTMLDivElement; text: string; shown: boolean; alpha: number; x: number; y: number; dist: number; w: number; h: number; off: number; hid: boolean }

/** Plate size estimate before the browser has measured it (CSS px at the default UI scale): the display face at 0.9 rem is about 8 px a character. */
const EST_CHAR_PX = 8.1;
const EST_PAD_PX = 26;
const EST_H_PX = 22;
/** A plate pushed up by a nearer one may climb this many plate-heights before it gives up and hides (a crowd keeps its nearest names, not a tower of them). */
const MAX_LIFT = 2;

export class NameTags {
  private readonly plates = new Map<string, Plate>();
  /** D-074: a screen rectangle the plates must keep off (the goal's marker): left, top, right, bottom in CSS px; `on` false when there is none. */
  private readonly obs = { on: false, l: 0, t: 0, r: 0, b: 0 };
  private readonly state: TagState = { show: false, alpha: 0 };

  constructor(private readonly layer: HTMLElement) {}

  /**
   * @param role      PlayerState.npc (0 = a human player)
   * @param dist      metres from the camera's owner
   * @param ndc       the projected anchor above the head
   * @param topPx     the anchor's screen y in CSS pixels (0 = top)
   * @param inSight   the owner has a line of sight to this actor (enemy plates reach farther)
   */
  update(id: string, text: string, role: number, down: boolean, dist: number, ndc: { x: number; y: number; z: number }, topPx: number, inSight = false): void {
    let p = this.plates.get(id);
    if (!p) {
      const el = document.createElement("div");
      el.className = "nametag";
      el.style.display = "none";
      this.layer.appendChild(el);
      p = { el, text: "", shown: false, alpha: 1, x: Number.NaN, y: Number.NaN, dist: 0, w: 0, h: 0, off: 0, hid: false };
      this.plates.set(id, p);
    }
    const s = tagState(dist, ndc.x, ndc.y, ndc.z, role, down, topPx, inSight, this.state);
    if (!s.show) {
      if (p.shown) {
        p.el.style.display = "none";
        p.shown = false;
      }
      return;
    }
    if (p.text !== text) {
      p.text = text;
      const nl = text.indexOf("\n");
      p.el.textContent = nl < 0 ? text : text.slice(0, nl);
      if (nl >= 0) {
        // a player's honour (D-055): a second, smaller line (its own block, so the plate is measured at the size it is drawn)
        const honour = document.createElement("span");
        honour.className = "honour";
        honour.textContent = text.slice(nl + 1);
        p.el.appendChild(honour);
      }
      p.el.dataset.role = String(role);
      p.w = 0; // re-measured below, once it is on the page
    }
    if (!p.shown) {
      p.el.style.display = "block";
      p.shown = true;
    }
    p.dist = dist;
    if (p.w === 0) {
      // measured once per text (a layout read only when the words change); a page with no layout (tests) keeps the estimate
      const scale = (parseFloat(getComputedStyle(this.layer).fontSize) || 16) / 16;
      p.w = p.el.offsetWidth || Math.round((text.length * EST_CHAR_PX + EST_PAD_PX) * scale);
      p.h = p.el.offsetHeight || Math.round(EST_H_PX * scale);
    }
    if (Math.abs(p.alpha - s.alpha) > 0.02) {
      p.alpha = s.alpha;
      p.el.style.opacity = s.alpha >= 0.99 ? "" : s.alpha.toFixed(2);
    }
    const px = Math.round(((ndc.x + 1) / 2) * window.innerWidth);
    const py = Math.round(topPx);
    if (px !== p.x || py !== p.y || p.off !== 0) {
      p.x = px;
      p.y = py;
      p.off = 0;
      p.el.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`;
    }
  }

  /**
   * D-040, after every `update` of a frame: plates never sit on each other or hang off the picture. The nearest actor keeps its spot; a farther plate
   * that would cover a nearer one climbs above it (up to MAX_LIFT plate-heights) or, with no room, is hidden for the frame (culled, never clamped); a
   * plate the frame's edge would cut is hidden. Allocation-free over the plates; DOM writes only for plates that moved or changed visibility.
   */
  layout(): void {
    const order = this.order;
    order.length = 0;
    for (const p of this.plates.values()) if (p.shown) order.push(p);
    order.sort((a, b) => a.dist - b.dist);
    const vw = window.innerWidth;
    let placed = 0;
    for (let i = 0; i < order.length; i++) {
      const p = order[i]!;
      const half = p.w / 2;
      const left = p.x - half;
      const right = p.x + half;
      let off = 0;
      let ok = left >= 0 && right <= vw;
      if (ok) {
        for (let lift = 0; lift <= MAX_LIFT; lift++) {
          off = lift * (p.h + 2);
          const bottom = p.y - off;
          const top = bottom - p.h;
          const ob = this.obs;
          let hit = ob.on && right > ob.l && left < ob.r && bottom > ob.t && top < ob.b; // (the goal's marker was there first)
          for (let j = 0; j < placed && !hit; j++) {
            const q = order[j]!;
            const qb = q.y - q.off;
            if (right > q.x - q.w / 2 && left < q.x + q.w / 2 && bottom > qb - q.h && top < qb) {
              hit = true;
              break;
            }
          }
          if (!hit) break;
          if (lift === MAX_LIFT) ok = false;
        }
      }
      const hid = !ok;
      if (hid !== p.hid) {
        p.hid = hid;
        p.el.style.visibility = hid ? "hidden" : "";
      }
      if (hid) continue;
      if (off !== p.off) {
        p.off = off;
        p.el.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y - off}px)`;
      }
      // (placed plates are kept at the front of `order`, nearest first)
      order[i] = order[placed]!;
      order[placed++] = p;
    }
  }
  private readonly order: Plate[] = [];

  /** D-074: keep the plates off this rectangle (the goal's marker) at the next layout; `on` false clears it. */
  setObstacle(on: boolean, l = 0, t = 0, r = 0, b = 0): void {
    const o = this.obs;
    o.on = on;
    o.l = l;
    o.t = t;
    o.r = r;
    o.b = b;
  }

  /** D-074: whether a plate on show stands within `r` px of (x, y) (its anchor, above the head): the goal's marker is over somebody whose name is already up. */
  plateNear(x: number, y: number, r: number): boolean {
    for (const p of this.plates.values()) if (p.shown && !p.hid && Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r) return true;
    return false;
  }

  /** Removes the plates of everyone who is no longer in `seen`, then lays out the rest (once a frame, after every `update`). */
  sweep(seen: ReadonlySet<string>): void {
    for (const [id, p] of this.plates) {
      if (seen.has(id)) continue;
      p.el.remove();
      this.plates.delete(id);
    }
    this.layout();
  }

  /** Number of plates currently showing (tests, debug overlay). */
  get shown(): number {
    let n = 0;
    for (const p of this.plates.values()) if (p.shown && !p.hid) n++;
    return n;
  }

  dispose(): void {
    for (const p of this.plates.values()) p.el.remove();
    this.plates.clear();
  }
}
