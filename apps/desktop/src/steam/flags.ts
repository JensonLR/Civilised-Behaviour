import { createNoopPlatform, type PlatformAdapter } from "../shared.ts";
import { steamModeOf, type SteamMode } from "../config.ts";
import { StubSteam } from "./StubSteam.ts";

export { steamModeOf, type SteamMode };

export interface SteamSelection { adapter: PlatformAdapter; mode: SteamMode; warning?: string }

/**
 * Which platform adapter the MAIN process owns (D-036, package D). `CB_STEAM=stub` selects the `StubSteam`; unset or anything else is OFF (the no-op); `real` is NOT implemented (it
 * needs a Steamworks App ID that does not exist yet, and `steamworks.js` is not a dependency) and falls back to the no-op WITH a warning, so a build asked for Steam never silently
 * pretends to have it.
 */
export function selectPlatform(env: Readonly<Record<string, string | undefined>>, log: (line: string) => void = (l) => console.log(`[steam] ${l}`)): SteamSelection {
  const mode = steamModeOf(env);
  if (mode === "stub") return { adapter: new StubSteam(), mode };
  if (mode === "real") {
    const warning = "CB_STEAM=real is not implemented in this build (no App ID, no Steamworks binding): running without Steam";
    log(`warning: ${warning}`);
    return { adapter: createNoopPlatform(), mode, warning };
  }
  return { adapter: createNoopPlatform(), mode };
}
