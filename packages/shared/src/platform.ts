import { isValidJoinCode } from "./protocol.ts";
import type { RegionId } from "./campaignTypes.ts";

/**
 * The platform seam (D-036, package D): everything the game wants from a storefront (achievements, rich presence, invites) behind ONE interface, so Steam is a
 * plug-in that can be absent. Three implementations: this file's `createNoopPlatform` (web, the default), the desktop's feature-flagged stub (`CB_STEAM=stub`:
 * logs and records calls, proves the wiring end to end with no App ID) and, much later, the real Steamworks one (needs an App ID, which does not exist). The renderer never
 * sees a Steam id, a ticket or a key: it sees only this interface, through the preload's narrow bridge (`DesktopBridge`). An invite is mapped to the game's own join code,
 * so no join logic is Steam-specific.
 */

/** Achievement ids (append-only; the storefront's own table is configured by hand later). Unlock rules are package D's `achievements.ts`, from campaign state only. */
export const ACHIEVEMENTS = [
  "first_crossing", "paid_in_full", "bridge_down", "rescued_quim", "wagon_taken", "border_mediated", "outpost_founded", "town_by_neglect", "steam_launch", "all_powers_met",
  "chair_settled", "four_at_once",
] as const;
export type AchievementId = (typeof ACHIEVEMENTS)[number];
export const isAchievementId = (v: unknown): v is AchievementId => typeof v === "string" && (ACHIEVEMENTS as readonly string[]).includes(v);

/** What the player is doing, as plain data (the storefront's text is made from it by `presenceText`, authored in package D's `platformCopy.ts`). */
export interface PresenceState {
  where: "menu" | "hq" | "sailing" | "region";
  region?: RegionId;
  /** Players in the party now (1..4). */
  party: number;
  /** Campaign day (>= 1) or 0 when unknown. */
  day: number;
  /** The join code of the room when it is joinable; the invite connect string is made from it. Never anything else about the room. */
  joinCode?: string;
}

/** An accepted invite (a friend clicked Join Game in the overlay, or launched the app with a connect argument): it carries ONLY a join code. */
export interface InviteRequest { joinCode: string }

export interface PlatformAdapter {
  readonly kind: "web" | "steam-stub" | "steam";
  /** False = every call below is a no-op (the web build, or Steam not running). Callers never need to branch on it. */
  readonly available: boolean;
  init(): Promise<boolean>;
  /** Idempotent: unlocking twice is harmless. Unknown ids are ignored. */
  unlock(id: AchievementId): void;
  setPresence(p: PresenceState): void;
  /** Returns the unsubscribe. The callback is only ever given a VALID join code. */
  onInvite(cb: (r: InviteRequest) => void): () => void;
  shutdown(): void;
}

/** The web implementation: does nothing, safely. */
export function createNoopPlatform(): PlatformAdapter {
  return { kind: "web", available: false, init: async () => false, unlock: () => {}, setPresence: () => {}, onInvite: () => () => {}, shutdown: () => {} };
}

/**
 * The connect string a storefront stores in rich presence, and its inverse. `connectString("ABCDE")` is `+join ABCDE`; `parseConnect` accepts that, a bare code, or a command
 * line array, and returns a join code ONLY if it is valid (anything else, however clever, is undefined).
 */
export const connectString = (joinCode: string): string | undefined => (isValidJoinCode(joinCode) ? `+join ${joinCode}` : undefined);
export function parseConnect(input: unknown): string | undefined {
  const parts = Array.isArray(input) ? input : typeof input === "string" ? input.trim().split(/\s+/) : [];
  for (let i = 0; i < parts.length && i < 64; i++) {
    const p = parts[i];
    if (typeof p !== "string") continue;
    if (p === "+join" && isValidJoinCode(parts[i + 1])) return parts[i + 1] as string;
    if (isValidJoinCode(p)) return p;
  }
  return undefined;
}

/**
 * The renderer's whole view of the desktop shell (`window.cbDesktop`, set by the preload with contextBridge). Narrow on purpose: no `ipcRenderer`, no `require`, no
 * arbitrary channel. The main process answers ONLY the channels named in `DESKTOP_CHANNELS` and validates every argument.
 */
export const DESKTOP_CHANNELS = ["app:info", "platform:init", "platform:unlock", "platform:presence", "platform:invite", "shell:wishlist", "app:quit"] as const;
export type DesktopChannel = (typeof DESKTOP_CHANNELS)[number];
export interface DesktopInfo { version: string; platform: "win32" | "darwin" | "linux"; packaged: boolean; steam: PlatformAdapter["kind"]; updates: "off" | "on" }
export interface DesktopBridge {
  readonly info: DesktopInfo;
  platform: PlatformAdapter;
  /** Opens the configured wishlist page in the system browser (https only, from build configuration; a no-op when none is configured). */
  openWishlist(): void;
  quit(): void;
}
declare global {
  interface Window { cbDesktop?: DesktopBridge }
}
