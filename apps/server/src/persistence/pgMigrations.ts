/**
 * Embedded, idempotent migrations: run at boot by `PgStore.migrate()` so no CLI is needed in production. Each entry is applied once, in
 * order, inside one transaction guarded by an advisory lock (two server processes booting together cannot both migrate), and recorded
 * in `schema_version`. NEVER edit an applied entry: append a new one. (`drizzle.config.ts` + drizzle-kit are for later tooling only.)
 */
export interface PgMigration {
  version: number;
  statements: readonly string[];
}

export const PG_MIGRATIONS: readonly PgMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS campaigns (
         id text PRIMARY KEY,
         code text NOT NULL,
         seed bigint NOT NULL,
         rev integer NOT NULL,
         saved_at bigint NOT NULL,
         owner text NOT NULL,
         sections jsonb NOT NULL,
         section_versions jsonb NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS campaigns_code_uq ON campaigns (code)`,
      `CREATE INDEX IF NOT EXISTS campaigns_saved_at_idx ON campaigns (saved_at)`,
      `CREATE TABLE IF NOT EXISTS campaign_members (
         campaign_id text NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
         identity_key text NOT NULL,
         position integer NOT NULL,
         PRIMARY KEY (campaign_id, identity_key)
       )`,
      `CREATE INDEX IF NOT EXISTS campaign_members_key_idx ON campaign_members (identity_key)`,
    ],
  },
];

/** Arbitrary constant: the advisory-lock key for "a migration is running". */
export const MIGRATION_LOCK = 7_203_511;
