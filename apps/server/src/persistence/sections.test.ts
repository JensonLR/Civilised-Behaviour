import { describe, expect, it } from "vitest";
import { DAYS_IDLE_CAP as IDLE_DAYS_CAP } from "@cb/shared";
import { idleDays, quarantineDamaged, restore, snapshot, type AnyCodec } from "./sections.ts";
import { SECTION_RE } from "./record.ts";
import { DAY_MS, MAX_RECORD_BYTES, MAX_SECTIONS } from "./types.ts";

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

describe("quarantineDamaged (persistence review (e))", () => {
  const codecs = [boxCodec("campaign"), boxCodec("party"), boxCodec("powers", 2)];
  type Rec = { seed: number; sections: Record<string, string>; sectionVersions: Record<string, number> };
  const rec: Rec = { seed: 77, sections: { campaign: "{{garbage", party: '{"n":5}', powers: '{"n":6,"later":1}' }, sectionVersions: { campaign: 1, party: 1, powers: 3 } };

  it("a section that failed to parse at THIS version is kept as damaged_<key>, verbatim, before the fresh one replaces it; a newer build's section is not (it is held whole)", () => {
    const r = restore(codecs, rec);
    const q = quarantineDamaged(rec, r);
    expect(q.kept).toEqual(["campaign"]);
    expect(q.sections["damaged_campaign"]).toBe("{{garbage");
    expect(q.sectionVersions["damaged_campaign"]).toBe(1);
    expect("damaged_powers" in q.sections).toBe(false);
    // the copy obeys the record's own rules (the first cut used "damaged.campaign": a dot fails SECTION_RE and the store refused the whole save, silently losing the copy)
    for (const k of Object.keys(q.sections)) expect(SECTION_RE.test(k), k).toBe(true);
    expect(Object.keys(q.sectionVersions).sort()).toEqual(Object.keys(q.sections).sort());
    // and the next save (fresh values over the known keys) leaves the damaged copy alone: it is an unknown key, carried verbatim
    const next = { ...q.sections, ...snapshot(codecs, r.values).sections };
    expect(next["damaged_campaign"]).toBe("{{garbage");
    expect(restore(codecs, { seed: 77, sections: next, sectionVersions: q.sectionVersions }).unknown).toContain("damaged_campaign");
    expect(rec.sections).not.toHaveProperty("damaged_campaign"); // pure
  });

  it("the FIRST damaged copy is kept (a second failure does not overwrite it); nothing to keep leaves the record as it was", () => {
    const once = quarantineDamaged(rec, restore(codecs, rec));
    const again: Rec = { ...once, sections: { ...once.sections, campaign: "{{other garbage" } };
    const twice = quarantineDamaged(again, restore(codecs, again));
    expect(twice.sections["damaged_campaign"]).toBe("{{garbage");
    expect(twice.kept).toEqual([]);
    const clean: Rec = { seed: 1, sections: { campaign: '{"n":1}' }, sectionVersions: { campaign: 1 } };
    expect(quarantineDamaged(clean, restore(codecs, clean))).toMatchObject({ kept: [], sections: clean.sections });
  });

  it("never pushes a record past its limits: too many sections, or too many bytes, and the copy is skipped (reported as skipped)", () => {
    const many: Record<string, string> = { campaign: "{{garbage" };
    for (let i = 0; Object.keys(many).length < MAX_SECTIONS; i++) many[`x${i}`] = "1";
    const full: Rec = { seed: 1, sections: many, sectionVersions: { campaign: 1 } };
    expect(quarantineDamaged(full, restore(codecs, full))).toMatchObject({ kept: [], skipped: ["campaign"] });
    const big: Rec = { seed: 1, sections: { campaign: "{" + "x".repeat(MAX_RECORD_BYTES / 2 + 10) }, sectionVersions: { campaign: 1 } };
    expect(quarantineDamaged(big, restore(codecs, big))).toMatchObject({ kept: [], skipped: ["campaign"] });
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
