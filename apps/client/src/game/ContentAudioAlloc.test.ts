import { describe, expect, it } from "vitest";
import { MOUNT_KIND, MOUNT_PHASE, newCampaign, serializeCampaign } from "@cb/shared";
import { bytesPerCall } from "@cb/shared/bytesPerCall";
import { ContentAudio, type ContentView, type MountRowView, type Sfx } from "./ContentAudio.ts";

/**
 * `ContentAudio.update` runs every frame and allocates nothing of its own. Measured HERE, in a file of its own, with the shared meter (`bytesPerCall`: the median of many small windows
 * from a forced GC). It lived in ContentAudio.test.ts after the robustness tests, which feed `update` NaN speeds, broken JSON and odd shapes on purpose; the engine kept that feedback, and
 * the same frame read 5 B in one process and 106 B in another (and the old five 10,000-frame windows read over the 64 KB line in a loaded parallel run). In a fresh module the frame is
 * monomorphic and what is left is the code's own: 2.7 B a frame with three horses galloping (measured in six processes beside a full parallel run: a boxed number on some hoofbeats), never an object per horse per frame.
 */
const horse = (over: Partial<MountRowView>): MountRowView => ({ kind: MOUNT_KIND.horse, x: 10, y: 1, z: -5, speed: 0, rider: "", hitch: "", phase: MOUNT_PHASE.loose, ...over });

describe("ContentAudio allocation", () => {
  it("a frame with three galloping horses, a gun and a sailing costs a few bytes at most (an object per horse per frame would read 48 B or more)", () => {
    const sfx: Sfx = { play: () => undefined, stop: () => undefined };
    const c = new ContentAudio({ sfx });
    const v: ContentView = {
      mounts: new Map(Object.entries({ a: horse({ speed: 10.5, rider: "p" }), b: horse({ speed: 6.4, x: 5 }), c: horse({ speed: 3, x: -5 }) })),
      cannons: new Map([["g", { x: 20, y: 0.5, z: 30, phase: 0 }]]),
      region: "hollowmere", travelPhase: 2, campaign: serializeCampaign({ ...newCampaign(5), day: 1 }), campaignRev: 0, seed: 7, settlementsRev: undefined,
    };
    expect(bytesPerCall(() => c.update(1 / 60, v))).toBeLessThan(16);
  });
});
