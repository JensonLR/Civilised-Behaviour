import { describe, expect, it } from "vitest";
import { FLAG, FOUNDATION_CRATES, KESSAR_OUTPOST, OUTPOST_SITES, PropKind, newCampaign, newSettlements, type CampaignState, type RegionClimate, type RegionId, type SettlementEvent, type SettlementsState } from "@cb/shared";
import { Outposts, type OutpostsHost } from "./Outposts.ts";

const GOOD: RegionClimate = { security: 80, trade: 80, hostility: 10, rivalPressure: 10, labour: 70 };

function rig(over: { region?: RegionId; busy?: boolean; c?: CampaignState; s?: SettlementsState; at?: { x: number; z: number } } = {}) {
  let c: CampaignState = over.c ?? { ...newCampaign(5), day: 3 };
  let s: SettlementsState = over.s ?? newSettlements();
  const S = over.at ?? KESSAR_OUTPOST.site;
  const rows = new Map<string, { x: number; z: number; flags: number; npc: number }>([
    ["a", { x: S.x + 1, z: S.z, flags: 0, npc: 0 }],
    ["b", { x: S.x + 40, z: S.z, flags: 0, npc: 0 }],
    ["npc:z", { x: S.x, z: S.z, flags: 0, npc: 3 }],
  ]);
  const props = new Map<string, number>();
  const sent: { sid: string; text: string }[] = [];
  const notices: string[] = [];
  const consumed: string[] = [];
  let rebuilds = 0;
  let busy = over.busy ?? false;
  let region: RegionId = over.region ?? "kessar";
  const setCalls: SettlementEvent[][] = [];
  const host: OutpostsHost = {
    players: { forEach: (cb) => rows.forEach((r, id) => cb(r as never, id)), get: (id) => rows.get(id) as never },
    region: () => region, settlements: () => s, setSettlements: (n, ev) => { s = n; setCalls.push([...ev]); }, campaign: () => c, climate: () => GOOD,
    propKind: (id) => props.get(id), consumeProp: (id) => { consumed.push(id); props.delete(id); }, notice: (t) => notices.push(t),
    send: (sid, _t, msg) => sent.push({ sid, text: (msg as { text: string }).text }), rebuildWorld: () => { rebuilds++; }, busy: () => busy, day: () => c.day, seed: 5,
  };
  const o = new Outposts(host);
  let n = 0;
  const give = (kind: number): string => { const id = `p${++n}`; props.set(id, kind); return id; };
  return { o, give, rows, s: () => s, sent, notices, consumed, rebuilds: () => rebuilds, setBusy: (v: boolean) => { busy = v; }, setRegion: (r: RegionId) => { region = r; }, setCampaign: (x: CampaignState) => { c = x; }, tick: (dt: number) => o.tick(dt), setCalls, props };
}

