import { playSfx, previewCaption } from "../audio/index.ts";
import { ACTIONS, assign, defaultBindings, getBindings, keyLabel, setBindings, type ActionDef, type ActionId, type Bindings, type Slot } from "../input/bindings.ts";
import * as S from "../settings.ts";
import { ACTION_GROUPS } from "./controlsInfo.ts";
import { Modal, h } from "./modal.ts";
import { buildPadSection, type PadSection } from "./SettingsPad.ts";
import { eraseMyRecords } from "../net/Session.ts";
import { myProfileCode, restoreProfileCode } from "./profileCode.ts";

/**
 * The settings screen ("Standing Orders"): four tabs, every control a real form control (range, checkbox, select, button) so it works with
 * mouse, keyboard and gamepad (PadNav), with labels, notes and live values wired through ARIA. Nothing here stores anything itself: each
 * control reads and writes settings.ts (which persists and announces changes), so the audio engine, camera, stage and stylesheet follow live.
 */

export type TabId = "audio" | "video" | "controls" | "pad" | "access" | "profile";
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "audio", label: "Sound" },
  { id: "video", label: "Display" },
  { id: "controls", label: "Controls" },
  { id: "pad", label: "Gamepad" }, // (D-098: its own page; under Controls it made that page six screens long)
  { id: "access", label: "Accessibility" },
  { id: "profile", label: "Profile" }, // (D-102: the profile code and the records, which sat under Accessibility)
];

let uid = 0;
type Refresh = () => void;

export class SettingsSheet {
  private readonly modal = new Modal("settings", "settings", "settings-title");
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly panels = new Map<TabId, HTMLElement>();
  private readonly refreshers: Refresh[] = [];
  private readonly status: HTMLElement;
  private tab: TabId = "audio";
  private padSection: PadSection | undefined;
  private capture: { action: ActionId; slot: Slot; btn: HTMLButtonElement } | undefined;
  private pending: { action: ActionId; slot: Slot; code: string } | undefined;
  private conflictBar!: HTMLElement;
  private bindingButtons = new Map<string, HTMLButtonElement>();
  private resetTimer = 0;
  private disarmReset: () => void = () => undefined;

  constructor() {
    const { panel } = this.modal;
    this.status = h("p", { class: "status", role: "status", "aria-live": "polite" });
    const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Sections" });
    for (const t of TABS) {
      const b = h("button", { type: "button", role: "tab", id: `tab-${t.id}`, "aria-controls": `panel-${t.id}`, "aria-selected": "false", tabindex: "-1" }, t.label);
      b.addEventListener("click", () => this.showTab(t.id, true));
      b.addEventListener("keydown", (e) => {
        const i = TABS.findIndex((x) => x.id === this.tab);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          this.showTab(TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!.id, true);
        }
      });
      this.tabButtons.set(t.id, b);
      tabs.appendChild(b);
    }
    const body = h("div", { class: "body" });
    this.buildAudio(body);
    this.buildVideo(body);
    this.buildControls(body);
    this.buildPad(body);
    this.buildAccess(body);
    this.buildProfile(body);
    const done = h("button", { type: "button", class: "primary" }, "Done");
    done.addEventListener("click", () => this.close());
    // Restoring is destructive (volumes, bindings, everything), so it asks once: the first press arms the button for four seconds, the second does it.
    const reset = h("button", { type: "button", class: "danger" }, "Restore defaults");
    let armed = 0;
    const disarm = (): void => {
      armed = 0;
      window.clearTimeout(this.resetTimer);
      reset.textContent = "Restore defaults";
      reset.removeAttribute("data-armed");
    };
    reset.addEventListener("click", () => {
      if (!armed) {
        armed = 1;
        reset.textContent = "Really restore? Press again";
        reset.setAttribute("data-armed", "");
        this.say("This puts every option, key and volume back. Press again to confirm.");
        this.resetTimer = window.setTimeout(disarm, 4000);
        return;
      }
      disarm();
      S.resetAllSettings();
      this.say("Every option is back to the Society's recommendation.");
    });
    this.disarmReset = disarm;
    panel.append(
      h("p", { class: "society" }, "The Imperial Cartographic & Improvement Society"),
      h("h2", { id: "settings-title" }, "Standing Orders"),
      tabs,
      body,
      this.status,
      h("div", { class: "actions" }, reset, done),
    );
    this.modal.root.addEventListener("padtab", (e) => {
      const i = TABS.findIndex((x) => x.id === this.tab);
      const d = (e as CustomEvent<number>).detail;
      this.showTab(TABS[(i + d + TABS.length) % TABS.length]!.id, true); // the pad's focus follows to the new tab
    });
    S.onSettingChange(() => this.refresh());
    // However the sheet closes (Done, Escape, the backdrop, the pad's B) a half-finished key capture or conflict question is dropped.
    this.modal.onClose = () => {
      this.disarmReset();
      this.cancelCapture();
      this.clearConflict();
      this.padSection?.cancelLearn();
    };
    this.showTab("audio", false);
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(opener?: HTMLElement | null, tab?: TabId): void {
    if (tab) this.showTab(tab, false);
    // (a phone either way up; not a short desktop window, whose player wants the keys)
    const phone = typeof matchMedia === "function" && matchMedia("(max-width: 40rem), (max-height: 30rem) and (pointer: coarse)").matches;
    for (const d of this.modal.panel.querySelectorAll<HTMLDetailsElement>("details.fold")) d.open = !phone;
    this.refresh();
    this.status.textContent = "";
    this.modal.open(opener);
  }

