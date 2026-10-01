import { afterEach, describe, expect, it, vi } from "vitest";

/** The presentation-slice settings: defaults, persistence, URL overrides, clamping, live notification, reset, and the display attributes. */
async function load(opts: { search?: string; store?: Record<string, string>; reducedMotion?: boolean; storageThrows?: boolean } = {}) {
  vi.resetModules();
  const store = { ...(opts.store ?? {}) };
  vi.stubGlobal("location", { search: opts.search ?? "" });
  vi.stubGlobal(
    "localStorage",
    opts.storageThrows
      ? new Proxy({}, { get: () => () => { throw new Error("blocked"); } })
      : { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] },
  );
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("reduce") && (opts.reducedMotion ?? false) }) });
  return { s: await import("./settings.ts"), store };
}

afterEach(() => vi.unstubAllGlobals());

describe("defaults", () => {
  it("are the ones the docs promise", async () => {
    const { s } = await load();
    expect([s.getVolume("master"), s.getVolume("music"), s.getVolume("sfx"), s.getVolume("ambience")]).toEqual([0.8, 0.6, 0.9, 0.8]);
    expect(s.getMuteUnfocused()).toBe(true);
    expect(s.getGfx()).toBe("medium");
    expect(s.getUiScale()).toBe(1);
    expect(s.getFov()).toBe(65);
    expect(s.getSensitivity()).toBe(1);
    expect(s.getPadSensitivity()).toBe(1);
    expect(s.getInvertY()).toBe(false);
    expect(s.getHoldToSprint()).toBe(true);
    expect(s.getCvd()).toBe(false);
    expect(s.getHighContrast()).toBe(false);
    expect(s.getLargeText()).toBe(false);
    expect(s.getCaptions()).toBe(false);
    expect(s.getShake()).toBe(1);
    expect(s.getReduceMotion()).toBe(false);
  });

  it("reduced motion follows the system until the player chooses, and an explicit choice wins", async () => {
    expect((await load({ reducedMotion: true })).s.getReduceMotion()).toBe(true);
    const a = await load({ reducedMotion: true });
    a.s.setReduceMotion(false);
    expect((await load({ reducedMotion: true, store: a.store })).s.getReduceMotion()).toBe(false);
  });
});

describe("persistence and overrides", () => {
  it("numbers and flags round-trip through storage", async () => {
    const a = await load();
    a.s.setVolume("music", 0.25);
    a.s.setUiScale(1.25);
    a.s.setFov(90);
    a.s.setCvd(true);
    a.s.setCaptions(true);
    a.s.setGfx("high");
    a.s.setHoldToSprint(false);
    const b = await load({ store: a.store });
    expect(b.s.getVolume("music")).toBe(0.25);
    expect(b.s.getUiScale()).toBe(1.25);
    expect(b.s.getFov()).toBe(90);
    expect(b.s.getCvd()).toBe(true);
    expect(b.s.getCaptions()).toBe(true);
    expect(b.s.getGfx()).toBe("high");
    expect(b.s.getHoldToSprint()).toBe(false);
  });

  it("values are clamped to their range, and junk falls back to the default", async () => {
    const a = await load();
    a.s.setUiScale(9);
    expect(a.s.getUiScale()).toBe(1.5);
    a.s.setUiScale(0.1);
    expect(a.s.getUiScale()).toBe(0.8);
    a.s.setVolume("master", 3);
    expect(a.s.getVolume("master")).toBe(1);
    a.s.setFov(Number.NaN);
    expect(a.s.getFov()).toBe(65);
    const junk = await load({ store: { "cb.fov": "wide", "cb.gfx": "ultra", "cb.uiScale": "" } });
    expect(junk.s.getFov()).toBe(65);
    expect(junk.s.getGfx()).toBe("medium");
    expect(junk.s.getUiScale()).toBe(1);
    expect((await load({ store: { "cb.uiScale": "400" } })).s.getUiScale()).toBe(1.5);
  });

  it("URL parameters win for the session without touching the saved choice", async () => {
    const { s, store } = await load({ search: "?vol=0.3&gfx=low&ui=1.1&captions=1&cvd=1&contrast=1&sens=2", store: { "cb.vol.master": "0.9", "cb.gfx": "high" } });
    expect(s.getVolume("master")).toBe(0.3);
    expect(s.getGfx()).toBe("low");
    expect(s.getUiScale()).toBe(1.1);
    expect(s.getCaptions()).toBe(true);
    expect(s.getCvd()).toBe(true);
    expect(s.getHighContrast()).toBe(true);
    expect(s.getSensitivity()).toBe(2);
    expect(store["cb.vol.master"]).toBe("0.9");
    expect(store["cb.gfx"]).toBe("high");
  });

  it("the test preset is reachable by URL or storage but is never offered to players", async () => {
    const a = await load({ search: "?gfx=test" });
    expect(a.s.getGfx()).toBe("test");
    expect(a.s.GFX_PLAYER_LEVELS).toEqual(["low", "medium", "high"]);
    expect(a.s.GFX_LEVELS).toContain("test");
    expect((await load({ store: { "cb.gfx": "test" } })).s.getGfx()).toBe("test");
  });

  it("blocked storage still works for the session", async () => {
    const { s } = await load({ storageThrows: true });
    expect(s.getVolume("sfx")).toBe(0.9);
    expect(() => s.setVolume("sfx", 0.1)).not.toThrow();
    expect(s.getVolume("sfx")).toBe(0.1);
    expect(() => s.setGfx("low")).not.toThrow();
    expect(s.getGfx()).toBe("low");
  });
});

