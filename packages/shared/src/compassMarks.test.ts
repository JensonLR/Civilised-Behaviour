import { describe, expect, it } from "vitest";
import { OBJECTIVE_SPOTS, objectiveMark, regionMarks } from "./compassMarks.ts";
import { newCampaign } from "./factions.ts";
import { REGIONS } from "./regions.ts";
import { REGION_TEMPLATES, TEMPLATES, TEMPLATE_IDS } from "./scenarios/registry.ts";
import type { RegionId } from "./campaignTypes.ts";

const REGION_IDS = Object.keys(REGIONS) as RegionId[];

/** Objectives that are about no single place (a patrol that comes to you, a yard that takes sides, a fact on file): the strip skips them. */
const PLACELESS = new Set(["answer", "peace", "provisional", "books"]);

describe("the heading strip points at the shore you stand on (D-040)", () => {
  it("every region has its own places, inside its bounds, with unique ids and names; only the hub has the hub's", () => {
    const hub = regionMarks("hollowmere").map((m) => m.id);
    expect(hub).toEqual(["camp", "village", "observatory", "map", "dock"]);
    for (const r of REGION_IDS) {
      const marks = regionMarks(r);
      expect(marks.length).toBeGreaterThanOrEqual(4);
      expect(new Set(marks.map((m) => m.id)).size).toBe(marks.length);
      expect(new Set(marks.map((m) => m.label)).size).toBe(marks.length);
      for (const m of marks) {
        expect(Number.isFinite(m.x) && Number.isFinite(m.z)).toBe(true);
        expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(REGIONS[r].bounds * 1.5);
      }
      if (r !== "hollowmere") {
        // the playtest's bug: the hub's camp, observatory and map room were on every shore's strip
        for (const id of ["camp", "observatory", "map"]) expect(marks.some((m) => m.id === id)).toBe(false);
        expect(marks[0]!.icon).toBe("dock"); // the boat home first
      }
    }
  });

  it("every contract's objectives (as its opening view lists them) are mapped to a place or are knowingly placeless", () => {
    for (const id of TEMPLATE_IDS) {
      expect(OBJECTIVE_SPOTS[id], id).toBeDefined();
      const c = newCampaign(11);
      const def = TEMPLATES[id];
      const v = def.view(def.init(c, 40, 11), 0);
      for (const o of v.objectives) expect(o.id in OBJECTIVE_SPOTS[id] || PLACELESS.has(o.id), `${id}.${o.id}`).toBe(true);
    }
  });

  it("the flag stands on the first unfinished main objective; optional side-goals only when nothing else is left; home is the region's landing", () => {
    for (const r of REGION_IDS) {
      for (const id of REGION_TEMPLATES[r]) {
        const def = TEMPLATES[id];
        const v = def.view(def.init(newCampaign(3), 40, 3), 0);
        const m = objectiveMark(r, v);
        expect(m, `${r}/${id}`).toBeDefined();
        expect(m!.icon).toBe("goal");
        const first = v.objectives.find((o) => !o.done && !o.optional && o.id in OBJECTIVE_SPOTS[id]);
        if (first) {
          const s = OBJECTIVE_SPOTS[id][first.id]!;
          if (s !== "home") expect([m!.x, m!.z]).toEqual([s.x, s.z]);
        }
        // everything done but going home: the flag is the boat
        const home = objectiveMark(r, { template: id, objectives: [...v.objectives.map((o) => ({ ...o, done: o.id !== "home" })), { id: "home", done: false }] });
        expect(home!.label).toBe("Boat home");
        expect([home!.x, home!.z]).toEqual([regionMarks(r)[0]!.x, regionMarks(r)[0]!.z]);
      }
    }
    // a settled contract: whatever is left undone is moot, the flag is the boat home (it stayed on the last objective)
    const settled = objectiveMark("kessar", { template: "secure_crossing", phase: "resolved", objectives: [{ id: "reach", done: false }] });
    expect(settled!.label).toBe("Boat home");
    expect([settled!.x, settled!.z]).toEqual([regionMarks("kessar")[0]!.x, regionMarks("kessar")[0]!.z]);
    // no contract, or nothing left with a place: no flag
    expect(objectiveMark("kessar", undefined)).toBeUndefined();
    expect(objectiveMark("kessar", { template: "secure_crossing", objectives: [{ id: "reach", done: true }] })).toBeUndefined();
    // an optional goal is the fallback, never the first choice
    const opt = objectiveMark("kessar", { template: "secure_crossing", objectives: [{ id: "clear", done: false, optional: true }, { id: "reach", done: false }] });
    expect(opt!.label).toBe("Toll bar");
    const onlyOpt = objectiveMark("kessar", { template: "secure_crossing", objectives: [{ id: "clear", done: false, optional: true }] });
    expect(onlyOpt!.label).toBe("The bridge");
  });
});
