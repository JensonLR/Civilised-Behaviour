import { metrics } from "../metrics.ts";
import { withMember } from "./record.ts";
import { identityKey } from "./identity.ts";
import type { Snapshot } from "./sections.ts";
import { type CampaignRecord, type CampaignStore, type Logger, type PlayerIdentity, type SaveResult } from "./types.ts";

export interface SaverOptions {
  now(): number;
  log: Logger;
  pepper: string;
  /** Backoff between attempts; tests inject an instant one. Default: real timers. */
  sleep?(ms: number): Promise<void>;
  /** Delays before retry 1..3 (ms). */
  backoffMs?: readonly number[];
}

const DEFAULT_BACKOFF = [100, 400, 1600] as const;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Saves ONE campaign's sections. Owned by the room. Guarantees: saves for a campaign run strictly one after another; a burst of
 * `saveNow` calls while one is in flight coalesces into a single follow-up carrying the LATEST sections; an `io` failure is retried
 * 3 times with backoff; a `conflict` means another process owns the campaign, so this saver STOPS (never overwrites); and nothing here
 * ever throws into the room (a failing store raises `metrics.saveFailures` and a log line).
 */
export class CampaignSaver {
  private rec: CampaignRecord | undefined;
  private rev = 0;
  private inFlight: Promise<void> | undefined;
  private pending: { snap: Snapshot; waiters: ((r: SaveResult) => void)[] } | undefined;
  private halted: SaveResult | undefined;
  private lastGood = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoff: readonly number[];

  constructor(
    private readonly store: CampaignStore,
    private readonly opts: SaverOptions,
  ) {
    this.sleep = opts.sleep ?? realSleep;
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  }

  /** Attach the record this room plays: freshly created (rev 0) or just loaded. Unknown sections in it are carried through verbatim. */
  bind(rec: CampaignRecord): void {
    this.rec = { ...rec, members: [...rec.members], sections: { ...rec.sections }, sectionVersions: { ...rec.sectionVersions } };
    this.rev = rec.rev;
    this.halted = undefined;
  }

  get record(): CampaignRecord | undefined {
    return this.rec;
  }
  /** True once another process was seen writing this campaign: the room plays on, unsaved. */
  get stopped(): boolean {
    return this.halted !== undefined;
  }

  /** Records a joiner (by HMAC key, never the raw id). Persisted by the next save. Returns the key. */
  addMember(identity: PlayerIdentity): string {
    const key = identityKey(identity, this.opts.pepper);
    if (this.rec) this.rec = withMember(this.rec, key);
    return key;
  }

  /** Saves `snap` (latest wins when calls overlap). Resolves with the outcome of the save that carried it. Never rejects. */
  saveNow(snap: Snapshot): Promise<SaveResult> {
    if (!this.rec) return Promise.resolve({ ok: false, reason: "invalid" });
    if (this.halted) return Promise.resolve(this.halted);
    return new Promise<SaveResult>((resolve) => {
      if (this.pending) {
        this.pending.snap = snap;
        this.pending.waiters.push(resolve);
      } else this.pending = { snap, waiters: [resolve] };
      this.inFlight ??= this.drain();
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = undefined;
        let result: SaveResult;
        try {
          result = await this.attempt(job.snap);
        } catch (e) {
          result = { ok: false, reason: "io" };
          this.opts.log.error("persistence.save.unexpected", { err: e instanceof Error ? e.name : "error" });
        }
        for (const w of job.waiters) w(result);
      }
    } finally {
      this.inFlight = undefined;
    }
  }

  private merged(snap: Snapshot): CampaignRecord {
    const rec = this.rec as CampaignRecord;
    return { ...rec, sections: { ...rec.sections, ...snap.sections }, sectionVersions: { ...rec.sectionVersions, ...snap.sectionVersions } };
  }

  /**
   * A save landed: take its sections and rev, but KEEP whatever `addMember` did while it was in flight (a joiner who arrives during a write must not be forgotten by the
   * follow-up save: the record the next save merges from is `this.rec`, not the stale copy this attempt started from).
   */
  private adopt(saved: CampaignRecord, rev: number): void {
    const cur = this.rec ?? saved;
    this.rec = { ...cur, sections: saved.sections, sectionVersions: saved.sectionVersions, rev };
  }

