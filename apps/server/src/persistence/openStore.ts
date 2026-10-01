import { FileStore } from "./fileStore.ts";
import { MemoryStore } from "./memoryStore.ts";
import { openPostgresStore } from "./pgStore.ts";
import { DAY_MS, type CampaignStore, type Logger } from "./types.ts";
import type { PersistenceConfig } from "./saver.ts";

/**
 * Builds the configured store. A store that fails to open (bad URL, unreadable directory, database down) DOWNGRADES to memory with a
 * loud error, never a crash: the game must still boot; campaigns just will not survive a restart until the operator fixes it.
 */
export async function openStore(cfg: PersistenceConfig, log: Logger): Promise<{ store: CampaignStore; kind: "memory" | "file" | "postgres"; downgraded: boolean }> {
  try {
    if (cfg.kind === "file") {
      const store = new FileStore({ dir: cfg.saveDir });
      await store.list("probe"); // proves the directory is readable (or absent, which is fine) before we trust it
      return { store, kind: "file", downgraded: false };
    }
    if (cfg.kind === "postgres") return { store: await openPostgresStore(cfg.databaseUrl as string), kind: "postgres", downgraded: false };
  } catch (e) {
    log.error("persistence.open_failed", { wanted: cfg.kind, err: e instanceof Error ? e.message.slice(0, 200) : "error" });
    log.warn("persistence.downgraded_to_memory", { note: "campaigns will NOT survive a restart until the store is fixed" });
    return { store: new MemoryStore(), kind: "memory", downgraded: true };
  }
  return { store: new MemoryStore(), kind: "memory", downgraded: false };
}

/** Retention: run at boot and daily. Dormant campaigns older than `retentionDays` are deleted (docs/PRIVACY_DATA_MAP.md). Never throws. */
export async function purgeExpired(store: CampaignStore, retentionDays: number, log: Logger): Promise<number> {
  try {
    const n = await store.purgeDormant(retentionDays * DAY_MS);
    if (n > 0) log.info("persistence.purged", { campaigns: n, retentionDays });
    return n;
  } catch (e) {
    log.error("persistence.purge_failed", { err: e instanceof Error ? e.name : "error" });
    return 0;
  }
}
