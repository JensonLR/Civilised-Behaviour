import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rng } from "@cb/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SAVE_VERSION, crc32, decodeEnvelope, encodeEnvelope, migrate } from "./envelope.ts";
import { FileStore, nodeFileOps, type FileOps } from "./fileStore.ts";
import { validateRecord } from "./record.ts";
import { persistenceStats, type RecoveryReport } from "./stats.ts";
import { idOf, keyOf, newRec } from "./storeContract.ts";
import { DAY_MS, type CampaignRecord } from "./types.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

let dir = "";
let reports: RecoveryReport[] = [];
let clock = 9_000_000;
const mk = (ops?: FileOps) => new FileStore({ dir, now: () => clock, ops, onReport: (r) => reports.push(r) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cb-file-"));
  dirs.push(dir);
  reports = [];
  clock = 9_000_000;
});

const names = async () => (await readdir(dir)).sort();
const p = (id: string, ext = "json") => join(dir, `${id}.${ext}`);

/** A process that dies at its Nth mutating call: that call (and every later one) throws, `torn` leaves half a file behind first. */
function crashAt(n: number, torn = false): FileOps & { calls: string[] } {
  let count = 0;
  let dead = false;
  const calls: string[] = [];
  const gate = (name: string): void => {
    if (dead) throw new Error("process is dead");
    calls.push(name);
    if (++count === n) {
      dead = true;
      throw new Error(`crash at step ${n} (${name})`);
    }
  };
  return {
    calls,
    readFile: nodeFileOps.readFile,
    readdir: nodeFileOps.readdir,
    mkdir: nodeFileOps.mkdir,
    async writeFileSynced(path, data) {
      if (!dead && count + 1 === n && torn) await writeFile(path, data.slice(0, Math.floor(data.length / 2)));
      gate("write");
      await nodeFileOps.writeFileSynced(path, data);
    },
    async rename(a, b) {
      gate("rename");
      await nodeFileOps.rename(a, b);
    },
    async rm(path) {
      if (dead) throw new Error("process is dead");
      await nodeFileOps.rm(path);
    },
    async syncDir(d) {
      gate("syncDir");
      await nodeFileOps.syncDir(d);
    },
  };
}

describe("FileStore: atomic write", () => {
  it("a normal save leaves the file, the previous version as .bak, and no tmp", async () => {
    const s = mk();
    const r = newRec(1);
    await s.save(r, null);
    expect(await names()).toEqual([`${r.id}.json`]);
    await s.save({ ...r, sections: { ...r.sections, campaign: '{"v":2}' } }, 1);
    expect(await names()).toEqual([`${r.id}.json`, `${r.id}.json.bak`]);
    expect(decodeEnvelope(await readFile(p(r.id, "json.bak"), "utf8"))).toMatchObject({ kind: "ok", record: { rev: 1 } });
    expect(decodeEnvelope(await readFile(p(r.id), "utf8"))).toMatchObject({ kind: "ok", record: { rev: 2 } });
  });

  // The four steps of an overwrite: write tmp, rename old to .bak, rename tmp over, fsync dir.
  for (const step of [1, 2, 3, 4]) {
    for (const torn of step === 1 ? [false, true] : [false]) {
      it(`crash at step ${step}${torn ? " (torn tmp write)" : ""}: after a restart the old OR the new record loads, never a hybrid`, async () => {
        const base = newRec(2);
        const first = mk();
        await first.save(base, null);
        const old = (await first.load(base.id))!;
        const next: CampaignRecord = { ...base, sections: { ...base.sections, campaign: '{"after":"crash"}', party: '{"x":1}' }, members: [base.owner, keyOf(7)] };
        const ops = crashAt(step, torn);
        const dying = mk(ops);
        expect(await dying.save(next, 1)).toEqual({ ok: false, reason: "io" });

        const restarted = mk();
        const loaded = await restarted.load(base.id);
        const fresh = { ...next, rev: 2, savedAt: clock };
        expect([old, fresh]).toContainEqual(loaded);
        expect(loaded).toEqual(step === 4 ? fresh : old); // the exact expectation per step
        // and the campaign is still usable: the next save from what we loaded succeeds
        expect(await restarted.save({ ...(loaded as CampaignRecord), seed: 5 }, loaded!.rev)).toMatchObject({ ok: true });
        expect(ops.calls.length).toBeLessThanOrEqual(step);
      });
    }
  }

  it("a first-ever save that crashes leaves nothing loadable or a whole record", async () => {
    for (const step of [1, 3, 4]) {
      const d = await mkdtemp(join(tmpdir(), "cb-file-"));
      dirs.push(d);
      const r = newRec(30 + step);
      const dying = new FileStore({ dir: d, ops: crashAt(step, step === 1), onReport: () => undefined });
      await dying.save(r, null);
      const loaded = await new FileStore({ dir: d, onReport: () => undefined }).load(r.id);
      expect(loaded === undefined || loaded.rev === 1).toBe(true);
    }
  });

  it("a failing rename of tmp puts the old file back where it can", async () => {
    const r = newRec(3);
    await mk().save(r, null);
    const flaky: FileOps = { ...nodeFileOps, rename: async (a, b) => (a.endsWith(".tmp") ? Promise.reject(Object.assign(new Error("EXDEV"), { code: "EXDEV" })) : nodeFileOps.rename(a, b)) };
    expect(await mk(flaky).save({ ...r, seed: 9 }, 1)).toEqual({ ok: false, reason: "io" });
    expect((await mk().load(r.id))?.seed).toBe(r.seed);
    expect(await names()).not.toContain(`${r.id}.json.tmp`);
  });
});

