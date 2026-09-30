import { playSfx, previewCaption } from "../audio/index.ts";
import { ACTIONS, assign, defaultBindings, getBindings, keyLabel, setBindings, type ActionDef, type ActionId, type Bindings, type Slot } from "../input/bindings.ts";
import * as S from "../settings.ts";
import { ACTION_GROUPS, PAD_LAYOUT } from "./controlsInfo.ts";
import { Modal, h } from "./modal.ts";

/**
 * The settings screen ("Standing Orders"): four tabs, every control a real form control (range, checkbox, select, button) so it works with
 * mouse, keyboard and gamepad (PadNav), with labels, notes and live values wired through ARIA. Nothing here stores anything itself: each
 * control reads and writes settings.ts (which persists and announces changes), so the audio engine, camera, stage and stylesheet follow live.
 */

export type TabId = "audio" | "video" | "controls" | "access";
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "audio", label: "Sound" },
  { id: "video", label: "Display" },
  { id: "controls", label: "Controls" },
  { id: "access", label: "Accessibility" },
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
    this.buildAccess(body);
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
    };
    this.showTab("audio", false);
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(opener?: HTMLElement | null, tab?: TabId): void {
    if (tab) this.showTab(tab, false);
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
      h("div", { class: "srow" }, h("label", { for: id }, label), control, value ?? h("span"), note ? h("p", { class: "note", id: noteId! }, note) : null),
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
    const vol = (k: S.VolumeKey, label: string, note: string, test?: () => void): void =>
      this.slider(p, { label, min: 0, max: 100, step: 1, get: () => Math.round(S.getVolume(k) * 100), set: (v) => S.setVolume(k, v / 100), fmt: pct, note, test });
    vol("master", "Master", "Everything at once. The slider follows the ear: halfway sounds about half as loud.", () => playSfx("ui_confirm"));
    vol("music", "Music", "The parlour band in the menu and a calmer air in the field.");
    vol("sfx", "Effects", "Guns, footsteps, voices, the interface.", () => playSfx("impact_wood"));
    vol("ambience", "Ambience", "Wind, birds, crickets, the fire, the stream, rain and thunder.");
    this.toggle(p, { label: "Silent when unfocused", get: S.getMuteUnfocused, set: S.setMuteUnfocused, note: "Mutes the game while its window is in the background.", on: "Yes", off: "No" });
  }

  private buildVideo(body: HTMLElement): void {
    const p = this.page("video", body);
    this.select(p, {
      label: "Graphics",
      options: [["low", "Low"], ["medium", "Medium"], ["high", "High"]],
      get: S.getGfx,
      set: S.setGfx,
      note: "Applied at once to the world, shadows and sharpness. Ink outlines on characters take effect for people who arrive after the change.",
    });
    this.slider(p, { label: "Interface scale", min: 80, max: 150, step: 5, get: () => Math.round(S.getUiScale() * 100), set: (v) => S.setUiScale(v / 100), fmt: (v) => `${v}%`, note: "Scales every menu and the gauge, tags and prompts in the field." });
    this.slider(p, { label: "Field of view", min: 50, max: 100, step: 1, get: S.getFov, set: S.setFov, fmt: (v) => `${v}°`, note: "Vertical, in third person. First person keeps its own wider view, shifted by the same amount." });
    this.toggle(p, { label: "Reduce motion", get: S.getReduceMotion, set: S.setReduceMotion, note: "Stills interface animation and nearly removes screen shake. Follows your system setting until you choose." });
    this.heading(p, "Camera");
    this.select(p, { label: "View", options: [["third", "Third person"], ["first", "First person"]], get: S.getView, set: S.setView, note: "You can switch at any time in the field. Other players always see your whole figure." });
    this.toggle(p, { label: "Head bob (first person)", get: S.getHeadBob, set: S.setHeadBob, note: "The sway of your own footsteps in first person." });
    this.heading(p, "Sensibilities");
    this.select(p, { label: "Gore", options: [["full", "Full"], ["reduced", "Reduced"], ["off", "Off"]], get: S.getGore, set: S.setGore, note: "Off replaces all blood with bandages and iodine. Wounds stay just as readable." });
    this.select(p, {
      label: "Severed limbs",
      options: [["1", "Shown"], ["0", "Hidden"]],
      get: () => (S.getShowLimbs() ? "1" : "0"),
      set: (v) => S.setShowLimbs(v === "1"),
      note: "Hidden shows the same injuries as ordinary dressings. It only changes what you see, never what happens.",
    });
  }

  private buildControls(body: HTMLElement): void {
    const p = this.page("controls", body);
    this.slider(p, { label: "Mouse sensitivity", min: 25, max: 300, step: 5, get: () => Math.round(S.getSensitivity() * 100), set: (v) => S.setSensitivity(v / 100), fmt: (v) => `${v}%` });
    this.slider(p, { label: "Stick sensitivity", min: 25, max: 300, step: 5, get: () => Math.round(S.getPadSensitivity() * 100), set: (v) => S.setPadSensitivity(v / 100), fmt: (v) => `${v}%` });
    this.toggle(p, { label: "Invert look (vertical)", get: S.getInvertY, set: S.setInvertY, note: "Push up to look down, like an aeroplane.", on: "Inverted", off: "Normal" });
    this.select(p, { label: "Sprint", options: [["hold", "Hold the key"], ["toggle", "Tap to toggle"]], get: () => (S.getHoldToSprint() ? "hold" : "toggle"), set: (v) => S.setHoldToSprint(v === "hold"), note: "Toggle lets you keep the key up while running." });

    this.heading(p, "Keyboard");
    p.appendChild(h("p", { class: "fine" }, "Choose a key, then press the new one. Backspace clears an alternate key; Esc cancels. Esc, F3 and the browser's function keys are reserved."));
    this.conflictBar = h("div", { class: "conflict", role: "alert", hidden: true });
    p.appendChild(this.conflictBar);
    const table = h("div", { class: "binds", role: "group", "aria-label": "Key bindings" });
    table.append(h("div", { class: "bind head", "aria-hidden": "true" }, h("span"), h("span", {}, "Key"), h("span", {}, "Alternate")));
    for (const group of ACTION_GROUPS) {
      table.appendChild(h("div", { class: "bind group" }, h("span", {}, group)));
      for (const a of ACTIONS.filter((x) => x.group === group)) table.appendChild(this.bindRow(a));
    }
    p.appendChild(table);
    const resetKeys = h("button", { type: "button", class: "small" }, "Reset keys to defaults");
    resetKeys.addEventListener("click", () => {
      this.cancelCapture();
      setBindings(defaultBindings());
      this.say("Keys restored.");
    });
    p.appendChild(h("div", { class: "row-end" }, resetKeys));
    this.refreshers.push(() => this.refreshBindings());

    this.heading(p, "Mouse and gamepad");
    p.appendChild(h("p", { class: "fine" }, "Fire is the left mouse button and Aim the right. The gamepad layout is fixed (standard mapping):"));
    const pad = h("div", { class: "padmap" }, this.padSvg());
    const list = h("dl", { class: "keys pads" });
    for (const r of PAD_LAYOUT) list.appendChild(h("div", {}, h("dt", {}, h("kbd", { class: "pad" }, r.glyph)), h("dd", {}, r.what)));
    pad.appendChild(list);
    p.appendChild(pad);
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

  private padSvg(): SVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 78");
    svg.setAttribute("class", "padsvg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Gamepad: sticks and face buttons on the front, bumpers and triggers on top");
    svg.innerHTML = `
      <path class="body" d="M24 22c-9 3-16 20-19 38-1.6 9 6 12 12 6l14-14h58l14 14c6 6 13.600 3 12-6-3-18-10-35-19-38-4-1.500-9-2-14-2H38c-5 0-10 .5-14 2Z"/>
      <path class="bump" d="M28 20 32 12h16l3 8M92 20 88 12H72l-3 8"/>
      <circle class="stick" cx="40" cy="36" r="8"/><circle class="stick" cx="76" cy="52" r="8"/>
      <path class="dpad" d="M26 52h6v-6h6v6h6v6h-6v6h-6v-6h-6z"/>
      <circle class="btn" cx="88" cy="28" r="4.500"/><circle class="btn" cx="98" cy="36" r="4.500"/><circle class="btn" cx="78" cy="36" r="4.500"/><circle class="btn" cx="88" cy="44" r="4.500"/>
      <g class="glyphs"><text x="88" y="29.800">Y</text><text x="98" y="37.800">B</text><text x="78" y="37.800">X</text><text x="88" y="45.800">A</text>
      <text x="40" y="38.500">L</text><text x="76" y="54.500">R</text><text x="40" y="9">LB · LT</text><text x="80" y="9">RB · RT</text></g>`;
    return svg;
  }

  private buildAccess(body: HTMLElement): void {
    const p = this.page("access", body);
    this.toggle(p, {
      label: "Colour-blind safe marks",
      get: S.getCvd,
      set: S.setCvd,
      note: "Injury and vitality charts use ink hatching and shape marks instead of relying on red and brown fills. Nothing in the game is colour alone even without this.",
    });
    this.toggle(p, { label: "High contrast", get: S.getHighContrast, set: S.setHighContrast, note: "Stark ink on plain paper, heavier borders, no textured grain." });
    this.toggle(p, { label: "Larger text", get: S.getLargeText, set: S.setLargeText, note: "Bumps every size in the interface by a fifth, on top of the interface scale.", on: "Larger", off: "Normal" });
    this.toggle(p, {
      label: "Captions",
      get: S.getCaptions,
      set: S.setCaptions,
      note: "Brief italic captions for the sounds that matter, with the direction they came from: [musket shot, left].",
    });
    const preview = h("button", { type: "button", class: "small" }, "Preview a caption");
    preview.addEventListener("click", () => previewCaption("[musket shot, left]"));
    p.appendChild(h("div", { class: "row-end" }, preview));
    this.slider(p, { label: "Screen shake", min: 0, max: 100, step: 5, get: () => Math.round(S.getShake() * 100), set: (v) => S.setShake(v / 100), fmt: (v) => (v === 0 ? "None" : `${v}%`), note: "How far the camera jolts when you are hit or blown about. Reduce motion caps it further." });
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
