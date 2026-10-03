import { beforeEach, describe, expect, it } from "vitest";
import { createRecord } from "./record.ts";
import { DAY_MS, MAX_MEMBERS, MAX_RECORD_BYTES, type CampaignRecord, type CampaignStore } from "./types.ts";

export interface StoreHarness {
  /** A fresh, empty store reading `now` as its clock. */
  make(now: () => number): Promise<CampaignStore>;
  /** A second store over the SAME storage (a restart), where the backend can; undefined for memory. */
  reopen?(now: () => number): Promise<CampaignStore>;
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const codeOf = (i: number): string => {
  let s = "";
  for (let n = i + 1000, k = 0; k < 5; k++, n = Math.floor(n / 32)) s = ALPHA[n % 32]! + s;
  return s;
};
export const idOf = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
export const keyOf = (i: number): string => `key${String(i).padStart(3, "0")}${"x".repeat(36)}`;

export function newRec(i: number, over: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    ...createRecord({ id: idOf(i), code: codeOf(i), seed: 1234567 + i, owner: keyOf(i), sections: { campaign: `{"day":${i}}`, party: '{"n":"\\u00e9 \\"q\\" ☃"}' }, sectionVersions: { campaign: 1, party: 1 } }),
    sectionVersions: { campaign: 1, party: 1 },
    ...over,
  };
}

