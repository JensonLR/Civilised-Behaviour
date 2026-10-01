import { REACH_DOWN, REACH_UP } from "./reachCopy.ts";

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
