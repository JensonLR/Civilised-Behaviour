import { playSfx } from "../audio/index.ts";
import { deviceTracker } from "../input/devices.ts";
import { h, Modal, anyModalOpen } from "./modal.ts";
import { openHowTo } from "./HowTo.ts";
import { openSettings } from "./Settings.ts";
import { sheetHints } from "./sheetHints.ts";
import { replayOrientation } from "./Orientation.ts";
import { ORIENT_REPLAY } from "./orientationCopy.ts";
import { SAVE_NOTE, saveLabel, type SaveStatus } from "../net/saveStatus.ts";

export interface PauseDeps {
  canvas: HTMLCanvasElement;
  /** The expedition code and invite link, or undefined before a session exists. */
  invite(): { code: string; link: string; present: number; seed: number } | undefined;
  /** D-039: where the save stands, and a request to save now (the server answers). Absent in the demo, which saves nothing: the sheet then shows no save controls. */
  save?: { status(): SaveStatus; now(): Promise<SaveStatus>; subscribe(fn: (s: SaveStatus) => void): () => void };
  /** Leave the expedition (the page returns to the front door). */
  leave(): void;
  /** D-063: the contract in full (the HUD shows only its next step) and the telegrams lately received (a slip is only a glance). Both optional. */
  orders?(): { title: string; items: { text: string; done: boolean; optional: boolean }[] } | undefined;
  dispatches?(): readonly string[];
  /** The demo only (D-036): a button that opens the wish-list card. Absent in the full game. */
  wishlist?(): void;
}

/**
 * The pause sheet (D-039: it also says whether the expedition is saved, saves on request, and quits after a save; the seed shows which world this is, and the tutorial can be replayed). The game does not stop (it is a shared world: others keep playing), so this is a "hands off" sheet: controls are held off,
 * the pointer is released, and the player can resume, read the manual, change settings, copy the invite or leave. It opens on Escape, on a
 * gamepad's Start, and whenever the browser takes the pointer back from the game view (which is what Escape does while the pointer is locked:
 * the key press itself never reaches the page).
 */
export class Pause {
  private readonly modal = new Modal("pause", "pause", "pause-title");
  private readonly info = h("p", { class: "tag", id: "pause-info" });
  private readonly copy = h("button", { type: "button" }, "Copy invite");
  private readonly leaveBtn = h("button", { type: "button", class: "danger" }, "Leave expedition");
  private readonly saveLine = h("p", { class: "fine saveline", id: "pause-save" });
  private readonly ordersBox = h("section", { class: "orders" });
  private readonly dispatchBox = h("details", { class: "dispatches" });
  private readonly saveBtn = h("button", { type: "button", "data-act": "save-now" }, "Save now");
  private readonly quitBtn = h("button", { type: "button", "data-act": "save-quit" }, "Save and quit");
  private quitting = false;
  private unsave: (() => void) | undefined;
  private enabled = false;
  private wasLocked = false;
  private confirmLeave = 0;
  private startWas = false;
  private raf = 0;

