import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_MIGRATIONS } from "./pgMigrations.ts";
import { createPgStore } from "./pgStore.ts";
import { newRec } from "./storeContract.ts";

describe("PgStore specifics (PGlite + Drizzle)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg);
  }, 60000);
  afterAll(async () => {
    await pg.close().catch(() => undefined);
  });

  it("migrate() is idempotent and records schema_version; no CLI is needed", async () => {
    const s = createPgStore(db);
    await s.migrate();
    await s.migrate();
    await createPgStore(db).migrate();
    const rows = await pg.query<{ version: number }>("SELECT version FROM schema_version ORDER BY version");
    expect(rows.rows.map((r) => r.version)).toEqual(PG_MIGRATIONS.map((m) => m.version));
    const tables = await pg.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
    expect(tables.rows.map((r) => r.table_name)).toEqual(["campaign_members", "campaigns", "schema_version"]);
  });

  it("members keep their order and cascade away with the campaign", async () => {
    const s = createPgStore(db);
    const r = newRec(1, { owner: "kA", members: ["kC", "kA", "kB"] });
    await s.save(r, null);
    expect((await s.load(r.id))?.members).toEqual(["kC", "kA", "kB"]);
    await s.save({ ...r, members: ["kB", "kC"] }, 1);
    expect((await s.load(r.id))?.members).toEqual(["kB", "kC"]);
    await s.delete(r.id);
    const left = await pg.query("SELECT 1 FROM campaign_members");
    expect(left.rows).toHaveLength(0);
  });

  it("optimistic concurrency is in the SQL: a stale writer updates zero rows and the stored row is untouched", async () => {
    const s = createPgStore(db);
    const r = newRec(2);
    await s.save(r, null);
    await s.save({ ...r, seed: 111 }, 1);
    expect(await s.save({ ...r, seed: 222 }, 1)).toEqual({ ok: false, reason: "conflict", currentRev: 2 });
    expect((await s.load(r.id))?.seed).toBe(111);
  });

  it("hostile rows in the database (tampered by hand) load as undefined, never a half record", async () => {
    const s = createPgStore(db);
    await db.execute(sql`INSERT INTO campaigns (id, code, seed, rev, saved_at, owner, sections, section_versions) VALUES ('tampered-0001', 'ZZZZZ', 1, 1, 1, 'o', '{"campaign": 5}', '{}')`);
    expect(await s.load("tampered-0001")).toBeUndefined();
    expect(await s.findByCode("ZZZZZ")).toBeUndefined();
  });

  it("refuses to run against a database migrated by a NEWER build", async () => {
    await pg.exec("INSERT INTO schema_version (version, applied_at) VALUES (999, 1)");
    await expect(createPgStore(db).migrate()).rejects.toThrow(/newer than this build/);
    await pg.exec("DELETE FROM schema_version WHERE version = 999");
  });

  it("a dead database is reported as io, not thrown", async () => {
    const dead = new PGlite();
    const d = drizzle(dead);
    const s = createPgStore(d);
    await s.migrate();
    await dead.close();
    expect(await s.save(newRec(3), null)).toEqual({ ok: false, reason: "io" });
  });
});
