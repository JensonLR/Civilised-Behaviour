// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { CAMP, JETTY } from "@cb/shared";
import { Compass, compassPins } from "./Compass.ts";
import { yawTo } from "./compassLogic.ts";

describe("the compass pins the dock and the map table", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("five places: camp, Hollowmere, the Observatory, the map room and the dock, with the same coordinates the stations use", () => {
    const pins = compassPins();
    expect(pins.map((p) => p.id)).toEqual(["camp", "village", "observatory", "map", "dock"]);
    expect(pins.find((p) => p.id === "map")).toMatchObject({ x: CAMP.mapTable.x, z: CAMP.mapTable.z });
    expect(pins.find((p) => p.id === "dock")).toMatchObject({ x: JETTY.x0, z: JETTY.z0 });
    expect(new Set(pins.map((p) => p.label)).size).toBe(pins.length);
  });

  it("each pin is drawn as a shape AND a word with its distance, and the dock reads in metres from the spawn", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const c = new Compass(root);
    // looking at the dock from the spawn ring: the pin is on the strip and says how far
    c.update(yawTo(2, 2, JETTY.x0, JETTY.z0), 2, 2);
    const marks = [...root.querySelectorAll<HTMLElement>(".mark")];
    expect(marks.map((m) => m.dataset.id)).toEqual(["camp", "village", "observatory", "map", "dock"]);
    for (const m of marks) {
      expect(m.querySelector("svg path")).not.toBeNull(); // a shape
      expect(m.querySelector(".name")!.textContent!.length).toBeGreaterThan(2); // a word
    }
    const dock = marks.find((m) => m.dataset.id === "dock")!;
    expect(dock.dataset.edge ?? "").toBe(""); // dead ahead: on the strip, not pinned to an edge
    const metres = Math.round(Math.hypot(JETTY.x0 - 2, JETTY.z0 - 2));
    expect(dock.querySelector(".dist")!.textContent).toBe(`${metres} m`);
    // turn away: the pin is pinned to an edge so it still says which way to turn
    c.update(yawTo(2, 2, JETTY.x0, JETTY.z0) + Math.PI, 2, 2);
    expect(["l", "r"]).toContain(dock.dataset.edge);
    c.dispose();
  });
});
