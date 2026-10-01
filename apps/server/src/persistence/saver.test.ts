import { describe, expect, it } from "vitest";
import { metrics } from "../metrics.ts";
import { MemoryStore } from "./memoryStore.ts";
import { CampaignSaver } from "./saver.ts";
import { idOf, keyOf, newRec } from "./storeContract.ts";
import type { CampaignRecord, CampaignStore, Logger, SaveResult } from "./types.ts";
import type { Snapshot } from "./sections.ts";

const quietLog = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  const f = (level: string) => (msg: string, fields?: Record<string, unknown>) => void lines.push(`${level} ${msg} ${JSON.stringify(fields ?? {})}`);
  return { lines, debug: f("debug"), info: f("info"), warn: f("warn"), error: f("error") };
};
const snap = (n: number, extra: Record<string, string> = {}): Snapshot => ({ sections: { campaign: `{"n":${n}}`, ...extra }, sectionVersions: { campaign: 1, ...Object.fromEntries(Object.keys(extra).map((k) => [k, 1])) } });

interface Fake extends CampaignStore {
  calls: { rec: CampaignRecord; expected: number | null }[];
  active: number;
  maxActive: number;
}
/** A scriptable store: `script` is consumed one entry per save() (a function may await, a result is returned, "throw" rejects). */
function fakeStore(script: (SaveResult | "throw" | (() => Promise<SaveResult>))[] = [], loadResult?: () => Promise<CampaignRecord | undefined>): Fake {
  const f: Fake = {
    calls: [],
    active: 0,
    maxActive: 0,
    async save(rec, expected) {
      f.calls.push({ rec: structuredClone(rec), expected });
      f.active++;
      f.maxActive = Math.max(f.maxActive, f.active);
      try {
        await Promise.resolve();
        const step = script.length ? script.shift()! : ({ ok: true, rev: (expected ?? 0) + 1 } as SaveResult);
        if (step === "throw") throw new Error("store exploded");
        return typeof step === "function" ? await step() : step;
      } finally {
        f.active--;
      }
    },
    load: loadResult ?? (async () => undefined),
    findByCode: async () => undefined,
    list: async () => [],
    delete: async () => false,
    deleteByIdentity: async () => 0,
    purgeDormant: async () => 0,
    close: async () => undefined,
  };
  return f;
}

const mkSaver = (store: CampaignStore, sleeps: number[] = [], log = quietLog()) =>
  new CampaignSaver(store, { now: () => 1_000_000, log, pepper: "test-pepper-test-pepper", sleep: async (ms) => void sleeps.push(ms) });

