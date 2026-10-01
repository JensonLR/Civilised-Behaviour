// Builds the game client for the desktop shell: `vite build --mode desktop` (relative asset paths, output apps/client/dist-desktop, never the web deploy's dist).
// The server address is baked in from CB_SERVER_URL (default: the hosted test server), converted to the ws(s) form the client uses. CB_WISHLIST_URL becomes VITE_WISHLIST_URL.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const DEFAULT = "https://civilised-behaviour-server.onrender.com";

let server = DEFAULT;
try {
  const u = new URL((process.env.CB_SERVER_URL ?? "").trim().replace(/^ws(s?):/i, "http$1:"));
  if ((u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password) server = u.origin;
} catch {
  // keep the default
}
const ws = server.replace(/^http/, "ws");
const env = { ...process.env, VITE_SERVER_URL: ws };
if (process.env.CB_WISHLIST_URL) env.VITE_WISHLIST_URL = process.env.CB_WISHLIST_URL;
delete env.VITE_DEMO; // the desktop build is the full game

console.log(`[desktop] building the client for ${ws}`);
const r = spawnSync("pnpm", ["--filter", "@cb/client", "exec", "vite", "build", "--mode", "desktop"], { cwd: repo, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