describe("FileStore: corruption and recovery", () => {
  const good = (r: CampaignRecord) => encodeEnvelope({ ...r, rev: 1, savedAt: 9_000_000 });
  const rec = newRec(4);
  const flip = (s: string) => s.replace('"seed":', '"seed":9');
  const damage: Record<string, (valid: string) => string> = {
    truncated: (v) => v.slice(0, Math.floor(v.length / 2)),
    "bit-flipped": (v) => flip(v),
    "wrong crc": (v) => v.replace(/"crc32":\d+/, '"crc32":1'),
    "wrong version type": (v) => v.replace('"version":1', '"version":"1"'),
    empty: () => "",
    garbage: () => "\u0000\u0001\u0002 not json {{{",
    "wrong format": (v) => v.replace("cb-save", "other"),
    "not an object": () => "[1,2,3]",
  };

  for (const [label, hurt] of Object.entries(damage)) {
    it(`${label}: quarantined, never deleted; no backup -> undefined`, async () => {
      await writeFile(p(rec.id), hurt(good(rec)));
      const s = mk();
      expect(await s.load(rec.id)).toBeUndefined();
      const files = await names();
      expect(files.filter((n) => n.includes(".corrupt-"))).toHaveLength(1);
      expect(files).not.toContain(`${rec.id}.json`);
      expect(reports.map((r) => r.action)).toEqual(["quarantined", "data_lost"]);
    });

    it(`${label}: with a good .bak the previous version loads and recovery is reported`, async () => {
      await writeFile(p(rec.id), hurt(good(rec)));
      await writeFile(p(rec.id, "json.bak"), encodeEnvelope({ ...rec, rev: 7, savedAt: 8_000_000 }));
      const loaded = await mk().load(rec.id);
      expect(loaded).toMatchObject({ rev: 7, savedAt: 8_000_000 });
      expect(reports.map((r) => r.action)).toEqual(["quarantined", "restored_bak"]);
      // and the next save carries on from the recovered revision, without clobbering anything good
      expect(await mk().save(loaded!, 7)).toEqual({ ok: true, rev: 8 });
      expect((await mk().load(rec.id))?.rev).toBe(8);
    });
  }

  it("a directory where the file should be is quarantined too", async () => {
    await mkdir(p(rec.id));
    await writeFile(join(p(rec.id), "inner.txt"), "x");
    expect(await mk().load(rec.id)).toBeUndefined();
    expect((await names()).filter((n) => n.includes(".corrupt-"))).toHaveLength(1);
    expect(await mk().save(rec, null)).toEqual({ ok: true, rev: 1 });
  });

  it("primary missing but .bak present (crash between the renames): loads the backup", async () => {
    await writeFile(p(rec.id, "json.bak"), encodeEnvelope({ ...rec, rev: 2, savedAt: 1 }));
    expect(await mk().load(rec.id)).toMatchObject({ rev: 2 });
    expect(reports.map((r) => r.action)).toEqual(["restored_bak"]);
    expect(await mk().save(rec, 2)).toEqual({ ok: true, rev: 3 });
    expect(await names()).toEqual([`${rec.id}.json`, `${rec.id}.json.bak`]); // the old good copy was kept, not clobbered by nothing
  });

  it("a corrupt .bak is quarantined and the good primary still loads", async () => {
    await writeFile(p(rec.id), good(rec));
    await writeFile(p(rec.id, "json.bak"), "junk");
    expect(await mk().load(rec.id)).toMatchObject({ rev: 1 });
    expect(reports).toEqual([]); // primary was fine: the backup is not even read
    await mk().save(rec, 1);
    expect(decodeEnvelope(await readFile(p(rec.id, "json.bak"), "utf8")).kind).toBe("ok");
  });

  it("a file from a NEWER build is refused and never overwritten, even with a good .bak", async () => {
    const future = JSON.stringify({ format: "cb-save", version: SAVE_VERSION + 1, crc32: 0, record: { totally: "different" } });
    await writeFile(p(rec.id), future);
    await writeFile(p(rec.id, "json.bak"), encodeEnvelope({ ...rec, rev: 1, savedAt: 1 }));
    const before = await Promise.all([readFile(p(rec.id)), readFile(p(rec.id, "json.bak"))]);
    const s = mk();
    expect(await s.load(rec.id)).toBeUndefined();
    expect(await s.save(rec, 1)).toEqual({ ok: false, reason: "too_new" });
    expect(await s.save(rec, null)).toEqual({ ok: false, reason: "too_new" });
    expect(await s.delete("not-this-one-aaaa")).toBe(false);
    expect(await Promise.all([readFile(p(rec.id)), readFile(p(rec.id, "json.bak"))])).toEqual(before);
    expect((await names()).filter((n) => n.includes("corrupt") || n.endsWith(".tmp"))).toEqual([]);
    expect(reports.every((r) => r.action === "refused_too_new")).toBe(true);
    expect(reports.length).toBeGreaterThan(0);
  });

  it("the default report path bumps persistenceStats", async () => {
    const before = { ...persistenceStats };
    await writeFile(p(rec.id), "junk");
    await new FileStore({ dir }).load(rec.id);
    expect(persistenceStats.quarantined).toBe(before.quarantined + 1);
    expect(persistenceStats.dataLost).toBe(before.dataLost + 1);
  });

  it("a read fault that is not 'damaged' (EACCES) is an error, not a quarantine", async () => {
    await writeFile(p(rec.id), good(rec));
    const denied: FileOps = { ...nodeFileOps, readFile: () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })) };
    await expect(mk(denied).load(rec.id)).rejects.toThrow();
    expect(await names()).toEqual([`${rec.id}.json`]);
    expect(await mk(denied).save(rec, 1)).toEqual({ ok: false, reason: "io" });
  });
});

