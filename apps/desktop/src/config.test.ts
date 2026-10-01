import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_URL, loadConfig, normalizeServerUrl, serverOrigins } from "./config.ts";
import { startUpdater } from "./updater.ts";

describe("loadConfig", () => {
  it("defaults: the hosted test server, no wish list, Steam off, updates off", () => {
    expect(loadConfig({})).toEqual({ serverUrl: DEFAULT_SERVER_URL, wishlist: undefined, steam: "off", updates: { enabled: false, feedUrl: undefined } });
  });
  it("CB_SERVER_URL accepts http(s)/ws(s), reduces it to an origin, and ignores everything else", () => {
    expect(loadConfig({ CB_SERVER_URL: "ws://localhost:2567/" }).serverUrl).toBe("http://localhost:2567");
    expect(loadConfig({ CB_SERVER_URL: "wss://x.example.test/path?q=1" }).serverUrl).toBe("https://x.example.test");
    for (const bad of ["", "ftp://x.test", "javascript:alert(1)", "file:///etc", "https://user:pw@x.test", "not a url", "x".repeat(400), "https://"]) expect(loadConfig({ CB_SERVER_URL: bad }).serverUrl, bad).toBe(DEFAULT_SERVER_URL);
    expect(normalizeServerUrl(5)).toBeUndefined();
    expect(serverOrigins("https://x.test")).toEqual(["https://x.test", "wss://x.test"]);
    expect(serverOrigins("http://x.test:81")).toEqual(["http://x.test:81", "ws://x.test:81"]);
  });
  it("the wish-list page is https or nothing", () => {
    expect(loadConfig({ CB_WISHLIST_URL: "https://store.example.test/app/1" }).wishlist).toBe("https://store.example.test/app/1");
    for (const bad of ["http://store.example.test/", "javascript:alert(1)", "data:text/html,x", "", "garbage"]) expect(loadConfig({ CB_WISHLIST_URL: bad }).wishlist, bad).toBeUndefined();
  });
});

describe("updates are OFF by default and need BOTH switches", () => {
  const impl = () => ({ check: vi.fn(async () => {}) });
  it("off with neither, with only the flag, with only a feed, and with a non-https feed", () => {
    for (const env of [{}, { CB_UPDATES: "1" }, { CB_UPDATE_FEED: "https://updates.example.test/feed" }, { CB_UPDATES: "1", CB_UPDATE_FEED: "http://updates.example.test/feed" }, { CB_UPDATES: "true", CB_UPDATE_FEED: "https://updates.example.test/feed" }, { CB_UPDATES: "0", CB_UPDATE_FEED: "https://updates.example.test/feed" }]) {
      const i = impl();
      const cfg = loadConfig(env);
      expect(cfg.updates.enabled, JSON.stringify(env)).toBe(false);
      const h = startUpdater(cfg.updates, i, () => {});
      expect(h.enabled).toBe(false);
      expect(i.check).not.toHaveBeenCalled();
    }
  });
  it("on only with the flag AND an https feed, and then it calls only the implementation it was given", async () => {
    const cfg = loadConfig({ CB_UPDATES: "1", CB_UPDATE_FEED: "https://updates.example.test/feed" });
    expect(cfg.updates).toEqual({ enabled: true, feedUrl: "https://updates.example.test/feed" });
    const i = impl();
    const h = startUpdater(cfg.updates, i, () => {});
    expect(h.started).toBe(true);
    expect(i.check).toHaveBeenCalledExactlyOnceWith("https://updates.example.test/feed");
    const log = vi.fn();
    const none = startUpdater(cfg.updates, undefined, log);
    expect(none).toMatchObject({ enabled: true, started: false });
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("a failing check is logged, never thrown", async () => {
    const log = vi.fn();
    startUpdater({ enabled: true, feedUrl: "https://u.example.test/" }, { check: async () => { throw new Error("offline"); } }, log);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });
});