describe("live notification and reset", () => {
  it("listeners hear which setting changed, can unsubscribe, and a bad listener cannot break the rest", async () => {
    const { s } = await load();
    const seen: string[] = [];
    const off = s.onSettingChange((k) => seen.push(k));
    s.onSettingChange(() => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    s.setVolume("music", 0.5);
    s.setCaptions(true);
    s.setGore("off");
    s.setView("first");
    expect(seen).toEqual(["vol.music", "captions", "gore", "view"]);
    off();
    s.setCvd(true);
    expect(seen).toHaveLength(4);
    warn.mockRestore();
  });

  it("restore defaults undoes everything, including the older settings, and announces it", async () => {
    const a = await load();
    a.s.setVolume("master", 0.1);
    a.s.setGore("off");
    a.s.setShowLimbs(false);
    a.s.setView("first");
    a.s.setHeadBob(false);
    a.s.setGfx("low");
    const seen: string[] = [];
    a.s.onSettingChange((k) => seen.push(k));
    a.s.resetAllSettings();
    expect(seen).toEqual(["all"]);
    expect(a.s.getVolume("master")).toBe(0.8);
    expect(a.s.getGore()).toBe("full");
    expect(a.s.getShowLimbs()).toBe(true);
    expect(a.s.getView()).toBe("third");
    expect(a.s.getHeadBob()).toBe(true);
    expect(a.s.getGfx()).toBe("medium");
    expect(Object.keys(a.store)).toEqual([]);
  });
});

describe("display attributes", () => {
  const fakeRoot = () => {
    const vars: Record<string, string> = {};
    return { vars, style: { setProperty: (n: string, v: string) => void (vars[n] = v) }, dataset: {} as Record<string, string | undefined> };
  };

  it("writes the scale and only the modes that are on", async () => {
    const { s } = await load();
    const root = fakeRoot();
    s.applyDisplaySettings(root);
    expect(root.vars["--ui-scale"]).toBe("1");
    expect(root.dataset).toEqual({});
    s.setUiScale(1.25);
    s.setLargeText(true);
    s.setCvd(true);
    s.setHighContrast(true);
    s.setReduceMotion(true);
    s.applyDisplaySettings(root);
    expect(Number(root.vars["--ui-scale"])).toBeCloseTo(1.5, 5);
    expect(root.dataset).toEqual({ cvd: "1", contrast: "high", largeText: "1", motion: "reduced" });
    s.setCvd(false);
    s.applyDisplaySettings(root);
    expect(root.dataset.cvd).toBeUndefined();
  });

  it("reduced motion caps camera shake, otherwise the slider decides", async () => {
    const { s } = await load();
    s.setShake(0.8);
    expect(s.effectiveShake()).toBe(0.8);
    s.setReduceMotion(true);
    expect(s.effectiveShake()).toBe(0.2);
    s.setShake(0.1);
    expect(s.effectiveShake()).toBe(0.1);
  });
});

describe("D-038 pad, aim, glyph and music settings", () => {
  it("have the documented defaults, clamp, persist, notify and reset", async () => {
    const { s, store } = await load();
    expect([s.getPadDeadzone(), s.getPadCurve(), s.getPadAimSensitivity()]).toEqual([0.18, 1.6, 0.6]);
    expect([s.getAimAssist(), s.getHoldToAim(), s.getPadRumble(), s.getAdaptiveMusic()]).toEqual([true, true, true, true]);
    expect(s.getGlyphPreference()).toBe("auto");
    const seen: string[] = [];
    s.onSettingChange((k) => seen.push(k));
    s.setPadDeadzone(9);
    expect(s.getPadDeadzone()).toBe(0.4);
    s.setPadAimSensitivity(0.8);
    s.setAimAssist(false);
    s.setHoldToAim(false);
    s.setGlyphPreference("playstation");
    expect(store["cb.glyphs"]).toBe("playstation");
    expect(seen).toEqual(["padDeadzone", "padAimSensitivity", "aimAssist", "holdToAim", "glyphs"]);
    s.resetAllSettings();
    expect([s.getPadDeadzone(), s.getPadAimSensitivity(), s.getAimAssist(), s.getHoldToAim(), s.getGlyphPreference()]).toEqual([0.18, 0.6, true, true, "auto"]);
    expect(store["cb.glyphs"]).toBeUndefined();
  });
  it("a URL override applies for the session and a bad glyph value is ignored", async () => {
    const { s } = await load({ search: "?glyphs=xbox&aimassist=0&paddead=0.3" });
    expect(s.getGlyphPreference()).toBe("xbox");
    expect(s.getAimAssist()).toBe(false);
    expect(s.getPadDeadzone()).toBe(0.3);
    const bad = await load({ search: "?glyphs=nintendo" });
    expect(bad.s.getGlyphPreference()).toBe("auto");
  });
});
