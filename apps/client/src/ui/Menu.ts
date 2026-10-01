import { JOIN_CODE_LENGTH, isValidJoinCode } from "@cb/shared";

export interface MenuHandlers {
  /** Found an expedition. `progress` names the stage reached ("Surveying the territory...") for the working card. */
  onCreate(name: string, rules: { dismemberment: boolean }, progress: (step: string) => void): Promise<void>;
  onJoin(code: string, name: string, progress: (step: string) => void): Promise<void>;
  /** D-035: bring a saved expedition back by its code (the server answers a stranger and an unknown code alike). */
  onResume?(code: string, name: string, progress: (step: string) => void): Promise<void>;
}

/** The join lookup found no live room for the code: a dormant campaign may be waiting, so the failure card offers to resume it. */
export const isNoLiveCampaign = (message: string): boolean => /^No campaign with that code/i.test(message);

import { describeError, stepAt } from "./menuLogic.ts";
import { bindPrompt } from "../input/glyphDom.ts";
import { startPadNav } from "./PadNav.ts";
import { REACH_RETRY } from "../platform/reachCopy.ts";
import { anyModalOpen } from "./modal.ts";
import { openHowTo, hasSeenHowTo } from "./HowTo.ts";
import { openSettings } from "./Settings.ts";
import { GORE_LEVELS, getCampaignLimbLoss, getGore, onSettingChange, setCampaignLimbLoss, setGore } from "../settings.ts";

declare const __APP_VERSION__: string | undefined;
/** Shown on the front door and useful in bug reports. */
export const versionLabel = (): string => `Pre-alpha ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"}`;

/** The compass of the working card: a brass dial whose needle swings (CSS; still under reduced motion) while the Society is consulted. */
const DIAL = `<svg class="dial" viewBox="-50 -50 100 100" aria-hidden="true"><circle r="47" class="rim"/><circle r="41" class="face"/>${Array.from({ length: 16 }, (_, i) => `<line class="tk" x1="0" y1="-41" x2="0" y2="${i % 4 === 0 ? -32 : -36}" transform="rotate(${i * 22.5})"/>`).join("")}<text class="n" y="-22" text-anchor="middle">N</text><g class="needle"><path d="M0 -34 6 0 0 6-6 0z" class="n1"/><path d="M0 34-6 0 0-6 6 0z" class="n2"/></g><circle r="4" class="hub"/></svg>`;

/** A compass rose for the letterhead: eight points, drawn in currentColor so it takes the brass of the rule beside it. */
const COMPASS = `<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 1 19 13 31 16 19 19 16 31 13 19 1 16 13 13Z"/><circle cx="16" cy="16" r="2.4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M16 7 17.6 14.4 25 16 17.6 17.6 16 25 14.4 17.6 7 16 14.4 14.4Z" fill="none" stroke="currentColor" stroke-width=".6" transform="rotate(45 16 16)"/></svg>`;

