import { describe, expect, it } from "vitest";
import { FLAG, MINOR_IDS, audiencesAt, newCampaign, newPowers, parsePowers, serializePowers, type CampaignState, type PowersState } from "@cb/shared";
import { Audience, AUDIENCE_GAP_MS, type AudienceHost } from "./Audience.ts";

interface Sent { sid: string; type: string; msg: Record<string, unknown> }
function rig(opts: { here?: boolean; armed?: number } = {}) {
  const c0 = newCampaign(11);
  let c: CampaignState = { ...c0, day: 7, expeditions: 2, purse: 500 };
  let p: PowersState = newPowers(11);
  const rows = new Map<string, { npc: number; connected: boolean; flags: number; weapons: number }>([
    ["a", { npc: 0, connected: true, flags: 0, weapons: opts.armed ?? 1 }],
    ["b", { npc: 0, connected: true, flags: 0, weapons: 1 }],
    ["npc:x", { npc: 3, connected: true, flags: 0, weapons: 1 }],
  ]);
  const sent: Sent[] = [];
  const commits: { c: CampaignState; p: PowersState }[] = [];
  let now = 10_000;
  let here = opts.here ?? true;
  const host: AudienceHost = {
    campaign: () => c, powers: () => p, atMapRoom: () => here,
    send: (sid, type, msg) => sent.push({ sid, type, msg: msg as Record<string, unknown> }),
    commit: (nc, np) => { c = nc; p = np; commits.push({ c: nc, p: np }); },
    players: { forEach: (cb) => rows.forEach((r, id) => cb(r as never, id)), get: (id) => rows.get(id) as never },
    nowMs: () => now, seed: 11,
  };
  return { a: new Audience(host), sent, commits, rows, state: () => ({ c, p }), advance: (ms: number) => { now += ms; }, setHere: (v: boolean) => { here = v; } };
}

describe("Audience (fake host)", () => {
  it("opens for a pending power, walks to the end, commits once and tells its owner", () => {
    const r = rig();
    const power = audiencesAt(r.state().c, r.state().p)[0]!.power;
    r.a.open("a", power);
    expect(r.sent.at(-1)!.type).toBe("parley");
    expect(r.sent.at(-1)!.msg.view).toBeDefined();
    for (let i = 0; i < 6 && r.commits.length === 0; i++) {
      const last = r.sent.at(-1)!.msg.view as { options: { id: string }[] };
      const walk = last.options.findIndex((o) => o.id === "walk_away");
      expect(r.a.onPick("a", walk)).toBe(true);
    }
    expect(r.commits.length).toBe(1);
    expect(r.sent.at(-1)!.msg.closed).toBe(true);
    expect(r.a.has("a")).toBe(false);
    expect(parsePowers(serializePowers(r.state().p))).toBeTruthy();
    // after it is done: a pick is nobody's, and nothing more is committed
    expect(r.a.onPick("a", 0)).toBe(false);
    expect(r.commits.length).toBe(1);
  });

  it("ignores forged powers, a sender away from the map room, downed, NPC and unknown senders, and nothing-pending powers", () => {
    const r = rig();
    for (const bad of ["ward", "rival", "brine ", "", 7, null, undefined, {}, [], "__proto__", "BRINE"]) r.a.open("a", bad);
    r.a.open("ghost", "brine");
    r.a.open("npc:x", "brine");
    r.rows.get("a")!.flags = FLAG.DOWNED;
    r.a.open("a", "brine");
    r.rows.get("a")!.flags = 0;
    expect(r.sent.length).toBe(0);
    const away = rig({ here: false });
    away.a.open("a", "brine");
    expect(away.sent.length).toBe(0);
    const early = rig();
    early.state().c.expeditions = 0;
    const idle = { ...early.state() };
    expect(audiencesAt({ ...idle.c, expeditions: 0 }, idle.p)).toEqual([]);
  });

  it("a double open, a second sender on the same power and a spam of opens are ignored; a pick out of range is ignored", () => {
    const r = rig();
    const pending = audiencesAt(r.state().c, r.state().p);
    const power = pending[0]!.power;
    r.a.open("a", power);
    const n = r.sent.length;
    r.a.open("a", power);
    r.advance(AUDIENCE_GAP_MS + 1);
    r.a.open("a", power);
    r.a.open("b", power);
    expect(r.sent.length).toBe(n);
    for (const bad of [-1, 99, 1.5, NaN, Infinity, "0", null, undefined, {}, [0]]) expect(r.a.onPick("a", bad)).toBe(true);
    expect(r.commits.length).toBe(0);
    expect(r.a.onPick("b", 0)).toBe(false); // not his audience
    expect(r.a.onClose("b")).toBe(false);
    expect(r.a.onClose("a")).toBe(true);
    expect(r.sent.at(-1)!.msg.closed).toBe(true);
    expect(r.commits.length).toBe(0); // leaving is not a refusal
  });

  it("walking away from the table ends it, and a leave drops it", () => {
    const r = rig();
    const power = audiencesAt(r.state().c, r.state().p)[0]!.power;
    r.a.open("a", power);
    r.setHere(false);
    expect(r.a.onPick("a", 0)).toBe(true);
    expect(r.a.has("a")).toBe(false);
    expect(r.commits.length).toBe(0);
    r.setHere(true);
    r.advance(AUDIENCE_GAP_MS + 1);
    r.a.open("a", power);
    expect(r.a.has("a")).toBe(true);
    r.a.onLeave("a");
    expect(r.a.has("a")).toBe(false);
    expect(MINOR_IDS.length).toBe(3);
  });

  it("each way of ending yields a distinct powers record", () => {
    const outs = new Set<string>();
    for (const pick of ["pay", "walk_away", "bribe"]) {
      const r = rig();
      const power = audiencesAt(r.state().c, r.state().p)[0]!.power;
      r.a.open("a", power);
      for (let i = 0; i < 6 && r.commits.length === 0; i++) {
        const v = r.sent.at(-1)!.msg.view as { options: { id: string }[] };
        let idx = v.options.findIndex((o) => o.id === pick);
        if (idx < 0) idx = v.options.findIndex((o) => o.id === "walk_away");
        r.a.onPick("a", idx);
      }
      outs.add(serializePowers(r.state().p));
    }
    expect(outs.size).toBe(3);
  });
});
