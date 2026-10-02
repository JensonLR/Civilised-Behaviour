import { describe, expect, it } from "vitest";
import type { CampaignState, ComplicationId, ResolutionId, ScenarioFx } from "../campaignTypes.ts";
import { NPC, RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { COMPLICATION_HINT } from "../chaos.ts";
import { newCampaign } from "../factions.ts";
import { NEW_TEMPLATE_RESOLUTIONS } from "../regionEndings.ts";
import { Rng } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_SITES } from "../vesper.ts";
import { VESPER_COMPLICATIONS } from "../vesperLedger.ts";
import { CLAIM, claimRaceTemplate, type ClaimState } from "./claimRace.ts";
import { lingerDone } from "./common.ts";
import { peopleForNpc } from "../peoples.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { TEMPLATES } from "./registry.ts";
import type { Fx } from "./types.ts";

const def = claimRaceTemplate;
const cm = (seed = 7): CampaignState => ({ ...newCampaign(seed), purse: 400 });
function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = cm(seed);
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => f === "commit" || (typeof f === "object" && f.k === "commit");

interface Run { s: ClaimState; fx: Fx[]; commits: number }
function drive(events: readonly ScenarioInput[], s0?: ClaimState, c: CampaignState = C, seed = SEED): Run {
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
const near = (party = 1): ScenarioInput => ({ t: "near", at: "ground", party });
const talk = (kind: Extract<ScenarioInput, { t: "talk" }>["kind"], result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind, result, paid });
const peg = (i: number): ScenarioInput => ({ t: "use", target: `peg${i}`, slot: 0 });
const count = (group: "surveyors" | "guards", alive: number, routed: number, down: number, total = group === "guards" ? 4 : 2): ScenarioInput => ({ t: "count", group, alive, routed, down, total });
const init0 = def.init(C, 0, SEED);
const FEE = init0.price.fee;
const FIRST = init0.rivalAt;   // the first Syndicate peg
const BROKEN: ScenarioInput[] = [{ t: "hostile", at: "surveyors" }, count("surveyors", 0, 2, 0)];
const FILE = [talk("assayer", "open"), talk("assayer", "paid", FEE)];

const SCRIPTS: Record<"staked" | "jumped" | "partnered" | "outpaced" | "abandoned", () => ScenarioInput[]> = {
  staked: () => [near(), peg(0), peg(1), peg(2), ...FILE],
  jumped: () => [near(), ...ticks(FIRST + 1), ...BROKEN, peg(0), peg(0), peg(1), peg(2), ...FILE],
  partnered: () => [near(), peg(0), peg(1), ...ticks(FIRST + 1), talk("assayer", "open"), talk("assayer", "survey")],
  outpaced: () => [near(), ...ticks(CLAIM.closeS + 2, 2)],
  abandoned: () => [near(), { t: "party_down" }],
};
const ENDINGS = ["staked", "jumped", "partnered", "outpaced", "abandoned"] as const;

