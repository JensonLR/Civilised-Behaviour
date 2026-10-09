import { describe, expect, it } from "vitest";
import { FLAG, PropKind, TEMPLATES, TRIG, VESPER_TRIG, askingToll, newCampaign, npcKey, type CampaignState } from "@cb/shared";
import { Scenario } from "./Scenario.ts";
import { fake, lastView, me, npcKeys, pick, press, put, row, run, setup, type Fake } from "./vesperFake.testkit.ts";

/**
 * "The Triangulation" (D-096, Vesper Gorge's fourth contract: the GDD's survey) through the REAL Scenario runner on a fake host: the theodolite (in its case, a prop of its own kind) spawned on the wharf, the use gate at each
 * station (only with that instrument in your arms), the vigil the runner spawns on the bell, and one commit per ending. The pure reducer has its own tests in packages/shared.
 */

const S = VESPER_TRIG.stations;
const SEED = 424242;   // the fake host's seed
const purse = (): CampaignState => ({ ...newCampaign(11), purse: 400 });
const state0 = (c: CampaignState) => TEMPLATES.triangulation.init(c, askingToll(c), SEED) as unknown as { need: number; vigilAt: number; fileAt: number; price: { names: number; sale: number } };
const start = (c: CampaignState = purse()): { f: Fake; s: Scenario; theodolite: string } => {
  const f = fake(c);
  const s = setup(f, "triangulation", row("p1", S[0]!.x - 6, S[0]!.z, { slot: 0 }), row("p2", S[0]!.x - 7, S[0]!.z, { slot: 1 }));
  run(f, s, 1);
  const theodolite = [...f.props].find(([, p]) => p.kind === PropKind.INSTRUMENT)![0];
  return { f, s, theodolite };
};
/** `id` takes the theodolite up (the room's carry flag) or sets it down. */
const hold = (f: Fake, id: string, on: boolean): void => { const r = me(f, id); r.flags = on ? r.flags | FLAG.CARRYING : r.flags & ~FLAG.CARRYING; };
/** p1, theodolite in arms, takes station k's round: one press per cooldown. */
const observe = (f: Fake, s: Scenario, k: number, theodolite: string, need: number): void => {
  put(f, "p1", S[k]!.x + 1, S[k]!.z);
  for (let i = 0; i < need; i++) {
    expect(press(f, s, "p1", theodolite), `press ${i} at station ${k}`).toBe(true);
    run(f, s, TRIG.coolS + 0.1);
  }
};

