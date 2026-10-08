import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { LAMP_SLOTS, lampLight, setLamps, updateLamps } from "./lampLight.ts";

/** The lanterns nearest the lens go to the shader, in view space, burning at the night level (or their own floor, indoors); spare slots burn at 0. */
describe("lamp pools", () => {
  it("picks the nearest lanterns, puts them in view space, and burns them at the night level or their own floor", () => {
    const lamps = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 3, z: 0 }));
    const lit = lamps.map((_, i) => (i === 1 ? 0.7 : 0));
    const night = { value: 0.2 };
    setLamps(lamps, lit, night);
    const cam = new PerspectiveCamera();
    cam.position.set(0, 3, 10); // looking down -z: a lamp at (0, 3, 0) is 10 m straight ahead
    updateLamps(cam);
    const slots = lampLight.uLamps.value;
    const xs = slots.map((s) => Math.round(s.x)).sort((a, b) => a - b);
    expect(xs).toEqual(Array.from({ length: LAMP_SLOTS }, (_, i) => i * 10)); // the eight nearest, nothing farther
    const ahead = slots.find((s) => Math.abs(s.x) < 1e-6)!;
    expect(ahead.z).toBeCloseTo(-10, 6);
    expect(ahead.y).toBeCloseTo(0, 6);
    expect(ahead.w).toBeCloseTo(0.2, 6);
    expect(slots.find((s) => Math.round(s.x) === 10)!.w).toBeCloseTo(0.7, 6); // (a lamp indoors keeps its own floor)
  });

  it("a region with fewer lanterns than slots leaves the rest dark, and none leaves all dark", () => {
    setLamps([{ x: 1, y: 2, z: 3 }], [0], { value: 1 });
    updateLamps(new PerspectiveCamera());
    expect(lampLight.uLamps.value.filter((s) => s.w > 0)).toHaveLength(1);
    setLamps([], [], { value: 1 });
    updateLamps(new PerspectiveCamera());
    expect(lampLight.uLamps.value.every((s) => s.w === 0)).toBe(true);
  });
});
