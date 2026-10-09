import { describe, expect, it } from "vitest";
import { CAMP, hqPlan, inCampFootprint, insideObstacle, campObstacles } from "./camp.ts";
import { applyOutcome, newCampaign, RESOLUTIONS, TEMPLATE_RESOLUTIONS } from "./factions.ts";
import { HISTORY_MAX, historyPieces } from "./hqHistory.ts";
import { HISTORY_PIECE } from "./outpostText.ts";
import { PropKind } from "./props.ts";
import { deliverTo, newSettlements, newTech } from "./settlement.ts";
import type { CampaignState, ScenarioTemplateId, ResolutionId } from "./campaignTypes.ts";
import type { SettlementsState } from "./worldTypes.ts";

const tpl = (r: ResolutionId): ScenarioTemplateId => (Object.keys(TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[]).find((t) => TEMPLATE_RESOLUTIONS[t].includes(r)) ?? "secure_crossing";
const withHistory = (rs: readonly ResolutionId[]): CampaignState => {
  let c = newCampaign(3);
  for (const r of rs) c = applyOutcome(c, { scenario: tpl(r), resolution: r, toll: 30, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
  return c;
};
const standing = (): SettlementsState => {
  let s = newSettlements();
  const c = newCampaign(1);
  for (let i = 0; i < 4; i++) s = deliverTo(s, "kessar", PropKind.CRATE, c, 1).s;
  return { ...s, tech: { ...newTech(), road: 1, telegraph: true, launch: true, since: { ...newTech().since, road: 3, telegraph: 5, launch: 7 } } };
};

describe("HQ history", () => {
  it("every resolution has a remembered object; an empty campaign has nothing", () => {
    expect(Object.keys(HISTORY_PIECE).sort()).toEqual([...RESOLUTIONS].sort());
    expect(historyPieces(newCampaign(1), newSettlements())).toEqual([]);
  });

  it("is deterministic, bounded and one piece per ending", () => {
    for (const r of RESOLUTIONS) {
      const c = withHistory([r]);
      const a = historyPieces(c, newSettlements());
      expect(a.length).toBe(1);
      expect(historyPieces(c, newSettlements())).toEqual(a);
      expect(a[0]!.label).toBe(HISTORY_PIECE[r].label);
    }
    const lots = withHistory([...RESOLUTIONS, ...RESOLUTIONS]);
    const p = historyPieces(lots, standing());
    expect(p.length).toBeLessThanOrEqual(HISTORY_MAX);
    expect(new Set(p.map((x) => x.id)).size).toBe(p.length);
  });

  it("a scale model of the outpost sits on the planning table, showing its stage", () => {
    const p = historyPieces(newCampaign(1), standing());
    const m = p.find((x) => x.kind === "model")!;
    expect(m.surface).toBe("table");
    expect(m.stage).toBe("camp");
    expect(p.filter((x) => x.kind === "pennant").map((x) => x.tech).sort()).toEqual(["launch", "road", "telegraph"]);
  });

  it("pieces stand only on existing surfaces: on the table and the chest, or flat against the back wall, and overlap nothing else of HQ", () => {
    const c = withHistory(["forced", "sabotaged", "seized", "bribed", "rescued", "paid", "mediated", "sided_ward", "burned", "passed"]);
    const pieces = historyPieces(c, standing());
    expect(pieces.length).toBeGreaterThan(6);
    const hq = hqPlan();
    const flat = campObstacles({ height: () => 0 });
    const m = hq.marquee;
    for (const p of pieces) {
      expect(Number.isFinite(p.x + p.z + p.base + p.height + p.yaw), p.id).toBe(true);
      const own = { kind: "box" as const, x: p.x, z: p.z, hx: p.hx, hz: p.hz, yaw: p.yaw, y0: 0, y1: 1 };
      if (p.surface === "table") {
        const t = CAMP.mapTable;
        expect(p.base).toBeCloseTo(t.height, 5);
        // all four corners inside the table top
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const cx = p.x + sx * p.hx * Math.cos(p.yaw) - sz * p.hz * Math.sin(p.yaw), cz = p.z + sx * p.hx * Math.sin(p.yaw) + sz * p.hz * Math.cos(p.yaw);
          expect(insideObstacle({ kind: "box", x: t.x, z: t.z, hx: t.hx, hz: t.hz, yaw: t.yaw, y0: 0, y1: 1 }, cx, cz, 0.02), `${p.id} corner on the table`).toBe(true);
        }
      } else if (p.surface === "chest") {
        const ch = hq.chest;
        expect(p.base).toBeCloseTo(ch.height, 5);
        expect(insideObstacle({ kind: "box", x: ch.x, z: ch.z, hx: ch.hx, hz: ch.hz, yaw: ch.yaw, y0: 0, y1: 1 }, p.x, p.z, 0), `${p.id} on the chest`).toBe(true);
      } else {
        // against the marquee's back wall, inside, clear of the supply pyramid's column and above the barrels and the chest
        expect(p.x).toBeGreaterThan(m.x - m.hx);
        expect(p.x - p.hx).toBeGreaterThanOrEqual(m.x - m.hx + 0.1 - 1e-6);
        expect(p.base).toBeGreaterThan(1.2);
        for (const q of hq.pyramid.tiers) expect(Math.abs(p.z - q.z) > p.hz + q.hz || p.base > q.y1, `${p.id} vs pyramid`).toBe(true);
      }
      // nothing else of HQ stands where a table or chest piece is (its footprint holds no OTHER solid centre)
      if (p.surface !== "wall") for (const o of flat) {
        if (o.tag === "table" || (o.tag === "hq" && o.x === hq.chest.x && o.z === hq.chest.z)) continue;
        expect(insideObstacle(own, o.x, o.z, 0) && o.kind === "circle" && o.r < 0.1, `${p.id} vs ${o.tag}`).toBe(false);
      }
    }
    expect(inCampFootprint(0, 0, 0)).toBe(false);
  });
});
