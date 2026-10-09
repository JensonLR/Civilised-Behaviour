import { describe, expect, it } from "vitest";
import { bytesPerCall } from "@cb/shared/bytesPerCall";
import { FLAG, MOUNT_FLAG, MOUNT_KIND } from "@cb/shared";
import { MountPrompter, type PromptState } from "./mountPrompt.ts";
import type { MountRowLike } from "./MountView.ts";

/**
 * `MountPrompter.now` runs every frame and allocates nothing once warm (its rows are pooled). Measured HERE, in a file of its own, with the shared meter (`bytesPerCall`: the median of many
 * small windows from a forced GC). It lived in mountPrompter.test.ts and read the raw heap over one 10,000-call window: a loaded full-suite run read 146 KB (over its 64 KB line) on code that
 * passes alone, because whatever else the engine put on the heap inside that one window (the optimising compiler's code, finishing late on a busy machine) counted against it.
 */
const mount = (over: Partial<MountRowLike>): MountRowLike => ({ kind: MOUNT_KIND.horse, x: 0, y: 0, z: 0, facing: 0, speed: 0, rider: "", hitch: "", coat: 3, phase: 0, hp: 100, cargo: 0, ...over });

describe("mount prompt allocation", () => {
  it("a call with a herd, a wagon, cargo and a crowd costs a few bytes at most (an object per call would read 16 B or more)", () => {
    const mounts = new Map<string, MountRowLike>();
    const props = new Map<string, { holder: string }>();
    const players = new Map<string, { dragger: string }>();
    for (let i = 0; i < 4; i++) mounts.set(`h${i}`, mount({ x: 3 + i, z: i }));
    mounts.set("w1", mount({ kind: MOUNT_KIND.wagon, x: 0.5, z: 0.5, cargo: 1 }));
    for (let i = 0; i < 6; i++) props.set(`p${i}`, { holder: i < 2 ? "wagon:w1" : "" });
    for (let i = 0; i < 12; i++) players.set(`n${i}`, { dragger: i === 0 ? "wagon:w1" : "" });
    const p = new MountPrompter({ mounts, props, players } as unknown as PromptState, () => "me");
    const flagsSet = [FLAG.GROUNDED, FLAG.GROUNDED | FLAG.CARRYING, FLAG.GROUNDED | FLAG.DRAGGING, FLAG.GROUNDED | MOUNT_FLAG.MOUNTED];
    let sink = 0;
    expect(bytesPerCall((i) => { sink += p.now(0, 0, 0.3, flagsSet[i & 3]!, 0)?.length ?? 0; })).toBeLessThan(8);
    expect(sink).toBeGreaterThan(0);
  });
});
