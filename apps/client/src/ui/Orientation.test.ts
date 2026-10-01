// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAMP } from "@cb/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orientation, hasSeenOrientation, replayOrientation } from "./Orientation.ts";
import { ORIENT_STEPS, type Device, type SheetKind } from "./orientationLogic.ts";
import { ORIENT_DONE } from "./orientationCopy.ts";
import { yawTo } from "./compassLogic.ts";

let host: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const card = (): HTMLElement => host.querySelector<HTMLElement>(".orientation")!;
const items = (): HTMLLIElement[] => [...card().querySelectorAll<HTMLLIElement>("li")];
/** One frame at (x, z) looking `yaw`, in Hollowmere, nothing open, on the keyboard unless said. */
const tick = (o: Orientation, x = 0, z = 0, yaw = 0, over: { region?: string; sheet?: SheetKind; down?: boolean; device?: Device; dt?: number } = {}): void =>
  o.tick(over.dt ?? 1 / 60, x, z, yaw, over.region ?? "hollowmere", over.sheet ?? "none", over.down ?? false, over.device ?? "keyboard");
const walkAbout = (o: Orientation, metres = 8): void => {
  tick(o, 0, 0, 0);
  for (let i = 1; i <= metres * 5; i++) tick(o, i * 0.2, 0, 0);
};