  close(): void {
    this.cancelCapture();
    this.modal.close();
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  private showTab(id: TabId, focus: boolean): void {
    this.cancelCapture();
    this.tab = id;
    for (const t of TABS) {
      const on = t.id === id;
      const b = this.tabButtons.get(t.id)!;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) b.setAttribute("data-autofocus", "");
      else b.removeAttribute("data-autofocus");
      this.panels.get(t.id)!.hidden = !on;
      if (on && focus) b.focus();
      if (on) b.scrollIntoView?.({ block: "nearest", inline: "nearest" }); // (a phone's tab strip scrolls sideways)
    }
  }

  private refresh(): void {
    for (const r of this.refreshers) r();
  }

  // ---- control factories -----------------------------------------------------------------------------------------------------------

  private page(id: TabId, body: HTMLElement): HTMLElement {
    const p = h("div", { class: "page", role: "tabpanel", id: `panel-${id}`, "aria-labelledby": `tab-${id}`, hidden: true });
    this.panels.set(id, p);
    body.appendChild(p);
    return p;
  }

  private row(parent: HTMLElement, label: string, id: string, control: HTMLElement, note?: string, value?: HTMLElement): void {
    const noteId = note ? `${id}-note` : undefined;
    if (noteId) control.setAttribute("aria-describedby", noteId);
    parent.append(
      // (a button keeps its own words as its name: a label pointing at it renamed "Erase my records" to "Your records" for a screen reader)
      h("div", { class: "srow" }, h("label", { for: control.tagName === "BUTTON" ? undefined : id }, label), control, value ?? h("span"), note ? h("p", { class: "note", id: noteId! }, note) : null),
    );
  }

  private slider(parent: HTMLElement, o: { label: string; min: number; max: number; step: number; get(): number; set(v: number): void; fmt(v: number): string; note?: string; test?: () => void }): void {
    const id = `s${++uid}`;
    const input = h("input", { type: "range", id, min: o.min, max: o.max, step: o.step });
    const out = h("output", { for: id, class: "val" });
    const sync = (): void => {
      input.value = String(o.get());
      const text = o.fmt(Number(input.value));
      out.textContent = text;
      input.setAttribute("aria-valuetext", text);
    };
    input.addEventListener("input", () => {
      o.set(Number(input.value));
      sync();
    });
    if (o.test) input.addEventListener("change", o.test);
    this.refreshers.push(sync);
    this.row(parent, o.label, id, input, o.note, out);
    sync();
  }

