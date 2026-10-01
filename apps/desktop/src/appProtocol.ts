import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { APP_ORIGIN, APP_SCHEME } from "./config.ts";

/**
 * The `app://game/...` protocol (D-036, package D): serves ONLY files under the built client's root. The client is loaded from disk with no network, through a standard and secure
 * custom scheme (so `fetch`, storage and secure-context APIs behave like a real origin) with `supportFetchAPI` and `corsEnabled` OFF (no other page may fetch it).
 *
 * Path policy is a WHITELIST, not a blacklist: after the origin, every segment must match `[A-Za-z0-9._@~-]` (what the bundler emits), may not be made only of dots, and may not be empty.
 * So `..`, `%2e%2e` or ANY percent-escape, a backslash, a NUL, a drive letter, a colon, an absolute or doubled slash and a trailing slash are all simply 404. After that the path
 * is resolved through `realpath` and must still lie under the real root and be a regular file, which defeats a symlink that points out of the tree.
 */
export const SEGMENT = /^[A-Za-z0-9._@~-]{1,200}$/;

/** The path segments below the root for an `app://game/...` URL, or undefined when the URL is anything else. */
export function appPathOf(rawUrl: unknown): string[] | undefined {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048 || !rawUrl.startsWith(APP_ORIGIN)) return undefined;
  let rest = rawUrl.slice(APP_ORIGIN.length);
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  if (rest === "" || rest === "/") rest = "/index.html";
  if (rest[0] !== "/") return undefined; // app://gamex/..., app://game@host/...
  const segs = rest.slice(1).split("/");
  for (const s of segs) if (!SEGMENT.test(s) || /^\.+$/.test(s)) return undefined;
  return segs;
}

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8", wasm: "application/wasm", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", txt: "text/plain; charset=utf-8", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav",
};
export const contentTypeOf = (name: string): string => TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

export interface AppRequest { url: string; method?: string }

/** Headers added to every response the protocol makes (the CSP is passed in so this file stays free of policy text). */
export function createAppHandler(root: string, csp: string): (req: AppRequest) => Promise<Response> {
  let realRoot: Promise<string> | undefined;
  const notFound = (status = 404): Response => new Response(status === 404 ? "Not found" : "Method not allowed", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" } });
  return async (req) => {
    try {
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") return notFound(405);
      const segs = appPathOf(req.url);
      if (!segs) return notFound();
      realRoot ??= realpath(root);
      const base = await realRoot;
      const real = await realpath(join(base, ...segs));
      if (real !== base && !real.startsWith(base + sep)) return notFound();
      const st = await stat(real);
      if (!st.isFile()) return notFound();
      const body = method === "HEAD" ? null : new Uint8Array(await readFile(real));
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": contentTypeOf(segs[segs.length - 1]!), "Content-Length": String(st.size), "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache", "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    } catch {
      return notFound(); // a missing file, a dangling link, a permission error: never a stack trace, never a hint
    }
  };
}

/** Called BEFORE `app.ready`: the scheme's privileges. Standard + secure; no fetch from other origins, no CORS. */
export function registerAppScheme(protocol: { registerSchemesAsPrivileged(s: { scheme: string; privileges: Record<string, boolean> }[]): void }): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, bypassCSP: false, stream: true } }]);
}

/** Called after `app.ready`. */
export function handleAppProtocol(protocol: { handle(scheme: string, h: (req: Request) => Promise<Response>): void }, root: string, csp: string): void {
  const h = createAppHandler(root, csp);
  protocol.handle(APP_SCHEME, (req) => h(req));
}
