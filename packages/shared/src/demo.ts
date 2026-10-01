import type { RegionId } from "./campaignTypes.ts";

/**
 * The bounded web DEMO (D-036, package D; docs/_notes/ship.md section 3). A demo is a CONFIGURATION of the one game, never a fork: the same server and client builds, two
 * switches (server `DEMO_MODE=1`, client build `VITE_DEMO=1`), and a policy that the SERVER enforces (the client only shows it). Kessar only; one session of at most
 * `sessionMinutes`; nothing persisted; ends with a wishlist call to action. Pure constants and helpers: no clock is read here (callers pass `nowMs`).
 */
export const DEMO = {
  /** The regions a demo party may be in or sail to. Highmark (and every later region) is the paid game. */
  regions: ["hollowmere", "kessar"] as const satisfies readonly RegionId[],
  /** Wall-clock length of one demo room, from its creation. */
  sessionMinutes: 45,
  /** The server tells the party at these remaining minutes (the notice reuses the `notice` message; no schema field is added). */
  warnAtMinutes: [10, 2] as const,
  /** Demo campaigns are not saved and cannot be resumed (the save store is never touched). */
  persist: false,
  /** The WebSocket close code the server uses when the session ends; the client shows the wishlist card on seeing it. 4000-4999 are application codes. NOT 4010: that is Colyseus's own `MAY_TRY_RECONNECT`, which the SDK answers by reconnecting (found by the first real-room demo test:
   * the client saw 1006 and the card never showed). 4000-4003 and 4010 are Colyseus's; the server test asserts this code is none of them. */
  closeCode: 4420,
} as const;

export type DemoPhase = "open" | "warn" | "last" | "over";

export const isDemoRegion = (id: unknown): boolean => typeof id === "string" && (DEMO.regions as readonly string[]).includes(id);

/** Whole seconds left of a demo room created at `startedAtMs` (never negative). */
export function demoRemainingS(startedAtMs: number, nowMs: number): number {
  const left = DEMO.sessionMinutes * 60 - (nowMs - startedAtMs) / 1000;
  return Number.isFinite(left) ? Math.max(0, Math.floor(left)) : 0;
}

/** open > warn (<= 10 min) > last (<= 2 min) > over (0). */
export function demoPhase(remainingS: number): DemoPhase {
  if (!(remainingS > 0)) return "over";
  if (remainingS <= DEMO.warnAtMinutes[1] * 60) return "last";
  if (remainingS <= DEMO.warnAtMinutes[0] * 60) return "warn";
  return "open";
}

/**
 * The wishlist call to action. The Steam store URL does not exist yet (no App ID): it comes from configuration (`VITE_WISHLIST_URL` in the client build), and when it is
 * absent the card says the game is coming, with no link. Only an https URL is ever used.
 */
export function wishlistUrl(configured: unknown): string | undefined {
  if (typeof configured !== "string" || configured.length > 300) return undefined;
  try {
    const u = new URL(configured);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
