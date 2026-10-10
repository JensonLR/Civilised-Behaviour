import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { FLAG, PACE, PACING, type PlayerStateType } from "@cb/shared";
import { Pacing, type PacingHost } from "./Pacing.ts";

/** D-107: the pacing director on the server. It sleeps outside a run, reads the party's rows, eases the fire when somebody is hard pressed or down, and sends the roused enemy looking for a party gone quiet. */

const row = (x: number, z: number, over: Partial<PlayerStateType> = {}): PlayerStateType =>
  ({ x, y: 0, z, vx: 0, vz: 0, facing: 0, flags: FLAG.GROUNDED, health: 100, connected: true, npc: 0, ...over }) as PlayerStateType;

function rig() {
  const rows = new Map<string, PlayerStateType>();
  const shooters = new Map<string, number>();
  const hunts: { x: number; z: number; n: number; range: number }[] = [];
  let willSend = 2;
  const host: PacingHost = {
    party: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    shootersOn: (sid) => shooters.get(sid) ?? 0,
    hunt: (x, z, n, range) => {
      hunts.push({ x, z, n, range });
      return willSend;
    },
    seed: 7,
  };
  const p = new Pacing(host);
  const run = (seconds: number, live = true, dt = 1 / 30): void => {
    for (let t = 0; t < seconds - 1e-9; t += dt) p.tick(dt, live);
  };
  return { rows, shooters, hunts, p, run, send: (n: number) => (willSend = n) };
}

describe("D-107: the pacing director on the server", () => {
  it("asleep outside a run: no opinion on tokens, never in the way of an incident, no hunts however quiet", () => {
    const { rows, hunts, p, run } = rig();
    rows.set("ada", row(0, 0));
    run(PACING.dullS + 10, false);
    expect(p.awake).toBe(false);
    expect(p.tokens("ada")).toBeUndefined();
    expect(p.calm).toBe(true);
    expect(p.coasting).toBe(false);
    expect(hunts).toHaveLength(0);
  });

  it("a member badly hurt sends the run to its peak; the fire on him eases at once, and on everybody once it fades; it builds again after the breather", () => {
    const { rows, p, run } = rig();
    const ada = row(0, 0);
    rows.set("ada", ada);
    rows.set("bram", row(10, 0));
    run(1);
    expect(p.tokens("ada")).toBe(PACING.tokens + 1); // (nobody pressed: a coasting party draws an extra shooter)
    ada.health = 40; // (60 lost in one blow)
    run(1 / 30);
    expect(p.state.phase).toBe(PACE.PEAK);
    expect(p.tokens("ada")).toBe(1); // (overwhelmed: one shooter at most)
    expect(p.tokens("bram")).toBe(PACING.tokens); // (at the height of it, his ordinary two)
    expect(p.calm).toBe(false); // (no incident now)
    run(PACING.sustainS + 0.1);
    expect(p.state.phase).toBe(PACE.FADE);
    expect(p.tokens("bram")).toBe(1);
    run(PACING.fadeMaxS + 1);
    expect(p.state.phase).toBe(PACE.RELAX);
    expect(p.calm).toBe(true);
    run(PACING.relaxS + 0.1);
    expect(p.state.phase).toBe(PACE.BUILD);
    expect(p.stats.peaks).toBe(1);
  });

  it("a member down holds the run eased (one shooter each) until he is up again; a firing line on a member keeps him from coasting", () => {
    const { rows, shooters, p, run } = rig();
    const ada = row(0, 0);
    rows.set("ada", ada);
    rows.set("bram", row(10, 0));
    ada.flags |= FLAG.DOWNED;
    ada.health = 0;
    run(PACING.sustainS + PACING.fadeMaxS + 1);
    expect(p.intensity("ada")).toBe(PACING.max);
    expect(p.tokens("bram")).toBe(1);
    // revived: the run drains, breathes and builds again
    ada.flags &= ~FLAG.DOWNED;
    ada.health = 30;
    run(PACING.relaxS + 15);
    expect(p.state.phase).toBe(PACE.BUILD);
    // three men on bram for a while: he is pressed, not coasting (the drain outruns one, two barely)
    shooters.set("bram", 3);
    run(4);
    expect(p.intensity("bram")).toBeGreaterThan(PACING.dullAt);
    expect(p.coasting).toBe(false);
  });

  it("a blast close by counts though it hurts nobody; one far off does not", () => {
    const { rows, p, run } = rig();
    rows.set("ada", row(0, 0));
    rows.set("bram", row(40, 0));
    run(1);
    p.blast(3, 0, 5);
    run(1 / 30);
    expect(p.intensity("ada")).toBeCloseTo(PACING.blast, 5);
    expect(p.intensity("bram")).toBe(0);
  });

  it("a party gone quiet in a run is looked for: every huntEveryS a search near a member on his feet, in turn; a stir stops it", () => {
    const { rows, hunts, p, run } = rig();
    rows.set("ada", row(0, 0));
    rows.set("bram", row(30, 0));
    rows.set("cass", row(-30, 0, { flags: FLAG.GROUNDED | FLAG.DOWNED, health: 0 }));
    run(PACING.dullS + 5);
    expect(hunts).toHaveLength(0); // (a member down is no quiet: the run is eased, not coasting)
    // she is carried home (gone from the game): neither counted nor looked for; the rest breathe, then coast
    rows.get("cass")!.connected = false;
    run(PACING.relaxS + PACING.sustainS + PACING.fadeMaxS + PACING.dullS + 1);
    expect(p.coasting).toBe(true);
    const first = hunts.length;
    expect(first).toBeGreaterThan(0);
    run(PACING.huntEveryS * 2);
    expect(hunts.length).toBe(first + 2);
    for (const h of hunts) {
      expect(h.n).toBe(PACING.huntMax);
      expect(h.range).toBe(PACING.huntRange);
      const nearAda = Math.hypot(h.x, h.z) <= PACING.huntScatter + 1e-6;
      const nearBram = Math.hypot(h.x - 30, h.z) <= PACING.huntScatter + 1e-6;
      expect(nearAda || nearBram).toBe(true);
    }
    expect(hunts.some((h) => Math.hypot(h.x, h.z) <= PACING.huntScatter)).toBe(true);
    expect(hunts.some((h) => Math.hypot(h.x - 30, h.z) <= PACING.huntScatter)).toBe(true);
    expect(p.stats.sent).toBe(hunts.length * 2);
    // somebody is hurt: the hunts stop
    rows.get("ada")!.health = 80;
    const n = hunts.length;
    run(PACING.huntEveryS * 2);
    expect(hunts.length).toBe(n);
  });

  it("the director's tick keeps nothing once everybody has a meter (nothing retained across a forced collection)", () => {
    const { rows, shooters, p, run } = rig();
    for (let i = 0; i < 4; i++) rows.set(`p${i}`, row(i * 5, 0));
    shooters.set("p1", 1);
    run(2);
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3000; i++) p.tick(1 / 30, true);
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024);
  });
});
