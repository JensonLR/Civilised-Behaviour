import { afterEach, describe, expect, it, vi } from "vitest";

/** The pad profile: stick curve, tap/hold, the rebindable layout and its persistence, rumble. */

async function load() {
  vi.resetModules();
  const store: Record<string, string> = {};
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  return { pp: await import("./padProfile.ts"), dev: await import("./devices.ts"), store };
}
afterEach(() => vi.unstubAllGlobals());

describe("stick shaping", () => {
  it("is zero inside the deadzone, exactly zero at its edge, and exactly one at the rim", async () => {
    const { pp } = await load();
    const o = { x: 0, y: 0 };
    for (const dead of [0.05, 0.18, 0.4]) {
      expect(pp.stickMagnitude(0, dead, 1.6)).toBe(0);
      expect(pp.stickMagnitude(dead, dead, 1.6)).toBe(0);
      expect(pp.stickMagnitude(dead * 0.99, dead, 1.6)).toBe(0);
      expect(pp.stickMagnitude(1, dead, 1.6)).toBe(1);
      expect(pp.stickMagnitude(1.4, dead, 1.6)).toBe(1); // a square gate's corner reads full, never more
    }
    pp.shapeStick(0.1, 0.1, 0.18, 1.6, o); // |v| = 0.14 < 0.18
    expect(o).toEqual({ x: 0, y: 0 });
    pp.shapeStick(1, 0, 0.18, 1.6, o);
    expect(o.x).toBeCloseTo(1, 12);
    expect(o.y).toBeCloseTo(0, 12);
  });

  it("is monotone for every deadzone and curve, and a higher curve is finer near the centre", async () => {
    const { pp } = await load();
    for (const dead of [0.05, 0.18, 0.4]) {
      for (const curve of [1, 1.6, 3]) {
        let prev = -1;
        for (let i = 0; i <= 200; i++) {
          const m = pp.stickMagnitude(i / 200, dead, curve);
          expect(m).toBeGreaterThanOrEqual(prev);
          expect(m).toBeLessThanOrEqual(1);
          prev = m;
        }
      }
    }
    expect(pp.stickMagnitude(0.5, 0.18, 2)).toBeLessThan(pp.stickMagnitude(0.5, 0.18, 1));
  });

  it("keeps the direction exactly, and reads garbage as rest", async () => {
    const { pp } = await load();
    const o = { x: 0, y: 0 };
    pp.shapeStick(0.6, -0.3, 0.18, 1.6, o);
    expect(Math.atan2(o.y, o.x)).toBeCloseTo(Math.atan2(-0.3, 0.6), 12);
    pp.shapeStick(Number.NaN, 1, 0.18, 1.6, o);
    expect(o).toEqual({ x: 0, y: 0 });
    pp.shapeStick(0.5, 0.5, Number.NaN, Number.NaN, o);
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true);
  });
});

describe("tap and hold", () => {
  it("a short press is a tap on release and never a hold", async () => {
    const { pp } = await load();
    const g = new pp.Gesture();
    g.update(true, 0.05);
    expect(g.pressed).toBe(true);
    expect(g.holdFired).toBe(false);
    g.update(true, 0.1);
    expect(g.pressed).toBe(false);
    expect(g.held).toBe(true);
    g.update(false, 0.016);
    expect(g.tapped).toBe(true);
    expect(g.released).toBe(true);
    expect(g.held).toBe(false);
    g.update(false, 0.016);
    expect(g.tapped).toBe(false);
  });

  it("crossing the hold time fires once per press, and the release is then not a tap", async () => {
    const { pp } = await load();
    const g = new pp.Gesture();
    let fired = 0;
    g.update(true, 0.016);
    for (let i = 0; i < 60; i++) {
      g.update(true, 0.016);
      if (g.holdFired) fired++;
    }
    expect(fired).toBe(1);
    g.update(false, 0.016);
    expect(g.tapped).toBe(false);
    expect(g.released).toBe(true);
    // and the next press starts again
    g.update(true, 0.016);
    expect(g.pressed).toBe(true);
    expect(g.heldFor).toBe(0);
  });

  it("the hold time is the one the spec names", async () => {
    const { pp } = await load();
    expect(pp.HOLD_S).toBe(0.3);
    const g = new pp.Gesture();
    g.update(true, 0);
    g.update(true, 0.29);
    expect(g.holdFired).toBe(false);
    g.update(true, 0.02);
    expect(g.holdFired).toBe(true);
  });
});

