import { describe, expect, it } from "vitest";
import { CAMP, regionMarks, type ScenarioView } from "@cb/shared";
import { guidance } from "./guidance.ts";

const view = (over: Partial<ScenarioView> = {}): ScenarioView =>
  ({ phase: "approach", objectives: [{ id: "reach", text: "Reach the Ward's toll bar", done: false }, { id: "cross", text: "Secure the river crossing, by whatever means", done: false }], hint: "", timerLabel: "", endsAtWorldMs: 0, template: "secure_crossing", title: "Secure the River Crossing", ...over }) as ScenarioView;

describe("direction: the one thing to do next, and where (D-063)", () => {
  it("at camp: the map room, said for a first voyage and for the next; a proposed sailing asks for confirmation there", () => {
    const first = guidance({ region: "hollowmere", travelPhase: 0, downed: false, expeditions: 0, view: undefined })!;
    expect(first.text).toMatch(/map room.*first voyage/);
    expect([first.x, first.z]).toEqual([CAMP.mapTable.x, CAMP.mapTable.z]);
    expect(guidance({ region: "hollowmere", travelPhase: 0, downed: false, expeditions: 3, view: undefined })!.text).toMatch(/next voyage/);
    expect(guidance({ region: "hollowmere", travelPhase: 1, downed: false, expeditions: 0, view: undefined })!.text).toMatch(/confirm/);
  });

  it("abroad: the contract's first unfinished main step, at its place on the map; side-goals never take the line while a main step is left", () => {
    const g = guidance({ region: "kessar", travelPhase: 0, downed: false, expeditions: 0, view: view() })!;
    expect(g.text).toBe("Reach the Ward's toll bar");
    expect(g.label).toBe("Toll bar");
    expect(g.x).toBeTypeOf("number");
    const side = guidance({ region: "kessar", travelPhase: 0, downed: false, expeditions: 0, view: view({ objectives: [{ id: "clear", text: "Clear the bridge", done: false, optional: true }, { id: "reach", text: "Reach the Ward's toll bar", done: false }] }) })!;
    expect(side.text).toBe("Reach the Ward's toll bar");
  });

  it("settled, or no contract here: the way home, to the landing", () => {
    const home = regionMarks("kessar")[0]!;
    const settled = guidance({ region: "kessar", travelPhase: 0, downed: false, expeditions: 0, view: view({ phase: "resolved" }) })!;
    expect(settled.text).toMatch(/settled.*boat home/i);
    expect([settled.x, settled.z]).toEqual([home.x, home.z]);
    const none = guidance({ region: "kessar", travelPhase: 0, downed: false, expeditions: 0, view: undefined })!;
    expect(none.text).toBe("Take the boat home");
    expect([none.x, none.z]).toEqual([home.x, home.z]);
  });

  it("nothing while downed or at sea (the down card and the sailing card speak for themselves)", () => {
    expect(guidance({ region: "kessar", travelPhase: 0, downed: true, expeditions: 0, view: view() })).toBeUndefined();
    expect(guidance({ region: "hollowmere", travelPhase: 2, downed: false, expeditions: 0, view: undefined })).toBeUndefined();
  });
});