  private toggle(parent: HTMLElement, o: { label: string; get(): boolean; set(v: boolean): void; note?: string; on?: string; off?: string }): void {
    const id = `t${++uid}`;
    const input = h("input", { type: "checkbox", id, role: "switch", class: "tick" });
    const out = h("span", { class: "val", "aria-hidden": "true" });
    const sync = (): void => {
      input.checked = o.get();
      out.textContent = input.checked ? (o.on ?? "On") : (o.off ?? "Off");
    };
    input.addEventListener("change", () => {
      o.set(input.checked);
      sync();
    });
    this.refreshers.push(sync);
    this.row(parent, o.label, id, input, o.note, out);
    sync();
  }

  private select<T extends string>(parent: HTMLElement, o: { label: string; options: readonly (readonly [T, string])[]; get(): T; set(v: T): void; note?: string }): void {
    const id = `c${++uid}`;
    const sel = h("select", { id }, ...o.options.map(([v, text]) => h("option", { value: v }, text)));
    const sync = (): void => {
      sel.value = o.get();
    };
    sel.addEventListener("change", () => {
      o.set(sel.value as T);
      sync();
    });
    this.refreshers.push(sync);
    this.row(parent, o.label, id, sel, o.note);
    sync();
  }

  private heading(parent: HTMLElement, text: string): void {
    parent.appendChild(h("h3", {}, text));
  }

  // ---- pages -----------------------------------------------------------------------------------------------------------------------

  private buildAudio(body: HTMLElement): void {
    const p = this.page("audio", body);
    const pct = (v: number): string => `${v}%`;
    const vol = (k: S.VolumeKey, label: string, note?: string, test?: () => void): void =>
      this.slider(p, { label, min: 0, max: 100, step: 1, get: () => Math.round(S.getVolume(k) * 100), set: (v) => S.setVolume(k, v / 100), fmt: pct, note, test });
    vol("master", "Master", undefined, () => playSfx("ui_confirm"));
    vol("music", "Music");
    vol("sfx", "Effects", "Guns, footsteps, voices, the interface.", () => playSfx("impact_wood"));
    vol("ambience", "Ambience", "Wind, birds, fire, water and weather.");
    this.toggle(p, { label: "Silent in the background", get: S.getMuteUnfocused, set: S.setMuteUnfocused, on: "Yes", off: "No" });
  }

  private buildVideo(body: HTMLElement): void {
    const p = this.page("video", body);
    this.select(p, {
      label: "Graphics",
      options: S.GFX_PLAYER_LEVELS.map((l) => [l, l[0]!.toUpperCase() + l.slice(1)] as const), // (the `test` preset is never offered)
      get: S.getGfx,
      set: S.setGfx,
      note: "Applies at once; edge smoothing (off on Low) at the next start.",
    });
    this.slider(p, { label: "Interface scale", min: 80, max: 150, step: 5, get: () => Math.round(S.getUiScale() * 100), set: (v) => S.setUiScale(v / 100), fmt: (v) => `${v}%` });
    this.slider(p, { label: "Field of view", min: 50, max: 100, step: 1, get: S.getFov, set: S.setFov, fmt: (v) => `${v}°`, note: "Third person; first person's wider view shifts with it." });
    this.toggle(p, { label: "Reduce motion", get: S.getReduceMotion, set: S.setReduceMotion, note: "Stills animation and screen shake. Follows your system until set." });
    this.heading(p, "Camera");
    this.select(p, { label: "View", options: [["third", "Third person"], ["first", "First person"]], get: S.getView, set: S.setView, note: "Switch any time in the field." });
    this.toggle(p, { label: "Head bob (first person)", get: S.getHeadBob, set: S.setHeadBob });
    this.heading(p, "Sensibilities");
    this.select(p, { label: "Gore", options: [["full", "Full"], ["reduced", "Reduced"], ["off", "Off"]], get: S.getGore, set: S.setGore, note: "Off replaces all blood with bandages and iodine. Wounds stay just as readable." });
    this.select(p, {
      label: "Severed limbs",
      options: [["1", "Shown"], ["0", "Hidden"]],
      get: () => (S.getShowLimbs() ? "1" : "0"),
      set: (v) => S.setShowLimbs(v === "1"),
      note: "Hidden draws them as dressings. Only what you see changes.",
    });
  }

