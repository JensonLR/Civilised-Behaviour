import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { applyOutcome, createArena, deliverTo, historyPieces, newCampaign, newSettlements, PropKind, RESOLUTIONS, TEMPLATE_RESOLUTIONS, type ResolutionId, type ScenarioTemplateId } from "@cb/shared";
import { buildHqHistoryGeometry } from "./hqHistory.ts";

const tris = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
const tpl = (r: ResolutionId): ScenarioTemplateId => (Object.keys(TEMPLATE_RESOLUTIONS) as ScenarioTemplateId[]).find((t) => TEMPLATE_RESOLUTIONS[t].includes(r)) ?? "secure_crossing";

describe("HQ history geometry", () => {
  const world = createArena(7);
  const ground = (x: number, z: number): number => world.terrainHeight(x, z);
  it("nothing to show builds nothing", () => expect(buildHqHistoryGeometry([], ground, 1)).toBeUndefined());

  it("every ending's object builds finite geometry at both LODs, and a full set (with the outpost model and three pennants) fits the budget", () => {
    for (const r of RESOLUTIONS) {
      const c = applyOutcome(newCampaign(1), { scenario: tpl(r), resolution: r, toll: 30, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
      for (const lod of [0, 1] as const) {
        const g = buildHqHistoryGeometry(historyPieces(c, newSettlements()), ground, lod)!;
        expect(g, `${r} lod ${lod}`).toBeDefined();
        for (const key of Object.keys(g.attributes)) {
          const a = g.attributes[key]!.array as ArrayLike<number>;
          for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) throw new Error(`${r} ${key}[${i}] is ${a[i]}`);
        }
      }
    }
    let s = newSettlements();
    for (let i = 0; i < 4; i++) s = deliverTo(s, "kessar", PropKind.CRATE, newCampaign(1), 1).s;
    s = { ...s, posts: { kessar: { ...s.posts.kessar!, stage: "town" } }, tech: { road: 2, telegraph: true, launch: true, since: { road: 1, telegraph: 2, launch: 3 } } };
    let c = newCampaign(2);
    for (const r of ["forced", "sabotaged", "seized", "rescued", "paid", "mediated", "burned"] as const) c = applyOutcome(c, { scenario: tpl(r), resolution: r, toll: 30, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    const full = historyPieces(c, s);
    expect(full.length).toBeLessThanOrEqual(12);
    const hi = buildHqHistoryGeometry(full, ground, 1)!;
    expect(tris(hi)).toBeLessThan(9_000);
    expect(tris(buildHqHistoryGeometry(full, ground, 0)!)).toBeLessThanOrEqual(tris(hi));
    // every piece sits within a metre or so of its own spot
    const p = hi.attributes.position!.array as ArrayLike<number>;
    for (const piece of full) {
      let near = false;
      for (let i = 0; i < p.length && !near; i += 3) near = Math.hypot(p[i]! - piece.x, p[i + 2]! - piece.z) < Math.max(piece.hx, piece.hz) + 0.6;
      expect(near, piece.id).toBe(true);
    }
  });

  it("is deterministic", () => {
    const c = applyOutcome(newCampaign(1), { scenario: "secure_crossing", resolution: "forced", toll: 30, paid: 0, bridge: "intact", brokePromise: false, seconds: 1, tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 } });
    const a = buildHqHistoryGeometry(historyPieces(c, newSettlements()), ground, 1)!;
    const b = buildHqHistoryGeometry(historyPieces(c, newSettlements()), ground, 1)!;
    expect(Array.from(a.attributes.position!.array)).toEqual(Array.from(b.attributes.position!.array));
  });
});
