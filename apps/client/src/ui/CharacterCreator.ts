import { FIELDS, PALETTES, rerollAppearance, type CharacterSpec, type FieldDef, type FieldKey } from "@cb/procedural";

type Tab = "body" | "face" | "clothes" | "colour";
const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "face", label: "Face" },
  { id: "clothes", label: "Attire" },
  { id: "colour", label: "Colours" },
];

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/**
 * Character creator form, generated from the spec's field metadata: adding an option to the catalog adds a
 * control here with no UI code. Campaign-owned history fields are deliberately absent (the server ignores
 * them anyway; see applyClientAppearance).
 */
export class CharacterCreator {
  private spec: CharacterSpec;
  private tab: Tab = "body";
  private readonly body: HTMLElement;
  private seedCounter = Math.floor(Math.random() * 1e6);

  constructor(
    private readonly root: HTMLElement,
    private readonly initial: CharacterSpec,
    private readonly onChange: (spec: CharacterSpec) => void,
  ) {
    this.spec = { ...initial };
    root.classList.add("creator");
    root.innerHTML = `
      <h2>Particulars of the Bearer</h2>
      <div class="tabs" role="tablist"></div>
      <div class="fields" role="tabpanel"></div>
      <div class="row actions">
        <button type="button" data-act="dice" title="Randomise appearance">Randomise</button>
        <button type="button" data-act="reset">Reset</button>
      </div>`;
    const tabs = root.querySelector<HTMLElement>(".tabs")!;
    for (const t of TABS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.label;
      b.dataset.tab = t.id;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => this.select(t.id));
      tabs.appendChild(b);
    }
    this.body = root.querySelector<HTMLElement>(".fields")!;
    root.querySelector('[data-act="dice"]')!.addEventListener("click", () => {
      this.spec = rerollAppearance(this.spec, this.seedCounter++);
      this.render();
      this.onChange(this.spec);
    });
    root.querySelector('[data-act="reset"]')!.addEventListener("click", () => {
      this.spec = { ...this.initial };
      this.render();
      this.onChange(this.spec);
    });
    this.select("body");
  }

  get current(): CharacterSpec {
    return { ...this.spec };
  }

  setSpec(spec: CharacterSpec): void {
    this.spec = { ...spec };
    this.render();
  }

  private select(tab: Tab): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    this.render();
  }

  private fieldsForTab(): FieldDef[] {
    const group = this.tab === "clothes" ? ["clothes"] : this.tab === "face" ? ["face"] : this.tab === "colour" ? ["colour"] : ["body"];
    return (FIELDS as readonly FieldDef[]).filter((f) => group.includes(f.group));
  }

  private render(): void {
    this.body.replaceChildren();
    for (const f of this.fieldsForTab()) this.body.appendChild(this.control(f));
  }

  private set(key: string, value: number): void {
    this.spec = { ...this.spec, [key]: value } as CharacterSpec;
    this.onChange(this.spec);
  }

  private control(f: FieldDef): HTMLElement {
    const row = document.createElement("label");
    row.className = "field";
    const name = document.createElement("span");
    name.textContent = f.label;
    row.appendChild(name);
    const value = this.spec[f.key as FieldKey];

    const palette = PALETTES[f.key];
    if (palette) {
      // Colour swatches: colour-independent selection cue (outline + check), not colour alone.
      const wrap = document.createElement("div");
      wrap.className = "swatches";
      wrap.setAttribute("role", "radiogroup");
      palette.forEach((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch";
        b.style.background = hex(c);
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(i === value));
        b.setAttribute("aria-label", `${f.label} ${i + 1}`);
        if (i === value) b.textContent = "✓";
        b.addEventListener("click", () => {
          this.set(f.key, i);
          wrap.querySelectorAll<HTMLButtonElement>(".swatch").forEach((s, j) => {
            s.setAttribute("aria-checked", String(j === i));
            s.textContent = j === i ? "✓" : "";
          });
        });
        wrap.appendChild(b);
      });
      row.appendChild(wrap);
    } else if (f.kind === "slider") {
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = String(f.max);
      input.value = String(value);
      input.addEventListener("input", () => this.set(f.key, Number(input.value)));
      row.appendChild(input);
    } else if (f.options) {
      const sel = document.createElement("select");
      f.options.forEach((label, i) => sel.appendChild(new Option(label, String(i), false, i === value)));
      sel.addEventListener("change", () => this.set(f.key, Number(sel.value)));
      row.appendChild(sel);
    }
    return row;
  }
}