describe("FileStore: versions", () => {
  it("migrates the v0 fixture (ownerKey/memberKeys, no sectionVersions) to the current record", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    await copyFile(new URL("./fixtures/v0.json", import.meta.url), p(id));
    const s = mk();
    const loaded = await s.load(id);
    expect(loaded).toEqual({
      v: 1,
      id,
      code: "H7K2M",
      seed: 424242,
      rev: 3,
      savedAt: 1790000000000,
      owner: "ownerkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      members: ["ownerkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "guestkeyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
      sections: { campaign: '{"day":4,"v":1}', party: '{"v":1,"roster":[]}' },
      sectionVersions: { campaign: 1, party: 1 },
    });
    expect(reports).toEqual([]);
    // saving writes the current format and keeps the v0 file as the backup
    expect(await s.save(loaded!, 3)).toEqual({ ok: true, rev: 4 });
    expect(JSON.parse(await readFile(p(id), "utf8")).version).toBe(SAVE_VERSION);
    expect(JSON.parse(await readFile(p(id, "json.bak"), "utf8")).version).toBe(0);
  });

  it("migrate refuses a gap in the chain instead of guessing", () => {
    expect(migrate({}, -1)).toBeUndefined();
  });
});

describe("FileStore: hostile envelopes", () => {
  const valid = encodeEnvelope({ ...newRec(5), rev: 1, savedAt: 1 });
  const rng = new Rng(0x5eed);
  const KEYS = ["format", "version", "crc32", "record", "id", "code", "seed", "rev", "savedAt", "owner", "members", "sections", "sectionVersions", "v", "__proto__", "constructor", "prototype", "toString"];
  const junkValue = (depth: number): unknown => {
    const k = rng.int(0, 9);
    if (depth > 4 || k < 3) return [null, true, false, 0, -1, 1e308, -1e308, 2 ** 53, 0.5, "", "x", "cb-save", "ABCDE", idOf(1), "\u0000", NaN, 1][rng.int(0, 16)];
    if (k < 5) return Array.from({ length: rng.int(0, 4) }, () => junkValue(depth + 1));
    const o: Record<string, unknown> = {};
    for (let i = rng.int(0, 6); i > 0; i--) Object.defineProperty(o, KEYS[rng.int(0, KEYS.length - 1)]!, { value: junkValue(depth + 1), enumerable: true, configurable: true, writable: true });
    return o;
  };
  const hostile = (i: number): string => {
    switch (i % 5) {
      case 0: return Array.from({ length: rng.int(0, 200) }, () => String.fromCharCode(rng.int(0, 255))).join("");
      case 1: return valid.slice(0, rng.int(0, valid.length));
      case 2: {
        const a = rng.int(0, valid.length - 1);
        return valid.slice(0, a) + String.fromCharCode(rng.int(32, 126)) + valid.slice(a + 1);
      }
      case 3: return JSON.stringify(junkValue(0)) ?? "";
      default: {
        const rec = junkValue(0);
        return JSON.stringify({ format: "cb-save", version: rng.int(0, 2), crc32: crc32(JSON.stringify(rec) ?? ""), record: rec });
      }
    }
  };

  it("2000 hostile envelopes: decodeEnvelope never throws, and anything it accepts is a valid record", () => {
    let ok = 0;
    for (let i = 0; i < 2000; i++) {
      const d = decodeEnvelope(hostile(i));
      if (d.kind === "ok") {
        ok++;
        expect(validateRecord(d.record)).toEqual(d.record);
      }
    }
    expect(ok).toBeLessThan(200);
    expect(decodeEnvelope("[".repeat(100000)).kind).toBe("corrupt");
    expect(decodeEnvelope("x".repeat(1_000_000)).kind).toBe("corrupt");
  });

  it("250 of them through real files: load resolves to undefined or a valid record, never throws", async () => {
    const s = mk();
    for (let i = 0; i < 250; i++) {
      const id = idOf(1000 + i);
      await writeFile(p(id), hostile(i));
      const r = await s.load(id);
      expect(r === undefined || validateRecord(r) !== undefined).toBe(true);
    }
    expect(await s.findByCode("ZZZZZ")).toBeUndefined();
  });
});

