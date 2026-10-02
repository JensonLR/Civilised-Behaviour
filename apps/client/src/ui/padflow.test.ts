// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu.ts";
import { Pause } from "./Pause.ts";
import { deviceTracker } from "../input/devices.ts";
import { openSettings } from "./Settings.ts";

/**
 * The gamepad alone, from the title to the field: a standard-mapping pad moves focus through the front door, presses New campaign, reads the error card
 * if the line is down, opens the settings and closes them again, and in the field Start opens the pause sheet. Driven by a fake pad and a hand-cranked
 * animation frame; happy-dom has no layout, so `offsetParent` is faked as "present".
 */

interface FakePad {
  connected: true;
  mapping: "standard";
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}
const pad: FakePad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
let frames: FrameRequestCallback[] = [];
let now = 0;

const press = (i: number, on: boolean): void => void (pad.buttons[i] = { pressed: on, value: on ? 1 : 0 });
/** One animation frame with the pad as it is now, 300 ms after the last (past PadNav's repeat cooldown). */
const tick = (): void => {
  now += 300;
  const run = frames;
  frames = [];
  for (const f of run) f(now);
};
const tap = (i: number): void => {
  press(i, true);
  tick();
  press(i, false);
  tick();
};
const focusedId = (): string => (document.activeElement as HTMLElement | null)?.id || (document.activeElement as HTMLElement | null)?.className || "";

beforeEach(() => {
  frames = [];
  now = 1000;
  for (const b of pad.buttons) (b.pressed = false), (b.value = 0);
  pad.axes = [0, 0, 0, 0];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.push(f), frames.length));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.defineProperty(navigator, "getGamepads", { value: () => [pad], configurable: true });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { get: () => document.body, configurable: true });
  document.body.innerHTML = `<div id="menu"></div>`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("gamepad only, title to field", () => {
  it("D-pad down walks the front door's controls in order and A presses the one in focus: New campaign founds an expedition", async () => {
    const created: string[] = [];
    new Menu(document.querySelector<HTMLElement>("#menu")!, {
      onCreate: async () => void created.push("create"),
      onJoin: async () => undefined,
    });
    tap(13); // down: the name
    expect(focusedId()).toBe("name");
    tap(13);
    expect(focusedId()).toBe("create");
    tap(0); // A
    await flush();
    expect(created).toEqual(["create"]);
  });

  it("the stick moves focus too, and up wraps round; B on the error card returns to the door", async () => {
    let fail = true;
    const menu = new Menu(document.querySelector<HTMLElement>("#menu")!, {
      onCreate: async () => {
        if (fail) throw new Error("Failed to fetch");
      },
      onJoin: async () => undefined,
    });
    void menu;
    pad.axes = [0, -0.9, 0, 0]; // stick up from nothing in focus: wraps to the last control
    tick();
    pad.axes = [0, 0, 0, 0];
    expect(document.activeElement).not.toBe(document.body);
    // focus New campaign with the d-pad and press it
    (document.querySelector("#create") as HTMLElement).focus();
    tap(0);
    await flush();
    const card = document.querySelector<HTMLElement>(".consult")!;
    expect(card.dataset.state).toBe("error");
    expect(focusedId()).toContain("retry"); // the pad lands on Try again
    // the panels behind are out of reach (inert), so D-pad cannot wander off the card
    for (let i = 0; i < 6; i++) {
      tap(13);
      expect(document.activeElement && (document.activeElement as HTMLElement).closest(".consult"), `press ${i}`).not.toBeNull();
    }
    tap(1); // B
    expect(card.hidden).toBe(true);
    fail = false;
    (document.querySelector("#create") as HTMLElement).focus();
    tap(0);
    await flush();
    expect((document.querySelector("#menu") as HTMLElement).hidden).toBe(true);
  });

  it("A on Options opens the settings sheet, the bumpers change tab, B closes it and focus returns to Options", () => {
    new Menu(document.querySelector<HTMLElement>("#menu")!, { onCreate: async () => undefined, onJoin: async () => undefined });
    const options = document.querySelector<HTMLButtonElement>("#options")!;
    options.focus();
    tap(0);
    const sheet = document.querySelector<HTMLElement>("#sheet-settings")!;
    expect(sheet.hidden).toBe(false);
    const tab = (): string => sheet.querySelector('[role="tab"][aria-selected="true"]')!.textContent!;
    const first = tab();
    tap(5); // RB: next tab
    expect(tab()).not.toBe(first);
    tap(4); // LB: back
    expect(tab()).toBe(first);
    tap(1); // B
    expect(sheet.hidden).toBe(true);
    expect(document.activeElement).toBe(options);
    void openSettings;
  });

  it("in the field Start opens the pause sheet, B closes it, and Resume is what the pad lands on", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const pause = new Pause({ canvas, invite: () => undefined, leave: () => undefined });
    pause.active = true;
    tick(); // the poll reads the pad
    tap(9); // Start
    expect(pause.isOpen).toBe(true);
    expect(document.activeElement?.textContent).toMatch(/resume/i);
    tap(1); // B
    expect(pause.isOpen).toBe(false);
  });

  it("D-041: resuming takes the mouse only for a mouse player; a pad player's resume leaves it alone (a lock let mouse movement flip their glyphs to the keyboard's)", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const lock = vi.fn();
    (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = lock;
    const pause = new Pause({ canvas, invite: () => undefined, leave: () => undefined });
    pause.active = true;
    deviceTracker.note("xbox");
    tick();
    tap(9); // Start
    tap(1); // B
    expect(pause.isOpen).toBe(false);
    expect(lock).not.toHaveBeenCalled();
    deviceTracker.note("keyboard");
    pause.open();
    expect(pause.isOpen).toBe(true);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
    expect(pause.isOpen).toBe(false);
    expect(lock).toHaveBeenCalledTimes(1);
  });
});
