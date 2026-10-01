/**
 * The build's three compile-time switches (D-036), read through one door so a unit test (no Vite `define`) or a showcase never throws on an undeclared global.
 * `demo`: the bounded web demo (the SERVER enforces it; the client only shows it). `desktop`: loaded from disk by the Electron shell. `wishlistUrl`: an https URL or "".
 */
export const isDemo = (): boolean => typeof __DEMO__ !== "undefined" && __DEMO__ === true;
export const isDesktop = (): boolean => typeof __DESKTOP__ !== "undefined" && __DESKTOP__ === true;
export const wishlistLink = (): string => (typeof __WISHLIST_URL__ === "string" ? __WISHLIST_URL__ : "");