/** Front door: name + create/join. Plain DOM so it works identically with mouse, keyboard and pad focus. */
export class Menu {
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  /** Container the character creator renders into (right-hand side, next to the 3D preview). */
  readonly creatorHost: HTMLElement;
  private readonly consult: HTMLElement;
  private readonly consultHead: HTMLElement;
  private readonly consultStep: HTMLElement;
  private readonly consultActions: HTMLElement;
  private stepOverride: string | undefined;
  private workingSince = 0;
  private workingTimer = 0;
  private lastAction: (() => Promise<void>) | undefined;
  /** True while the action in hand is a join (only a join that found nothing offers to resume). */
  private lastWasJoin = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: MenuHandlers,
  ) {
    const prefill = new URLSearchParams(location.search).get("join")?.toUpperCase() ?? "";
    let savedName = "";
    try {
      savedName = localStorage.getItem("cb.name") ?? "";
    } catch {
      /* storage unavailable; fine */
    }
    root.innerHTML = `
      <div class="panel main" role="dialog" aria-labelledby="title">
        <p class="society">The Imperial Cartographic &amp; Improvement Society</p>
        <div class="rule" aria-hidden="true">${COMPASS}</div>
        <h1 id="title">Civilised Behaviour</h1>
        <p class="tag">Charter for an expedition into territories not yet improved</p>
        <label>Name upon the manifest
          <input id="name" maxlength="20" autocomplete="off" placeholder="Sir Reginald Blunt" value="${savedName.replace(/[&<>"]/g, "")}" />
        </label>
        <div class="row">
          <button id="create" class="primary">New campaign</button>
        </div>
        <label class="check"><input type="checkbox" id="limb-rule"${getCampaignLimbLoss() ? " checked" : ""} /> Limbs may be lost in this campaign</label>
        <div class="or">or present a code to join a party</div>
        <div class="row">
          <input id="code" maxlength="${JOIN_CODE_LENGTH}" autocomplete="off" placeholder="CODE" value="${prefill.replace(/[^A-Z0-9]/g, "")}" />
          <button id="join">Join</button>
        </div>
        <div class="row aux">
          <button id="options" class="quiet">Options</button>
          <button id="howto" class="quiet${hasSeenHowTo() ? "" : " new"}">How to play</button>
        </div>
        <label class="opt">Sensibilities: gore
          <select id="gore" aria-describedby="gore-note">${GORE_LEVELS.map((g) => `<option value="${g}"${g === getGore() ? " selected" : ""}>${g[0]!.toUpperCase()}${g.slice(1)}</option>`).join("")}</select>
        </label>
        <p id="gore-note" class="fine">Off replaces all blood with bandages and iodine. Wounds stay just as readable.</p>
        <p id="status" role="status" aria-live="polite"></p>
        <p id="reach" class="fine reach" role="status" aria-live="polite" hidden></p>
        <p class="fine">Mature content: strong violence, coarse language and dark satire.</p>
        <p class="fine version">${versionLabel()}</p>
      </div>
      <div class="panel" id="creator-host" aria-label="Character creator"></div>
      <div class="consult" hidden>
        <div class="card panel" role="alertdialog" aria-labelledby="consult-head" aria-describedby="consult-step" tabindex="-1">
          ${DIAL}
          <h2 id="consult-head">Consulting the Society...</h2>
          <p id="consult-step" role="status" aria-live="polite"></p>
          <div class="bar" aria-hidden="true"><div class="fill"></div></div>
          <div class="actions" hidden><button type="button" class="primary retry">Try again</button><button type="button" class="resume" hidden>Resume this expedition</button><button type="button" class="back">Return to the door</button></div>
        </div>
      </div>`;
    // a pad's hint under the door (shown only while a pad is the device in use): the front door is the first thing a pad player sees
    const hint = document.createElement("p");
    hint.className = "hintbar pad-only";
    hint.setAttribute("aria-hidden", "true");
    bindPrompt(hint, () => "{menuUp} {menuDown} Move   {confirm} Choose   {menuLeft} {menuRight} Adjust");
    root.querySelector(".main .version")?.before(hint);
    this.creatorHost = root.querySelector<HTMLElement>("#creator-host")!;
    this.nameInput = root.querySelector<HTMLInputElement>("#name")!;
    this.codeInput = root.querySelector<HTMLInputElement>("#code")!;
    this.status = root.querySelector<HTMLElement>("#status")!;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>("#create, #join")];
    this.consult = root.querySelector<HTMLElement>(".consult")!;
    this.consultHead = root.querySelector<HTMLElement>("#consult-head")!;
    this.consultStep = root.querySelector<HTMLElement>("#consult-step")!;
    this.consultActions = root.querySelector<HTMLElement>(".consult .actions")!;
    root.querySelector(".consult .retry")!.addEventListener("click", () => this.lastAction && void this.run(this.lastAction));
    root.querySelector(".consult .back")!.addEventListener("click", () => this.closeConsult());
    root.querySelector(".consult .resume")!.addEventListener("click", () => {
      const code = this.codeInput.value.trim().toUpperCase();
      if (isValidJoinCode(code) && handlers.onResume) void this.run(() => handlers.onResume!(code, this.name(), (t) => this.progress(t)), false);
    });
    this.consult.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.consultActions.hidden) this.closeConsult();
    });
    root.addEventListener("padback", () => !this.consultActions.hidden && this.closeConsult());
    root.querySelector("#create")!.addEventListener("click", () => void this.run(() => handlers.onCreate(this.name(), this.rules(), (t) => this.progress(t)), false));
    root.querySelector("#join")!.addEventListener("click", () => void this.join());
    root.querySelector<HTMLSelectElement>("#gore")!.addEventListener("change", (e) => setGore((e.target as HTMLSelectElement).value as (typeof GORE_LEVELS)[number]));
    const options = root.querySelector<HTMLButtonElement>("#options")!;
    const howto = root.querySelector<HTMLButtonElement>("#howto")!;
    options.addEventListener("click", () => openSettings(options));
    howto.addEventListener("click", () => openHowTo(howto));
    // The gore choice is shared with the settings screen: follow it if it changes there.
    onSettingChange(() => {
      root.querySelector<HTMLSelectElement>("#gore")!.value = getGore();
      howto.classList.toggle("new", !hasSeenHowTo());
    });
    this.codeInput.addEventListener("input", () => (this.codeInput.value = this.codeInput.value.toUpperCase()));
    this.codeInput.addEventListener("keydown", (e) => e.key === "Enter" && void this.join());
    this.nameInput.addEventListener("keydown", (e) => e.key === "Enter" && !prefill && void this.run(() => handlers.onCreate(this.name(), this.rules(), (t) => this.progress(t)), false));
    startPadNav(root, () => !this.root.hidden && !anyModalOpen());
  }

  private rules(): { dismemberment: boolean } {
    const dismemberment = this.root.querySelector<HTMLInputElement>("#limb-rule")!.checked;
    setCampaignLimbLoss(dismemberment);
    return { dismemberment };
  }

  private name(): string {
    const n = this.nameInput.value.trim();
    try {
      localStorage.setItem("cb.name", n);
    } catch {
      /* ignore */
    }
    return n;
  }

  private async join(): Promise<void> {
    const code = this.codeInput.value.trim().toUpperCase();
    if (!isValidJoinCode(code)) {
      this.setStatus("Codes are five characters, e.g. K7M2Q.", true);
      return;
    }
    await this.run(() => this.handlers.onJoin(code, this.name(), (t) => this.progress(t)), true);
  }

  /** The desktop build opens offline: say whether the Society's offices (the server) can be reached, and offer to ask again when they cannot (D-036). */
  setReach(text: string, retry?: () => void): void {
    const el = this.root.querySelector<HTMLElement>("#reach")!;
    el.hidden = false;
    el.textContent = text;
    if (retry) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiet";
      b.textContent = REACH_RETRY;
      b.addEventListener("click", retry);
      el.append(" ", b);
    }
  }

  /** A friend's invite (the storefront's overlay) arrived as a valid join code: fill it in and join. */
  async joinWith(code: string): Promise<void> {
    if (!isValidJoinCode(code)) return;
    this.codeInput.value = code.toUpperCase();
    await this.join();
  }

  /** Names the stage the work has reached (the working card shows it instead of the patient phrases). */
  progress(step: string): void {
    this.stepOverride = step;
    this.consultStep.textContent = step;
  }

  private async run(action: () => Promise<void>, isJoin?: boolean): Promise<void> {
    if (isJoin !== undefined) this.lastWasJoin = isJoin;
    this.lastAction = action;
    this.setBusy(true);
    this.setStatus("", false);
    this.openConsult();
    try {
      await action();
      this.closeConsult(true);
      this.hide();
    } catch (e) {
      const message = describeError(e);
      this.showFailure(message, this.lastWasJoin && isNoLiveCampaign(message) && !!this.handlers.onResume);
      this.setBusy(false);
    }
  }

  private openConsult(): void {
    this.stepOverride = undefined;
    this.workingSince = performance.now();
    this.consult.hidden = false;
    this.consult.dataset.state = "working";
    this.consultHead.textContent = "Consulting the Society...";
    this.consultStep.textContent = stepAt(0);
    this.consultActions.hidden = true;
    for (const p of this.root.querySelectorAll<HTMLElement>(".panel:not(.card)")) p.inert = true;
    this.consult.querySelector<HTMLElement>(".card")!.focus();
    window.clearInterval(this.workingTimer);
    this.workingTimer = window.setInterval(() => {
      if (this.consult.dataset.state === "working" && !this.stepOverride) this.consultStep.textContent = stepAt((performance.now() - this.workingSince) / 1000);
    }, 1000);
  }

  private showFailure(message: string, resumable = false): void {
    this.consultActions.querySelector<HTMLElement>(".resume")!.hidden = !resumable;
    window.clearInterval(this.workingTimer);
    this.consult.dataset.state = "error";
    this.consultHead.textContent = "The Society regrets...";
    this.consultStep.textContent = message;
    this.consultActions.hidden = false;
    this.consultActions.querySelector<HTMLElement>(".retry")!.focus();
  }

  private closeConsult(success = false): void {
    window.clearInterval(this.workingTimer);
    this.consult.hidden = true;
    for (const p of this.root.querySelectorAll<HTMLElement>(".panel:not(.card)")) p.inert = false;
    if (!success) {
      this.setBusy(false);
      this.root.querySelector<HTMLElement>("#create")?.focus();
    }
  }

  private setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
  }

  private setStatus(text: string, error: boolean): void {
    this.status.textContent = text;
    this.status.className = error ? "error" : "";
  }

  show(): void {
    this.root.hidden = false;
    this.setBusy(false);
  }

  hide(): void {
    this.root.hidden = true;
  }
}