describe("The Claim Race: one scripted run per ending on the pure reducer", () => {
  for (const r of ENDINGS) {
    it(`${r}: resolves, commits exactly once, the first resolution wins, and the outcome is Vesper's`, () => {
      const run = drive(SCRIPTS[r]());
      expect(run.s.resolution, r).toBe(r);
      expect(run.s.phase).toBe("resolved");
      expect(run.commits, "commit exactly once").toBe(1);
      expect(def.outcome(run.s)).toMatchObject({ scenario: "claim_race", resolution: r, region: "vesper", bridge: "intact", toll: 0 });
      expect(def.outcome(run.s)!.paid).toBeGreaterThanOrEqual(0);
      const more = drive([{ t: "party_down" }, { t: "hostile", at: "surveyors" }, peg(3), talk("assayer", "open"), talk("assayer", "paid", FEE), ...ticks(RESOLVED_LINGER_S + 5)], run.s);
      expect(more.s.resolution).toBe(r);
      expect(more.commits).toBe(0);
      expect(lingerDone(more.s)).toBe(true);
    });
  }

  it("the endings are at least three distinct end states, and the contract's list is exactly these plus abandoned", () => {
    const states = new Set(ENDINGS.map((r) => JSON.stringify(drive(SCRIPTS[r]()).s.resolution)));
    expect(states.size).toBe(5);
    expect([...NEW_TEMPLATE_RESOLUTIONS.claim_race].sort()).toEqual([...ENDINGS].sort());
    expect(TEMPLATES.claim_race).toBe(def);
  });

  it("the outcomes carry what happened: the fee paid to file, nothing for a shared claim, the shots fired", () => {
    expect(def.outcome(drive(SCRIPTS.staked()).s)!.paid).toBe(FEE);
    expect(def.outcome(drive(SCRIPTS.jumped()).s)!.paid).toBe(FEE);
    expect(def.outcome(drive(SCRIPTS.partnered()).s)!.paid).toBe(0);
    expect(def.outcome(drive(SCRIPTS.outpaced()).s)!.paid).toBe(0);
    const bloody = drive([...SCRIPTS.jumped().slice(0, 1), { t: "tally", add: { rivalKilled: 2, wounded: 3 } }, ...SCRIPTS.jumped().slice(1)]);
    expect(def.outcome(bloody.s)).toMatchObject({ resolution: "jumped", tally: { rivalKilled: 2, wounded: 3 } });
  });
});

