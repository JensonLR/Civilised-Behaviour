import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, isValidJoinCode } from "@cb/shared";

export interface MenuHandlers {
  /** Found an expedition. `progress` names the stage reached ("Surveying the territory...") for the working card. */
  onCreate(name: string, rules: { dismemberment: boolean }, progress: (step: string) => void): Promise<void>;
  onJoin(code: string, name: string, progress: (step: string) => void): Promise<void>;
  /**
   * D-035: bring a saved expedition back by its code (the server answers a stranger and an unknown code alike). Absent where nothing is saved (the demo): the door then offers no
   * Continue and no list (D-039).
   */
  onResume?(code: string, name: string, progress: (step: string) => void): Promise<void>;
  /** D-102: the door chose another of this device's characters (or made one): the creator and the figure behind the door take its look. */
  onCharacter?(look: string): void;
}

/** The letters the pad's dial turns through for a name (lower case first, as most of a name is; down from "a" wraps straight to the capitals). */
const NAME_DIAL = "abcdefghijklmnopqrstuvwxyz '-.ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The join lookup found no live room for the code: a dormant campaign may be waiting, so the failure card offers to resume it. */
export const isNoLiveCampaign = (message: string): boolean => /^No campaign with that code/i.test(message);

import { dormantCopy, describeError, isDormantSave, stepAt } from "./menuLogic.ts";
import { expeditionMeta, forgetExpedition, listExpeditions, type Expedition } from "./expeditions.ts";
import { MAX_CHARACTERS, addCharacter, currentCharacter, freshCharacter, loadRoster, removeCharacter, saveRoster, selectCharacter, updateCharacter, type Roster } from "./characters.ts";
import "./expeditions.css";
import { bindPrompt } from "../input/glyphDom.ts";
import { startPadNav } from "./PadNav.ts";
import { REACH_RETRY } from "../platform/reachCopy.ts";
import { anyModalOpen } from "./modal.ts";
import { openHowTo, hasSeenHowTo } from "./HowTo.ts";
import { openSettings } from "./Settings.ts";
import { GORE_LEVELS, getCampaignLimbLoss, getGore, onSettingChange, setCampaignLimbLoss, setGore } from "../settings.ts";
import { figureFocus, type FigureFocus } from "./doorFrame.ts";

