// @vitest-environment happy-dom
import { typeset } from "./typeset.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScenarioView } from "@cb/shared";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ObjectiveTracker, URGENT_SECONDS, formatTimer, DEFAULT_TITLE, withKeys } from "./ObjectiveTracker.ts";
import { promptPlain } from "../input/glyphDom.ts";
import { newCampaign } from "@cb/shared";
import { TEMPLATES, TEMPLATE_IDS } from "@cb/shared";

const view = (o: Partial<ScenarioView> = {}): ScenarioView => ({
  phase: "standoff", hint: "Talk to the Warden.", timerLabel: "Syndicate arrives", endsAtWorldMs: 100_000, template: "secure_crossing", title: "Secure the River Crossing",
  objectives: [
    { id: "reach", text: "Reach the Ward's toll bar", done: true },
    { id: "secure", text: "Secure the river crossing, by whatever means", done: false },
    { id: "rout", text: "Break the garrison (1 of 4)", done: false, optional: true },
  ],
  ...o,
});

// (happy-dom's import.meta.url is not a file URL, so find the stylesheet from the package root, which is where vitest runs)
const cssPath = ["src/ui/objectiveTracker.css", "apps/client/src/ui/objectiveTracker.css"].map((p) => join(process.cwd(), p)).find((p) => existsSync(p))!;
const css = readFileSync(cssPath, "utf8");

let host: HTMLElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); });
afterEach(() => { host.remove(); });

describe("ObjectiveTracker", () => {
  it("is hidden until it has orders, and hides again when the scenario ends", () => {
    const t = new ObjectiveTracker(host);
    expect(t.visible).toBe(false);
    t.update(view());
    expect(t.visible).toBe(true);
    t.update(undefined);
    expect(t.visible).toBe(false);
    t.update(view({ objectives: [] }));
    expect(t.visible).toBe(false);
  });

  it("renders done and optional objectives with their marks and screen-reader words", () => {
    const t = new ObjectiveTracker(host);
    t.update(view());
    const li = host.querySelectorAll("li");
    expect(li).toHaveLength(3);
    expect(li[0]!.classList.contains("done")).toBe(true);
    expect(li[0]!.textContent).toContain("Done.");
    expect(li[1]!.classList.contains("done")).toBe(false);
    expect(li[2]!.classList.contains("optional")).toBe(true);
    expect(li[2]!.textContent).toContain("Optional.");
    expect(host.querySelector(".hint")!.textContent).toBe("Talk to the Warden.");
    expect(host.querySelector("section")!.getAttribute("aria-label")).toBeTruthy();
  });

  it("updates in place: the same rows survive, removed ones go, order follows the server", () => {
    const t = new ObjectiveTracker(host);
    t.update(view());
    const first = host.querySelector("li")!;
    t.update(view({ objectives: [
      { id: "reach", text: "Reach the Ward's toll bar", done: true }, { id: "secure", text: "Secure it", done: true },
      { id: "home", text: "Sail home from the landing dock", done: false },
    ] }));
    const li = host.querySelectorAll("li");
    expect(li).toHaveLength(3);
    expect(li[0]).toBe(first);
    expect(li[1]!.textContent).toContain("Secure it");
    expect(li[2]!.textContent).toContain("Sail home");
    t.update(view({ objectives: [{ id: "home", text: "Sail home from the landing dock", done: false }, { id: "reach", text: "Reach", done: true }] }));
    expect([...host.querySelectorAll(".text")].map((e) => e.textContent)).toEqual(["Sail home from the landing dock", "Reach"]);
  });

  it("shows the countdown against the world clock, turns urgent, and hides at zero", () => {
    const t = new ObjectiveTracker(host);
    t.update(view({ endsAtWorldMs: 100_000 }));
    const timer = host.querySelector<HTMLElement>(".timer")!;
    expect(timer.hidden).toBe(true); // nothing shown until the first tick
    t.tick(40_000);
    expect(timer.hidden).toBe(false);
    expect(host.querySelector(".clock")!.textContent).toBe("1:00");
    expect(host.querySelector(".label")!.textContent).toBe("Syndicate arrives");
    expect(timer.classList.contains("urgent")).toBe(false);
    t.tick(100_000 - URGENT_SECONDS * 1000 + 1000);
    expect(timer.classList.contains("urgent")).toBe(true);
    expect(host.querySelector(".clock")!.textContent).toBe("0:14");
    t.tick(100_001);
    expect(timer.hidden).toBe(true);
  });

  it("no timer when the server sends none (endsAtWorldMs 0)", () => {
    const t = new ObjectiveTracker(host);
    t.update(view({ endsAtWorldMs: 0, timerLabel: "" }));
    t.tick(5);
    expect(host.querySelector<HTMLElement>(".timer")!.hidden).toBe(true);
  });

  it("treats the view as data: markup in a string is text, not elements", () => {
    const t = new ObjectiveTracker(host);
    t.update(view({ hint: "<img src=x onerror=alert(1)>", objectives: [{ id: "x", text: "<b>bold</b>", done: false }] }));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("b.clock")).not.toBeNull();
    expect(host.querySelectorAll("b")).toHaveLength(1); // only the clock
    expect(host.querySelector(".text")!.textContent).toBe("<b>bold</b>");
  });

  it("dispose removes the card", () => {
    const t = new ObjectiveTracker(host);
    t.update(view());
    t.dispose();
    expect(host.children).toHaveLength(0);
  });
});

