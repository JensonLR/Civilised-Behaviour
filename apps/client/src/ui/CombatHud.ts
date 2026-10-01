import { CARRIED, WEAPON, WEAPONS, type WeaponId } from "@cb/shared";
import { deviceTracker } from "../input/devices.ts";
import { fillPrompt, onPromptChange } from "../input/glyphDom.ts";

/**
 * The gunnery half of the interface, in the Society's stationery: a small armoury card (the hotbar of what is carried, the piece in hand, rounds in
 * the magazine as brass pips and the reserve as a number, a reload gauge with words), a crosshair whose four ticks open with the shot's spread, hit
 * markers (a cross for a hit, a barred cross for a man down, a saltire with words for a limb lost), a bearing mark that points at whoever fired on
 * you, and the cannon crew's card. Nothing here is colour-only: every state has a shape or a word. All styling is CSS variables (style.css, "combat").
 */

const ICONS: Record<number, string> = {
  [WEAPON.PISTOL]: `<path d="M8 9h26l2-3h9v6h-8l-2 2H27l-2 9h-8l2-9H8z"/>`,
  [WEAPON.RIFLE]: `<path d="M2 11h18l4-2h32v3H26l-3 3H16l-5 5H4l3-6z"/>`,
  [WEAPON.BLUNDERBUSS]: `<path d="M3 12h14l3-2h20l4-3 5-2v14l-5-2-4-3H21l-2 3h-6l-3 5H4l3-8z"/>`,
  [WEAPON.SABRE]: `<path d="M4 20l4-4 3 1 1-2 3 1-2 3 3 2 36-13 4-1-1 3-38 16-4-1-5-3z"/>`,
  [WEAPON.UMBRELLA]: `<path d="M6 20a4 4 0 1 1 8 0v-3h2v3a6 6 0 1 0 5-6l32-9 1 2-31 9v2L52 8l-2 3-1 3-30 5v-1z"/>`,
};

/** Marks for blows taken: one per direction, up to this many at once. */
const BEARINGS = 6;

const el = (root: HTMLElement, tag: string, cls: string, html = ""): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  root.appendChild(e);
  return e;
};

/** What the armoury card shows this frame. */
export interface ArmsView {
  /** Weapon in hand (`WEAPON` id) or -1. */
  weapon: number;
  /** Bit i set = carrying weapon id i. */
  owned: number;
  ammo: number;
  reserve: number;
  /** 0..100 reload progress (0 = not reloading). */
  reload: number;
  /** Cooldown remaining as a fraction 0..1 of the last shot's wait (a hint bar), 0 when ready. */
  wait: number;
  gamepad: boolean;
  /** Unused now (the reload prompt is the `{reload}` token, which follows a rebind and the device); kept so the game's call still type-checks. */
  reloadKey?: string;
  /** Hands busy (carrying, dragging, downed...): the card dims. */
  busy: boolean;
}

export interface CrosshairView {
  /** Show the sight at all (armed with a ranged piece and on your feet). */
  visible: boolean;
  /** Gap of the four ticks from the centre, in CSS pixels (from the shot's spread cone). */
  gap: number;
  aiming: boolean;
}

export interface CannonHud {
  /** 0 empty, 1 loading, 2 loaded, 3 fuse lit. */
  phase: number;
  progress: number;
  crew: number;
  shells: number;
  /** The local player is in reach and working it. */
  mine: boolean;
}

export class CombatHud {
  private readonly arms: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly name: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly reserve: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly gaugeFill: HTMLElement;
  private readonly gaugeText: HTMLElement;
  private readonly sight: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly markText: HTMLElement;
  private readonly bearings: HTMLElement;
  private readonly bearingMarks: HTMLElement[] = [];
  private readonly bearingAngle = new Float32Array(BEARINGS);
  private readonly bearingPower = new Float32Array(BEARINGS);
  private readonly cannon: HTMLElement;
  private shown = "";
  private cannonShown = "";
  private lastArms: ArmsView | undefined;
  private lastCannon: CannonHud | undefined;
  private offPrompt: (() => void) | undefined;
  private markTimer = 0;
  private readonly bearingTimers = new Float32Array(BEARINGS);
  private lastGap = -1;

