import { describe, expect, it } from "vitest";
import { STALL_MS, smoothRtt } from "./rtt.ts";

describe("the debug overlay's round trip (D-047)", () => {
  it("a pong read after a main-thread stall is not a round trip: dropped, so the first real sample seeds the average", () => {
    let r = 0;
    r = smoothRtt(r, 29_403);   // (measured: the first pong of a session on software GL)
    expect(r).toBe(0);
    r = smoothRtt(r, 10);
    expect(r).toBe(10);
    r = smoothRtt(r, 20);
    expect(r).toBeCloseTo(12, 6);
  });
  it("garbage changes nothing; a slow but plausible network still counts", () => {
    for (const bad of [Number.NaN, -5, Infinity, STALL_MS + 1]) expect(smoothRtt(40, bad)).toBe(40);
    expect(smoothRtt(40, 900)).toBeCloseTo(212, 6);
  });
});
