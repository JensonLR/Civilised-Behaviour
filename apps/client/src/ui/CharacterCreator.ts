import { FIELDS, PALETTES, encodeSpec, type CharacterSpec, type FieldDef, type FieldKey } from "@cb/procedural";
import {
  POSES,
  POSE_EVENT,
  PRESETS,
  SECTIONS,
  SpecHistory,
  applyPasted,
  applyPreset,
  fieldsOfTab,
  parseLookCode,
  randomiseAll,
  randomiseKeys,
  sameSpec,
  type PoseId,
  type Tab,
} from "./creatorLogic.ts";

export { SECTIONS };

const TABS: { id: Tab; label: string }[] = [
  { id: "types", label: "Types" },
  { id: "body", label: "Body" },
  { id: "face", label: "Face" },
  { id: "clothes", label: "Attire" },
  { id: "colour", label: "Colours" },
];

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as Record<string, unknown>;
  if (cls) e.className = cls as string;
  Object.assign(e, rest);
  for (const c of children) e.append(c);
  return e;
}

/**
 * Character creator form, generated from the spec's field metadata: adding an option to the catalog adds a control here with no UI code. It has
 * archetype presets, headed sections that can each be shuffled, undo/redo (the last 20 looks), look codes to copy and paste (a bad paste is explained in
 * words), and a pose picker for the 3D preview (which listens for `POSE_EVENT`). Campaign-owned history fields are deliberately absent (the server ignores
 * them anyway; see applyClientAppearance). Everything is a real button, select or input with a name, so keyboard and gamepad navigation (PadNav) work as they
 * are; the pure logic (history, codes, shuffling, presets) lives in creatorLogic.ts and is tested there.
 */
export class CharacterCreator {
  private spec: CharacterSpec;
  private readonly history: SpecHistory;
  private tab: Tab = "types";
  private pose: PoseId = "turntable";
  private readonly body: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly codeInput: HTMLInputElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly poseBtns = new Map<PoseId, HTMLButtonElement>();
  /** Per field: how to show a new value in its control (so a shuffle, an undo or a preset never has to rebuild the page and drop focus). */
  private readonly sync = new Map<string, (value: number) => void>();
  private presetBtns: { btn: HTMLButtonElement; index: number }[] = [];
  private seedCounter = Math.floor(Math.random() * 1e6);

  constructor(
    private readonly root: HTMLElement,
    private readonly initial: CharacterSpec,
    private readonly onChange: (spec: CharacterSpec) => void,
  ) {
    this.spec = { ...initial };
    this.history = new SpecHistory(this.spec);
    root.classList.add("creator");
    root.replaceChildren();

    const tool = (label: string, act: string, title: string): HTMLButtonElement => {
      const b = el("button", { type: "button", textContent: label, title });
      b.dataset.act = act;
      return b;
    };
    this.undoBtn = tool("Undo", "undo", "Undo the last change (Ctrl+Z)");
    this.redoBtn = tool("Redo", "redo", "Redo (Ctrl+Y)");
    const dice = tool("Randomise all", "dice", "A new random appearance");
    const reset = tool("Reset", "reset", "Back to the look you came in with");
    const toolbar = el("div", { class: "toolbar" }, this.undoBtn, this.redoBtn, dice, reset);
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Character tools");
    this.undoBtn.addEventListener("click", () => this.step("undo"));
    this.redoBtn.addEventListener("click", () => this.step("redo"));
    dice.addEventListener("click", () => this.commit(randomiseAll(this.spec, this.seedCounter++)));
    reset.addEventListener("click", () => this.commit({ ...this.initial }));

    // the preview pose (the 3D scene behind the sheet listens for the event; no other coupling)
    const poses = el("div", { class: "posebar" }, el("span", { class: "posehead", textContent: "Pose" }));
    poses.setAttribute("role", "radiogroup");
    poses.setAttribute("aria-label", "Preview pose");
    for (const p of POSES) {
      const b = el("button", { type: "button", textContent: p.label });
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => this.setPose(p.id));
      this.poseBtns.set(p.id, b);
      poses.append(b);
    }

