// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceTracker } from "../input/devices.ts";
import { defaultPadBindings, getPadBindings, resetPadBindings } from "../input/padProfile.ts";
import * as S from "../settings.ts";
import { buildPadSection } from "./SettingsPad.ts";

/** The pad section of the settings: the feel sliders write the settings, the layout rows rebind with a swap and say so, "Press a button" learns the next button, reset restores. */

beforeEach(() => {
  document.body.innerHTML = "";
  resetPadBindings();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  deviceTracker.note("keyboard");
  resetPadBindings();
});

const sel = (el: HTMLElement, a: string): HTMLSelectElement => el.querySelector<HTMLSelectElement>(`select[data-action='${a}']`)!;
const change = (s: HTMLSelectElement, v: string): void => {
  s.value = v;
  s.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("the pad section", () => {
  it("lists every action with a control and shows the player's layout", () => {
    const sec = buildPadSection(() => []);
    document.body.appendChild(sec.el);
    for (const a of ["jump", "crouch", "interact", "melee", "throw", "grab", "aim", "fire", "sprint", "view"]) expect(sel(sec.el, a).value).toBe(defaultPadBindings()[a as "jump"]);
    sec.dispose();
  });

  it("choosing a control another action holds swaps them and says so, in words", () => {
    const sec = buildPadSection(() => []);
    document.body.appendChild(sec.el);
    change(sel(sec.el, "jump"), "x");
    expect(getPadBindings().jump).toBe("x");
    expect(getPadBindings().interact).toBe("a");
    expect(sel(sec.el, "interact").value).toBe("a"); // the other row followed
    expect(sec.el.querySelector(".padstatus")!.textContent).toMatch(/Jump is now on the X button; Use \/ reload took the button it left/);
    sec.el.querySelector<HTMLButtonElement>("[data-act='reset-pad']")!.click();
    expect(getPadBindings()).toEqual(defaultPadBindings());
    sec.dispose();
  });

  it("the feel controls write the settings", () => {
    const sec = buildPadSection(() => []);
    document.body.appendChild(sec.el);
    const toggles = [...sec.el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(toggles).toHaveLength(3);
    const assist = toggles[0]!;
    assist.checked = !S.getAimAssist();
    assist.dispatchEvent(new Event("change", { bubbles: true }));
    expect(S.getAimAssist()).toBe(assist.checked);
    const dead = [...sec.el.querySelectorAll<HTMLInputElement>("input[type=range]")][0]!;
    dead.value = "25";
    dead.dispatchEvent(new Event("input", { bubbles: true }));
    expect(S.getPadDeadzone()).toBeCloseTo(0.25, 5);
    const glyphs = sec.el.querySelector<HTMLSelectElement>("select:not([data-action])")!;
    change(glyphs, "playstation");
    expect(S.getGlyphPreference()).toBe("playstation");
    change(glyphs, "auto");
    sec.dispose();
  });

  it("Press a button: the next button pressed (not one already held) becomes the control, B included, View cancels", () => {
    const pad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) } as unknown as Gamepad;
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.push(f), frames.length));
    vi.stubGlobal("cancelAnimationFrame", () => (frames = []));
    const crank = (): void => {
      const run = frames;
      frames = [];
      for (const f of run) f(0);
    };
    const set = (i: number, on: boolean): void => void ((pad.buttons as unknown as { pressed: boolean; value: number }[])[i] = { pressed: on, value: on ? 1 : 0 });
    const sec = buildPadSection(() => [pad]);
    document.body.appendChild(sec.el);
    set(3, true); // Y is held when the learning starts: it must not count
    sec.el.querySelector<HTMLButtonElement>("[data-learn='crouch']")!.click();
    crank();
    expect(getPadBindings().crouch).toBe("b");
    set(3, false);
    crank();
    set(3, true); // a fresh press of Y
    crank();
    expect(getPadBindings().crouch).toBe("y");
    expect(getPadBindings().melee).toBe("b"); // swapped
    // cancel with View
    set(3, false);
    sec.el.querySelector<HTMLButtonElement>("[data-learn='jump']")!.click();
    set(8, true);
    crank();
    set(8, false);
    set(0, true);
    crank();
    expect(getPadBindings().jump).toBe("a"); // learning was cancelled; A did nothing
    sec.dispose();
  });
});
