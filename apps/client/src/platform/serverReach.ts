import { REACH_BUSY, REACH_DOWN, REACH_UP, REACH_WAKING, REACH_WAKING_AFTER_MS } from "./reachCopy.ts";

export type Reach = "up" | "down";

/**
 * Can this machine reach the game server? A GET of `/health` with a hard timeout (the desktop build opens offline, so the menu asks instead of assuming). `serverUrl` is the
 * ws(s):// or http(s):// address the client already uses. Never throws; every failure is "down".
 */
export async function probeServer(serverUrl: string, fetchFn: typeof fetch = (...a) => fetch(...a), timeoutMs = 4000): Promise<Reach> {
  let url: string;
  try {
    url = `${serverUrl.replace(/^ws/, "http").replace(/\/+$/, "")}/health`;
    if (!/^https?:\/\//.test(url)) return "down";
  } catch {
    return "down";
  }
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { method: "GET", cache: "no-store", signal: ctl?.signal });
    return res.ok ? "up" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export const reachText = (r: Reach): string => (r === "up" ? REACH_UP : REACH_DOWN);

/**
 * D-051: shows `first`, and if the step is still going after `REACH_WAKING_AFTER_MS`, says a quiet server is waking (the free tier sleeps after 15 idle minutes and wakes in up to a
 * minute; without it the door looked stuck). Returns the call that ends the wait (idempotent).
 */
export function patientProgress(progress: (t: string) => void, first: string, after: number = REACH_WAKING_AFTER_MS): () => void {
  progress(first);
  const t = setTimeout(() => progress(REACH_WAKING), after);
  return () => clearTimeout(t);
}

/** The server's "too busy for another room" (D-051: load shedding, or the room cap): a 503 from the matchmaker. */
export const isBusyRefusal = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: unknown }).code === 503;

/**
 * Starts a room, asking again (up to `tries` in all, `waitMs` apart) while the server answers that it is too busy: a small instance refuses new rooms while one is being built
 * (measured under a tenth of a core: about ten seconds), which a party arriving a moment after another should not have to read as "come back later". Anything else is thrown at once.
 */
export async function retryBusy<T>(attempt: () => Promise<T>, progress: (t: string) => void, tries = 3, waitMs = 8000, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (!isBusyRefusal(e) || i >= tries) throw e;
      progress(REACH_BUSY);
      await wait(waitMs);
    }
  }
}
