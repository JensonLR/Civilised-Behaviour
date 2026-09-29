import { loadConfig } from "./config.ts";
import { createGameServer } from "./app.ts";
import { configureLogger, log } from "./log.ts";

const config = loadConfig();
configureLogger(config.logLevel);
const server = createGameServer(config);
if (config.simulatedLatencyMs > 0) {
  server.simulateLatency(config.simulatedLatencyMs);
  log.warn("server.simulated_latency", { ms: config.simulatedLatencyMs });
}
await server.listen(config.port);
log.info("server.listening", { port: config.port, env: config.nodeEnv });
