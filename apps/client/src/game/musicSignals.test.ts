import { FLAG, NPC } from "@cb/shared";
import { describe, expect, it } from "vitest";
import { MUSIC_TUNING, newMusicState, newSignals, stepMusic } from "../audio/musicLayers.ts";
import { AWARE_RANGE, DEATH_WINDOW, MusicSignaller, SHOT_WINDOW, scenarioStage, type SignalRow, type SignalView } from "./musicSignals.ts";

/** What the music hears: shots from the replicated counter, deaths from bodies going down, hostiles from the cast rows that have a weapon up: all from rows a client already holds. */

const row = (o: Partial<SignalRow> = {}): SignalRow => ({ npc: 0, x: 0, z: 0, flags: FLAG.GROUNDED, health: 100, shots: 0, ...o });
class Rows {
  readonly m = new Map<string, SignalRow>();
  set(id: string, r: SignalRow): void {
    this.m.set(id, r);
  }
  forEach(cb: (r: SignalRow, id: string) => void): void {
    this.m.forEach(cb);
  }
}
const view = (rows: Rows, o: Partial<SignalView> = {}): SignalView => ({ rows, me: "me", x: 0, z: 0, region: "hollowmere", phase: "", parley: false, frozen: false, ...o });
const step = (s: MusicSignaller, rows: Rows, seconds: number, o: Partial<SignalView> = {}, dt = 1 / 10) => {
  const out = newSignals();
  for (let t = 0; t < seconds; t += dt) s.update(dt, view(rows, o), out);
  return out;
};

describe("scenario stage", () => {
  it("maps the scenario's phases onto the music's five stages", () => {
    expect(scenarioStage("")).toBe("idle");
    expect(scenarioStage("approach")).toBe("idle");
    expect(scenarioStage("tension")).toBe("brewing");
    expect(scenarioStage("rigging")).toBe("brewing");
    expect(scenarioStage("standoff")).toBe("standoff");
    expect(scenarioStage("parley")).toBe("standoff");
    expect(scenarioStage("fighting")).toBe("clash");
    expect(scenarioStage("escalated")).toBe("clash");
    expect(scenarioStage("resolved")).toBe("resolved");
  });
});

