import { Server, createEndpoint, createRouter, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_WORLD, isValidJoinCode } from "@cb/shared";
import type { ServerConfig } from "./config.ts";
import { log } from "./log.ts";
import { metrics } from "./metrics.ts";
import { createOriginPolicy, installMatchmakingOriginPolicy, originUpgradeGuard } from "./origins.ts";
import { RateLimiter } from "./ratelimit.ts";
import { setRoomConfig } from "./roomConfig.ts";
import { WorldRoom } from "./rooms/WorldRoom.ts";

/** Code lookups are the only unauthenticated enumeration surface: 10 burst, then 1 per 6 s per IP. */
const codeLookupLimiter = new RateLimiter(10, 1 / 6);

function clientIp(request: Request | undefined): string {
  const fwd = request?.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

export function createGameServer(config: ServerConfig): Server {
  const origins = createOriginPolicy(config.allowedOrigins);
  setRoomConfig({ debugCommands: config.debugCommands, routSeconds: config.routSeconds });
  const health = createEndpoint("/health", { method: "GET" }, async (ctx) =>
    ctx.json({ ok: true, env: config.nodeEnv, uptimeS: Math.round(process.uptime()) }),
  );
  const metricsEndpoint = createEndpoint("/metrics", { method: "GET" }, async (ctx) => ctx.json(metrics.snapshot()));

  // Join-by-code: resolves a private campaign's room id. The client then joins by id.
  const lookup = createEndpoint("/campaign/:code", { method: "GET" }, async (ctx) => {
    if (!origins.allows(ctx.request?.headers.get("origin"))) {
      ctx.setStatus(403);
      return ctx.json({ error: "origin_not_allowed" });
    }
    const code = String(ctx.params?.code ?? "").toUpperCase();
    if (!codeLookupLimiter.take(clientIp(ctx.request))) {
      ctx.setStatus(429);
      return ctx.json({ error: "rate_limited" });
    }
    if (!isValidJoinCode(code)) {
      ctx.setStatus(400);
      return ctx.json({ error: "invalid_code" });
    }
    const rooms = await matchMaker.query({ name: ROOM_WORLD });
    const hit = rooms.find((r) => (r.metadata as { code?: string } | undefined)?.code === code);
    if (!hit || hit.locked || hit.clients >= hit.maxClients) {
      ctx.setStatus(404);
      return ctx.json({ error: hit ? "full" : "not_found" });
    }
    return ctx.json({ roomId: hit.roomId, clients: hit.clients, maxClients: hit.maxClients });
  });

  const server = new Server({
    transport: new WebSocketTransport({ beforeUpgrade: originUpgradeGuard(origins) }),
    gracefullyShutdown: true,
    greet: false,
  });
  server.router = createRouter({ health, metrics: metricsEndpoint, lookup }) as never;
  server.define(ROOM_WORLD, WorldRoom);
  const restoreMatchmaking = installMatchmakingOriginPolicy(origins);
  server.onShutdown(() => {
    restoreMatchmaking();
    log.info("server.shutdown");
  });
  if (config.allowedOrigins.length === 0) log.warn("server.origins_open", { note: "ALLOWED_ORIGINS empty: all browser origins accepted" });
  return server;
}