  private buildControls(body: HTMLElement): void {
    const p = this.page("controls", body);
    this.slider(p, { label: "Mouse sensitivity", min: 25, max: 300, step: 5, get: () => Math.round(S.getSensitivity() * 100), set: (v) => S.setSensitivity(v / 100), fmt: (v) => `${v}%` });
    this.toggle(p, { label: "Invert look (vertical)", get: S.getInvertY, set: S.setInvertY, on: "Inverted", off: "Normal" });
    this.select(p, { label: "Sprint", options: [["hold", "Hold the key"], ["toggle", "Tap to toggle"]], get: () => (S.getHoldToSprint() ? "hold" : "toggle"), set: (v) => S.setHoldToSprint(v === "hold") });
    this.select(p, { label: "Aim", options: [["hold", "Hold the button"], ["toggle", "Tap to toggle"]], get: () => (S.getHoldToAim() ? "hold" : "toggle"), set: (v) => S.setHoldToAim(v === "hold") }); // (the same setting as the Gamepad page's)

    // D-098: the key list folds away on a phone (where it is rarely wanted and was most of the page); open everywhere else
    const keys = h("details", { class: "fold", open: true }, h("summary", {}, "Keys"));
    p.appendChild(keys);
    keys.appendChild(h("p", { class: "fine" }, "Choose a key, then press the new one. Backspace clears an alternate; Esc cancels. Fire and Aim are the mouse buttons."));
    this.conflictBar = h("div", { class: "conflict", role: "alert", hidden: true });
    keys.appendChild(this.conflictBar);
    const table = h("div", { class: "binds", role: "group", "aria-label": "Key bindings" });
    // one block per group, each headed with its column names, so a wide sheet sets them side by side (D-098)
    for (const group of ACTION_GROUPS) {
      const block = h("div", { class: "bindgroup" }, h("div", { class: "bind group" }, h("span", {}, group), h("span", { "aria-hidden": "true" }, "Key"), h("span", { "aria-hidden": "true" }, "Alternate")));
      for (const a of ACTIONS.filter((x) => x.group === group)) block.appendChild(this.bindRow(a));
      table.appendChild(block);
    }
    keys.appendChild(table);
    const resetKeys = h("button", { type: "button", class: "small" }, "Reset keys");
    resetKeys.addEventListener("click", () => {
      this.cancelCapture();
      setBindings(defaultBindings());
      this.say("Keys restored.");
    });
    keys.appendChild(h("div", { class: "row-end" }, resetKeys));
    this.refreshers.push(() => this.refreshBindings());
  }

  /** The gamepad's page: its stick speed, then (D-038, ui/SettingsPad.ts) the feel, aim assist, hold or toggle aim, rumble and a rebindable layout; every prompt in the game follows it. */
  private buildPad(body: HTMLElement): void {
    const p = this.page("pad", body);
    this.slider(p, { label: "Stick sensitivity", min: 25, max: 300, step: 5, get: () => Math.round(S.getPadSensitivity() * 100), set: (v) => S.setPadSensitivity(v / 100), fmt: (v) => `${v}%` });
    this.padSection?.dispose();
    this.padSection = buildPadSection();
    p.appendChild(this.padSection.el);
  }

  private bindRow(a: ActionDef): HTMLElement {
    const mk = (slot: Slot): HTMLButtonElement => {
      const b = h("button", { type: "button", class: "keycap", "data-action": a.id, "data-slot": slot });
      b.addEventListener("click", () => this.startCapture(a, slot, b));
      this.bindingButtons.set(`${a.id}:${slot}`, b);
      return b;
    };
    return h("div", { class: "bind" }, h("span", { class: "what" }, a.label), mk(0), mk(1));
  }

  private refreshBindings(): void {
    const b = getBindings();
    for (const a of ACTIONS) {
      for (const s of [0, 1] as const) {
        const btn = this.bindingButtons.get(`${a.id}:${s}`);
        if (!btn) continue;
        const code = b[a.id][s];
        btn.textContent = code ? keyLabel(code) : "—";
        btn.classList.toggle("empty", !code);
        btn.setAttribute("aria-label", `${a.label}, ${s === 0 ? "key" : "alternate key"}: ${code ? keyLabel(code) : "unbound"}. Press to change.`);
      }
    }
  }