describe("formatTimer", () => {
  it("rounds up to whole seconds and never goes negative", () => {
    expect(formatTimer(60_000)).toBe("1:00");
    expect(formatTimer(59_001)).toBe("1:00");
    expect(formatTimer(200)).toBe("0:01");
    expect(formatTimer(0)).toBe("0:00");
    expect(formatTimer(-5)).toBe("0:00");
    expect(formatTimer(Number.NaN)).toBe("0:00");
    expect(formatTimer(425_000)).toBe("7:05");
  });
});

describe("stylesheet", () => {
  it("respects reduced motion (media query and the in-game setting) and uses palette variables only", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/data-motion="reduced"/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("the heading is the contract's own title (and the default for a server that sends none); the template and complication are data attributes", () => {
    const t = new ObjectiveTracker(host);
    t.update(view());
    expect(host.querySelector("h2")!.textContent).toBe("Secure the River Crossing");
    expect(host.querySelector("section")!.dataset.template).toBe("secure_crossing");
    expect(host.querySelector("section")!.dataset.complication).toBeUndefined();
    t.update(view({ template: "hostage_rescue", title: "The Cartwright's Cage", complication: "rain" }));
    expect(host.querySelector("h2")!.textContent).toBe("The Cartwright's Cage");
    expect(host.querySelector("section")!.dataset.complication).toBe("rain");
    t.update(view({ title: "", complication: "none" }));
    expect(host.querySelector("h2")!.textContent).toBe(DEFAULT_TITLE);
    expect(host.querySelector("section")!.dataset.complication).toBeUndefined();
    t.update({ ...view(), title: undefined as never, template: undefined as never });
    expect(host.querySelector("h2")!.textContent).toBe(DEFAULT_TITLE);
    t.update(view({ title: "<img src=x onerror=alert(1)>" }));
    expect(host.querySelector("h2 img")).toBeNull();   // text, never markup
  });

  it("renders every template's real views (fresh, mid-run and resolved) with unique rows, a hint and its title", () => {
    const c = newCampaign(4);
    for (const id of TEMPLATE_IDS) {
      const def = TEMPLATES[id];
      const t = new ObjectiveTracker(host);
      const s0 = def.init(c, 40, 4);
      const mid = def.reduce(def.reduce(s0, { t: "tick", dt: 30 }).s, { t: "near", at: id === "hostage_rescue" ? "camp" : id === "convoy_ambush" ? "cut" : id === "border_incident" ? "marker" : "bar", party: 2 }).s;
      const end = def.reduce(mid, { t: "party_down" }).s;
      for (const s of [s0, mid, end]) {
        const v = def.view(s, 5_000);
        t.update(v);
        expect(host.querySelector("h2")!.textContent, id).toBe(def.title);
        const rows = [...host.querySelectorAll("li")];
        expect(rows.length, id).toBe(v.objectives.length);
        // (D-086: the server's "(Use)" is the key of the device in hand)
        expect(rows.map((r) => r.querySelector(".text")!.textContent)).toEqual(v.objectives.map((o) => promptPlain(withKeys(o.text))));
        expect(host.querySelector(".hint")!.textContent, id).toBe(typeset(v.hint)); // (printer's quotes, D-040)
        const rule = host.querySelector<HTMLElement>(".rule")!;
        expect(rule.hidden, `${id}: the rule shows while it applies`).toBe(v.rule === undefined);
        if (v.rule) expect(rule.textContent, id).toBe(typeset(v.rule));
        expect(t.visibleOrders).toBe(v.phase);
        t.tick(6_000);
      }
      expect(host.querySelector("section")!.dataset.template).toBe(id);
      t.dispose();
    }
  });
});
