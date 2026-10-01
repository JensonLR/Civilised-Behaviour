import { describe, expect, it, vi } from "vitest";
import { ALLOWED_PERMISSIONS, buildCsp, guardContents, installSessionSecurity, isAppUrl, permissionAllowed, requestAllowed, type ContentsLike, type SessionLike } from "./security.ts";

const SERVER = "https://cb-server.example.test";
const WISH = "https://store.example.test/app/9/";

function fakeSession() {
  const s = {
    reqHandler: undefined as undefined | ((wc: unknown, p: string, cb: (g: boolean) => void, d?: { requestingUrl?: string }) => void),
    checkHandler: undefined as undefined | ((wc: unknown, p: string, o: string, d?: { requestingUrl?: string }) => boolean),
    device: undefined as undefined | ((d: unknown) => boolean),
    headers: undefined as undefined | Parameters<SessionLike["webRequest"]["onHeadersReceived"]>[0],
    before: undefined as undefined | Parameters<SessionLike["webRequest"]["onBeforeRequest"]>[0],
  };
  const ses: SessionLike = {
    setPermissionRequestHandler: (h) => { s.reqHandler = h ?? undefined; },
    setPermissionCheckHandler: (h) => { s.checkHandler = h ?? undefined; },
    setDevicePermissionHandler: (h) => { s.device = h; },
    webRequest: { onHeadersReceived: (h) => { s.headers = h; }, onBeforeRequest: (h) => { s.before = h; } },
  };
  return { ses, s };
}

