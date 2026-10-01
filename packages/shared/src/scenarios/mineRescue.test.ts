import { describe, expect, it } from "vitest";
import type { CampaignState, ComplicationId, ResolutionId, ScenarioFx } from "../campaignTypes.ts";
import { NPC, RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { COMPLICATION_HINT } from "../chaos.ts";
import { newCampaign } from "../factions.ts";
import { NEW_TEMPLATE_RESOLUTIONS } from "../regionEndings.ts";
import { Rng } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_SITES, VESPER_STOCK, vesperPlan } from "../vesper.ts";
import { VESPER_COMPLICATIONS } from "../vesperLedger.ts";
import { lingerDone } from "./common.ts";
import { MINE, mineRescueTemplate, type MineState } from "./mineRescue.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { TEMPLATES } from "./registry.ts";
import type { Fx } from "./types.ts";

const def = mineRescueTemplate;
const cm = (seed = 7): CampaignState => ({ ...newCampaign(seed), purse: 400 });
/** A campaign whose dealt complication is "none" (the schedule and the air are then exact). */
function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = cm(seed);
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => f === "commit" || (typeof f === "object" && f.k === "commit");

interface Run { s: MineState; fx: Fx[]; commits: number }
function drive(events: readonly ScenarioInput[], s0?: MineState, c: CampaignState = C, seed = SEED): Run {
  let s = s0 ?? def.init(c, 0, seed);
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx, commits: fx.filter(isCommit).length };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const near = (party = 1): ScenarioInput => ({ t: "near", at: "fall", party });
const talk = (kind: Extract<ScenarioInput, { t: "talk" }>["kind"], result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind, result, paid });
const use = (target: string, slot = 0): ScenarioInput => ({ t: "use", target, slot });
/** One dig press, then long enough for the same slot's next press to count. */
const digs = (n: number): ScenarioInput[] => Array.from({ length: n }, () => [use("dig"), ...ticks(MINE.digCoolS + 0.1)]).flat();
const shore = (n = 3): ScenarioInput[] => Array.from({ length: n }, () => use("timber"));
const init0 = def.init(C, 0, SEED);
const P = init0.price;
const FULL_DIG = digs(Math.ceil(100 / MINE.digPerPress) + 2);

const SCRIPTS: Record<"dug_out" | "blasted_through" | "sealed" | "consecrated" | "abandoned", () => ScenarioInput[]> = {
  dug_out: () => [near(), ...shore(), ...FULL_DIG],
  blasted_through: () => [near(), use("keg"), ...ticks(MINE.fuseS + MINE.settleS + 2)],
  sealed: () => [near(), ...ticks(init0.sealAt + 2)],
  consecrated: () => [near(), talk("dirge_master", "open"), talk("dirge_master", "paid", P.bill)],
  abandoned: () => [near(), { t: "party_down" }],
};
const ENDINGS = ["dug_out", "blasted_through", "sealed", "consecrated", "abandoned"] as const;

