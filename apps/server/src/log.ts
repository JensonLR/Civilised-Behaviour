type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = "info";
let silent = false;

export function configureLogger(level: Level, opts: { silent?: boolean } = {}): void {
  threshold = level;
  silent = opts.silent ?? false;
}

/** One JSON object per line on stdout; Railway and most log shippers parse this natively. */
function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (silent || ORDER[level] < ORDER[threshold]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
