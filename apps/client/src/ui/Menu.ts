import { JOIN_CODE_LENGTH, isValidJoinCode } from "@cb/shared";

export interface MenuHandlers {
  onCreate(name: string, rules: { dismemberment: boolean }): Promise<void>;
  onJoin(code: string, name: string): Promise<void>;
}

import { startPadNav } from "./PadNav.ts";
import { GORE_LEVELS, getCampaignLimbLoss, getGore, getHeadBob, getShowLimbs, getView, setCampaignLimbLoss, setGore, setHeadBob, setShowLimbs, setView, type ViewMode } from "../settings.ts";

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
        <label class="opt">Sensibilities: gore
          <select id="gore" aria-describedby="gore-note">${GORE_LEVELS.map((g) => `<option value="${g}"${g === getGore() ? " selected" : ""}>${g[0]!.toUpperCase()}${g.slice(1)}</option>`).join("")}</select>
        </label>
        <p id="gore-note" class="fine">Off replaces all blood with bandages and iodine. Wounds stay just as readable.</p>
        <label class="opt">Severed limbs
          <select id="limbs" aria-describedby="limbs-note"><option value="1"${getShowLimbs() ? " selected" : ""}>Shown</option><option value="0"${getShowLimbs() ? "" : " selected"}>Hidden</option></select>
        </label>
        <p id="limbs-note" class="fine">Hidden shows the same injuries as ordinary dressings. It only changes what you see, never what happens.</p>
        <label class="opt">Camera
          <select id="view" aria-describedby="view-note"><option value="third"${getView() === "third" ? " selected" : ""}>Third person</option><option value="first"${getView() === "first" ? " selected" : ""}>First person</option></select>
        </label>
        <p id="view-note" class="fine">Press X in the field (right stick click on a pad) to switch at any time. Other players always see your whole figure.</p>
        <label class="opt">Head bob (first person)
          <select id="bob"><option value="1"${getHeadBob() ? " selected" : ""}>On</option><option value="0"${getHeadBob() ? "" : " selected"}>Off</option></select>
        </label>
        <p id="status" role="status" aria-live="polite"></p>
        <p class="fine">Mature content: strong violence, coarse language and dark satire.</p>
      </div>
      <div class="panel" id="creator-host" aria-label="Character creator"></div>`;
    this.creatorHost = root.querySelector<HTMLElement>("#creator-host")!;
    this.nameInput = root.querySelector<HTMLInputElement>("#name")!;
    this.codeInput = root.querySelector<HTMLInputElement>("#code")!;
    this.status = root.querySelector<HTMLElement>("#status")!;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>(".main button")];
    root.querySelector("#create")!.addEventListener("click", () => void this.run(() => handlers.onCreate(this.name(), this.rules())));
    root.querySelector("#join")!.addEventListener("click", () => void this.join());
    root.querySelector<HTMLSelectElement>("#gore")!.addEventListener("change", (e) => setGore((e.target as HTMLSelectElement).value as (typeof GORE_LEVELS)[number]));
    root.querySelector<HTMLSelectElement>("#limbs")!.addEventListener("change", (e) => setShowLimbs((e.target as HTMLSelectElement).value === "1"));
    root.querySelector<HTMLSelectElement>("#view")!.addEventListener("change", (e) => setView((e.target as HTMLSelectElement).value as ViewMode));
    root.querySelector<HTMLSelectElement>("#bob")!.addEventListener("change", (e) => setHeadBob((e.target as HTMLSelectElement).value === "1"));
    this.codeInput.addEventListener("input", () => (this.codeInput.value = this.codeInput.value.toUpperCase()));
    this.codeInput.addEventListener("keydown", (e) => e.key === "Enter" && void this.join());
    this.nameInput.addEventListener("keydown", (e) => e.key === "Enter" && !prefill && void this.run(() => handlers.onCreate(this.name(), this.rules())));
    startPadNav(root, () => !this.root.hidden);
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
    await this.run(() => this.handlers.onJoin(code, this.name()));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.setBusy(true);
    this.setStatus("Consulting the Society...", false);
    try {
      await action();
      this.hide();
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : "The Society regrets to inform you of an error.", true);
      this.setBusy(false);
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
