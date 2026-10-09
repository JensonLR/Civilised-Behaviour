// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPEDITIONS_KEY, MAX_EXPEDITIONS, ageText, cleanName, clearOrientProgress, expeditionMeta, forgetExpedition, getOrientProgress, listExpeditions, mostRecentExpedition, noteExpedition,
  parseExpeditions, quietOrientationForJoiner, serializeExpeditions, setOrientProgress, upsertExpedition, withoutExpedition, type Expedition,
} from "./expeditions.ts";

/** The local "Your expeditions" record (D-039): validated on read, versioned, capped, and safe against corrupt or hostile storage. */

const NOW = Date.now();
const ex = (code: string, extra: Partial<Expedition> = {}): Expedition => ({ code, name: "Ada", region: "hollowmere", day: 0, lastPlayed: NOW - 1000, ...extra });
const raw = (list: unknown, v: unknown = 1): string => JSON.stringify({ v, list });
const CODES = ["K7M2Q", "R4T9W", "H3N6P", "B8D5F", "C2G7J", "M9X4V", "T6Y3Z", "W5Q8K", "D2F4H", "J7L9N", "P3R6T", "V8X2B", "Z4C7M", "F9G5S"];

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseExpeditions: what comes back from storage", () => {
  it("round-trips a good record, newest first", () => {
    const list = [ex("K7M2Q", { lastPlayed: NOW - 5000, region: "kessar", day: 4 }), ex("R4T9W", { lastPlayed: NOW - 1000, orient: { done: 5, skipped: false } })];
    const back = parseExpeditions(serializeExpeditions(list), NOW);
    expect(back.map((e) => e.code)).toEqual(["R4T9W", "K7M2Q"]);
    expect(back[1]).toMatchObject({ region: "kessar", day: 4, name: "Ada" });
    expect(back[0]!.orient).toEqual({ done: 5, skipped: false });
  });

  it("anything that is not the current version's plain shape is an empty list, never a throw", () => {
    for (const bad of [undefined, null, 5, {}, [], "", "not json", "{", "null", "[]", '"x"', raw([], 2), raw([], "1"), raw({}), raw("x"), JSON.stringify({ list: [ex("K7M2Q")] }), "x".repeat(100_000)]) {
      expect(() => parseExpeditions(bad, NOW)).not.toThrow();
      expect(parseExpeditions(bad, NOW)).toEqual([]);
    }
  });

  it("a bad entry in a good list is dropped alone; its neighbours survive", () => {
    const list = [
      ex("K7M2Q"),
      null, 7, "x", [], {},
      { code: "toolong1", lastPlayed: 1 }, { code: "K7M2", lastPlayed: 1 }, { code: "ABCDI", lastPlayed: 1 }, { code: "ABC10", lastPlayed: 1 }, // (a code outside the join alphabet or the wrong length)
      { code: "R4T9W" }, { code: "R4T9W", lastPlayed: "yesterday" }, { code: "R4T9W", lastPlayed: -5 }, { code: "R4T9W", lastPlayed: NaN }, { code: "R4T9W", lastPlayed: Infinity },
      ex("H3N6P", { lastPlayed: NOW - 3000 }),
    ];
    expect(parseExpeditions(raw(list), NOW).map((e) => e.code)).toEqual(["K7M2Q", "H3N6P"]);
  });

  it("each field is validated alone: a bad region, day, name or orientation falls back, the entry stays", () => {
    const [e] = parseExpeditions(raw([{ code: "k7m2q", name: 42, region: "atlantis", day: -3, lastPlayed: NOW - 1, orient: { done: 999, skipped: "yes" } }]), NOW);
    expect(e).toEqual({ code: "K7M2Q", name: "", region: "hollowmere", day: 0, lastPlayed: NOW - 1 });
    const [f] = parseExpeditions(raw([{ code: "K7M2Q", region: "kessar", day: 1.5, lastPlayed: NOW - 1, orient: { done: 63, skipped: true } }]), NOW);
    expect(f).toMatchObject({ region: "kessar", day: 0, orient: { done: 63, skipped: true } });
  });

  it("a prototype-pollution attempt changes nothing and adds no keys", () => {
    const hostile = '{"v":1,"list":[{"code":"K7M2Q","lastPlayed":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"orient":{"__proto__":{"polluted":true},"done":1}}]}';
    const out = parseExpeditions(hostile, NOW);
    expect(out).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(out[0]!).sort()).toEqual(["code", "day", "lastPlayed", "name", "orient", "region"].sort());
  });

  it("a name is only text: markup, control characters and length are cleaned", () => {
    expect(cleanName("<b>Ada</b>\u0000\u0007")).toBe("bAda/b");
    expect(cleanName("x".repeat(500))).toHaveLength(20);
    expect(cleanName(undefined)).toBe("");
    expect(cleanName({})).toBe("");
    expect(cleanName("  Sir Reginald  ")).toBe("Sir Reginald");
  });

  it("a clock that was wrong once cannot pin an entry above the others: a future time is clamped to now", () => {
    const out = parseExpeditions(raw([{ code: "K7M2Q", lastPlayed: NOW + 10 * 365 * 86_400_000 }, ex("R4T9W", { lastPlayed: NOW - 10 })]), NOW);
    expect(out[0]!.lastPlayed).toBe(NOW);
    expect(out).toHaveLength(2);
  });

  it("duplicates collapse to the newest, and the list is capped (a huge hostile list does no work beyond the cap)", () => {
    const dupes = [ex("K7M2Q", { lastPlayed: NOW - 500, day: 1 }), ex("K7M2Q", { lastPlayed: NOW - 100, day: 9 })];
    expect(parseExpeditions(raw(dupes), NOW)).toEqual([expect.objectContaining({ code: "K7M2Q", day: 9 })]);
    const many = CODES.map((c, i) => ex(c, { lastPlayed: NOW - (i + 1) * 1000 }));
    const out = parseExpeditions(raw(many), NOW);
    expect(out).toHaveLength(MAX_EXPEDITIONS);
    expect(out[0]!.code).toBe(CODES[0]);
    const flood = Array.from({ length: 50_000 }, () => ex("K7M2Q"));
    const t0 = performance.now();
    expect(parseExpeditions(raw(flood), NOW).length).toBeLessThanOrEqual(MAX_EXPEDITIONS);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("upsert / forget (pure)", () => {
  it("adds, then updates in place keeping what the patch does not mention, and moves it to the front", () => {
    let list = upsertExpedition([], "k7m2q", { name: "Ada", region: "kessar", day: 3 }, NOW - 9000);
    list = upsertExpedition(list, "R4T9W", { name: "Bea" }, NOW - 5000);
    list = upsertExpedition(list, "K7M2Q", { day: 4 }, NOW);
    expect(list.map((e) => e.code)).toEqual(["K7M2Q", "R4T9W"]);
    expect(list[0]).toMatchObject({ name: "Ada", region: "kessar", day: 4, lastPlayed: NOW });
  });

  it("an invalid code is ignored; an invalid patch value does not replace a good one", () => {
    const list = [ex("K7M2Q", { region: "kessar", day: 3 })];
    expect(upsertExpedition(list, "nope", { day: 9 }, NOW)).toEqual(list);
    expect(upsertExpedition(list, "K7M2Q", { region: "narnia", day: -1 }, NOW)[0]).toMatchObject({ region: "kessar", day: 3 });
    expect(upsertExpedition(list, "K7M2Q", { day: Number.NaN }, NOW)[0]!.day).toBe(3);
  });

  it("is capped: the oldest goes when a thirteenth arrives", () => {
    let list: Expedition[] = [];
    CODES.slice(0, MAX_EXPEDITIONS + 1).forEach((c, i) => (list = upsertExpedition(list, c, {}, NOW - 100_000 + i * 1000)));
    expect(list).toHaveLength(MAX_EXPEDITIONS);
    expect(list.some((e) => e.code === CODES[0])).toBe(false);
  });

  it("withoutExpedition removes one code, any case", () => {
    expect(withoutExpedition([ex("K7M2Q"), ex("R4T9W")], "k7m2q").map((e) => e.code)).toEqual(["R4T9W"]);
  });
});

describe("the stored record", () => {
  it("note, list, most recent, forget; storage holds only the versioned shape", () => {
    noteExpedition("K7M2Q", { name: "Ada", region: "kessar", day: 2 }, NOW - 5000);
    noteExpedition("R4T9W", { name: "Bea" }, NOW);
    expect(listExpeditions(NOW).map((e) => e.code)).toEqual(["R4T9W", "K7M2Q"]);
    expect(mostRecentExpedition(NOW)?.code).toBe("R4T9W");
    const stored = JSON.parse(localStorage.getItem(EXPEDITIONS_KEY)!);
    expect(stored.v).toBe(1);
    expect(Object.keys(stored).sort()).toEqual(["list", "v"]);
    // nothing but the door's own fields: no seed, no token, no member key
    for (const e of stored.list) expect(Object.keys(e).every((k) => ["code", "name", "region", "day", "lastPlayed", "orient"].includes(k))).toBe(true);
    forgetExpedition("r4t9w");
    expect(listExpeditions(NOW).map((e) => e.code)).toEqual(["K7M2Q"]);
    forgetExpedition("K7M2Q");
    expect(localStorage.getItem(EXPEDITIONS_KEY)).toBeNull(); // an empty list leaves no key behind
  });

  it("D-101: a joiner of a running expedition is not put through the welcome card; progress already kept there is left alone", () => {
    noteExpedition("W4X7Z", {}, NOW);
    quietOrientationForJoiner("W4X7Z");
    expect(getOrientProgress("W4X7Z")).toEqual({ done: 0, skipped: true });
    noteExpedition("K7M2Q", {}, NOW);
    setOrientProgress("K7M2Q", { done: 5, skipped: false });
    quietOrientationForJoiner("K7M2Q");
    expect(getOrientProgress("K7M2Q")).toEqual({ done: 5, skipped: false });
  });

  it("orientation progress is per code, leaves lastPlayed alone, and is not created for an unknown campaign", () => {
    noteExpedition("K7M2Q", {}, NOW - 5000);
    noteExpedition("R4T9W", {}, NOW);
    setOrientProgress("K7M2Q", { done: 3, skipped: false });
    expect(getOrientProgress("K7M2Q")).toEqual({ done: 3, skipped: false });
    expect(getOrientProgress("R4T9W")).toBeUndefined();
    expect(listExpeditions(NOW).map((e) => e.code)).toEqual(["R4T9W", "K7M2Q"]); // (order unchanged)
    setOrientProgress("H3N6P", { done: 1, skipped: true });
    expect(listExpeditions(NOW).map((e) => e.code)).not.toContain("H3N6P");
    clearOrientProgress("K7M2Q");
    expect(getOrientProgress("K7M2Q")).toBeUndefined();
    expect(() => clearOrientProgress("H3N6P")).not.toThrow();
  });

  it("corrupt storage reads as empty and the next note repairs it", () => {
    localStorage.setItem(EXPEDITIONS_KEY, "{{{ definitely not json");
    expect(listExpeditions(NOW)).toEqual([]);
    noteExpedition("K7M2Q", { name: "Ada" }, NOW);
    expect(listExpeditions(NOW).map((e) => e.code)).toEqual(["K7M2Q"]);
    localStorage.setItem(EXPEDITIONS_KEY, JSON.stringify({ v: 1, list: "nope" }));
    expect(listExpeditions(NOW)).toEqual([]);
  });

  it("blocked storage (private window, cleared or denied site data) never throws and just remembers nothing", () => {
    vi.stubGlobal("localStorage", new Proxy({}, { get: () => () => { throw new Error("blocked"); } }));
    expect(() => noteExpedition("K7M2Q", { name: "Ada" })).not.toThrow();
    expect(listExpeditions()).toEqual([]);
    expect(() => forgetExpedition("K7M2Q")).not.toThrow();
    expect(() => setOrientProgress("K7M2Q", { done: 1, skipped: false })).not.toThrow();
    expect(() => clearOrientProgress("K7M2Q")).not.toThrow();
    expect(getOrientProgress("K7M2Q")).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("a quota error on write is swallowed", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } });
    expect(() => noteExpedition("K7M2Q")).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("words", () => {
  it("ages read plainly", () => {
    expect(ageText(0)).toBe("just now");
    expect(ageText(-5)).toBe("just now");
    expect(ageText(Number.NaN)).toBe("just now");
    expect(ageText(5 * 60_000)).toBe("5 min ago");
    expect(ageText(3 * 3_600_000)).toBe("3 h ago");
    expect(ageText(86_400_000)).toBe("1 day ago");
    expect(ageText(3 * 86_400_000)).toBe("3 days ago");
    expect(ageText(30 * 86_400_000)).toBe("4 weeks ago");
  });

  it("the meta line names the code, the last region, the day (when known) and the age", () => {
    expect(expeditionMeta(ex("K7M2Q", { region: "kessar", day: 4, lastPlayed: NOW - 3 * 3_600_000 }), NOW)).toBe("No. K7M2Q · last at Kessar Reach · Day 4 · 3 h ago");
    expect(expeditionMeta(ex("K7M2Q"), NOW)).toBe("No. K7M2Q · last at Hollowmere Depot · just now");
  });
});