  constructor(private readonly deps: PauseDeps) {
    const resume = h("button", { type: "button", class: "primary", "data-autofocus": true }, "Resume");
    resume.addEventListener("click", () => this.resume());
    const how = h("button", { type: "button" }, "How to play");
    const replay = h("button", { type: "button", "data-act": "replay-orientation" }, ORIENT_REPLAY);
    replay.addEventListener("click", () => {
      replayOrientation(); // the card in the field starts again from nothing
      this.modal.close();
    });
    how.addEventListener("click", () => openHowTo(how));
    const opts = h("button", { type: "button" }, "Settings");
    opts.addEventListener("click", () => openSettings(opts));
    this.copy.addEventListener("click", () => this.copyInvite());
    this.leaveBtn.addEventListener("click", () => this.leaveClicked());
    this.saveBtn.addEventListener("click", () => void this.saveClicked());
    this.quitBtn.addEventListener("click", () => void this.quitClicked());
    this.saveBtn.hidden = this.quitBtn.hidden = !deps.save;
    const wish = deps.wishlist ? h("button", { type: "button" }, "The full expedition") : undefined;
    wish?.addEventListener("click", () => deps.wishlist!());
    this.modal.panel.append(
      h("p", { class: "society" }, "The Imperial Cartographic & Improvement Society"),
      h("h2", { id: "pause-title" }, "Expedition Halted"),
      this.info,
      this.saveLine,
      this.ordersBox,
      this.dispatchBox,
      h("div", { class: "menu" }, resume, this.saveBtn, h("div", { class: "pair" }, how, opts), h("div", { class: "pair" }, replay, this.copy), ...(wish ? [wish] : []), this.quitBtn, this.leaveBtn),
      h("p", { class: "fine" }, "The world does not wait for you. Your comrades are still on the march."),
      sheetHints({ choose: "Choose", close: "Resume" }).el,
    );
    this.modal.onClose = () => {
      this.confirmLeave = 0;
      this.leaveBtn.textContent = "Leave expedition";
      this.unsave?.();
      this.unsave = undefined;
      this.quitting = false;
      this.quitBtn.disabled = false;
      this.quitBtn.textContent = "Save and quit";
      delete this.quitBtn.dataset.retry;
      // Handing the mouse back to the game: needs a user gesture, which the Resume click or the Escape key is. Only for a mouse player (D-041): a pad player's A
      // is no use to the mouse, and a lock taken for them let the browser's mouse movement under it mark the KEYBOARD as the device in use (keyboard glyphs after a pause).
      if (this.enabled && deviceTracker.device === "keyboard") this.deps.canvas.requestPointerLock?.();
    };

    window.addEventListener("keydown", (e) => {
      if (e.code !== "Escape" || e.repeat || !this.enabled || anyModalOpen()) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      this.open();
    });
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === deps.canvas;
      if (this.wasLocked && !locked && this.enabled && !anyModalOpen()) this.open();
      this.wasLocked = locked;
    });
    const poll = (): void => {
      this.raf = requestAnimationFrame(poll);
      if (!this.enabled) return;
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected && p.mapping === "standard");
      const start = pad?.buttons[9]?.pressed ?? false;
      if (start && !this.startWas && !anyModalOpen()) this.open();
      this.startWas = start;
    };
    this.raf = requestAnimationFrame(poll);
  }

  /** Turn the pause sheet on once a session exists (before that Escape does nothing). */
  set active(on: boolean) {
    this.enabled = on;
    if (!on) this.modal.close();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(): void {
    if (this.modal.isOpen) return;
    const inv = this.deps.invite();
    // each phrase kept whole (a narrow sheet broke "World seed" from its number); the line only breaks at the dots
    const phrases = inv ? [`Expedition No. ${inv.code}`, `World seed ${inv.seed}`, `${inv.present} present`] : [];
    this.info.replaceChildren(...phrases.flatMap((t, i) => {
      const span = document.createElement("span");
      span.style.whiteSpace = "nowrap";
      span.textContent = t;
      return i ? [" · ", span] : [span];
    }));
    const save = this.deps.save;
    this.unsave?.();
    this.unsave = undefined;
    this.saveLine.hidden = !save;
    if (save) {
      const draw = (s: SaveStatus): void => {
        const text = saveLabel(s);
        this.saveLine.textContent = text === "" ? SAVE_NOTE : `${text}. ${SAVE_NOTE}`;
        this.saveLine.dataset.state = s.kind;
      };
      draw(save.status());
      this.unsave = save.subscribe(draw);
    }
    this.copy.hidden = !inv;
    this.copy.textContent = "Copy invite";
    this.drawOrders();
    playSfx("ui_click");
    this.modal.open(null);
  }

  /** The contract in full and the last telegrams (text only, from the wire: set as textContent). */
  private drawOrders(): void {
    const o = this.deps.orders?.();
    this.ordersBox.replaceChildren();
    this.ordersBox.hidden = !o || o.items.length === 0;
    if (o && o.items.length > 0) {
      const list = h("ul", {});
      for (const it of o.items) {
        const li = h("li", { class: `${it.done ? "done" : ""}${it.optional ? " optional" : ""}`.trim() });
        li.textContent = `${it.optional ? "(If you like) " : ""}${it.text}`;
        list.append(li);
      }
      const head = h("h3", {});
      head.textContent = o.title;
      this.ordersBox.append(head, list);
    }
    const d = this.deps.dispatches?.() ?? [];
    this.dispatchBox.replaceChildren();
    this.dispatchBox.hidden = d.length === 0;
    if (d.length > 0) {
      const sum = h("summary", {});
      sum.textContent = `Telegrams lately received (${d.length})`;
      const list = h("ol", {});
      for (const t of d.slice(-12).reverse()) {
        const li = h("li", {});
        li.textContent = t;
        list.append(li);
      }
      this.dispatchBox.append(sum, list);
    }
  }

  resume(): void {
    this.modal.close();
  }

  private copyInvite(): void {
    const inv = this.deps.invite();
    if (!inv) return;
    void navigator.clipboard?.writeText(inv.link);
    this.copy.textContent = "Copied";
  }

  private async saveClicked(): Promise<void> {
    const save = this.deps.save;
    if (!save) return;
    this.saveBtn.disabled = true;
    await save.now();
    this.saveBtn.disabled = false;
  }

  /** Flush the save, then leave. If the server cannot confirm it (the line is down, the store failed), say so and let a second press leave anyway: a player is never held on a sheet. */
  private async quitClicked(): Promise<void> {
    const save = this.deps.save;
    if (!save || this.quitting) return;
    if (this.quitBtn.dataset.retry === "1") return this.deps.leave();
    this.quitting = true;
    this.quitBtn.disabled = true;
    this.quitBtn.textContent = "Saving...";
    const s = await save.now();
    this.quitting = false;
    if (s.kind === "saved" || s.kind === "unkept") return this.deps.leave(); // (a campaign the server keeps nothing of has nothing to wait for)
    this.quitBtn.disabled = false;
    this.quitBtn.dataset.retry = "1";
    this.quitBtn.textContent = "Not confirmed. Quit anyway?";
  }

  private leaveClicked(): void {
    if (this.confirmLeave === 0) {
      this.confirmLeave = 1;
      this.leaveBtn.textContent = "Really leave? Press again";
      window.setTimeout(() => {
        if (this.confirmLeave === 1) {
          this.confirmLeave = 0;
          this.leaveBtn.textContent = "Leave expedition";
        }
      }, 4000);
      return;
    }
    this.deps.leave();
  }
}

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
