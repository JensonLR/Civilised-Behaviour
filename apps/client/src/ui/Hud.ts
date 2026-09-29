import { CASUALTY, FLAG } from "@cb/shared";

/** Everything the HUD needs for one frame; the game builds this from replicated + predicted state. */
export interface HudView {
  /** Predicted flags of the local player (FLAG bits). */
  flags: number;
  health: number;
  /** Progress (0-100) of a revive ON the local player. */
  reviveProgressOnMe: number;
  /** Progress (0-100) of the revive the local player is performing, or -1. */
  reviveProgressByMe: number;
  /** Contextual action prompt for whatever is in reach (already worded for the current input device). */
  prompt: string;
  /** Names for messages. */
  reviverName: string;
  patientName: string;
  usingGamepad: boolean;
}

/**
 * Minimal, clean gameplay HUD. Rules from the brief: no colour-only signals (state is always also text/shape),
 * keep the screen uncluttered, and never hide the situation from a downed player.
 */
export class Hud {
  private readonly health: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly downed: HTMLElement;
  private readonly notice: HTMLElement;
  private noticeTimer = 0;

  constructor(private readonly root: HTMLElement) {
    this.health = el(root, "div", "health");
    this.health.innerHTML = `<span class="label">Wounds</span><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div><b class="num"></b>`;
    this.healthFill = this.health.querySelector<HTMLElement>(".fill")!;
    this.healthText = this.health.querySelector<HTMLElement>(".num")!;

    this.prompt = el(root, "div", "prompt");
    this.prompt.hidden = true;

    this.progress = el(root, "div", "progress");
    this.progress.hidden = true;
    this.progress.innerHTML = `<div class="label"></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div>`;
    this.progressFill = this.progress.querySelector<HTMLElement>(".fill")!;
    this.progressLabel = this.progress.querySelector<HTMLElement>(".label")!;

    this.downed = el(root, "div", "downed");
    this.downed.hidden = true;
    this.notice = el(root, "div", "notice");
    this.notice.hidden = true;
  }

  /** Transient banner (e.g. the rout announcement). */
  showNotice(text: string, ms = 6000): void {
    this.notice.textContent = text;
    this.notice.hidden = false;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => (this.notice.hidden = true), ms);
  }

  update(v: HudView): void {
    const pct = Math.max(0, Math.min(100, v.health));
    this.healthFill.style.width = `${(pct / CASUALTY.maxHealth) * 100}%`;
    this.healthText.textContent = `${pct}`;
    this.health.querySelector(".bar")!.setAttribute("aria-valuenow", String(pct));
    this.health.dataset.state = pct === 0 ? "down" : pct <= 35 ? "critical" : "ok";

    const down = (v.flags & FLAG.DOWNED) !== 0;
    this.downed.hidden = !down;
    if (down) {
      const dragged = (v.flags & FLAG.DRAGGED) !== 0;
      const help = v.reviveProgressOnMe > 0 ? `${v.reviverName || "A comrade"} is patching you up...` : dragged ? "You are being dragged to safety." : "Crawl toward your comrades and wait for help.";
      this.downed.innerHTML = `<div class="title">✚ You are down</div><div class="sub">${escapeHtml(help)}</div>`;
    }

    // One progress bar serves both roles: patient (being revived) or medic (reviving).
    let label = "";
    let value = -1;
    if (down && v.reviveProgressOnMe > 0) {
      label = "Being revived";
      value = v.reviveProgressOnMe;
    } else if (v.reviveProgressByMe >= 0) {
      label = `Reviving ${v.patientName || "comrade"}`;
      value = v.reviveProgressByMe;
    }
    this.progress.hidden = value < 0;
    if (value >= 0) {
      this.progressLabel.textContent = `${label} - ${value}%`;
      this.progressFill.style.width = `${value}%`;
      this.progress.querySelector(".bar")!.setAttribute("aria-valuenow", String(value));
    }

    const text = down ? "" : v.prompt;
    this.prompt.hidden = text === "";
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
  }

  dispose(): void {
    for (const e of [this.health, this.prompt, this.progress, this.downed, this.notice]) e.remove();
    window.clearTimeout(this.noticeTimer);
  }
}

function el(root: HTMLElement, tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  root.appendChild(e);
  return e;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
