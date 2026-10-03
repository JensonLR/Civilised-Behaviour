import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { log } from "../log.ts";
import { MIGRATION_LOCK, PG_MIGRATIONS } from "./pgMigrations.ts";
import { campaignMembers, campaigns, schemaVersion } from "./pgSchema.ts";
import { checkExpected, forgetInSections, precheck, stamped, validateRecord } from "./record.ts";
import type { CampaignRecord, CampaignStore, SaveResult } from "./types.ts";

/** Any Drizzle Postgres database: `drizzle-orm/postgres-js` in production, `drizzle-orm/pglite` in tests. The driver is injected. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PgDb = PgDatabase<any, any, any>;

export interface PgStoreOptions {
  now?: () => number;
  /** Closes the underlying client (postgres-js `end`). Not called for a caller-owned database. */
  close?: () => Promise<void>;
}

function pgCode(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 4; i++, x = (x as { cause?: unknown }).cause) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

function row(r: CampaignRecord) {
  return { id: r.id, code: r.code, seed: r.seed, rev: r.rev, savedAt: r.savedAt, owner: r.owner, sections: r.sections, sectionVersions: r.sectionVersions };
}

/**
 * Postgres through Drizzle. Optimistic concurrency is `UPDATE .. WHERE id = ? AND rev = ?` (zero rows = conflict), creation is
 * `INSERT .. ON CONFLICT DO NOTHING` (id and join code are both unique). `code` is unique across campaigns.
 */
export class PgStore implements CampaignStore {
  private readonly now: () => number;

