import { PAD_INDEX, PAD_GLYPHS, deviceTracker, type PromptId, padFamilyOf, type PadFamily } from "../input/devices.ts";
import { glyphEl, onPromptChange } from "../input/glyphDom.ts";
import { PAD_ACTIONS, PAD_BINDABLE, assignPad, defaultPadBindings, getPadBindings, setPadBindings, type PadAction, type PadButton } from "../input/padProfile.ts";
import * as S from "../settings.ts";
import { padRows } from "./controlsInfo.ts";
import { h } from "./modal.ts";

/**
 * The pad half of the Controls page (D-038, package I): the glyph family, the feel (deadzone, response curve, stick and aim sensitivity), aim assist, hold-or-toggle aim, rumble, and the
 * LAYOUT with a rebinding row per action. Built as one element the Settings sheet mounts (`buildPadSection()`); every control is a real form control (range, checkbox, select, button), so the
 * pad itself drives it through PadNav, and nothing here stores anything: it reads and writes settings.ts and padProfile.ts, which persist and announce.
 *
 * Rebinding two ways: a drop-down per action (works with a pad's d-pad, a mouse, a keyboard), or "Press a button" (the next pad button pressed is the one). A control another action holds
 * is SWAPPED, never refused, and the sentence under the table says so, so no action is ever left unbound.
 */

export interface PadSection {
  readonly el: HTMLElement;
  /** Stops following the settings and the device. */
  dispose(): void;
  /** Cancels a half-finished "Press a button" (the sheet closed). */
  cancelLearn(): void;
}

type PadSource = () => readonly (Gamepad | null)[];
const defaultPads: PadSource = () => (typeof navigator !== "undefined" ? navigator.getGamepads?.() ?? [] : []);

let uid = 0;

/** The family whose control names the drop-downs use: the one in use, else Xbox. */
const family = (): PadFamily => padFamilyOf(deviceTracker.effective);

