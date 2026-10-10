import { typeset } from "./typeset.ts";

/**
 * D-085: THE ILLUSTRATED IMPERIAL NEWS. The game takes its own photograph of a spectacular moment (a keg chain, a body sent flying, a limb, a commission met) and runs it
 * as an engraving: the frame in sepia under the paper's heading, captioned with the casualty column's own line, sliding in at the side for a few seconds. Every plate of
 * the session is kept (the last twelve) and the pause sheet offers each one to save as a picture: a streamer's best moment, framed and captioned by the game itself.
 *
 * The picture is taken right after a frame is rendered (the drawing buffer is whole then: `frame`), downscaled into a small JPEG. A blast near the lens arms a capture a
 * moment later (the fireball up, the bodies in the air: `armCapture`); a column line of the right kind then publishes the most recent picture, or takes one now. At most
 * one plate every `PLATE_GAP_S`: a plate is an event, not a stream.
 */
export const PLATE_KINDS: ReadonlySet<string> = new Set(["request", "chain", "double", "brolly", "fling", "sever", "finisher"]);
export const PLATE_GAP_S = 18;
export const PLATE_SHOW_S = 5;
export const MAX_ALBUM = 12;
/** A picture older than this is not the moment the line is about. */
const FRESH_MS = 3500;
const W = 640;
const H = 360;

export interface Plate { url: string; caption: string; at: number }

/** The frame, downscaled to a small JPEG (undefined when the canvas cannot be read: a lost context, a test). */
export function snapshot(source: HTMLCanvasElement): string | undefined {
  try {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx || source.width === 0 || source.height === 0) return undefined;
    // cover the plate (crop the long side), as an engraver would frame it
    const s = Math.max(W / source.width, H / source.height);
    const sw = W / s;
    const sh = H / s;
    ctx.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, W, H);
    const url = c.toDataURL("image/jpeg", 0.85);
    return url.startsWith("data:image/") ? url : undefined;
  } catch {
    return undefined;
  }
}

export class GloryPlates {
  readonly album: Plate[] = [];
  private readonly card: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly caption: HTMLElement;
  private pendingAt = -1;
  private last?: { url: string; at: number };
  private waiting?: string;
  private lastShown = -Infinity;
  private hideTimer = 0;

  constructor(parent: HTMLElement, private readonly shoot: (source: HTMLCanvasElement) => string | undefined = snapshot) {
    this.card = document.createElement("figure");
    this.card.className = "plate";
    this.card.hidden = true;
    this.card.setAttribute("aria-hidden", "true"); // (the column already reads the line out; the picture is decoration)
    const head = document.createElement("header");
    head.textContent = "The Illustrated Imperial News";
    this.img = document.createElement("img");
    this.img.alt = "";
    this.caption = document.createElement("figcaption");
    this.card.append(head, this.img, this.caption);
    parent.appendChild(this.card);
  }

  /** A blast went off in view: take the picture `delayS` from now (one pending capture at a time; an earlier one stands). */
  armCapture(now: number, delayS = 0.3): void {
    if (this.pendingAt < 0) this.pendingAt = now + delayS * 1000;
  }

  /** Right after the frame is rendered: takes a pending picture, and publishes a plate that was waiting for it. */
  frame(source: HTMLCanvasElement, now: number): void {
    if (this.pendingAt < 0 || now < this.pendingAt) return;
    this.pendingAt = -1;
    const url = this.shoot(source);
    if (url) this.last = { url, at: now };
    if (this.waiting !== undefined) {
      const caption = this.waiting;
      this.waiting = undefined;
      if (url) this.publish(caption, now);
    }
  }

  /** A column line arrived: a spectacular kind makes a plate (the fresh picture, or the next frame's). */
  onGazette(text: unknown, kind: unknown, now: number): void {
    const t = typeset(String(text ?? "").trim()).slice(0, 220);
    if (t === "" || typeof kind !== "string" || !PLATE_KINDS.has(kind) || now - this.lastShown < PLATE_GAP_S * 1000) return;
    if (this.last && now - this.last.at <= FRESH_MS) this.publish(t, now);
    else {
      this.waiting = t;
      this.armCapture(now, 0);
    }
  }

  private publish(caption: string, now: number): void {
    if (!this.last) return;
    this.lastShown = now;
    const plate = { url: this.last.url, caption, at: now };
    this.last = undefined; // (one picture, one plate)
    this.album.push(plate);
    if (this.album.length > MAX_ALBUM) this.album.shift();
    this.img.src = plate.url;
    this.caption.textContent = caption;
    this.card.hidden = false;
    this.card.classList.remove("leaving");
    if (typeof window === "undefined") return;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.card.classList.add("leaving");
      this.hideTimer = window.setTimeout(() => (this.card.hidden = true), 600);
    }, PLATE_SHOW_S * 1000);
  }

  /** Whether a plate is on screen (tests). */
  get showing(): boolean {
    return !this.card.hidden;
  }

  dispose(): void {
    if (typeof window !== "undefined") window.clearTimeout(this.hideTimer);
    this.card.remove();
  }
}