describe("The Claim Race: the rules", () => {
  it("the Syndicate pegs the lowest open corner at its hour and then every PEG_EVERY_S, while a surveyor stands, and files 35 s after its third", () => {
    expect(FIRST).toBeGreaterThanOrEqual(CLAIM.pegFirst);
    expect(FIRST).toBeLessThanOrEqual(CLAIM.pegFirst + CLAIM.pegSpread);
    expect(drive([near(), ...ticks(FIRST - 3)]).s.pegs).toEqual([0, 0, 0, 0]);
    const one = drive([near(), ...ticks(FIRST + 1)]);
    expect(one.s.pegs).toEqual([2, 0, 0, 0]);
    expect(one.fx.some((f) => typeof f === "object" && f.k === "say" && /peg/.test(f.text))).toBe(true);
    // it skips the corners the party holds
    expect(drive([near(), peg(0), ...ticks(FIRST + 1)]).s.pegs).toEqual([1, 2, 0, 0]);
    const three = drive([near(), ...ticks(FIRST + 2 * CLAIM.pegEvery + 1)]);
    expect(three.s.pegs).toEqual([2, 2, 2, 0]);
    expect(three.s.rivalFilesAt).toBeGreaterThan(three.s.t);
    expect(drive(ticks(CLAIM.pegFile + 3), three.s).s.resolution).toBe("outpaced");
    // no surveyor standing, no peg
    const gone = drive([near(), count("surveyors", 0, 2, 0), ...ticks(FIRST + 2 * CLAIM.pegEvery + 5)]);
    expect(gone.s.pegs).toEqual([0, 0, 0, 0]);
  });

  it("an open peg is the party's; a peg already held is said so; a Syndicate peg stays until its people are broken or the clerk marks the survey provisional", () => {
    const mine = drive([near(), peg(2), peg(2)]);
    expect(mine.s.pegs[2]).toBe(1);
    expect(mine.fx.filter((f) => typeof f === "object" && f.k === "say")).toHaveLength(2);
    const theirs = drive([near(), ...ticks(FIRST + 1)]);
    const refused = drive([peg(0)], theirs.s);
    expect(refused.s.pegs[0]).toBe(2);
    expect(refused.fx.some((f) => typeof f === "object" && f.k === "say" && /Prior claim/.test(f.text))).toBe(true);
    const driven = drive([...BROKEN, peg(0)], theirs.s);
    expect(driven.s.pegs[0]).toBe(0);
    expect(driven.s.pulled).toBe(1);
    const fraud = drive([talk("assayer", "open"), talk("assayer", "learn"), talk("assayer", "tell"), peg(0)], theirs.s);
    expect(fraud.s.pegs[0]).toBe(0);
    expect(fraud.s.fraud).toBe(true);
    // the clerk marks a survey provisional only to somebody who has asked what the Syndicate filed
    const blind = drive([talk("assayer", "open"), talk("assayer", "tell"), peg(0)], theirs.s);
    expect(blind.s.fraud).toBe(false);
    expect(blind.s.pegs[0]).toBe(2);
  });

  it("filing needs three pegs, none of the Syndicate's inside them (unless the survey is provisional), and the fee; a joint claim needs a peg each and the peace", () => {
    const two = drive([near(), peg(0), peg(1), ...FILE]);
    expect(two.s.resolution, "two pegs are not a claim").toBeUndefined();
    expect(two.s.paid).toBe(0);
    const three = drive([near(), peg(0), peg(1), peg(2), ...ticks(FIRST + 1)]);
    expect(three.s.pegs).toEqual([1, 1, 1, 2]);
    expect(drive(FILE, three.s).s.resolution, "the Syndicate's peg stands").toBeUndefined();
    const withFraud = drive([talk("assayer", "open"), talk("assayer", "learn"), talk("assayer", "tell"), ...FILE], three.s);
    expect(withFraud.s.resolution, "provisional: their peg is decoration").toBe("jumped");
    expect(drive([talk("assayer", "open"), talk("assayer", "paid", 1)], drive([near(), peg(0), peg(1), peg(2)]).s).s.resolution, "a fee far under the price").toBeUndefined();
    const poor = def.init({ ...C, purse: 3 }, 0, SEED);
    expect(drive([near(), peg(0), peg(1), peg(2), ...FILE], poor).s.resolution).toBeUndefined();
    // joint
    expect(drive([near(), peg(0), talk("assayer", "open"), talk("assayer", "survey")]).s.resolution, "joint with whom?").toBeUndefined();
    expect(drive([near(), ...ticks(FIRST + 1), talk("assayer", "open"), talk("assayer", "survey")]).s.resolution, "joint with whom, with what").toBeUndefined();
    expect(drive([near(), peg(1), ...ticks(FIRST + 1), { t: "hostile", at: "guards" }, talk("assayer", "open"), talk("assayer", "survey")]).s.resolution, "after a shot").toBeUndefined();
    expect(drive([near(), peg(1), ...ticks(FIRST + 1), talk("assayer", "open"), talk("assayer", "survey")]).s.resolution).toBe("partnered");
  });

  it("a shot at the Syndicate's people is a declaration: the surveyors flee, the guards alert, the clerk goes on stamping; a broken promise only if a parley was open", () => {
    const shot = drive([near(), { t: "hostile", at: "guards" }]);
    expect(shot.s.hostile).toBe(true);
    expect(shot.s.phase).toBe("fighting");
    expect(shot.s.brokePromise).toBe(false);
    const orders = shot.fx.filter((f): f is Extract<ScenarioFx, { k: "order" }> => typeof f === "object" && f.k === "order");
    expect(orders.map((o) => o.group).sort()).toEqual(["guards", "surveyors"]);
    expect(drive([near(), talk("assayer", "open"), { t: "hostile", at: "surveyors" }]).s.brokePromise).toBe(true);
    // the clerk still files for somebody who has just fired on his neighbours
    const filed = drive([near(), { t: "hostile", at: "surveyors" }, count("surveyors", 0, 2, 0), peg(0), peg(1), peg(2), ...FILE]);
    expect(filed.s.resolution).toBe("staked");
    // and a clerk who is down files for nobody: the House closes on the Syndicate's brochure
    const down = drive([near(), { t: "actor", id: "assayer", state: "down" }, peg(0), peg(1), peg(2), ...FILE, ...ticks(CLAIM.closeS + 2, 2)]);
    expect(down.s.clerkDown).toBe(true);
    expect(down.s.resolution).toBe("outpaced");
    expect(down.s.paid).toBe(0);
  });

  it("an unfiled claim at closing time is the Syndicate's; forged or stale parleys answer nothing", () => {
    const four = drive([near(), peg(0), peg(1), peg(2), peg(3), ...ticks(CLAIM.closeS + 2, 2)]);
    expect(four.s.resolution, "four pegs and no filing").toBe("outpaced");
    expect(drive([talk("assayer", "paid", FEE), talk("assayer", "survey"), talk("assayer", "tell")], drive([near(), peg(0), peg(1), peg(2)]).s).s.resolution).toBeUndefined();
  });

  it("the complications move the Syndicate's clock, nothing else", () => {
    const by: Partial<Record<ComplicationId, ClaimState>> = {};
    for (let seed = 1; seed < 800 && Object.keys(by).length < 3; seed++) {
      const s = def.init(cm(seed), 0, seed);
      by[s.complication] ??= s;
    }
    expect(Object.keys(by).sort()).toEqual(["none", "outriders", "rival_scouts"]);
    expect(by.rival_scouts!.rivalAt).toBeLessThan(CLAIM.pegFirst + CLAIM.pegSpread + CLAIM.scoutsFirst + 1);
    expect(by.outriders!.pegFile).toBe(CLAIM.pegFile + CLAIM.outridersFile);
    expect(by.none!.pegFile).toBe(CLAIM.pegFile);
    for (const c of VESPER_COMPLICATIONS.claim_race) {
      const v = def.view(by[c]!, 1000);
      expect(v.complication).toBe(c);
      expect(v.hint, `${c} is named in the hint`).toMatch(/Syndicate/);
      expect(COMPLICATION_HINT[c].length).toBeGreaterThan(5);
    }
  });
});

