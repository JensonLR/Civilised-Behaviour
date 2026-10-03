import { Server, ServerError, createEndpoint, createRouter, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_WORLD, isValidJoinCode } from "@cb/shared";
import { clientIp } from "./clientIp.ts";
import type { ServerConfig } from "./config.ts";
import { LoadGauge, DEFAULT_LOAD } from "./load.ts";
import { log } from "./log.ts";
import { metrics } from "./metrics.ts";
import { createOriginPolicy, installMatchmakingOriginPolicy, originUpgradeGuard } from "./origins.ts";
import { RateLimiter } from "./ratelimit.ts";
import { setRoomConfig } from "./roomConfig.ts";
import { createPersistence } from "./persistence/runtime.ts";
import { WorldRoom } from "./rooms/WorldRoom.ts";

/** Code lookups are the only unauthenticated enumeration surface: 10 burst, then 1 per 6 s per IP. */
const codeLookupLimiter = new RateLimiter(10, 1 / 6);

/** Matchmaking methods that start a room (a new campaign, a resume): the expensive ones (a world, a cast, a 30 Hz tick, a save record). */
const CREATES = new Set(["create", "joinOrCreate"]);

export function createGameServer(config: ServerConfig, load: LoadGauge = new LoadGauge({ ...DEFAULT_LOAD, maxLagMs: config.shedLagMs })): Server {
  const origins = createOriginPolicy(config.allowedOrigins);
  const persistence = createPersistence(config.persistence, log);
  setRoomConfig({ debugCommands: config.debugCommands, routSeconds: config.routSeconds, dismemberment: config.dismemberment, friendlyFire: config.friendlyFire, dayStartHour: config.dayStartHour, dayMinutes: config.dayMinutes, persistence, demo: config.demo });
  const health = createEndpoint("/health", { method: "GET" }, async (ctx) =>
    ctx.json({ ok: true, env: config.nodeEnv, uptimeS: Math.round(process.uptime()) }),
  );
  const metricsEndpoint = createEndpoint("/metrics", { method: "GET" }, async (ctx) => ctx.json({ ...metrics.snapshot(), lagMs: Math.round(load.lagMs * 10) / 10, shedding: load.busy() }));

  // Join-by-code: resolves a private campaign's room id. The client then joins by id.
  const lookup = createEndpoint("/campaign/:code", { method: "GET" }, async (ctx) => {
    if (!origins.allows(ctx.request?.headers.get("origin"))) {
      ctx.setStatus(403);
      return ctx.json({ error: "origin_not_allowed" });
    }
    const code = String(ctx.params?.code ?? "").toUpperCase();
    if (!codeLookupLimiter.take(clientIp(ctx.request?.headers, undefined, config.clientIp))) {
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
  // Room creation was unlimited (security review, D-048): one script could start rooms (and save records) faster than the one game thread can tick them.
  const createLimiter = config.roomCreate ? new RateLimiter(config.roomCreate.burst, 1 / config.roomCreate.everyS) : undefined;
  const restoreMatchmaking = installMatchmakingOriginPolicy(origins, (method, auth) => {
    if (!CREATES.has(method)) return;
    if ((config.maxRooms > 0 && metrics.rooms >= config.maxRooms) || load.busy()) throw new ServerError(503, "The Society's offices are full just now. Try again in a few minutes.");
    if (createLimiter && !createLimiter.take(clientIp(auth?.headers, auth?.ip, config.clientIp))) throw new ServerError(429, "Too many new expeditions from here at once. Wait a moment and try again.");
  });
  load.start();
  server.onShutdown(async () => {
    load.stop();
    restoreMatchmaking();
    await persistence.close();
    log.info("server.shutdown");
  });
  if (config.allowedOrigins.length === 0) log.warn("server.origins_open", { note: "ALLOWED_ORIGINS empty: all browser origins accepted" });
  return server;
}