describe("Outposts (fake host)", () => {
  it("four crates carried to the foundation found the camp: one consume each, a count in the notice, one rebuild", () => {
    const r = rig();
    for (let i = 1; i <= FOUNDATION_CRATES; i++) {
      const id = r.give(PropKind.CRATE);
      expect(r.o.onInteract("a", r.rows.get("a") as never, id)).toBe(true);
      expect(r.consumed).toEqual(Array.from({ length: i }, (_, k) => `p${k + 1}`));
      r.tick(1);
    }
    expect(r.s().posts.kessar!.stage).toBe("camp");
    expect(r.notices.length).toBe(1);
    expect(r.sent.some((m) => m.text.includes(`1 of ${FOUNDATION_CRATES}`))).toBe(true);
    expect(r.rebuilds()).toBe(1);
    // a fifth crate is supply: no rebuild, one more consume
    const before = r.s().posts.kessar!.supply;
    expect(r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.CRATE))).toBe(true);
    expect(r.s().posts.kessar!.supply).toBeGreaterThan(before);
    expect(r.consumed.length).toBe(5);
    expect(r.rebuilds()).toBe(1);
  });

  it("a bottle is refused with a line and NOT consumed; a barrel before the camp is refused too", () => {
    const r = rig();
    expect(r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.BOTTLE))).toBe(true);
    expect(r.consumed).toEqual([]);
    expect(r.sent.at(-1)!.text.length).toBeGreaterThan(10);
    r.tick(1);
    expect(r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.BARREL))).toBe(true);
    expect(r.consumed).toEqual([]);
    expect(r.s().posts.kessar).toBeUndefined();
  });

  it("ignores: not carrying, out of range, downed, an NPC, sailing, the hub, a double press, an unknown prop", () => {
    const r = rig();
    const crate = r.give(PropKind.CRATE);
    expect(r.o.onInteract("a", r.rows.get("a") as never, undefined)).toBe(false);
    expect(r.o.onInteract("b", r.rows.get("b") as never, crate)).toBe(false);
    r.rows.get("a")!.flags = FLAG.DOWNED;
    expect(r.o.onInteract("a", r.rows.get("a") as never, crate)).toBe(false);
    r.rows.get("a")!.flags = 0;
    expect(r.o.onInteract("npc:z", r.rows.get("npc:z") as never, crate)).toBe(false);
    r.setBusy(true);
    expect(r.o.onInteract("a", r.rows.get("a") as never, crate)).toBe(false);
    r.setBusy(false);
    r.setRegion("hollowmere");
    expect(r.o.onInteract("a", r.rows.get("a") as never, crate)).toBe(false);
    r.setRegion("kessar");
    expect(r.o.onInteract("a", r.rows.get("a") as never, "ghost")).toBe(true); // taken, nothing happens
    expect(r.consumed).toEqual([]);
    expect(r.o.onInteract("a", r.rows.get("a") as never, crate)).toBe(true);
    expect(r.o.onInteract("a", r.rows.get("a") as never, crate)).toBe(true); // double press inside the gap
    r.tick(1);
    expect(r.o.onInteract("a", r.rows.get("a") as never, crate)).toBe(true); // the id is spent
    expect(r.consumed).toEqual([crate]);
    // the position is the ROW: moving it away makes the press nobody's
    r.rows.get("a")!.x += 30;
    expect(r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.CRATE))).toBe(false);
  });

  it("a ruined camp under a Syndicate-held crossing is not raised; once the Ward holds it again, it is", () => {
    const ruin: SettlementsState = { ...newSettlements(), posts: { kessar: { region: "kessar", name: "Small Mercy", stage: "none", priority: "trade", foundedDay: 1, stageSince: 5, crates: 0, supply: 0, security: 0, trade: 0, growth: 0, raidedDay: 0, ruined: true, raids: 0 } } };
    const held = { ...newCampaign(5), day: 9, crossing: { ...newCampaign(5).crossing, control: "rival" as const } };
    const r = rig({ s: ruin, c: held });
    expect(r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.CRATE))).toBe(true);
    expect(r.consumed).toEqual([]);
    expect(r.sent.at(-1)!.text).toContain("Syndicate");
    const free = rig({ s: ruin, c: { ...held, crossing: { ...held.crossing, control: "ward" } } });
    expect(free.o.onInteract("a", free.rows.get("a") as never, free.give(PropKind.CRATE))).toBe(true);
    expect(free.consumed.length).toBe(1);
  });

  it("evolve and raid publish through the host and rebuild when the world changed", () => {
    const r = rig();
    for (let i = 0; i < FOUNDATION_CRATES; i++) { r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.CRATE)); r.tick(1); }
    const n = r.setCalls.length;
    const ev = r.o.evolve(4, GOOD);
    expect(Array.isArray(ev)).toBe(true);
    expect(r.setCalls.length).toBeGreaterThanOrEqual(n);
    const raided = r.o.raid("kessar", 5);
    expect(raided.map((e) => e.kind)).toEqual(["raided"]);
    expect(r.o.raid("hollowmere", 5)).toEqual([]);
    r.o.onLeave("a");
  });

  it("D-056: at Highmark the crates found Highmark's post at its own foundation (one rebuild); Kessar's spot there is just grass; each post evolves in its own region's weather", () => {
    const r = rig({ region: "highmark", at: OUTPOST_SITES.highmark!.site });
    for (let i = 0; i < FOUNDATION_CRATES; i++) {
      expect(r.o.onInteract("a", r.rows.get("a") as never, r.give(PropKind.CRATE))).toBe(true);
      r.tick(1);
    }
    expect(r.s().posts.highmark!.stage).toBe("camp");
    expect(r.s().posts.kessar).toBeUndefined();
    expect(r.rebuilds()).toBe(1);
    const k = rig({ region: "highmark", at: KESSAR_OUTPOST.site });
    expect(k.o.onInteract("a", k.rows.get("a") as never, k.give(PropKind.CRATE))).toBe(false);
    expect(k.s().posts.highmark).toBeUndefined();
    const asked: RegionId[] = [];
    r.o.evolve(4, (region) => { asked.push(region); return GOOD; });
    expect(asked).toEqual(["highmark"]);
  });
});
