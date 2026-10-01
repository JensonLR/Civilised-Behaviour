import { describe, expect, it, vi } from "vitest";
import { ACTIONS } from "./bindings.ts";
import { DeviceTracker, INPUT_DEVICES, PAD_GLYPHS, PAD_INDEX, PROMPT_IDS, PROMPT_PAD, glyphFor, padFamily, promptText, type PadControl } from "./devices.ts";

/** The device/glyph contract: every prompt resolves on every device, the pad layout never double-books a control, detection switches once, Sony pads get Sony glyphs. */

describe("glyphs", () => {
  it("every prompt resolves to a non-empty glyph on every device", () => {
    for (const d of INPUT_DEVICES) {
      for (const p of PROMPT_IDS) {
        const g = glyphFor(p, d);
        expect(g.label.length, `${d}/${p}`).toBeGreaterThan(0);
        expect(g.name.length).toBeGreaterThan(0);
        expect(g.kind).toBe(d === "keyboard" || PROMPT_PAD[p] === null ? "key" : "pad");
      }
    }
  });
  it("the three families print their own shapes", () => {
    expect(glyphFor("jump", "xbox").label).toBe("A");
    expect(glyphFor("jump", "playstation").label).toBe("✕");
    expect(glyphFor("interact", "xbox").label).toBe("X");
    expect(glyphFor("interact", "playstation").label).toBe("□");
    expect(glyphFor("aim", "playstation").label).toBe("L2");
    expect(glyphFor("fire", "xbox").label).toBe("RT");
    expect(glyphFor("pause", "xbox").label).toBe("Menu");
    expect(glyphFor("pause", "playstation").label).toBe("Options");
    expect(glyphFor("jump", "keyboard")).toMatchObject({ kind: "key", label: "Space" });
    expect(glyphFor("interact", "keyboard")).toMatchObject({ kind: "key", label: "E" });
  });
  it("prompt text carries the glyph, and a held control says so", () => {
    expect(promptText("Use", "interact", "xbox")).toBe("Use [X]");
    expect(promptText("Use", "interact", "keyboard")).toBe("Use [E]");
    expect(promptText("Switch view", "view", "xbox")).toBe("Hold [R3] to switch view");
    expect(promptText("Command", "command", "playstation")).toBe("Hold [Down] to command");
  });
  it("every pad control used is a real control with a glyph in both families", () => {
    for (const p of PROMPT_IDS) {
      const c = PROMPT_PAD[p];
      if (!c) continue;
      expect(PAD_GLYPHS.xbox[c.control]).toBeDefined();
      expect(PAD_GLYPHS.playstation[c.control]).toBeDefined();
    }
    for (const c of Object.keys(PAD_INDEX) as (keyof typeof PAD_INDEX)[]) expect(PAD_GLYPHS.xbox[c]).toBeDefined();
  });
});

describe("the pad layout never double-books a control", () => {
  it("within a context, a control carries one prompt (a tap and a hold of the same control may share)", () => {
    const seen = new Map<string, string>();
    for (const p of PROMPT_IDS) {
      const e = PROMPT_PAD[p];
      if (!e || e.control === "ls" || e.control === "rs") continue; // sticks are analog axes shared by their directions
      for (const ctx of e.contexts) {
        const key = `${ctx}|${e.control}|${e.hold ? "hold" : "tap"}`;
        expect(seen.get(key), `${key}: ${p} vs ${seen.get(key)}`).toBeUndefined();
        seen.set(key, p);
      }
    }
  });
  it("every rebindable action has a pad control or is an analog direction, and every prompt id is unique", () => {
    for (const a of ACTIONS) expect(PROMPT_PAD[a.id], a.id).not.toBeUndefined();
    expect(new Set(PROMPT_IDS).size).toBe(PROMPT_IDS.length);
  });
  it("no prompt is on a control that does not exist on the standard mapping", () => {
    const controls: PadControl[] = ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "back", "start", "l3", "r3", "up", "down", "left", "right", "ls", "rs"];
    for (const p of PROMPT_IDS) {
      const e = PROMPT_PAD[p];
      if (e) expect(controls).toContain(e.control);
    }
  });
});

describe("detection", () => {
  it("classifies pad ids", () => {
    expect(padFamily("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(padFamily("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)")).toBe("playstation");
    expect(padFamily("DualSense Wireless Controller")).toBe("playstation");
    expect(padFamily("8BitDo Pro 2 (Vendor: 2dc8)")).toBe("xbox");
    // Chrome and Firefox name the Xbox One / Series pads "Xbox Wireless Controller": that is NOT a Sony pad
    expect(padFamily("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)")).toBe("xbox");
    expect(padFamily("045e-0b13-Xbox Wireless Controller")).toBe("xbox");
    expect(padFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")).toBe("playstation");
  });
  it("switches once per change, honours a pinned preference, and unsubscribes", () => {
    const t = new DeviceTracker();
    const fn = vi.fn();
    const off = t.onChange(fn);
    expect(t.effective).toBe("keyboard");
    t.note("keyboard");
    expect(fn).not.toHaveBeenCalled();
    t.note("xbox");
    t.note("xbox");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.effective).toBe("xbox");
    t.setPreference("playstation");
    expect(t.effective).toBe("playstation");
    t.note("keyboard"); // pinned: the visible device does not change
    expect(fn).toHaveBeenCalledTimes(2);
    t.setPreference("auto");
    expect(t.effective).toBe("keyboard");
    off();
    t.note("xbox");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
