import { ACHIEVEMENTS, DESKTOP_CHANNELS, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, Rng, createNoopPlatform, type DesktopInfo, type PlatformAdapter } from "@cb/shared";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_CHANNELS, isAppSender, parsePresence, registerIpc, type IpcEventLike } from "./ipc.ts";

const CODE = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);
const INFO: DesktopInfo = { version: "0.0.1", platform: "linux", packaged: false, steam: "steam-stub", updates: "off" };
const GOOD: IpcEventLike = { senderFrame: { url: "app://game/index.html", parent: null } };

function setup(over: Partial<{ wishlist: string | undefined }> = {}) {
  const handlers = new Map<string, (e: IpcEventLike, ...a: unknown[]) => unknown>();
  const removed: string[] = [];
  const platform = { ...createNoopPlatform(), init: vi.fn(async () => true), unlock: vi.fn(), setPresence: vi.fn(), kind: "steam-stub" as const, available: true } satisfies PlatformAdapter;
  const openExternal = vi.fn();
  const quit = vi.fn();
  const log = vi.fn();
  const dispose = registerIpc({ handle: (c, l) => handlers.set(c, l), removeHandler: (c) => { removed.push(c); } }, { info: () => INFO, platform, wishlist: "wishlist" in over ? over.wishlist : "https://store.example.test/app/1/", openExternal, quit, log });
  const call = (ch: string, e: IpcEventLike, ...a: unknown[]) => handlers.get(ch)!(e, ...a);
  return { handlers, removed, platform, openExternal, quit, log, call, dispose };
}

