declare const __APP_VERSION__: string;
/** D-036: the bounded web demo. `true` only in a build made with `VITE_DEMO=1` (a CONFIGURATION of the one game; the server enforces the policy, the client only shows it). */
declare const __DEMO__: boolean;
/** D-036: the wish-list page, from `VITE_WISHLIST_URL` at build time. Empty unless it is a valid https URL (vite.config.ts validates it with the shared `wishlistUrl`). */
declare const __WISHLIST_URL__: string;
/** D-036: true in the desktop shell's client build (`vite build --mode desktop`): relative asset paths, loaded from disk through the `app://` protocol. */
declare const __DESKTOP__: boolean;