  private startCapture(a: ActionDef, slot: Slot, btn: HTMLButtonElement): void {
    this.cancelCapture();
    this.clearConflict();
    this.capture = { action: a.id, slot, btn };
    this.modal.escapeBusy = true;
    btn.textContent = "Press a key…";
    btn.classList.add("listening");
    this.say(`Press the new ${slot === 0 ? "key" : "alternate key"} for ${a.label}. Esc cancels.`);
    window.addEventListener("keydown", this.onCaptureKey, true);
  }

  private cancelCapture(): void {
    if (!this.capture) return;
    window.removeEventListener("keydown", this.onCaptureKey, true);
    this.capture.btn.classList.remove("listening");
    this.capture = undefined;
    this.modal.escapeBusy = this.pending !== undefined;
    this.refreshBindings();
  }

  private readonly onCaptureKey = (e: KeyboardEvent): void => {
    const cap = this.capture;
    if (!cap) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === "Escape") {
      this.cancelCapture();
      this.say("Cancelled.");
      return;
    }
    const clear = e.code === "Backspace" || e.code === "Delete";
    this.tryAssign(cap.action, cap.slot, clear ? "" : e.code);
  };

  private tryAssign(action: ActionId, slot: Slot, code: string, resolve?: "swap" | "replace"): void {
    const res = assign(getBindings(), action, slot, code, resolve);
    const label = ACTIONS.find((a) => a.id === action)!.label;
    if (res.ok) {
      this.cancelCapture();
      this.clearConflict();
      setBindings(res.bindings);
      this.say(code ? `${label}: ${keyLabel(code)}.` : `${label}: alternate cleared.`);
      return;
    }
    if (res.reason === "reserved") {
      this.say(`${keyLabel(code)} is reserved by the game. Try another key.`);
      playSfx("ui_error");
    } else if (res.reason === "last-key") {
      this.cancelCapture();
      this.say(`${label} must keep at least one key.`);
      playSfx("ui_error");
    } else if (res.reason === "conflict" && res.conflict) {
      this.cancelCapture();
      this.showConflict(action, slot, code, res.conflict.action);
    }
  }

  private showConflict(action: ActionId, slot: Slot, code: string, other: ActionId): void {
    const name = (id: ActionId): string => ACTIONS.find((a) => a.id === id)!.label;
    this.pending = { action, slot, code };
    this.modal.escapeBusy = true;
    const swap = h("button", { type: "button", class: "small" }, "Swap them");
    const take = h("button", { type: "button", class: "small" }, `Take it from ${name(other)}`);
    const cancel = h("button", { type: "button", class: "small" }, "Cancel");
    swap.addEventListener("click", () => this.resolve("swap"));
    take.addEventListener("click", () => this.resolve("replace"));
    cancel.addEventListener("click", () => this.clearConflict());
    this.conflictBar.replaceChildren(h("span", {}, `${keyLabel(code)} already belongs to “${name(other)}”.`), h("span", { class: "btns" }, swap, take, cancel));
    this.conflictBar.hidden = false;
    this.say("That key is in use. Choose what to do.");
    playSfx("ui_error");
    swap.focus();
  }

  private resolve(how: "swap" | "replace"): void {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    this.conflictBar.hidden = true;
    this.modal.escapeBusy = false;
    this.tryAssign(p.action, p.slot, p.code, how);
  }

  private clearConflict(): void {
    this.pending = undefined;
    this.conflictBar.hidden = true;
    this.modal.escapeBusy = this.capture !== undefined;
  }

  private buildAccess(body: HTMLElement): void {
    const p = this.page("access", body);
    this.toggle(p, {
      label: "Colour-blind safe marks",
      get: S.getCvd,
      set: S.setCvd,
      note: "Injury charts carry hatching and marks, not only red and brown.",
    });
    this.toggle(p, { label: "High contrast", get: S.getHighContrast, set: S.setHighContrast, note: "Stark ink on plain paper, heavier borders, no textured grain." });
    this.toggle(p, { label: "Larger text", get: S.getLargeText, set: S.setLargeText, note: "A fifth larger, on top of the interface scale.", on: "Larger", off: "Normal" });
    this.toggle(p, { label: "Never show tutorials", get: S.getSkipTutorials, set: S.setSkipTutorials, note: "No orientation card in any campaign (the Pause sheet can still replay it).", on: "Never", off: "As needed" });
    this.toggle(p, {
      label: "Captions",
      get: S.getCaptions,
      set: S.setCaptions,
      note: "The sounds that matter, and where from: [musket shot, left].",
    });
    const preview = h("button", { type: "button", class: "small" }, "Preview a caption");
    preview.addEventListener("click", () => previewCaption("[musket shot, left]"));
    p.appendChild(h("div", { class: "row-end" }, preview));
    this.slider(p, { label: "Screen shake", min: 0, max: 100, step: 5, get: () => Math.round(S.getShake() * 100), set: (v) => S.setShake(v / 100), fmt: (v) => (v === 0 ? "None" : `${v}%`), note: "Reduce motion caps it further." });
  }

  /**
   * D-102, the profile: the code that carries this device's characters and expeditions (profileCode.ts), a box to restore one, and the records erasure. There are no accounts, so
   * the code is how a player keeps their saves through a cleared browser or takes them to another device.
   */
  private buildProfile(body: HTMLElement): void {
    const p = this.page("profile", body);
    p.classList.add("profile");
    // the code: a button, then the code itself (shown once asked for, selected, so it can be copied by hand where the clipboard is refused)
    const copyId = `p${++uid}`;
    const copy = h("button", { type: "button", id: copyId, class: "small", "aria-describedby": `${copyId}-note` }, "Copy my code");
    const shown = h("textarea", { class: "profilecode", rows: 3, readonly: true, spellcheck: "false", "aria-label": "Your profile code", hidden: true });
    const copyNote = h("p", { class: "note", id: `${copyId}-note`, role: "status" }, "Your characters and expeditions in one code, to keep safe or paste on another device. Keep it private: it lets anyone resume your expeditions.");
    p.append(h("div", { class: "srow code" }, h("label", {}, "Profile code"), copy, shown, copyNote));
    copy.addEventListener("click", () => {
      const code = myProfileCode();
      shown.value = code;
      shown.hidden = false;
      shown.select();
      const done = (ok: boolean): void => {
        copyNote.textContent = ok ? "Copied. Paste it into a note or an email to yourself." : "Select the code above and copy it. Keep it private.";
      };
      const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (clip?.writeText) clip.writeText(code).then(() => done(true), () => done(false));
      else done(false);
    });

    // the restore: paste, then Restore (two presses when it would replace this device's own papers)
    const restoreId = `p${++uid}`;
    const field = h("textarea", { id: restoreId, class: "profilecode", rows: 2, spellcheck: "false", autocomplete: "off", placeholder: "CB1-...", "aria-describedby": `${restoreId}-note` });
    const btn = h("button", { type: "button", class: "small" }, "Restore");
    const note = h("p", { class: "note", id: `${restoreId}-note`, role: "status" });
    p.append(h("div", { class: "srow code" }, h("label", { for: restoreId }, "Restore from a code"), field, h("div", { class: "foot" }, note, btn)));
    this.restoreBtn = btn;
    this.restoreNote = note;
    btn.addEventListener("click", () => this.onRestore(field.value));
    field.addEventListener("input", () => {
      this.restoreArmed = 0;
      this.refreshRestore();
    });
    this.refreshRestore();
    this.buildRecords(p);
  }

  /** What happens after a restore: the page starts again, so the door, its characters and its list are read afresh (a test replaces it). */
  onRestored: () => void = () => location.reload();
  private restoreBtn?: HTMLButtonElement;
  private restoreNote?: HTMLElement;
  private restoreArmed = 0;

  private refreshRestore(msg?: string): void {
    if (!this.restoreBtn || !this.restoreNote) return;
    this.restoreBtn.disabled = this.playing;
    this.restoreBtn.textContent = this.restoreArmed > Date.now() ? "Press again to replace" : "Restore";
    this.restoreNote.textContent = msg ?? (this.playing ? "Leave the expedition first: restoring changes who you are on this device." : "Adds the code's characters and expeditions to this device.");
  }

  private onRestore(text: string): void {
    if (this.playing) return;
    const replace = this.restoreArmed > Date.now();
    const r = restoreProfileCode(text, replace);
    if (r.kind === "bad") {
      this.restoreArmed = 0;
      this.refreshRestore("That is not a profile code. Copy it again, all of it.");
      return;
    }
    if (r.kind === "papers") {
      this.restoreArmed = Date.now() + 6000;
      this.refreshRestore(`This device has ${r.own} expedition${r.own === 1 ? "" : "s"} under other papers, and they would stop resuming here. Copy this device's code first to keep them.`);
      window.setTimeout(() => this.refreshRestore(), 6100);
      return;
    }
    this.restoreArmed = 0;
    const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
    this.refreshRestore(`Restored ${plural(r.characters, "character")} and ${plural(r.expeditions, "expedition")}. The front door is reopening.`);
    if (this.restoreBtn) this.restoreBtn.disabled = true;
    window.setTimeout(() => this.onRestored(), 1200);
  }

  /** Whether a game is running in this page (then the records cannot be erased: the room would save the membership straight back). Set once by boot. */
  set inGame(on: boolean) {
    this.playing = on;
    this.refreshErase();
    this.refreshRestore();
  }
  private playing = false;
  private eraseBtn?: HTMLButtonElement;
  private eraseNote?: HTMLElement;
  private eraseArmed = 0;

  /** Your records: erase this browser's campaigns from the server and its identity from here (PRIVACY_DATA_MAP). Two presses, and only at the front door. */
  private buildRecords(p: HTMLElement): void {
    const id = `e${++uid}`;
    const btn = h("button", { type: "button", id, class: "small" }, "Erase my records");
    btn.addEventListener("click", () => void this.onErase());
    this.row(p, "Your records", id, btn, " ");
    const note = btn.parentElement?.querySelector<HTMLElement>("p.note");
    note?.setAttribute("role", "status");
    this.eraseBtn = btn;
    this.eraseNote = note ?? undefined;
    this.refreshErase();
  }

  private refreshErase(msg?: string): void {
    if (!this.eraseBtn || !this.eraseNote) return;
    this.eraseBtn.disabled = this.playing;
    this.eraseBtn.textContent = this.eraseArmed > Date.now() ? "Press again to erase" : "Erase my records";
    this.eraseNote.textContent = msg ?? (this.playing
      ? "Leave the expedition first (from the front door): a game in progress would write your membership straight back."
      : "Takes you out of every campaign this browser played (one left empty is deleted) and forgets this browser. Settings and characters stay. Cannot be undone.");
  }

  private async onErase(): Promise<void> {
    if (this.playing || !this.eraseBtn) return;
    if (this.eraseArmed <= Date.now()) {
      this.eraseArmed = Date.now() + 5000;
      this.refreshErase();
      window.setTimeout(() => this.refreshErase(), 5100);
      return;
    }
    this.eraseArmed = 0;
    this.eraseBtn.disabled = true;
    const r = await eraseMyRecords();
    this.eraseBtn.disabled = this.playing;
    if (r.ok) this.refreshErase(r.campaigns === 0 ? "Done. The Society held nothing of yours; this browser has forgotten its identity." : `Done. You have been removed from ${r.campaigns} campaign${r.campaigns === 1 ? "" : "s"}, and this browser has forgotten its identity.`);
    else this.refreshErase(r.reason === "busy" ? "The Society's clerks are busy. Try again in a minute." : r.reason === "offline" ? "The Society's offices cannot be reached. Nothing was erased; try again when online." : "The request was refused. Nothing was erased.");
  }
}

let sheet: SettingsSheet | undefined;
/** The one settings sheet (built on first use). */
export function settingsSheet(): SettingsSheet {
  return (sheet ??= new SettingsSheet());
}
export function openSettings(opener?: HTMLElement | null, tab?: TabId): void {
  settingsSheet().open(opener, tab);
}
export type { Bindings };
