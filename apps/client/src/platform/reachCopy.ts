/**
 * What the front door says about the server when it is the desktop build (D-036, package D). Authored copy, pending developer review (docs/AI_CONTENT_REGISTER.md).
 * The desktop shell loads the game from disk, so the menu opens with no network at all; PLAYING needs a server (the hosted test server by default, or one the player runs).
 */
export const REACH_CHECKING = "Sending a telegram to the Society's offices...";
export const REACH_UP = "The Society's offices are open. Expeditions may be filed.";
export const REACH_DOWN = "The Society's offices are shut or out of reach. The depot door works, but an expedition needs a server: check your connection, or run `pnpm dev:server` and rebuild with CB_SERVER_URL pointing at it.";
export const REACH_RETRY = "Try the offices again";
