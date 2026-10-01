import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "./fileStore.ts";
import { MemoryStore } from "./memoryStore.ts";
import { openStore, purgeExpired } from "./openStore.ts";
import { persistenceConfig } from "./saver.ts";
import { newRec } from "./storeContract.ts";
import { DAY_MS, type Logger } from "./types.ts";

const log = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  const f = (msg: string, fields?: Record<string, unknown>) => void lines.push(`${msg} ${JSON.stringify(fields ?? {})}`);
  return { lines, info: f, warn: f, error: f };
};

describe("persistenceConfig", () => {
  it("defaults: memory, ./data/saves, 180 days, dev pepper", () => {
    const c = persistenceConfig({});
    expect(c).toMatchObject({ kind: "memory", saveDir: "./data/saves", databaseUrl: undefined, retentionDays: 180 });
    expect(c.pepper.length).toBeGreaterThan(8);
  });

  it("reads every variable", () => {
    expect(persistenceConfig({ CAMPAIGN_STORE: "FILE", SAVE_DIR: " /var/saves ", IDENTITY_PEPPER: "p".repeat(20), SAVE_RETENTION_DAYS: "30", NODE_ENV: "production" })).toEqual({ kind: "file", saveDir: "/var/saves", databaseUrl: undefined, pepper: "p".repeat(20), retentionDays: 30 });
    expect(persistenceConfig({ CAMPAIGN_STORE: "postgres", DATABASE_URL: "postgres://u:p@h/db" }).kind).toBe("postgres");
  });

  it("fails fast with every problem listed", () => {
    expect(() => persistenceConfig({ CAMPAIGN_STORE: "mongo" })).toThrow(/CAMPAIGN_STORE/);
    expect(() => persistenceConfig({ CAMPAIGN_STORE: "postgres" })).toThrow(/DATABASE_URL/);
    expect(() => persistenceConfig({ CAMPAIGN_STORE: "file", NODE_ENV: "production" })).toThrow(/IDENTITY_PEPPER/);
    expect(() => persistenceConfig({ CAMPAIGN_STORE: "file", NODE_ENV: "production", IDENTITY_PEPPER: "short" })).toThrow(/IDENTITY_PEPPER/);
    for (const bad of ["0", "-5", "1.5", "abc", "99999"]) expect(() => persistenceConfig({ SAVE_RETENTION_DAYS: bad })).toThrow(/SAVE_RETENTION_DAYS/);
    expect(() => persistenceConfig({ CAMPAIGN_STORE: "mongo", SAVE_RETENTION_DAYS: "0" })).toThrow(/CAMPAIGN_STORE[\s\S]*SAVE_RETENTION_DAYS/);
  });

  it("production with the memory store does not demand a pepper", () => {
    expect(() => persistenceConfig({ NODE_ENV: "production" })).not.toThrow();
  });
});

describe("openStore", () => {
  it("builds the configured store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-open-"));
    try {
      const f = await openStore({ kind: "file", saveDir: dir, databaseUrl: undefined, pepper: "x", retentionDays: 180 }, log());
      expect(f).toMatchObject({ kind: "file", downgraded: false });
      expect(f.store).toBeInstanceOf(FileStore);
      const m = await openStore({ kind: "memory", saveDir: dir, databaseUrl: undefined, pepper: "x", retentionDays: 180 }, log());
      expect(m).toMatchObject({ kind: "memory", downgraded: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a store that cannot open downgrades to memory with a loud error, never a throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-open-"));
    try {
      const notADir = join(dir, "file");
      await writeFile(notADir, "x");
      const l = log();
      const r = await openStore({ kind: "file", saveDir: notADir, databaseUrl: undefined, pepper: "x", retentionDays: 180 }, l);
      expect(r).toMatchObject({ kind: "memory", downgraded: true });
      expect(r.store).toBeInstanceOf(MemoryStore);
      expect(l.lines.some((x) => x.startsWith("persistence.open_failed"))).toBe(true);

      const secret = "hunter2-secret-password";
      const l2 = log();
      const pg = await openStore({ kind: "postgres", saveDir: dir, databaseUrl: `postgres://user:${secret}@127.0.0.1:1/none`, pepper: "x", retentionDays: 180 }, l2);
      expect(pg).toMatchObject({ kind: "memory", downgraded: true });
      expect(l2.lines.join("\n")).not.toContain(secret);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("purgeExpired", () => {
  it("deletes dormant campaigns and never throws", async () => {
    let t = DAY_MS * 1000;
    const store = new MemoryStore({ now: () => t });
    await store.save(newRec(1), null);
    t += 200 * DAY_MS;
    await store.save(newRec(2), null);
    expect(await purgeExpired(store, 180, log())).toBe(1);
    const broken = { ...store, purgeDormant: () => Promise.reject(new Error("db down")) } as unknown as MemoryStore;
    expect(await purgeExpired(broken, 180, log())).toBe(0);
  });
});
