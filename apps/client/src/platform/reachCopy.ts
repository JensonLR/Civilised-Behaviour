/**
 * What the front door says about the server when it is the desktop build (D-036, package D). Authored copy, pending developer review (docs/AI_CONTENT_REGISTER.md).
 * The desktop shell loads the game from disk, so the menu opens with no network at all; PLAYING needs a server (the hosted test server by default, or one the player runs).
 */
export const REACH_CHECKING = "Sending a telegram to the Society's offices...";
export const REACH_UP = "The Society's offices are open. Expeditions may be filed.";
export const REACH_DOWN = "The Society's offices are shut or out of reach. The depot door works, but an expedition needs a server: check your connection, or run `pnpm dev:server` and rebuild with CB_SERVER_URL pointing at it.";
export const REACH_RETRY = "Try the offices again";
/** D-051: the first step of a join or a new campaign has taken a while: a quiet free-tier server is waking (about half a minute to a minute). */
export const REACH_WAKING = "The night porter is unlocking the offices. (A quiet server can take up to a minute to wake.)";
/** How long the first step may take before the door says why. */
export const REACH_WAKING_AFTER_MS = 6000;
/** D-051: the server refused a new room because it is busy (503): the door asks again on its own, a few times. */
export const REACH_BUSY = "The offices are crowded. The clerk asks you to wait, and will try again in a moment...";
