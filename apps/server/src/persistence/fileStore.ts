import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../log.ts";
import { decodeEnvelope, encodeEnvelope, type Decoded } from "./envelope.ts";
import { ID_RE, checkExpected, precheck, removeIdentity, stamped } from "./record.ts";
import { persistenceStats, type RecoveryReport } from "./stats.ts";
import type { CampaignRecord, CampaignStore, SaveResult } from "./types.ts";

/** The filesystem calls the store makes, as one seam so tests can inject a crash between any two steps of the atomic write. */
export interface FileOps {
  readFile(path: string): Promise<string>;
  readdir(dir: string): Promise<string[]>;
  /** Create/truncate, write all of `data`, fsync the file, close. One step: a crash inside it leaves a torn file. */
  writeFileSynced(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  /** fsync the directory so the renames themselves are durable (best effort where the OS cannot open a directory). */
  syncDir(dir: string): Promise<void>;
}

export const nodeFileOps: FileOps = {
  readFile: (p) => readFile(p, "utf8"),
  readdir: (d) => readdir(d),
  async writeFileSynced(path, data) {
    const fh = await open(path, "w");
    try {
      await fh.writeFile(data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
  },
  rename: (a, b) => rename(a, b),
  rm: (p) => rm(p, { recursive: true, force: true }),
  mkdir: async (d) => void (await mkdir(d, { recursive: true })),
  async syncDir(dir) {
    try {
      const fh = await open(dir, "r");
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    } catch (e) {
      // Windows cannot open a directory for fsync; that is not a failure of the write.
      if (!["EISDIR", "EPERM", "EINVAL", "ENOTSUP", "EACCES"].includes(codeOf(e) ?? "")) throw e;
    }
  },
};

export interface FileStoreOptions {
  dir: string;
  now?: () => number;
  ops?: FileOps;
  /** Called for every repair / refusal. Default: warn in the log and bump `persistenceStats`. */
  onReport?: (r: RecoveryReport) => void;
}

function codeOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

function defaultReport(r: RecoveryReport): void {
  if (r.action === "restored_bak") persistenceStats.recoveries++;
  else if (r.action === "quarantined") persistenceStats.quarantined++;
  else if (r.action === "refused_too_new") persistenceStats.refusedTooNew++;
  else persistenceStats.dataLost++;
  log.warn("persistence.recovery", { id: r.id, action: r.action, detail: r.detail });
}

type Best = { rec?: CampaignRecord; tooNew?: boolean };
type Candidate = Decoded | { kind: "missing" };

/**
 * One `<id>.json` per campaign (envelope: format, version, crc32, record). Single-process by design (one server owns its SAVE_DIR);
 * the rev check still runs against the file so a second writer loses cleanly. Writes are atomic and keep one prior version:
 *   1. write `<id>.json.tmp` and fsync it   2. rename the old file to `<id>.json.bak`   3. rename tmp over `<id>.json`   4. fsync the directory
 * A crash leaves the old or the new record loadable, never a hybrid. Damaged files are quarantined, never deleted, except by `delete`.
 */
export class FileStore implements CampaignStore {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly ops: FileOps;
  private readonly report: (r: RecoveryReport) => void;
  private readonly chains = new Map<string, Promise<unknown>>();
  private quarantineSeq = 0;

  constructor(opts: FileStoreOptions) {
    this.dir = opts.dir;
    this.now = opts.now ?? Date.now;
    this.ops = opts.ops ?? nodeFileOps;
    this.report = opts.onReport ?? defaultReport;
  }

  private primary = (id: string) => join(this.dir, `${id}.json`);
  private bak = (id: string) => join(this.dir, `${id}.json.bak`);
  private tmp = (id: string) => join(this.dir, `${id}.json.tmp`);

  /** Operations on one campaign run one at a time (the tmp file name is per campaign). */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return next;
  }

  private async candidate(path: string): Promise<Candidate> {
    let text: string;
    try {
      text = await this.ops.readFile(path);
    } catch (e) {
      const c = codeOf(e);
      if (c === "ENOENT") return { kind: "missing" };
      if (c === "EISDIR" || c === "ENOTDIR") return { kind: "corrupt", reason: "not a file" };
      throw e; // EACCES, EIO...: a fault of the machine, not proof the file is damaged. Never quarantine on it.
    }
    return decodeEnvelope(text);
  }

  private async quarantine(id: string, path: string, reason: string): Promise<void> {
    const dest = join(this.dir, `${id}.corrupt-${this.now()}-${this.quarantineSeq++}.json`);
    try {
      await this.ops.rename(path, dest);
      this.report({ id, action: "quarantined", detail: `${reason}; moved to ${dest.slice(this.dir.length + 1)}` });
    } catch (e) {
      this.report({ id, action: "quarantined", detail: `${reason}; could not move aside (${codeOf(e) ?? "error"})` });
    }
  }

  /** The best copy of a campaign: the file, else its `.bak`. Repairs by quarantining; refuses (and touches nothing) on a newer version. */
  private async readBest(id: string): Promise<Best> {
    const p = await this.candidate(this.primary(id));
    if (p.kind === "ok") return { rec: p.record };
    if (p.kind === "too_new") {
      this.report({ id, action: "refused_too_new", detail: `file version ${p.version} is newer than this build; left untouched` });
      return { tooNew: true };
    }
    if (p.kind === "corrupt") await this.quarantine(id, this.primary(id), p.reason);
    const b = await this.candidate(this.bak(id));
    if (b.kind === "ok") {
      this.report({ id, action: "restored_bak", detail: p.kind === "missing" ? "primary file missing (interrupted write?)" : "primary file damaged" });
      return { rec: b.record };
    }
    if (b.kind === "corrupt") await this.quarantine(id, this.bak(id), `backup: ${b.reason}`);
    if (p.kind === "corrupt") this.report({ id, action: "data_lost", detail: "damaged file and no usable backup" });
    return {};
  }

  async load(id: string): Promise<CampaignRecord | undefined> {
    if (!ID_RE.test(id)) return undefined;
    return this.serial(id, async () => (await this.readBest(id)).rec);
  }

  private async ids(): Promise<string[]> {
    let names: string[];
    try {
      names = await this.ops.readdir(this.dir);
    } catch (e) {
      if (codeOf(e) === "ENOENT") return [];
      throw e;
    }
    const ids = new Set<string>();
    for (const n of names) {
      const m = /^([A-Za-z0-9-]{8,64})\.json(?:\.bak)?$/.exec(n);
      if (m) ids.add(m[1]!);
    }
    return [...ids].sort();
  }

  private async scan(exceptId?: string): Promise<CampaignRecord[]> {
    const out: CampaignRecord[] = [];
    for (const id of await this.ids()) {
      if (id === exceptId) continue;
      const r = await this.load(id);
      if (r) out.push(r);
    }
    return out;
  }

  async findByCode(code: string): Promise<CampaignRecord | undefined> {
    return (await this.scan()).find((r) => r.code === code);
  }

  /** Steps 1-4 of the atomic write (see the class comment). On any failure the old file is put back where it can be. */
  private async atomicWrite(id: string, data: string): Promise<void> {
    const { ops } = this;
    await ops.mkdir(this.dir);
    try {
      await ops.writeFileSynced(this.tmp(id), data); // 1
      let movedBak = false;
      try {
        await ops.rename(this.primary(id), this.bak(id)); // 2
        movedBak = true;
      } catch (e) {
        if (codeOf(e) !== "ENOENT") throw e; // a first save has nothing to back up
      }
      try {
        await ops.rename(this.tmp(id), this.primary(id)); // 3
      } catch (e) {
        if (movedBak) await ops.rename(this.bak(id), this.primary(id)).catch(() => undefined);
        throw e;
      }
      await ops.syncDir(this.dir); // 4
    } catch (e) {
      await ops.rm(this.tmp(id)).catch(() => undefined);
      throw e;
    }
  }

  async save(rec: CampaignRecord, expectedRev: number | null): Promise<SaveResult> {
    const bad = precheck(rec);
    if (bad) return { ok: false, reason: bad };
    return this.serial(rec.id, async (): Promise<SaveResult> => {
      try {
        const cur = await this.readBest(rec.id);
        if (cur.tooNew) return { ok: false, reason: "too_new" };
        const conflict = checkExpected(cur.rec, expectedRev);
        if (conflict) return conflict;
        if (!cur.rec || cur.rec.code !== rec.code) {
          const other = (await this.scan(rec.id)).find((r) => r.code === rec.code);
          if (other) return { ok: false, reason: "conflict", currentRev: undefined };
        }
        const next = stamped(rec, expectedRev, this.now());
        await this.atomicWrite(rec.id, encodeEnvelope(next));
        return { ok: true, rev: next.rev };
      } catch (e) {
        log.error("persistence.file.save_failed", { id: rec.id, code: codeOf(e) ?? (e instanceof Error ? e.name : "error") });
        return { ok: false, reason: "io" };
      }
    });
  }

  async list(identityKey: string): Promise<{ id: string; code: string; savedAt: number }[]> {
    return (await this.scan())
      .filter((r) => r.members.includes(identityKey))
      .map((r) => ({ id: r.id, code: r.code, savedAt: r.savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1));
  }

  /** Every file belonging to a campaign: primary, backup, tmp and quarantined copies. */
  private async filesOf(id: string): Promise<string[]> {
    const names = await this.ops.readdir(this.dir).catch(() => [] as string[]);
    return names.filter((n) => n === `${id}.json` || n === `${id}.json.bak` || n === `${id}.json.tmp` || n.startsWith(`${id}.corrupt-`)).map((n) => join(this.dir, n));
  }

  async delete(id: string): Promise<boolean> {
    if (!ID_RE.test(id)) return false;
    return this.serial(id, async () => {
      const files = await this.filesOf(id);
      for (const f of files) await this.ops.rm(f);
      return files.some((f) => f.endsWith(`${id}.json`) || f.endsWith(`${id}.json.bak`));
    });
  }

  async deleteByIdentity(identityKey: string): Promise<number> {
    let n = 0;
    for (const rec of await this.scan()) {
      const res = removeIdentity(rec, identityKey);
      if (!res.changed) continue;
      const done = await this.serial(rec.id, async () => {
        try {
          if (!res.rec) {
            for (const f of await this.filesOf(rec.id)) await this.ops.rm(f);
            return true;
          }
          // Rewrite WITHOUT keeping the old copy: the backup and any quarantined file still hold the erased key.
          await this.ops.writeFileSynced(this.tmp(rec.id), encodeEnvelope(res.rec));
          await this.ops.rename(this.tmp(rec.id), this.primary(rec.id));
          for (const f of await this.filesOf(rec.id)) if (!f.endsWith(`${rec.id}.json`)) await this.ops.rm(f);
          await this.ops.syncDir(this.dir);
          return true;
        } catch (e) {
          log.error("persistence.file.erase_failed", { id: rec.id, code: codeOf(e) ?? "error" });
          return false;
        }
      });
      if (done) n++;
    }
    return n;
  }

  async purgeDormant(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    let n = 0;
    for (const rec of await this.scan()) {
      if (rec.savedAt < cutoff && (await this.delete(rec.id))) n++;
    }
    // Quarantined files carry their own timestamp and age out with everything else.
    const names = await this.ops.readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      const m = /^[A-Za-z0-9-]{8,64}\.corrupt-(\d+)-\d+\.json$/.exec(name);
      if (m && Number(m[1]) < cutoff) await this.ops.rm(join(this.dir, name)).catch(() => undefined);
    }
    return n;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }
}
