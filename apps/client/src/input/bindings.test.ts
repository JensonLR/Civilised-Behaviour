import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIONS, assign, cloneBindings, defaultBindings, findConflict, isReserved, keyLabel, sanitizeBindings, type Bindings } from "./bindings.ts";

describe("key bindings: rules", () => {
  it("defaults have no duplicate keys and every action has a primary key", () => {
    const b = defaultBindings();
    const seen = new Set<string>();
    for (const a of ACTIONS) {
      expect(b[a.id][0], `${a.id} primary`).not.toBe("");
      for (const c of b[a.id]) {
        if (!c) continue;
        expect(seen.has(c), `${c} used twice`).toBe(false);
        seen.add(c);
      }
    }
  });

  it("the defaults are today's keys (rebinding must not change the out-of-the-box feel)", () => {
    const b = defaultBindings();
    expect(b.forward).toEqual(["KeyW", "ArrowUp"]);
    expect(b.sprint[0]).toBe("ShiftLeft");
    expect(b.crouch).toEqual(["ControlLeft", "KeyC"]);
    expect(b.view[0]).toBe("KeyX");
  });

  it("the Command action (hold to open the wheel for the hired hands) is T, has no wire button, and is rebindable like the rest", () => {
    const b = defaultBindings();
    expect(b.command[0]).toBe("KeyT");
    expect(ACTIONS.find((a) => a.id === "command")!.button).toBeUndefined(); // the order is its own message, not a MoveInput button
    const r = assign(b, "command", 0, "KeyZ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bindings.command[0]).toBe("KeyZ");
  });

  it("finds conflicts in either slot of any other action, and ignores the slot being assigned", () => {
    const b = defaultBindings();
    expect(findConflict(b, "jump", 0, "KeyE")).toEqual({ action: "interact", slot: 0 });
    expect(findConflict(b, "jump", 1, "ArrowUp")).toEqual({ action: "forward", slot: 1 });
    expect(findConflict(b, "jump", 0, "Space")).toBeUndefined(); // its own current key
    expect(findConflict(b, "jump", 0, "KeyQ")).toBeUndefined();
    expect(findConflict(b, "jump", 0, "")).toBeUndefined();
  });

  it("a plain rebind to a free key succeeds and does not touch the input", () => {
    const b = defaultBindings();
    const r = assign(b, "jump", 0, "KeyQ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bindings.jump[0]).toBe("KeyQ");
    expect(b.jump[0]).toBe("Space");
  });

  it("a clash is reported, never silently resolved", () => {
    const r = assign(defaultBindings(), "jump", 0, "KeyE");
    expect(r).toEqual({ ok: false, reason: "conflict", conflict: { action: "interact", slot: 0 } });
  });

  it("swap gives the other action the old key; replace unbinds the other action's slot", () => {
    const swap = assign(defaultBindings(), "jump", 0, "KeyE", "swap");
    expect(swap.ok).toBe(true);
    if (swap.ok) {
      expect(swap.bindings.jump[0]).toBe("KeyE");
      expect(swap.bindings.interact[0]).toBe("Space");
    }
    const b = defaultBindings();
    b.interact[1] = "KeyQ"; // interact keeps a key after losing E
    const rep = assign(b, "jump", 0, "KeyE", "replace");
    expect(rep.ok).toBe(true);
    if (rep.ok) {
      expect(rep.bindings.jump[0]).toBe("KeyE");
      expect(rep.bindings.interact).toEqual(["", "KeyQ"]);
    }
  });

  it("taking the only key of another action is refused (nothing may be left unbound)", () => {
    const r = assign(defaultBindings(), "jump", 0, "KeyE", "replace");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("last-key");
  });

  it("moving a key between an action's own slots is allowed", () => {
    const r = assign(defaultBindings(), "forward", 1, "KeyW");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bindings.forward).toEqual(["", "KeyW"]);
  });

  it("clearing the alternate works; clearing the last key is refused", () => {
    const ok = assign(defaultBindings(), "forward", 1, "");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.bindings.forward).toEqual(["KeyW", ""]);
    const bad = assign(defaultBindings(), "jump", 0, "");
    expect(bad).toEqual({ ok: false, reason: "last-key" });
  });

  it("reserved keys cannot be bound", () => {
    for (const code of ["Escape", "F3", "F5", "F11", "Tab"]) {
      expect(isReserved(code)).toBe(true);
      expect(assign(defaultBindings(), "jump", 0, code)).toEqual({ ok: false, reason: "reserved" });
    }
    expect(isReserved("KeyW")).toBe(false);
  });

  it("key labels are readable", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Digit4")).toBe("4");
    expect(keyLabel("ShiftLeft")).toBe("Left Shift");
    expect(keyLabel("ArrowUp")).toBe("Up");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("")).toBe("unbound");
    expect(keyLabel("IntlBackslash")).toBe("Intl Backslash");
  });

  it("sanitising stored data: junk becomes defaults, duplicates or reserved keys reset everything", () => {
    expect(sanitizeBindings(null)).toEqual(defaultBindings());
    expect(sanitizeBindings("nonsense")).toEqual(defaultBindings());
    const ok = sanitizeBindings({ jump: ["KeyQ", ""], bogus: ["KeyZ", ""] });
    expect(ok.jump).toEqual(["KeyQ", ""]);
    expect(ok.forward).toEqual(["KeyW", "ArrowUp"]);
    const dup: Partial<Bindings> = { jump: ["KeyE", ""] }; // E belongs to interact
    expect(sanitizeBindings(dup)).toEqual(defaultBindings());
    expect(sanitizeBindings({ jump: ["Escape", ""] })).toEqual(defaultBindings());
    expect(sanitizeBindings({ jump: ["", ""] })).toEqual(defaultBindings());
    expect(sanitizeBindings({ jump: [5, {}] })).toEqual(defaultBindings());
  });

  it("cloning is deep", () => {
    const a = defaultBindings();
    const b = cloneBindings(a);
    b.jump[0] = "KeyQ";
    expect(a.jump[0]).toBe("Space");
  });
});

