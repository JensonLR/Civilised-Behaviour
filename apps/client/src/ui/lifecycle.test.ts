// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLAG } from "@cb/shared";
import { Captions } from "./Captions.ts";
import { CombatHud } from "./CombatHud.ts";
import { Hud } from "./Hud.ts";
import { Menu } from "./Menu.ts";
import { Pause } from "./Pause.ts";
import { SoundPlaque } from "./SoundPlaque.ts";
import { buildHudChrome } from "./hudChrome.ts";
import { assign, defaultBindings, getBindings, setBindings } from "../input/bindings.ts";

/**
 * Menu -> found -> play -> pause -> leave -> found again, at the level the unit tests can see: every piece of interface that has a lifetime is built,
 * driven and taken down again, and what is left must be what was there before (no DOM, no timers, no window listeners). The game's 3D parts have their own
 * disposal tests (ViewModel, ShotFx, HitFx, ...); a real browser run is the e2e suite's job.
 */

type Listener = { type: string; fn: EventListenerOrEventListenerObject; capture: boolean };
let added: Listener[] = [];
let removed: Listener[] = [];
const realAdd = window.addEventListener.bind(window);
const realRemove = window.removeEventListener.bind(window);
const capOf = (o: unknown): boolean => (typeof o === "boolean" ? o : !!(o as { capture?: boolean } | undefined)?.capture);

beforeEach(() => {
  added = [];
  removed = [];
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    added.push({ type, fn, capture: capOf(o) });
    realAdd(type, fn, o as never);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    removed.push({ type, fn, capture: capOf(o) });
    realRemove(type, fn, o as never);
  }) as typeof window.removeEventListener;
  document.body.innerHTML = `<div id="hud"></div><div id="menu"></div>`;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.addEventListener = realAdd;
  window.removeEventListener = realRemove;
});

const leaked = (): string[] => added.filter((a) => !removed.some((r) => r.type === a.type && r.fn === a.fn && r.capture === a.capture)).map((a) => a.type);

describe("in-game interface lifecycle", () => {
  it("the HUD, the combat HUD, the plaque and the key hints are built, driven and removed without leaving DOM, timers or listeners", () => {
    const hudEl = document.querySelector<HTMLElement>("#hud")!;
    const baseline = hudEl.childElementCount;
    for (let round = 0; round < 3; round++) {
      const off = buildHudChrome(hudEl, "K7M2Q", "http://x/?join=K7M2Q");
      const hud = new Hud(hudEl);
      const combat = new CombatHud(hudEl);
      const plaque = new SoundPlaque(document.body);
      for (let i = 0; i < 5; i++) {
        hud.update({ flags: FLAG.GROUNDED, health: 100 - i * 20, reviveProgressOnMe: 0, reviveProgressByMe: -1, prompt: "E  Pick up crate", reviverName: "", patientName: "", usingGamepad: false, wounds: i, yaw: i * 0.3, x: 3, z: -2 });
        combat.updateArms({ weapon: 1, owned: 0b111, ammo: 1, reserve: 8, reload: i * 20, wait: 0, gamepad: false, busy: false, reloadKey: "R" });
        combat.updateSight({ visible: true, gap: 10, aiming: i % 2 === 0 });
        combat.hitMarker(0, false, false);
        combat.damageFrom(i, 0.5);
        combat.tick(0.1);
      }
      hud.showNotice("one");
      hud.showNotice("two");
      hud.showNotice("three");
      hud.showNotice("four");
      hud.showNotice("five");
      vi.advanceTimersByTime(1000);
      expect(document.querySelectorAll(".telegram").length).toBeLessThanOrEqual(3);
      hud.dispose();
      combat.dispose();
      plaque.dispose();
      off();
      expect(hudEl.childElementCount, `round ${round}`).toBe(baseline);
      expect(document.querySelector(".soundplaque")).toBeNull();
      expect(vi.getTimerCount(), `timers after round ${round}`).toBe(0);
    }
    expect(leaked()).toEqual([]);
  });

  it("the telegram stack shows three at a time, queues the rest, and lets every one go", () => {
    const hud = new Hud(document.querySelector<HTMLElement>("#hud")!);
    for (let i = 0; i < 7; i++) hud.showNotice(`news ${i}`, 2);
    expect(document.querySelectorAll(".telegram").length).toBe(3);
    expect(hud.telegrams.queue.queued).toBe(4);
    vi.advanceTimersByTime(2100 * 3);
    expect(document.querySelectorAll(".telegram").length).toBeLessThanOrEqual(3);
    vi.advanceTimersByTime(20000);
    expect(document.querySelectorAll(".telegram").length).toBe(0);
    expect(hud.telegrams.queue.queued).toBe(0);
    hud.dispose();
  });
});

describe("key hints follow rebinds", () => {
  it("the help line is rewritten when a key is rebound, and restored when the defaults come back", () => {
    const hudEl = document.querySelector<HTMLElement>("#hud")!;
    const off = buildHudChrome(hudEl, "K7M2Q", "x");
    const help = hudEl.querySelector<HTMLElement>(".help")!;
    expect(help.textContent).toContain("Space jump");
    const r = assign(getBindings(), "jump", 0, "KeyJ");
    expect(r.ok).toBe(true);
    if (r.ok) setBindings(r.bindings);
    expect(help.textContent).toContain("J jump");
    expect(help.textContent).not.toContain("Space jump");
    setBindings(defaultBindings());
    expect(help.textContent).toContain("Space jump");
    off();
  });
});

