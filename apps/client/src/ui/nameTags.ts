// The shared rule lives in packages/shared/src/nameTag.ts. (Relative import until the integrator adds `export * from "./nameTag.ts"` to the shared index.)
import { tagState, type TagState } from "@cb/shared";

/**
 * Name plates (D-034 rule 3): one `div.nametag` per actor, shown only where `tagState` says a plate can sit (in front, inside the frame, below the
 * compass band, in range for its role), faded over the last quarter of its range. Culled, never clamped. DOM writes happen only when something changed.
 * `update` once per actor per frame; `sweep` once per frame with every id that still exists.
 */

interface Plate { el: HTMLDivElement; text: string; shown: boolean; alpha: number; x: number; y: number }

export class NameTags {
  private readonly plates = new Map<string, Plate>();
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
      p = { el, text: "", shown: false, alpha: 1, x: Number.NaN, y: Number.NaN };
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
      p.el.textContent = text;
      p.el.dataset.role = String(role);
    }
    if (!p.shown) {
      p.el.style.display = "block";
      p.shown = true;
    }
    if (Math.abs(p.alpha - s.alpha) > 0.02) {
      p.alpha = s.alpha;
      p.el.style.opacity = s.alpha >= 0.99 ? "" : s.alpha.toFixed(2);
    }
    const px = Math.round(((ndc.x + 1) / 2) * window.innerWidth);
    const py = Math.round(topPx);
    if (px !== p.x || py !== p.y) {
      p.x = px;
      p.y = py;
      p.el.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`;
    }
  }

  /** Removes the plates of everyone who is no longer in `seen`. */
  sweep(seen: ReadonlySet<string>): void {
    for (const [id, p] of this.plates) {
      if (seen.has(id)) continue;
      p.el.remove();
      this.plates.delete(id);
    }
  }

  /** Number of plates currently showing (tests, debug overlay). */
  get shown(): number {
    let n = 0;
    for (const p of this.plates.values()) if (p.shown) n++;
    return n;
  }

  dispose(): void {
    for (const p of this.plates.values()) p.el.remove();
    this.plates.clear();
  }
}
