import { afterEach, describe, expect, it, vi } from "vitest";

/** settings.ts caches in module state and reads `location`/`localStorage`/`matchMedia`: reload it fresh with fakes for each case. */
async function load(opts: { search?: string; store?: Record<string, string>; reducedMotion?: boolean; storageThrows?: boolean } = {}) {
  vi.resetModules();
  const store = { ...(opts.store ?? {}) };
  vi.stubGlobal("location", { search: opts.search ?? "" });
  vi.stubGlobal(
    "localStorage",
    opts.storageThrows
      ? new Proxy({}, { get: () => () => { throw new Error("blocked"); } })
      : { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) },
  );
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("reduce") && (opts.reducedMotion ?? false) }) });
  return { settings: await import("./settings.ts"), store };
}

afterEach(() => vi.unstubAllGlobals());

describe("camera view setting", () => {
  it("defaults to third person", async () => {
    const { settings } = await load();
    expect(settings.getView()).toBe("third");
  });

  it("persists the choice across sessions", async () => {
    const a = await load();
    a.settings.setView("first");
    expect(a.store["cb.view"]).toBe("first");
    const b = await load({ store: a.store });
    expect(b.settings.getView()).toBe("first");
    b.settings.setView("third");
    expect((await load({ store: b.store })).settings.getView()).toBe("third");
  });

  it("?view= overrides the saved choice for the session without overwriting it", async () => {
    const { settings, store } = await load({ search: "?view=first", store: { "cb.view": "third" } });
    expect(settings.getView()).toBe("first");
    expect(store["cb.view"]).toBe("third");
    expect((await load({ search: "?view=third", store: { "cb.view": "first" } })).settings.getView()).toBe("third");
  });

  it("ignores junk values and survives blocked storage", async () => {
    expect((await load({ search: "?view=sideways" })).settings.getView()).toBe("third");
    expect((await load({ store: { "cb.view": "nonsense" } })).settings.getView()).toBe("third");
    const blocked = await load({ storageThrows: true });
    expect(blocked.settings.getView()).toBe("third");
    expect(() => blocked.settings.setView("first")).not.toThrow();
    expect(blocked.settings.getView()).toBe("first"); // still honoured for this session
  });
});

describe("head bob setting", () => {
  it("is on by default, and off by default for players who ask for reduced motion", async () => {
    expect((await load()).settings.getHeadBob()).toBe(true);
    expect((await load({ reducedMotion: true })).settings.getHeadBob()).toBe(false);
  });

  it("an explicit choice beats the reduced-motion default, and persists", async () => {
    const a = await load({ reducedMotion: true });
    a.settings.setHeadBob(true);
    expect(a.settings.getHeadBob()).toBe(true);
    const b = await load({ reducedMotion: true, store: a.store });
    expect(b.settings.getHeadBob()).toBe(true);
    b.settings.setHeadBob(false);
    expect((await load({ store: b.store })).settings.getHeadBob()).toBe(false);
  });

  it("?headbob= overrides for the session", async () => {
    expect((await load({ search: "?headbob=0" })).settings.getHeadBob()).toBe(false);
    expect((await load({ search: "?headbob=1", reducedMotion: true })).settings.getHeadBob()).toBe(true);
  });
});

describe("graphics default by device (D-049)", () => {
  it("a first visit on a touch-first screen starts on low (a phone's GPU and battery); elsewhere medium; the player's choice is not touched", async () => {
    const { defaultGfx } = await import("./settings.ts");
    expect(defaultGfx(true)).toBe("low");
    expect(defaultGfx(false)).toBe("medium");
  });
});