describe("The Claim Race: leave, views, roster, observation, determinism", () => {
  it("leave commits only what happened", () => {
    expect(def.leave(init0)).toBeUndefined();
    expect(def.leave(drive([near()]).s), "turning up and leaving is nothing").toBeUndefined();
    expect(def.leave(drive([near(), talk("assayer", "open"), talk("assayer", "close")]).s)).toBeUndefined();
    const table: [string, ScenarioInput[], ResolutionId | undefined][] = [
      ["a peg driven", [peg(0)], "outpaced"],
      ["a shot fired", [{ t: "tally", add: { wounded: 1 } }], "outpaced"],
      ["the guards drawn", [{ t: "hostile", at: "guards" }], "outpaced"],
      ["the clerk asked", [talk("assayer", "open"), talk("assayer", "learn")], "outpaced"],
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

  it("the roster is the pegging ground: seven unique authored rows, the Syndicate's two surveyors at the ground and four guards at the headframe, the clerk at the Assay House", () => {
    const rows = def.roster(C, SEED, init0);
    expect(rows.length).toBeLessThanOrEqual(14);
    expect(rows).toHaveLength(7);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
    expect(def.roster(C, SEED, init0)).toEqual(rows);
    expect(rows.filter((r) => r.role === NPC.RIVAL_SURVEYOR)).toHaveLength(2);
    expect(rows.filter((r) => r.role === NPC.RIVAL_GUARD)).toHaveLength(4);
    expect(rows.find((r) => r.id === "assayer")!.post).toEqual(VESPER_SITES.assayer);
    expect(rows.filter((r) => r.group === "surveyors").map((r) => r.post)).toEqual([...VESPER_SITES.rivalSurveyors]);
    expect(rows.filter((r) => r.group === "guards").map((r) => r.post)).toEqual([...VESPER_SITES.guards]);
    for (const r of rows.filter((q) => q.group !== "assay")) expect(r.side).toBe("rival");
    expect(rows.find((r) => r.id === "assayer")!.side).toBe("ward");
    expect(rows.find((r) => r.role === NPC.RIVAL_GUARD)!.brain).toBe("garrison");
    expect(rows.find((r) => r.role === NPC.RIVAL_SURVEYOR)!.brain).toBe("civil");
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(5);
      expect(r.bravery).toBeLessThanOrEqual(100);
      expect(Math.hypot(r.post.x, r.post.z)).toBeLessThan(150);
    }
  });

  it("every id `observe` names exists: the four pegs are places, the clerk is a person to talk to, the groups exist", () => {
    const rows = def.roster(C, SEED, init0);
    const ids = new Set(rows.map((r) => r.id));
    const groups = new Set(rows.map((r) => r.group));
    for (const u of def.observe.use) {
      expect([u.npc !== undefined, u.at !== undefined, u.mount === true].filter(Boolean).length, u.id).toBe(1);
      if (u.npc !== undefined) expect(ids.has(u.npc), `use ${u.id} -> ${u.npc}`).toBe(true);
      if (u.talk !== undefined) expect(["assayer"]).toContain(u.talk);
    }
    expect(def.observe.use.filter((u) => /^peg[0-3]$/.test(u.id))).toHaveLength(4);
    VESPER_SITES.claimPegs.forEach((p, i) => expect(def.observe.use.find((u) => u.id === `peg${i}`)!.at).toEqual({ x: p.x, z: p.z }));
    expect(new Set(def.observe.use.map((u) => u.id)).size).toBe(def.observe.use.length);
    for (const a of def.observe.actors) expect(ids.has(a.id), `actor ${a.id}`).toBe(true);
    for (const o of def.observe.count) expect(groups.has(o.group), `count ${o.group}`).toBe(true);
    for (const g of def.observe.hostileGroups) expect(groups.has(g), `hostile group ${g}`).toBe(true);
    expect(def.observe.use.every((u) => u.carry === "none")).toBe(true);
    expect(def.observe.near[0]).toMatchObject({ id: "ground", x: VESPER_ANCHORS.pegging.x, z: VESPER_ANCHORS.pegging.z });
  });

  it("the view: unique objective ids, the pegs' patterns for the dressing, a timer that counts the live clock, an ending's hint and a way home", () => {
    const s = drive([near(), peg(0), ...ticks(FIRST + 1)]).s;
    const v = def.view(s, 5000);
    const ids = v.objectives.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(v.objectives.find((o) => o.id === "peg-0")).toMatchObject({ done: true });
    expect(v.objectives.find((o) => o.id === "peg-1")!.text).toMatch(/Syndicate/);
    expect(v.objectives.find((o) => o.id === "peg-1")!.done).toBe(false);
    expect(v.objectives.find((o) => o.id === "peg-3")!.text).not.toMatch(/Syndicate/);
    expect(v.timerLabel.length).toBeGreaterThan(5);
    expect(v.endsAtWorldMs).toBeGreaterThan(5000);
    expect(v.template).toBe("claim_race");
    expect(v.title).toBe("The Claim Race");
    expect(def.view(init0, 0).timerLabel).toBe("The Assay House closes");
    expect(def.view(drive([...ticks(FIRST + 2 * CLAIM.pegEvery + 1)]).s, 0).timerLabel).toBe("The Syndicate files");
    for (const r of ENDINGS) {
      const end = def.view(drive(SCRIPTS[r]()).s, 5000);
      expect(end.resolution).toBe(r);
      expect(end.hint.length).toBeGreaterThan(50);
      expect(end.endsAtWorldMs).toBe(0);
      expect(end.objectives.some((o) => o.id === "home")).toBe(true);
    }
  });

  it("is deterministic: the same ledger and events give the same states and the same fx", () => {
    const a = drive(SCRIPTS.jumped());
    const b = drive(SCRIPTS.jumped());
    expect(b.s).toEqual(a.s);
    expect(b.fx).toEqual(a.fx);
    expect(def.init(C, 0, SEED)).toEqual(def.init(C, 0, SEED));
    expect(new Set([0, 1, 2, 3, 4, 5].map((k) => def.init(C, 0, SEED + k).rivalAt)).size).toBeGreaterThan(1);
  });

  it("the clerk's parley is the engine's: every option maps to a result the reducer understands, and the speaker is in character", () => {
    const ctx = { price: 50, purse: 400, seed: 3, day: 2 };
    const v = openSiteParley("assayer", ctx);
    expect(v.speaker).toMatch(/Clerk/);
    const results = new Set<string>();
    const walk = (view: typeof v, depth: number): void => {
      for (let i = 0; i < view.options.length; i++) {
        const step = answerSiteParley("assayer", ctx, view, i);
        if (step.done) results.add(step.done.result);
        else if (step.view && depth < 3) {
          if (step.emit) results.add(step.emit);
          walk(step.view, depth + 1);
        }
      }
    };
    walk(v, 0);
    for (const r of results) expect(["paid", "survey", "tell", "hostile", "walked", "learn"], `-> ${r}`).toContain(r);
    for (const want of ["paid", "survey", "tell", "learn", "hostile"]) expect(results.has(want), want).toBe(true);
  });

  it("5000 sequences of hostile events: never throws, never a second commit, never an unresolved resolution", () => {
    const rng = new Rng(0x7a30);
    const groups = ["surveyors", "guards", "assay", "ward", "", "late:x", "__proto__"];
    const targets = ["peg0", "peg1", "peg2", "peg3", "peg4", "peg-1", "assayer", "__proto__", "constructor", "wagon"];
    const ids = ["assayer", "surveyor-0", "surveyor-1", "guard-0", "wagon", "x", "__proto__"];
    const kinds = ["assayer", "foreman", "warden", "ransom", "nonsense"];
    const results = ["open", "close", "hostile", "paid", "bargained", "bribed", "ransom", "survey", "learn", "tell", "envelope", "tip", "nonsense"];
    const wild = [Number.NaN, Infinity, -Infinity, -5, 0, 1, 3, 4, 7.5, 99, 1e9, -1e9];
    const pickW = (): number => wild[rng.int(0, wild.length - 1)]!;
    const pick = <T,>(a: readonly T[]): T => a[rng.int(0, a.length - 1)]!;
    for (let run = 0; run < 5000; run++) {
      let s = def.init(cm(1 + (run % 37)), 0, run);
      let commits = 0;
      for (let k = 0, n = rng.int(3, 30); k < n; k++) {
        const e = pick<ScenarioInput>([
          { t: "tick", dt: pick([0.1, 1, 5, 40, 90, pickW()]) }, { t: "weather", rain: pickW() }, { t: "near", at: pick(["ground", "x", "__proto__"]), party: pickW() },
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
        expect(s.pegs).toHaveLength(4);
        for (const p of s.pegs) expect([0, 1, 2]).toContain(p);
        expect(commits, "never a second commit").toBeLessThanOrEqual(1);
        if (s.phase === "resolved") expect(s.resolution).toBeDefined();
        else expect(s.resolution).toBeUndefined();
        if (s.resolution !== undefined) expect(NEW_TEMPLATE_RESOLUTIONS.claim_race).toContain(s.resolution);
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
    const extra = [drive([near(), peg(0), peg(0)]), drive([near(), ...ticks(FIRST + 1), peg(0)]), drive([near(), talk("assayer", "open"), talk("assayer", "paid", FEE)]), drive([near(), peg(0), talk("assayer", "open"), talk("assayer", "survey")]),
      drive([near(), ...ticks(FIRST + 1), talk("assayer", "open"), talk("assayer", "learn"), talk("assayer", "tell"), peg(0)]), drive([near(), ...ticks(FIRST + 1), ...BROKEN, peg(0)]), drive([near(), talk("assayer", "open"), { t: "hostile", at: "surveyors" }]),
      drive([near(), peg(0), peg(1), peg(2), ...ticks(FIRST + 1), ...FILE]), drive([near(), ...ticks(FIRST + 2 * CLAIM.pegEvery + 3)]), drive([near(), peg(1), ...ticks(FIRST + 1), { t: "hostile", at: "guards" }, talk("assayer", "open"), talk("assayer", "survey")])];
    for (const s of extra) for (const f of s.fx) if (typeof f === "object" && f.k === "say") texts.push(f.text);
    for (const t of texts) {
      expect(t).not.toMatch(/\{[a-z]+\}|undefined|NaN|\[object/);
      expect(t).not.toMatch(banned);
    }
    expect(texts.length).toBeGreaterThan(14);
  });
});

describe("the Claim Race's people (D-041)", () => {
  it("the Assay House clerk is one of Vesper's own people, not a Highmark courtier (he borrows the Chamberlain's role)", () => {
    const c = newCampaign(5);
    const def = TEMPLATES.claim_race;
    const clerk = def.roster(c, 7, def.init(c, 0, 7)).find((r) => r.id === "assayer")!;
    expect(clerk.role).toBe(NPC.CHAMBERLAIN);
    expect(clerk.people).toBe("vesperine");
    expect(peopleForNpc(NPC.CHAMBERLAIN, "vesper")).toBe("marchers"); // (which is why the spec must say so)
  });
});