/** ONE contract, run against every CampaignStore implementation (campaign.md section 4 acceptance). */
export function storeContract(name: string, harness: StoreHarness): void {
  describe(`CampaignStore contract: ${name}`, () => {
    const clock = { t: 5_000_000 };
    const now = () => clock.t;
    let store: CampaignStore;
    beforeEach(async () => {
      clock.t = 5_000_000;
      store = await harness.make(now);
    });

    it("save then load and findByCode round trip; the store assigns rev and savedAt; copies are isolated", async () => {
      const r = newRec(1);
      expect(await store.save(r, null)).toEqual({ ok: true, rev: 1 });
      const got = await store.load(r.id);
      expect(got).toEqual({ ...r, rev: 1, savedAt: 5_000_000 });
      expect((await store.findByCode(r.code))?.id).toBe(r.id);
      got!.sections.campaign = "tampered";
      got!.members.push("zzz");
      expect((await store.load(r.id))?.sections.campaign).toBe(r.sections.campaign);
      expect(await store.load(idOf(99))).toBeUndefined();
      expect(await store.findByCode(codeOf(99))).toBeUndefined();
      expect(await store.load("../../etc/passwd")).toBeUndefined();
    });

    it("sections come back byte for byte (unicode, escapes)", async () => {
      const r = newRec(2, { sections: { campaign: '{"a":"é☃\\n\\"","b":[1,2,3]}', powers: "  weird   spacing  ", empty: "" }, sectionVersions: { campaign: 1, powers: 1, empty: 1 } });
      await store.save(r, null);
      expect((await store.load(r.id))?.sections).toEqual(r.sections);
    });

    it("expectedRev: create twice conflicts, stale conflicts, the right rev advances, update of a missing record conflicts", async () => {
      const r = newRec(3);
      expect(await store.save(r, null)).toEqual({ ok: true, rev: 1 });
      expect(await store.save(r, null)).toEqual({ ok: false, reason: "conflict", currentRev: 1 });
      expect(await store.save({ ...r, sections: { ...r.sections, campaign: "{}" } }, 1)).toEqual({ ok: true, rev: 2 });
      expect(await store.save(r, 1)).toEqual({ ok: false, reason: "conflict", currentRev: 2 });
      expect((await store.load(r.id))?.sections.campaign).toBe("{}");
      expect(await store.save(newRec(4), 3)).toMatchObject({ ok: false, reason: "conflict" });
      expect(await store.save(r, -1)).toMatchObject({ ok: false, reason: "invalid" });
      expect(await store.save(r, 1.5)).toMatchObject({ ok: false, reason: "invalid" });
    });

    it("two saves racing on the same rev: exactly one wins", async () => {
      const r = newRec(5);
      await store.save(r, null);
      const [a, b, c] = await Promise.all([store.save({ ...r, sections: { ...r.sections, campaign: '"a"' } }, 1), store.save({ ...r, sections: { ...r.sections, campaign: '"b"' } }, 1), store.save({ ...r, sections: { ...r.sections, campaign: '"c"' } }, 1)]);
      expect([a, b, c].filter((x) => x.ok)).toHaveLength(1);
      expect((await store.load(r.id))?.rev).toBe(2);
    });

    it("a join code belongs to one campaign (create and update)", async () => {
      await store.save(newRec(6), null);
      expect(await store.save(newRec(7, { code: codeOf(6) }), null)).toMatchObject({ ok: false, reason: "conflict" });
      await store.save(newRec(7), null);
      expect(await store.save(newRec(7, { code: codeOf(6) }), 1)).toMatchObject({ ok: false, reason: "conflict" });
      expect((await store.load(idOf(7)))?.code).toBe(codeOf(7));
    });

    it("too_large above 64 KB, accepted just under it", async () => {
      const big = newRec(8, { sections: { campaign: "x".repeat(MAX_RECORD_BYTES + 10) }, sectionVersions: { campaign: 1 } });
      expect(await store.save(big, null)).toEqual({ ok: false, reason: "too_large" });
      expect(await store.load(big.id)).toBeUndefined();
      const fits = newRec(8, { sections: { campaign: "x".repeat(MAX_RECORD_BYTES - 1000) }, sectionVersions: { campaign: 1 } });
      expect(await store.save(fits, null)).toEqual({ ok: true, rev: 1 });
    });

    it("invalid records are refused and nothing is stored", async () => {
      const ok = newRec(9);
      const bads: unknown[] = [
        { ...ok, id: "../x" },
        { ...ok, id: "short" },
        { ...ok, code: "abc" },
        { ...ok, code: "ABCD0" },
        { ...ok, seed: -1 },
        { ...ok, seed: 2 ** 32 },
        { ...ok, seed: 1.5 },
        { ...ok, v: 2 },
        { ...ok, owner: "bad owner!" },
        { ...ok, members: [ok.owner, ok.owner] },
        { ...ok, members: Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => keyOf(i)) },
        { ...ok, sections: { "Bad Name": "{}" }, sectionVersions: { "Bad Name": 1 } },
        { ...ok, sections: { campaign: 5 }, sectionVersions: { campaign: 1 } },
        { ...ok, sectionVersions: {} },
        { ...ok, sections: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`s${i}`, "{}"])), sectionVersions: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`s${i}`, 1])) },
        null,
        "string",
        [],
      ];
      for (const b of bads) expect(await store.save(b as CampaignRecord, null)).toEqual({ ok: false, reason: "invalid" });
      expect(await store.load(ok.id)).toBeUndefined();
    });

    it("the members cap is 8", async () => {
      const members = Array.from({ length: MAX_MEMBERS }, (_, i) => keyOf(i));
      expect(await store.save(newRec(10, { owner: members[0]!, members }), null)).toEqual({ ok: true, rev: 1 });
      expect((await store.load(idOf(10)))?.members).toEqual(members);
    });

    it("list: only the member's campaigns, newest save first", async () => {
      await store.save(newRec(11, { owner: keyOf(1), members: [keyOf(1), keyOf(2)] }), null);
      clock.t += 1000;
      await store.save(newRec(12, { owner: keyOf(1), members: [keyOf(1)] }), null);
      clock.t += 1000;
      await store.save(newRec(13, { owner: keyOf(3), members: [keyOf(3)] }), null);
      expect((await store.list(keyOf(1))).map((x) => x.id)).toEqual([idOf(12), idOf(11)]);
      expect(await store.list(keyOf(2))).toEqual([{ id: idOf(11), code: codeOf(11), savedAt: 5_000_000 }]);
      expect(await store.list("nobody")).toEqual([]);
    });

    it("delete removes it once", async () => {
      const r = newRec(14);
      await store.save(r, null);
      expect(await store.delete(r.id)).toBe(true);
      expect(await store.delete(r.id)).toBe(false);
      expect(await store.load(r.id)).toBeUndefined();
      expect(await store.findByCode(r.code)).toBeUndefined();
      expect(await store.delete("../x")).toBe(false);
    });

    it("deleteByIdentity: leaves shared campaigns (owner re-pointed, rev moves, savedAt kept) and deletes sole-member ones", async () => {
      await store.save(newRec(15, { owner: keyOf(1), members: [keyOf(1), keyOf(2), keyOf(3)] }), null);
      await store.save(newRec(16, { owner: keyOf(1), members: [keyOf(1)] }), null);
      await store.save(newRec(17, { owner: keyOf(2), members: [keyOf(2)] }), null);
      clock.t += 10 * DAY_MS;
      expect(await store.deleteByIdentity(keyOf(1))).toBe(2);
      const shared = await store.load(idOf(15));
      expect(shared).toMatchObject({ owner: keyOf(2), members: [keyOf(2), keyOf(3)], rev: 2, savedAt: 5_000_000 });
      expect(await store.load(idOf(16))).toBeUndefined();
      expect(await store.load(idOf(17))).toBeDefined();
      expect(await store.list(keyOf(1))).toEqual([]);
      expect(await store.deleteByIdentity(keyOf(1))).toBe(0);
    });

    it("deleteByIdentity reaches the sections: a key held in one (D-055: honours) is erased, members' or not, and other sections are untouched", async () => {
      const honours = (by: Record<string, string[]>) => JSON.stringify({ v: 1, by });
      await store.save(newRec(21, { owner: keyOf(4), members: [keyOf(4), keyOf(5)], sections: { honours: honours({ [keyOf(4)]: ["sturdy"], [keyOf(5)]: ["terror"] }), idle: "3" }, sectionVersions: { honours: 1, idle: 1 } }), null);
      // a stale key nobody's book holds any more (only a section mentions it)
      await store.save(newRec(22, { owner: keyOf(6), members: [keyOf(6)], sections: { honours: honours({ [keyOf(5)]: ["bandager"], [keyOf(6)]: ["peacemaker"] }) }, sectionVersions: { honours: 1 } }), null);
      expect(await store.deleteByIdentity(keyOf(5))).toBe(2);
      const a = await store.load(idOf(21));
      expect(a?.members).toEqual([keyOf(4)]);
      expect(JSON.parse(a!.sections.honours!)).toEqual({ v: 1, by: { [keyOf(4)]: ["sturdy"] } });
      expect(a?.sections.idle).toBe("3");
      const b = await store.load(idOf(22));
      expect(JSON.parse(b!.sections.honours!)).toEqual({ v: 1, by: { [keyOf(6)]: ["peacemaker"] } });
      expect(JSON.stringify([a, b])).not.toContain(keyOf(5));
      expect(await store.deleteByIdentity(keyOf(5))).toBe(0);
    });

    it("purgeDormant deletes only campaigns not saved within the window", async () => {
      await store.save(newRec(18), null);
      clock.t += 100 * DAY_MS;
      await store.save(newRec(19), null);
      clock.t += 100 * DAY_MS;
      await store.save(newRec(20), null);
      expect(await store.purgeDormant(150 * DAY_MS)).toBe(1);
      expect(await store.load(idOf(18))).toBeUndefined();
      expect(await store.load(idOf(19))).toBeDefined();
      expect(await store.purgeDormant(150 * DAY_MS)).toBe(0);
      clock.t += 100 * DAY_MS;
      expect(await store.purgeDormant(150 * DAY_MS)).toBe(1);
    });

    const reopen = harness.reopen;
    if (reopen) {
      it("survives a restart: a second store over the same storage sees everything", async () => {
        const r = newRec(21);
        await store.save(r, null);
        await store.save({ ...r, sections: { ...r.sections, campaign: '{"later":1}' } }, 1);
        await store.close();
        const again = await reopen(now);
        expect(await again.load(r.id)).toMatchObject({ rev: 2, sections: { campaign: '{"later":1}' } });
        expect((await again.findByCode(r.code))?.id).toBe(r.id);
        await again.close();
      });
    }
  });
}