  private async attempt(snap: Snapshot): Promise<SaveResult> {
    const next = this.merged(snap);
    let last: SaveResult = { ok: false, reason: "io" };
    for (let i = 0; i <= this.backoff.length; i++) {
      if (i > 0) await this.sleep(this.backoff[i - 1] ?? 1000);
      try {
        last = await this.store.save(next, this.rev === 0 ? null : this.rev);
      } catch {
        last = { ok: false, reason: "io" };
      }
      if (last.ok) {
        this.rev = last.rev;
        this.adopt(next, last.rev);
        this.lastGood = this.opts.now();
        return last;
      }
      if (last.reason === "conflict") {
        // A retry after an `io` may collide with our own earlier write whose acknowledgement was lost: adopt it if the bytes are ours.
        const adopted = i > 0 ? await this.ownWrite(next) : undefined;
        if (adopted) {
          this.rev = adopted.rev;
          this.adopt(next, adopted.rev);
          this.lastGood = this.opts.now();
          return { ok: true, rev: adopted.rev };
        }
        this.halted = last;
        this.opts.log.error("persistence.save.conflict", { id: next.id, ours: this.rev, theirs: last.currentRev ?? null });
        metrics.saveFailures++;
        return last;
      }
      if (last.reason !== "io") {
        // too_large / invalid / too_new: retrying cannot help. Keep playing; the next save may be smaller.
        this.opts.log.error("persistence.save.rejected", { id: next.id, reason: last.reason });
        metrics.saveFailures++;
        return last;
      }
    }
    metrics.saveFailures++;
    const since = this.lastGood === 0 ? "never saved" : `${Math.round((this.opts.now() - this.lastGood) / 60000)} min since last good save`;
    this.opts.log.error("persistence.save.failed", { id: next.id, attempts: this.backoff.length + 1, since });
    return last;
  }

  private async ownWrite(next: CampaignRecord): Promise<{ rev: number } | undefined> {
    try {
      const cur = await this.store.load(next.id);
      if (!cur || cur.rev !== (this.rev === 0 ? 1 : this.rev + 1)) return undefined;
      const same = Object.keys(next.sections).length === Object.keys(cur.sections).length && Object.entries(next.sections).every(([k, v]) => cur.sections[k] === v);
      return same ? { rev: cur.rev } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Waits for everything queued or in flight, at most `timeoutMs` (the dispose path caps this at 5 s). Never rejects. */
  async flush(timeoutMs: number): Promise<void> {
    const done = (async () => {
      while (this.inFlight) await this.inFlight;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((r) => {
      timer = setTimeout(r, Math.max(0, timeoutMs));
    });
    try {
      await Promise.race([done, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export type PersistenceKind = "memory" | "file" | "postgres";

export interface PersistenceConfig {
  kind: PersistenceKind;
  saveDir: string;
  databaseUrl: string | undefined;
  pepper: string;
  retentionDays: number;
}

/** Placeholder pepper for dev and tests only; production with a real store must set IDENTITY_PEPPER (validated below). */
const DEV_PEPPER = "cb-dev-pepper-not-a-secret";

/** `CAMPAIGN_STORE` memory|file|postgres (default memory), `SAVE_DIR`, `DATABASE_URL`, `IDENTITY_PEPPER`, `SAVE_RETENTION_DAYS` (default 180). Throws a readable error. */
export function persistenceConfig(env: NodeJS.ProcessEnv = process.env): PersistenceConfig {
  const errors: string[] = [];
  const raw = (env.CAMPAIGN_STORE ?? "memory").trim().toLowerCase();
  if (raw !== "memory" && raw !== "file" && raw !== "postgres") errors.push(`CAMPAIGN_STORE must be memory, file or postgres (got "${env.CAMPAIGN_STORE}")`);
  const kind = (raw === "file" || raw === "postgres" ? raw : "memory") as PersistenceKind;
  const production = env.NODE_ENV === "production";

  const saveDir = (env.SAVE_DIR ?? "").trim() || "./data/saves";
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (kind === "postgres" && !databaseUrl) errors.push("DATABASE_URL required when CAMPAIGN_STORE=postgres");

  const pepperEnv = env.IDENTITY_PEPPER ?? "";
  if (kind !== "memory" && production && pepperEnv.length < 16) errors.push("IDENTITY_PEPPER (>= 16 chars) required in production when CAMPAIGN_STORE is not memory");
  const pepper = pepperEnv.length > 0 ? pepperEnv : DEV_PEPPER;

  const retentionDays = env.SAVE_RETENTION_DAYS === undefined || env.SAVE_RETENTION_DAYS === "" ? 180 : Number(env.SAVE_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) errors.push("SAVE_RETENTION_DAYS must be an integer 1-3650");

  if (errors.length) throw new Error(`Invalid persistence configuration:\n - ${errors.join("\n - ")}`);
  return { kind, saveDir, databaseUrl, pepper, retentionDays };
}
