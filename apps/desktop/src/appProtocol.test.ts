import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Rng } from "@cb/shared";
import { appPathOf, contentTypeOf, createAppHandler, handleAppProtocol, registerAppScheme } from "./appProtocol.ts";

const CSP = "default-src 'none'";
let base: string;
let root: string;
let outside: string;
let handler: ReturnType<typeof createAppHandler>;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "cb-app-"));
  root = join(base, "client");
  outside = join(base, "outside");
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html><title>cb</title>");
  writeFileSync(join(root, "assets", "main-Ab1_-9.js"), "console.log(1)");
  writeFileSync(join(root, "assets", "rapier.wasm"), new Uint8Array([0, 0x61, 0x73, 0x6d]));
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
  symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));        // a file link out of the tree
  symlinkSync(outside, join(root, "linkdir"));                              // a directory link out of the tree
  symlinkSync(join(root, "index.html"), join(root, "alias.html"));          // a link that stays inside: fine
  handler = createAppHandler(root, CSP);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const get = (url: string, method = "GET") => handler({ url, method });

describe("the app protocol", () => {
  it("serves the built client from disk with the network OFF, and the right types", async () => {
    const net = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network is off"));
    try {
      for (const [url, type, body] of [
        ["app://game/", "text/html; charset=utf-8", "<!doctype html><title>cb</title>"],
        ["app://game/index.html", "text/html; charset=utf-8", "<!doctype html><title>cb</title>"],
        ["app://game/index.html?x=1#frag", "text/html; charset=utf-8", "<!doctype html><title>cb</title>"],
        ["app://game/assets/main-Ab1_-9.js", "text/javascript; charset=utf-8", "console.log(1)"],
        ["app://game/alias.html", "text/html; charset=utf-8", "<!doctype html><title>cb</title>"],
      ] as const) {
        const r = await get(url);
        expect(r.status, url).toBe(200);
        expect(r.headers.get("content-type")).toBe(type);
        expect(r.headers.get("content-security-policy")).toBe(CSP);
        expect(r.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await r.text()).toBe(body);
      }
      const wasm = await get("app://game/assets/rapier.wasm");
      expect(wasm.headers.get("content-type")).toBe("application/wasm");
      expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 0x61, 0x73, 0x6d]));
      const head = await get("app://game/index.html", "HEAD");
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(net).not.toHaveBeenCalled();
    } finally {
      net.mockRestore();
    }
  });

  it("every named escape is a 404, with the CSP still on the response", async () => {
    const escapes = [
      "app://game/../outside/secret.txt", "app://game/assets/../../outside/secret.txt", "app://game/%2e%2e/outside/secret.txt", "app://game/%2E%2E%2Foutside%2Fsecret.txt",
      "app://game/..%2foutside/secret.txt", "app://game/assets/%2e%2e/%2e%2e/outside/secret.txt", "app://game/..\\outside\\secret.txt", "app://game/assets\\..\\..\\outside\\secret.txt",
      "app://game//etc/passwd", "app://game/etc/passwd\0.js", "app://game/index.html%00.png", "app://game/index.html\0", "app://game/C:/Windows/win.ini", "app://game/c:\\windows\\win.ini",
      "app://game/%2fetc%2fpasswd", "app://game/..", "app://game/.", "app://game/assets/", "app://game/assets/.", "app://game/assets", "app://gamex/index.html", "app://game@evil.test/index.html",
      "app://evil.test/index.html", "file:///etc/passwd", "https://game/index.html", "app:/game/index.html", "app://game:80/index.html",
      "app://game/link.txt", "app://game/linkdir/secret.txt", "app://game/linkdir", "app://game/%6cink.txt", "app://game/nope.js", "app://game/assets/%00", "app://game/ index.html", "app://game/index.html ",
      "", "app://", "app://game" + "/a".repeat(2000),
    ];
    for (const u of escapes) {
      const r = await get(u);
      expect(r.status, u).toBe(404);
      expect(r.headers.get("content-security-policy")).toBe(CSP);
      expect(await r.text()).toBe("Not found");
    }
    for (const bad of [undefined, null, 5, {}, []]) expect((await handler({ url: bad as never })).status).toBe(404);
  });

  it("2000 hostile paths (traversal, encodings, separators, NULs, absolute, drive letters, unicode) are ALL 404", async () => {
    const rng = new Rng(0x5eed);
    const BAD = ["..", "%2e%2e", "%2E%2e", "%2f", "%5c", "\\", "\0", "%00", "C:", "c:", "//", ".", "...", "%", "%zz", "..;", "%c0%af", "..%c0%af", "\u2025", "\uff0e\uff0e", "a b", "é", "a:b", "~root/..", "CON\0", "link.txt", "linkdir", "../".repeat(8)];
    const OK = ["index.html", "assets", "main-Ab1_-9.js", "rapier.wasm", "x", "outside", "secret.txt", "etc", "passwd", "client"];
    let served = 0;
    for (let i = 0; i < 2000; i++) {
      const n = rng.int(1, 5);
      const parts: string[] = [];
      let hasBad = false;
      for (let k = 0; k < n; k++) {
        const bad = rng.next() < 0.45;
        hasBad ||= bad;
        parts.push(bad ? rng.pick(BAD) : rng.pick(OK));
      }
      if (!hasBad) parts.splice(rng.int(0, parts.length), 0, rng.pick(BAD));
      const url = `app://game/${parts.join(rng.next() < 0.5 ? "/" : "")}${rng.next() < 0.2 ? "?q=1" : ""}`;
      const r = await get(url);
      if (r.status === 200) served++;
      expect(r.status, url).toBe(404);
    }
    expect(served).toBe(0);
  });

  it("other methods are refused, and a hostile file name never reaches the disk path", async () => {
    for (const m of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) expect((await get("app://game/index.html", m)).status, m).toBe(405);
    expect(appPathOf("app://game/assets/main-Ab1_-9.js")).toEqual(["assets", "main-Ab1_-9.js"]);
    expect(appPathOf("app://game/a/../b")).toBeUndefined();
    expect(appPathOf("app://game/a%2fb")).toBeUndefined();
    expect(contentTypeOf("x.unknown")).toBe("application/octet-stream");
  });
});

describe("the scheme registration", () => {
  it("is standard and secure with NO fetch API and NO cors, declared as a privileged scheme", () => {
    const reg = vi.fn();
    registerAppScheme({ registerSchemesAsPrivileged: reg });
    const [[list]] = reg.mock.calls as [[{ scheme: string; privileges: Record<string, boolean> }[]]];
    expect(list).toHaveLength(1);
    expect(list[0]!.scheme).toBe("app");
    expect(list[0]!.privileges).toMatchObject({ standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, bypassCSP: false });
  });
  it("handle() answers through the same handler (the CSP rides on it)", async () => {
    let h: ((r: Request) => Promise<Response>) | undefined;
    handleAppProtocol({ handle: (_s, fn) => { h = fn; } }, root, CSP);
    const r = await h!(new Request("app://game/index.html"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toBe(CSP);
    expect((await h!(new Request("app://game/link.txt"))).status).toBe(404);
  });
});
