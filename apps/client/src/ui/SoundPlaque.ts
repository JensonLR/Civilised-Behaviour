import { audioState, type AudioState } from "../audio/index.ts";
import { getVolume } from "../settings.ts";

/**
 * A browser will not let a page make a sound before the player has done something, so the front door is silent until the first click or key. This is the
 * gentle word about it: a small brass plaque at the foot of the screen that says so while the audio is waiting, and goes the moment it is not. It never
 * blocks anything (pointer-events: none), is hidden where sound cannot work at all or the master volume is at zero, and is a live region for screen readers.
 */
export const plaqueVisible = (state: AudioState, master: number): boolean => (state === "idle" || state === "suspended") && master > 0;

export class SoundPlaque {
  private readonly el: HTMLElement;
  private timer = 0;
  private readonly wake = (): void => {
    // the engine resumes on the same gesture; give it a moment, then look
    window.setTimeout(() => this.refresh(), 250);
    window.setTimeout(() => this.refresh(), 900);
  };

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "soundplaque";
    this.el.setAttribute("role", "status");
    this.el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" class="w"/></svg><span>${typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "Tap" : "Click"} anywhere to enable sound</span>`; // (a phone is tapped: D-049)
    this.el.hidden = true;
    parent.appendChild(this.el);
    for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, this.wake, { capture: true });
    this.timer = window.setInterval(() => this.refresh(), 1500);
    this.refresh();
  }

  refresh(): void {
    const show = plaqueVisible(audioState(), getVolume("master"));
    if (this.el.hidden === show) this.el.hidden = !show;
  }

  dispose(): void {
    for (const ev of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(ev, this.wake, { capture: true });
    window.clearInterval(this.timer);
    this.el.remove();
  }
}