describe("CSP", () => {
  const csp = buildCsp(SERVER);
  const dir = (n: string): string => csp.split("; ").find((d) => d.startsWith(`${n} `)) ?? "";
  it("denies by default; scripts only from the app (and wasm), never eval, never remote; no frames, objects, base or forms", () => {
    expect(dir("default-src")).toBe("default-src 'none'");
    expect(dir("script-src")).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval|\*|https?:\/\/(?!cb-server)/);
    for (const d of ["frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "child-src 'none'"]) expect(csp).toContain(d);
    expect(dir("script-src")).not.toContain("unsafe-inline");
  });
  it("connect-src is the app and the configured server over http(s) and ws(s), nothing else", () => {
    expect(dir("connect-src")).toBe("connect-src 'self' https://cb-server.example.test wss://cb-server.example.test");
    expect(buildCsp("http://localhost:2567")).toContain("connect-src 'self' http://localhost:2567 ws://localhost:2567");
  });
});

describe("permissions, requests and headers (a fake session)", () => {
  it("every permission is refused except the page's own pointer lock and full screen", () => {
    const { ses, s } = fakeSession();
    installSessionSecurity(ses, SERVER, true);
    const ask = (p: string, url: string): boolean => { let r: boolean | undefined; s.reqHandler!(null, p, (g) => (r = g), { requestingUrl: url }); return r!; };
    for (const p of ["media", "geolocation", "notifications", "clipboard-read", "clipboard-sanitized-write", "midi", "openExternal", "hid", "serial", "usb", "display-capture", "idle-detection", "unknown", ""]) {
      expect(ask(p, "app://game/index.html"), p).toBe(false);
      expect(s.checkHandler!(null, p, "app://game"), p).toBe(false);
    }
    for (const p of ALLOWED_PERMISSIONS) expect(ask(p, "app://game/index.html")).toBe(true);
    expect(ask("pointerLock", "https://evil.example.test/")).toBe(false);
    expect(ask("pointerLock", "app://gamex/")).toBe(false);
    expect(s.checkHandler!(null, "pointerLock", "app://game")).toBe(true);
    expect(s.checkHandler!(null, "pointerLock", "https://evil.example.test")).toBe(false);
    expect(s.device!({})).toBe(false);
    expect(permissionAllowed(undefined, "app://game/")).toBe(false);
  });
  it("a CSP header goes on EVERY response, replacing one the server sent in any case", () => {
    const { ses, s } = fakeSession();
    installSessionSecurity(ses, SERVER, true);
    let out: Record<string, string[] | string> = {};
    s.headers!({ responseHeaders: { "content-security-policy": ["default-src *"], "Content-Type": ["text/html"] } }, (r) => (out = r.responseHeaders));
    expect(Object.keys(out).filter((k) => k.toLowerCase() === "content-security-policy")).toEqual(["Content-Security-Policy"]);
    expect(out["Content-Security-Policy"]).toEqual([buildCsp(SERVER)]);
    expect(out["Content-Type"]).toEqual(["text/html"]);
    s.headers!({}, (r) => (out = r.responseHeaders));
    expect(out["Content-Security-Policy"]).toEqual([buildCsp(SERVER)]);
  });
  it("no request leaves for anywhere but the app, inline data and the configured server", () => {
    const { ses, s } = fakeSession();
    installSessionSecurity(ses, SERVER, true);
    const cancelled = (url: string): boolean => { let c: boolean | undefined; s.before!({ url }, (r) => (c = r.cancel)); return c!; };
    for (const ok of ["app://game/assets/x.js", "data:image/png;base64,AAAA", "blob:app://game/1234", "https://cb-server.example.test/health", "wss://cb-server.example.test/abc?x=1", "https://cb-server.example.test"]) expect(cancelled(ok), ok).toBe(false);
    for (const bad of ["https://evil.example.test/", "http://cb-server.example.test/x", "https://cb-server.example.test.evil.test/", "https://cb-server.example.testx/", "file:///etc/passwd", "ftp://x/", "devtools://devtools/x", "javascript:alert(1)", "wss://evil.example.test/", ""]) expect(cancelled(bad), bad).toBe(true);
    expect(requestAllowed("devtools://devtools/x", SERVER, false)).toBe(true);
    expect(requestAllowed(undefined, SERVER, false)).toBe(false);
    expect(isAppUrl("app://game")).toBe(true);
    expect(isAppUrl("app://game.evil.test/")).toBe(false);
  });
});

describe("guardContents", () => {
  function fakeContents() {
    const on: Record<string, (e: { preventDefault(): void }) => void> = {};
    let open: ((d: { url: string }) => { action: "deny" }) | undefined;
    const wc: ContentsLike = { on: (e, l) => { on[e] = l; }, setWindowOpenHandler: (h) => { open = h; } };
    return { wc, on, open: (url: string) => open!({ url }) };
  }
  it("every navigation, redirect and webview attach is cancelled", () => {
    const f = fakeContents();
    guardContents(f.wc, { wishlist: WISH, openExternal: vi.fn() });
    for (const ev of ["will-navigate", "will-redirect", "will-frame-navigate", "will-attach-webview"]) {
      const e = { preventDefault: vi.fn() };
      f.on[ev]!(e);
      expect(e.preventDefault, ev).toHaveBeenCalledTimes(1);
    }
  });
  it("the app's own page may reload itself (Leave, the wish-list card's close, an invite); no other address may be navigated to", () => {
    const f = fakeContents();
    guardContents(f.wc, { wishlist: WISH, openExternal: vi.fn() });
    for (const ev of ["will-navigate", "will-frame-navigate"]) {
      for (const url of ["app://game/index.html", "app://game/index.html?join=ABCDE"]) {
        const e = { preventDefault: vi.fn(), url };
        f.on[ev]!(e);
        expect(e.preventDefault, `${ev} ${url}`).not.toHaveBeenCalled();
      }
      for (const url of ["https://evil.example.test/", "app://game.evil.test/", "file:///etc/passwd", "javascript:alert(1)", "about:blank", undefined]) {
        const e = { preventDefault: vi.fn(), url };
        f.on[ev]!(e);
        expect(e.preventDefault, `${ev} ${String(url)}`).toHaveBeenCalledTimes(1);
      }
    }
    const r = { preventDefault: vi.fn(), url: "app://game/index.html" };
    f.on["will-redirect"]!(r);
    expect(r.preventDefault).toHaveBeenCalledTimes(1);
  });
  it("a new window is always denied; only the configured https wish-list URL reaches the system browser", () => {
    const f = fakeContents();
    const openExternal = vi.fn();
    guardContents(f.wc, { wishlist: WISH, openExternal });
    for (const url of ["https://evil.example.test/", "http://store.example.test/app/9/", "javascript:alert(1)", "file:///etc/passwd", "app://game/index.html", "https://store.example.test/app/9", "https://store.example.test/app/9/?x=1", "", "about:blank"]) {
      expect(f.open(url)).toEqual({ action: "deny" });
    }
    expect(openExternal).not.toHaveBeenCalled();
    expect(f.open(WISH)).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(WISH);
  });
  it("with no wish-list configured nothing is ever opened", () => {
    const f = fakeContents();
    const openExternal = vi.fn();
    guardContents(f.wc, { wishlist: undefined, openExternal });
    expect(f.open(WISH)).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
