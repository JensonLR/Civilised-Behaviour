import { PALETTE, type DesktopInfo } from "@cb/shared";
import { INFO_ARG } from "./constants.ts";

/**
 * The main window's options (D-036, package D). The security-relevant ones are exactly these and are asserted one by one in `window.test.ts`: context isolation on, node integration off
 * (also in workers and sub-frames), sandbox on, web security on, no insecure content, no webview tag, dev tools only when the app is NOT packaged. The window opens hidden and is shown on
 * `ready-to-show` so there is no white flash; its background is the palette's backdrop, never a literal.
 */
export const hexOf = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

export function windowOptions(o: { preload: string; info: DesktopInfo; packaged: boolean }) {
  return {
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    show: false,
    title: "Civilised Behaviour",
    backgroundColor: hexOf(PALETTE.ink),
    autoHideMenuBar: true,
    webPreferences: {
      preload: o.preload,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !o.packaged,
      spellcheck: false,
      // sound with no click first (Electron's default, pinned): a pad-only player, on a Deck or the console path, never clicks (D-049)
      autoplayPolicy: "no-user-gesture-required",
      // the preload reads the shell's facts from here, so no synchronous IPC is needed to build `window.cbDesktop.info`
      additionalArguments: [`${INFO_ARG}${JSON.stringify(o.info)}`],
    },
  } as const;
}

export interface WindowLike {
  once(event: "ready-to-show", cb: () => void): unknown;
  show(): void;
  loadURL(url: string): Promise<void>;
  webContents: { on(e: string, cb: (...a: never[]) => void): unknown; closeDevTools(): void };
}

export function createMainWindow<W extends WindowLike>(make: (opts: ReturnType<typeof windowOptions>) => W, o: { preload: string; info: DesktopInfo; packaged: boolean; entry: string }): W {
  const win = make(windowOptions(o));
  win.once("ready-to-show", () => win.show());
  // a packaged build has no dev tools at all, whatever a keyboard shortcut or a future flag says
  if (o.packaged) win.webContents.on("devtools-opened" as never, (() => win.webContents.closeDevTools()) as never);
  void win.loadURL(o.entry);
  return win;
}