describe("CampaignSaver", () => {
  it("saves a new record with expectedRev null, then follows the revision it is given", async () => {
    const store = fakeStore();
    const s = mkSaver(store);
    s.bind(newRec(1));
    expect(await s.saveNow(snap(1))).toEqual({ ok: true, rev: 1 });
    expect(await s.saveNow(snap(2))).toEqual({ ok: true, rev: 2 });
    expect(store.calls.map((c) => c.expected)).toEqual([null, 1]);
    expect(store.calls[1]!.rec.sections.campaign).toBe('{"n":2}');
    expect(s.record?.rev).toBe(2);
  });

  it("a bound record that was loaded (rev > 0) saves against that rev", async () => {
    const store = fakeStore();
    const s = mkSaver(store);
    s.bind({ ...newRec(1), rev: 5 });
    await s.saveNow(snap(1));
    expect(store.calls[0]!.expected).toBe(5);
  });

  it("before bind there is nothing to save: invalid, store untouched", async () => {
    const store = fakeStore();
    expect(await mkSaver(store).saveNow(snap(1))).toEqual({ ok: false, reason: "invalid" });
    expect(store.calls).toHaveLength(0);
  });

  it("carries sections it does not know (and their versions) through verbatim", async () => {
    const store = fakeStore();
    const s = mkSaver(store);
    s.bind({ ...newRec(1), rev: 1, sections: { campaign: "{}", fromTheFuture: '{"keep":"me"}' }, sectionVersions: { campaign: 1, fromTheFuture: 9 } });
    await s.saveNow(snap(3, { party: "{}" }));
    expect(store.calls[0]!.rec.sections).toEqual({ campaign: '{"n":3}', fromTheFuture: '{"keep":"me"}', party: "{}" });
    expect(store.calls[0]!.rec.sectionVersions.fromTheFuture).toBe(9);
  });

  it("is serial: overlapping saveNow calls never reach the store at the same time", async () => {
    const store = fakeStore();
    const s = mkSaver(store);
    s.bind(newRec(1));
    await Promise.all([1, 2, 3, 4, 5, 6].map((n) => s.saveNow(snap(n))));
    expect(store.maxActive).toBe(1);
  });

  it("coalesces a burst: one in flight, the rest become ONE follow-up with the latest sections", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = fakeStore([async () => (await gate, { ok: true, rev: 1 })]);
    const s = mkSaver(store);
    s.bind(newRec(1));
    const first = s.saveNow(snap(1));
    await Promise.resolve();
    const burst = [2, 3, 4, 5].map((n) => s.saveNow(snap(n)));
    release();
    const results = await Promise.all([first, ...burst]);
    expect(store.calls).toHaveLength(2);
    expect(store.calls[0]!.rec.sections.campaign).toBe('{"n":1}');
    expect(store.calls[1]!.rec.sections.campaign).toBe('{"n":5}');
    expect(store.calls[1]!.expected).toBe(1);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]).toEqual({ ok: true, rev: 1 });
    expect(results[4]).toEqual({ ok: true, rev: 2 });
  });

  it("retries an io failure three times with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const store = fakeStore([{ ok: false, reason: "io" }, "throw", { ok: false, reason: "io" }, { ok: true, rev: 1 }]);
    const s = mkSaver(store, sleeps);
    s.bind(newRec(1));
    const before = metrics.saveFailures;
    expect(await s.saveNow(snap(1))).toEqual({ ok: true, rev: 1 });
    expect(store.calls).toHaveLength(4);
    expect(sleeps).toEqual([100, 400, 1600]);
    expect(metrics.saveFailures).toBe(before);
  });

  it("gives up after the retries: reports io, counts one failure, never throws, and the NEXT save tries again", async () => {
    const store = fakeStore(["throw", "throw", "throw", "throw"]);
    const s = mkSaver(store);
    s.bind(newRec(1));
    const before = metrics.saveFailures;
    await expect(s.saveNow(snap(1))).resolves.toEqual({ ok: false, reason: "io" });
    expect(store.calls).toHaveLength(4);
    expect(metrics.saveFailures).toBe(before + 1);
    expect(s.stopped).toBe(false);
    expect(await s.saveNow(snap(2))).toEqual({ ok: true, rev: 1 });
    expect(store.calls[4]!.expected).toBeNull();
  });

  it("a conflict means another process owns the campaign: stop, never overwrite, stay stopped until rebound", async () => {
    const store = fakeStore([{ ok: false, reason: "conflict", currentRev: 7 }], async () => ({ ...newRec(1), rev: 7 }));
    const s = mkSaver(store);
    s.bind({ ...newRec(1), rev: 2 });
    const before = metrics.saveFailures;
    expect(await s.saveNow(snap(1))).toEqual({ ok: false, reason: "conflict", currentRev: 7 });
    expect(s.stopped).toBe(true);
    expect(metrics.saveFailures).toBe(before + 1);
    expect(await s.saveNow(snap(2))).toEqual({ ok: false, reason: "conflict", currentRev: 7 });
    expect(store.calls).toHaveLength(1);
    s.bind({ ...newRec(1), rev: 7 });
    expect(s.stopped).toBe(false);
    expect(await s.saveNow(snap(3))).toMatchObject({ ok: true });
  });

  it("an acknowledgement lost to an io error is not mistaken for another writer", async () => {
    const mem = new MemoryStore({ now: () => 1_000_000 });
    let dropAck = true;
    const wrapper: CampaignStore = {
      ...mem,
      load: (id) => mem.load(id),
      save: async (rec, expected) => {
        const res = await mem.save(rec, expected);
        if (dropAck && res.ok) {
          dropAck = false;
          return { ok: false, reason: "io" };
        }
        return res;
      },
    } as CampaignStore;
    const s = mkSaver(wrapper);
    s.bind(newRec(1));
    expect(await s.saveNow(snap(1))).toEqual({ ok: true, rev: 1 });
    expect(s.stopped).toBe(false);
    expect(await s.saveNow(snap(2))).toEqual({ ok: true, rev: 2 });
    expect((await mem.load(idOf(1)))?.sections.campaign).toBe('{"n":2}');
  });

  it("too_large / invalid are not retried and do not stop the saver", async () => {
    const store = fakeStore([{ ok: false, reason: "too_large" }]);
    const s = mkSaver(store);
    s.bind(newRec(1));
    expect(await s.saveNow(snap(1))).toEqual({ ok: false, reason: "too_large" });
    expect(store.calls).toHaveLength(1);
    expect(s.stopped).toBe(false);
    expect(await s.saveNow(snap(2))).toMatchObject({ ok: true });
  });

  it("flush waits for everything queued", async () => {
    const store = fakeStore();
    const s = mkSaver(store);
    s.bind(newRec(1));
    void s.saveNow(snap(1));
    void s.saveNow(snap(2));
    await s.flush(1000);
    expect(store.calls.length).toBeGreaterThan(0);
    expect(store.active).toBe(0);
    expect(s.record?.rev).toBe(store.calls.length);
  });

  it("flush gives up at its timeout when the store hangs, and never rejects", async () => {
    const store = fakeStore([() => new Promise<SaveResult>(() => undefined)]);
    const s = mkSaver(store);
    s.bind(newRec(1));
    void s.saveNow(snap(1));
    const t0 = Date.now();
    await expect(s.flush(40)).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
    await expect(mkSaver(fakeStore()).flush(10)).resolves.toBeUndefined(); // nothing pending: immediate
  });

  it("a store that throws on every call is contained: no rejection, logged, counted", async () => {
    const log = quietLog();
    const store = fakeStore(Array(12).fill("throw"));
    const s = mkSaver(store, [], log);
    s.bind(newRec(1));
    const before = metrics.saveFailures;
    for (let i = 0; i < 3; i++) await expect(s.saveNow(snap(i))).resolves.toMatchObject({ ok: false });
    expect(metrics.saveFailures).toBe(before + 3);
    expect(log.lines.some((l) => l.includes("persistence.save.failed"))).toBe(true);
  });

  it("addMember stores the HMAC key (never the raw id) and keeps the member list capped", async () => {
    const store = fakeStore();
    const s = mkSaver(store);
    s.bind(newRec(1, { owner: keyOf(1), members: [keyOf(1)] }));
    const raw = "3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7a13";
    const key = s.addMember({ kind: "anon", id: raw, assurance: "unverified" });
    expect(s.addMember({ kind: "anon", id: raw, assurance: "unverified" })).toBe(key);
    for (let i = 0; i < 12; i++) s.addMember({ kind: "anon", id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, assurance: "unverified" });
    await s.saveNow(snap(1));
    const saved = store.calls[0]!.rec;
    expect(saved.members.length).toBe(8);
    expect(saved.members).toContain(keyOf(1)); // the owner is never evicted
    expect(JSON.stringify(saved)).not.toContain(raw);
  });

  it("a member who joins while a save is in flight is in the NEXT save (regression: the landed save used to overwrite the room's record with its stale copy)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const store = fakeStore([async () => { await gate; return { ok: true, rev: 1 } as SaveResult; }]);
    const s = mkSaver(store);
    s.bind(newRec(1, { owner: keyOf(1), members: [keyOf(1)] }));
    const first = s.saveNow(snap(1));
    await Promise.resolve();
    const key = s.addMember({ kind: "anon", id: "3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7a13", assurance: "unverified" });
    const second = s.saveNow(snap(2));
    release();
    await first;
    await second;
    expect(store.calls.at(-1)!.rec.members).toContain(key);
    expect(store.calls.at(-1)!.rec.members).toContain(keyOf(1));
  });

  it("end to end on a real memory store: the saved record loads", async () => {
    const mem = new MemoryStore({ now: () => 42 });
    const s = mkSaver(mem);
    s.bind(newRec(9));
    await s.saveNow(snap(7));
    expect(await mem.load(idOf(9))).toMatchObject({ rev: 1, savedAt: 42, sections: { campaign: '{"n":7}' } });
  });
});

