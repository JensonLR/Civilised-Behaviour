import { join } from "node:path";
import { parseConnect, type DesktopInfo } from "@cb/shared";
import { handleAppProtocol, registerAppScheme } from "./appProtocol.ts";
import { APP_ENTRY, loadConfig } from "./config.ts";
import { registerIpc, type IpcMainLike } from "./ipc.ts";
import { buildCsp, guardContents, installSessionSecurity, type ContentsLike, type SessionLike } from "./security.ts";
import { selectPlatform } from "./steam/flags.ts";
import { startUpdater } from "./updater.ts";
import { createMainWindow, type WindowLike } from "./window.ts";

/**
 * The desktop shell's lifecycle (D-036, package D), written against a narrow `Electron` surface so it runs under a fake in tests. `entry.ts` calls it with the real module.
 * Order matters and is asserted: the scheme is registered as privileged BEFORE ready; the single-instance lock is taken first (a second launch hands its connect argument to
 * the first and quits); on ready the protocol, the session rules and the IPC handlers are installed BEFORE the first window loads a byte.
 */
export interface ElectronLike {
  app: {
    isPackaged: boolean;
    getVersion(): string;
    requestSingleInstanceLock(): boolean;
    quit(): void;
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: never[]) => void): unknown;
  };
  protocol: { registerSchemesAsPrivileged(s: { scheme: string; privileges: Record<string, boolean> }[]): void; handle(scheme: string, h: (req: Request) => Promise<Response>): void };
  session: { defaultSession: SessionLike };
  shell: { openExternal(url: string): Promise<void> | void };
  ipcMain: IpcMainLike;
  BrowserWindow: new (opts: never) => WindowLike & { isMinimized(): boolean; restore(): void; focus(): void; webContents: WindowLike["webContents"] & { send(channel: string, payload: unknown): void; isLoading(): boolean; once(e: string, cb: () => void): unknown } };
  Menu?: { setApplicationMenu(m: null): void };
}

export interface StartOptions {
  env: Readonly<Record<string, string | undefined>>;
  argv: readonly string[];
  platform: string;
  /** Directory of the bundled main/preload (`dist/`). */
  dist: string;
  /** Where the built client lives (packaged: `<resources>/client`; unpackaged: `apps/client/dist-desktop`). */
  clientRoot: string;
  log?: (line: string) => void;
}

export interface Started { quitting: boolean; windows(): number }

export async function startDesktop(electron: ElectronLike, o: StartOptions): Promise<Started | undefined> {
  const { app, protocol, session, shell, ipcMain, BrowserWindow } = electron;
  const log = o.log ?? ((l: string) => console.log(`[desktop] ${l}`));
  const cfg = loadConfig(o.env);
  const csp = buildCsp(cfg.serverUrl);
  const packaged = app.isPackaged;

  // 1. the privileged scheme must be declared before the app is ready
  registerAppScheme(protocol);

  // 2. one instance: a second launch passes its connect argument (`+join CODE`) to this one and exits
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return undefined;
  }

  const selection = selectPlatform(o.env, log);
  const info = (): DesktopInfo => ({
    version: app.getVersion(),
    platform: o.platform === "win32" || o.platform === "darwin" ? o.platform : "linux",
    packaged,
    steam: selection.adapter.kind,
    updates: cfg.updates.enabled ? "on" : "off",
  });

  let win: InstanceType<ElectronLike["BrowserWindow"]> | undefined;
  const state = { quitting: false, count: 0 };

  /** An invite is a join code and nothing else: it goes to the page once the page has loaded (the preload also holds it until the game subscribes). */
  const pushInvite = (code: string): void => {
    const w = win;
    if (!w) return;
    const send = (): void => w.webContents.send("platform:invite", { joinCode: code });
    if (w.webContents.isLoading()) w.webContents.once("did-finish-load", send);
    else send();
  };
  selection.adapter.onInvite((r) => pushInvite(r.joinCode));
  const launchCode = parseConnect(o.argv.slice(1));

  app.on("second-instance", ((_e: unknown, argv: unknown) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const code = parseConnect(argv);
    if (code) pushInvite(code);
  }) as never);

  // 3. every web contents the app ever makes is locked down before it can navigate
  app.on("web-contents-created", ((_e: unknown, wc: ContentsLike) => guardContents(wc, { wishlist: cfg.wishlist, openExternal: (u) => void shell.openExternal(u) })) as never);

  app.on("window-all-closed", (() => {
    state.quitting = true;
    selection.adapter.shutdown();
    app.quit();
  }) as never);

  await app.whenReady();

  handleAppProtocol(protocol, o.clientRoot, csp);
  installSessionSecurity(session.defaultSession, cfg.serverUrl, packaged);
  registerIpc(ipcMain, { info, platform: selection.adapter, wishlist: cfg.wishlist, openExternal: (u) => void shell.openExternal(u), quit: () => app.quit(), log });
  if (packaged) electron.Menu?.setApplicationMenu(null);
  startUpdater(cfg.updates, undefined, log);

  const open = (): void => {
    win = createMainWindow((opts) => new BrowserWindow(opts as never), { preload: join(o.dist, "preload.cjs"), info: info(), packaged, entry: APP_ENTRY });
    state.count++;
    if (launchCode && state.count === 1) pushInvite(launchCode);
  };
  open();
  app.on("activate", (() => {
    if (!win) open();
  }) as never);
  return { get quitting() { return state.quitting; }, windows: () => state.count };
}
