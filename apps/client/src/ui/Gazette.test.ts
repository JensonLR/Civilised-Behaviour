// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { GAZETTE_SECONDS, Gazette } from "./Gazette.ts";
import { ObjectiveTracker } from "./ObjectiveTracker.ts";

/** D-084: the casualty column (the server's gazette lines) and the Society's request on the HUD. */
describe("the casualty column", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows each line as text for a few seconds, newest at the bottom, at most three (two on a phone)", () => {
    const g = new Gazette(document.body, false);
    const root = document.querySelector<HTMLElement>(".gazette")!;
    expect(root.hidden).toBe(true);
    expect(root.getAttribute("role")).toBe("log");
    for (const t of ["one", "two", "three", "four"]) g.push(t, 0);
    expect(g.shown).toEqual(["two", "three", "four"]);
    expect(root.hidden).toBe(false);
    g.step(GAZETTE_SECONDS * 1000 - 300);
    expect(root.querySelectorAll(".line.leaving").length).toBe(3);
    g.step(GAZETTE_SECONDS * 1000 + 1);
    expect(g.shown).toEqual([]);
    expect(root.hidden).toBe(true);
    const phone = new Gazette(document.body, true);
    for (const t of ["a", "b", "c"]) phone.push(t, 0);
    expect(phone.shown.length).toBe(2);
    g.dispose();
    phone.dispose();
  });

  it("wire data is text, never markup, and an empty or junk line is ignored", () => {
    const g = new Gazette(document.body, false);
    g.push("<img src=x onerror=alert(1)> took a leg", 0);
    g.push("", 0);
    g.push(undefined, 0);
    g.push({ evil: true }, 0);
    expect(document.querySelector(".gazette img")).toBeNull();
    expect(g.shown[0]).toContain("<img");
    expect(g.log.length).toBe(2); // (the object stringifies to text: shown as text, harmlessly)
    g.dispose();
  });

  it("the Society's request row is marked as such (the HUD shows it under the line, in play)", () => {
    const t = new ObjectiveTracker(document.body);
    t.update({
      phase: "standoff", hint: "", timerLabel: "", endsAtWorldMs: 0, template: "secure_crossing", title: "Secure the River Crossing",
      objectives: [{ id: "bar", text: "Walk north to the bar", done: false }, { id: "society", text: "For the Ordnance Board: three kegs in one blast", done: false, optional: true }],
    });
    const rows = [...document.querySelectorAll("li")];
    expect(rows.find((r) => r.textContent?.includes("Ordnance"))?.classList.contains("request")).toBe(true);
    expect(rows.find((r) => r.textContent?.includes("bar"))?.classList.contains("request")).toBe(false);
  });
});
