import { describe, expect, it } from "vitest";
import { findStation } from "./regions.ts";
import { bytesPerCall } from "./bytesPerCall.testutil.ts";

/**
 * `findStation` runs on every prompt check and allocates nothing. Measured HERE, in a file of its own, with the shared meter (the median of many small windows from a forced GC): it was
 * the heap's growth over 400,000 calls in regions.test.ts with no forced collection, which a loaded parallel run pushed over its 8 MB line (the young generation grows under load and
 * the engine optimises later, so the same call read 0 alone and 20 B in a full run).
 */
describe("findStation allocation", () => {
  it("a station lookup costs no more than a few bytes (an object per call would read 16 B or more)", () => {
    let hits = 0;
    const b = bytesPerCall((i) => {
      if (findStation("hollowmere", -2.4, -5.4 + (i % 3) * 0.1, (i % 7) * 0.1)) hits++;
    });
    expect(hits).toBeGreaterThan(0);
    expect(b).toBeLessThanOrEqual(8); // (304 B before: Math.hypot per station; the meter reads 0.1 B on an empty call)
  });
});
