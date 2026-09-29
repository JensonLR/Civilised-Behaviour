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
  /** Artificial round-trip latency in ms for bad-network testing. Never set in production. */
  simulatedLatencyMs: number;
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

  const routSeconds = Number(env.ROUT_SECONDS ?? 8);
  if (!Number.isFinite(routSeconds) || routSeconds < 0.5 || routSeconds > 120) errors.push("ROUT_SECONDS must be 0.5-120");

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (nodeEnv === "production" && allowedOrigins.length === 0) errors.push("ALLOWED_ORIGINS required in production");

  // Optional until persistence lands (M10); the server then runs campaigns in memory only.
  const databaseUrl = env.DATABASE_URL || undefined;

  if (errors.length) throw new Error(`Invalid server configuration:\n - ${errors.join("\n - ")}`);
  return { nodeEnv, port, allowedOrigins, logLevel, databaseUrl, debugCommands, routSeconds, simulatedLatencyMs };
}
