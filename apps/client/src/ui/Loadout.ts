import { FOLLOWER_CAP } from "@cb/shared";
import type { Follower, Loadout } from "@cb/shared";
import { FOLLOWER_DEFS, wageDue } from "@cb/shared";
import { LOADOUT_ITEMS, loadWord, normalizeLoadout, stepLoadout, trimLoadout, validateLoadout, type LoadoutKey } from "@cb/shared";
import { moraleBand } from "@cb/shared";
import { Modal, h } from "./modal.ts";
import "./loadout.css";

/**
 * The manifest sheet at the supply pyramid: a field document. Ledger rows (item, weight, cost, stepper), a purse line, a weight gauge in WORDS (Light /
 * Laden / Full / Overloaded: colour is never the only signal), the hire list with temperament stamps, and a "Prepare" confirm stamp. It takes plain data
 * and callbacks, like Parley.ts: the server owns the manifest and the roster (`loadoutSet`, `hire` messages); this shows a view and reports intent.
 * Every string is set as text, never markup. Escape / pad B closes (the sheet's own close); the sheet is rebuilt from each `update`, keeping focus.
 */

export interface LoadoutView {
  loadout: Loadout;
  purse: number;
  /** Humans at the table (capacity is 30 kg each). */
  humans: number;
  roster: readonly Follower[];
  /** Today's candidates (`hirePool`), without anyone already hired. */
  pool: readonly Follower[];
}

export interface LoadoutCallbacks {
  /** The manifest changed (a stepper). The sheet also shows it at once; the next `update` is the server's truth. */
  set(l: Loadout): void;
  hire(id: string, on: boolean): void;
  /** "Prepare": the table is done. The sheet closes itself afterwards. */
  confirm(): void;
  /** The sheet was closed any other way (Escape, pad B, the backdrop). */
  close(): void;
}

const pounds = (n: number): string => `£${Math.max(0, Math.round(Number.isFinite(n) ? n : 0))}`;

export class LoadoutSheet {
  private readonly modal = new Modal("loadout", "loadout", "loadout-title");
  private readonly ledger = h("div", { class: "ledger", role: "group", "aria-label": "Stores" });
  private readonly summary = h("div", { class: "summary" });
  private readonly gauge = h("div", { class: "gauge", role: "group", "aria-label": "Weight" });
  private readonly problems = h("ul", { class: "problems", role: "status", "aria-live": "polite" });
  private readonly crew = h("div", { class: "crew", role: "group", "aria-label": "Hired hands" });
  private readonly status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  private view: LoadoutView | undefined;
  private cb: LoadoutCallbacks | undefined;
  private quiet = false;
  private confirmed = false;

