// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO } from "@cb/shared";
import { demoWarnText } from "../platform/shared.ts";
import { DemoBanner } from "./DemoBanner.ts";
import { Wishlist } from "./Wishlist.ts";
import { WISHLIST_SOON } from "./demoCopy.ts";

let host: HTMLElement;
let t = 0;
const now = (): number => t;
beforeEach(() => {
  t = 5_000_000;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  vi.stubGlobal("requestAnimationFrame", () => 0);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("DemoBanner", () => {
  const banner = (): HTMLElement => host.querySelector<HTMLElement>(".demo-banner")!;
  const timeText = (): string => banner().querySelector(".time")!.textContent!;

  it("starts hidden, shows the full session on start, counts down on its own clock", () => {
    const b = new DemoBanner(host, { now });
    expect(banner().hidden).toBe(true);
    b.start();
    expect(banner().hidden).toBe(false);
    expect(timeText()).toBe("45:00");
    t += 61_000;
    b.tick();
    expect(timeText()).toBe("43:59");
    expect(b.phase).toBe("open");
  });

  it("a server warning re-synchronises the clock and is announced once; other notices are not claimed", () => {
    const b = new DemoBanner(host, { now });
    b.start();
    expect(b.notice("Quartermaster: the crates are in.")).toBe(false);
    expect(b.notice(demoWarnText(10))).toBe(true);
    expect(timeText()).toBe("10:00");
    expect(b.phase).toBe("warn");
    expect(banner().className).toContain("warn");
    expect(banner().querySelector("[role=status]")!.textContent).toMatch(/10 minutes remaining/);
    t += 8 * 60_000 + 1000;
    b.notice(demoWarnText(2));
    expect(timeText()).toBe("2:00");
    expect(banner().className).toContain("last");
    expect(banner().querySelector("[role=status]")!.textContent).toMatch(/2 minutes remaining/);
    t += 119_000;
    b.tick();
    expect(timeText()).toBe("0:01");
    t += 2_000;
    b.tick();
    expect(timeText()).not.toMatch(/^\d/);
    expect(b.phase).toBe("over");
    expect(b.remainingS).toBe(0);
  });

  it("shows only: no focusable element, timer role, and a forged notice cannot lengthen the session past the demo's", () => {
    const b = new DemoBanner(host, { now });
    b.start();
    expect(banner().querySelectorAll("button, a, input, select, [tabindex]")).toHaveLength(0);
    expect(banner().getAttribute("role")).toBe("timer");
    b.notice("The Society's demonstration licence expires in 999 minutes.");
    expect(b.remainingS).toBeLessThanOrEqual(DEMO.sessionMinutes * 60);
  });

  it("text, not markup: server text is parsed for a number and never inserted", () => {
    const b = new DemoBanner(host, { now });
    b.start();
    b.notice("<img src=x onerror=alert(1)>");
    b.notice(`${demoWarnText(2)}<img src=x onerror=alert(1)>`);
    expect(host.querySelector("img")).toBeNull();
    expect(strip(src("./DemoBanner.ts"))).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  it("only touches the DOM when the shown second changes, and dispose removes it", () => {
    const b = new DemoBanner(host, { now });
    b.start();
    const spy = vi.spyOn(banner().querySelector(".time")!, "textContent", "set");
    for (let i = 0; i < 100; i++) b.tick();
    expect(spy).not.toHaveBeenCalled();
    b.dispose();
    expect(host.querySelector(".demo-banner")).toBeNull();
  });
});

describe("Wishlist", () => {
  const card = (): HTMLElement => document.querySelector<HTMLElement>("#sheet-wishlist")!;
  const key = (k: string, extra: KeyboardEventInit = {}): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  };

  it("with an https url: a wish-list button takes focus first, then Back; Tab wraps inside the card", () => {
    const open = vi.fn();
    const w = new Wishlist({ url: "https://store.example.test/app/1", open });
    w.show();
    const buttons = [...card().querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.className.split(" ")[0])).toEqual(["primary", "back"]);
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1]!.focus();
    key("Tab");
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0]!.focus();
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(buttons[1]);
    buttons[0]!.click();
    expect(open).toHaveBeenCalledExactlyOnceWith("https://store.example.test/app/1");
    w.dispose();
  });

  it("without a url, or with anything that is not https: coming soon, no link, no button to a store", () => {
    for (const bad of [undefined, "", "http://store.example.test/", "javascript:alert(1)", "data:text/html,x", "ftp://x.test/", "not a url", "//store.example.test"]) {
      document.body.innerHTML = "";
      const open = vi.fn();
      const w = new Wishlist({ url: bad, open });
      w.show();
      expect(w.url, String(bad)).toBeUndefined();
      expect(card().querySelector("a")).toBeNull();
      expect(card().querySelectorAll("button")).toHaveLength(1);
      expect(card().textContent).toContain(WISHLIST_SOON);
      expect(open).not.toHaveBeenCalled();
      w.dispose();
    }
  });

  it("Escape, pad B and Back each close it and report once; focus returns to the opener", () => {
    for (const how of ["escape", "pad", "back"] as const) {
      document.body.innerHTML = "";
      const opener = document.createElement("button");
      document.body.appendChild(opener);
      opener.focus();
      const onClose = vi.fn();
      const w = new Wishlist({ onClose });
      w.show();
      expect(w.isOpen).toBe(true);
      if (how === "escape") key("Escape");
      else if (how === "pad") card().dispatchEvent(new CustomEvent("padback"));
      else card().querySelector<HTMLButtonElement>("button.back")!.click();
      expect(w.isOpen, how).toBe(false);
      expect(onClose, how).toHaveBeenCalledTimes(1);
      expect(document.activeElement, how).toBe(opener);
      w.dispose();
    }
  });

  it("is a labelled modal dialog; its copy is set as text", () => {
    const w = new Wishlist();
    w.show();
    const panel = card().querySelector<HTMLElement>("[role=dialog]")!;
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(card().querySelector(`#${panel.getAttribute("aria-labelledby")}`)!.textContent).toMatch(/Licence/);
    expect(strip(src("./Wishlist.ts"))).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    w.dispose();
  });
});

describe("demo styling and copy", () => {
  it("reduced motion removes the banner's transition, and no colour literal exists in the demo UI sources, css or copy", () => {
    const css = src("./demo.css");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{[^}]*transition:\s*none/);
    for (const f of ["./demo.css", "./demoCopy.ts", "./DemoBanner.ts", "./Wishlist.ts"]) {
      expect(strip(src(f)), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b0x[0-9a-fA-F]{6}\b|\brgba?\(|\bhsla?\(/);
    }
  });
});
