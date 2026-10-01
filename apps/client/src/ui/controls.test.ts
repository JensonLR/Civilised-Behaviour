import { afterEach, describe, expect, it, vi } from "vitest";

/** The how-to card and the controls lists read the live bindings; the device picker prefers a connected pad. */
async function load() {
  vi.resetModules();
  const store: Record<string, string> = {};
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  return { info: await import("./controlsInfo.ts"), bind: await import("../input/bindings.ts"), howto: await import("./HowTo.ts") };
}
afterEach(() => vi.unstubAllGlobals());

describe("controls lists", () => {
  it("keyboard rows show the current keys and follow a rebind", async () => {
    const { info, bind } = await load();
    const jump = () => info.keyboardRows().find((r) => r.what === "Jump")!;
    expect(jump().keys).toEqual(["Space"]);
    const b = bind.defaultBindings();
    b.jump = ["KeyQ", ""];
    bind.setBindings(b);
    expect(jump().keys).toEqual(["Q"]);
    const crouch = info.keyboardRows().find((r) => r.what === "Crouch")!;
    expect(crouch.keys).toEqual(["Left Ctrl", "C"]); // two keys are two caps, not one long label
  });

  it("every action the player can rebind appears in the how-to rows, and the pad list is complete", async () => {
    const { info } = await load();
    const text = info.keyboardRows().map((r) => r.what).join("|");
    for (const w of ["Move", "Sprint", "Jump", "Crouch", "Use", "Grab", "Throw", "Reload", "Melee", "Switch first", "Pause"]) expect(text).toContain(w);
    const pad = info.padRows().map((r) => r.keys[0]);
    for (const g of ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "L3", "R3", "Menu"]) expect(pad).toContain(g);
    expect(info.padRows("playstation").map((r) => r.keys[0])).toEqual(expect.arrayContaining(["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Options"]));
  });
});

describe("input device detection", () => {
  const pad = (mapping: string, connected = true) => ({ connected, mapping }) as Pick<Gamepad, "connected" | "mapping">;
  it("a connected standard gamepad means pad controls; anything else means keyboard and mouse", async () => {
    const { howto } = await load();
    expect(howto.detectDevice([null, pad("standard")])).toBe("pad");
    expect(howto.detectDevice([pad("standard", false)])).toBe("keyboard");
    expect(howto.detectDevice([pad("")])).toBe("keyboard"); // a non-standard pad has an unknown layout
    expect(howto.detectDevice([])).toBe("keyboard");
    expect(howto.detectDevice(undefined)).toBe("keyboard");
  });

  it("first-run: the manual counts as unseen until it has been closed once", async () => {
    const { howto } = await load();
    expect(howto.hasSeenHowTo()).toBe(false);
    howto.markHowToSeen();
    expect(howto.hasSeenHowTo()).toBe(true);
  });
});
