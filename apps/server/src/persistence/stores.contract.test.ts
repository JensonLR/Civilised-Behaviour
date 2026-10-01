import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll } from "vitest";
import { FileStore } from "./fileStore.ts";
import { MemoryStore } from "./memoryStore.ts";
import { createPgStore } from "./pgStore.ts";
import { storeContract } from "./storeContract.ts";

storeContract("memory", { make: async (now) => new MemoryStore({ now }) });

{
  const dirs: string[] = [];
  let current = "";
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });
  storeContract("file", {
    make: async (now) => {
      current = await mkdtemp(join(tmpdir(), "cb-store-"));
      dirs.push(current);
      return new FileStore({ dir: current, now, onReport: () => undefined });
    },
    reopen: async (now) => new FileStore({ dir: current, now, onReport: () => undefined }),
  });
}

{
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle(pg);
    await createPgStore(db).migrate();
  }, 60000);
  afterAll(async () => {
    await pg.close();
  });
  storeContract("pglite + drizzle", {
    make: async (now) => {
      await pg.exec("DELETE FROM campaigns");
      return createPgStore(db, { now });
    },
    reopen: async (now) => createPgStore(db, { now }),
  });
}
