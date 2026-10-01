import { wishlistUrl } from "@cb/shared";
export { INFO_ARG } from "./constants.ts";

/**
 * What the shell is configured with (D-036, package D). All of it comes from the process environment at run time, falling back to values baked in at BUILD time by
 * `scripts/build.mjs` (esbuild `define`), so a packaged app needs no environment at all. Nothing here is a secret: a server address, an https store page, three switches.
 * Every value is validated; anything malformed falls back to the safe default rather than throwing.
 */
declare const __CB_SERVER_URL__: string | undefined;
declare const __CB_WISHLIST_URL__: string | undefined;

/** The page protocol: the client is served from disk through `app://game/...` (a standard, secure scheme), never `file://`. */
export const APP_SCHEME = "app";
export const APP_HOST = "game";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY = `${APP_ORIGIN}/index.html`;

/** The hosted test server (docs/DEPLOYMENT.md). A configuration default, not a secret; override with `CB_SERVER_URL`. */
export const DEFAULT_SERVER_URL = "https://civilised-behaviour-server.onrender.com";

export type SteamMode = "off" | "stub" | "real";

export interface DesktopConfig {
  /** http(s) base URL of the game server (the renderer's own address for it is the same host over ws(s)). */
  serverUrl: string;
  /** An https store page, or undefined (the wishlist button then says "coming soon" and opens nothing). */
  wishlist: string | undefined;
  steam: SteamMode;
  updates: { enabled: boolean; feedUrl: string | undefined };
}

type Env = Readonly<Record<string, string | undefined>>;

/** `https://host[:port]` (no path, query, credentials) from an http(s)/ws(s) address, or undefined. */
export function normalizeServerUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 300) return undefined;
  try {
    const u = new URL(v.trim().replace(/^ws(s?):/i, "http$1:"));
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || !u.hostname) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

/** The origins the renderer may talk to: the server over http(s) and over ws(s) (matchmaking is HTTP, the room is a WebSocket). */
export function serverOrigins(serverUrl: string): string[] {
  const u = new URL(serverUrl);
  const ws = u.protocol === "https:" ? "wss:" : "ws:";
  return [u.origin, `${ws}//${u.host}`];
}

export function steamModeOf(env: Env): SteamMode {
  const v = (env.CB_STEAM ?? "").trim().toLowerCase();
  return v === "stub" ? "stub" : v === "real" ? "real" : "off";
}

export function loadConfig(env: Env): DesktopConfig {
  const baked = typeof __CB_SERVER_URL__ === "string" ? __CB_SERVER_URL__ : undefined;
  const bakedWish = typeof __CB_WISHLIST_URL__ === "string" ? __CB_WISHLIST_URL__ : undefined;
  const serverUrl = normalizeServerUrl(env.CB_SERVER_URL) ?? normalizeServerUrl(baked) ?? DEFAULT_SERVER_URL;
  const wishlist = wishlistUrl(env.CB_WISHLIST_URL) ?? wishlistUrl(bakedWish);
  const feedUrl = wishlistUrl(env.CB_UPDATE_FEED);
  return { serverUrl, wishlist, steam: steamModeOf(env), updates: { enabled: env.CB_UPDATES === "1" && feedUrl !== undefined, feedUrl } };
}