describe("The Lower Gallery: one scripted run per ending on the pure reducer", () => {
  for (const r of ENDINGS) {
    it(`${r}: resolves, commits exactly once, the first resolution wins, and the outcome is Vesper's`, () => {
      const run = drive(SCRIPTS[r]());
      expect(run.s.resolution, r).toBe(r);
      expect(run.s.phase).toBe("resolved");
      expect(run.commits, "commit exactly once").toBe(1);
      expect(def.outcome(run.s)).toMatchObject({ scenario: "mine_rescue", resolution: r, region: "vesper", bridge: "intact", toll: 0 });
      expect(def.outcome(run.s)!.paid).toBeGreaterThanOrEqual(0);
      // after the end: nothing changes except the clock, and nothing commits again
      const more = drive([{ t: "party_down" }, { t: "hostile", at: "foreman" }, use("keg"), use("dig"), talk("foreman", "open"), talk("dirge_master", "paid", P.bill), ...ticks(RESOLVED_LINGER_S + 5)], run.s);
      expect(more.s.resolution).toBe(r);
      expect(more.commits).toBe(0);
      expect(lingerDone(more.s)).toBe(true);
    });
  }

  it("the endings are at least three distinct end states, and the contract's list is exactly these plus abandoned", () => {
    const states = new Set(ENDINGS.map((r) => JSON.stringify(drive(SCRIPTS[r]()).s.resolution)));
    expect(states.size).toBeGreaterThanOrEqual(3);
    expect(states.size).toBe(5);
    expect([...NEW_TEMPLATE_RESOLUTIONS.mine_rescue].sort()).toEqual([...ENDINGS].sort());
    expect(TEMPLATES.mine_rescue).toBe(def);
  });

  it("the outcomes carry what happened: the Guild's bill, the casualties, the complication", () => {
    expect(def.outcome(drive(SCRIPTS.consecrated()).s)!.paid).toBe(P.bill);
    expect(def.outcome(drive(SCRIPTS.dug_out()).s)!.paid).toBe(0);
    const bloody = drive([near(), { t: "tally", add: { downed: 4, civiliansHarmed: 4, wounded: 6 } }, use("keg"), ...ticks(12)]);
    expect(def.outcome(bloody.s)).toMatchObject({ resolution: "blasted_through", tally: { downed: 4, civiliansHarmed: 4, wounded: 6 } });
    // the casualties of the blast itself are counted in the settling seconds, before the ending is called
    const settling = drive([near(), use("keg"), ...ticks(MINE.fuseS + 0.5), { t: "tally", add: { civiliansHarmed: 3 } }, ...ticks(MINE.settleS + 1)]);
    expect(def.outcome(settling.s)!.tally.civiliansHarmed).toBe(3);
  });
});

