// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandWheel, WHEEL_DEAD, WHEEL_STAMPS, wheelPick } from "./CommandWheel.ts";
import type { CommandId } from "@cb/shared";

let host: HTMLElement;
let sent: CommandId[];
let wheel: CommandWheel;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  sent = [];
  wheel = new CommandWheel(host, (c) => sent.push(c));
});
afterEach(() => {
  wheel.dispose();
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const key = (k: string, init: KeyboardEventInit = {}): void => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); };

describe("wheelPick", () => {
  it("names the stamp by angle: top first, clockwise, 72 degrees apart", () => {
    const at = (deg: number, r = 0.8): number => { const a = (deg * Math.PI) / 180; return wheelPick(Math.sin(a) * r, -Math.cos(a) * r); };
    expect(at(0)).toBe(0);
    expect(at(72)).toBe(1);
    expect(at(144)).toBe(2);
    expect(at(216)).toBe(3);
    expect(at(288)).toBe(4);
    expect(at(359)).toBe(0);
    expect(at(35)).toBe(0);
    expect(at(37)).toBe(1);
    expect(at(-30)).toBe(0);
    expect(at(-40)).toBe(4);
  });
  it("the dead centre chooses nothing; garbage chooses nothing", () => {
    expect(wheelPick(0, 0)).toBe(-1);
    expect(wheelPick(WHEEL_DEAD * 0.9, 0)).toBe(-1);
    expect(wheelPick(WHEEL_DEAD * 1.1, 0)).toBe(1);
    for (const v of [Number.NaN, Infinity, -Infinity]) { expect(wheelPick(v, 0)).toBe(-1); expect(wheelPick(0, v)).toBe(-1); }
    expect(wheelPick(1, 0, 0)).toBe(-1);
    expect(wheelPick(1, 0, Number.NaN)).toBe(-1);
  });
});

