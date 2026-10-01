import { wishlistUrl } from "@cb/shared";
import { Modal, h } from "./modal.ts";
import { WISHLIST_BACK, WISHLIST_BODY, WISHLIST_BUTTON, WISHLIST_SOON, WISHLIST_TAG, WISHLIST_TITLE } from "./demoCopy.ts";
import "./demo.css";

export interface WishlistOptions {
  /** The configured store URL (the build's `VITE_WISHLIST_URL`). Only an https URL ever produces a button; anything else shows "coming soon" and no link. */
  url?: string;
  /** How the link is opened. Default: the desktop bridge's `openWishlist` if present, else a new tab with no opener. Tests inject their own. */
  open?: (url: string) => void;
  /** The card was closed (Escape, pad B, the back button, the backdrop): the caller returns to the front door. */
  onClose?: () => void;
}

/**
 * The card a demo ends on (D-036, package D): a wish-list call to action when the store page is configured, an honest "coming soon" with no link when it is not. It is a `Modal` like every
 * other sheet, so Escape, pad B, the focus trap and the held controls come for free. All copy is set as text, never markup.
 */
export class Wishlist {
  private readonly modal: Modal;
  readonly url: string | undefined;

  constructor(opts: WishlistOptions = {}) {
    this.url = wishlistUrl(opts.url);
    this.modal = new Modal("wishlist", "wishlist", "wishlist-title");
    const open =
      opts.open ??
      ((u: string) => {
        const bridge = (window as { cbDesktop?: { openWishlist?: () => void } }).cbDesktop;
        if (bridge && typeof bridge.openWishlist === "function") bridge.openWishlist();
        else window.open(u, "_blank", "noopener,noreferrer");
      });
    const back = h("button", { type: "button", class: this.url ? "back" : "back primary", "data-autofocus": this.url ? undefined : true, onclick: () => this.modal.close() }, WISHLIST_BACK);
    const actions = h("div", { class: "actions" });
    if (this.url) {
      const url = this.url;
      actions.append(h("button", { type: "button", class: "primary go", "data-autofocus": true, onclick: () => open(url) }, WISHLIST_BUTTON), back);
    } else {
      actions.append(back);
    }
    const title = h("h2", { id: "wishlist-title" }, WISHLIST_TITLE);
    this.modal.panel.append(title, h("p", { class: "tag caps" }, WISHLIST_TAG), ...WISHLIST_BODY.map((t) => h("p", { class: "body-line" }, t)));
    if (!this.url) this.modal.panel.append(h("p", { class: "soon" }, WISHLIST_SOON));
    this.modal.panel.append(actions);
    this.modal.onClose = () => opts.onClose?.();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }
  show(): void {
    this.modal.open();
  }
  close(): void {
    this.modal.close();
  }
  dispose(): void {
    this.modal.close();
    this.modal.root.remove();
  }
}
