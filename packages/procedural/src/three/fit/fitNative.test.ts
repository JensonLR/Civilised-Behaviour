import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { clearCharacterCaches } from "../rig.ts";
import { FIT_GROUPS, FitReport, type FitGroup, type Metric } from "./penetration.ts";
import { runCase, sweepCases } from "./run.ts";
import { FIT_SHAPES } from "./shapes.ts";

/**
 * The fit audit for the FICTIONAL PEOPLES' options (D-038: the hats, jackets, neckwear, hip gear, boots, hair and hair ornaments `NATIVE_FROM` marks). They were added after the
 * main ratchet (fit.test.ts) was set, and that table only goes DOWN, so they have a table of their own, measured the day they landed and ratcheted down from there. Same sweep, same
 * shapes, same poses: `sweepCases({ natives: "only" })`.
 *
 *   FIT_SHAPES=6  more shapes per option      FIT_FIELDS=jacket,neckwear  only these fields      FIT_POSES=0  skip the pose-clip check
 */

afterAll(() => clearCharacterCaches());

/** Worst finding in cm and number of findings above tolerance, per group of bones and metric, as of the day the options landed. Slack: 0.3 cm / 3 %. Lower them when a fix lands. */
const RATCHET: Record<FitGroup, Record<Metric, { worstCm: number; count: number }>> = {
  trunk: {
    garmentPenetration: { worstCm: 0, count: 0 },
    accessoryPenetration: { worstCm: 1.6, count: 1 }, // (the herd bell's strap on one body)
    accessorySink: { worstCm: 0, count: 0 },
    floating: { worstCm: 0, count: 0 },
    poseClip: { worstCm: 3.9, count: 19 }, // (the six garments average 2.8 findings each; the ten colonial jackets 8.5)
    poseExtreme: { worstCm: 4.1, count: 21 },
    headPenetration: { worstCm: 0, count: 0 },
  },
  limbs: {
    garmentPenetration: { worstCm: 0, count: 0 },
    accessoryPenetration: { worstCm: 0, count: 0 },
    accessorySink: { worstCm: 0, count: 0 },
    floating: { worstCm: 0, count: 0 },
    poseClip: { worstCm: 3.8, count: 10 },
    poseExtreme: { worstCm: 4.2, count: 14 },
    headPenetration: { worstCm: 0, count: 0 },
  },
  head: {
    garmentPenetration: { worstCm: 0, count: 0 },
    accessoryPenetration: { worstCm: 0, count: 0 },
    accessorySink: { worstCm: 0, count: 0 },
    floating: { worstCm: 0, count: 0 },
    poseClip: { worstCm: 0, count: 0 },
    poseExtreme: { worstCm: 0, count: 0 },
    headPenetration: { worstCm: 0, count: 0 },
  },
};

describe("fit audit: the fictional peoples' options", () => {
  it("sweep stays within the ratchet", () => {
    const report = new FitReport();
    const cases = sweepCases({ natives: "only", extraShapes: Number(process.env.FIT_SHAPES ?? 2), fields: process.env.FIT_FIELDS?.split(",") });
    const poses = process.env.FIT_POSES !== "0";
    for (const c of cases) report.add(runCase(c, poses && FIT_SHAPES.indexOf(c.shape) < 3).findings);
    report.builds = cases.length;
    const all = report.summary();
    const groups = Object.fromEntries(FIT_GROUPS.map((g) => [g, report.summary(25, g)])) as Record<FitGroup, ReturnType<FitReport["summary"]>>;
    const out = resolve(__dirname, "../../../../../test-results/fit-native-report.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ cases: cases.length, ratchet: RATCHET, summary: all, groups }, null, 1));
    const lines = FIT_GROUPS.flatMap((g) => (Object.keys(all) as Metric[]).map((k) => `${g}.${k}: ${groups[g][k].count} above tolerance, worst ${groups[g][k].worstCm} cm (limit ${RATCHET[g][k].worstCm} cm / ${RATCHET[g][k].count})`));
    if (process.env.FIT_VERBOSE) process.stdout.write(`${lines.join("\n")}\n`);
    if (process.env.FIT_FIELDS) return;
    for (const g of FIT_GROUPS) {
      for (const k of Object.keys(all) as Metric[]) {
        const r = RATCHET[g][k];
        expect(groups[g][k].worstCm, `${g}.${k} worst\n${lines.join("\n")}`).toBeLessThanOrEqual(r.worstCm + 0.3);
        expect(groups[g][k].count, `${g}.${k} count\n${lines.join("\n")}`).toBeLessThanOrEqual(Math.ceil(r.count * 1.03) + 1);
      }
    }
  }, 3_000_000);
});
