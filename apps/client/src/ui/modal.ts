/**
 * Shared behaviour of every full-screen sheet (settings, pause, how to play): a dimmed layer with one panel, focus moved in and trapped,
 * Escape / pad B to close, the pointer released, and the game's controls held off while it is up (the world keeps running for everyone else).
 * A stack means Escape closes only the top sheet, and the pause screen can tell that another sheet is open.
 */
import { startPadNav } from "./PadNav.ts";

const stack: Modal[] = [];
const holds = new Set<symbol>();
const listeners = new Set<(blocked: boolean) => void>();

/** True while any sheet is open. */
export const anyModalOpen = (): boolean => stack.length > 0;

/** Something (a modal, the pause screen) wants the game's controls off. Returns the function that lets go. */
export function holdInput(): () => void {
  const key = Symbol("hold");
  holds.add(key);
  for (const l of listeners) l(true);
  return () => {
    holds.delete(key);
    if (holds.size === 0) for (const l of listeners) l(false);
  };
}
/** Subscribes to "controls should be blocked" (true while any hold exists). */
export function onInputBlocked(fn: (blocked: boolean) => void): () => void {
  listeners.add(fn);
  fn(holds.size > 0);
  return () => listeners.delete(fn);
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

export class Modal {
  readonly root: HTMLDivElement;
  readonly panel: HTMLElement;
  onClose: (() => void) | undefined;
  private opener: HTMLElement | null = null;
  private release: (() => void) | undefined;
  /** Set while a child (a key-capture prompt) needs Escape for itself. */
  escapeBusy = false;

  constructor(id: string, panelClass: string, labelledBy: string) {
    this.root = document.createElement("div");
    this.root.id = `sheet-${id}`;
    this.root.className = "overlay";
    this.root.hidden = true;
    this.panel = document.createElement("div");
    this.panel.className = `panel sheet ${panelClass}`;
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-labelledby", labelledBy);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    // Escape closes the top sheet (capture, so the pause screen's own Escape handler never also fires).
    window.addEventListener(
      "keydown",
      (e) => {
        if (stack[stack.length - 1] !== this) return;
        if (e.key === "Escape" && !this.escapeBusy) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        } else if (e.key === "Tab") {
          this.trap(e);
        }
      },
      true,
    );
    this.root.addEventListener("padback", () => {
      if (stack[stack.length - 1] === this && !this.escapeBusy) this.close();
    });
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this.close(); // a click on the dimmed backdrop
    });
    startPadNav(this.root, () => !this.root.hidden && stack[stack.length - 1] === this);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(opener?: HTMLElement | null): void {
    if (this.isOpen) return;
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.root.hidden = false;
    stack.push(this);
    this.release = holdInput();
    document.exitPointerLock?.();
    const target = this.panel.querySelector<HTMLElement>("[data-autofocus]") ?? this.panel.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    this.release?.();
    this.release = undefined;
    const back = this.opener;
    this.opener = null;
    if (back && document.contains(back) && !back.closest("[hidden]")) back.focus();
    this.onClose?.();
  }

  private trap(e: KeyboardEvent): void {
    const items = [...this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (!this.panel.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/** Small DOM builder used by the sheets: `h("button", {class:"x", onclick}, "text", child...)`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | number | ((e: Event) => void) | undefined> = {}, ...kids: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}