export function buildPadSection(pads: PadSource = defaultPads): PadSection {
  const root = h("section", { class: "padsection", "aria-label": "Gamepad" });
  const refreshers: (() => void)[] = [];
  const status = h("p", { class: "padstatus", role: "status", "aria-live": "polite" });
  let learn: { action: PadAction; raf: number; held: Set<PadButton>; btn: HTMLButtonElement } | undefined;

  const row = (label: string, id: string, control: HTMLElement, note?: string, value?: HTMLElement): void => {
    const noteId = note ? `${id}-note` : undefined;
    if (noteId) control.setAttribute("aria-describedby", noteId);
    root.append(h("div", { class: "srow" }, h("label", { for: id }, label), control, value ?? h("span"), note ? h("p", { class: "note", id: noteId! }, note) : null));
  };
  const slider = (o: { label: string; spec: { get(): number; set(v: number): void; min: number; max: number; step: number }; scale?: number; fmt(v: number): string; note?: string }): void => {
    const id = `ps${++uid}`;
    const scale = o.scale ?? 1;
    const input = h("input", { type: "range", id, min: Math.round(o.spec.min * scale), max: Math.round(o.spec.max * scale), step: Math.max(1, Math.round(o.spec.step * scale)) });
    const out = h("output", { for: id, class: "val" });
    const sync = (): void => {
      input.value = String(Math.round(o.spec.get() * scale));
      out.textContent = o.fmt(Number(input.value) / scale);
      input.setAttribute("aria-valuetext", out.textContent);
    };
    input.addEventListener("input", () => {
      o.spec.set(Number(input.value) / scale);
      sync();
    });
    refreshers.push(sync);
    row(o.label, id, input, o.note, out);
    sync();
  };
  const toggle = (o: { label: string; get(): boolean; set(v: boolean): void; note?: string; on?: string; off?: string }): void => {
    const id = `pt${++uid}`;
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
    refreshers.push(sync);
    row(o.label, id, input, o.note, out);
    sync();
  };


  // the glyph family
  {
    const id = `pg${++uid}`;
    const sel = h("select", { id }, ...S.GLYPH_PREFERENCES.map((v) => h("option", { value: v }, v === "auto" ? "Follow the device in use" : v === "keyboard" ? "Keyboard and mouse" : v === "xbox" ? "Xbox (A B X Y)" : "PlayStation (cross circle square triangle)")));
    const sync = (): void => {
      sel.value = S.getGlyphPreference();
    };
    sel.addEventListener("change", () => S.setGlyphPreference(sel.value as S.GlyphPreference));
    refreshers.push(sync);
    row("Button prompts", id, sel);
    sync();
  }

  slider({ label: "Stick deadzone", spec: S.padDeadzoneSpec, scale: 100, fmt: (v) => `${Math.round(v * 100)}%`, note: "Raise it if the view drifts on its own." });
  slider({ label: "Stick response", spec: S.padCurveSpec, scale: 10, fmt: (v) => (v <= 1.05 ? "Linear" : v.toFixed(1)), note: "Higher is finer near the centre, still quick at the rim." });
  slider({ label: "Aim sensitivity", spec: S.padAimSensitivitySpec, scale: 100, fmt: (v) => `${Math.round(v * 100)}%`, note: "While aiming, as a share of stick sensitivity." });
  toggle({ label: "Aim assist", get: S.getAimAssist, set: S.setAimAssist, note: "A gentle pull toward a hostile near the crosshair.", on: "On", off: "Off" });
  toggle({ label: "Hold to aim", get: S.getHoldToAim, set: S.setHoldToAim, on: "Hold", off: "Toggle" });
  toggle({ label: "Rumble", get: S.getPadRumble, set: S.setPadRumble, on: "On", off: "Off" });

  // the layout
  // (the layout and the fixed list fold away on a phone: the Settings sheet decides when it opens)
  const layout = h("details", { class: "fold", open: true }, h("summary", {}, "Layout"), h("p", { class: "fine" }, "Pick a control, or Press a button and then it. A control already taken swaps places, so nothing is left without one. Reload is Use held."));
  root.append(layout);
  const table = h("div", { class: "binds padbinds", role: "group", "aria-label": "Gamepad layout" });
  const selects = new Map<PadAction, HTMLSelectElement>();
  const glyphs = new Map<PadAction, HTMLElement>();
  const sayAssign = (action: PadAction, to: PadButton): void => {
    const r = assignPad(getPadBindings(), action, to);
    setPadBindings(r.bindings);
    const name = (a: PadAction): string => PAD_ACTIONS.find((x) => x.id === a)!.label;
    const g = PAD_GLYPHS[family()][to].name;
    status.textContent = r.swapped ? `${name(action)} is now on the ${g}; ${name(r.swapped)} took the button it left.` : `${name(action)} is now on the ${g}.`;
  };
  for (const a of PAD_ACTIONS) {
    const id = `pb${++uid}`;
    const sel = h("select", { id, "data-action": a.id, "aria-label": `${a.label}: control` }, ...PAD_BINDABLE.map((c) => h("option", { value: c }, PAD_GLYPHS[family()][c].name)));
    sel.addEventListener("change", () => sayAssign(a.id, sel.value as PadButton));
    selects.set(a.id, sel);
    const mark = h("span", { class: "glyphcell", "aria-hidden": "true" });
    glyphs.set(a.id, mark);
    const set = h("button", { type: "button", class: "small", "data-learn": a.id }, "Press a button");
    set.addEventListener("click", () => startLearn(a.id, set));
    table.append(h("div", { class: "bind" }, h("label", { for: id }, a.label), mark, sel, set));
  }
  layout.append(table);
  const reset = h("button", { type: "button", class: "small", "data-act": "reset-pad" }, "Reset gamepad layout");
  reset.addEventListener("click", () => {
    cancelLearn();
    setPadBindings(defaultPadBindings());
    status.textContent = "Gamepad layout restored.";
  });
  layout.append(h("div", { class: "row-end" }, reset));
  root.append(status);

  // the fixed controls, drawn with the glyphs of the family in use
  const list = h("dl", { class: "keys pads" });
  root.append(h("details", { class: "fold", open: true }, h("summary", {}, "Fixed"), list));

  const refreshLayout = (): void => {
    const b = getPadBindings();
    const fam = family();
    for (const a of PAD_ACTIONS) {
      const sel = selects.get(a.id)!;
      for (const o of [...sel.options]) o.textContent = PAD_GLYPHS[fam][o.value as PadButton].name;
      sel.value = b[a.id];
      glyphs.get(a.id)!.replaceChildren(glyphEl(a.id satisfies PromptId, fam));
    }
    // the controls that keep their places (the table above already lists the rest: D-098 stopped listing them twice)
    list.replaceChildren(
      ...padRows(fam)
        .filter((r) => !(r.prompts ?? []).some((p) => PAD_ACTIONS.some((a) => a.id === p)))
        .map((r) => h("div", {}, h("dt", {}, ...(r.prompts ?? []).map((p) => glyphEl(p, fam))), h("dd", {}, r.what))),
    );
  };
  refreshers.push(refreshLayout);
  refreshLayout();

  // "Press a button": the next pad button that goes down (not one already held when it started) is the control. Back / View cancels.
  function startLearn(action: PadAction, btn: HTMLButtonElement): void {
    cancelLearn();
    const held = new Set<PadButton>();
    const pad = [...pads()].find((p) => p?.connected && p.mapping === "standard");
    if (!pad) {
      status.textContent = "No gamepad found. Press a button on it, then try again.";
      return;
    }
    for (const c of PAD_BINDABLE) if (pad.buttons[PAD_INDEX[c]]?.pressed) held.add(c);
    btn.textContent = "Press the button...";
    btn.setAttribute("aria-pressed", "true");
    status.textContent = `Press the button for ${PAD_ACTIONS.find((a) => a.id === action)!.label}. Press View to cancel.`;
    learn = { action, raf: 0, held, btn };
    const tick = (): void => {
      if (!learn) return;
      learn.raf = requestAnimationFrame(tick);
      const p = [...pads()].find((q) => q?.connected && q.mapping === "standard");
      if (!p) return;
      if (p.buttons[PAD_INDEX.back]?.pressed) {
        cancelLearn();
        status.textContent = "Cancelled.";
        return;
      }
      for (const c of PAD_BINDABLE) {
        const down = !!p.buttons[PAD_INDEX[c]]?.pressed || (p.buttons[PAD_INDEX[c]]?.value ?? 0) > 0.6;
        if (!down) learn.held.delete(c);
        else if (!learn.held.has(c)) {
          const a = learn.action;
          cancelLearn();
          sayAssign(a, c);
          return;
        }
      }
    };
    learn.raf = requestAnimationFrame(tick);
  }
  function cancelLearn(): void {
    if (!learn) return;
    cancelAnimationFrame(learn.raf);
    learn.btn.textContent = "Press a button";
    learn.btn.removeAttribute("aria-pressed");
    learn = undefined;
  }

  const refresh = (): void => {
    for (const r of refreshers) r();
  };
  const offSettings = S.onSettingChange((k) => (k === "all" || k === "padBindings" || k === "glyphs" || k === "padDeadzone" || k === "padCurve" || k === "padAimSensitivity" || k === "aimAssist" || k === "holdToAim" || k === "padRumble") && refresh());
  const offDevice = onPromptChange(() => refreshLayout());
  return {
    el: root,
    dispose: () => {
      cancelLearn();
      offSettings();
      offDevice();
    },
    cancelLearn,
  };
}

export type { PadAction };
