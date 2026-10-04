// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Guide } from "./Guide.ts";

describe("the guide's line and marker (D-063)", () => {
  afterEach(() => (document.body.innerHTML = ""));
  const make = (): { g: Guide; mark: HTMLElement; line: HTMLElement } => {
    const g = new Guide(document.body);
    return { g, mark: document.querySelector<HTMLElement>(".goalmark")!, line: document.querySelector<HTMLElement>(".guide")! };
  };
  const at = (mark: HTMLElement): [number, number] => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(mark.style.transform)!;
    return [Number(m[1]), Number(m[2])];
  };

  it("the line shows unless the orders card is the line; blank hides it", () => {
    const { g, line } = make();
    g.setLine("Walk to the map room", true);
    expect(line.hidden).toBe(false);
    expect(line.textContent).toContain("Walk to the map room");
    g.setLine("Walk to the map room", false);
    expect(line.hidden).toBe(true);
    g.setLine(undefined, true);
    expect(line.hidden).toBe(true);
  });

  it("over the place when it is on screen, with its distance; gone when you are there", () => {
    const { g, mark } = make();
    g.place(0, 0, false, 82.4, "Toll bar");
    expect(mark.hidden).toBe(false);
    expect(mark.classList.contains("off")).toBe(false);
    expect(mark.textContent).toContain("82 m");
    expect(mark.textContent).toContain("Toll bar");
    g.place(0, 0, false, 2, "Toll bar");
    expect(mark.hidden).toBe(true);
  });

  it("held inside the edge with an arrow when off to the side or behind; never above the line", () => {
    const { g, mark } = make();
    const w = window.innerWidth;
    const h = window.innerHeight;
    g.place(3, 0, false, 50, "Gate");
    expect(mark.classList.contains("off")).toBe(true);
    const [x] = at(mark);
    expect(x).toBeLessThan(w);
    expect(x).toBeGreaterThan(w / 2);
    g.place(0.2, 0.3, true, 50, "Gate");
    const [, yBehind] = at(mark);
    expect(yBehind).toBeGreaterThan(h / 2); // behind you: the foot of the picture
    g.place(0, 0.95, false, 50, "Gate", 4, 120);
    expect(at(mark)[1]).toBeGreaterThanOrEqual(120);
  });

  it("D-074: the marker reports where it stands over the place, and goes quiet (the flag alone) over somebody whose name is up", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const g = new Guide(parent);
    g.place(0, 0, false, 30, "Lamp-Warden");
    expect(g.markOver).toBe(true);
    expect(g.markX).toBeGreaterThan(0);
    g.quiet(true);
    expect(parent.querySelector(".goalmark")!.classList.contains("quiet")).toBe(true);
    g.quiet(false);
    expect(parent.querySelector(".goalmark")!.classList.contains("quiet")).toBe(false);
    g.place(3, 0, false, 30, "Lamp-Warden"); // (off to the side: held at the edge with the arrow, not "over" anything)
    expect(g.markOver).toBe(false);
    g.dispose();
  });
});

