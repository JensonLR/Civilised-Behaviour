import { describe, expect, it } from "vitest";
import { ARRIVE_TIMEOUT_S, PROPOSE_TIMEOUT_S, REGION_IDS, type RegionId } from "./campaignTypes.ts";
import { Rng } from "./rng.ts";
import { REGIONS } from "./regions.ts";
import { travelArrived, travelCancel, travelIdle, travelPropose, travelReady, travelReconcile, travelTick, type TravelState, type TravelStep } from "./travel.ts";

const SAIL = REGIONS.kessar.sailSeconds;
const both = 0b11;

describe("travel state machine", () => {
  it("solo: propose sails at once, the clock lands, arrival completes", () => {
    let st = travelPropose(travelIdle(), "hollowmere", "kessar", 0, 0b1);
    expect(st.s).toMatchObject({ phase: 2, to: "kessar", left: SAIL });
    st = travelTick(st.s, SAIL - 1, 0b1);
    expect(st.s.phase).toBe(2);
    st = travelTick(st.s, 1.01, 0b1);
    expect(st).toMatchObject({ fx: "enter_region", s: { phase: 3, left: ARRIVE_TIMEOUT_S } });
    expect(travelArrived(st.s, 0, "kessar", 0b1)).toMatchObject({ fx: "done", s: { phase: 0 } });
  });

  it("two players: proposing opens a vote, the second yes sails, everyone arriving completes", () => {
    let st = travelPropose(travelIdle(), "hollowmere", "kessar", 0, both);
    expect(st.s).toMatchObject({ phase: 1, ready: 0b1, left: PROPOSE_TIMEOUT_S });
    st = travelReady(st.s, 1, true, both);
    expect(st.s.phase).toBe(2);
    st = travelTick(st.s, SAIL + 0.1, both);
    expect(st.fx).toBe("enter_region");
    st = travelArrived(st.s, 1, "kessar", both);
    expect(st.s.phase).toBe(3); // one still building
    st = travelArrived(st.s, 0, "kessar", both);
    expect(st).toMatchObject({ fx: "done", s: { phase: 0 } });
  });

  it("a proposal nobody joins lapses; a cancel ends it; a no vote does not sail", () => {
    let st = travelPropose(travelIdle(), "hollowmere", "kessar", 0, both);
    expect(travelTick(st.s, PROPOSE_TIMEOUT_S - 1, both).s.phase).toBe(1);
    expect(travelTick(st.s, PROPOSE_TIMEOUT_S + 0.1, both)).toMatchObject({ fx: "cancelled", s: { phase: 0 } });
    expect(travelCancel(st.s)).toMatchObject({ fx: "cancelled", s: { phase: 0 } });
    st = travelReady(st.s, 1, false, both);
    expect(st.s.phase).toBe(1);
  });

  it("a leaver completes the vote; everyone leaving cancels it; a leaver cannot block arrival", () => {
    const st = travelPropose(travelIdle(), "hollowmere", "kessar", 0, both);
    expect(travelReconcile(st.s, 0b1).s.phase).toBe(2); // slot 1 left: slot 0's yes is unanimous
    expect(travelReconcile(st.s, 0)).toMatchObject({ fx: "cancelled", s: { phase: 0 } });
    let a = travelReady(st.s, 1, true, both);
    a = travelTick(a.s, SAIL + 0.1, both);
    a = travelArrived(a.s, 0, "kessar", both);
    expect(travelReconcile(a.s, 0b1)).toMatchObject({ fx: "done", s: { phase: 0 } });
  });

  it("the arrival timeout ends a slow client's hold", () => {
    let st = travelReady(travelPropose(travelIdle(), "hollowmere", "kessar", 0, both).s, 1, true, both);
    st = travelTick(st.s, SAIL + 0.1, both);
    expect(travelTick(st.s, ARRIVE_TIMEOUT_S - 1, both).s.phase).toBe(3);
    expect(travelTick(st.s, ARRIVE_TIMEOUT_S + 0.1, both)).toMatchObject({ fx: "done", s: { phase: 0 } });
  });

  it("ignores what it should: double propose, bad or same target, stale or foreign arrival, late vote, ghost slots", () => {
    const open = travelPropose(travelIdle(), "hollowmere", "kessar", 0, both).s;
    expect(travelPropose(open, "hollowmere", "kessar", 1, both).s).toBe(open);
    expect(travelPropose(travelIdle(), "hollowmere", "hollowmere", 0, both).s.phase).toBe(0);
    expect(travelPropose(travelIdle(), "hollowmere", "atlantis", 0, both).s.phase).toBe(0);
    expect(travelPropose(travelIdle(), "hollowmere", 7, 0, both).s.phase).toBe(0);
    expect(travelPropose(travelIdle(), "hollowmere", "kessar", 3, both).s.phase).toBe(0); // (slot 3 is not connected)
    expect(travelPropose(travelIdle(), "hollowmere", "kessar", -1, both).s.phase).toBe(0);
    expect(travelPropose(travelIdle(), "hollowmere", "kessar", 0.5, both).s.phase).toBe(0);
    expect(travelArrived(open, 0, "kessar", both).s).toBe(open); // not arriving yet
    const sailing = travelReady(open, 1, true, both).s;
    expect(travelReady(sailing, 0, false, both).s).toBe(sailing);
    expect(travelCancel(sailing).s).toBe(sailing);
    const arriving = travelTick(sailing, SAIL + 0.1, both).s;
    expect(travelArrived(arriving, 0, "hollowmere", both).s).toBe(arriving); // stale region
    expect(travelArrived(arriving, 0, undefined, both).s).toBe(arriving);
    expect(travelPropose(arriving, "kessar", "hollowmere", 0, both).s).toBe(arriving);
    expect(travelTick(arriving, 0, both).s).toBe(arriving);
    expect(travelTick(arriving, Number.NaN, both).s).toBe(arriving);
  });

  it("no stuck state: 5000 random event sequences always end in phase 0 within 100 s of quiet", () => {
    const rng = new Rng(0x7a4e1);
    const regions: unknown[] = [...REGION_IDS, "nowhere", 4, undefined];
    for (let n = 0; n < 5000; n++) {
      let s: TravelState = travelIdle();
      let current: RegionId = "hollowmere";
      let connected = rng.int(0, 3);
      const apply = (r: TravelStep): void => {
        s = r.s;
        if (r.fx === "enter_region") current = s.to;
      };
      for (let e = 0, events = rng.int(1, 40); e < events; e++) {
        const slot = rng.int(-1, 4);
        switch (rng.int(0, 7)) {
          case 0: apply(travelPropose(s, current, rng.pick(regions), slot, connected)); break;
          case 1: apply(travelReady(s, slot, rng.chance(0.7), connected)); break;
          case 2: apply(travelCancel(s)); break;
          case 3: apply(travelArrived(s, slot, rng.pick(regions), connected)); break;
          case 4: apply(travelTick(s, rng.range(0, 12), connected)); break;
          case 5: connected = rng.int(0, 15); apply(travelReconcile(s, connected)); break;
          default: connected |= 1 << rng.int(0, 3); apply(travelReconcile(s, connected)); break;
        }
      }
      for (let t = 0; t < 100 && s.phase !== 0; t += 0.5) apply(travelTick(s, 0.5, connected));
      expect(s.phase, `sequence ${n}`).toBe(0);
    }
  });
});