describe("the command wheel", () => {
  it("is a menu of five stamps, closed until opened, and a plain button each", () => {
    const ring = host.querySelector<HTMLElement>(".ring")!;
    expect(ring.getAttribute("role")).toBe("menu");
    expect(ring.hidden).toBe(true);
    const items = [...host.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
    expect(items).toHaveLength(5);
    expect(items.map((b) => b.dataset.id)).toEqual(WHEEL_STAMPS.map((s) => s.id));
    for (const b of items) { expect(b.tagName).toBe("BUTTON"); expect(b.getAttribute("tabindex")).toBe("0"); expect(b.textContent!.length).toBeGreaterThan(8); }
    wheel.open();
    expect(ring.hidden).toBe(false);
    expect(wheel.isOpen).toBe(true);
    expect(host.querySelector(".command-wheel")!.getAttribute("data-open")).toBe("true");
  });

  it("choose by pointer, release to send; the centre cancels; nothing sent when closed", () => {
    expect(wheel.release()).toBeUndefined();
    wheel.open();
    wheel.point(0.8, 0); // right: stamp 1 (hold)
    expect(wheel.choice).toBe(1);
    expect(host.querySelector(".stamp.on")!.getAttribute("data-id")).toBe("hold");
    expect(host.querySelector(".stamp.on")!.getAttribute("aria-current")).toBe("true");
    expect(wheel.release()).toBe("hold");
    expect(sent).toEqual(["hold"]);
    expect(wheel.isOpen).toBe(false);
    wheel.open();
    wheel.point(0.1, 0.1);
    expect(wheel.choice).toBe(-1);
    expect(wheel.release()).toBeUndefined();
    expect(sent).toEqual(["hold"]);
  });

  it("pointer-lock deltas steer a virtual cursor that stays inside the ring", () => {
    wheel.open();
    wheel.nudge(0, -300); // up
    expect(wheel.choice).toBe(0);
    wheel.nudge(0, -5000);
    wheel.nudge(300, 600); // down and right
    expect(wheel.choice).toBe(2);
    wheel.nudge(Number.NaN, 5);
    expect(wheel.choice).toBe(2);
    wheel.nudge(0, -9999); // however far the hand travels, the cursor stops at the rim
    expect(wheel.choice).toBe(0);
    wheel.nudge(9999, 0);
    expect(wheel.choice).toBe(1);
    wheel.nudge(-120, 0); // one ring-width back lands at the centre: the cursor was clamped at the rim, not 80 widths away
    expect(wheel.choice).toBe(-1);
  });

  it("a pad stick chooses the same way (y down), and pad B / Escape cancel", () => {
    wheel.open();
    wheel.stick(-0.9, -0.1);
    expect(wheel.choice).toBe(4);
    wheel.stick(0, 0);
    expect(wheel.choice).toBe(-1);
    wheel.stick(0.2, 1);
    expect(wheel.choice).toBe(2);
    host.querySelector(".ring")!.dispatchEvent(new CustomEvent("padback"));
    expect(wheel.isOpen).toBe(false);
    expect(sent).toEqual([]);
    wheel.open();
    key("Escape");
    expect(wheel.isOpen).toBe(false);
    expect(sent).toEqual([]);
  });

  it("keys 1-5 send at once while open and are ignored when closed or with a modifier", () => {
    key("3");
    expect(sent).toEqual([]);
    wheel.open();
    key("3", { ctrlKey: true });
    expect(sent).toEqual([]);
    key("3");
    expect(sent).toEqual(["attack"]);
    expect(wheel.isOpen).toBe(false);
    wheel.open();
    key("5");
    wheel.open();
    key("1");
    expect(sent).toEqual(["attack", "retreat", "follow"]);
    wheel.open();
    key("6");
    key("0");
    key("a");
    expect(wheel.isOpen).toBe(true);
    expect(sent).toHaveLength(3);
  });

  it("arrows move the choice around the ring, Enter sends it", () => {
    wheel.open();
    key("ArrowRight");
    expect(wheel.choice).toBe(0);
    key("ArrowRight");
    expect(wheel.choice).toBe(1);
    key("ArrowLeft");
    key("ArrowLeft");
    expect(wheel.choice).toBe(4);
    key("Enter");
    expect(sent).toEqual(["retreat"]);
    wheel.open();
    key("Enter"); // nothing chosen: nothing sent
    expect(sent).toEqual(["retreat"]);
    expect(wheel.isOpen).toBe(true);
  });

  it("a stamp is clickable and focusable (Tab / pad A), and focus chooses it", () => {
    wheel.open();
    const b = host.querySelector<HTMLButtonElement>('[data-id="fetch"]')!;
    b.focus();
    expect(wheel.choice).toBe(3);
    b.click();
    expect(sent).toEqual(["fetch"]);
    expect(wheel.isOpen).toBe(false);
  });

  it("orders the hands cannot take are struck off and cannot be chosen or sent", () => {
    wheel.setAvailable(["follow", "hold", "attack", "retreat"]); // no porter: no fetch
    const f = host.querySelector<HTMLElement>('[data-id="fetch"]')!;
    expect(f.getAttribute("aria-disabled")).toBe("true");
    expect(f.classList.contains("off")).toBe(true);
    wheel.open();
    wheel.point(-0.7, 0.6); // fetch's slice
    expect(wheel.choice).toBe(-1);
    key("4");
    expect(sent).toEqual([]);
    key("ArrowLeft"); // skips the struck stamp
    key("ArrowLeft");
    expect(wheel.choice).not.toBe(3);
    wheel.setAvailable(WHEEL_STAMPS.map((s) => s.id));
    expect(f.hasAttribute("aria-disabled")).toBe(false);
  });

  it("shows 'Obeyed' / 'Refused' as words, set as text, for a few seconds", () => {
    vi.useFakeTimers();
    const r = host.querySelector<HTMLElement>(".result")!;
    expect(r.hidden).toBe(true);
    wheel.setResult("Refused. Jem Cobbold is <b>composing</b> a letter home.");
    expect(r.hidden).toBe(false);
    expect(r.querySelector("b.verdict")!.textContent).toBe("Refused");
    expect(r.getAttribute("data-verdict")).toBe("refused");
    expect(r.textContent).toContain("<b>composing</b>");
    expect(r.querySelectorAll("b")).toHaveLength(1); // the wire string's tag is text
    expect(r.getAttribute("role")).toBe("status");
    wheel.setResult("Obeyed (2 of 3).");
    expect(r.getAttribute("data-verdict")).toBe("obeyed");
    vi.advanceTimersByTime(4100);
    expect(r.hidden).toBe(true);
    wheel.setResult("");
    expect(r.hidden).toBe(true);
  });

  it("dispose removes the wheel and its listener", () => {
    wheel.dispose();
    expect(host.querySelector(".command-wheel")).toBeNull();
    key("2");
    expect(sent).toEqual([]);
    wheel = new CommandWheel(host, (c) => sent.push(c)); // so afterEach has something to dispose
  });
});

describe("styles", () => {
  const css = readFileSync(["src/ui/commandWheel.css", "apps/client/src/ui/commandWheel.css"].map((p) => join(process.cwd(), p)).find((p) => existsSync(p))!, "utf8"); // (happy-dom's import.meta.url is not a file URL)
  it("carry no colour literals (palette variables only)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/i);
    expect(css).not.toMatch(/\b(white|black|red|green|blue|gold|silver|gray|grey|orange|yellow|purple|brown)\b(?![-\w])/i);
    expect(css).toMatch(/var\(--/);
  });
  it("respects reduced motion and rem sizing", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*no-preference/);
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/); // text is rem (the root's scale is inside max()/min()), so larger text grows the whole ring
    expect(css).not.toMatch(/(?<![-\w])(?:width|height|left|top|bottom):\s*-?[\d.]+px/);
  });
});
