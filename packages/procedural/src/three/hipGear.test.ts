import { afterAll, describe, expect, it } from "vitest";
import { FIELDS } from "../spec.ts";
import { armRestAbduction, gearOnSide } from "./armClearance.ts";
import { computeProportions } from "../proportions.ts";
import { runCase } from "./fit/run.ts";
import { FIT_SHAPES, JACKET_ROTATION, STUBBY_WIDE, TALL_THIN, optionValues, plainBase } from "./fit/shapes.ts";
import { clearCharacterCaches } from "./rig.ts";

afterAll(() => clearCharacterCaches());

const HIP_GEAR = FIELDS.find((f) => f.key === "hipGear")!;

/**
 * Hip gear on a stubby body (BUILD_STATE: "hip gear touches the swinging hand on an extreme stubby body, 6.7 cm"). The animator holds the arm on a gear side out far enough to clear what
 * `gearOnSide` says hangs there (armClearance.ts); `gearOnSide` measures the gear from the widest the body gets over the gear's span, the way gear.ts places it, so a holster on a paunch
 * and a sabre's outward-swinging scabbard are cleared as built.
 */
describe("hip gear clears the swinging hand", () => {
  it("every hip gear on the stubby-wide extreme, in every game pose and over every jacket: the worst poseClip is <= 3.0 cm (was 6.7)", () => {
    const stubby = FIT_SHAPES.find((s) => s.name === "stubbyWide")!;
    let worst = 0;
    let where = "";
    for (const value of optionValues(HIP_GEAR)) {
      for (const jacket of JACKET_ROTATION) {
        const { findings } = runCase({ field: HIP_GEAR, value, shape: stubby, jacket }, true);
        for (const f of findings) {
          if (f.metric !== "poseClip") continue;
          if (f.value * 100 > worst) {
            worst = f.value * 100;
            where = `${f.optionName} ${f.note} jacket ${jacket}`;
          }
        }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(3.0);
  }, 600_000);

  it("the arm that has gear beside it rests further out than the bare body needs, on the side the gear hangs; nothing else changes", () => {
    for (const shape of [STUBBY_WIDE, TALL_THIN]) {
      const bare = plainBase(shape);
      const P = computeProportions(bare);
      for (const value of optionValues(HIP_GEAR)) {
        const spec = { ...bare, hipGear: value };
        const R = gearOnSide(spec, P, "R");
        const L = gearOnSide(spec, P, "L");
        const aR = armRestAbduction(spec, P, 0.08, "R");
        const aL = armRestAbduction(spec, P, 0.08, "L");
        const plain = armRestAbduction(spec, P);
        // a side without gear is the bare body's answer
        if (!R) expect(aR).toBeCloseTo(plain, 6);
        if (!L) expect(aL).toBeCloseTo(plain, 6);
        if (R) expect(aR).toBeGreaterThanOrEqual(plain);
        if (L) expect(aL).toBeGreaterThanOrEqual(plain);
        expect(aR).toBeLessThanOrEqual(1.0);
        expect(aL).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it("a scabbard stands further out at its chape than at its hilt", () => {
    const spec = { ...plainBase(STUBBY_WIDE), hipGear: 5 };
    const g = gearOnSide(spec, computeProportions(spec), "L")!;
    expect(g.extraLow).toBeGreaterThan(g.extra);
  });
});
