import { describe, expect, it } from "vitest";
import { DAYS_IDLE_CAP as IDLE_DAYS_CAP } from "@cb/shared";
import { idleDays, restore, snapshot, type AnyCodec } from "./sections.ts";
import { DAY_MS } from "./types.ts";

interface Box { n: number }
const boxCodec = (key: string, version = 1): AnyCodec => ({
  key,
  version,
  fresh: (seed): Box => ({ n: seed }),
  parse: (json): Box | undefined => {
    try {
      const o = JSON.parse(json) as { n?: unknown };
      return typeof o.n === "number" ? { n: o.n } : undefined;
    } catch {
      return undefined;
    }
  },
  serialize: (v: Box) => JSON.stringify(v),
});

describe("snapshot / restore", () => {
  const codecs = [boxCodec("campaign"), boxCodec("party"), boxCodec("powers", 2)];

  it("round trips every section and its version", () => {
    const snap = snapshot(codecs, { campaign: { n: 1 }, party: { n: 2 }, powers: { n: 3 } });
    expect(snap).toEqual({ sections: { campaign: '{"n":1}', party: '{"n":2}', powers: '{"n":3}' }, sectionVersions: { campaign: 1, party: 1, powers: 2 } });
    const r = restore(codecs, { seed: 9, ...snap });
    expect(r.values).toEqual({ campaign: { n: 1 }, party: { n: 2 }, powers: { n: 3 } });
    expect([r.repaired, r.added, r.unknown]).toEqual([[], [], []]);
  });

  it("one bad section is replaced by fresh(seed) and reported; the others survive", () => {
    const r = restore(codecs, { seed: 77, sections: { campaign: "{{garbage", party: '{"n":5}', powers: '{"n":6}' }, sectionVersions: { campaign: 1, party: 1, powers: 2 } });
    expect(r.values).toEqual({ campaign: { n: 77 }, party: { n: 5 }, powers: { n: 6 } });
    expect(r.repaired).toEqual(["campaign"]);
  });

  it("a codec that throws, or a section written by a newer module version, counts as repaired", () => {
    const throwing: AnyCodec = { ...boxCodec("party"), parse: () => { throw new Error("boom"); } };
    const r = restore([boxCodec("campaign"), throwing, boxCodec("powers", 2)], { seed: 1, sections: { campaign: '{"n":1}', party: '{"n":2}', powers: '{"n":3}' }, sectionVersions: { campaign: 1, party: 1, powers: 3 } });
    expect(r.repaired.sort()).toEqual(["party", "powers"]);
    expect(r.values.campaign).toEqual({ n: 1 });
  });

  it("a section written by a newer module version is also listed as newer, so the room can refuse to save over it", () => {
    const r = restore([boxCodec("campaign"), boxCodec("powers", 2)], { seed: 1, sections: { campaign: '{"n":1}', powers: '{"n":3}' }, sectionVersions: { campaign: 1, powers: 3 } });
    expect(r.newer).toEqual(["powers"]);
    expect(restore([boxCodec("campaign")], { seed: 1, sections: { campaign: "{{" }, sectionVersions: { campaign: 1 } }).newer).toEqual([]);
  });

  it("a module added since the save gets fresh(seed) and is listed as added, not repaired", () => {
    const r = restore(codecs, { seed: 4, sections: { campaign: '{"n":1}' }, sectionVersions: { campaign: 1 } });
    expect(r.values.powers).toEqual({ n: 4 });
    expect(r.added.sort()).toEqual(["party", "powers"]);
    expect(r.repaired).toEqual([]);
  });

  it("unknown sections are reported so the saver can carry them verbatim; a prototype-ish key is not a section", () => {
    const sections = JSON.parse('{"campaign":"{\\"n\\":1}","future":"{}","__proto__":"x","constructor":"y"}') as Record<string, string>;
    const r = restore([boxCodec("campaign"), boxCodec("constructor")], { seed: 3, sections, sectionVersions: {} });
    expect(r.unknown.sort()).toEqual(["__proto__", "future"]);
    expect(r.values.constructor).toBeDefined();
  });

  it("a live value that is absent is not written", () => {
    expect(snapshot(codecs, { campaign: { n: 1 } }).sections).toEqual({ campaign: '{"n":1}' });
  });
});

describe("idleDays", () => {
  const T = 1_800_000_000_000;
  const h = 3_600_000;
  const table: [string, number, number, 0 | 1 | 2 | 3][] = [
    ["same instant", T, T, 0],
    ["23 h 59", T, T + DAY_MS - 1, 0],
    ["exactly 24 h", T, T + DAY_MS, 1],
    ["47 h", T, T + 47 * h, 1],
    ["48 h", T, T + 48 * h, 2],
    ["72 h", T, T + 72 * h, 3],
    ["ten days (capped)", T, T + 10 * DAY_MS, 3],
    ["a year (capped)", T, T + 365 * DAY_MS, 3],
    ["clock went backwards", T, T - DAY_MS, 0],
    ["NaN saved", NaN, T, 0],
    ["NaN now", T, NaN, 0],
    ["Infinity now", T, Infinity, 0],
  ];
  for (const [name, saved, now, want] of table) it(`${name} -> ${want}`, () => expect(idleDays(saved, now)).toBe(want));
  it("the cap is the frozen contract value", () => expect(IDLE_DAYS_CAP).toBe(3));
});
