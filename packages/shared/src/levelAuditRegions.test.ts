import { describe, expect, it } from "vitest";
import { REGION_IDS } from "./campaignTypes.ts";
import { AUDIT_SEEDS, auditRegion, countByKind, errorsOf, formatReport, overAllowance } from "./levelAudit.ts";
import { ALLOWANCE, LEVEL_ADAPTERS } from "./levelAuditAdapters.ts";
import { PAD_MAX, TENT_PAD_MAX, padSpread, type RegionLevel } from "./levelPlan.ts";
import { createRegionWorld } from "./regions.ts";
import { highmarkLevel } from "./highmark.ts";
import { kessarLevel } from "./kessar.ts";
import { saltmarketLevel } from "./saltmarket.ts";
import { vesperLevel } from "./vesper.ts";
import { villageLevel } from "./village.ts";

/**
 * THE PERMANENT LEVEL AUDIT (D-038, docs/LEVEL_PLAN.md section 9): every region's adapter runs over `AUDIT_SEEDS` (1, 7, 42, 1337, 90210) and may report no error beyond its allowance. The allowance is
 * a RATCHET that only goes down; its end state is `{}` everywhere (this file asserts that: raising it needs a line in BUILD_STATE and D-038's addendum). `AUDIT_SEEDS_EXTRA=<n>` runs n more seeds
 * (100, 137, 174, ...): the game's seed is random per room, so a region that is clean on five seeds and broken on a sixth is broken.
 * Warnings (a prop beside a path, a rock beside a rock) never fail but are listed in the output.
 */

const extra = Number(process.env.AUDIT_SEEDS_EXTRA ?? 0);
const SEEDS = [...AUDIT_SEEDS, ...Array.from({ length: Number.isFinite(extra) ? extra : 0 }, (_, i) => 100 + i * 37)];

describe("the ratchet", () => {
  it("every region's allowance has reached the end state: empty", () => {
    for (const id of REGION_IDS) expect(ALLOWANCE[id], id).toEqual({});
  });
});

for (const id of REGION_IDS) {
  describe(`level audit: ${id}`, () => {
    for (const seed of SEEDS) {
      it(`seed ${seed}: no error beyond the allowance`, () => {
        const report = auditRegion(LEVEL_ADAPTERS[id](seed));
        const over = overAllowance(report, ALLOWANCE[id]);
        if (over.length > 0) console.error(formatReport(report));
        expect(over.map((f) => `${f.kind} ${f.subject} ${f.other ?? ""} @ ${f.at.x.toFixed(1)},${f.at.z.toFixed(1)}: ${f.detail}`)).toEqual([]);
        const warn = report.findings.length - errorsOf(report).length;
        if (warn > 0 && seed === AUDIT_SEEDS[2]) console.info(`${id} seed ${seed}: ${warn} warnings`, JSON.stringify(countByKind(report)));
      }, 60_000);
    }
  });
}

// ---- buildings stand on a pad -------------------------------------------------------------------------------------------------------------------

const LEVELS: Record<string, RegionLevel> = { hollowmere: villageLevel(), kessar: kessarLevel(), highmark: highmarkLevel(), vesper: vesperLevel(), saltmarket: saltmarketLevel() };

/**
 * Buildings that are NOT floor-bound on level ground, each with the most terrain height its footprint may span (a ratchet: lower these, never raise them). The stilt houses, the round granaries on their
 * mushroom stones and the Saltmarket's warehouses stand on piles (the ground under them may fall away); the fort's bastions and gate, the capital's gate towers and the cloister are built into the hill
 * or the cliff; the mill stands on the stream's bank, the tipple against the ledge's rock; the market stalls are open counters and poles.
 */
const PAD_ALLOW: Record<string, number> = {
  "hollowmere:stilt-e": 2.0, "hollowmere:stilt-w": 1.8, "hollowmere:mill": 3.0, "hollowmere:gran-a": 1.1, "hollowmere:gran-b": 1.1,
  "hollowmere:stall-1": 1.1, "hollowmere:stall-2": 1.1, "hollowmere:stall-3": 1.1, "hollowmere:stall-4": 1.1,
  "kessar:fort.bastion0": 4.7, "kessar:fort.bastion1": 4.7, "kessar:fort.gate": 1.3,
  "highmark:gate.tower0": 2.4, "highmark:gate.tower1": 2.4,
  "vesper:cloister": 1.5, "vesper:tipple": 1.3,
  "saltmarket:warehouse2": 1.0, "saltmarket:warehouse3": 1.0, "saltmarket:warehouse4": 1.0, "saltmarket:warehouse5": 1.0, "saltmarket:warehouse6": 1.0, "saltmarket:warehouse7": 1.0,
};

describe("every building stands on a pad (the floor never sits on a slope)", () => {
  for (const id of REGION_IDS) {
    it(`${id}: the terrain under each footprint spans at most ${PAD_MAX} m (tents ${TENT_PAD_MAX}), bar the declared exceptions`, () => {
      for (const seed of [7, 42, 1337]) {
        const world = createRegionWorld(id, seed);
        for (const b of LEVELS[id]!.buildings) {
          const spread = padSpread((x, z) => world.terrainHeight(x, z), b);
          const limit = PAD_ALLOW[`${id}:${b.id}`] ?? (b.kind === "tent" ? TENT_PAD_MAX : PAD_MAX);
          expect(spread, `${id}:${b.id} seed ${seed}`).toBeLessThanOrEqual(limit);
        }
      }
    }, 30_000);
  }
});
