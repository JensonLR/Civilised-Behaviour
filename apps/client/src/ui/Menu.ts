import { JOIN_CODE_LENGTH, isValidJoinCode } from "@cb/shared";

export interface MenuHandlers {
  onCreate(name: string): Promise<void>;
  onJoin(code: string, name: string): Promise<void>;
}

/** Front door: name + create/join. Plain DOM so it works identically with mouse, keyboard and pad focus. */
export class Menu {
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly buttons: HTMLButtonElement[];

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
      <div class="panel" role="dialog" aria-labelledby="title">
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
      </div>`;
    this.nameInput = root.querySelector<HTMLInputElement>("#name")!;
    this.codeInput = root.querySelector<HTMLInputElement>("#code")!;
    this.status = root.querySelector<HTMLElement>("#status")!;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>("button")];
    root.querySelector("#create")!.addEventListener("click", () => void this.run(() => handlers.onCreate(this.name())));
    root.querySelector("#join")!.addEventListener("click", () => void this.join());
    this.codeInput.addEventListener("input", () => (this.codeInput.value = this.codeInput.value.toUpperCase()));
    this.codeInput.addEventListener("keydown", (e) => e.key === "Enter" && void this.join());
    this.nameInput.addEventListener("keydown", (e) => e.key === "Enter" && !prefill && void this.run(() => handlers.onCreate(this.name())));
    this.pollGamepadFocus();
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

  /** Minimal pad navigation: d-pad/stick up-down moves focus, A activates. Full focus system arrives with M11 UI. */
  private pollGamepadFocus(): void {
    let cooldown = 0;
    let wasA = false;
    const tick = () => {
      requestAnimationFrame(tick);
      if (this.root.hidden) return;
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
      if (!pad) return;
      const now = performance.now();
      const dy = (pad.axes[1] ?? 0) > 0.6 || pad.buttons[13]?.pressed ? 1 : (pad.axes[1] ?? 0) < -0.6 || pad.buttons[12]?.pressed ? -1 : 0;
      if (dy && now > cooldown) {
        cooldown = now + 220;
        const items = [this.nameInput, ...this.buttons.slice(0, 1), this.codeInput, ...this.buttons.slice(1)];
        const i = items.indexOf(document.activeElement as never);
        items[(i + dy + items.length) % items.length]?.focus();
      }
      const a = pad.buttons[0]?.pressed ?? false;
      if (a && !wasA && document.activeElement instanceof HTMLButtonElement) document.activeElement.click();
      wasA = a;
    };
    requestAnimationFrame(tick);
  }
}
