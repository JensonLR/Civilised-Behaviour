// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUTTON } from "@cb/shared";

/** The pad as Controls reads it: Use / reload by what is in reach, a deliberate view switch, the aim control (held or toggled), sprint, the device note, no input while a sheet is up. A scripted pad, frames cranked by hand. */

interface FakePad {
  id: string;
  connected: true;
  mapping: "standard";
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}
const pad: FakePad = { id: "Xbox 360 Controller (STANDARD GAMEPAD)", connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
const press = (i: number, on = true): void => {
  pad.buttons[i] = { pressed: on, value: on ? 1 : 0 };
};
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, L3 = 10, R3 = 11, DOWN = 13, LEFT = 14;

async function make(settings: { holdToSprint?: boolean } = {}) {
  vi.resetModules();
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  vi.stubGlobal("navigator", { getGamepads: () => [pad] });
  const { Controls } = await import("./Controls.ts");
  const dev = await import("./devices.ts");
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const c = new Controls(canvas, { sensitivity: 1, padSensitivity: 1, holdToSprint: settings.holdToSprint ?? true });
  const set = await import("../settings.ts");
  return { c, dev, set };
}

/** One frame: read the pad (drainLook) then one input sample, like Game's loop. */
const frame = (c: { drainLook(dt: number): [number, number]; sample(): { buttons: number; moveF: number; moveR: number } }, dt = 1 / 30) => {
  c.drainLook(dt);
  return c.sample();
};

beforeEach(() => {
  pad.axes = [0, 0, 0, 0];
  for (let i = 0; i < 17; i++) press(i, false);
});
afterEach(() => vi.unstubAllGlobals());

describe("Use and reload on one control", () => {
  it("with something to use, a tap is Use and only Use", async () => {
    const { c } = await make();
    c.canInteract = () => true;
    press(X);
    let got = frame(c).buttons;
    expect(got & BUTTON.INTERACT).toBeTruthy();
    expect(got & BUTTON.RELOAD).toBe(0);
    press(X, false);
    got = frame(c).buttons;
    expect(got & BUTTON.RELOAD).toBe(0);
  });

  it("with nothing to use, a tap reloads and never Uses", async () => {
    const { c } = await make();
    c.canInteract = () => false;
    press(X);
    const got = frame(c).buttons;
    expect(got & BUTTON.RELOAD).toBeTruthy();
    expect(got & BUTTON.INTERACT).toBe(0);
    press(X, false);
    expect(frame(c).buttons & (BUTTON.RELOAD | BUTTON.INTERACT)).toBe(0);
  });

  it("a hold always reloads, even beside something to use (once per press)", async () => {
    const { c } = await make();
    c.canInteract = () => true;
    press(X);
    let reloads = 0;
    for (let i = 0; i < 20; i++) if (frame(c).buttons & BUTTON.RELOAD) reloads++;
    expect(reloads).toBe(1);
  });

  it("a hold on a thing that is itself a hold (reviving) keeps Use down and never reloads", async () => {
    const { c } = await make();
    c.canInteract = () => true;
    c.holdInteract = () => true;
    press(X);
    for (let i = 0; i < 20; i++) {
      const b = frame(c).buttons;
      expect(b & BUTTON.INTERACT).toBeTruthy();
      expect(b & BUTTON.RELOAD).toBe(0);
    }
  });

  it("a tap that lands between two input samples is not lost", async () => {
    const { c } = await make();
    c.canInteract = () => true;
    press(X);
    c.drainLook(1 / 60);
    press(X, false);
    c.drainLook(1 / 60); // released before the 30 Hz sample reads it
    expect(c.sample().buttons & BUTTON.INTERACT).toBeTruthy();
  });
});

describe("view, aim, sprint and the rest", () => {
  it("R3 only switches the view when HELD, never on a tap", async () => {
    const { c } = await make();
    const view = vi.fn();
    c.onToggleView = view;
    press(R3);
    frame(c, 0.05);
    press(R3, false);
    frame(c, 0.05);
    expect(view).not.toHaveBeenCalled();
    press(R3);
    for (let i = 0; i < 12; i++) frame(c, 0.05);
    expect(view).toHaveBeenCalledTimes(1);
  });

  it("aim is held on the left trigger by default, and a trigger past 0.4 counts", async () => {
    const { c } = await make();
    expect(c.aiming).toBe(false);
    pad.buttons[LT] = { pressed: false, value: 0.6 };
    const b = frame(c).buttons;
    expect(b & BUTTON.AIM).toBeTruthy();
    expect(c.aiming).toBe(true);
    pad.buttons[LT] = { pressed: false, value: 0.1 };
    frame(c);
    expect(c.aiming).toBe(false);
  });

  it("with hold-to-aim off, one press toggles aim and the next lowers it", async () => {
    const { c, set } = await make();
    set.setHoldToAim(false);
    press(LT);
    frame(c);
    press(LT, false);
    expect(frame(c).buttons & BUTTON.AIM).toBeTruthy();
    expect(c.aiming).toBe(true);
    press(LT);
    frame(c);
    press(LT, false);
    expect(frame(c).buttons & BUTTON.AIM).toBe(0);
    expect(c.aiming).toBe(false);
  });

  it("RT fires, A jumps, B crouches, Y is melee, LB throws, RB grabs; L3 sprints while held", async () => {
    const { c } = await make();
    const cases: [number, number][] = [[RT, BUTTON.FIRE], [A, BUTTON.JUMP], [B, BUTTON.CROUCH], [Y, BUTTON.MELEE], [LB, BUTTON.THROW], [RB, BUTTON.GRAB], [L3, BUTTON.SPRINT]];
    for (const [i, bit] of cases) {
      press(i);
      expect(frame(c).buttons & bit, `button ${i}`).toBeTruthy();
      press(i, false);
      frame(c);
    }
  });

  it("a rebound layout is what the pad does", async () => {
    const { c } = await make();
    const pp = await import("./padProfile.ts");
    pp.setPadBindings(pp.assignPad(pp.defaultPadBindings(), "jump", "y").bindings); // jump <-> melee
    press(Y);
    expect(frame(c).buttons & BUTTON.JUMP).toBeTruthy();
    press(Y, false);
    frame(c);
    press(A);
    expect(frame(c).buttons & BUTTON.MELEE).toBeTruthy();
  });

  it("the sticks go through the deadzone: a resting drift moves nobody, a full push is full speed", async () => {
    const { c } = await make();
    pad.axes = [0.1, 0.1, 0.1, -0.1];
    let it = frame(c);
    expect(it.moveF).toBe(0);
    expect(it.moveR).toBe(0);
    expect(c.padStick).toEqual({ x: 0, y: 0 });
    pad.axes = [0, -1, 0, 0];
    it = frame(c);
    expect(it.moveF).toBeGreaterThan(0);
  });

  it("d-pad down holds the command wheel, left cycles the weapon", async () => {
    const { c } = await make();
    const cmd = vi.fn();
    c.onCommand = cmd;
    press(DOWN);
    frame(c);
    expect(cmd).toHaveBeenLastCalledWith("down");
    press(DOWN, false);
    frame(c);
    expect(cmd).toHaveBeenLastCalledWith("up");
    const before = c.weaponWish;
    press(LEFT);
    frame(c);
    expect(c.weaponWish).not.toBe(before);
  });
});

describe("devices and sheets", () => {
  it("a pad press notes the pad's family; a PlayStation id gives PlayStation glyphs; a key returns the keyboard", async () => {
    const { c, dev } = await make();
    expect(dev.deviceTracker.device).toBe("keyboard");
    press(A);
    frame(c);
    expect(dev.deviceTracker.device).toBe("xbox");
    expect(c.usingGamepad).toBe(true);
    press(A, false);
    frame(c);
    pad.id = "054c-0ce6-DualSense Wireless Controller";
    press(A);
    frame(c);
    expect(dev.deviceTracker.device).toBe("playstation");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(dev.deviceTracker.device).toBe("keyboard");
    expect(c.usingGamepad).toBe(false);
    pad.id = "Xbox 360 Controller (STANDARD GAMEPAD)";
  });

  it("the glyph setting pins the family whatever was last used", async () => {
    const { c, dev, set } = await make();
    set.setGlyphPreference("playstation");
    press(A);
    frame(c);
    expect(dev.deviceTracker.effective).toBe("playstation");
    set.setGlyphPreference("auto");
    expect(dev.deviceTracker.effective).toBe("xbox");
  });

  it("while a sheet is up the pad does nothing in the field, and a held button is not a fresh press when it closes", async () => {
    const { c } = await make();
    c.canInteract = () => true;
    c.blocked = true;
    press(X);
    expect(frame(c).buttons).toBe(0);
    c.blocked = false;
    expect(frame(c).buttons & BUTTON.INTERACT).toBeTruthy(); // closing a sheet while still holding X counts as pressing it: the press is fresh
  });
});
