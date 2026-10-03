// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_NOTE, SaveTracker, parseSaved, saveLabel, type SaveStatus } from "../net/saveStatus.ts";
import { Orientation } from "./Orientation.ts";
import { Pause } from "./Pause.ts";
import { buildHudChrome } from "./hudChrome.ts";
import { getOrientProgress, noteExpedition } from "./expeditions.ts";

/** The "Saved" line, "Save now", "Save and quit", the seed and "Replay tutorial" (D-039). */

const at = (h: number, m: number): number => new Date(2026, 9, 1, h, m).getTime();
const time = (a: number): string => `${String(new Date(a).getHours()).padStart(2, "0")}:${String(new Date(a).getMinutes()).padStart(2, "0")}`;

describe("saveLabel is honest", () => {
  it("says what is true: saving, saved with a time, kept nowhere, failed; nothing before it knows", () => {
    expect(saveLabel({ kind: "unknown" })).toBe("");
    expect(saveLabel({ kind: "saving" })).toBe("Saving...");
    expect(saveLabel({ kind: "saved", at: at(14, 2) }, time)).toBe("Saved 14:02");
    expect(saveLabel({ kind: "saved", at: 0 }, time)).toBe(""); // (a "saved" with no time yet is not yet a save, and not a save in flight either: "Saving..." stood on the bar for good)
    expect(saveLabel({ kind: "unkept" })).toMatch(/^Not saved/);
    expect(saveLabel({ kind: "failed", at: 0 })).toMatch(/^Not saved/);
    expect(saveLabel({ kind: "unkept" }, time, true)).toBe("Not saved");
    expect(saveLabel({ kind: "failed", at: 0 }, time, true)).toBe("Save failed");
  });

  it("the note tells what is NOT saved", () => {
    expect(SAVE_NOTE).toMatch(/where you stand is not/i);
    expect(SAVE_NOTE).toMatch(/HQ/);
  });
});

describe("parseSaved", () => {
  it("accepts the plain shape and ignores anything else", () => {
    expect(parseSaved({ kept: true, ok: true, at: 5, asked: true })).toEqual({ kept: true, ok: true, at: 5, asked: true });
    expect(parseSaved({ kept: true, ok: false, at: -1 })).toEqual({ kept: true, ok: false, at: 0 });
    for (const bad of [undefined, null, 1, "x", [], {}, { kept: "yes", ok: true }, { kept: true }]) expect(parseSaved(bad)).toBeUndefined();
  });
});

describe("SaveTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("follows the room's messages and tells subscribers", () => {
    const t = new SaveTracker();
    const seen: SaveStatus["kind"][] = [];
    t.subscribe((s) => seen.push(s.kind));
    t.onSaved({ kept: true, ok: true, at: 100 });
    t.onSaved({ kept: true, ok: false, at: 100 });
    t.onSaved({ kept: false, ok: true, at: 0 });
    t.onSaved("garbage");
    expect(seen).toEqual(["saved", "failed", "unkept"]);
    expect(t.current.kind).toBe("unkept");
  });

  it("a request goes out, shows saving, and settles on the asked answer (not on an ordinary broadcast)", async () => {
    const t = new SaveTracker();
    const sent = vi.fn();
    const p = t.request(sent);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(t.current.kind).toBe("saving");
    t.onSaved({ kept: true, ok: true, at: 200 }); // a broadcast meanwhile
    let done = false;
    void p.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    t.onSaved({ kept: true, ok: true, at: 300, asked: true });
    expect(await p).toEqual({ kind: "saved", at: 300 });
  });

  it("no answer in time: it settles as failed (a dropped line never holds a player), remembering the last good time", async () => {
    const t = new SaveTracker();
    t.onSaved({ kept: true, ok: true, at: 123 });
    const p = t.request(() => undefined, 1000);
    vi.advanceTimersByTime(1000);
    expect(await p).toEqual({ kind: "failed", at: 123 });
  });

  it("a socket that throws on send settles on the timer; a second request while one is out shares its answer", async () => {
    const t = new SaveTracker();
    const a = t.request(() => {
      throw new Error("closed");
    }, 500);
    const sentB = vi.fn();
    const b = t.request(sentB, 500);
    expect(sentB).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect((await a).kind).toBe("failed");
    expect((await b).kind).toBe("failed");
  });

  it("a server that keeps nothing answers unkept, and the request settles on it (so Save and quit can leave)", async () => {
    const t = new SaveTracker();
    const p = t.request(() => undefined);
    t.onSaved({ kept: false, ok: true, at: 0, asked: true });
    expect(await p).toEqual({ kind: "unkept" });
  });
});

describe("the HUD's save line", () => {
  beforeEach(() => (document.body.innerHTML = `<div id="hud"></div>`));
  const hud = (): HTMLElement => document.querySelector<HTMLElement>("#hud")!;

  it("follows the tracker, is hidden until it knows, flags failure, and stops following when removed", () => {
    const t = new SaveTracker();
    const off = buildHudChrome(hud(), "K7M2Q", "x", { status: () => t.current, subscribe: (fn) => t.subscribe(fn) });
    const line = hud().querySelector<HTMLElement>(".saveline")!;
    expect(line.hidden).toBe(true);
    t.onSaved({ kept: true, ok: true, at: at(9, 5) });
    expect(line.hidden).toBe(false);
    expect(line.textContent).toMatch(/^Saved \d/);
    expect(line.title).toMatch(/where you stand is not/i);
    t.onSaved({ kept: true, ok: false, at: at(9, 5) });
    expect(line.textContent).toBe("Save failed");
    expect(line.dataset.state).toBe("failed");
    t.onSaved({ kept: false, ok: true, at: 0 });
    expect(line.textContent).toBe("Not saved");
    off();
    t.onSaved({ kept: true, ok: true, at: at(9, 6) });
    expect(hud().querySelector(".saveline")).toBeNull();
  });

  it("without a feed (the demo) the line never shows", () => {
    const off = buildHudChrome(hud(), "K7M2Q", "x");
    expect(hud().querySelector<HTMLElement>(".saveline")!.hidden).toBe(true);
    off();
  });
});