describe("The Triangulation through the runner", () => {
  it("starts with the Dirge-Master and the Syndicate's two surveyors, the vigil held back; the theodolite on the wharf; the first station on the strip and the Syndicate on the clock", () => {
    const { f, s, theodolite } = start();
    for (const id of ["dirge", "surveyor-0", "surveyor-1"]) expect(f.players.has(npcKey(id)), id).toBe(true);
    expect(npcKeys(f)).toHaveLength(3);
    expect(f.props.get(theodolite)).toMatchObject({ x: VESPER_TRIG.theodolite.x, z: VESPER_TRIG.theodolite.z });
    expect(f.commits).toEqual([]);
    const v = lastView(f);
    expect(v.template).toBe("triangulation");
    expect(v.objectives[0]!.id).toBe("station0");
    expect(v.timerLabel).toBe("The Syndicate files");
    s.dispose();
    expect(npcKeys(f)).toEqual([]);
  });

  it("a station takes angles only from someone holding the theodolite: empty hands, an ore crate, or another instrument than the contract's, are not taken", () => {
    const { f, s, theodolite } = start();
    put(f, "p1", S[0]!.x + 1, S[0]!.z);
    expect(press(f, s, "p1"), "empty-handed").toBe(false);
    hold(f, "p1", true);
    f.props.set("ore", { kind: PropKind.CRATE, x: 0, z: 0 });
    expect(press(f, s, "p1", "ore"), "a crate, not the theodolite").toBe(false);
    f.props.set("other", { kind: PropKind.INSTRUMENT, x: 0, z: 0 });
    expect(press(f, s, "p1", "other"), "not the contract's theodolite").toBe(false);
    expect(press(f, s, "p1", theodolite)).toBe(true);
    expect(lastView(f).objectives[0]!.text).toMatch(/\(1\//);
    expect(f.consumed, "the instrument is not used up").toEqual([]);
    expect(press(f, s, "p1", theodolite), "a press too soon is still taken: the instrument stays in your arms").toBe(true);
  });

  it("a booked station takes no more: the press falls through to the room (which sets the instrument down)", () => {
    const c = purse();
    const { f, s, theodolite } = start(c);
    hold(f, "p1", true);
    observe(f, s, 0, theodolite, state0(c).need);
    expect(lastView(f).objectives[0]!.done).toBe(true);
    run(f, s, 2);
    expect(press(f, s, "p1", theodolite)).toBe(false);
  });

  it("trig_guild: three rounds close the triangle; the Dirge-Master enters the Guild's names for his fee; one commit at Vesper", () => {
    const c = purse();
    const { f, s, theodolite } = start(c);
    hold(f, "p1", true);
    for (const k of [1, 0, 2]) observe(f, s, k, theodolite, state0(c).need);
    expect(lastView(f).objectives.slice(0, 3).every((o) => o.done)).toBe(true);
    hold(f, "p1", false);
    pick(f, s, "dirge", /Guild's names/);
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]).toMatchObject({ scenario: "triangulation", resolution: "trig_guild", region: "vesper", paid: state0(c).price.names, brokePromise: false });
    run(f, s, 10);
    expect(f.commits).toHaveLength(1);
  });

  it("the vigil: the bell spawns the mourners and sends them to the west bench; measuring there during it is remembered, and the Guild then sells no names", () => {
    const c = purse();
    const { f, s, theodolite } = start(c);
    run(f, s, state0(c).vigilAt + 1);
    expect(npcKeys(f).filter((k) => k.startsWith("npc:vigil-")).length).toBeGreaterThan(0);
    expect(f.cast.groupOrders("late:vigil")).toContain("guard");
    hold(f, "p1", true);
    for (const k of [1, 0, 2]) observe(f, s, k, theodolite, state0(c).need);
    expect(lastView(f).hint).toMatch(/measure its vigil/);
    hold(f, "p1", false);
    pick(f, s, "dirge", /Guild's names/);
    expect(f.commits, "refused").toEqual([]);
    pick(f, s, "dirge", /Committee's names/);
    expect(f.commits[0]).toMatchObject({ resolution: "trig_committee", brokePromise: true });
  });

  it("trig_sold: the closed triangle to the railway surveyor, who pays; trig_outsurveyed: the Syndicate files on its clock", () => {
    const c = purse();
    const a = start(c);
    hold(a.f, "p1", true);
    for (const k of [1, 0, 2]) observe(a.f, a.s, k, a.theodolite, state0(c).need);
    hold(a.f, "p1", false);
    pick(a.f, a.s, "surveyor-0", /Sell him/);
    expect(a.f.commits[0]).toMatchObject({ resolution: "trig_sold", loot: state0(c).price.sale });
    const b = start(c);
    run(b.f, b.s, state0(c).fileAt + 2, 1);
    expect(b.f.commits.map((x) => x.resolution)).toEqual(["trig_outsurveyed"]);
  });

  it("a shot near the surveyors sends them running and stops their clock (a broken promise); a shot at the Dirge-Master closes the Guild", () => {
    const c = purse();
    const { f, s } = start(c);
    s.onShotAt("p1", npcKey("surveyor-1"));
    expect(f.cast.groupOrders("surveyors")).toContain("flee");
    run(f, s, state0(c).fileAt + 2, 1);
    expect(f.commits).toEqual([]);
    expect(lastView(f).objectives.some((o) => o.id === "sell")).toBe(false);
    s.onShotAt("p1", npcKey("dirge"));
    put(f, "p1", f.players.get(npcKey("dirge"))!.x + 0.8, f.players.get(npcKey("dirge"))!.z);
    press(f, s, "p1");
    expect(f.sent.some((m) => m.type === "parley" && m.msg.view)).toBe(false);
  });
});