describe("key bindings: persistence and the runtime lookups Controls uses", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function load(store: Record<string, string> = {}) {
    vi.resetModules();
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
    return { m: await import("./bindings.ts"), store };
  }

  it("stores only the differences from the defaults and reads them back", async () => {
    const a = await load();
    const b = a.m.defaultBindings();
    b.jump = ["KeyQ", ""];
    a.m.setBindings(b);
    expect(JSON.parse(a.store["cb.bindings"]!)).toEqual({ jump: ["KeyQ", ""] });
    const again = await load(a.store);
    expect(again.m.getBindings().jump).toEqual(["KeyQ", ""]);
    again.m.resetBindings();
    expect(again.store["cb.bindings"]).toBeUndefined();
  });

  it("survives blocked storage and corrupt JSON", async () => {
    const bad = await load({ "cb.bindings": "{not json" });
    expect(bad.m.getBindings()).toEqual(bad.m.defaultBindings());
    vi.resetModules();
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("localStorage", new Proxy({}, { get: () => () => { throw new Error("blocked"); } }));
    const m = await import("./bindings.ts");
    expect(() => m.setBindings(m.defaultBindings())).not.toThrow();
  });

  it("rebinding takes effect at once in held-key and tap lookups", async () => {
    const { m } = await load();
    const held = new Set<string>(["KeyW"]);
    expect(m.isHeld(held, "forward")).toBe(true);
    expect(m.tapButtonFor("Space")).not.toBe(0);
    expect(m.tapButtonFor("KeyQ")).toBe(0);
    const b = m.defaultBindings();
    b.jump = ["KeyQ", ""];
    m.setBindings(b);
    expect(m.tapButtonFor("KeyQ")).not.toBe(0);
    expect(m.tapButtonFor("Space")).toBe(0);
    expect(m.actionForCode("KeyQ")).toBe("jump");
    expect(m.heldButtons(new Set(["KeyQ"]))).toBe(4); // BUTTON.JUMP
    expect(m.heldButtons(new Set(["Space"]))).toBe(0);
  });
});