describe("the IPC surface", () => {
  it("has a handler for each request channel and for NOTHING else (no handler for an unlisted or main->renderer channel)", () => {
    const { handlers, dispose, removed } = setup();
    expect([...handlers.keys()].sort()).toEqual([...REQUEST_CHANNELS].sort());
    for (const ch of handlers.keys()) expect((DESKTOP_CHANNELS as readonly string[]).includes(ch)).toBe(true);
    for (const ch of ["platform:invite", "app:eval", "shell:open", "fs:read", "ipc:invoke", "", "__proto__", "app:info "]) expect(handlers.has(ch), ch).toBe(false);
    expect(REQUEST_CHANNELS).toHaveLength(DESKTOP_CHANNELS.length - 1);
    dispose();
    expect(removed.sort()).toEqual([...REQUEST_CHANNELS].sort());
  });

  it("a forged or foreign sender frame is refused on EVERY channel: nothing is called, nothing leaks", async () => {
    const s = setup();
    const forged: (IpcEventLike | undefined)[] = [
      undefined, {}, { senderFrame: null }, { senderFrame: { url: "https://evil.example.test/" } }, { senderFrame: { url: "file:///etc/passwd" } }, { senderFrame: { url: "app://gamex/index.html" } },
      { senderFrame: { url: "app://game.evil.test/" } }, { senderFrame: { url: "app://game/index.html", parent: { url: "app://game/index.html" } } }, { senderFrame: { url: 5 as never } }, { senderFrame: { url: "" } },
    ];
    for (const ch of REQUEST_CHANNELS) {
      for (const e of forged) {
        const r = await s.call(ch, e as IpcEventLike, ch === "platform:unlock" ? "first_crossing" : { where: "menu", party: 1, day: 0 });
        expect(r === false || r === undefined, `${ch} ${JSON.stringify(e)}`).toBe(true);
      }
    }
    expect(s.platform.init).not.toHaveBeenCalled();
    expect(s.platform.unlock).not.toHaveBeenCalled();
    expect(s.platform.setPresence).not.toHaveBeenCalled();
    expect(s.openExternal).not.toHaveBeenCalled();
    expect(s.quit).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalled();
    expect(isAppSender(GOOD)).toBe(true);
    expect(isAppSender({ senderFrame: { url: "app://game/index.html" } })).toBe(true);
  });

  it("app:info and platform:init answer the app page", async () => {
    const s = setup();
    expect(await s.call("app:info", GOOD)).toEqual(INFO);
    expect(await s.call("platform:init", GOOD)).toBe(true);
  });

  it("platform:unlock takes an achievement id and nothing else", async () => {
    const s = setup();
    for (const id of ACHIEVEMENTS) expect(await s.call("platform:unlock", GOOD, id)).toBe(true);
    expect(s.platform.unlock).toHaveBeenCalledTimes(ACHIEVEMENTS.length);
    s.platform.unlock.mockClear();
    for (const bad of [undefined, null, 0, "", "nope", "__proto__", "FIRST_CROSSING", ["first_crossing"], { id: "first_crossing" }, "first_crossing\0", "x".repeat(10_000)]) expect(await s.call("platform:unlock", GOOD, bad), String(bad)).toBe(false);
    expect(await s.call("platform:unlock", GOOD)).toBe(false);
    expect(s.platform.unlock).not.toHaveBeenCalled();
  });

  it("platform:presence validates every field and passes on a REBUILT object (extra fields never travel)", async () => {
    const s = setup();
    expect(await s.call("platform:presence", GOOD, { where: "region", region: "kessar", party: 3, day: 7, joinCode: CODE, evil: "x", __proto__: { polluted: 1 } })).toBe(true);
    expect(s.platform.setPresence).toHaveBeenCalledExactlyOnceWith({ where: "region", region: "kessar", party: 3, day: 7, joinCode: CODE });
    s.platform.setPresence.mockClear();
    const bad: unknown[] = [undefined, null, 5, "x", [], {}, { where: "menu" }, { where: "lava", party: 1, day: 0 }, { where: "menu", party: 0, day: 0 }, { where: "menu", party: 5, day: 0 }, { where: "menu", party: 1.5, day: 0 },
      { where: "menu", party: 1, day: -1 }, { where: "menu", party: 1, day: 10_000 }, { where: "menu", party: "1", day: 0 }, { where: "menu", party: 1, day: 0, region: "atlantis" }, { where: "menu", party: 1, day: 0, joinCode: "bad" },
      { where: "menu", party: NaN, day: 0 }, { where: "menu", party: Infinity, day: 0 }];
    for (const b of bad) expect(await s.call("platform:presence", GOOD, b), JSON.stringify(b)).toBe(false);
    expect(s.platform.setPresence).not.toHaveBeenCalled();
    expect(parsePresence({ where: "menu", party: 1, day: 0 })).toEqual({ where: "menu", party: 1, day: 0 });
  });

  it("shell:wishlist opens ONLY the configured https page and reads no argument; with none configured it opens nothing", async () => {
    const s = setup();
    expect(await s.call("shell:wishlist", GOOD, "https://evil.example.test/")).toBe(true);
    expect(s.openExternal).toHaveBeenCalledExactlyOnceWith("https://store.example.test/app/1/");
    const none = setup({ wishlist: undefined });
    expect(await none.call("shell:wishlist", GOOD)).toBe(false);
    expect(none.openExternal).not.toHaveBeenCalled();
  });

  it("app:quit quits; a throwing platform never leaks an error to the renderer", async () => {
    const s = setup();
    expect(await s.call("app:quit", GOOD)).toBe(true);
    expect(s.quit).toHaveBeenCalledTimes(1);
    s.platform.unlock.mockImplementation(() => { throw new Error("steam exploded"); });
    expect(await s.call("platform:unlock", GOOD, "first_crossing")).toBe(false);
  });

  it("2000 hostile payloads on every channel: no throw, no call to the platform", async () => {
    const s = setup();
    const rng = new Rng(77);
    const junk = (): unknown => {
      switch (rng.int(0, 9)) {
        case 0: return undefined;
        case 1: return null;
        case 2: return rng.next() * 1e9;
        case 3: return String.fromCharCode(...Array.from({ length: rng.int(0, 40) }, () => rng.int(0, 0xd7ff)));
        case 4: return { where: "menu", party: rng.int(-3, 9), day: rng.int(-3, 20000), joinCode: String.fromCharCode(rng.int(32, 126)).repeat(JOIN_CODE_LENGTH) };
        case 5: return [rng.next(), { a: 1 }];
        case 6: return { toString() { throw new Error("no"); } };
        case 7: return { where: { toString: () => "menu" }, party: 1, day: 0 };
        case 8: return true;
        default: return () => 1;
      }
    };
    for (let i = 0; i < 2000; i++) {
      for (const ch of ["platform:unlock", "platform:presence"]) await s.call(ch, GOOD, junk(), junk());
    }
    expect(s.platform.unlock).not.toHaveBeenCalled();
    // a randomly produced joinCode of one repeated printable character is occasionally valid; presence calls must then be fully valid objects
    for (const [p] of s.platform.setPresence.mock.calls as [[{ where: string; party: number; day: number; joinCode?: string }]]) {
      expect(["menu", "hq", "sailing", "region"]).toContain(p.where);
      expect(p.party).toBeGreaterThanOrEqual(1);
      expect(p.party).toBeLessThanOrEqual(4);
    }
  });
});
