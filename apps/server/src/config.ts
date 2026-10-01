import { WORLD_CLOCK } from "@cb/shared";
import { persistenceConfig, type PersistenceConfig } from "./persistence/saver.ts";
import { parseDemoEnv, type DemoConfig } from "./systems/Demo.ts";

/** Environment validation. Fails fast with a readable message rather than half-booting. */
export interface ServerConfig {
  nodeEnv: "development" | "production" | "test";
  port: number;
  /** Comma-separated origins allowed for browser HTTP calls (matchmaking). Empty = allow all in dev. */
  allowedOrigins: string[];
  logLevel: "debug" | "info" | "warn" | "error";
  /** Postgres URL. Optional until persistence lands (M10); server runs in-memory without it. */
  databaseUrl: string | undefined;
  /** Enables QA debug commands (teleport, spawn...). Defaults on outside production; forbidden in production. */
  debugCommands: boolean;
  /** Seconds with every connected player downed before the party is hauled back up. */
  routSeconds: number;
  /** Server-wide default for the campaign rule "dismemberment" (creators can still switch it off for their campaign). */
  dismemberment: boolean;
  /** Server-wide default for the campaign rule "friendly fire" (default on, GDD: creators can switch it off for their campaign). */
  friendlyFire: boolean;
  /** The clock hour a new world starts at (0..24). Env DAY_START_HOUR, default 9. */
  dayStartHour: number;
  /** Real minutes a full day takes; 0 freezes the clock. Env DAY_MINUTES, default 30. */
  dayMinutes: number;
  /** Artificial round-trip latency in ms for bad-network testing. Never set in production. */
  simulatedLatencyMs: number;
  /** Where campaigns are saved (CAMPAIGN_STORE=memory|file|postgres, SAVE_DIR, DATABASE_URL, IDENTITY_PEPPER, SAVE_RETENTION_DAYS; D-035). Default: memory. */
  persistence: PersistenceConfig;
  /** The bounded web demo (DEMO_MODE=1, DEMO_SESSION_SECONDS only outside production; D-036). Garbage means off. */
  demo: DemoConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const errors: string[] = [];
  const nodeEnv = (env.NODE_ENV ?? "development") as ServerConfig["nodeEnv"];
  if (!["development", "production", "test"].includes(nodeEnv)) errors.push(`NODE_ENV invalid: ${nodeEnv}`);

  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`PORT invalid: ${env.PORT}`);

  const logLevel = (env.LOG_LEVEL ?? "info") as ServerConfig["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) errors.push(`LOG_LEVEL invalid: ${logLevel}`);

  const simulatedLatencyMs = Number(env.SIMULATED_LATENCY_MS ?? 0);
  if (!Number.isFinite(simulatedLatencyMs) || simulatedLatencyMs < 0) errors.push("SIMULATED_LATENCY_MS invalid");
  if (nodeEnv === "production" && simulatedLatencyMs > 0) errors.push("SIMULATED_LATENCY_MS must be 0 in production");

  const debugCommands = env.DEBUG_COMMANDS ? env.DEBUG_COMMANDS === "1" : nodeEnv !== "production";
  if (nodeEnv === "production" && debugCommands) errors.push("DEBUG_COMMANDS must not be enabled in production");

  const dismemberment = env.DISMEMBERMENT ? env.DISMEMBERMENT !== "0" : true;
  const friendlyFire = env.FRIENDLY_FIRE ? env.FRIENDLY_FIRE !== "0" : true;
  const routSeconds = Number(env.ROUT_SECONDS ?? 8);
  if (!Number.isFinite(routSeconds) || routSeconds < 0.5 || routSeconds > 120) errors.push("ROUT_SECONDS must be 0.5-120");

  const dayStartHour = Number(env.DAY_START_HOUR ?? WORLD_CLOCK.defaultStartHour);
  if (!Number.isFinite(dayStartHour) || dayStartHour < 0 || dayStartHour >= 24) errors.push("DAY_START_HOUR must be 0-24 (exclusive)");
  const dayMinutes = Number(env.DAY_MINUTES ?? WORLD_CLOCK.defaultDayMinutes);
  if (!Number.isFinite(dayMinutes) || (dayMinutes !== 0 && (dayMinutes < WORLD_CLOCK.minDayMinutes || dayMinutes > WORLD_CLOCK.maxDayMinutes))) errors.push(`DAY_MINUTES must be 0 (frozen) or ${WORLD_CLOCK.minDayMinutes}-${WORLD_CLOCK.maxDayMinutes}`);

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (nodeEnv === "production" && allowedOrigins.length === 0) errors.push("ALLOWED_ORIGINS required in production");

  // Optional until persistence lands (M10); the server then runs campaigns in memory only.
  const databaseUrl = env.DATABASE_URL || undefined;

  let persistence!: PersistenceConfig;
  try {
    persistence = persistenceConfig(env);
  } catch (e) {
    errors.push(e instanceof Error ? e.message.replace(/^Invalid persistence configuration:\n - /, "").replace(/\n - /g, "; ") : "persistence configuration invalid");
  }

  if (errors.length) throw new Error(`Invalid server configuration:\n - ${errors.join("\n - ")}`);
  return { nodeEnv, port, allowedOrigins, logLevel, databaseUrl, debugCommands, routSeconds, dismemberment, friendlyFire, dayStartHour, dayMinutes, simulatedLatencyMs, persistence, demo: parseDemoEnv(env) };
}
