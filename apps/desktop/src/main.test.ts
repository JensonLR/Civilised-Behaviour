import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@cb/shared";
import { describe, expect, it, vi } from "vitest";
import { startDesktop, type ElectronLike } from "./main.ts";

const CODE = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);

/** A fake Electron that records the ORDER of everything the lifecycle does. */
function fakeElectron(over: { lock?: boolean; packaged?: boolean } = {}) {
  const order: string[] = [];
  const appHandlers = new Map<string, (...a: never[]) => void>();
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));
  const windows: { opts: Record<string, any>; loaded: string[]; sent: [string, unknown][]; loading: boolean; didFinish: (() => void) | undefined; focus: () => void; restore: () => void; minimized: boolean }[] = [];
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const sessionHandlers: Record<string, unknown> = {};
  const open = vi.fn();
  class FakeWindow {
    w: (typeof windows)[number];
    constructor(opts: Record<string, any>) {
      order.push("window");
      this.w = { opts, loaded: [], sent: [], loading: true, didFinish: undefined, focus: vi.fn<() => void>(), restore: vi.fn<() => void>(), minimized: false };
      windows.push(this.w);
    }
    once() {}
    show() {}
    async loadURL(u: string) { this.w.loaded.push(u); }
    isMinimized() { return this.w.minimized; }
    restore() { this.w.restore(); }
    focus() { this.w.focus(); }
    webContents = {
      on: () => {},
      closeDevTools: () => {},
      send: (c: string, p: unknown) => this.w.sent.push([c, p]),
      isLoading: () => this.w.loading,
      once: (_e: string, cb: () => void) => { this.w.didFinish = cb; },
    };
  }
  const electron = {
    app: {
      isPackaged: over.packaged ?? false,
      getVersion: () => "0.0.1",
      requestSingleInstanceLock: () => { order.push("lock"); return over.lock ?? true; },
      quit: vi.fn(() => order.push("quit")),
      whenReady: () => ready,
      on: (e: string, l: (...a: never[]) => void) => { appHandlers.set(e, l); },
    },
    protocol: { registerSchemesAsPrivileged: () => order.push("scheme"), handle: () => order.push("protocol") },
    session: { defaultSession: { setPermissionRequestHandler: () => order.push("permissions"), setPermissionCheckHandler: () => {}, setDevicePermissionHandler: () => {}, webRequest: { onHeadersReceived: () => order.push("csp"), onBeforeRequest: (h: unknown) => { sessionHandlers.before = h; } } } },
    shell: { openExternal: open },
    ipcMain: { handle: (c: string, l: (...a: unknown[]) => unknown) => { handlers.set(c, l); order.push(`ipc:${c}`); }, removeHandler: () => {} },
    BrowserWindow: FakeWindow as unknown as ElectronLike["BrowserWindow"],
    Menu: { setApplicationMenu: vi.fn(() => order.push("menu")) },
  };
  return { electron: electron as unknown as ElectronLike, raw: electron, order, appHandlers, ready: readyResolve, windows, handlers, open };
}
const OPTS = { env: {}, argv: ["electron", "."], platform: "linux", dist: "/app/dist", clientRoot: "/app/client", log: () => {} };

