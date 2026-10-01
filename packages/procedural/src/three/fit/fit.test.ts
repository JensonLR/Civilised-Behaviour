import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateCharacter } from "../../spec.ts";
import { clearCharacterCaches } from "../rig.ts";
import { addedPrims, FIT_GROUPS, FitReport, type FitGroup, judgeFloating, judgePenetration, makeTag, measure, primMetrics, type FitPrim, type Metric } from "./penetration.ts";
import { runCase, sweepCases } from "./run.ts";
import { FIT_SHAPES, plainBase, STUBBY_WIDE } from "./shapes.ts";

/**
 * The fit audit (see docs/_notes/fit.md). `sweep` builds every option of every wearable on a set of body shapes, measures what each option added against the body
 * field (real interpenetration, floating, clipping in the animator's extreme poses) and writes test-results/fit-report.json, ranked. The RATCHET below fails the test
 * when a metric gets worse than it is today; when a fix lands, lower the number (never raise it without saying why).
 *
 *   FIT_SHAPES=6            more shapes per option (default 2 chosen by hash + the two bug-report bodies); a full pass is FIT_SHAPES=40
 *   FIT_FIELDS=pack,belt    only these fields
 *   FIT_POSES=0             skip the pose-clip check (the slow one)
 */

afterAll(() => clearCharacterCaches());

/**
 * Per group of bones (trunk / limbs / head) and metric: worst finding in centimetres and number of findings above tolerance, as of the last fix. Slack: 0.3 cm / 3 %.
 * Each agent lowers its own group's numbers when a fix lands; nobody raises them without saying why.
 */
const RATCHET: Record<FitGroup, Record<Metric, { worstCm: number; count: number }>> = {
  trunk: {
    garmentPenetration: { worstCm: 2.2, count: 1 },
    accessoryPenetration: { worstCm: 2.0, count: 11 },
    accessorySink: { worstCm: 1.3, count: 6 },
    floating: { worstCm: 0, count: 0 },
    poseClip: { worstCm: 5.9, count: 115 }, // (hip gear's resting arm: armClearance.gearOnSide; was 6.0 / 154)
    poseExtreme: { worstCm: 6.8, count: 101 },
    headPenetration: { worstCm: 0, count: 0 },
  },
  limbs: {
    garmentPenetration: { worstCm: 1.6, count: 2 },
    accessoryPenetration: { worstCm: 0, count: 0 },
    accessorySink: { worstCm: 1.2, count: 16 },
    floating: { worstCm: 0, count: 0 },
    poseClip: { worstCm: 8.1, count: 84 },
    poseExtreme: { worstCm: 8.9, count: 116 },
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

describe("fit audit: the auditor itself", () => {
  it("measures a buried strap and a floating piece on a real body", () => {
    const m = measure({ ...plainBase(generateCharacter(3)), jacket: 1 });
    const chest = m.field.torsoSurface(m.field.P.torsoHeight * 0.5, 0, 0, "worn").p;
    const mk = (x: number, y: number, z: number, kind: string): FitPrim => ({
      id: 9999, bone: "torso", kind, triangles: 12, local: new Float32Array([x, y, z, x + 0.01, y, z, x, y + 0.01, z, x, y, z + 0.01]), nrm: new Float32Array(12).fill(0.5),
      fan: new Uint8Array(4), cent: new Float32Array([x, y, z]), min: [x, y, z], max: [x + 0.01, y + 0.01, z + 0.01], key: "t", anchored: false,
    });
    const tag = makeTag("belt", 1, "test");
    // a strap's vertices 6 cm inside the coat
    const buried = mk(chest[0], chest[1], chest[2] + 0.06, "sweep");
    expect(primMetrics(m.field, buried).depthWorn).toBeGreaterThan(0.04);
    expect(judgePenetration(m, [buried], tag).map((f) => f.metric)).toContain("accessoryPenetration");
    // on the surface: clean
    const seated = mk(chest[0], chest[1], chest[2] - 0.011, "sweep");
    expect(judgePenetration(m, [seated], tag)).toHaveLength(0);
    // 20 cm in the air
    const air = mk(chest[0], chest[1], chest[2] - 0.2, "box");
    expect(judgeFloating(m, [air], tag).map((f) => f.metric)).toEqual(["floating"]);
    m.rig.dispose();
  });

  it("addedPrims finds exactly what an option adds", () => {
    const base = { ...plainBase(STUBBY_WIDE), jacket: 2 };
    const a = measure(base);
    const b = measure({ ...base, medals: 3 });
    const added = addedPrims(a.prims, b.prims);
    expect(added.length).toBeGreaterThan(2);
    expect(added.every((p) => p.bone === "torso")).toBe(true);
    expect(addedPrims(a.prims, a.prims)).toHaveLength(0);
    a.rig.dispose();
    b.rig.dispose();
  });
});

describe("fit audit: every option of every wearable on many body shapes", () => {
  it("sweep stays within the ratchet", () => {
    const report = new FitReport();
    const cases = sweepCases({ extraShapes: Number(process.env.FIT_SHAPES ?? 2), fields: process.env.FIT_FIELDS?.split(",") });
    const t0 = Date.now();
    const poses = process.env.FIT_POSES !== "0";
    for (const c of cases) report.add(runCase(c, poses && FIT_SHAPES.indexOf(c.shape) < 3).findings);
    report.builds = cases.length;
    const all = report.summary();
    const groups = Object.fromEntries(FIT_GROUPS.map((g) => [g, report.summary(25, g)])) as Record<FitGroup, ReturnType<FitReport["summary"]>>;
    const out = resolve(__dirname, "../../../../../test-results/fit-report.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ cases: cases.length, seconds: (Date.now() - t0) / 1000, ratchet: RATCHET, summary: all, groups }, null, 1));
    const lines = FIT_GROUPS.flatMap((g) => (Object.keys(all) as Metric[]).filter((k) => groups[g][k].count > 0 || RATCHET[g][k].worstCm < 99).map((k) => `${g}.${k}: ${groups[g][k].count} above tolerance, worst ${groups[g][k].worstCm} cm (limit ${RATCHET[g][k].worstCm} cm / ${RATCHET[g][k].count})`));
    if (process.env.FIT_VERBOSE) process.stdout.write(`${lines.join("\n")}\n`);
    if (process.env.FIT_FIELDS) return; // a partial run only writes the report
    for (const g of FIT_GROUPS) {
      for (const k of Object.keys(all) as Metric[]) {
        const r = RATCHET[g][k];
        expect(groups[g][k].worstCm, `${g}.${k} worst (see test-results/fit-report.json)\n${lines.join("\n")}`).toBeLessThanOrEqual(r.worstCm + 0.3);
        expect(groups[g][k].count, `${g}.${k} count (see test-results/fit-report.json)\n${lines.join("\n")}`).toBeLessThanOrEqual(Math.ceil(r.count * 1.03) + 1);
      }
    }
  }, 3_000_000);
});