describe("The Lower Gallery: the rules", () => {
  it("the dig is capped by the shoring: 25% with none, 25% more with each set, the whole with three", () => {
    // (the schedule is bought off first, so the Company's seal cannot cut the test short)
    const base = drive([near(), talk("foreman", "open"), talk("foreman", "paid", P.handling), ...digs(30)]);
    expect(base.s.dig).toBe(MINE.digBase);
    expect(base.s.resolution).toBeUndefined();
    expect(base.fx.some((f) => typeof f === "object" && f.k === "say" && /timber/.test(f.text))).toBe(true);
    const one = drive([...shore(1), ...digs(40)], base.s);
    expect(one.s.timber).toBe(1);
    expect(one.s.dig).toBe(50);
    const two = drive([...shore(1), ...digs(40)], one.s);
    expect(two.s.dig).toBe(75);
    const three = drive([...shore(1), ...digs(40)], two.s);
    expect(three.s.resolution).toBe("dug_out");
  });

  it("a press digs at most once per cooldown per player; a second player digs alongside; a spare crate is not taken", () => {
    const a = drive([near(), use("dig", 0), use("dig", 0), use("dig", 0)]);
    expect(a.s.dig).toBe(MINE.digPerPress);
    const b = drive([use("dig", 1)], a.s);
    expect(b.s.dig).toBe(MINE.digPerPress * 2);
    const full = drive([...shore(3)], init0);
    const again = def.reduce(full.s, use("timber"));
    expect(again.s, "no state change: the runner keeps the crate in the player's hands").toBe(full.s);
    expect(again.fx.some((f) => typeof f === "object" && f.k === "say")).toBe(true);
    for (const slot of [-1, 4, 99, Number.NaN]) expect(() => def.reduce(init0, use("dig", slot))).not.toThrow();
  });

  it("the foreman's schedule seals the gallery at its hour; the handling charge pushes it past the air; the air then ends it in the Guild's favour", () => {
    const sealAt = init0.sealAt;
    expect(sealAt).toBeGreaterThanOrEqual(MINE.sealS);
    expect(sealAt).toBeLessThanOrEqual(MINE.sealS + MINE.sealSpread);
    expect(drive([near(), ...ticks(sealAt - 5)]).s.resolution).toBeUndefined();
    expect(drive([near(), ...ticks(sealAt + 1)]).s.resolution).toBe("sealed");
    const bought = drive([near(), talk("foreman", "open"), talk("foreman", "paid", P.handling)]);
    expect(bought.s.bought).toBe(true);
    expect(bought.s.paid).toBe(P.handling);
    const later = drive(ticks(sealAt + 60), bought.s);
    expect(later.s.resolution, "the seal has been bought off").toBeUndefined();
    expect(drive(ticks(init0.airOut + 5), bought.s).s.resolution).toBe("consecrated");
    // the view's clock follows what is live: the seal first, the air once the schedule is bought off
    expect(def.view(init0, 0).timerLabel).toBe("The Company seals the gallery");
    expect(def.view(bought.s, 0).timerLabel).toBe("Air in the gallery");
  });

  it("a Variance Form is stamped after FORM_S and then moves the schedule; the stamp is no use if the seal comes first", () => {
    const filed = drive([near(), talk("foreman", "open"), talk("foreman", "survey")]);
    expect(filed.s.form).toBe("pending");
    expect(drive(ticks(MINE.formS - 5), filed.s).s.form).toBe("pending");
    const stamped = drive(ticks(MINE.formS + 2), filed.s);
    expect(stamped.s.form).toBe("filed");
    expect(stamped.s.sealAt).toBeGreaterThan(init0.sealAt + MINE.formDefer - 3);
    const late = drive([near(), ...ticks(init0.sealAt - 10), talk("foreman", "open"), talk("foreman", "survey"), ...ticks(MINE.formS + 2)]);
    expect(late.s.resolution, "the seal beat the stamp").toBe("sealed");
  });

  it("the Guild's vigil buys air once; its objection stays the seal once, and only if it has been asked what it knows", () => {
    const vigil = drive([near(), talk("dirge_master", "open"), talk("dirge_master", "survey")]);
    expect(vigil.s.airOut).toBe(init0.airOut + MINE.vigilS);
    const twice = drive([talk("dirge_master", "open"), talk("dirge_master", "survey")], vigil.s);
    expect(twice.s.airOut).toBe(vigil.s.airOut);
    const blind = drive([near(), talk("dirge_master", "open"), talk("dirge_master", "tell")]);
    expect(blind.s.sealAt, "it has not been asked").toBe(init0.sealAt);
    const told = drive([near(), talk("dirge_master", "open"), talk("dirge_master", "learn"), talk("dirge_master", "tell")]);
    expect(told.s.sealAt).toBe(init0.sealAt + MINE.objectS);
    const again = drive([talk("dirge_master", "open"), talk("dirge_master", "tell")], told.s);
    expect(again.s.sealAt).toBe(told.s.sealAt);
  });

  it("the keg: a fuse, then the blast (once), then the ending after the settling; whichever of the dig and the powder is finished first wins", () => {
    const set = drive([near(), use("keg")]);
    expect(set.s.keg).toBe("set");
    expect(set.s.phase).toBe("rigging");
    expect(set.fx.some((f) => typeof f === "object" && f.k === "explode")).toBe(false);
    const fired = drive(ticks(MINE.fuseS + 0.5), set.s);
    expect(fired.fx.filter((f) => typeof f === "object" && f.k === "explode")).toHaveLength(1);
    expect(fired.s.resolution).toBeUndefined();
    const more = drive(ticks(30), fired.s);
    expect(more.fx.filter((f) => typeof f === "object" && f.k === "explode")).toHaveLength(0);
    expect(more.s.resolution).toBe("blasted_through");
    expect(drive([use("keg")], set.s).s.blastAt, "a second keg changes nothing").toBe(set.s.blastAt);
    // the hand-dug rescue that finishes inside the fuse is the ending, and the blast never goes off
    const race = drive([near(), ...shore(), ...digs(37), use("keg"), ...digs(5)]);
    expect(race.s.resolution).toBe("dug_out");
    expect(race.fx.some((f) => typeof f === "object" && f.k === "explode")).toBe(false);
  });

  it("a foreman who is dead files no seals; shooting the yard or the choir is a declaration with consequences; the bill cannot be paid with money the party does not have", () => {
    const dead = drive([near(), { t: "actor", id: "foreman", state: "down" }, ...ticks(init0.sealAt + 60)]);
    expect(dead.s.foremanDown).toBe(true);
    expect(dead.s.resolution, "nobody is left to seal it").toBeUndefined();
    const shot = drive([near(), talk("foreman", "open"), { t: "hostile", at: "foreman" }]);
    expect(shot.s.hostile).toBe(true);
    expect(shot.s.brokePromise, "a promise broken mid-parley").toBe(true);
    expect(shot.fx.some((f) => typeof f === "object" && f.k === "order")).toBe(true);
    expect(shot.s.phase).toBe("fighting");
    const poor = drive([near(), talk("dirge_master", "open"), talk("dirge_master", "paid", 9999)], def.init({ ...C, purse: 5 }, 0, SEED));
    expect(poor.s.resolution).toBeUndefined();
    const forged = drive([near(), talk("foreman", "open"), talk("foreman", "paid", 1)]);
    expect(forged.s.bought, "an envelope far under the price is not the price").toBe(false);
    // a parley that was never opened takes no answers
    expect(drive([talk("foreman", "paid", P.handling), talk("dirge_master", "paid", P.bill)]).s.resolution).toBeUndefined();
  });

  it("the complications move the schedule, nothing else", () => {
    const by: Partial<Record<ComplicationId, MineState>> = {};
    for (let seed = 1; seed < 800 && Object.keys(by).length < 3; seed++) {
      const s = def.init(cm(seed), 0, seed);
      by[s.complication] ??= s;
    }
    expect(Object.keys(by).sort()).toEqual(["fog", "none", "rain"]);
    expect(by.rain!.sealAt).toBeLessThan(MINE.sealS + MINE.sealSpread + MINE.rainSeal + 1);
    expect(by.fog!.sealAt).toBeGreaterThanOrEqual(MINE.sealS + MINE.fogSeal);
    expect(by.none!.sealAt).toBeGreaterThanOrEqual(MINE.sealS);
    for (const c of VESPER_COMPLICATIONS.mine_rescue) {
      const s = by[c]!;
      const v = def.view(s, 1000);
      expect(v.complication).toBe(c);
      expect(v.hint, `${c} is named in the hint`).toMatch(/Rain|Fog|rain|fog/);
      expect(v.hint.length).toBeGreaterThan(60);
      expect(COMPLICATION_HINT[c].length).toBeGreaterThan(5);
    }
  });
});

