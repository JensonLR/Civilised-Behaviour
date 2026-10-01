import type { Paper } from "@cb/shared";
import { playSfx } from "../audio/index.ts";
import { Modal, h } from "./modal.ts";
import "./newspaper.css";

/**
 * The broadsheet pinned to the notice board at HQ. `generatePaper` (shared, deterministic) writes it from the campaign; this only sets it in type.
 * Every string goes in as text. A sheet like the others: focus trapped, Escape / pad B close, the game's controls held off while it is up.
 */
export class NewspaperView {
  private readonly modal = new Modal("paper", "paper", "paper-masthead");
  private readonly body = h("div", { class: "sheetbody" });
  private onClose: (() => void) | undefined;
  private quiet = false;

  constructor(root: HTMLElement) {
    root.appendChild(this.modal.root);
    this.modal.panel.append(this.body, h("div", { class: "actions" }, h("button", { type: "button", "data-autofocus": true, onclick: () => this.modal.close() }, "Fold it away")));
    this.modal.onClose = () => {
      const cb = this.onClose;
      this.onClose = undefined;
      if (!this.quiet) cb?.();
      this.quiet = false;
    };
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  show(p: Paper, onClose: () => void): void {
    this.onClose = onClose;
    const stories = Array.isArray(p.stories) ? p.stories : [];
    const notices = Array.isArray(p.notices) ? p.notices : [];
    this.body.replaceChildren(
      h("h2", { id: "paper-masthead", class: "masthead" }, String(p.masthead ?? "")),
      h("p", { class: "dateline" }, `Edition ${Math.max(1, Number(p.edition) | 0)}  —  ${String(p.dateline ?? "")}`),
      h("h3", { class: "headline" }, String(p.headline ?? "")),
      h("p", { class: "standfirst" }, String(p.standfirst ?? "")),
      h("div", { class: "columns" }, ...stories.map((s) => h("article", {}, h("h4", {}, String(s.head ?? "")), h("p", { class: "slug" }, String(s.slug ?? "")), h("p", {}, String(s.body ?? ""))))),
      ...(notices.length ? [h("ul", { class: "notices", "aria-label": "Notices" }, ...notices.map((n) => h("li", {}, String(n))))] : []),
    );
    playSfx("paper_rustle"); // the broadsheet is unfolded
    this.modal.open();
  }

  hide(): void {
    this.quiet = true;
    this.modal.close();
    this.quiet = false;
  }

  dispose(): void {
    this.hide();
    this.modal.root.remove();
  }
}
