import type { CommandId } from "@cb/shared";
import { startPadNav } from "./PadNav.ts";
import { h } from "./modal.ts";
import "./commandWheel.css";

/**
 * The command wheel: five stamps on a ring, opened by HOLDING the Command action (default Q / pad LB; the integrator owns the rebindable action and calls
 * `open()` on press and `release()` on let-go). Choose by mouse (`nudge` with pointer-lock deltas, or `point` with a normalised position) or by stick
 * (`stick`); release sends the stamp under the pointer; the centre cancels. While open, 1-5 send at once, arrows move the choice, Enter / Space send it,
 * Escape cancels. The five stamps are real buttons (reachable by Tab and by PadNav's D-pad / A / B) and the ring is `role="menu"`.
 * A plain "Obeyed / Refused" line (`setResult`) says how the hands took it. Everything is text; colour is never the only signal; motion respects
 * `prefers-reduced-motion`; sizes are in rem so larger text scales the whole wheel.
 */

export interface WheelStamp { id: CommandId; label: string; hint: string }

export const WHEEL_STAMPS: readonly WheelStamp[] = [
  { id: "follow", label: "Follow", hint: "Keep up." },
  { id: "hold", label: "Hold", hint: "Stand about purposefully." },
  { id: "attack", label: "Attack", hint: "Hostilities, with enthusiasm." },
  { id: "fetch", label: "Fetch", hint: "Carry that, uncomplaining." },
  { id: "retreat", label: "Retreat", hint: "Advance rearward." },
];

/** Inside this fraction of the radius nothing is chosen: the centre cancels. */
export const WHEEL_DEAD = 0.3;
const SLICE = (Math.PI * 2) / WHEEL_STAMPS.length;

/**
 * Which stamp a pointer offset names: dx right, dy DOWN (screen), both in the same units, `radius` the ring's reach. Stamp 0 sits at the top and the
 * rest follow clockwise, 72 degrees apart. -1 inside the dead centre (or for a non-finite offset).
 */