  constructor(private readonly root: HTMLElement) {
    this.arms = el(root, "div", "arms");
    this.arms.hidden = true;
    const slots = CARRIED.map((id, i) => `<span class="slot" data-w="${id}"><kbd class="kb-only">${i + 1}</kbd><svg viewBox="0 0 60 26" aria-hidden="true">${ICONS[id] ?? ""}</svg></span>`).join("");
    this.arms.innerHTML = `<div class="hotbar" role="group" aria-label="Weapons carried">${slots}</div>
      <div class="piece"><span class="pname"></span><span class="pips" aria-hidden="true"></span><span class="reserve"></span></div>
      <div class="gauge" hidden><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div><span class="gtext"></span></div>`;
    for (const s of this.arms.querySelectorAll<HTMLElement>(".slot")) this.slots.push(s);
    this.name = this.arms.querySelector<HTMLElement>(".pname")!;
    this.pips = this.arms.querySelector<HTMLElement>(".pips")!;
    this.reserve = this.arms.querySelector<HTMLElement>(".reserve")!;
    this.gauge = this.arms.querySelector<HTMLElement>(".gauge")!;
    this.gaugeFill = this.arms.querySelector<HTMLElement>(".fill")!;
    this.gaugeText = this.arms.querySelector<HTMLElement>(".gtext")!;

    this.sight = el(root, "div", "sight", `<i class="t n"></i><i class="t e"></i><i class="t s"></i><i class="t w"></i><b class="d"></b>`);
    this.sight.hidden = true;
    this.sight.setAttribute("aria-hidden", "true");

    this.mark = el(root, "div", "hitmark", `<svg viewBox="-20 -20 40 40" aria-hidden="true"><path class="cross" d="M-11 -11L-4 -4M11 -11L4 -4M-11 11L-4 4M11 11L4 4"/><path class="bar" d="M-14 0H-6M14 0H6M0 -14V-6"/></svg><span class="mtext"></span>`);
    this.mark.hidden = true;
    this.markText = this.mark.querySelector<HTMLElement>(".mtext")!;

    this.bearings = el(root, "div", "bearings");
    this.bearings.setAttribute("aria-hidden", "true");
    for (let i = 0; i < BEARINGS; i++) {
      // a wedge of the ring round the sight (about 34 degrees of it) with an arrowhead outside it pointing at the attacker: a shape, in ink and paper as well as stamp red
      const b = el(this.bearings, "div", "bearing", `<svg viewBox="-60 -60 120 120"><path class="wedge" d="M-16.2 -46.2A49 49 0 0 1 16.2 -46.2L12.6 -37.2A39.4 39.4 0 0 0-12.6 -37.2Z"/><path class="chev" d="M-8 -53 0 -63 8 -53 3 -53 0 -57 -3 -53z"/></svg>`);
      b.hidden = true;
      this.bearingMarks.push(b);
    }

    this.cannon = el(root, "div", "cannoncard");
    this.cannon.hidden = true;
    // the player picks up the other device (or rebinds): the prompts on show are drawn again with the new glyphs, between two frames
    this.offPrompt = onPromptChange(() => {
      this.shown = "";
      this.cannonShown = "";
      if (this.lastArms) this.updateArms(this.lastArms);
      this.updateCannon(this.lastCannon);
    });
  }

  /** The armoury card. Cheap to call every frame: it only writes what changed. */
  updateArms(v: ArmsView): void {
    this.lastArms = v;
    const carrying = v.owned !== 0;
    this.arms.hidden = !carrying;
    if (!carrying) return;
    const key = `${v.weapon}|${v.owned}|${v.ammo}|${v.reserve}|${v.reload}|${v.busy ? 1 : 0}|${v.gamepad ? 1 : 0}|${Math.round(v.wait * 8)}|${v.reloadKey ?? ""}|${deviceTracker.effective}`;
    if (key === this.shown) return;
    this.shown = key;
    this.arms.classList.toggle("busy", v.busy);
    this.slots.forEach((s, i) => {
      const id = CARRIED[i]!;
      s.classList.toggle("on", id === v.weapon);
      s.classList.toggle("lack", (v.owned & (1 << id)) === 0);
      s.querySelector("kbd")!.textContent = String(i + 1); // (hidden on a pad by CSS: the d-pad cycles, there are no number keys)
    });
    const def = v.weapon >= 0 ? WEAPONS[v.weapon as WeaponId] : undefined;
    this.name.textContent = def ? def.label : "Empty hands";
    const r = def?.ranged;
    if (r && def.id !== WEAPON.CANNON) {
      let pips = "";
      for (let i = 0; i < r.magazine; i++) pips += `<i class="${i < v.ammo ? "full" : "spent"}"></i>`;
      this.pips.innerHTML = pips;
      fillPrompt(this.reserve, `×${v.reserve}`);
      this.reserve.classList.toggle("dry", v.reserve === 0 && v.ammo === 0);
      this.pips.parentElement!.classList.toggle("empty", v.ammo === 0 && v.reload === 0);
    } else {
      this.pips.innerHTML = "";
      fillPrompt(this.reserve, def ? (def.fire === "melee" ? "Hold {fire} to swing" : "") : "");
      this.reserve.classList.remove("dry");
      this.pips.parentElement!.classList.remove("empty");
    }
    const reloading = v.reload > 0;
    const empty = !!r && v.ammo === 0 && !reloading;
    this.gauge.hidden = !reloading && !empty;
    if (reloading) {
      this.gaugeFill.style.width = `${v.reload}%`;
      this.gaugeText.textContent = `Loading – ${v.reload}%`;
      this.gauge.querySelector(".bar")!.setAttribute("aria-valuenow", String(v.reload));
      this.gauge.classList.remove("dry");
    } else if (empty) {
      this.gaugeFill.style.width = "0%";
      fillPrompt(this.gaugeText, v.reserve > 0 ? "Empty – press {reload}" : "Out of powder and shot"); // ({reload} is the Reload key, or the pad's Use control held)
      this.gauge.classList.toggle("dry", v.reserve === 0);
    }
  }