describe("front door lifecycle", () => {
  const make = () => {
    const calls: string[] = [];
    let fail = false;
    const menu = new Menu(document.querySelector<HTMLElement>("#menu")!, {
      onCreate: async (_n, _r, progress) => {
        calls.push("create");
        progress("Posting the telegram...");
        if (fail) throw new Error("Failed to fetch");
      },
      onJoin: async (code, _n, progress) => {
        calls.push(`join ${code}`);
        progress("Presenting your code...");
        if (fail) throw new Error("No such expedition.");
      },
    });
    return { menu, calls, setFail: (f: boolean) => (fail = f) };
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  it("founding: a working card while it waits, the door closes on success", async () => {
    const { menu, calls } = make();
    const root = document.querySelector<HTMLElement>("#menu")!;
    root.querySelector<HTMLButtonElement>("#create")!.click();
    expect(root.querySelector<HTMLElement>(".consult")!.hidden).toBe(false);
    expect(root.querySelector(".consult #consult-head")!.textContent).toContain("Consulting the Society");
    expect(root.querySelector<HTMLElement>("#creator-host")!.inert).toBe(true);
    await flush();
    expect(calls).toEqual(["create"]);
    expect(root.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".consult")!.hidden).toBe(true);
    void menu;
  });

  it("a failed attempt shows the Society's regrets with a real reason, keeps the door open, and Try again / Return both work", async () => {
    const { calls, setFail } = make();
    const root = document.querySelector<HTMLElement>("#menu")!;
    setFail(true);
    root.querySelector<HTMLButtonElement>("#create")!.click();
    await flush();
    const card = root.querySelector<HTMLElement>(".consult")!;
    expect(card.hidden).toBe(false);
    expect(card.dataset.state).toBe("error");
    expect(root.querySelector("#consult-head")!.textContent).toContain("regrets");
    expect(root.querySelector("#consult-step")!.textContent).toMatch(/telegraph line is down/i);
    expect(root.hidden).toBe(false);
    // try again (still failing), then the line comes back
    root.querySelector<HTMLButtonElement>(".retry")!.click();
    await flush();
    expect(calls).toEqual(["create", "create"]);
    setFail(false);
    root.querySelector<HTMLButtonElement>(".retry")!.click();
    await flush();
    expect(calls).toEqual(["create", "create", "create"]);
    expect(root.hidden).toBe(true);
  });

  it("Return to the door hands the panels back (not inert, buttons enabled) so nothing is stuck after an error", async () => {
    const { setFail } = make();
    const root = document.querySelector<HTMLElement>("#menu")!;
    setFail(true);
    root.querySelector<HTMLButtonElement>("#join")!.click(); // no code: a short inline note, not the card
    await flush();
    expect(root.querySelector<HTMLElement>(".consult")!.hidden).toBe(true);
    root.querySelector<HTMLInputElement>("#code")!.value = "K7M2Q";
    root.querySelector<HTMLButtonElement>("#join")!.click();
    await flush();
    expect(root.querySelector<HTMLElement>(".consult")!.dataset.state).toBe("error");
    root.querySelector<HTMLButtonElement>(".back")!.click();
    expect(root.querySelector<HTMLElement>(".consult")!.hidden).toBe(true);
    for (const p of root.querySelectorAll<HTMLElement>(".panel:not(.card)")) expect(p.inert).toBe(false);
    expect(root.querySelector<HTMLButtonElement>("#create")!.disabled).toBe(false);
  });
});

describe("pause sheet", () => {
  it("opens on Escape only once a session exists, closes on Resume, and asks twice before leaving", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    let left = 0;
    const pause = new Pause({ canvas, invite: () => ({ code: "K7M2Q", link: "x", present: 2, seed: 7 }), leave: () => void left++ });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(pause.isOpen).toBe(false); // nothing to pause at the front door
    pause.active = true;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(pause.isOpen).toBe(true);
    const leave = document.querySelector<HTMLButtonElement>("#sheet-pause .danger")!;
    leave.click();
    expect(left).toBe(0);
    expect(leave.textContent).toMatch(/again/i);
    leave.click();
    expect(left).toBe(1);
    pause.resume();
    expect(pause.isOpen).toBe(false);
    pause.active = false;
  });
});

describe("captions", () => {
  it("mount once and carry no timers while idle", () => {
    const before = vi.getTimerCount();
    new Captions(document.body);
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe("the cards under the expedition bar follow its height", () => {
  it("publishes the bar's real bottom as --codebar-b on the HUD (two rows once 'Saved' shows ran over the orientation card) and takes it away on leaving", () => {
    const hudEl = document.querySelector<HTMLElement>("#hud")!;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ bottom: 92.4 } as DOMRect);
    const off = buildHudChrome(hudEl, "K7M2Q", "x");
    expect(hudEl.style.getPropertyValue("--codebar-b")).toBe("92px");
    off();
    expect(hudEl.style.getPropertyValue("--codebar-b")).toBe("");
    rect.mockRestore();
  });
});
