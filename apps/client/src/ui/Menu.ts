import { JOIN_CODE_LENGTH, isValidJoinCode } from "@cb/shared";

export interface MenuHandlers {
  onCreate(name: string): Promise<void>;
  onJoin(code: string, name: string): Promise<void>;
}

import { startPadNav } from "./PadNav.ts";

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
        <h1 id="title">Civilised Behaviour</h1>
        <p class="tag">An expedition of the Imperial Cartographic &amp; Improvement Society</p>
        <label>Name on the manifest
          <input id="name" maxlength="20" autocomplete="off" placeholder="Sir Reginald Blunt" value="${savedName.replace(/[&<>"]/g, "")}" />
        </label>
        <div class="row">
          <button id="create" class="primary">New campaign</button>
        </div>
        <div class="or">or join an existing expedition</div>
        <div class="row">
          <input id="code" maxlength="${JOIN_CODE_LENGTH}" autocomplete="off" placeholder="CODE" value="${prefill.replace(/[^A-Z0-9]/g, "")}" />
          <button id="join">Join</button>
        </div>
        <p id="status" role="status" aria-live="polite"></p>
        <p class="fine">Mature content: strong violence, coarse language and dark satire.</p>
      </div>
      <div class="panel" id="creator-host" aria-label="Character creator"></div>`;
    this.creatorHost = root.querySelector<HTMLElement>("#creator-host")!;
    this.nameInput = root.querySelector<HTMLInputElement>("#name")!;
    this.codeInput = root.querySelector<HTMLInputElement>("#code")!;
    this.status = root.querySelector<HTMLElement>("#status")!;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>(".main button")];
    root.querySelector("#create")!.addEventListener("click", () => void this.run(() => handlers.onCreate(this.name())));
    root.querySelector("#join")!.addEventListener("click", () => void this.join());
    this.codeInput.addEventListener("input", () => (this.codeInput.value = this.codeInput.value.toUpperCase()));
    this.codeInput.addEventListener("keydown", (e) => e.key === "Enter" && void this.join());
    this.nameInput.addEventListener("keydown", (e) => e.key === "Enter" && !prefill && void this.run(() => handlers.onCreate(this.name())));
    startPadNav(root, () => !this.root.hidden);
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