describe("The Lower Gallery: leave, views, roster, observation, determinism", () => {
  it("leave commits only what happened", () => {
    expect(def.leave(init0)).toBeUndefined();
    expect(def.leave(drive([near()]).s), "turning up and leaving is nothing").toBeUndefined();
    expect(def.leave(drive([near(), talk("foreman", "open"), talk("foreman", "close")]).s)).toBeUndefined();
    const table: [string, ScenarioInput[], ResolutionId | undefined][] = [
      ["a crate of timber set", [use("timber")], "sealed"],
      ["a few shovelfuls", [use("dig")], "sealed"],
      ["a form filed", [talk("foreman", "open"), talk("foreman", "survey")], "sealed"],
      ["a shot fired", [{ t: "tally", add: { wounded: 1 } }], "sealed"],
      ["the keg lit", [use("keg")], "blasted_through"],
      ["the schedule bought off", [talk("foreman", "open"), talk("foreman", "paid", P.handling)], "consecrated"],
      ["the vigil begun", [talk("dirge_master", "open"), talk("dirge_master", "survey")], "sealed"],
    ];
    for (const [what, ev, want] of table) {
      const s = drive([near(), ...ev]).s;
      expect(def.leave(s), what).toBe(want);
      const left = drive([{ t: "leave" }], s);
      expect(left.s.resolution, what).toBe(want);
      expect(left.commits).toBe(want ? 1 : 0);
    }
    for (const r of ENDINGS) expect(def.leave(drive(SCRIPTS[r]()).s)).toBe(r);
  });

  it("the roster is the gallery: 14 unique authored rows, eleven miners placed behind the fall, the foreman and the Guild in the open", () => {
    const rows = def.roster(C, SEED, init0);
    expect(rows.length).toBeLessThanOrEqual(14);
    expect(rows).toHaveLength(14);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
    expect(def.roster(C, SEED, init0)).toEqual(rows);
    const by = (role: number): number => rows.filter((r) => r.role === role).length;
    expect(by(NPC.MINER)).toBe(11);
    expect(by(NPC.FOREMAN)).toBe(1);
    expect(by(NPC.MOURNER)).toBeGreaterThanOrEqual(2);
    const f = vesperPlan().fall;
    for (const m of rows.filter((r) => r.role === NPC.MINER)) {
      expect(m.post.z, `${m.id} is behind the fall`).toBeLessThan(f.z - f.hz);
      expect(m.side).toBe("neutral");
      expect(m.brain).toBe("civil");
    }
    expect(rows.find((r) => r.id === "foreman")!.post).toEqual(VESPER_SITES.foreman);
    expect(rows.find((r) => r.id === "dirge-master")!.post).toEqual(VESPER_SITES.dirgeMaster);
    expect(rows.find((r) => r.role === NPC.FOREMAN)!.side).toBe("ward");
    // (with the claim race's seven rows the two casts stay inside NPC_CAP together, though a run only spawns its own)
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(5);
      expect(r.bravery).toBeLessThanOrEqual(100);
      expect(Math.hypot(r.post.x, r.post.z)).toBeLessThan(150);
    }
  });

  it("every id `observe` names exists: uses on a person, actors, groups; the fall, the dig and the keg are places", () => {
    const rows = def.roster(C, SEED, init0);
    const ids = new Set(rows.map((r) => r.id));
    const groups = new Set(rows.map((r) => r.group));
    for (const u of def.observe.use) {
      expect([u.npc !== undefined, u.at !== undefined, u.mount === true].filter(Boolean).length, u.id).toBe(1);
      if (u.npc !== undefined) expect(ids.has(u.npc), `use ${u.id} -> ${u.npc}`).toBe(true);
      if (u.at !== undefined) expect(Number.isFinite(u.at.x + u.at.z)).toBe(true);
      if (u.talk !== undefined) expect(["foreman", "dirge_master"]).toContain(u.talk);
    }
    expect(new Set(def.observe.use.map((u) => u.id)).size).toBe(def.observe.use.length);
    for (const a of def.observe.actors) expect(ids.has(a.id), `actor ${a.id}`).toBe(true);
    for (const o of def.observe.count) expect(groups.has(o.group), `count ${o.group}`).toBe(true);
    for (const g of def.observe.hostileGroups) expect(groups.has(g), `hostile group ${g}`).toBe(true);
    expect(def.observe.use.find((u) => u.id === "timber")).toMatchObject({ carry: "crate", consume: true });
    expect(def.observe.use.find((u) => u.id === "keg")).toMatchObject({ carry: "barrel", consume: true });
    expect(def.observe.use.find((u) => u.id === "dig")).toMatchObject({ carry: "none" });
    expect(def.observe.near.every((n) => Number.isFinite(n.x + n.z + n.r))).toBe(true);
    // the stock the template places: five crates and one barrel, in the Company's yard, by the plan's own coordinates
    expect(def.props!.filter((p) => p.kind === 0)).toHaveLength(5);
    expect(def.props!.filter((p) => p.kind === 1)).toEqual([{ id: "keg", kind: 1, ...VESPER_STOCK.keg }]);
    expect(def.sites!.blast).toEqual(VESPER_STOCK.blast);
    expect(def.sites!.adit).toEqual(VESPER_ANCHORS.adit);
  });

  it("the view: unique objective ids, the dressing's patterns, a timer that counts the live clock, an ending's hint and a way home", () => {
    const s = drive([near(), ...shore(2), ...digs(8)]).s;
    const v = def.view(s, 5000);
    const ids = v.objectives.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(v.objectives.find((o) => o.id === "timber")!.text).toMatch(/\(2 of 3\)/);
    expect(v.objectives.find((o) => o.id === "dig")!.text).toMatch(/\(\d+%\)/);
    expect(v.objectives.find((o) => o.id === "miners")!.text).toMatch(/Eleven miners/);
    expect(v.timerLabel.length).toBeGreaterThan(5);
    expect(v.endsAtWorldMs).toBeGreaterThan(5000);
    expect(v.template).toBe("mine_rescue");
    expect(v.title).toBe("The Lower Gallery");
    for (const r of ENDINGS) {
      const end = def.view(drive(SCRIPTS[r]()).s, 5000);
      expect(end.resolution).toBe(r);
      expect(end.hint.length).toBeGreaterThan(50);
      expect(end.endsAtWorldMs).toBe(0);
      expect(end.objectives.some((o) => o.id === "home")).toBe(true);
    }
    // the miners counted alive follow the world
    const dead = drive([{ t: "count", group: "miners", alive: 6, routed: 0, down: 5, total: 11 }]).s;
    expect(def.view(dead, 0).objectives.find((o) => o.id === "miners")!.text).toMatch(/6 alive/);
  });

  it("is deterministic: the same ledger and events give the same states and the same fx", () => {
    const a = drive(SCRIPTS.dug_out());
    const b = drive(SCRIPTS.dug_out());
    expect(b.s).toEqual(a.s);
    expect(b.fx).toEqual(a.fx);
    expect(def.init(C, 0, SEED)).toEqual(def.init(C, 0, SEED));
    expect(def.init(C, 0, SEED + 1).sealAt === def.init(C, 0, SEED).sealAt && def.init(C, 0, SEED + 2).airOut === def.init(C, 0, SEED).airOut && def.init(C, 0, SEED + 3).sealAt === def.init(C, 0, SEED).sealAt).toBe(false);
  });

  it("the parley scripts the template reads are the engine's: every option the foreman and the Guild offer maps to a result the reducer understands", () => {
    const ctx = { price: 50, purse: 400, seed: 3, day: 2 };
    for (const kind of ["foreman", "dirge_master"] as const) {
      const v = openSiteParley(kind, ctx);
      const results = new Set<string>();
      const walk = (view: typeof v, depth: number): void => {
        for (let i = 0; i < view.options.length; i++) {
          const step = answerSiteParley(kind, ctx, view, i);
          if (step.done) results.add(step.done.result);
          else if (step.view && depth < 3) {
            if (step.emit) results.add(step.emit);
            walk(step.view, depth + 1);
          }
        }
      };
      walk(v, 0);
      for (const r of results) expect(["paid", "survey", "tell", "hostile", "walked", "learn", "close"], `${kind} -> ${r}`).toContain(r);
      expect(results.has("paid"), kind).toBe(true);
      expect(results.has("survey"), kind).toBe(true);
    }
  });

  it("5000 sequences of hostile events: never throws, never a second commit, never an unresolved resolution", () => {
    const rng = new Rng(0x31de);
    const groups = ["foreman", "guild", "miners", "ward", "", "late:x", "__proto__"];
    const targets = ["timber", "keg", "dig", "foreman", "dirge", "fall", "__proto__", "constructor", "wagon"];
    const ids = ["foreman", "dirge-master", "miner-0", "wagon", "x", "__proto__"];
    const kinds = ["foreman", "dirge_master", "warden", "ransom", "assayer", "nonsense"];
    const results = ["open", "close", "hostile", "paid", "bargained", "bribed", "ransom", "survey", "learn", "tell", "envelope", "tip", "nonsense"];
    const wild = [Number.NaN, Infinity, -Infinity, -5, 0, 1, 3, 4, 7.5, 99, 1e9, -1e9];
    const pickW = (): number => wild[rng.int(0, wild.length - 1)]!;
    const pick = <T,>(a: readonly T[]): T => a[rng.int(0, a.length - 1)]!;
    for (let run = 0; run < 5000; run++) {
      let s = def.init(cm(1 + (run % 37)), 0, run);
      let commits = 0;
      for (let k = 0, n = rng.int(3, 30); k < n; k++) {
        const e = pick<ScenarioInput>([
          { t: "tick", dt: pick([0.1, 1, 1.2, 5, 40, pickW()]) }, { t: "weather", rain: pickW() }, { t: "near", at: pick(["fall", "x", "__proto__"]), party: pickW() },
          { t: "count", group: pick(groups), alive: pickW(), routed: pickW(), down: pickW(), total: pickW() }, { t: "hostile", at: pick(groups) }, { t: "party_down" }, { t: "leave" },
          { t: "actor", id: pick(ids), state: pick(["down", "free", "arrived"] as const) }, { t: "use", target: pick(targets), slot: pickW() },
          { t: "talk", kind: pick(kinds) as never, result: pick(results) as never, paid: pickW() }, { t: "tally", add: { wounded: pickW(), downed: pickW(), limbsLost: pickW() } },
          { t: "seen", group: pick(groups) }, { t: "noise", level: pickW() }, { t: "prop", what: "destroyed", at: pick(groups), n: pickW() }, { t: "arrive", party: pickW() },
          { t: "garrison", alive: pickW(), routed: pickW(), total: pickW() }, { t: "parley_open" }, { t: "deal", resolution: "paid", toll: pickW(), paid: pickW() },
        ]);
        expect(() => { const r = def.reduce(s, e); commits += r.fx.filter(isCommit).length; s = r.s; }, JSON.stringify(e)).not.toThrow();
        expect(Number.isFinite(s.t), "clock").toBe(true);
        expect(s.paid, "money paid never exceeds the purse").toBeLessThanOrEqual(s.purse);
        expect(s.spent).toBe(s.paid);
        expect(s.dig).toBeGreaterThanOrEqual(0);
        expect(s.dig).toBeLessThanOrEqual(100);
        expect(s.timber).toBeLessThanOrEqual(MINE.timberNeed);
        expect(commits, "never a second commit").toBeLessThanOrEqual(1);
        if (s.phase === "resolved") expect(s.resolution).toBeDefined();
        else expect(s.resolution).toBeUndefined();
        if (s.resolution !== undefined) expect(NEW_TEMPLATE_RESOLUTIONS.mine_rescue).toContain(s.resolution);
        if (k % 7 === 0) expect(def.view(s, 1000).objectives.length).toBeGreaterThan(1);
      }
      if (s.phase === "resolved") expect(commits).toBe(1);
      expect(def.leave(s) === undefined || typeof def.leave(s) === "string").toBe(true);
    }
  }, 120_000);

  it("the fx it emits are all runner-known shapes; every sentence is authored text (no unfilled placeholder, no real-world term)", () => {
    const known = new Set(["spawn", "order", "war", "say", "open", "explode", "bridge", "commit", "wagon", "parley"]);
    const banned = /\b(london|england|britain|british|france|french|german|spain|rome|india|china|japan|africa|arab|egypt|turk|islam|muslim|christ|jewish|hindu|buddh|america|russia|paris|berlin|cairo|kenya|zulu|maasai|ethiopia)\b/i;
    const texts: string[] = [def.brief];
    for (const r of ENDINGS) {
      const run = drive(SCRIPTS[r]());
      texts.push(def.view(run.s, 1000).hint);
      for (const f of run.fx) {
        if (typeof f === "string") expect(["garrison_alert", "garrison_stand_down", "gate_open", "arm_charge", "rival_advance", "commit"]).toContain(f);
        else {
          expect(known.has((f as ScenarioFx).k), `${r}: ${JSON.stringify(f)}`).toBe(true);
          if (f.k === "say") texts.push(f.text);
        }
      }
    }
    for (const s of [drive([near(), talk("foreman", "open"), talk("foreman", "paid", P.handling)]), drive([near(), talk("foreman", "open"), talk("foreman", "survey")]), drive([near(), talk("dirge_master", "open"), talk("dirge_master", "survey")]),
      drive([near(), talk("dirge_master", "open"), talk("dirge_master", "learn"), talk("dirge_master", "tell")]), drive([near(), talk("foreman", "open"), { t: "hostile", at: "foreman" }]), drive([{ t: "actor", id: "foreman", state: "down" }]), drive([near(), use("timber"), use("dig")])]) {
      for (const f of s.fx) if (typeof f === "object" && f.k === "say") texts.push(f.text);
    }
    for (const t of texts) {
      expect(t).not.toMatch(/\{[a-z]+\}|undefined|NaN|\[object/);
      expect(t).not.toMatch(banned);
    }
    expect(texts.length).toBeGreaterThan(14);
  });
});