  constructor(root: HTMLElement) {
    root.appendChild(this.modal.root);
    const prepare = h("button", { type: "button", class: "primary stamp", "data-k": "prepare" }, "Prepare");
    prepare.addEventListener("click", () => this.confirm());
    const leave = h("button", { type: "button", class: "small", "data-k": "leave" }, "Not yet");
    leave.addEventListener("click", () => this.modal.close());
    this.modal.panel.append(
      h("p", { class: "society" }, "Form 11-B: Stores & Persons"),
      h("h2", { id: "loadout-title" }, "Manifest"),
      h("p", { class: "tag" }, "Everything the Society will not be paying for, itemised so that it may later be disowned."),
      h("div", { class: "body" }, h("h3", {}, "Stores"), this.ledger, this.summary, this.gauge, this.problems, h("h3", {}, "Hired hands"), this.crew),
      this.status,
      h("div", { class: "row actions" }, leave, prepare),
    );
    this.modal.onClose = () => {
      if (!this.quiet && !this.confirmed) this.cb?.close();
      this.quiet = false;
    };
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(v: LoadoutView, cb: LoadoutCallbacks): void {
    this.cb = cb;
    this.confirmed = false;
    this.view = this.clean(v);
    this.render();
    this.modal.open();
  }

  /** The server's truth (a new manifest, a new roster, a new purse). */
  update(v: LoadoutView): void {
    this.view = this.clean(v);
    if (this.modal.isOpen) this.render();
  }

  /** The room closed the table (sailed, region change): the sheet goes without reporting back. */
  closeUi(): void {
    this.quiet = true;
    this.modal.close();
    this.quiet = false;
  }

  dispose(): void {
    this.closeUi();
    this.modal.root.remove();
    this.cb = undefined;
  }

  private clean(v: LoadoutView): LoadoutView {
    return {
      loadout: normalizeLoadout(v.loadout), purse: Number.isFinite(v.purse) ? Math.max(0, Math.floor(v.purse)) : 0, humans: Number.isFinite(v.humans) ? Math.max(1, Math.floor(v.humans)) : 1,
      roster: Array.isArray(v.roster) ? v.roster.slice(0, FOLLOWER_CAP) : [], pool: Array.isArray(v.pool) ? v.pool.slice(0, 6) : [],
    };
  }

  private confirm(): void {
    this.confirmed = true;
    this.cb?.confirm();
    this.modal.close();
  }

  private change(key: LoadoutKey, d: number): void {
    if (!this.view) return;
    const next = stepLoadout(this.view.loadout, key, d);
    this.view = { ...this.view, loadout: next };
    this.cb?.set(next);
    this.render();
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const ctx = { purse: v.purse, humans: v.humans, roster: v.roster };
    const check = validateLoadout(v.loadout, ctx);

    this.ledger.replaceChildren(
      h("div", { class: "lrow head", "aria-hidden": "true" }, h("span", {}, "Item"), h("span", { class: "num" }, "kg"), h("span", { class: "num" }, "£"), h("span", {}, "Count")),
      ...LOADOUT_ITEMS.map((it) => {
        const n = it.key === "wagon" ? (v.loadout.wagon ? 1 : 0) : (v.loadout[it.key] as number);
        const minus = h("button", { type: "button", class: "step", "data-k": `${it.key}-`, "aria-label": `Fewer: ${it.name}`, disabled: n <= 0 }, "−");
        const plus = h("button", { type: "button", class: "step", "data-k": `${it.key}+`, "aria-label": `More: ${it.name}`, disabled: n >= it.max }, "+");
        minus.addEventListener("click", () => this.change(it.key, -1));
        plus.addEventListener("click", () => this.change(it.key, 1));
        return h(
          "div",
          { class: "lrow", "data-item": it.key },
          h("span", { class: "item" }, h("span", { class: "name" }, it.name), h("span", { class: "note" }, it.note)),
          h("span", { class: "num", "aria-label": it.kg > 0 ? `${it.kg} kilograms each` : "no weight" }, it.kg > 0 ? String(it.kg) : "–"),
          h("span", { class: "num", "aria-label": `${it.cost} pounds each` }, String(it.cost)),
          h("span", { class: "count" }, minus, h("output", { "aria-label": `${it.name} count` }, it.key === "wagon" ? (n ? "Yes" : "No") : String(n)), plus),
        );
      }),
    );

    const word = loadWord(check.weight, check.capacity);
    const pct = check.capacity > 0 ? Math.min(100, Math.round((check.weight / check.capacity) * 100)) : 100;
    this.summary.replaceChildren(
      h("p", { class: "line" }, h("span", {}, "Purse"), h("b", {}, pounds(v.purse))),
      h("p", { class: "line" }, h("span", {}, "Manifest"), h("b", {}, pounds(check.cost))),
      h("p", { class: "line total" }, h("span", {}, "Left after sailing"), h("b", {}, check.cost > v.purse ? `−${pounds(check.cost - v.purse)}` : pounds(v.purse - check.cost))),
    );
    const bar = h("div", { class: "bar", "data-word": word });
    bar.style.setProperty("--fill", `${pct}%`);
    this.gauge.replaceChildren(
      h("p", { class: "line" }, h("span", {}, "Load"), h("b", { class: "word", "data-word": word }, word), h("span", { class: "kg" }, `${check.weight} of ${check.capacity} kg`)),
      bar,
    );

    this.problems.replaceChildren(...check.problems.map((p) => h("li", {}, p)));
    const trim = trimLoadout(v.loadout, ctx);
    this.status.textContent = trim.dropped > 0 ? `At the quay: ${trim.lines.join(" ")}` : "Charged when the ship leaves. Cancel is free; the Society only bills for ambition it can see.";

    const hired = h(
      "div",
      { class: "list roster" },
      ...(v.roster.length === 0 ? [h("p", { class: "empty" }, "Nobody is on the books. A party of one is a party of one.")] : v.roster.map((f) => this.hand(f, true, v))),
    );
    const open = v.pool.filter((p) => !v.roster.some((r) => r.id === p.id));
    const cands = h(
      "div",
      { class: "list pool" },
      h("p", { class: "sub" }, `Waiting at the quay today (${v.roster.length} of ${FOLLOWER_CAP} places filled)`),
      ...(open.length === 0 ? [h("p", { class: "empty" }, "The quay is empty. Everybody sensible has gone home.")] : open.map((f) => this.hand(f, false, v))),
    );
    this.crew.replaceChildren(hired, cands);

    if (focusKey) {
      const live = [...this.modal.panel.querySelectorAll<HTMLElement>("[data-k]")].filter((el) => !el.hasAttribute("disabled"));
      // a stepper that has just reached its limit hands focus to its twin, so a held key or a pad press is never dropped on the floor
      const twin = focusKey.endsWith("+") ? `${focusKey.slice(0, -1)}-` : focusKey.endsWith("-") ? `${focusKey.slice(0, -1)}+` : "";
      (live.find((el) => el.dataset.k === focusKey) ?? live.find((el) => el.dataset.k === twin))?.focus();
    }
  }

  private hand(f: Follower, onBooks: boolean, v: LoadoutView): HTMLElement {
    const d = FOLLOWER_DEFS[f.kind];
    const band = moraleBand(f.morale);
    const btn = h("button", { type: "button", class: onBooks ? "small" : "small sign", "data-k": `${onBooks ? "dismiss" : "hire"}-${f.id}`, "aria-label": `${onBooks ? "Dismiss" : "Sign"} ${f.name}` }, onBooks ? "Dismiss" : `Sign ${pounds(f.wage)}`);
    const cannot = !onBooks && (v.purse < f.wage || v.roster.length >= FOLLOWER_CAP);
    if (cannot) {
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("cant");
      btn.addEventListener("click", () => { this.status.textContent = v.roster.length >= FOLLOWER_CAP ? `The party already has ${FOLLOWER_CAP} hands.` : `${f.name}'s signing fee is ${pounds(f.wage)}.`; });
    } else btn.addEventListener("click", () => this.cb?.hire(f.id, !onBooks));
    const facts: string[] = [`${d.title}`, `wage ${pounds(f.wage)}`];
    if (onBooks) {
      facts.push(`nerve ${band}`, `loyalty ${f.loyalty}`);
      if (f.owed > 0) facts.push(`owed ${pounds(f.owed)}`);
      if (f.wounded > 0) facts.push(`laid up ${f.wounded}`);
      else facts.push(`next wage ${pounds(wageDue(f))}`);
    } else facts.push(`bravery ${f.bravery}`);
    return h(
      "div",
      { class: "hand", "data-hand": f.id },
      h("span", { class: "stamp-tag", "data-kind": f.kind }, d.stamp),
      h("span", { class: "who" }, h("span", { class: "name" }, f.name), h("span", { class: "facts" }, facts.join(" · ")), h("span", { class: "note" }, onBooks ? d.blurb : d.hireLines[(f.lookSeed >>> 0) % d.hireLines.length]!)),
      btn,
    );
  }
}
