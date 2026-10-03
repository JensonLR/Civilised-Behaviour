import { PALETTE, type DesktopInfo } from "@cb/shared";
import { describe, expect, it, vi } from "vitest";
import { INFO_ARG } from "./constants.ts";
import { parseInfo } from "./preload.ts";
import { createMainWindow, hexOf, windowOptions, type WindowLike } from "./window.ts";

vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld: vi.fn() }, ipcRenderer: { invoke: vi.fn(), on: vi.fn() } }));

const info: DesktopInfo = { version: "1.2.3", platform: "linux", packaged: true, steam: "web", updates: "off" };

describe("window options", () => {
  it("the security-relevant web preferences are EXACTLY the spec's", () => {
    const w = windowOptions({ preload: "/x/preload.cjs", info, packaged: true }).webPreferences;
    expect(w.contextIsolation).toBe(true);
    expect(w.nodeIntegration).toBe(false);
    expect(w.nodeIntegrationInWorker).toBe(false);
    expect(w.nodeIntegrationInSubFrames).toBe(false);
    expect(w.sandbox).toBe(true);
    expect(w.webSecurity).toBe(true);
    expect(w.allowRunningInsecureContent).toBe(false);
    expect(w.webviewTag).toBe(false);
    expect(w.devTools).toBe(false);
    expect(w.preload).toBe("/x/preload.cjs");
    expect(w.autoplayPolicy).toBe("no-user-gesture-required"); // (sound for a pad-only player, who never clicks: D-049)
    // nothing that loosens the sandbox is present at all
    expect(Object.keys(w).sort()).toEqual(["additionalArguments", "allowRunningInsecureContent", "autoplayPolicy", "contextIsolation", "devTools", "nodeIntegration", "nodeIntegrationInSubFrames", "nodeIntegrationInWorker", "preload", "sandbox", "spellcheck", "webSecurity", "webviewTag"]);
  });
  it("dev tools only when unpackaged", () => {
    expect(windowOptions({ preload: "p", info, packaged: false }).webPreferences.devTools).toBe(true);
    expect(windowOptions({ preload: "p", info, packaged: true }).webPreferences.devTools).toBe(false);
  });
  it("opens hidden on the palette's ink (never a literal) and carries the shell's facts to the preload", () => {
    const o = windowOptions({ preload: "p", info, packaged: true });
    expect(o.show).toBe(false);
    expect(o.backgroundColor).toBe(hexOf(PALETTE.ink));
    const arg = o.webPreferences.additionalArguments[0]!;
    expect(arg.startsWith(INFO_ARG)).toBe(true);
    expect(parseInfo(["x", arg])).toEqual(info);
  });
  it("the info argument is hostile-safe on the way in", () => {
    for (const bad of [[], [`${INFO_ARG}`], [`${INFO_ARG}{`], [`${INFO_ARG}[1]`], [`${INFO_ARG}null`], [`${INFO_ARG}${"x".repeat(5000)}`]]) {
      const i = parseInfo(bad);
      expect(i.steam).toBe("web");
      expect(i.updates).toBe("off");
      expect(typeof i.version).toBe("string");
    }
    expect(parseInfo([`${INFO_ARG}${JSON.stringify({ platform: "plan9", steam: "evil", updates: "yes", packaged: "true" })}`])).toMatchObject({ platform: "linux", steam: "web", updates: "off", packaged: false });
  });
  it("createMainWindow shows on ready, loads the app page, and (packaged) shuts dev tools the moment they open", () => {
    const handlers: Record<string, () => void> = {};
    const wcHandlers: Record<string, () => void> = {};
    const closeDevTools = vi.fn();
    const win = { once: (e: string, cb: () => void) => { handlers[e] = cb; }, show: vi.fn(), loadURL: vi.fn(async () => {}), webContents: { on: (e: string, cb: () => void) => { wcHandlers[e] = cb; }, closeDevTools } } satisfies WindowLike;
    const made = vi.fn(() => win);
    createMainWindow(made, { preload: "p", info, packaged: true, entry: "app://game/index.html" });
    expect(win.loadURL).toHaveBeenCalledWith("app://game/index.html");
    expect(win.show).not.toHaveBeenCalled();
    handlers["ready-to-show"]!();
    expect(win.show).toHaveBeenCalledTimes(1);
    wcHandlers["devtools-opened"]!();
    expect(closeDevTools).toHaveBeenCalled();
  });
});
