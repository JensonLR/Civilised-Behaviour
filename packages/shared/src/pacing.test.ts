import { describe, expect, it } from "vitest";
import { INCIDENT, incidentDue } from "./incidents.ts";
import { PACE, PACING, coasting, meterStep, newMeter, newPace, paceStep, pressed, tokensFor } from "./pacing.ts";

/** D-107: the pacing director's model. A member's intensity rises with blows and pressure and drains in the quiet; the run moves BUILD, PEAK, FADE, RELAX on the worst of them. */
const DT = 1 / 30;
const run = (seconds: number, f: () => void): void => {
  for (let t = 0; t < seconds - 1e-9; t += DT) f();
};

describe("D-107: a member's intensity", () => {
  it("a blow adds and restarts the quiet; it drains only after the quiet; one shooter's pressure is outrun by the drain, two are not", () => {
    const m = newMeter();
    meterStep(m, 40, 0, DT);
    expect(m.v).toBe(40);
    run(PACING.quietS - 0.1, () => meterStep(m, 0, 0, DT));
    expect(m.v).toBe(40); // (no drain yet)
    run(1, () => meterStep(m, 0, 0, DT));
    expect(m.v).toBeLessThan(40);
    expect(m.v).toBeGreaterThan(40 - PACING.decayPerS);
    // one man shooting at him: still drains (a long exchange is not a peak forever)
    const one = newMeter();
    meterStep(one, 60, 0, DT);
    run(10, () => meterStep(one, 0, PACING.shotAtPerS * DT, DT));
    expect(one.v).toBeLessThan(60);
    // two: it climbs
    const two = newMeter();
    meterStep(two, 60, 0, DT);
    run(10, () => meterStep(two, 0, 2 * PACING.shotAtPerS * DT, DT));
    expect(two.v).toBeGreaterThan(60);
    // bounded, and nonsense is ignored
    meterStep(two, 1e9, 1e9, DT);
    expect(two.v).toBe(PACING.max);
    meterStep(two, Number.NaN, -5, DT);
    expect(two.v).toBe(PACING.max);
    run(60, () => meterStep(two, 0, 0, DT));
    expect(two.v).toBe(0);
  });
});

describe("D-107: the run's phases", () => {
  it("BUILD -> PEAK at peakAt -> FADE after the sustain -> RELAX once it falls -> BUILD after the breather", () => {
    const s = newPace();
    paceStep(s, PACING.peakAt - 1, DT);
    expect(s.phase).toBe(PACE.BUILD);
    paceStep(s, PACING.peakAt, DT);
    expect(s.phase).toBe(PACE.PEAK);
    expect(pressed(s)).toBe(true);
    run(PACING.sustainS - 0.1, () => paceStep(s, 100, DT));
    expect(s.phase).toBe(PACE.PEAK);
    run(0.2, () => paceStep(s, 100, DT));
    expect(s.phase).toBe(PACE.FADE);
    expect(pressed(s)).toBe(true);
    run(5, () => paceStep(s, 50, DT));
    expect(s.phase).toBe(PACE.FADE);
    paceStep(s, PACING.fadeTo, DT);
    expect(s.phase).toBe(PACE.RELAX);
    expect(pressed(s)).toBe(false);
    run(PACING.relaxS - 0.1, () => paceStep(s, 90, DT)); // (a spike in the breather does not cut it short)
    expect(s.phase).toBe(PACE.RELAX);
    run(0.2, () => paceStep(s, 0, DT));
    expect(s.phase).toBe(PACE.BUILD);
  });

  it("a fight that never lets up still gets its breather: FADE ends after fadeMaxS", () => {
    const s = newPace();
    paceStep(s, 100, DT);
    run(PACING.sustainS + 0.1, () => paceStep(s, 100, DT));
    expect(s.phase).toBe(PACE.FADE);
    run(PACING.fadeMaxS + 0.1, () => paceStep(s, 100, DT));
    expect(s.phase).toBe(PACE.RELAX);
  });

  it("coasting: dullS of BUILD with nobody over dullAt; any stir starts the count again", () => {
    const s = newPace();
    run(PACING.dullS - 1, () => paceStep(s, PACING.dullAt - 1, DT));
    expect(coasting(s)).toBe(false);
    paceStep(s, PACING.dullAt, DT);
    run(PACING.dullS - 1, () => paceStep(s, 0, DT));
    expect(coasting(s)).toBe(false);
    run(1.1, () => paceStep(s, 0, DT));
    expect(coasting(s)).toBe(true);
    paceStep(s, PACING.peakAt, DT);
    expect(coasting(s)).toBe(false);
  });

  it("attack tokens: three at a member coasting through a fight, two when pressed, one when overwhelmed, one for all in FADE and RELAX", () => {
    const s = newPace();
    expect(tokensFor(s, 0)).toBe(PACING.tokens + 1);
    expect(tokensFor(s, PACING.easyBelow)).toBe(PACING.tokens);
    expect(tokensFor(s, PACING.reliefAt)).toBe(1);
    paceStep(s, 100, DT);
    expect(s.phase).toBe(PACE.PEAK);
    expect(tokensFor(s, 0)).toBe(PACING.tokens); // (at the height of it: nobody gets an extra shooter)
    run(PACING.sustainS + 0.1, () => paceStep(s, 100, DT));
    expect(tokensFor(s, 0)).toBe(1);
    paceStep(s, 0, DT);
    expect(s.phase).toBe(PACE.RELAX);
    expect(tokensFor(s, 0)).toBe(1);
  });
});

describe("D-107: the incident's timing", () => {
  it("due after its delay once the party is calm; a coasting party meets it sooner; never at the height of a fight or before the calm", () => {
    const delay = 90;
    const calm = INCIDENT.calmS;
    expect(incidentDue(delay - 1, delay, calm, false, false)).toBe(false);
    expect(incidentDue(delay, delay, calm, false, false)).toBe(true);
    expect(incidentDue(delay, delay, calm - 1, false, false)).toBe(false); // (shots lately)
    expect(incidentDue(delay, delay, calm, false, true)).toBe(false); // (at the peak, or easing off)
    // coasting: from incidentMinS, not before
    expect(PACING.incidentMinS).toBeLessThan(INCIDENT.delayMinS);
    expect(incidentDue(PACING.incidentMinS - 1, delay, calm, true, false)).toBe(false);
    expect(incidentDue(PACING.incidentMinS, delay, calm, true, false)).toBe(true);
    expect(incidentDue(PACING.incidentMinS, delay, calm, true, true)).toBe(false);
    expect(incidentDue(PACING.incidentMinS, delay, Number.NaN, true, false)).toBe(false);
  });
});
