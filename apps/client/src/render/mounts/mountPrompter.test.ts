import { describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { MOUNT_FLAG, MOUNT_KIND, WAGON } from "@cb/shared";
import { MOUNT_PROMPTS, MountPrompter, mountPrompt, type PromptState } from "./mountPrompt.ts";
import type { MountRowLike } from "./MountView.ts";

// Maps stand in for the schema's MapSchema (same `forEach(value, key)` and `size`)
type Mount = MountRowLike;
const mount = (over: Partial<MountRowLike>): Mount => ({ kind: MOUNT_KIND.horse, x: 0, y: 0, z: 0, facing: 0, speed: 0, rider: "", hitch: "", coat: 3, phase: 0, hp: 100, cargo: 0, ...over });
interface World {
  state: PromptState;
  mounts: Map<string, Mount>;
  props: Map<string, { holder: string }>;
  players: Map<string, { dragger: string }>;
}
const world = (): World => {
  const mounts = new Map<string, Mount>();
  const props = new Map<string, { holder: string }>();
  const players = new Map<string, { dragger: string }>();
  return { state: { mounts, props, players } as unknown as PromptState, mounts, props, players };
};
const prop = (holder: string): { holder: string } => ({ holder });
const body = (dragger: string): { dragger: string } => ({ dragger });

describe("MountPrompter (the per-frame caller of the mount prompt)", () => {
  it("says exactly what mountPrompt says, for the cases the server decides", () => {
    const w = world();
    w.mounts.set("h1", mount({ x: 1.5 }));
    w.mounts.set("w1", mount({ kind: MOUNT_KIND.wagon, x: 20, z: 20 }));
    const p = new MountPrompter(w.state, () => "me");
    expect(p.now(0, 0, 0, FLAG.GROUNDED, 0)).toBe(MOUNT_PROMPTS.mount);
    expect(p.now(0, 0, 0, FLAG.GROUNDED | FLAG.CARRYING, 0)).toBeUndefined();
    expect(p.now(0, 0, 0, FLAG.GROUNDED | MOUNT_FLAG.MOUNTED, 0)).toBe(MOUNT_PROMPTS.dismount);
    w.mounts.get("h1")!.rider = "me";
    expect(p.now(0, 0, 0, FLAG.GROUNDED | MOUNT_FLAG.MOUNTED, 0)).toBe(MOUNT_PROMPTS.dismount);
    w.mounts.get("h1")!.hitch = "w1";
    expect(p.now(0, 0, 0, FLAG.GROUNDED | MOUNT_FLAG.MOUNTED, 0)).toBe(MOUNT_PROMPTS.unhitch);
    // the wagon: load a held prop, unload when it has cargo through `holder: wagon:<id>`, the pooled rows follow the herd as it shrinks
    w.mounts.get("h1")!.hitch = "";
    w.mounts.get("h1")!.rider = "";
    w.mounts.delete("h1");
    expect(p.now(20, 19, 0, FLAG.GROUNDED | FLAG.CARRYING, 0)).toBe(MOUNT_PROMPTS.load);
    expect(p.now(20, 19, 0, FLAG.GROUNDED, 0)).toBeUndefined();
    w.props.set("c1", prop("wagon:w1"));
    expect(p.now(20, 19, 0, FLAG.GROUNDED, 0)).toBe(MOUNT_PROMPTS.unload);
    for (let i = 0; i < WAGON.bays.length; i++) {
      w.props.set(`x${i}`, prop("wagon:w1"));
    }
    expect(p.now(20, 19, 0, FLAG.GROUNDED | FLAG.CARRYING, 0)).toBe(MOUNT_PROMPTS.full);
    // a body strapped on is a body, not a prop; the id must match whole ("wagon:w1" is not "wagon:w10")
    w.players.set("bob", body("wagon:w10"));
    w.mounts.delete("w1");
    expect(p.now(20, 19, 0, FLAG.GROUNDED, 0)).toBeUndefined();
    expect(new MountPrompter(world().state, () => "me").now(0, 0, 0, 0, 0)).toBeUndefined(); // no mounts: nothing
    // same answers as the pure function over the same rows
    const rows = [["h", mount({ x: 1 })] as const];
    expect(mountPrompt({ x: 0, z: 0, facing: 0, flags: FLAG.GROUNDED, missing: 0, sessionId: "me", holding: false }, rows, { props: () => 0, bodies: () => 0 })).toBe(MOUNT_PROMPTS.mount);
  });
});
