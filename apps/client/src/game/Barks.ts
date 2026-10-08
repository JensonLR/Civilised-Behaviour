import type { Camera } from "three";
import { FolkOverlay } from "../render/world/villagerOverlay.ts";

/** Seconds a bark's slip stays up (it fades in and out at the ends). */
export const BARK_SHOW_S = 2.8;
/** Slips at once: a fight is a few voices (the server spaces them too). */
export const MAX_BARKS = 3;
/** Metres above a speaker's feet the slip hangs. */
const HEAD = 2.25;

interface Live { id: string; text: string; kicker: string; at: number; key: number }

const keyOf = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * D-087: what the party's gentlemen say, as slips of speech over their heads. The voice is gibberish (audio/babble.ts); the slip carries the words, headed with the
 * speaker's name, so a clip reads with the sound off and a deaf player misses nothing. Pooled DOM in the HUD's name-plate layer (the villagers' overlay): nothing is
 * created per frame. A speaker who speaks again replaces their own slip.
 */
export class Barks {
  private readonly live: Live[] = [];
  private readonly overlay: FolkOverlay;

  constructor(layer: HTMLElement | undefined, camera: Camera | undefined) {
    this.overlay = new FolkOverlay(layer, camera, MAX_BARKS, 0);
  }

  say(id: string, text: string, kicker: string, now: number): void {
    const t = String(text).trim().slice(0, 90);
    if (t === "") return;
    const i = this.live.findIndex((l) => l.id === id);
    if (i >= 0) this.live.splice(i, 1);
    if (this.live.length >= MAX_BARKS) this.live.shift();
    this.live.push({ id, text: t, kicker: String(kicker).slice(0, 40).toUpperCase(), at: now, key: keyOf(id) });
  }

  /** Each frame: places the slips over the speakers (`where` answers a speaker's feet, or undefined when they are gone) and drops the ones whose time is up. */
  frame(now: number, where: (id: string) => { x: number; y: number; z: number } | undefined): void {
    for (let i = this.live.length - 1; i >= 0; i--) if (now - this.live[i]!.at >= BARK_SHOW_S * 1000) this.live.splice(i, 1);
    if (!this.overlay.active) return;
    this.overlay.begin();
    for (const l of this.live) {
      const p = where(l.id);
      if (p) this.overlay.bubble(l.key, l.text, p.x, p.y + HEAD, p.z, (now - l.at) / (BARK_SHOW_S * 1000), l.kicker);
    }
    this.overlay.end();
  }

  /** What is being said now (tests, the e2e). */
  get showing(): readonly { id: string; text: string }[] {
    return this.live.map((l) => ({ id: l.id, text: l.text }));
  }

  dispose(): void {
    this.overlay.dispose();
    this.live.length = 0;
  }
}