describe("the pause sheet", () => {
  let canvas: HTMLCanvasElement;
  let left = 0;
  beforeEach(() => {
    document.body.innerHTML = "";
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    left = 0;
  });
  const sheet = (): HTMLElement => document.querySelector<HTMLElement>("#sheet-pause")!;
  const btn = (act: string): HTMLButtonElement => sheet().querySelector<HTMLButtonElement>(`button[data-act="${act}"]`)!;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  function make(now: () => Promise<SaveStatus>, tracker = new SaveTracker()): { pause: Pause; tracker: SaveTracker; now: ReturnType<typeof vi.fn> } {
    const spy = vi.fn(now);
    const pause = new Pause({
      canvas,
      invite: () => ({ code: "K7M2Q", link: "x", present: 2, seed: 4242 }),
      leave: () => void left++,
      save: { status: () => tracker.current, now: spy, subscribe: (fn) => tracker.subscribe(fn) },
    });
    pause.active = true;
    pause.open();
    return { pause, tracker, now: spy };
  }

  it("shows the code AND the world's seed, so a fresh campaign is evidently a fresh world", () => {
    make(async () => ({ kind: "unknown" }));
    expect(sheet().querySelector("#pause-info")!.textContent).toBe("Expedition No. K7M2Q · World seed 4242 · 2 present");
  });

  it("shows where the save stands, with what is and is not saved, and follows it while open", () => {
    const { tracker } = make(async () => ({ kind: "unknown" }));
    const line = sheet().querySelector<HTMLElement>("#pause-save")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toContain("Where you stand is not");
    tracker.onSaved({ kept: true, ok: true, at: at(14, 2) });
    expect(line.textContent).toMatch(/^Saved \d/);
    expect(line.textContent).toContain(SAVE_NOTE);
    tracker.onSaved({ kept: false, ok: true, at: 0 });
    expect(line.textContent).toMatch(/^Not saved/);
    expect(line.dataset.state).toBe("unkept");
  });

  it("Save now asks the server and does not leave", async () => {
    const { now } = make(async () => ({ kind: "saved", at: 1 }));
    btn("save-now").click();
    await flush();
    expect(now).toHaveBeenCalledTimes(1);
    expect(left).toBe(0);
    expect(btn("save-now").disabled).toBe(false);
  });

  it("Save and quit flushes first and leaves only once the save is confirmed", async () => {
    let release!: (s: SaveStatus) => void;
    make(() => new Promise<SaveStatus>((r) => (release = r)));
    btn("save-quit").click();
    await flush();
    expect(left).toBe(0); // still waiting for the server
    expect(btn("save-quit").textContent).toBe("Saving...");
    expect(btn("save-quit").disabled).toBe(true);
    release({ kind: "saved", at: 9 });
    await flush();
    expect(left).toBe(1);
  });

  it("a server that keeps nothing (nothing to wait for) lets Save and quit leave at once", async () => {
    make(async () => ({ kind: "unkept" }));
    btn("save-quit").click();
    await flush();
    expect(left).toBe(1);
  });

  it("an unconfirmed save does NOT silently leave: it says so, and a second press leaves anyway (nobody is trapped on a sheet)", async () => {
    make(async () => ({ kind: "failed", at: 0 }));
    btn("save-quit").click();
    await flush();
    expect(left).toBe(0);
    expect(btn("save-quit").textContent).toMatch(/not confirmed/i);
    expect(btn("save-quit").disabled).toBe(false);
    btn("save-quit").click();
    await flush();
    expect(left).toBe(1);
  });

  it("closing the sheet resets the quit button", async () => {
    const { pause } = make(async () => ({ kind: "failed", at: 0 }));
    btn("save-quit").click();
    await flush();
    pause.resume();
    pause.open();
    expect(btn("save-quit").textContent).toBe("Save and quit");
    expect(btn("save-quit").dataset.retry).toBeUndefined();
  });

  it("the demo's sheet (no save dependency) has no save controls and no save line", () => {
    const pause = new Pause({ canvas, invite: () => ({ code: "K7M2Q", link: "x", present: 1, seed: 1 }), leave: () => undefined });
    pause.active = true;
    pause.open();
    expect(btn("save-now").hidden).toBe(true);
    expect(btn("save-quit").hidden).toBe(true);
    expect(sheet().querySelector<HTMLElement>("#pause-save")!.hidden).toBe(true);
  });

  it("Replay tutorial restarts this campaign's orientation card and closes the sheet", () => {
    noteExpedition("K7M2Q", { name: "Ada" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const card = new Orientation(host, "K7M2Q");
    card.skip();
    expect(getOrientProgress("K7M2Q")?.skipped).toBe(true);
    const { pause } = make(async () => ({ kind: "unknown" }));
    expect(btn("replay-orientation").textContent).toBe("Replay tutorial");
    btn("replay-orientation").click();
    expect(card.active).toBe(true);
    expect(getOrientProgress("K7M2Q")).toBeUndefined();
    expect(pause.isOpen).toBe(false);
    card.dispose();
  });

  it("every button is a real, named button (and no key name is written into it: the scan in prompts.test.ts covers the source)", () => {
    make(async () => ({ kind: "unknown" }));
    for (const b of sheet().querySelectorAll("button")) {
      expect(b.type).toBe("button");
      expect(b.textContent!.trim().length).toBeGreaterThan(2);
    }
  });
});
