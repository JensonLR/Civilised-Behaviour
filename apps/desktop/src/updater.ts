import type { DesktopConfig } from "./config.ts";

/**
 * Update checks (D-036, package D): the hooks exist and are OFF. They turn on only with `CB_UPDATES=1` AND an https `CB_UPDATE_FEED` (both read by `loadConfig`); nothing else enables
 * them, and while they are off this module makes no request and opens no timer. There is no updater library in the dependency tree (and no signing): even when enabled, the shell only
 * calls the implementation it is GIVEN, so "updates on" without one is logged, never faked. Turning updates on for real is a release decision (docs/STEAM_RELEASE.md).
 */
export interface UpdaterImpl {
  check(feedUrl: string): Promise<void>;
}

export interface UpdaterHandle { enabled: boolean; started: boolean; stop(): void }

export function startUpdater(cfg: DesktopConfig["updates"], impl: UpdaterImpl | undefined, log: (line: string) => void = (l) => console.log(`[updates] ${l}`)): UpdaterHandle {
  if (!cfg.enabled || cfg.feedUrl === undefined) return { enabled: false, started: false, stop: () => {} };
  if (!impl) {
    log("updates are enabled but no updater is installed in this build: nothing will be checked");
    return { enabled: true, started: false, stop: () => {} };
  }
  const feed = cfg.feedUrl;
  void impl.check(feed).catch((e: unknown) => log(`update check failed: ${e instanceof Error ? e.message : "unknown error"}`));
  return { enabled: true, started: true, stop: () => {} };
}
