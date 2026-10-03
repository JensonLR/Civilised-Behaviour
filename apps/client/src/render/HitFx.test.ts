import { Scene } from "three";
import { describe, expect, it } from "vitest";
import { HITFX, HitFx } from "./HitFx.ts";

const make = () => new HitFx(new Scene(), () => 0);
const run = (fx: HitFx, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) fx.update(1 / 30);
};

describe("HitFx", () => {
  it("a burst spawns particles that fly and die within two seconds", () => {
    const fx = make();
    fx.burst(0, 1, 0, 1, 0, 0.8, "full");
    const n = fx.liveParticles;
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(22);
    run(fx, 2);
    expect(fx.liveParticles).toBe(0);
  });

  it("D-064: `up` throws the drops higher (a head wound fountains), and they still come down within the same two seconds", () => {
    const top = (up: number): number => {
      const fx = make();
      fx.burst(0, 1, 0, 1, 0, 1, "full", up);
      const ys = (fx as unknown as { py: Float32Array }).py;
      let best = 0;
      for (let t = 0; t < 0.6; t += 1 / 30) {
        fx.update(1 / 30);
        for (const y of ys) best = Math.max(best, y);
      }
      run(fx, 2);
      expect(fx.liveParticles).toBe(0);
      return best;
    };
    expect(top(1)).toBeGreaterThan(top(0) + 0.3);
  });

  it("is hard-capped: hammering it never exceeds the particle or decal pools", () => {
    const fx = make();
    let peakParts = 0;
    let peakDecals = 0;
    for (let i = 0; i < 400; i++) {
      fx.burst(0, 1, 0, 0, 1, 1, "full");
      if (i % 3 === 0) fx.update(1 / 30);
      peakParts = Math.max(peakParts, fx.liveParticles);
      peakDecals = Math.max(peakDecals, fx.liveDecals);
    }
    run(fx, 3);
    peakDecals = Math.max(peakDecals, fx.liveDecals);
    expect(peakParts).toBeLessThanOrEqual(HITFX.maxParticles);
    expect(peakDecals).toBeLessThanOrEqual(HITFX.maxDecals);
    expect(peakDecals).toBeGreaterThan(0);
  });

  it("only full gore leaves stains on the ground; reduced and off leave none", () => {
    const stains = (gore: "full" | "reduced" | "off"): number => {
      const fx = make();
      for (let i = 0; i < 20; i++) fx.burst(0, 1, 0, 1, 0, 1, gore);
      run(fx, 2.5);
      return fx.liveDecals;
    };
    expect(stains("full")).toBeGreaterThan(0);
    expect(stains("reduced")).toBe(0);
    expect(stains("off")).toBe(0);
  });

  it("stains fade away after their lifetime", () => {
    const fx = make();
    for (let i = 0; i < 10; i++) fx.burst(0, 0.3, 0, 1, 0, 1, "full");
    run(fx, 2);
    expect(fx.liveDecals).toBeGreaterThan(0);
    run(fx, HITFX.decalLife + 1);
    expect(fx.liveDecals).toBe(0);
  });

  it("runs on uneven terrain and everything lands", () => {
    const fx = new HitFx(new Scene(), (x) => 0.5 + 0.2 * Math.sin(x));
    fx.burst(0, 2, 0, 1, 0, 1, "full");
    expect(() => run(fx, 3)).not.toThrow();
    expect(fx.liveParticles).toBe(0);
  });

  it("ignores hostile input (NaN positions, zero or negative power)", () => {
    const fx = make();
    fx.burst(NaN, 1, 0, 1, 0, 1, "full");
    fx.burst(0, 1, 0, Infinity, 0, 1, "full");
    fx.burst(0, 1, 0, 1, 0, 0, "full");
    fx.burst(0, 1, 0, 1, 0, -3, "full");
    expect(fx.liveParticles).toBe(0);
  });
});