describe("the signaller", () => {
  it("a quiet field is quiet; the first frame is a baseline (what is already on the field is not a shot)", () => {
    const rows = new Rows();
    rows.set("me", row({ shots: 7 }));
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 10, shots: 200, flags: FLAG.DOWNED, health: 0 }));
    const out = step(new MusicSignaller(), rows, 1);
    expect(out.shotsHeard).toBe(0);
    expect(out.deathsNear).toBe(0);
    expect(out.hostilesAware).toBe(0);
    expect(out.selfDowned).toBe(false);
  });

  it("a shot is the counter moving, heard for four seconds, from any shooter within 60 m and not from further", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    rows.set("me", row());
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 40 }));
    rows.set("npc:far", row({ npc: NPC.SENTRY, x: 100 }));
    step(s, rows, 0.5);
    rows.set("npc:far", row({ npc: NPC.SENTRY, x: 100, shots: 1 }));
    expect(step(s, rows, 0.3).shotsHeard).toBe(0);
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 40, shots: 1 }));
    expect(step(s, rows, 0.2).shotsHeard).toBe(1);
    expect(step(s, rows, SHOT_WINDOW - 1).shotsHeard).toBe(1);
    expect(step(s, rows, 1.5).shotsHeard).toBe(0);
    rows.set("me", row({ shots: 3 })); // my own shot counts wherever I stand
    expect(step(s, rows, 0.2).shotsHeard).toBe(1);
  });

  it("a counter that wraps at 256 is still a shot", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    rows.set("npc:a", row({ npc: NPC.RIVAL_GUARD, x: 5, shots: 255 }));
    step(s, rows, 0.3);
    rows.set("npc:a", row({ npc: NPC.RIVAL_GUARD, x: 5, shots: 0 }));
    expect(step(s, rows, 0.2).shotsHeard).toBe(1);
  });

  it("a death is a body going DOWNED (or its health reaching zero), remembered for twenty seconds", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 20 }));
    rows.set("npc:b", row({ npc: NPC.DESERTER, x: 25 }));
    step(s, rows, 0.5);
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 20, flags: FLAG.DOWNED }));
    expect(step(s, rows, 0.2).deathsNear).toBe(1);
    rows.set("npc:b", row({ npc: NPC.DESERTER, x: 25, health: 0 }));
    expect(step(s, rows, 0.2).deathsNear).toBe(2);
    expect(step(s, rows, DEATH_WINDOW - 1).deathsNear).toBe(2);
    expect(step(s, rows, 2).deathsNear).toBe(0);
  });

  it("hostiles are aware when a weapon is up (or fired lately) and within 50 m, near within 20 m; bystanders, the party and the dead never count", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    rows.set("me", row());
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 15, flags: FLAG.GROUNDED | FLAG.AIMING }));
    rows.set("npc:b", row({ npc: NPC.DESERTER, x: 40, flags: FLAG.AIMING }));
    rows.set("npc:c", row({ npc: NPC.SENTRY, x: AWARE_RANGE + 5, flags: FLAG.AIMING }));
    rows.set("npc:d", row({ npc: NPC.SENTRY, x: 10, flags: FLAG.GROUNDED })); // weapon down: not aware
    rows.set("npc:e", row({ npc: NPC.HERDER, x: 5, flags: FLAG.AIMING })); // a bystander
    rows.set("npc:f", row({ npc: NPC.HIRED_RIFLE, x: 5, flags: FLAG.AIMING })); // our own
    rows.set("npc:g", row({ npc: NPC.SENTRY, x: 6, flags: FLAG.AIMING | FLAG.DOWNED, health: 0 })); // dead
    const out = step(s, rows, 0.5);
    expect(out.hostilesAware).toBe(2);
    expect(out.hostilesNear).toBe(1);
    // d fires: aware for the window after the shot
    rows.set("npc:d", row({ npc: NPC.SENTRY, x: 10, shots: 1 }));
    expect(step(s, rows, 0.3).hostilesAware).toBe(3);
    expect(step(s, rows, SHOT_WINDOW + 1).hostilesAware).toBe(2);
  });

  it("downed party members are counted, the local player's own downing is its own flag", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    rows.set("me", row());
    rows.set("p2", row({ x: 3 }));
    rows.set("npc:f", row({ npc: NPC.HIRED_RIFLE, x: 5 }));
    expect(step(s, rows, 0.3).alliesDowned).toBe(0);
    rows.set("p2", row({ x: 3, flags: FLAG.DOWNED }));
    rows.set("npc:f", row({ npc: NPC.HIRED_RIFLE, x: 5, health: 0, flags: FLAG.DOWNED }));
    const out = step(s, rows, 0.3);
    expect(out.alliesDowned).toBe(2);
    expect(out.selfDowned).toBe(false);
    rows.set("me", row({ flags: FLAG.DOWNED }));
    expect(step(s, rows, 0.3).selfDowned).toBe(true);
  });

  it("passes the region, the parley and the frozen flags through, and the scenario's stage", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    const out = newSignals();
    s.update(0.1, view(rows, { region: "vesper", phase: "escalated", parley: true, frozen: true }), out);
    expect(out.region).toBe("vesper");
    expect(out.scenario).toBe("clash");
    expect(out.parley).toBe(true);
    expect(out.frozen).toBe(true);
  });

  it("rows that leave are forgotten, and reset() makes the next frame a baseline again", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    rows.set("npc:a", row({ npc: NPC.SENTRY, shots: 1 }));
    step(s, rows, 0.3);
    rows.m.clear();
    step(s, rows, 0.3);
    rows.set("npc:a", row({ npc: NPC.SENTRY, shots: 5 })); // a new row with the same id: a baseline, not a shot
    expect(step(s, rows, 0.2).shotsHeard).toBe(0);
    rows.set("npc:a", row({ npc: NPC.SENTRY, shots: 6 }));
    expect(step(s, rows, 0.2).shotsHeard).toBe(1);
    s.reset();
    expect(step(s, rows, 0.2).shotsHeard).toBe(0);
  });

  it("a bad dt does not advance the clock or throw", () => {
    const s = new MusicSignaller();
    const rows = new Rows();
    const out = newSignals();
    expect(() => {
      s.update(NaN, view(rows), out);
      s.update(-1, view(rows), out);
      s.update(0, view(rows), out);
    }).not.toThrow();
  });
});

describe("into the driver: a skirmish plays out as calm, combat, aftermath, calm", () => {
  it("shots and a death take the mood through combat and the aftermath and home again", () => {
    const s = new MusicSignaller();
    const st = newMusicState();
    const rows = new Rows();
    rows.set("me", row());
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 14, flags: FLAG.GROUNDED | FLAG.AIMING }));
    const out = newSignals();
    const run = (seconds: number): void => {
      for (let t = 0; t < seconds; t += 1 / 10) {
        s.update(1 / 10, view(rows), out);
        stepMusic(st, out, 1 / 10);
      }
    };
    run(3);
    expect(["calm", "tension", "combat"]).toContain(st.mood);
    let shots = 0;
    for (let i = 0; i < 6; i++) {
      rows.set("npc:a", row({ npc: NPC.SENTRY, x: 14, flags: FLAG.GROUNDED | FLAG.AIMING, shots: ++shots }));
      run(1);
    }
    expect(st.mood).toBe("combat");
    rows.set("npc:a", row({ npc: NPC.SENTRY, x: 14, flags: FLAG.DOWNED, health: 0, shots }));
    run(MUSIC_TUNING.quietSeconds + MUSIC_TUNING.minCombat);
    expect(st.mood).toBe("aftermath");
    rows.m.delete("npc:a");
    run(DEATH_WINDOW + MUSIC_TUNING.aftermathMin + 5);
    expect(st.mood).toBe("calm");
  });
});