    const tabs = el("div", { class: "tabs" });
    tabs.setAttribute("role", "tablist");
    for (const t of TABS) {
      const b = el("button", { type: "button", textContent: t.label });
      b.dataset.tab = t.id;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => this.select(t.id));
      tabs.append(b);
    }
    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.findIndex((t) => t.id === this.tab);
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length]!;
      this.select(next.id);
      tabs.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
      e.preventDefault();
    });

    this.body = el("div", { class: "fields" });
    this.body.setAttribute("role", "tabpanel");

    // look code: copy it out, paste it in
    this.codeInput = el("input", { type: "text", class: "codefield", spellcheck: false, autocomplete: "off", placeholder: "Paste a look code here" });
    this.codeInput.setAttribute("aria-label", "Look code");
    const copy = el("button", { type: "button", textContent: "Copy" });
    copy.title = "Copy this look's code";
    const paste = el("button", { type: "button", textContent: "Paste" });
    paste.title = "Paste a look code from the clipboard (or type it in the box and press Enter)";
    copy.addEventListener("click", () => void this.copyCode());
    paste.addEventListener("click", () => void this.pasteCode());
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.applyCode(this.codeInput.value);
    });
    this.codeInput.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text");
      if (text) {
        e.preventDefault();
        this.codeInput.value = text.trim();
        this.applyCode(text);
      }
    });
    const codebox = el("div", { class: "codebox" }, el("span", { class: "posehead", textContent: "Look code" }), this.codeInput, copy, paste);
    this.statusEl = el("p", { class: "status", role: "status" });
    this.statusEl.setAttribute("aria-live", "polite");

    root.append(el("h2", { textContent: "Particulars of the Bearer" }), toolbar, poses, tabs, this.body, codebox, this.statusEl);

    root.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if ((e.target as HTMLElement | null)?.tagName === "INPUT" && (e.target as HTMLInputElement).type === "text") return; // (the text box keeps its own undo)
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) this.step("undo");
      else if ((k === "z" && e.shiftKey) || k === "y") this.step("redo");
      else return;
      e.preventDefault();
    });

    this.select("types");
    this.setPose("turntable", false);
    this.refreshTools();
  }

  get current(): CharacterSpec {
    return { ...this.spec };
  }

  /** Replaces the look from outside (nothing is announced back to `onChange`). */
  setSpec(spec: CharacterSpec): void {
    this.spec = { ...spec };
    this.history.record(this.spec);
    this.refresh();
  }

  // ---- state changes ------------------------------------------------------------------------------------------------------------------------------

  /** Records a new look and shows it: one function for every way the look can change. `group` coalesces a drag on one control into one undo step. */
  private commit(next: CharacterSpec, group?: string): void {
    if (!this.history.record(next, group, performance.now())) return;
    this.spec = this.history.current;
    this.refresh();
    this.onChange(this.spec);
  }

  private step(which: "undo" | "redo"): void {
    const s = which === "undo" ? this.history.undo() : this.history.redo();
    if (!s) return;
    this.spec = s;
    this.refresh();
    this.onChange(this.spec);
    this.say(which === "undo" ? "Undone." : "Redone.");
  }

  private refresh(): void {
    for (const [key, show] of this.sync) show(this.spec[key as FieldKey]);
    this.codeInput.value = encodeSpec(this.spec);
    for (const { btn, index } of this.presetBtns) btn.setAttribute("aria-pressed", String(sameSpec(applyPreset(this.spec, PRESETS[index]!), this.spec)));
    this.refreshTools();
  }

  private refreshTools(): void {
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
  }

  private say(text: string, error = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("error", error);
  }

  private setPose(id: PoseId, announce = true): void {
    this.pose = id;
    for (const [pid, b] of this.poseBtns) {
      b.setAttribute("aria-checked", String(pid === id));
      b.tabIndex = pid === id ? 0 : -1;
    }
    if (announce) window.dispatchEvent(new CustomEvent(POSE_EVENT, { detail: id }));
  }

  private select(tab: Tab): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      b.tabIndex = b.dataset.tab === tab ? 0 : -1;
    });
    this.renderTab();
  }

  // ---- the look code ----------------------------------------------------------------------------------------------------------------------------

  private async copyCode(): Promise<void> {
    const code = encodeSpec(this.spec);
    this.codeInput.value = code;
    try {
      await navigator.clipboard.writeText(code);
      this.say("Look code copied. Anyone can paste it into their own creator.");
    } catch {
      this.codeInput.select();
      this.say("Your browser would not let the game use the clipboard: the code is selected, so press Ctrl+C.");
    }
  }

  private async pasteCode(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      this.codeInput.value = text.trim();
      this.applyCode(text);
    } catch {
      this.codeInput.focus();
      this.say("Your browser would not let the game read the clipboard: paste the code into the box (Ctrl+V) and press Enter.", true);
    }
  }

  private applyCode(text: string): void {
    const r = parseLookCode(text);
    if (!r.ok) {
      this.say(r.error, true);
      return;
    }
    this.commit(applyPasted(this.spec, r.spec));
    this.say(r.note ? `Look applied. ${r.note}` : "Look applied.");
  }

  // ---- the sheet -----------------------------------------------------------------------------------------------------------------------------------

  private renderTab(): void {
    this.body.replaceChildren();
    this.sync.clear();
    this.presetBtns = [];
    if (this.tab === "types") {
      this.renderPresets();
      this.refresh();
      return;
    }
    const order = SECTIONS[this.tab];
    let last = -1;
    for (const { section, field } of fieldsOfTab(this.tab)) {
      if (section !== last) {
        last = section;
        this.body.append(this.sectionHead(order[section]!.title, order[section]!.keys));
      }
      this.body.append(this.control(field));
    }
    this.refresh();
  }

  private renderPresets(): void {
    this.body.append(el("p", { class: "lead", textContent: "Begin from a type of person, then make them your own on the other pages." }));
    const grid = el("div", { class: "presets" });
    PRESETS.forEach((p, index) => {
      const b = el("button", { type: "button", class: "preset" }, el("b", { textContent: p.name }), el("span", { textContent: p.blurb }));
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        this.commit(applyPreset(this.spec, p));
        this.say(`${p.name} chosen. Adjust anything on the other pages.`);
      });
      this.presetBtns.push({ btn: b, index });
      grid.append(b);
    });
    this.body.append(grid);
  }

  private sectionHead(title: string, keys: readonly string[]): HTMLElement {
    const shuffle = el("button", { type: "button", class: "shuffle", textContent: "Shuffle" });
    shuffle.title = `Randomise only: ${title}`;
    shuffle.setAttribute("aria-label", `Randomise ${title}`);
    shuffle.addEventListener("click", () => {
      this.commit(randomiseKeys(this.spec, keys, this.seedCounter++));
      this.say(`${title}: shuffled. Undo brings the old ones back.`);
    });
    const h = el("h3", { class: "section", textContent: title });
    return el("div", { class: "section-head" }, h, shuffle);
  }

  private control(f: FieldDef): HTMLElement {
    const row = el("label", { class: "field" });
    row.append(el("span", { textContent: f.label }));
    const palette = PALETTES[f.key];
    if (palette) {
      // Colour swatches: colour-independent selection cue (outline + check), not colour alone.
      const wrap = el("div", { class: "swatches" });
      wrap.setAttribute("role", "radiogroup");
      wrap.setAttribute("aria-label", f.label);
      const swatches = palette.map((c, i) => {
        const b = el("button", { type: "button", class: "swatch" });
        b.style.background = hex(c);
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", `${f.label} ${i + 1} of ${palette.length}`);
        b.addEventListener("click", () => this.commit({ ...this.spec, [f.key]: i } as CharacterSpec));
        wrap.append(b);
        return b;
      });
      this.sync.set(f.key, (v) =>
        swatches.forEach((s, j) => {
          s.setAttribute("aria-checked", String(j === v));
          s.textContent = j === v ? "✓" : "";
        }),
      );
      row.append(wrap);
    } else if (f.kind === "slider") {
      const input = el("input", { type: "range", min: "0", max: String(f.max) });
      input.setAttribute("aria-label", f.label);
      input.addEventListener("input", () => this.commit({ ...this.spec, [f.key]: Number(input.value) } as CharacterSpec, f.key));
      this.sync.set(f.key, (v) => {
        if (Number(input.value) !== v) input.value = String(v);
      });
      row.append(input);
    } else if (f.options) {
      const sel = el("select");
      sel.setAttribute("aria-label", f.label);
      f.options.forEach((label, i) => sel.append(new Option(label, String(i))));
      sel.addEventListener("change", () => this.commit({ ...this.spec, [f.key]: Number(sel.value) } as CharacterSpec, f.key));
      this.sync.set(f.key, (v) => {
        sel.value = String(v);
      });
      row.append(sel);
    }
    return row;
  }
}