  updateSight(v: CrosshairView): void {
    this.sight.hidden = !v.visible;
    if (!v.visible) return;
    const g = Math.round(Math.max(4, Math.min(160, v.gap)));
    if (g !== this.lastGap) {
      this.sight.style.setProperty("--gap", `${g}px`);
      this.lastGap = g;
    }
    this.sight.classList.toggle("aim", v.aiming);
  }

  /** The shooter's confirmation: a cross for a hit, barred for a man down, worded for a limb lost. */
  hitMarker(zone: number, down: boolean, sever: boolean): void {
    this.mark.hidden = false;
    this.mark.dataset.kind = sever ? "sever" : down ? "down" : zone === 0 ? "head" : "hit";
    this.markText.textContent = sever ? "Severed" : down ? "Down" : zone === 0 ? "Headshot" : "";
    this.markTimer = sever || down ? 0.9 : 0.35;
    void this.mark.getBoundingClientRect(); // restart the CSS animation
    this.mark.classList.remove("pop");
    void this.mark.offsetWidth;
    this.mark.classList.add("pop");
  }

  /**
   * Someone hit YOU: a wedge on the ring round the sight with an arrowhead, pointing toward where the blow came from. `rad` is the bearing relative to
   * the view (0 = ahead, + = right); `power` 0..1 sets how bold it is. A second blow from about the same direction refreshes the same mark (so a volley
   * is one mark, not a ring of them); a blow from elsewhere takes a free mark, or the oldest.
   */
  damageFrom(rad: number, power = 0.5): void {
    if (!Number.isFinite(rad)) return;
    let idx = -1;
    let oldest = 0;
    for (let i = 0; i < BEARINGS; i++) {
      if (this.bearingTimers[i]! > 0) {
        const d = Math.abs(Math.atan2(Math.sin(rad - this.bearingAngle[i]!), Math.cos(rad - this.bearingAngle[i]!)));
        if (d < 0.45) idx = i;
        if (this.bearingTimers[i]! < this.bearingTimers[oldest]!) oldest = i;
      } else if (idx < 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) idx = oldest;
    const b = this.bearingMarks[idx]!;
    this.bearingAngle[idx] = rad;
    this.bearingPower[idx] = 0.55 + 0.45 * Math.min(1, Math.max(0, power));
    b.style.transform = `translate(-50%, -50%) rotate(${rad}rad)`;
    b.style.opacity = String(this.bearingPower[idx]);
    b.hidden = false;
    this.bearingTimers[idx] = 1.8;
  }

  updateCannon(v: CannonHud | undefined): void {
    this.lastCannon = v;
    if (!v) {
      this.cannon.hidden = true;
      this.cannonShown = "";
      return;
    }
    this.cannon.hidden = false;
    const state = v.phase === 0 ? (v.shells > 0 ? "Empty – hold {interact} to load" : "Out of shot") : v.phase === 1 ? `Loading – ${v.progress}%` : v.phase === 2 ? "Loaded – {fire} lights the fuse" : "Fuse lit – stand clear!";
    const pace = v.phase === 1 ? (v.crew >= 2 ? "full crew: quick" : "one hand: slow") : "";
    const ckey = `${state}|${v.progress}|${v.crew}|${v.shells}|${v.phase}|${deviceTracker.effective}`;
    if (ckey === this.cannonShown) return;
    this.cannonShown = ckey;
    this.cannon.dataset.phase = String(v.phase);
    this.cannon.innerHTML = `<div class="ct">Field Cannon</div><div class="cs"></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v.progress}"><div class="fill" style="width:${v.phase === 2 ? 100 : v.progress}%"></div></div>
      <div class="cc">Crew ${v.crew}${pace ? ` · ${pace}` : ""} · Shot in the limber: ${v.shells}</div>`;
    fillPrompt(this.cannon.querySelector<HTMLElement>(".cs")!, state);
  }

  /** Advances the fade timers. */
  tick(dt: number): void {
    if (this.markTimer > 0) {
      this.markTimer -= dt;
      if (this.markTimer <= 0) this.mark.hidden = true;
    }
    for (let i = 0; i < BEARINGS; i++) {
      if (this.bearingTimers[i]! > 0) {
        this.bearingTimers[i]! -= dt;
        const b = this.bearingMarks[i]!;
        b.style.opacity = String(Math.min(1, this.bearingTimers[i]! / 0.7) * this.bearingPower[i]!);
        if (this.bearingTimers[i]! <= 0) b.hidden = true;
      }
    }
  }

  dispose(): void {
    this.offPrompt?.();
    for (const e of [this.arms, this.sight, this.mark, this.bearings, this.cannon]) e.remove();
    void this.root;
  }
}
