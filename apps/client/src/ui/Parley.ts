import { REGION_COPY, type ParleyView, type RegionId } from "@cb/shared";
import { typeset } from "./typeset.ts";
import { playSfx } from "../audio/index.ts";
import { Modal, h } from "./modal.ts";
import { sheetHints } from "./sheetHints.ts";
import "./parley.css";

/**
 * The parley sheet: the Lamp-Warden's line, the toll she is asking, and the options the server offered this round. The server owns the talks
 * (Scenario + negotiation.ts); this shows a view and sends `pick(i)` or `close()`. Every string is set as text, never markup. Keys 1-9 pick
 * an option; Escape / pad B walks away (the sheet's own close). Focus is trapped like every other sheet.
 */
export class Parley {
  private readonly modal = new Modal("parley", "parley", "parley-title");
  private readonly society = h("p", { class: "society" }, "An audience at the toll bar");
  private readonly speaker = h("h2", { id: "parley-title" });
  private readonly line = h("p", { class: "line", role: "status", "aria-live": "polite" });
  private readonly meta = h("p", { class: "meta" });
  private readonly options = h("div", { class: "options", role: "group", "aria-label": "Your reply" });
  /** Where the talks are held: the heading and the asked line follow the place (Kessar's toll bar, Highmark's court). */
  private region: RegionId = "kessar";
  private pick: ((i: number) => void) | undefined;
  private close: (() => void) | undefined;
  private quiet = false;
  private count = 0;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.modal.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= this.count) {
      e.preventDefault();
      this.choose(n - 1);
    }
  };

  constructor(root: HTMLElement) {
    root.appendChild(this.modal.root);
    this.modal.panel.append(this.society, this.speaker, this.line, this.meta, this.options, sheetHints({ choose: "Choose", close: "Walk away" }).el);
    this.modal.onClose = () => {
      if (!this.quiet) this.close?.();
      this.quiet = false;
    };
    window.addEventListener("keydown", this.onKey);
  }

  /** An option taken (a click or its number key): the deal is stamped, then the server hears of it. */
  private choose(i: number): void {
    playSfx("parley_stamp");
    this.pick?.(i);
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(v: ParleyView, pick: (i: number) => void, close: () => void, region: RegionId = "kessar"): void {
    this.region = region;
    this.pick = pick;
    this.close = close;
    this.render(v);
    this.modal.open();
  }

  /** The next round (or a re-read of this one). */
  update(v: ParleyView): void {
    if (this.modal.isOpen) this.render(v);
  }

  /** The server ended the talks: the sheet goes without telling the server again. */
  closeUi(): void {
    this.quiet = true;
    this.modal.close();
    this.quiet = false;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.closeUi();
    this.modal.root.remove();
    this.pick = this.close = undefined;
  }

  private render(v: ParleyView): void {
    this.speaker.textContent = String(v.speaker ?? "");
    this.line.textContent = typeset(String(v.line ?? ""));
    const toll = Number.isFinite(v.toll) ? Math.max(0, Math.round(v.toll)) : 0;
    const round = Math.max(1, v.round | 0);
    const mood = String(v.mood ?? "neutral");
    // (the court asks a price, not a toll, and nobody there is a "she")
    const court = this.region === "highmark";
    const own = REGION_COPY[this.region]?.parley;   // D-037: the later regions author their own heading and asked line (shared/vesperText.ts, saltmarketText.ts)
    this.society.textContent = own ? own.heading : court ? "An audience at court" : "An audience at the toll bar";
    this.meta.textContent = own ? own.asked.replace(/\{price\}/g, String(toll)).replace(/\{round\}/g, String(round)).replace(/\{mood\}/g, mood)
      : court ? `Price asked: £${toll}   Round ${round}   The court seems ${mood}.` : `Toll asked: £${toll}   Round ${round}   She seems ${mood}.`;
    const focused = this.options.querySelector<HTMLElement>("button:focus")?.dataset.i;
    this.options.replaceChildren();
    const list = Array.isArray(v.options) ? v.options.slice(0, 9) : [];
    this.count = list.length;
    list.forEach((o, i) => {
      const b = h(
        "button",
        { type: "button", class: "opt", "data-i": String(i) },
        h("span", { class: "key kb-only", "aria-hidden": "true" }, String(i + 1)), // (the number keys are a keyboard thing: a pad moves focus and presses the confirm control)
        h("span", { class: "label" }, String(o.label ?? "")),
        Number(o.cost) > 0 ? h("span", { class: "cost" }, `£${Math.round(Number(o.cost))}`) : null,
        h("span", { class: "hint" }, typeset(String(o.hint ?? ""))),
      );
      b.addEventListener("click", () => this.choose(i));
      this.options.appendChild(b);
    });
    (this.options.querySelector<HTMLElement>(`button[data-i="${focused ?? 0}"]`) ?? this.options.querySelector<HTMLElement>("button"))?.focus();
  }
}