/** The door's narrow layout (a phone either way up, a small window): one panel at a time, the character creator behind an "Appearance" button. Keep in step with style.css. */
const NARROW = "(max-width: 60rem)";
const isNarrow = (): boolean => typeof matchMedia === "function" && matchMedia(NARROW).matches;

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
  /** The code of the expedition the action in hand is resuming, if it is one (a failure then gets the friendly "file not found" card, D-039). */
  private lastResumeCode: string | undefined;
  /** D-102: this device's characters, one of them chosen (characters.ts). The name box edits the chosen one's name; the creator its look. */
  private roster: Roster;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: MenuHandlers,
  ) {
    const prefill = new URLSearchParams(location.search).get("join")?.toUpperCase() ?? "";
    this.roster = loadRoster();
    const savedName = currentCharacter(this.roster).name;
    root.innerHTML = `
      <div class="panel main" role="dialog" aria-labelledby="title">
        <p class="society">The Imperial Cartographic &amp; Improvement Society</p>
        <div class="rule" aria-hidden="true">${COMPASS}</div>
        <h1 id="title">Civilised Behaviour</h1>
        <p class="tag">By Appointment to Her Majesty: a charter for an expedition into territories not yet improved</p>
        <div class="namebox">
          <label for="name" class="namelabel">Name upon the manifest</label>
          <div class="namerow">
            <input id="name" maxlength="20" autocomplete="off" data-pad-chars="${NAME_DIAL}" placeholder="Sir Reginald Blunt" value="${savedName.replace(/[&<>"]/g, "")}" />
            <button id="dress" type="button" aria-controls="creator-host" aria-expanded="false" hidden>Appearance</button>
          </div>
          <span class="who">
            <label for="who" class="playing" hidden>Playing as</label>
            <select id="who" hidden></select>
            <span class="grow"></span>
            <button id="who-new" type="button" class="quiet tiny">+ New</button>
            <button id="who-drop" type="button" class="quiet tiny" hidden>Retire</button>
          </span>
        </div>
        <div class="row" id="continue-row" hidden>
          <button id="continue" type="button" class="primary"><span class="cont-title">Continue</span><span class="cont-meta"></span></button>
        </div>
        <div class="row">
          <button id="create" class="primary"><span class="cont-title">New campaign</span><span id="create-note" class="cont-meta">A fresh world on a new seed</span></button>
        </div>
        <label class="check"><input type="checkbox" id="limb-rule"${getCampaignLimbLoss() ? " checked" : ""} /> Limbs may be lost in this campaign</label>
        <section class="expeditions" id="expeditions" aria-labelledby="exp-h" hidden>
          <h2 id="exp-h">Your expeditions</h2>
          <ul></ul>
          <p class="fine">Kept on this device: copy them under Options, Profile. Resuming starts at HQ.</p>
        </section>
        <div class="or">or join a party with its code</div>
        <div class="row">
          <input id="code" maxlength="${JOIN_CODE_LENGTH}" autocomplete="off" data-pad-chars="${JOIN_CODE_ALPHABET}" data-pad-send placeholder="CODE" aria-label="Join code" value="${prefill.replace(/[^A-Z0-9]/g, "")}" />
          <button id="join">Join</button>
        </div>
        <p id="dialhint" class="fine dialhint" hidden></p>
        <div class="row aux">
          <button id="options" class="quiet">Options</button>
          <button id="howto" class="quiet${hasSeenHowTo() ? "" : " new"}">How to play</button>
          <select id="gore" aria-label="Gore" title="Off replaces all blood with bandages and iodine; wounds stay just as readable">${GORE_LEVELS.map((g) => `<option value="${g}"${g === getGore() ? " selected" : ""}>Gore: ${g[0]!.toUpperCase()}${g.slice(1)}</option>`).join("")}</select>
        </div>
        <p id="status" role="status" aria-live="polite"></p>
        <p id="reach" class="fine reach" role="status" aria-live="polite" hidden></p>
        <div class="foot"><p class="fine">Mature content: strong violence, coarse language and dark satire.</p><p class="fine version">${versionLabel()}</p></div>
      </div>
      <div class="panel" id="creator-host" aria-label="Character creator"></div>
      <div class="consult" hidden>
        <div class="card panel" role="alertdialog" aria-labelledby="consult-head" aria-describedby="consult-step" tabindex="-1">
          ${DIAL}
          <h2 id="consult-head">Consulting the Society...</h2>
          <p id="consult-step" role="status" aria-live="polite"></p>
          <div class="bar" aria-hidden="true"><div class="fill"></div></div>
          <div class="actions" hidden><button type="button" class="primary retry">Try again</button><button type="button" class="resume" hidden>Resume this expedition</button><button type="button" class="forget" hidden>Forget this expedition</button><button type="button" class="back">Back to the menu</button></div>
        </div>
      </div>`;
    // a pad's hint under the door (shown only while a pad is the device in use): the front door is the first thing a pad player sees
    const hint = document.createElement("p");
    hint.className = "hintbar pad-only";
    hint.setAttribute("aria-hidden", "true");
    bindPrompt(hint, () => "{menuUp} {menuDown} Move   {confirm} Choose   {menuLeft} {menuRight} Adjust");
    root.querySelector(".main .foot")?.before(hint);
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
      if (isValidJoinCode(code) && handlers.onResume) this.resume(code);
    });
    root.querySelector(".consult .forget")!.addEventListener("click", () => {
      if (this.lastResumeCode) forgetExpedition(this.lastResumeCode);
      this.closeConsult();
      this.renderExpeditions();
      this.setStatus("That expedition has been struck from the list.", false);
    });
    root.querySelector("#continue")!.addEventListener("click", () => {
      const e = listExpeditions()[0];
      if (e) this.resume(e.code);
    });
    this.consult.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.consultActions.hidden) this.closeConsult();
    });
    root.addEventListener("padback", () => !this.consultActions.hidden && this.closeConsult());
    root.querySelector("#create")!.addEventListener("click", () => void this.run(() => handlers.onCreate(this.name(), this.rules(), (t) => this.progress(t)), false));
    root.querySelector("#join")!.addEventListener("click", () => void this.join());
    this.renderExpeditions();
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
    // the pad's letter dial (D-049): say how it works while it turns, under the code row where the eye is (the status line is often below the fold on a short screen)
    const dialHint = root.querySelector<HTMLElement>("#dialhint")!;
    root.addEventListener("paddial", (e) => {
      const on = (e as CustomEvent<boolean>).detail;
      const field = e.target as HTMLElement;
      dialHint.textContent = on ? `Up and down turn the letter; left and right move along; X (Square) takes it out. Confirm to ${field.hasAttribute("data-pad-send") ? "join" : "finish"}; back to stop.` : "";
      dialHint.hidden = !on;
      if (on) field.closest("label, .row")!.after(dialHint);
      if (on) dialHint.scrollIntoView?.({ block: "nearest" });
    });
    // D-098: on a narrow screen the creator waits behind "Appearance" (it stacked under the charter, a phone's page three screens long); the figure stands in whatever the panels leave free
    this.dressBtn = root.querySelector<HTMLButtonElement>("#dress")!;
    this.dressBtn.addEventListener("click", () => this.setDressing(true));
    this.watchCreatorHost();
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.dataset.view === "creator" && this.consult.hidden && !anyModalOpen()) this.setDressing(false);
    });
    root.addEventListener("padback", () => root.dataset.view === "creator" && this.consult.hidden && this.setDressing(false));
    const media = typeof matchMedia === "function" ? matchMedia(NARROW) : undefined;
    media?.addEventListener?.("change", () => this.layout());
    window.addEventListener("resize", () => this.reframeSoon());
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => this.reframeSoon());
      for (const p of root.querySelectorAll<HTMLElement>(":scope > .panel")) ro.observe(p);
    }
    this.bindCharacters();
    this.layout();
    startPadNav(root, () => !this.root.hidden && !anyModalOpen());
  }

  /** The chosen character's look (what a new, joined or resumed expedition is entered in). */
  get look(): string {
    return currentCharacter(this.roster).look;
  }

  /** The chosen character's id (each saved expedition remembers who played it). */
  get characterId(): string {
    return this.roster.current;
  }

  /** The creator changed the chosen character's look. */
  setLook(look: string): void {
    this.roster = updateCharacter(this.roster, this.roster.current, { look });
    saveRoster(this.roster);
  }

  /**
   * D-102, the owner: "profile persistence so people can keep their characters & campaign saves". The door keeps several characters: a list to choose from (shown once there is
   * more than one), "+ New" to start another with a random look, and a two-press Retire. The name box always edits the chosen one; resuming a save brings back the one who played it.
   */
  private bindCharacters(): void {
    const sel = this.root.querySelector<HTMLSelectElement>("#who")!;
    const add = this.root.querySelector<HTMLButtonElement>("#who-new")!;
    const drop = this.root.querySelector<HTMLButtonElement>("#who-drop")!;
    sel.addEventListener("change", () => this.chooseCharacter(sel.value));
    add.addEventListener("click", () => {
      const before = this.roster;
      this.roster = addCharacter(this.roster, freshCharacter(""));
      if (this.roster === before) return;
      this.afterCharacterChange();
      this.nameInput.focus();
      this.setStatus("A new character: give them a name and a look.", false);
    });
    const disarm = (): void => {
      delete drop.dataset.armed;
      drop.textContent = "Retire";
    };
    drop.addEventListener("click", () => {
      if (drop.dataset.armed !== "1") {
        drop.dataset.armed = "1";
        drop.textContent = "Sure?";
        return;
      }
      disarm();
      const gone = currentCharacter(this.roster).name || "The unnamed one";
      this.roster = removeCharacter(this.roster, this.roster.current);
      this.afterCharacterChange();
      this.setStatus(`${gone} has retired.`, false);
    });
    drop.addEventListener("blur", disarm);
    this.nameInput.addEventListener("input", () => {
      this.roster = updateCharacter(this.roster, this.roster.current, { name: this.nameInput.value });
      saveRoster(this.roster);
      this.renderCharacters();
    });
    this.renderCharacters();
  }

  /** Chooses one of the device's characters (an unknown id changes nothing). */
  private chooseCharacter(id: string): void {
    if (id === this.roster.current) return;
    const before = this.roster;
    this.roster = selectCharacter(this.roster, id);
    if (this.roster !== before) this.afterCharacterChange();
  }

  private afterCharacterChange(): void {
    saveRoster(this.roster);
    const c = currentCharacter(this.roster);
    this.nameInput.value = c.name;
    this.renderCharacters();
    this.handlers.onCharacter?.(c.look);
  }

  private renderCharacters(): void {
    const sel = this.root.querySelector<HTMLSelectElement>("#who")!;
    const add = this.root.querySelector<HTMLButtonElement>("#who-new")!;
    const drop = this.root.querySelector<HTMLButtonElement>("#who-drop")!;
    const many = this.roster.list.length > 1;
    sel.hidden = !many;
    drop.hidden = !many;
    this.root.querySelector<HTMLElement>(".who .playing")!.hidden = !many;
    // (with two or more, the line reads "Playing as [Cecily]  + New  Retire" and the name box's own label is kept for screen readers only: the line stays one line on a phone)
    this.root.querySelector<HTMLElement>(".namebox")!.classList.toggle("many", many);
    add.disabled = this.roster.list.length >= MAX_CHARACTERS;
    add.title = add.disabled ? `A device keeps ${MAX_CHARACTERS} characters at most: retire one first` : "Start another character";
    add.setAttribute("aria-label", "New character");
    sel.replaceChildren(
      ...this.roster.list.map((c, i) => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name || `Unnamed ${i + 1}`;
        o.selected = c.id === this.roster.current;
        return o;
      }),
    );
  }

  private readonly dressBtn: HTMLButtonElement;
  private frameFn: ((f: FigureFocus) => void) | undefined;
  private frameRaf = 0;

  /** Told where the figure behind the door should stand whenever the panels move (boot hands it to the creator's preview). */
  set onFrame(fn: ((f: FigureFocus) => void) | undefined) {
    this.frameFn = fn;
    this.reframeSoon();
  }

  /** The narrow layout shows one panel at a time: the charter, or (after "Appearance") the creator with a Done to come back. */
  private layout(): void {
    const narrow = isNarrow();
    this.dressBtn.hidden = !narrow;
    if (!narrow && this.root.dataset.view === "creator") this.setDressing(false);
    this.reframeSoon();
  }

  /** The creator's way back ("Done"), at the foot of the host. Idempotent. */
  private ensureCreatorFoot(): void {
    const host = this.creatorHost;
    if (host.querySelector(".creator-done")) return;
    const done = document.createElement("button");
    done.type = "button";
    done.className = "primary creator-done";
    done.textContent = "Done";
    done.addEventListener("click", () => this.setDressing(false));
    const foot = document.createElement("div");
    foot.className = "row creator-foot";
    foot.append(done);
    host.append(foot);
  }

  /**
   * The creator draws itself into the host once the GPU is up, which can be after a quick tap on "Appearance"; its build clears the host. While the creator is showing, the way
   * back is put back, and focus goes into the creator (it was on what was cleared). Found by CI: a phone player who tapped first had no Done.
   */
  private watchCreatorHost(): void {
    if (typeof MutationObserver !== "function") return;
    new MutationObserver(() => {
      if (this.root.dataset.view !== "creator") return;
      this.ensureCreatorFoot();
      if (!this.creatorHost.contains(document.activeElement)) this.creatorHost.querySelector<HTMLElement>('[role="tab"]')?.focus();
    }).observe(this.creatorHost, { childList: true });
  }

  private setDressing(on: boolean): void {
    const host = this.creatorHost;
    if (on) this.ensureCreatorFoot(); // (the creator draws itself into the host after the door is built, so its way back is added the first time it is opened)
    if (on) this.root.dataset.view = "creator";
    else delete this.root.dataset.view;
    this.dressBtn.setAttribute("aria-expanded", String(on));
    if (on) host.querySelector<HTMLElement>('[role="tab"]')?.focus();
    else if (!this.dressBtn.hidden) this.dressBtn.focus();
    this.reframeSoon();
  }

  private reframeSoon(): void {
    if (!this.frameFn || this.frameRaf) return;
    this.frameRaf = requestAnimationFrame(() => {
      this.frameRaf = 0;
      if (this.root.hidden || !this.frameFn) return;
      const boxes = [...this.root.querySelectorAll<HTMLElement>(":scope > .panel")].filter((p) => p.getClientRects().length > 0).map((p) => p.getBoundingClientRect());
      this.frameFn(figureFocus(window.innerWidth, window.innerHeight, boxes));
    });
  }

  /** Bring a saved expedition back: one click, through the same path as the code box (the server checks that this browser was a member). */
  private resume(code: string): void {
    if (!this.handlers.onResume) return;
    const who = listExpeditions().find((e) => e.code === code)?.who;
    if (who) this.chooseCharacter(who); // (D-102: the save comes back with the character who played it, when this device still keeps them)
    void this.run(() => this.handlers.onResume!(code, this.name(), (t) => this.progress(t)), false, code);
  }

  /** The door's own record of expeditions (this device only): the Continue button for the latest and the list to resume or forget from. Drawn again after every change. */
  private renderExpeditions(): void {
    const list: Expedition[] = this.handlers.onResume ? listExpeditions() : [];
    const row = this.root.querySelector<HTMLElement>("#continue-row")!;
    const section = this.root.querySelector<HTMLElement>("#expeditions")!;
    const create = this.root.querySelector<HTMLElement>("#create")!;
    const now = Date.now();
    row.hidden = list.length === 0;
    section.hidden = list.length === 0;
    create.classList.toggle("primary", list.length === 0);
    const first = list[0];
    if (first) row.querySelector<HTMLElement>(".cont-meta")!.textContent = expeditionMeta(first, now);
    this.reframeSoon();
    const ul = section.querySelector("ul")!;
    ul.replaceChildren(
      ...list.map((e) => {
        const li = document.createElement("li");
        const go = document.createElement("button");
        go.type = "button";
        go.className = "go";
        go.dataset.code = e.code;
        const title = document.createElement("span");
        title.className = "exp-title";
        title.textContent = e.name ? `${e.name}'s expedition` : `Expedition No. ${e.code}`;
        const meta = document.createElement("span");
        meta.className = "exp-meta";
        meta.textContent = expeditionMeta(e, now);
        go.append(title, meta);
        go.addEventListener("click", () => this.resume(e.code));
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "drop quiet";
        drop.textContent = "Forget";
        drop.setAttribute("aria-label", `Forget expedition ${e.code}`);
        // two presses: the record is only this device's list (the Society keeps its file), but a stray click should not strike it off
        const disarm = (): void => {
          delete drop.dataset.armed;
          drop.textContent = "Forget";
        };
        drop.addEventListener("click", () => {
          if (drop.dataset.armed === "1") {
            forgetExpedition(e.code);
            this.renderExpeditions();
            this.root.querySelector<HTMLElement>("#create")?.focus();
            return;
          }
          drop.dataset.armed = "1";
          drop.textContent = "Sure?";
        });
        drop.addEventListener("blur", disarm);
        li.append(go, drop);
        return li;
      }),
    );
  }

  private rules(): { dismemberment: boolean } {
    const dismemberment = this.root.querySelector<HTMLInputElement>("#limb-rule")!.checked;
    setCampaignLimbLoss(dismemberment);
    return { dismemberment };
  }

  private name(): string {
    const n = this.nameInput.value.trim();
    this.roster = updateCharacter(this.roster, this.roster.current, { name: n });
    saveRoster(this.roster);
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

  private async run(action: () => Promise<void>, isJoin?: boolean, resumeCode?: string): Promise<void> {
    if (isJoin !== undefined) this.lastWasJoin = isJoin;
    this.lastResumeCode = resumeCode;
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
      this.showFailure(message, this.lastWasJoin && isNoLiveCampaign(message) && !!this.handlers.onResume, resumeCode);
      this.setBusy(false);
    }
  }

  private openConsult(): void {
    this.stepOverride = undefined;
    this.workingSince = performance.now();
    this.consult.hidden = false;
    this.consult.dataset.state = "working";
    this.consult.dataset.kind = "";
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

  private showFailure(message: string, resumable = false, resumeCode?: string): void {
    // a saved expedition that cannot be found (lapsed, wiped, or still marching elsewhere): say what it may be, and offer to strike it off the list
    const dormant = resumeCode !== undefined && isDormantSave(message);
    this.consultActions.querySelector<HTMLElement>(".resume")!.hidden = !resumable;
    this.consultActions.querySelector<HTMLElement>(".forget")!.hidden = !(dormant && listExpeditions().some((e) => e.code === resumeCode));
    window.clearInterval(this.workingTimer);
    this.consult.dataset.state = "error";
    this.consult.dataset.kind = dormant ? "dormant" : "";
    this.consultHead.textContent = dormant ? "The file cannot be found" : "The Society regrets...";
    this.consultStep.textContent = dormant ? dormantCopy(resumeCode) : message;
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
    this.renderExpeditions();
  }

  hide(): void {
    this.root.hidden = true;
  }
}
