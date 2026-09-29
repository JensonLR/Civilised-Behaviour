import { ErrorCode, ServerError, matchMaker, type BeforeUpgradeHandler } from "@colyseus/core";

/**
 * Browser-origin policy. Protects against cross-site pages (cross-site WebSocket hijacking, blind
 * room creation) - it is NOT authentication: non-browser clients send no Origin header and pass.
 *
 * - list empty  -> allow everything (development/test; production config requires a non-empty list)
 * - no Origin   -> allow (curl, native tools, server-to-server)
 * - otherwise   -> exact, case-insensitive match against the list (no wildcards, no trailing slash)
 */
export interface OriginPolicy {
  allows(origin: string | null | undefined): boolean;
  /** The single value to send in Access-Control-Allow-Origin for a request from `origin`. */
  corsOrigin(origin: string | null | undefined): string;
}

const normalize = (o: string): string => o.trim().toLowerCase().replace(/\/+$/, "");

export function createOriginPolicy(allowed: readonly string[]): OriginPolicy {
  const set = new Set(allowed.map(normalize).filter(Boolean));
  const open = set.size === 0;
  const allows = (origin: string | null | undefined): boolean => {
    if (open || origin === null || origin === undefined || origin === "") return true;
    return set.has(normalize(origin));
  };
  return {
    allows,
    // A disallowed origin gets a value that can never match, so the browser blocks the response.
    corsOrigin: (origin) => (open ? (origin || "*") : origin && allows(origin) ? origin : [...set][0] ?? "null"),
  };
}

/** `beforeUpgrade` hook for the WebSocket transport: refuses cross-origin upgrades with 403. */
export function originUpgradeGuard(policy: OriginPolicy): BeforeUpgradeHandler {
  return (request) => {
    if (!policy.allows(request.headers.get("origin"))) return new Response("origin not allowed", { status: 403 });
  };
}

/**
 * Applies the policy to Colyseus's matchmaking HTTP surface: disallowed origins cannot create/join
 * rooms, and CORS headers stop reflecting arbitrary origins with credentials. Patches the shared
 * matchmaking controller (Colyseus documents overriding getCorsHeaders); returns a restore function.
 */
export function installMatchmakingOriginPolicy(policy: OriginPolicy): () => void {
  const c = matchMaker.controller;
  const original = {
    invokeMethod: c.invokeMethod,
    getCorsHeaders: c.getCorsHeaders,
    cors: { ...c.DEFAULT_CORS_HEADERS },
  };

  c.invokeMethod = function (this: typeof c, method, roomName, clientOptions, authContext) {
    const origin = authContext?.headers?.get?.("origin");
    if (!policy.allows(origin)) throw new ServerError(ErrorCode.AUTH_FAILED, "origin not allowed");
    return original.invokeMethod.call(this, method, roomName, clientOptions, authContext);
  };
  c.getCorsHeaders = (headers: Headers) => ({
    "Access-Control-Allow-Origin": policy.corsOrigin(headers.get("origin")),
    Vary: "Origin",
  });
  // Credentials are never used (no cookies); do not advertise them.
  delete (c.DEFAULT_CORS_HEADERS as Record<string, string>)["Access-Control-Allow-Credentials"];

  return () => {
    c.invokeMethod = original.invokeMethod;
    c.getCorsHeaders = original.getCorsHeaders;
    Object.assign(c.DEFAULT_CORS_HEADERS, original.cors);
  };
}