describe("pad bindings", () => {
  it("the defaults are the v2 layout, one control per action, all bindable", async () => {
    const { pp } = await load();
    const d = pp.defaultPadBindings();
    expect(d).toMatchObject({ jump: "a", crouch: "b", interact: "x", melee: "y", throw: "lb", grab: "rb", aim: "lt", fire: "rt", sprint: "l3", view: "r3" });
    expect(new Set(Object.values(d)).size).toBe(Object.keys(d).length);
    for (const c of Object.values(d)) expect(pp.PAD_BINDABLE).toContain(c);
  });

  it("assigning a held control swaps, so nothing is left unbound and nothing is double-booked", async () => {
    const { pp } = await load();
    const r = pp.assignPad(pp.defaultPadBindings(), "jump", "x");
    expect(r.swapped).toBe("interact");
    expect(r.bindings.jump).toBe("x");
    expect(r.bindings.interact).toBe("a");
    expect(new Set(Object.values(r.bindings)).size).toBe(10);
    // a free control just moves (there is none free among the ten, so use a no-op and an unbindable one)
    expect(pp.assignPad(r.bindings, "jump", "x").bindings).toEqual(r.bindings);
    expect(pp.assignPad(r.bindings, "jump", "start" as never).bindings).toEqual(r.bindings);
  });

  it("every sequence of reassignments keeps a permutation (property sweep)", async () => {
    const { pp } = await load();
    let b = pp.defaultPadBindings();
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 400; i++) {
      const a = pp.PAD_ACTIONS[Math.floor(rnd() * pp.PAD_ACTIONS.length)]!.id;
      const c = pp.PAD_BINDABLE[Math.floor(rnd() * pp.PAD_BINDABLE.length)]!;
      b = pp.assignPad(b, a, c).bindings;
      expect(new Set(Object.values(b)).size).toBe(10);
      expect(b[a]).toBe(c);
    }
  });

  it("sanitising drops junk and sends duplicates back to the defaults", async () => {
    const { pp } = await load();
    expect(pp.sanitizePadBindings(null)).toEqual(pp.defaultPadBindings());
    expect(pp.sanitizePadBindings({ jump: "zz", nonsense: "a" })).toEqual(pp.defaultPadBindings());
    expect(pp.sanitizePadBindings({ jump: "x" })).toEqual(pp.defaultPadBindings()); // x is the Use control's: a duplicate
    const ok = pp.sanitizePadBindings({ jump: "x", interact: "a" });
    expect(ok.jump).toBe("x");
    expect(ok.interact).toBe("a");
  });

  it("persists only what differs, survives a reload, and a reset restores the defaults", async () => {
    const { pp, store } = await load();
    expect(store["cb.padBindings"]).toBeUndefined();
    pp.setPadBindings(pp.assignPad(pp.defaultPadBindings(), "jump", "x").bindings);
    expect(JSON.parse(store["cb.padBindings"]!)).toEqual({ jump: "x", interact: "a" });
    expect(pp.loadPadBindings().jump).toBe("x");
    pp.resetPadBindings();
    expect(store["cb.padBindings"]).toBeUndefined();
    expect(pp.getPadBindings()).toEqual(pp.defaultPadBindings());
  });

  it("the glyphs follow the player's own layout", async () => {
    const { pp, dev } = await load();
    expect(dev.glyphFor("jump", "xbox").label).toBe("A");
    pp.setPadBindings(pp.assignPad(pp.defaultPadBindings(), "jump", "x").bindings);
    expect(dev.glyphFor("jump", "xbox").label).toBe("X");
    expect(dev.glyphFor("jump", "playstation").label).toBe("□");
    expect(dev.glyphFor("interact", "xbox").label).toBe("A");
    expect(dev.glyphFor("reload", "xbox")).toMatchObject({ label: "A", hold: true });
  });

  it("the layout is a function of the player's settings alone (no clock, no randomness)", async () => {
    const { pp } = await load();
    const a = pp.assignPad(pp.defaultPadBindings(), "fire", "lb").bindings;
    const b = pp.assignPad(pp.defaultPadBindings(), "fire", "lb").bindings;
    expect(a).toEqual(b);
  });
});

describe("rumble", () => {
  it("plays a short capped dual-rumble where an actuator exists, and is nothing where it does not", async () => {
    const { pp } = await load();
    const calls: { type: string; p: Record<string, number> }[] = [];
    const pad = { vibrationActuator: { playEffect: (type: string, p: Record<string, number>) => (calls.push({ type, p }), Promise.resolve("complete")) } };
    expect(pp.rumble(pad, "hurt")).toBe(true);
    expect(calls[0]!.type).toBe("dual-rumble");
    expect(calls[0]!.p.duration).toBeLessThanOrEqual(300);
    expect(calls[0]!.p.strongMagnitude).toBeLessThanOrEqual(1);
    expect(pp.rumble(pad, "blast", 0)).toBe(false);
    expect(pp.rumble({}, "shot")).toBe(false);
    expect(pp.rumble(null, "shot")).toBe(false);
    const throwing = { vibrationActuator: { playEffect: () => { throw new Error("no"); } } };
    expect(pp.rumble(throwing, "shot")).toBe(false);
    for (const k of Object.keys(pp.RUMBLE) as (keyof typeof pp.RUMBLE)[]) {
      expect(pp.RUMBLE[k].ms).toBeLessThanOrEqual(300);
      expect(pp.RUMBLE[k].weak).toBeLessThanOrEqual(1);
      expect(pp.RUMBLE[k].strong).toBeLessThanOrEqual(1);
    }
  });
});
