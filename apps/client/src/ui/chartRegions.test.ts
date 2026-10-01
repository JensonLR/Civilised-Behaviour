// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { REGION_COPY, REGION_IDS, type ParleyView, type RegionId } from "@cb/shared";
import { CHART_AT, chartRoute, chartRouteMid, regionPair } from "./CampaignMap.ts";
import { MapRoom, type MapRoomView } from "./MapRoom.ts";
import { Parley } from "./Parley.ts";

/**
 * D-037: the chart with up to five marks. Every region has a place on the 320 x 200 sheet clear of the others and of the edges (its label sits 24 below it), every pair has a lane with a finite curve
 * and a midpoint for its sailing time, a region that is not reachable (not in the view) has NO mark, shore or lane on the drawn chart, and the parley sheet speaks in the region's own voice.
 */
const reg = (id: RegionId, here = false) => ({ id, name: id, blurb: "b", note: "", here });
const viewOf = (ids: RegionId[]): MapRoomView => ({ regions: ids.map((id, i) => reg(id, i === 0)), ready: [], phase: 0, you: 0 });

afterEach(() => { document.body.innerHTML = ""; });

describe("the chart of five shores", () => {
  it("every region has a mark inside the sheet, with room for its label, apart from every other", () => {
    expect(Object.keys(CHART_AT).sort()).toEqual([...REGION_IDS].sort());
    for (const id of REGION_IDS) {
      const p = CHART_AT[id];
      expect(p.x).toBeGreaterThan(14);
      expect(p.x).toBeLessThan(306);
      expect(p.y).toBeGreaterThan(14);
      expect(p.y).toBeLessThan(200 - 26);   // the label is written 24 below the mark
    }
    for (const a of REGION_IDS) for (const b of REGION_IDS) if (a < b) expect(Math.hypot(CHART_AT[a].x - CHART_AT[b].x, CHART_AT[a].y - CHART_AT[b].y), `${a} vs ${b}`).toBeGreaterThan(40);
  });

  it("every pair of regions has one lane: a finite curve, the same either way round, with a midpoint on the sheet", () => {
    const seen = new Set<string>();
    for (const a of REGION_IDS) for (const b of REGION_IDS) {
      if (a === b) continue;
      expect(chartRoute(a, b)).toBe(chartRoute(b, a));
      expect(chartRoute(a, b)).toMatch(/^M[\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
      const m = chartRouteMid(a, b);
      expect(Number.isFinite(m.x + m.y)).toBe(true);
      expect(m.x).toBeGreaterThan(0);
      expect(m.x).toBeLessThan(320);
      expect(m.y).toBeGreaterThan(0);
      expect(m.y).toBeLessThan(200);
      seen.add(regionPair(a, b));
    }
    expect(seen.size).toBe((REGION_IDS.length * (REGION_IDS.length - 1)) / 2);
  });

  it("the drawn chart shows only the regions in the view: a stub region has no mark, no shore and no lane; opening it onto five shows all", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const room = new MapRoom(host);
    const cb = { propose: vi.fn(), ready: vi.fn(), cancel: vi.fn(), close: vi.fn() };
    room.open(viewOf(["hollowmere", "kessar", "highmark"]), cb);
    const shown = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => e.getAttribute("data-region") ?? e.getAttribute("data-lane") ?? "");
    expect(shown("g.mark").sort()).toEqual(["highmark", "hollowmere", "kessar"]);
    expect(shown("path.land[data-region]")).toEqual([]);   // the two later shores are not drawn yet
    expect(shown("path.route").sort()).toEqual(["hollowmere|highmark", "hollowmere|kessar", "kessar|highmark"]);
    expect(document.querySelector("svg")?.getAttribute("aria-label")).toMatch(/three shores/);
    room.dispose();
    document.body.innerHTML = "";
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const room2 = new MapRoom(host2);
    room2.open(viewOf([...REGION_IDS]), cb);
    expect(shown("g.mark").sort()).toEqual([...REGION_IDS].sort());
    expect(shown("path.land[data-region]").sort()).toEqual(["saltmarket", "vesper"]);
    expect(shown("path.route").length).toBe(10);
    expect(document.querySelector("svg")?.getAttribute("aria-label")).toMatch(/five shores/);
    room2.dispose();
  });

  it("the parley sheet takes its heading and asked line from the region's copy, filled in as text", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const p = new Parley(host);
    const v: ParleyView = { round: 2, speaker: "Someone", line: "<b>x</b>", toll: 45, options: [{ id: "walk_away", label: "Walk away", cost: 0, hint: "" }], mood: "wary" };
    for (const id of ["vesper", "saltmarket"] as const) {
      p.open(v, () => {}, () => {}, id);
      const text = document.body.textContent ?? "";
      expect(text).toContain(REGION_COPY[id]!.parley.heading);
      expect(text).toContain("£45");
      expect(text).toContain("Round 2");
      expect(text).toContain("wary");
      expect(text).not.toContain("{price}");
      expect(document.body.innerHTML).not.toContain("<b>x</b>");
      p.closeUi();
    }
    p.open(v, () => {}, () => {}, "kessar");
    expect(document.body.textContent).toContain("toll bar");
  });
});
