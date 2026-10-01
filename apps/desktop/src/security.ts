import { wishlistUrl } from "@cb/shared";
import { APP_HOST, APP_SCHEME, serverOrigins } from "./config.ts";

/**
 * The shell's policy, in one testable place (D-036, package D): what the page may load (CSP), what it may ask the OS for (nothing, but its own pointer lock and full screen), where
 * it may go (nowhere: no navigation, no new window, no webview; the one https wish-list page opens in the system browser, never in the game's window) and what it may fetch.
 */
export function buildCsp(serverUrl: string): string {
  const net = serverOrigins(serverUrl).join(" ");
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    // inline STYLE attributes only (the interface sets element styles); no inline or remote script, ever
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${net}`,
    "worker-src 'self' blob:",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const APP_URL = new RegExp(`^${APP_SCHEME}://${APP_HOST}(/|$)`);
export const isAppUrl = (u: unknown): boolean => typeof u === "string" && APP_URL.test(u);

/** The only permissions the game page is given, to the page's own origin and nobody else: the mouse look it is built on and full screen. Everything else is refused. */
export const ALLOWED_PERMISSIONS: readonly string[] = ["pointerLock", "fullscreen"];
export const permissionAllowed = (permission: unknown, requestingUrl: unknown): boolean => typeof permission === "string" && ALLOWED_PERMISSIONS.includes(permission) && isAppUrl(requestingUrl);

/** May a request go out at all? The app itself, inline data/blob, the dev tools when unpackaged, and the configured server (http(s) and ws(s)). Nothing else on the internet. */
export function requestAllowed(url: unknown, serverUrl: string, packaged: boolean): boolean {
  if (typeof url !== "string") return false;
  if (isAppUrl(url) || url.startsWith("data:") || url.startsWith("blob:")) return true;
  if (!packaged && url.startsWith("devtools://")) return true;
  const origins = serverOrigins(serverUrl);
  return origins.some((o) => url === o || url.startsWith(`${o}/`) || url.startsWith(`${o}?`));
}

export interface SessionLike {
  setPermissionRequestHandler(h: ((wc: unknown, permission: string, cb: (granted: boolean) => void, details?: { requestingUrl?: string }) => void) | null): void;
  setPermissionCheckHandler(h: ((wc: unknown, permission: string, requestingOrigin: string, details?: { requestingUrl?: string }) => boolean) | null): void;
  setDevicePermissionHandler?(h: (details: unknown) => boolean): void;
  webRequest: {
    onHeadersReceived(h: (details: { responseHeaders?: Record<string, string[] | string> }, cb: (r: { responseHeaders: Record<string, string[] | string> }) => void) => void): void;
    onBeforeRequest(h: (details: { url: string }, cb: (r: { cancel: boolean }) => void) => void): void;
  };
}

/** Installs the session-wide rules: CSP on every response, deny-by-default permissions, and the request filter. */
export function installSessionSecurity(ses: SessionLike, serverUrl: string, packaged: boolean): void {
  const csp = buildCsp(serverUrl);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permissionAllowed(permission, details?.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => permissionAllowed(permission, details?.requestingUrl ?? origin));
  ses.setDevicePermissionHandler?.(() => false);
  ses.webRequest.onHeadersReceived((details, cb) => {
    const headers: Record<string, string[] | string> = {};
    for (const [k, v] of Object.entries(details.responseHeaders ?? {})) if (k.toLowerCase() !== "content-security-policy") headers[k] = v;
    headers["Content-Security-Policy"] = [csp];
    cb({ responseHeaders: headers });
  });
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !requestAllowed(details.url, serverUrl, packaged) }));
}

export interface ContentsLike {
  on(event: string, listener: (e: { preventDefault(): void }, ...rest: unknown[]) => void): unknown;
  setWindowOpenHandler(h: (details: { url: string }) => { action: "deny" }): void;
}

/**
 * Every web contents the app ever creates goes through this: no navigation (not even a redirect), no webview, no new window. A window.open to the configured wish-list URL (and only
 * that, exactly) is handed to the system browser through `openExternal`; anything else is dropped.
 */
export function guardContents(wc: ContentsLike, opts: { wishlist: string | undefined; openExternal(url: string): void }): void {
  const block = (e: { preventDefault(): void }): void => e.preventDefault();
  // The game's own "Leave", the wish-list card's close and an invite all reload the page with `location.assign("/index.html?...")`: a navigation to the app's OWN origin. That
  // is allowed (the protocol handler serves nothing but the built client); a navigation anywhere else, and every redirect, is cancelled. Electron puts the target on `event.url`.
  const toApp = (e: { preventDefault(): void; url?: unknown }, ...rest: unknown[]): void => {
    const url = typeof e.url === "string" ? e.url : rest[0];
    if (!isAppUrl(url)) e.preventDefault();
  };
  wc.on("will-navigate", toApp as never);
  wc.on("will-frame-navigate", toApp as never);
  wc.on("will-redirect", block);
  wc.on("will-attach-webview", block);
  wc.setWindowOpenHandler(({ url }) => {
    const ok = opts.wishlist !== undefined && wishlistUrl(url) === opts.wishlist;
    if (ok) opts.openExternal(opts.wishlist!);
    return { action: "deny" };
  });
}