describe("desktop lifecycle (a fake Electron)", () => {
  it("registers the scheme BEFORE ready, takes the lock, and installs protocol + session rules + IPC BEFORE the first window", async () => {
    const f = fakeElectron();
    const p = startDesktop(f.electron, OPTS);
    expect(f.order).toEqual(["scheme", "lock"]);
    f.ready();
    const started = await p;
    expect(started).toBeDefined();
    const iWindow = f.order.indexOf("window");
    for (const step of ["protocol", "permissions", "csp", "ipc:app:info", "ipc:platform:unlock"]) {
      expect(f.order.indexOf(step), step).toBeGreaterThan(-1);
      expect(f.order.indexOf(step), step).toBeLessThan(iWindow);
    }
    expect(f.order.indexOf("scheme")).toBeLessThan(f.order.indexOf("protocol"));
    expect(f.windows).toHaveLength(1);
    expect(f.windows[0]!.loaded).toEqual(["app://game/index.html"]);
    expect(f.windows[0]!.opts.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: true });
    expect(f.windows[0]!.opts.webPreferences.preload).toBe("/app/dist/preload.cjs");
  });

  it("a packaged app has no menu and no dev tools", async () => {
    const f = fakeElectron({ packaged: true });
    const p = startDesktop(f.electron, OPTS);
    f.ready();
    await p;
    expect(f.order).toContain("menu");
    expect(f.windows[0]!.opts.webPreferences.devTools).toBe(false);
  });

  it("a second instance never gets past the lock: it quits and builds nothing", async () => {
    const f = fakeElectron({ lock: false });
    const r = await startDesktop(f.electron, OPTS);
    expect(r).toBeUndefined();
    expect(f.raw.app.quit).toHaveBeenCalledTimes(1);
    expect(f.order).toEqual(["scheme", "lock", "quit"]);
    expect(f.windows).toHaveLength(0);
  });

  it("an invite in the launch arguments, or from a second launch, reaches the page as a join code and nothing else", async () => {
    const f = fakeElectron();
    const p = startDesktop(f.electron, { ...OPTS, argv: ["electron", ".", "+join", CODE] });
    f.ready();
    await p;
    const w = f.windows[0]!;
    expect(w.sent).toEqual([]);          // held until the page has loaded
    w.didFinish!();
    expect(w.sent).toEqual([["platform:invite", { joinCode: CODE }]]);
    w.loading = false;
    w.minimized = true;
    const second = f.appHandlers.get("second-instance")!;
    second({} as never, ["x", "--evil", "+join", "nope", "+join", CODE] as never);
    expect(w.restore).toHaveBeenCalled();
    expect(w.focus).toHaveBeenCalled();
    expect(w.sent).toHaveLength(2);
    second({} as never, ["x", "+join", "../../etc/passwd"] as never);
    second({} as never, "garbage" as never);
    second({} as never, undefined as never);
    expect(w.sent).toHaveLength(2);
  });

  it("the stub adapter's simulated invite reaches the page (CB_STEAM=stub), and only with a valid code", async () => {
    const f = fakeElectron();
    const p = startDesktop(f.electron, { ...OPTS, env: { CB_STEAM: "stub" } });
    f.ready();
    await p;
    const w = f.windows[0]!;
    w.loading = false;
    // the IPC unlock/presence handlers act on the stub
    const e = { senderFrame: { url: "app://game/index.html", parent: null } };
    expect(await f.handlers.get("platform:unlock")!(e, "first_crossing")).toBe(true);
    expect(await f.handlers.get("platform:presence")!(e, { where: "hq", party: 1, day: 1 })).toBe(true);
    expect(w.opts.webPreferences.additionalArguments[0]).toContain('"steam":"steam-stub"');
  });

  it("every web contents is guarded as it is created, and a window.open elsewhere never reaches the system browser", async () => {
    const f = fakeElectron();
    const p = startDesktop(f.electron, { ...OPTS, env: { CB_WISHLIST_URL: "https://store.example.test/app/1/" } });
    f.ready();
    await p;
    const created = f.appHandlers.get("web-contents-created")!;
    let open: ((d: { url: string }) => unknown) | undefined;
    const navs: string[] = [];
    created({} as never, { on: (ev: string, l: (e: { preventDefault(): void }) => void) => { l({ preventDefault: () => navs.push(ev) }); }, setWindowOpenHandler: (h: typeof open) => { open = h; } } as never);
    expect(navs.sort()).toEqual(["will-attach-webview", "will-frame-navigate", "will-navigate", "will-redirect"]);
    open!({ url: "https://evil.example.test/" });
    expect(f.open).not.toHaveBeenCalled();
    open!({ url: "https://store.example.test/app/1/" });
    expect(f.open).toHaveBeenCalledExactlyOnceWith("https://store.example.test/app/1/");
  });

  it("closing the last window quits (and shuts the platform down)", async () => {
    const f = fakeElectron();
    const p = startDesktop(f.electron, OPTS);
    f.ready();
    const started = await p;
    f.appHandlers.get("window-all-closed")!();
    expect(f.raw.app.quit).toHaveBeenCalled();
    expect(started!.quitting).toBe(true);
  });

  it("makes no network request of its own while starting (updates off)", async () => {
    const net = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    try {
      const f = fakeElectron();
      const p = startDesktop(f.electron, OPTS);
      f.ready();
      await p;
      expect(net).not.toHaveBeenCalled();
    } finally {
      net.mockRestore();
    }
  });
});
