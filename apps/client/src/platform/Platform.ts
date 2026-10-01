import { createNoopPlatform, type PlatformAdapter } from "@cb/shared";

/**
 * Which storefront adapter this build talks to (D-036, package D): the desktop shell's bridge (`window.cbDesktop.platform`, set by its preload; a stub in `CB_STEAM=stub` runs,
 * the real one much later) or the no-op. The web build has no `cbDesktop`, so it is the no-op and nothing else happens. Read once, here: no other file looks at `window.cbDesktop`
 * except for the two plain actions on the bridge (`openWishlist`, `info`) which the same guard covers.
 */
export function pickPlatform(win: { cbDesktop?: { platform?: PlatformAdapter } } | undefined = typeof window === "undefined" ? undefined : window): PlatformAdapter {
  try {
    const p = win?.cbDesktop?.platform;
    if (p && typeof p.unlock === "function" && typeof p.setPresence === "function" && typeof p.onInvite === "function" && typeof p.init === "function") return p;
  } catch {
    // a hostile or half-built bridge: fall through to the safe default
  }
  return createNoopPlatform();
}

/** Desktop facts for the menu (version, platform) when running inside the shell; undefined on the web. */
export function desktopInfo(win: { cbDesktop?: { info?: { version?: string; platform?: string; packaged?: boolean; steam?: string; updates?: string } } } | undefined = typeof window === "undefined" ? undefined : window) {
  try {
    const i = win?.cbDesktop?.info;
    return i && typeof i.version === "string" ? i : undefined;
  } catch {
    return undefined;
  }
}
