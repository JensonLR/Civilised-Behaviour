import { DAY_MS, type CampaignStore, type Logger } from "./types.ts";
import { openStore, purgeExpired } from "./openStore.ts";
import type { PersistenceConfig } from "./saver.ts";

/**
 * The process's campaign store, opened lazily on first use (a room's `onCreate` awaits it) so building the server stays synchronous. Boot purges dormant campaigns
 * (retention) and a daily timer repeats it. A store that fails to open DOWNGRADES to memory with a loud log (`openStore`): the game must still boot.
 */
export interface PersistenceRuntime {
  readonly cfg: PersistenceConfig;
  store(): Promise<CampaignStore>;
  /** Which store is actually in use (after the first `store()` call), and whether it fell back to memory. */
  status(): { kind: "memory" | "file" | "postgres" | "unopened"; downgraded: boolean };
  close(): Promise<void>;
}

export function createPersistence(cfg: PersistenceConfig, log: Logger): PersistenceRuntime {
  let opening: Promise<CampaignStore> | undefined;
  let kind: "memory" | "file" | "postgres" | "unopened" = "unopened";
  let downgraded = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const open = async (): Promise<CampaignStore> => {
    const r = await openStore(cfg, log);
    kind = r.kind;
    downgraded = r.downgraded;
    await purgeExpired(r.store, cfg.retentionDays, log);
    timer = setInterval(() => void purgeExpired(r.store, cfg.retentionDays, log), DAY_MS);
    timer.unref();
    return r.store;
  };
  return {
    cfg,
    store: () => (opening ??= open()),
    status: () => ({ kind, downgraded }),
    async close(): Promise<void> {
      if (timer) clearInterval(timer);
      if (!opening) return;
      try {
        await (await opening).close();
      } catch {
        /* closing must never throw into shutdown */
      }
    },
  };
}
