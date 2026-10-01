import { checkExpected, precheck, removeIdentity, stamped, validateRecord } from "./record.ts";
import type { CampaignRecord, CampaignStore, SaveResult } from "./types.ts";

/** In-process store: the default for dev and tests, and the fallback when a real store fails to open. Everything is copied in and out. */
export class MemoryStore implements CampaignStore {
  private rows = new Map<string, CampaignRecord>();
  private now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  async load(id: string): Promise<CampaignRecord | undefined> {
    const r = this.rows.get(id);
    return r ? validateRecord(r) : undefined;
  }

  async findByCode(code: string): Promise<CampaignRecord | undefined> {
    for (const r of this.rows.values()) if (r.code === code) return validateRecord(r);
    return undefined;
  }

  async save(rec: CampaignRecord, expectedRev: number | null): Promise<SaveResult> {
    const bad = precheck(rec);
    if (bad) return { ok: false, reason: bad };
    const cur = this.rows.get(rec.id);
    const conflict = checkExpected(cur, expectedRev);
    if (conflict) return conflict;
    for (const r of this.rows.values()) if (r.code === rec.code && r.id !== rec.id) return { ok: false, reason: "conflict" };
    const next = stamped(rec, expectedRev, this.now());
    this.rows.set(next.id, next);
    return { ok: true, rev: next.rev };
  }

  async list(identityKey: string): Promise<{ id: string; code: string; savedAt: number }[]> {
    const out: { id: string; code: string; savedAt: number }[] = [];
    for (const r of this.rows.values()) if (r.members.includes(identityKey)) out.push({ id: r.id, code: r.code, savedAt: r.savedAt });
    return out.sort((a, b) => b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1));
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async deleteByIdentity(identityKey: string): Promise<number> {
    let n = 0;
    for (const [id, r] of [...this.rows]) {
      const res = removeIdentity(r, identityKey);
      if (!res.changed) continue;
      n++;
      if (res.rec) this.rows.set(id, res.rec);
      else this.rows.delete(id);
    }
    return n;
  }

  async purgeDormant(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    let n = 0;
    for (const [id, r] of [...this.rows]) {
      if (r.savedAt < cutoff) {
        this.rows.delete(id);
        n++;
      }
    }
    return n;
  }

  async close(): Promise<void> {}
}
