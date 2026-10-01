import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { FileStore } from "./fileStore.ts";
import { identityKey, resolveIdentity } from "./identity.ts";
import { createPgStore } from "./pgStore.ts";
import { createRecord } from "./record.ts";
import { CampaignSaver } from "./saver.ts";
import type { CampaignStore, Logger } from "./types.ts";

const PEPPER = "privacy-test-pepper-0123456789";
const RAW = ["3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7a13", "9a1c7d20-55be-4c3f-9e0a-7b6d4c2f1e88", "c0ffee00-1234-4abc-8def-0123456789ab"];

/** Plays a campaign through the real pipeline (token -> identity -> HMAC key -> saver -> store) and returns everything the logger saw. */
async function play(store: CampaignStore): Promise<string[]> {
  const lines: string[] = [];
  const f = (level: string) => (msg: string, fields?: Record<string, unknown>) => void lines.push(`${level} ${msg} ${JSON.stringify(fields ?? {})}`);
  const log: Logger = { info: f("info"), warn: f("warn"), error: f("error") };
  const ids = await Promise.all(RAW.map((t) => resolveIdentity(t)));
  const owner = identityKey(ids[0]!, PEPPER);
  const saver = new CampaignSaver(store, { now: () => 1, log, pepper: PEPPER, sleep: async () => undefined });
  saver.bind(createRecord({ code: "H7K2M", seed: 5, owner }));
  for (const id of ids.slice(1)) saver.addMember(id!);
  await saver.saveNow({ sections: { campaign: '{"day":3}', party: "{}" }, sectionVersions: { campaign: 1, party: 1 } });
  await saver.saveNow({ sections: { campaign: '{"day":4}', party: "{}" }, sectionVersions: { campaign: 1, party: 1 } });
  return lines;
}

const forbidden = [...RAW, ...RAW.map((r) => r.replace(/-/g, "")), PEPPER];

describe("no raw identity in any persisted byte (or log line)", () => {
  it("file store: every file in the save directory, including the .bak", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cb-priv-"));
    try {
      const lines = await play(new FileStore({ dir }));
      const files = await readdir(dir);
      expect(files.length).toBeGreaterThanOrEqual(2); // file + bak: both are scanned
      const bytes = [...files.map((f) => f), ...(await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))), ...lines].join("\n");
      for (const f of forbidden) expect(bytes.toLowerCase()).not.toContain(f.toLowerCase());
      expect(bytes).toContain(identityKey({ kind: "anon", id: RAW[1]!, assurance: "unverified" }, PEPPER)); // the keys ARE there
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("postgres store: every column of every table", async () => {
    const pg = new PGlite();
    try {
      const store = createPgStore(drizzle(pg));
      await store.migrate();
      const lines = await play(store);
      const dump: string[] = [...lines];
      for (const t of ["campaigns", "campaign_members", "schema_version"]) dump.push(JSON.stringify((await pg.query(`SELECT * FROM ${t}`)).rows));
      const bytes = dump.join("\n").toLowerCase();
      for (const f of forbidden) expect(bytes).not.toContain(f.toLowerCase());
      expect(bytes).toContain(identityKey({ kind: "anon", id: RAW[2]!, assurance: "unverified" }, PEPPER).toLowerCase());
    } finally {
      await pg.close();
    }
  });
});