describe("FileStore: erasure and retention", () => {
  it("deleteByIdentity leaves no trace of the key: not in the file, the .bak, or a quarantined copy", async () => {
    const s = mk();
    const key = keyOf(50);
    const r = newRec(6, { owner: keyOf(51), members: [keyOf(51), key] });
    await s.save(r, null);
    await s.save({ ...r, sections: { ...r.sections, campaign: '{"d":2}' } }, 1);
    await writeFile(p(r.id).replace(/\.json$/, ".corrupt-1-0.json"), `old garbage containing ${key}`);
    const sole = newRec(7, { owner: key, members: [key] });
    await s.save(sole, null);
    await s.save({ ...sole, seed: 2 }, 1);
    expect(await s.deleteByIdentity(key)).toBe(2);
    for (const n of await names()) expect(await readFile(join(dir, n), "utf8")).not.toContain(key);
    expect((await names()).filter((n) => n.startsWith(sole.id))).toEqual([]);
    expect(await s.load(r.id)).toMatchObject({ owner: keyOf(51), members: [keyOf(51)], rev: 3 });
  });

  it("delete removes the file, backup, tmp and quarantined copies", async () => {
    const s = mk();
    const r = newRec(8);
    await s.save(r, null);
    await s.save(r, 1);
    await writeFile(p(r.id, "json.tmp"), "half");
    await writeFile(join(dir, `${r.id}.corrupt-5-0.json`), "x");
    expect(await s.delete(r.id)).toBe(true);
    expect(await names()).toEqual([]);
  });

  it("purgeDormant also ages out quarantined files", async () => {
    clock = 400 * DAY_MS;
    const s = mk();
    await writeFile(join(dir, `${idOf(9)}.corrupt-${clock - 200 * DAY_MS}-0.json`), "old");
    await writeFile(join(dir, `${idOf(9)}.corrupt-${clock - 1 * DAY_MS}-1.json`), "recent");
    await s.purgeDormant(30 * DAY_MS);
    expect(await names()).toEqual([`${idOf(9)}.corrupt-${clock - 1 * DAY_MS}-1.json`]);
  });

  it("an absent save directory is simply empty; the directory is created on the first save", async () => {
    const nested = join(dir, "a", "b");
    const s = new FileStore({ dir: nested, now: () => clock });
    expect(await s.list("k")).toEqual([]);
    expect(await s.findByCode("ABCDE")).toBeUndefined();
    expect(await s.save(newRec(10), null)).toMatchObject({ ok: true });
    expect((await stat(nested)).isDirectory()).toBe(true);
  });
});