export function wheelPick(dx: number, dy: number, radius = 1, dead = WHEEL_DEAD): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(radius > 0)) return -1;
  if (Math.hypot(dx, dy) < radius * dead) return -1;
  const a = ((Math.atan2(dx, -dy) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(a / SLICE) % WHEEL_STAMPS.length;
}

export class CommandWheel {
  readonly root = h("div", { class: "command-wheel", "data-open": "false" });
  private readonly ring = h("div", { class: "ring", role: "menu", "aria-label": "Command the hands", hidden: true });
  private readonly centre = h("div", { class: "centre", "aria-hidden": "true" }, h("span", {}, "Cancel"));
  private readonly result = h("p", { class: "result", role: "status", "aria-live": "polite", hidden: true });
  private readonly buttons: HTMLButtonElement[] = [];
  private chosen = -1;
  private cx = 0;
  private cy = 0;
  private opened = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopPad: (() => void) | undefined;
  private readonly disabled = new Set<CommandId>();
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.opened || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= WHEEL_STAMPS.length) {
      e.preventDefault();
      this.sendAt(n - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.cancel();
    } else if (e.key === "Enter" || e.key === " ") {
      if (this.chosen >= 0) {
        e.preventDefault();
        this.sendAt(this.chosen);
      }
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      this.move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      this.move(-1);
    }
  };

  /** `onSend` gets the chosen order; the caller adds the point under the crosshair, the target and the hands named. */
  constructor(parent: HTMLElement, private readonly onSend: (c: CommandId) => void) {
    WHEEL_STAMPS.forEach((s, i) => {
      const b = h(
        "button",
        { type: "button", class: "stamp", role: "menuitem", "data-i": String(i), "data-id": s.id, tabindex: "0", style: `--a: ${i * (360 / WHEEL_STAMPS.length)}deg` },
        h("span", { class: "key", "aria-hidden": "true" }, String(i + 1)),
        h("span", { class: "label" }, s.label),
        h("span", { class: "hint" }, s.hint),
      );
      b.addEventListener("click", () => this.sendAt(i));
      b.addEventListener("focus", () => { if (this.opened) this.choose(i); });
      this.buttons.push(b);
      this.ring.appendChild(b);
    });
    this.ring.appendChild(this.centre);
    this.root.append(this.ring, this.result);
    parent.appendChild(this.root);
    this.ring.addEventListener("padback", () => this.cancel());
    this.stopPad = startPadNav(this.ring, () => this.opened);
    window.addEventListener("keydown", this.onKey);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The stamp now highlighted, or -1 (the centre). */
  get choice(): number {
    return this.chosen;
  }

  /** Orders the hands cannot take now (no porter: fetch) are shown struck through and cannot be chosen. */
  setAvailable(ids: readonly CommandId[]): void {
    this.disabled.clear();
    for (const s of WHEEL_STAMPS) if (!ids.includes(s.id)) this.disabled.add(s.id);
    this.buttons.forEach((b, i) => {
      const off = this.disabled.has(WHEEL_STAMPS[i]!.id);
      if (off) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
      b.classList.toggle("off", off);
    });
    if (this.chosen >= 0 && this.disabled.has(WHEEL_STAMPS[this.chosen]!.id)) this.choose(-1);
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.cx = this.cy = 0;
    this.ring.hidden = false;
    this.root.dataset.open = "true";
    this.choose(-1);
  }

  /** The Command action was let go: send what is chosen (nothing at the centre) and close. Returns what was sent. */
  release(): CommandId | undefined {
    if (!this.opened) return undefined;
    const i = this.chosen;
    this.close();
    if (i < 0 || this.disabled.has(WHEEL_STAMPS[i]!.id)) return undefined;
    const id = WHEEL_STAMPS[i]!.id;
    this.onSend(id);
    return id;
  }

  cancel(): void {
    this.close();
  }

  /** Pointer-lock movement: a virtual cursor inside the ring, so the choice follows the hand however far it travels. */
  nudge(mx: number, my: number): void {
    if (!this.opened || !Number.isFinite(mx) || !Number.isFinite(my)) return;
    this.cx += mx / 120;
    this.cy += my / 120;
    const r = Math.hypot(this.cx, this.cy);
    if (r > 1) {
      this.cx /= r;
      this.cy /= r;
    }
    this.pickFrom(this.cx, this.cy);
  }

  /** An absolute position, x right and y DOWN, each -1..1 across the ring. */
  point(x: number, y: number): void {
    if (!this.opened) return;
    this.cx = x;
    this.cy = y;
    this.pickFrom(x, y);
  }

  /** A pad stick, x right and y DOWN (the standard mapping), -1..1. */
  stick(x: number, y: number): void {
    this.point(x, y);
  }

  /** "Obeyed" / "Refused" plus the hand's own words, shown for a few seconds. */
  setResult(text: string, ms = 4000): void {
    const t = String(text ?? "").slice(0, 400);
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (t.length === 0) {
      this.result.hidden = true;
      return;
    }
    const m = /^(Obeyed|Refused)\b(.*)$/s.exec(t);
    this.result.replaceChildren(...(m ? [h("b", { class: "verdict" }, m[1]!), h("span", { class: "rest" }, m[2]!)] : [h("span", { class: "rest" }, t)]));
    this.result.dataset.verdict = m ? m[1]!.toLowerCase() : "";
    this.result.hidden = false;
    this.timer = setTimeout(() => { this.result.hidden = true; }, ms);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.stopPad?.();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.root.remove();
  }

  private pickFrom(x: number, y: number): void {
    const i = wheelPick(x, y, 1);
    this.choose(i >= 0 && this.disabled.has(WHEEL_STAMPS[i]!.id) ? -1 : i);
  }

  private move(d: number): void {
    const n = WHEEL_STAMPS.length;
    for (let k = 1; k <= n; k++) {
      const i = (((this.chosen < 0 ? (d > 0 ? -1 : 0) : this.chosen) + d * k) % n + n) % n;
      if (!this.disabled.has(WHEEL_STAMPS[i]!.id)) {
        this.choose(i);
        return;
      }
    }
  }

  private choose(i: number): void {
    this.chosen = i;
    this.buttons.forEach((b, k) => b.classList.toggle("on", k === i));
    this.buttons.forEach((b, k) => { if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
    this.centre.classList.toggle("on", i < 0);
  }

  private sendAt(i: number): void {
    if (this.disabled.has(WHEEL_STAMPS[i]!.id)) return;
    this.close();
    this.onSend(WHEEL_STAMPS[i]!.id);
  }

  private close(): void {
    this.opened = false;
    this.ring.hidden = true;
    this.root.dataset.open = "false";
    this.chosen = -1;
    const a = document.activeElement;
    if (a instanceof HTMLElement && this.ring.contains(a)) a.blur();
  }
}