  constructor(
    private readonly db: PgDb,
    private readonly opts: PgStoreOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Idempotent: applies pending embedded migrations, refuses a database written by a newer build. */
  async migrate(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${MIGRATION_LOCK})`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY, applied_at bigint NOT NULL)`);
      const applied = await tx.select({ v: schemaVersion.version }).from(schemaVersion);
      const have = new Set(applied.map((r) => r.v));
      const latest = PG_MIGRATIONS[PG_MIGRATIONS.length - 1]?.version ?? 0;
      const newest = Math.max(0, ...have);
      if (newest > latest) throw new Error(`database schema_version ${newest} is newer than this build (${latest}); refusing to start against it`);
      for (const m of PG_MIGRATIONS) {
        if (have.has(m.version)) continue;
        for (const s of m.statements) await tx.execute(sql.raw(s));
        await tx.insert(schemaVersion).values({ version: m.version, appliedAt: this.now() });
        log.info("persistence.pg.migrated", { version: m.version });
      }
    });
  }

  private async hydrate(c: typeof campaigns.$inferSelect): Promise<CampaignRecord | undefined> {
    const members = await this.db.select({ k: campaignMembers.identityKey }).from(campaignMembers).where(eq(campaignMembers.campaignId, c.id)).orderBy(asc(campaignMembers.position));
    return validateRecord({ v: 1, id: c.id, code: c.code, seed: c.seed, rev: c.rev, savedAt: c.savedAt, owner: c.owner, members: members.map((m) => m.k), sections: c.sections, sectionVersions: c.sectionVersions });
  }

  async load(id: string): Promise<CampaignRecord | undefined> {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return c ? this.hydrate(c) : undefined;
  }

  async findByCode(code: string): Promise<CampaignRecord | undefined> {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.code, code)).limit(1);
    return c ? this.hydrate(c) : undefined;
  }

  async save(rec: CampaignRecord, expectedRev: number | null): Promise<SaveResult> {
    const bad = precheck(rec);
    if (bad) return { ok: false, reason: bad };
    if (expectedRev !== null && (!Number.isInteger(expectedRev) || expectedRev < 0)) return { ok: false, reason: "invalid" };
    const next = stamped(rec, expectedRev, this.now());
    try {
      return await this.db.transaction(async (tx): Promise<SaveResult> => {
        if (expectedRev === null) {
          const ins = await tx.insert(campaigns).values(row(next)).onConflictDoNothing().returning({ rev: campaigns.rev });
          if (ins.length === 0) {
            const [cur] = await tx.select({ rev: campaigns.rev }).from(campaigns).where(eq(campaigns.id, next.id));
            return { ok: false, reason: "conflict", currentRev: cur?.rev };
          }
        } else {
          const { id: _id, ...fields } = row(next);
          const upd = await tx.update(campaigns).set(fields).where(and(eq(campaigns.id, next.id), eq(campaigns.rev, expectedRev))).returning({ rev: campaigns.rev });
          if (upd.length === 0) {
            const [cur] = await tx.select({ rev: campaigns.rev }).from(campaigns).where(eq(campaigns.id, next.id));
            return { ok: false, reason: "conflict", currentRev: cur?.rev };
          }
        }
        await tx.delete(campaignMembers).where(eq(campaignMembers.campaignId, next.id));
        if (next.members.length) await tx.insert(campaignMembers).values(next.members.map((k, i) => ({ campaignId: next.id, identityKey: k, position: i })));
        return { ok: true, rev: next.rev };
      });
    } catch (e) {
      // A unique violation here is the join code of ANOTHER campaign (the id/rev races are handled above).
      if (pgCode(e) === "23505") return { ok: false, reason: "conflict" };
      log.error("persistence.pg.save_failed", { id: rec.id, code: pgCode(e) ?? (e instanceof Error ? e.name : "error") });
      return { ok: false, reason: "io" };
    }
  }

  async list(identityKey: string): Promise<{ id: string; code: string; savedAt: number }[]> {
    const rows = await this.db
      .select({ id: campaigns.id, code: campaigns.code, savedAt: campaigns.savedAt })
      .from(campaigns)
      .innerJoin(campaignMembers, eq(campaignMembers.campaignId, campaigns.id))
      .where(eq(campaignMembers.identityKey, identityKey));
    return rows.sort((a, b) => b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1));
  }

  async delete(id: string): Promise<boolean> {
    const gone = await this.db.delete(campaigns).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
    return gone.length > 0;
  }

  async deleteByIdentity(identityKey: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const member = await tx.select({ id: campaignMembers.campaignId }).from(campaignMembers).where(eq(campaignMembers.identityKey, identityKey));
      const owned = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.owner, identityKey));
      // (D-055: a section may hold the key too, the honours'; strpos, not LIKE: a base64url key carries `_`, which LIKE reads as a wildcard)
      const mentioned = await tx.select({ id: campaigns.id }).from(campaigns).where(sql`strpos(${campaigns.sections}::text, ${identityKey}) > 0`);
      const ids = [...new Set([...member.map((m) => m.id), ...owned.map((o) => o.id), ...mentioned.map((o) => o.id)])];
      for (const id of ids) {
        await tx.delete(campaignMembers).where(and(eq(campaignMembers.campaignId, id), eq(campaignMembers.identityKey, identityKey)));
        const left = await tx.select({ k: campaignMembers.identityKey }).from(campaignMembers).where(eq(campaignMembers.campaignId, id)).orderBy(asc(campaignMembers.position));
        const first = left[0];
        if (!first) {
          await tx.delete(campaigns).where(eq(campaigns.id, id));
          continue;
        }
        const [row] = await tx.select({ sections: campaigns.sections }).from(campaigns).where(eq(campaigns.id, id));
        const scrub = forgetInSections(row?.sections ?? {}, identityKey);
        // savedAt is deliberately untouched: erasing a person must not reset the campaign's dormancy clock.
        await tx
          .update(campaigns)
          .set({
            rev: sql`${campaigns.rev} + 1`,
            owner: sql`case when ${campaigns.owner} = ${identityKey} then ${first.k} else ${campaigns.owner} end`,
            ...(scrub.changed ? { sections: scrub.sections } : {}),
          })
          .where(eq(campaigns.id, id));
      }
      return ids.length;
    });
  }

  async purgeDormant(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    const gone = await this.db.delete(campaigns).where(lt(campaigns.savedAt, cutoff)).returning({ id: campaigns.id });
    return gone.length;
  }

  async close(): Promise<void> {
    await this.opts.close?.();
  }
}

export function createPgStore(db: PgDb, opts: PgStoreOptions = {}): PgStore {
  return new PgStore(db, opts);
}

/** Production: postgres-js through Drizzle, migrated at boot. The URL (it carries credentials) is never logged. */
export async function openPostgresStore(url: string, opts: { now?: () => number } = {}): Promise<PgStore> {
  const [{ default: postgres }, { drizzle }] = await Promise.all([import("postgres"), import("drizzle-orm/postgres-js")]);
  const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined });
  const store = createPgStore(drizzle(client), { ...opts, close: () => client.end({ timeout: 5 }) });
  try {
    await store.migrate();
  } catch (e) {
    await client.end({ timeout: 1 }).catch(() => undefined);
    throw e;
  }
  return store;
}
