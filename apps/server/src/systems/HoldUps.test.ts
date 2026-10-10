import { describe, expect, it } from "vitest";
import { FLAG, HOLDUP, NPC, WEAPON, weaponToWire, type PlayerStateType } from "@cb/shared";
import { HoldUps } from "./HoldUps.ts";

/** D-113: who is in whose sights, for how long, and the moment a man gives in. */
const row = (x: number, z: number, o: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x, y: 0, z, facing: 0, flags: FLAG.GROUNDED, npc: NPC.SENTRY, weapon: 0, health: 100, ...o }) as PlayerStateType; // (no `roped`: a real NPC row may never have had it set)

function rig(o: { yields?: (k: string) => boolean; wall?: boolean } = {}) {
  const rows = new Map<string, PlayerStateType>();
  const gave: string[] = [];
  const h = new HoldUps({
    players: { forEach: (cb) => rows.forEach((p, k) => cb(p, k)), get: (k) => rows.get(k) },
    clear: () => !o.wall,
    yields: o.yields ?? (() => true),
    surrender: (k, by) => void gave.push(`${k}:${by}`),
  });
  // Ada, aiming a pistol north; a sentry 8 m ahead of her
  rows.set("ada", row(0, 0, { npc: 0, flags: FLAG.GROUNDED | FLAG.AIMING, weapon: weaponToWire(WEAPON.PISTOL) }));
  rows.set("npc:s1", row(0.3, -8));
  const run = (s: number): void => {
    for (let t = 0; t < s; t += 0.05) h.tick(0.05);
  };
  return { rows, gave, h, run };
}

describe("D-113: the hold-up", () => {
  it("a man kept in the sights long enough, whose nerve goes, gives in once, to the one holding the gun", () => {
    const { gave, run, h } = rig();
    run(HOLDUP.coverS - 0.2);
    expect(gave).toEqual([]);
    expect(h.coveredFor("npc:s1")).toBeGreaterThan(0.5);
    run(0.4);
    expect(gave).toEqual(["npc:s1:ada"]);
  });

  it("nothing without a gun raised at him: not aiming, a sabre, out of the cone, past a wall, his nerve holding, a hand of the party, a man already held", () => {
    const cases: [string, (r: ReturnType<typeof rig>) => void][] = [
      ["not aiming", (r) => void (r.rows.get("ada")!.flags = FLAG.GROUNDED)],
      ["a sabre", (r) => void (r.rows.get("ada")!.weapon = weaponToWire(WEAPON.SABRE))],
      ["out of the cone", (r) => void (r.rows.get("npc:s1")!.x = 4)],
      ["a hand", (r) => void (r.rows.get("npc:s1")!.npc = NPC.HIRED_RIFLE)],
      ["already held", (r) => void (r.rows.get("npc:s1")!.roped = HOLDUP.held)],
    ];
    for (const [what, set] of cases) {
      const r = rig();
      set(r);
      r.run(3);
      expect(r.gave, what).toEqual([]);
    }
    const walled = rig({ wall: true });
    walled.run(3);
    expect(walled.gave).toEqual([]);
    const steady = rig({ yields: () => false });
    steady.run(3);
    expect(steady.gave).toEqual([]);
  });

  it("the time starts again when he leaves the sights", () => {
    const { rows, gave, run, h } = rig();
    run(HOLDUP.coverS - 0.3);
    rows.get("npc:s1")!.x = 5; // (he steps out of the line)
    run(0.1);
    expect(h.coveredFor("npc:s1")).toBe(0);
    rows.get("npc:s1")!.x = 0.3;
    run(HOLDUP.coverS - 0.3);
    expect(gave).toEqual([]);
  });
});