describe("the first-run orientation card", () => {
  it("appears on a fresh profile as a polite status region with six steps, the first current, and takes no focus", () => {
    const o = new Orientation(host);
    expect(card().hidden).toBe(true); // nothing is drawn until the first frame in the camp
    tick(o);
    expect(card().hidden).toBe(false);
    expect(card().getAttribute("role")).toBe("status");
    expect(card().getAttribute("aria-label")).toContain("0 of 6");
    expect(items()).toHaveLength(ORIENT_STEPS.length);
    expect(items().filter((li) => li.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(items()[0]!.classList.contains("current")).toBe(true);
    expect(items()[0]!.querySelector(".what")!.textContent).toMatch(/W A S D|↑|Arrow/i);
    // non-modal: no dialog, no aria-modal, no tabindex, one button, focus untouched
    expect(card().querySelector("[aria-modal], [role=dialog], [tabindex]")).toBeNull();
    expect(card().querySelectorAll("button")).toHaveLength(1);
    expect(document.activeElement === document.body || !card().contains(document.activeElement)).toBe(true);
    expect(o.active).toBe(true);
    o.dispose();
  });

  it("ticks steps off from what the game sees (walk, look, the pin, the three sheets), keeps them ticked, and says so in its label", () => {
    const o = new Orientation(host);
    walkAbout(o);
    expect(items()[0]!.classList.contains("done")).toBe(true);
    expect(items()[1]!.classList.contains("current")).toBe(true);
    expect(card().getAttribute("aria-label")).toContain("1 of 6");
    for (let i = 1; i <= 40; i++) tick(o, 8, 0, i * 0.05);
    expect(items()[1]!.classList.contains("done")).toBe(true);
    const ahead = yawTo(8, 0, CAMP.mapTable.x, CAMP.mapTable.z);
    for (let i = 0; i < 60; i++) tick(o, 8, 0, ahead);
    expect(items()[2]!.classList.contains("done")).toBe(true);
    tick(o, 8, 0, ahead, { sheet: "paper" });
    tick(o, 8, 0, ahead, { sheet: "none" });
    expect(items()[3]!.classList.contains("done")).toBe(true);
    expect(items()[3]!.classList.contains("current")).toBe(false);
    expect(items()[4]!.classList.contains("current")).toBe(true);
    expect(o.active).toBe(true);
    o.dispose();
  });

  it("finishes: the done line shows and lingers, then the card goes; it is remembered as seen and does not return", () => {
    const o = new Orientation(host);
    walkAbout(o);
    for (let i = 1; i <= 40; i++) tick(o, 8, 0, i * 0.05);
    const ahead = yawTo(8, 0, CAMP.mapTable.x, CAMP.mapTable.z);
    for (let i = 0; i < 60; i++) tick(o, 8, 0, ahead);
    for (const sheet of ["paper", "loadout", "map"] as SheetKind[]) tick(o, 8, 0, ahead, { sheet });
    expect(o.current.finished).toBe(true);
    expect(o.active).toBe(false);
    expect(card().hidden).toBe(false);
    expect(card().querySelector(".done-line")!.textContent).toBe(ORIENT_DONE);
    expect(card().querySelector<HTMLElement>(".done-line")!.hidden).toBe(false);
    expect(hasSeenOrientation()).toBe(true);
    for (let i = 0; i < 60 * 8; i++) tick(o, 8, 0, ahead);
    expect(card().hidden).toBe(true);
    o.dispose();
    expect(hasSeenOrientation()).toBe(true);
    const again = new Orientation(host);
    tick(again);
    expect(card().hidden).toBe(true);
    again.dispose();
  });

  it("Esc skips it for good, does NOT swallow the key (the pause screen still gets it), and a fresh load does not show it again", () => {
    const o = new Orientation(host);
    tick(o);
    expect(card().hidden).toBe(false);
    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
    expect(card().hidden).toBe(true);
    expect(o.active).toBe(false);
    expect(hasSeenOrientation()).toBe(true);
    // while hidden, Esc is none of its business
    const esc2 = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(esc2);
    o.dispose();
    const fresh = new Orientation(host);
    tick(fresh);
    expect(card().hidden).toBe(true);
    fresh.dispose();
  });

  it("the Skip stamp dismisses for good too, and it is a real button with a name", () => {
    const o = new Orientation(host);
    tick(o);
    const skip = card().querySelector<HTMLButtonElement>("button.skip")!;
    expect(skip.textContent!.length).toBeGreaterThan(3);
    expect(skip.type).toBe("button");
    skip.click();
    expect(card().hidden).toBe(true);
    expect(hasSeenOrientation()).toBe(true);
    o.dispose();
  });

  it("resumes: progress survives a reload (a new card starts with the steps already done)", () => {
    const a = new Orientation(host);
    walkAbout(a);
    expect(items()[0]!.classList.contains("done")).toBe(true);
    a.dispose();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    const b = new Orientation(host);
    tick(b, 100, 100);
    expect(items()[0]!.classList.contains("done")).toBe(true);
    expect(items()[1]!.classList.contains("current")).toBe(true);
    expect(b.current.done).toBe(1);
    b.dispose();
  });

  it("shows only at HQ and not while down; comes back when you do", () => {
    const o = new Orientation(host);
    tick(o);
    expect(card().hidden).toBe(false);
    tick(o, 0, 0, 0, { region: "kessar" });
    expect(card().hidden).toBe(true);
    tick(o, 0, 0, 0, { down: true });
    expect(card().hidden).toBe(true);
    tick(o);
    expect(card().hidden).toBe(false);
    o.dispose();
  });

  it("both devices: the keyboard card names the live keys, the pad card the pad's (no keyboard words); the hint names the right skip", () => {
    const o = new Orientation(host);
    tick(o, 0, 0, 0, { device: "keyboard" });
    const kb = card().textContent!;
    expect(kb).toContain("Esc skips");
    expect(items()[0]!.querySelector(".what")!.textContent).not.toContain("{");
    tick(o, 0, 0, 0, { device: "pad" });
    const pad = card().textContent!;
    expect(pad).toContain("Back skips");
    expect(items()[0]!.querySelector(".what")!.textContent).toContain("left stick");
    expect(pad).not.toContain("Esc skips");
    o.dispose();
  });

  it("the pad's Back button skips it", () => {
    const o = new Orientation(host);
    const pad = { connected: true, buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad as unknown as Gamepad] });
    tick(o, 0, 0, 0, { device: "pad" });
    expect(card().hidden).toBe(false);
    pad.buttons[8]!.pressed = true;
    tick(o, 0, 0, 0, { device: "pad" });
    expect(card().hidden).toBe(true);
    expect(hasSeenOrientation()).toBe(true);
    o.dispose();
    delete (navigator as { getGamepads?: unknown }).getGamepads;
  });

  it("the Field Manual replays it: the seen flag and the progress are forgotten and a running card starts again", () => {
    const o = new Orientation(host);
    walkAbout(o);
    o.skip();
    expect(hasSeenOrientation()).toBe(true);
    expect(card().hidden).toBe(true);
    replayOrientation();
    expect(hasSeenOrientation()).toBe(false);
    expect(o.active).toBe(true);
    expect(o.current.done).toBe(0);
    tick(o);
    expect(card().hidden).toBe(false);
    expect(items()[0]!.classList.contains("current")).toBe(true);
    o.dispose();
  });

  it("storage that throws (private window, blocked site data) never throws into the game, and the card still works", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    let o!: Orientation;
    expect(() => (o = new Orientation(host))).not.toThrow();
    expect(() => walkAbout(o)).not.toThrow();
    expect(() => o.skip()).not.toThrow();
    expect(() => replayOrientation()).not.toThrow();
    o.dispose();
  });

  it("allocates nothing visible per frame: a quiet frame writes no DOM and no storage", () => {
    const o = new Orientation(host);
    tick(o, 1, 1, 0);
    const set = vi.spyOn(Storage.prototype, "setItem");
    const mutate = vi.fn();
    new MutationObserver(mutate).observe(card(), { subtree: true, childList: true, attributes: true, characterData: true });
    for (let i = 0; i < 300; i++) tick(o, 1, 1, 0);
    expect(set).not.toHaveBeenCalled();
    return Promise.resolve().then(() => {
      expect(mutate).not.toHaveBeenCalled();
      o.dispose();
    });
  });
});

describe("the card's style (no colour literals, reduced motion, larger text, palette variables only)", () => {
  const css = readFileSync(join(__dirname, "orientation.css"), "utf8");
  it("uses only palette variables for colour", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).toMatch(/var\(--paper\)/);
    expect(css).toMatch(/var\(--ink\)/);
  });
  it("honours the reduced-motion preference and setting, and larger text", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/data-motion="reduced"/);
    expect(css).toMatch(/data-largeText/);
    expect(existsSync(join(__dirname, "orientation.css"))).toBe(true);
  });
  it("never captures the pointer except on its own button, and sits clear of the heading strip", () => {
    expect(css).toMatch(/\.orientation \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.orientation \.skip \{[^}]*pointer-events: auto/);
    expect(css).toMatch(/\.orientation \{[^}]*top: calc\(var\(--edge-t/);
  });
});
