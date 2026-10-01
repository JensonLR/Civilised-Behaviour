import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_CHANNELS, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, type DesktopBridge, type DesktopInfo } from "@cb/shared";
import { describe, expect, it, vi } from "vitest";
import { INFO_ARG } from "./constants.ts";
import { buildBridge, type IpcRendererLike } from "./preload.ts";

const h = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(async () => true), on: vi.fn() }));
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld: h.expose }, ipcRenderer: { invoke: h.invoke, on: h.on } }));

const CODE = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);
const info = (steam: DesktopInfo["steam"]): string => `${INFO_ARG}${JSON.stringify({ version: "9.9.9", platform: "linux", packaged: true, steam, updates: "off" })}`;

function fakeIpc() {
  const invoked: [string, ...unknown[]][] = [];
  const listeners = new Map<string, (e: unknown, p: unknown) => void>();
  const ipc: IpcRendererLike = { invoke: async (c, ...a) => { invoked.push([c, ...a]); return true; }, on: (c, l) => { listeners.set(c, l); } };
  return { ipc, invoked, emit: (c: string, p: unknown) => listeners.get(c)?.(null, p) };
}

describe("the preload", () => {
  it("exposes exactly one global, `cbDesktop`, whose keys are exactly the DesktopBridge's", async () => {
    // evaluating the module against the fake electron IS the whole of what the page gets
    h.expose.mockClear();
    vi.resetModules();
    await import("./preload.ts");
    expect(h.expose).toHaveBeenCalledTimes(1);
    const [name, bridge] = h.expose.mock.calls[0] as unknown as [string, DesktopBridge];
    expect(name).toBe("cbDesktop");
    expect(Object.keys(bridge).sort()).toEqual(["info", "openWishlist", "platform", "quit"]);
    expect(Object.keys(bridge.platform).sort()).toEqual(["available", "init", "kind", "onInvite", "setPresence", "shutdown", "unlock"]);
    expect(Object.keys(bridge.info).sort()).toEqual(["packaged", "platform", "steam", "updates", "version"]);
    // no ipcRenderer, no require, no generic invoke anywhere on what the page can reach
    const flat = JSON.stringify(Object.keys(bridge).concat(Object.keys(bridge.platform)));
    expect(flat).not.toMatch(/ipc|invoke|send|require|process|eval/i);
    for (const v of Object.values(bridge)) expect(["function", "object"]).toContain(typeof v);
    expect(Object.isFrozen(bridge.info)).toBe(true);
    // only the electron API the sandbox allows: contextBridge and ipcRenderer
    const src = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
    expect([...src.matchAll(/from "electron"/g)]).toHaveLength(1);
    expect(src).toMatch(/import \{ contextBridge, ipcRenderer \} from "electron"/);
  });

  it("with Steam off (the default) the platform is unavailable and sends nothing", async () => {
    const f = fakeIpc();
    const b = buildBridge(f.ipc, ["x", info("web")]);
    expect(b.platform.available).toBe(false);
    expect(b.platform.kind).toBe("web");
    expect(await b.platform.init()).toBe(false);
    b.platform.unlock("first_crossing");
    b.platform.setPresence({ where: "menu", party: 1, day: 0 });
    expect(f.invoked).toEqual([]);
  });

  it("with the stub on, each method maps to ONE fixed channel with validated primitives", async () => {
    const f = fakeIpc();
    const b = buildBridge(f.ipc, ["x", info("steam-stub")]);
    expect(b.platform.available).toBe(true);
    expect(b.info.version).toBe("9.9.9");
    expect(await b.platform.init()).toBe(true);
    b.platform.unlock("first_crossing");
    b.platform.unlock("not_an_id" as never);
    b.platform.setPresence({ where: "region", region: "kessar", party: 2, day: 4, joinCode: CODE });
    b.platform.setPresence({ where: "menu", party: 1, day: 0, region: "atlantis" as never, joinCode: "bad", extra: 1 } as never);
    b.openWishlist();
    b.quit();
    await Promise.resolve();
    expect(f.invoked).toEqual([
      ["platform:init"],
      ["platform:unlock", "first_crossing"],
      ["platform:presence", { where: "region", party: 2, day: 4, region: "kessar", joinCode: CODE }],
      ["platform:presence", { where: "menu", party: 1, day: 0 }],
      ["shell:wishlist"],
      ["app:quit"],
    ]);
    for (const [ch] of f.invoked) expect((DESKTOP_CHANNELS as readonly string[]).includes(ch)).toBe(true);
  });

  it("invites: only a valid join code is delivered; one that arrives before the page subscribes is held (max four) and flushed", () => {
    const f = fakeIpc();
    const b = buildBridge(f.ipc, ["x", info("steam-stub")]);
    for (const bad of [undefined, null, {}, { joinCode: "x" }, { joinCode: 5 }, "ABCDE", [CODE], { joinCode: `${CODE}${CODE}` }]) f.emit("platform:invite", bad);
    for (let i = 0; i < 6; i++) f.emit("platform:invite", { joinCode: CODE });
    const got: string[] = [];
    const off = b.platform.onInvite((r) => got.push(r.joinCode));
    expect(got).toEqual([CODE, CODE, CODE, CODE]);
    f.emit("platform:invite", { joinCode: CODE });
    expect(got).toHaveLength(5);
    off();
    f.emit("platform:invite", { joinCode: CODE });
    expect(got).toHaveLength(5);
  });

  it("a failing main process never throws into the page", async () => {
    const ipc: IpcRendererLike = { invoke: async () => { throw new Error("main is gone"); }, on: () => undefined };
    const b = buildBridge(ipc, ["x", info("steam-stub")]);
    expect(await b.platform.init()).toBe(false);
    expect(() => { b.platform.unlock("first_crossing"); b.openWishlist(); b.quit(); }).not.toThrow();
  });
});

describe("the built preload bundle", () => {
  it("is small and requires nothing but electron (a sandboxed preload cannot)", async () => {
    const { buildDesktop } = await import("../scripts/build.mjs");
    const out = mkdtempSync(join(tmpdir(), "cb-pre-"));
    try {
      await buildDesktop({ outdir: out, env: {}, logLevel: "silent" });
      const pre = readFileSync(join(out, "preload.cjs"), "utf8");
      expect(pre.length).toBeLessThan(40_000);
      expect([...new Set([...pre.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]))]).toEqual(["electron"]);
      expect(pre).not.toMatch(/colyseus|node:fs|child_process|nodeIntegration/);
      const main = readFileSync(join(out, "main.cjs"), "utf8");
      expect(main).not.toMatch(/require\(["']steamworks/i);
      expect(main).toContain("https://civilised-behaviour-server.onrender.com");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
