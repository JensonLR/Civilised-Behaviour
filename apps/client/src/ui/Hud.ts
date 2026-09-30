import { CASUALTY, FLAG, LIMB_LIST, ZONE_COUNT, ZONE_NAMES, limbZone, woundLevel } from "@cb/shared";
import { Compass } from "./Compass.ts";
import { Telegrams } from "./Telegrams.ts";
import { VITALS_LABEL, vitalsLevel } from "./vitals.ts";
import { HATCH_DEFS, ZONE_CENTRES, cuePath } from "./woundCues.ts";

const SEVERITY_WORDS = ["", "scratch", "gash", "grievous wound", "lost"] as const;

// Gauge geometry: the needle sweeps 240 degrees, 0 at lower left to 100 at lower right; the last CRITICAL_AT percent is the red zone.
const SWEEP = 240;
const CRITICAL_AT = 35;
const angleFor = (pct: number): number => -SWEEP / 2 + (SWEEP * pct) / 100;
const polar = (r: number, deg: number): [number, number] => [50 + r * Math.sin((deg * Math.PI) / 180), 50 - r * Math.cos((deg * Math.PI) / 180)];

function gaugeSvg(): string {
  let ticks = "";
  for (let i = 0; i <= 20; i++) {
    const major = i % 2 === 0;
    const [x1, y1] = polar(major ? 31 : 33, angleFor(i * 5));
    const [x2, y2] = polar(37, angleFor(i * 5));
    ticks += `<line class="tick${major ? "" : " minor"}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }
  const [zx0, zy0] = polar(40.5, angleFor(0));
  const [zx1, zy1] = polar(40.5, angleFor(CRITICAL_AT));
  return `<svg class="gauge" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring" cx="50" cy="50" r="48"/><circle class="bezel" cx="50" cy="50" r="45"/><circle class="face" cx="50" cy="50" r="42"/>
    <path class="zone" d="M${zx0.toFixed(2)} ${zy0.toFixed(2)} A40.5 40.5 0 0 1 ${zx1.toFixed(2)} ${zy1.toFixed(2)}"/>${ticks}
    <text class="num" x="50" y="74"></text>
    <line class="needle" x1="50" y1="52" x2="50" y2="15"/><circle class="hub" cx="50" cy="50" r="4"/></svg>`;
}

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
  /** The local player is dressing a standing comrade's wound (not reviving a downed one): changes the progress label only. */
  dressing?: boolean;
  usingGamepad: boolean;
  /** First-person view is fully active: show the aiming dot. */
  firstPerson?: boolean;
  /** A weapon is drawn: the combat sight (ui/CombatHud.ts) is the crosshair, so the plain dot is not drawn. */
  armed?: boolean;
  /** Packed wound mask of the local player (see @cb/shared wounds.ts). */
  wounds: number;
  /** Lost-limb mask (0 when the player has chosen not to see severed limbs: the injury then reads as its dressing). */
  missing?: number;
  /** Where the camera looks and where the player stands, for the heading strip (camera yaw, world x and z). Absent = the strip keeps its last reading. */
  yaw?: number;
  x?: number;
  z?: number;
}

/** The aiming dot shows in first person while the player can act; a downed player sees the mourning card and a sky, not a reticle. */
export const crosshairVisible = (firstPerson: boolean | undefined, flags: number): boolean => firstPerson === true && (flags & FLAG.DOWNED) === 0;

/**
 * Minimal, clean gameplay HUD. Rules from the brief: no colour-only signals (state is always also text/shape),
 * keep the screen uncluttered, and never hide the situation from a downed player.
 */
export class Hud {
  private readonly health: HTMLElement;
  private readonly needle: SVGElement;
  private readonly healthText: SVGElement;
  private readonly prompt: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly downed: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly wounds: HTMLElement;
  private readonly woundParts: SVGElement[];
  /** Shape marks for the colour-blind-safe mode (hidden by CSS otherwise). */
  private readonly woundCues: SVGElement[];
  private readonly woundText: HTMLElement;
  private readonly vitals: HTMLElement;
  private readonly vitalsLabel: HTMLElement;
  private readonly compass: Compass;
  /** The telegram stack: notices queue here (`showNotice`). */
  readonly telegrams: Telegrams;
  private shownWounds = -1;
  private level = -1;

  constructor(private readonly root: HTMLElement) {
    this.health = el(root, "div", "health");
    this.health.setAttribute("role", "meter");
    this.health.setAttribute("aria-label", "Vitality");
    this.health.setAttribute("aria-valuemin", "0");
    this.health.setAttribute("aria-valuemax", "100");
    this.health.innerHTML = `${gaugeSvg()}<span class="label">Vitality</span>`;
    this.vitalsLabel = this.health.querySelector<HTMLElement>(".label")!;
    this.needle = this.health.querySelector<SVGElement>(".needle")!;
    this.healthText = this.health.querySelector<SVGElement>(".num")!;

    // Injury chart: one shape per body zone (ZONE order). Severity is shown by fill AND outline weight AND the words beside it,
    // never by colour alone.
    this.wounds = el(root, "div", "wounds");
    this.wounds.hidden = true;
    this.wounds.innerHTML = `<svg viewBox="0 0 40 88" class="chart" role="img" aria-label="Injuries">${HATCH_DEFS}
      <circle data-z="0" cx="20" cy="9" r="7"/><rect data-z="1" x="11" y="18" width="18" height="30" rx="4"/>
      <rect data-z="2" x="3" y="19" width="6" height="28" rx="3"/><rect data-z="3" x="31" y="19" width="6" height="28" rx="3"/>
      <rect data-z="4" x="11" y="50" width="8" height="34" rx="3"/><rect data-z="5" x="21" y="50" width="8" height="34" rx="3"/>${ZONE_CENTRES.map((_, z) => `<path class="cue" data-cue="${z}"/>`).join("")}</svg><span class="text"></span>`;
    this.woundCues = [...this.wounds.querySelectorAll<SVGElement>("[data-cue]")];
    this.woundParts = [...this.wounds.querySelectorAll<SVGElement>("[data-z]")].sort((a, b) => Number(a.dataset.z) - Number(b.dataset.z));
    this.woundText = this.wounds.querySelector<HTMLElement>(".text")!;

    this.crosshair = el(root, "div", "crosshair");
    this.crosshair.hidden = true;
    this.crosshair.setAttribute("aria-hidden", "true");

    this.prompt = el(root, "div", "prompt");
    this.prompt.hidden = true;

    this.progress = el(root, "div", "progress");
    this.progress.hidden = true;
    this.progress.innerHTML = `<div class="label"></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div>`;
    this.progressFill = this.progress.querySelector<HTMLElement>(".fill")!;
    this.progressLabel = this.progress.querySelector<HTMLElement>(".label")!;

    this.downed = el(root, "div", "downed");
    this.downed.hidden = true;
    this.vitals = el(root, "div", "vitals");
    this.vitals.setAttribute("aria-hidden", "true");
    this.vitals.dataset.level = "0";
    this.compass = new Compass(root);
    this.telegrams = new Telegrams(root);
  }

  /** A telegram (the rout announcement, a comrade's news): queued, at most three on show, each for as long as it takes to read. */
  showNotice(text: string, seconds?: number): void {
    this.telegrams.push(text, seconds);
  }

  update(v: HudView): void {
    const pct = Math.max(0, Math.min(100, v.health));
    const frac = (pct / CASUALTY.maxHealth) * 100;
    const angle = angleFor(frac);
    this.needle.style.setProperty("--angle", `${angle}deg`);
    this.needle.style.transform = `rotate(${angle}deg)`;
    const state = pct === 0 ? "down" : frac <= CRITICAL_AT ? "critical" : "ok";
    this.healthText.textContent = `${pct}${state === "critical" ? " !" : state === "down" ? " ✚" : ""}`;
    this.health.setAttribute("aria-valuenow", String(pct));
    this.health.dataset.state = state;
    const down_ = (v.flags & FLAG.DOWNED) !== 0;
    const level = vitalsLevel(frac, down_ || pct === 0);
    if (level !== this.level) {
      this.level = level;
      this.vitals.dataset.level = String(level);
      this.vitalsLabel.textContent = VITALS_LABEL[level];
    }
    if (v.yaw !== undefined && v.x !== undefined && v.z !== undefined) this.compass.update(v.yaw, v.x, v.z);

    this.updateWounds(v.wounds, v.missing ?? 0);

    const down = (v.flags & FLAG.DOWNED) !== 0;
    this.crosshair.hidden = !crosshairVisible(v.firstPerson, v.flags) || v.armed === true;
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
      label = `${v.dressing ? "Dressing" : "Reviving"} ${v.patientName || "comrade"}`;
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

  private updateWounds(mask: number, missing: number): void {
    const key = mask | (missing << 12);
    if (key === this.shownWounds) return;
    this.shownWounds = key;
    const lostZones = new Set(LIMB_LIST.filter((l) => (missing & l) !== 0).map(limbZone));
    const found: { name: string; sev: number }[] = [];
    for (let z = 0; z < ZONE_COUNT; z++) {
      const sev = lostZones.has(z as never) ? 4 : woundLevel(mask, z);
      this.woundParts[z]?.setAttribute("data-sev", String(sev));
      const c = ZONE_CENTRES[z]!;
      this.woundCues[z]?.setAttribute("d", cuePath(sev, c[0], c[1]));
      if (sev > 0) found.push({ name: ZONE_NAMES[z]!, sev });
    }
    this.wounds.hidden = found.length === 0;
    found.sort((a, b) => b.sev - a.sev);
    const text = found.slice(0, 3).map((f) => `${f.name}: ${SEVERITY_WORDS[f.sev]}`).join(" · ");
    this.woundText.textContent = text;
    this.wounds.setAttribute("aria-label", `Injuries: ${text || "none"}`);
  }

  dispose(): void {
    for (const e of [this.health, this.wounds, this.crosshair, this.prompt, this.progress, this.downed, this.vitals]) e.remove();
    this.compass.dispose();
    this.telegrams.dispose();
  }
}

function el(root: HTMLElement, tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  root.appendChild(e);
  return e;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
