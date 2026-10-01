import { describe, expect, it } from "vitest";
import type { CampaignState, ComplicationId, ResolutionId, ScenarioFx } from "../campaignTypes.ts";
import { NPC, RESOLVED_LINGER_S } from "../campaignTypes.ts";
import { newCampaign } from "../factions.ts";
import { HIGHMARK_RESOLUTIONS, HIGHMARK_SITES } from "../highmark.ts";
import { Rng } from "../rng.ts";
import type { ScenarioInput } from "../scenario.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { lingerDone } from "./common.ts";
import { TEMPLATES } from "./registry.ts";
import { SUCCESSION, successionTemplate, type SuccessionState } from "./succession.ts";
import type { Fx } from "./types.ts";

const def = successionTemplate;
const cm = (seed = 7): CampaignState => newCampaign(seed);
/** A campaign whose dealt complication is "none" (the bell and the grace are then exact). */
function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = cm(seed);
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => f === "commit" || (typeof f === "object" && f.k === "commit");

interface Run { s: SuccessionState; fx: Fx[]; commits: number }
function drive(events: readonly ScenarioInput[], s0?: SuccessionState, c: CampaignState = C, seed = SEED): Run {
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
const near = (at: string, party = 1): ScenarioInput => ({ t: "near", at, party });
const count = (alive: number, routed: number, down: number, total = 4): ScenarioInput => ({ t: "count", group: "guards", alive, routed, down, total });
const talk = (kind: Extract<ScenarioInput, { t: "talk" }>["kind"], result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind, result, paid });
const use = (target: string): ScenarioInput => ({ t: "use", target, slot: 0 });
const init0 = def.init(C, 0, SEED);
const P = init0.price;
const BELL = init0.bell;

// the courses of the five endings, each a script of what the server would observe
const FORM = [near("court", 2), talk("chamberlain", "open"), talk("chamberlain", "survey"), ...ticks(SUCCESSION.formS + 1)];
const GRAIN = [use("grange0"), use("grange1"), use("grange2")];
const SCRIPTS: Record<Exclude<ResolutionId, never>, (() => ScenarioInput[]) | undefined> = {
  backed_elder: () => [...FORM, talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), ...GRAIN, ...ticks(SUCCESSION.fedBellS + 1)],
  backed_younger: () => [...FORM, talk("claimant_younger", "open"), talk("claimant_younger", "paid", P.younger), use("grange0"), use("grange2"), ...ticks(BELL + 1)],
  regency: () => [...FORM, talk("claimant_elder", "open"), talk("claimant_elder", "survey"), talk("claimant_younger", "open"), talk("claimant_younger", "survey"), ...GRAIN, ...ticks(SUCCESSION.fedBellS + 1)],
  usurped: () => [near("court", 2), { t: "hostile", at: "guards" }, count(1, 0, 3), use("throne")],
  crown_sold: () => [near("court", 2), use("envoy"), use("envoy"), talk("chamberlain", "open"), talk("chamberlain", "paid", P.bribe)],
  abandoned: () => [near("court", 2), { t: "party_down" }],
  paid: undefined, bargained: undefined, bribed: undefined, forced: undefined, sabotaged: undefined, rival_secured: undefined, ransomed: undefined, rescued: undefined, slipped_away: undefined,
  hostage_lost: undefined, seized: undefined, tipped_off: undefined, burned: undefined, passed: undefined, mediated: undefined, sided_ward: undefined, sided_syndicate: undefined, provoked: undefined, escalated: undefined,
};
const ENDINGS = [...HIGHMARK_RESOLUTIONS, "abandoned"] as const;

describe("The Vacant Chair: one scripted run per ending on the pure reducer", () => {
  for (const r of ENDINGS) {
    it(`${r}: resolves, commits exactly once, the first resolution wins, and the outcome is Highmark's`, () => {
      const run = drive(SCRIPTS[r]!());
      expect(run.s.resolution, r).toBe(r);
      expect(run.s.phase).toBe("resolved");
      expect(run.commits, "commit exactly once").toBe(1);
      expect(def.outcome(run.s)).toMatchObject({ scenario: "succession_dispute", resolution: r, region: "highmark", bridge: "intact", toll: 0 });
      expect(def.outcome(run.s)!.paid).toBeGreaterThanOrEqual(0);
      // after the end: nothing changes except the clock, and nothing commits again
      const more = drive([{ t: "party_down" }, { t: "hostile", at: "guards" }, use("envoy"), use("throne"), talk("chamberlain", "open"), talk("claimant_elder", "paid", P.elder), ...ticks(RESOLVED_LINGER_S + 5)], run.s);
      expect(more.s.resolution).toBe(r);
      expect(more.commits).toBe(0);
      expect(lingerDone(more.s)).toBe(true);
    });
  }

  it("the outcomes carry what happened: money paid out, a cheque's loot, the casualties", () => {
    expect(def.outcome(drive(SCRIPTS.backed_elder!()).s)!.paid).toBe(P.elder);
    expect(def.outcome(drive(SCRIPTS.backed_younger!()).s)!.paid).toBe(P.younger);
    const sold = def.outcome(drive(SCRIPTS.crown_sold!()).s)!;
    expect(sold.loot).toBe(P.cheque);
    expect(sold.paid).toBe(P.bribe);
    expect(def.outcome(drive([...SCRIPTS.usurped!().slice(0, 2), { t: "tally", add: { downed: 3, garrisonKilled: 3, wounded: 4 } }, count(1, 0, 3), use("throne")]).s)!.tally).toMatchObject({ downed: 3, garrisonKilled: 3, wounded: 4 });
    expect(def.outcome(drive(SCRIPTS.regency!()).s)!.paid).toBe(0);
  });

  it("the endings are at least three distinct end states", () => {
    const states = new Set<string>();
    for (const r of ENDINGS) states.add(JSON.stringify(drive(SCRIPTS[r]!()).s.resolution));
    expect(states.size).toBeGreaterThanOrEqual(3);
    expect(states.size).toBe(6);
  });
});

describe("The Vacant Chair: the rules", () => {
  it("nothing is ratified before the bell, and the bell is the clock: the Assembly votes the moment it rings", () => {
    const early = drive([...FORM, talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), use("grange0"), use("grange1")]);
    expect(early.s.resolution).toBeUndefined();
    expect(early.s.bellRung).toBe(false);
    const rung = drive(ticks(BELL - early.s.t + 1), early.s);
    expect(rung.s.resolution).toBe("backed_elder");
    expect(rung.s.t).toBeGreaterThanOrEqual(BELL);
  });

  it("an Assembly where every delegate present has been fed rings the bell early, never later than it would have", () => {
    const fed = drive([...FORM, ...GRAIN]);
    expect(fed.s.bell).toBeLessThan(BELL);
    expect(fed.s.bell).toBeCloseTo(fed.s.t + SUCCESSION.fedBellS, 0);
    const late = drive([...ticks(BELL - 5), ...GRAIN]);
    expect(late.s.bell).toBe(BELL);
  });

  it("two of three delegates are a majority; one is not; a downed delegate's vote cannot be had", () => {
    const one = drive([...FORM, talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), use("grange0"), ...ticks(BELL + SUCCESSION.graceS + 60, 5)]);
    expect(one.s.resolution, "one vote is not a majority: the Syndicate buys the chair").toBe("crown_sold");
    const down = drive([{ t: "actor", id: "grange-1", state: "down" }, { t: "actor", id: "grange-2", state: "down" }, ...FORM, talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), use("grange0"), use("grange1"), use("grange2"), ...ticks(BELL + 5)]);
    expect(down.s.resolution).not.toBe("backed_elder");
    expect(drive([...FORM, use("grange0"), use("grange0")]).s.fed, "one delegate, one vote").toBe(1);
  });

  it("without the Chamberlain's form nothing is ratified and no cheque is cashed; an envelope buys it at once, a stamp in forty-five seconds", () => {
    const noForm = drive([near("court"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), ...GRAIN, ...ticks(SUCCESSION.fedBellS + 40)]);
    expect(noForm.s.resolution).toBeUndefined();
    expect(noForm.s.phase).toBe("tension");
    expect(drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "survey")]).s.form).toBe("pending");
    expect(drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "survey"), ...ticks(SUCCESSION.formS - 3)]).s.form).toBe("pending");
    expect(drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "survey"), ...ticks(SUCCESSION.formS + 1)]).s.form).toBe("filed");
    const bribed = drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "paid", P.bribe)]);
    expect(bribed.s.form).toBe("bribed");
    expect(bribed.s.paid).toBe(P.bribe);
    // a bribe the purse cannot cover, or at a forged price, changes nothing
    const poor = { ...C, purse: 5 };
    const p = drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "paid", P.bribe)], undefined, poor);
    expect(p.s.form).toBe("none");
    expect(drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "paid", 1)]).s.form).toBe("none");
    expect(drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "paid", 99999)]).s.form).toBe("none");
  });

  it("one pledge at a time: the second heir refuses to be bought twice, and a regency needs both heirs", () => {
    const both = drive([near("court"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), talk("claimant_younger", "open"), talk("claimant_younger", "paid", P.younger)]);
    expect(both.s.heir).toEqual({ elder: "pledged", younger: "none" });
    expect(both.s.paid).toBe(P.elder);
    const reg1 = drive([...FORM, talk("claimant_elder", "open"), talk("claimant_elder", "survey"), ...GRAIN, ...ticks(60)]);
    expect(reg1.s.resolution, "one heir in a regency is not three signatures").not.toBe("regency");
    const refuse = drive([near("court"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), talk("claimant_younger", "open"), talk("claimant_younger", "survey")]);
    expect(refuse.s.heir.younger).toBe("none");
    // a regency heir who is then pledged the OTHER heir's chair withdraws
    const flip = drive([near("court"), talk("claimant_younger", "open"), talk("claimant_younger", "survey"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder)]);
    expect(flip.s.heir).toEqual({ elder: "pledged", younger: "none" });
    // overspending is refused: the second payment would exceed the purse
    const rich = { ...C, purse: P.elder + P.bribe - 5 };
    const over = drive([near("court"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), talk("chamberlain", "open"), talk("chamberlain", "paid", P.bribe)], undefined, rich);
    expect(over.s.form).toBe("none");
    expect(over.s.spent).toBe(P.elder);
  });

  it("taking the cheque takes two presses; the sale waits for the Chamberlain's seal; double-dealing breaks a promise", () => {
    const once = drive([near("court"), use("envoy")]);
    expect(once.s.cheque).toBe("offered");
    expect(once.fx.some((f) => typeof f === "object" && f.k === "say" && f.text.includes(`£${P.cheque}`))).toBe(true);
    const taken = drive([use("envoy")], once.s);
    expect(taken.s.cheque).toBe("taken");
    expect(taken.s.resolution).toBeUndefined();
    const sealed = drive([talk("chamberlain", "open"), talk("chamberlain", "survey"), ...ticks(SUCCESSION.formS + 1)], taken.s);
    expect(sealed.s.resolution).toBe("crown_sold");
    expect(def.outcome(sealed.s)!.loot).toBe(P.cheque);
    const dealer = drive([near("court"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), use("envoy"), use("envoy")]);
    expect(dealer.s.brokePromise).toBe(true);
    // a downed envoy cannot be dealt with
    expect(drive([{ t: "actor", id: "envoy", state: "down" }, use("envoy")]).s.cheque).toBe("none");
  });

  it("dithering sells the chair: the Syndicate's cheque is cashed after the grace, unless the court is fighting itself", () => {
    const dither = drive(ticks(BELL + SUCCESSION.graceS + 2, 5));
    expect(dither.s.resolution).toBe("crown_sold");
    expect(def.outcome(dither.s)!.loot).toBeUndefined();
    const fight = drive([near("court"), { t: "hostile", at: "guards" }, ...ticks(BELL + SUCCESSION.graceS + 20, 5)]);
    expect(fight.s.resolution, "a court at war with itself does not sell").toBeUndefined();
    const broken = drive([count(1, 1, 2)], fight.s);
    expect(drive(ticks(10), broken.s).s.resolution, "once the guard is broken the Syndicate steps in").toBe("crown_sold");
  });

  it("the chair: sitting in it with the guard standing is a declaration; with the guard broken it is the usurpation", () => {
    const sat = drive([near("court"), use("throne")]);
    expect(sat.s.hostile).toBe(true);
    expect(sat.s.brokePromise).toBe(true);
    expect(sat.s.resolution).toBeUndefined();
    expect(sat.fx.some((f) => typeof f === "object" && f.k === "order" && f.group === "guards" && f.order.o === "alert")).toBe(true);
    expect(drive([use("throne")], sat.s).s.resolution, "still guarded: they lift you out").toBeUndefined();
    expect(drive([count(2, 0, 2), use("throne")], sat.s).s.resolution, "two of four is not enough").toBeUndefined();
    expect(drive([count(1, 1, 2), use("throne")], sat.s).s.resolution).toBe("usurped");
    // a broken guard without a declaration does not usurp
    expect(drive([count(1, 1, 2), use("throne")]).s.resolution).toBeUndefined();
  });

  it("downing the Chamberlain or a claimant is a declaration and strikes them from the court", () => {
    const ch = drive([near("court"), { t: "actor", id: "chamberlain", state: "down" }]);
    expect(ch.s.hostile).toBe(true);
    expect(ch.s.down.chamberlain).toBe(true);
    expect(drive([talk("chamberlain", "open")], ch.s).fx.some((f) => typeof f === "object" && f.k === "parley")).toBe(false);
    const heir = drive([near("court"), talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder), { t: "actor", id: "claimant-elder", state: "down" }]);
    expect(heir.s.heir.elder).toBe("none");
    expect(heir.s.hostile).toBe(true);
  });

  it("hostility during a parley breaks a promise; the parley's card closes with the state", () => {
    for (const kind of ["chamberlain", "claimant_elder", "claimant_younger"] as const) {
      const open = drive([near("court"), talk(kind, "open")]);
      expect(open.s.parley).toBe(kind);
      expect(open.s.phase).toBe("parley");
      expect(open.fx.some((f) => typeof f === "object" && f.k === "parley" && f.kind === kind)).toBe(true);
      expect(drive([talk(kind, "open")], open.s).fx.some((f) => typeof f === "object" && f.k === "parley"), "a second press opens no second card").toBe(false);
      expect(drive([talk(kind, "close")], open.s).s.parley).toBeUndefined();
      const hot = drive([talk(kind, "hostile")], open.s);
      expect(hot.s.hostile).toBe(true);
      expect(hot.s.parley).toBeUndefined();
      expect(hot.s.brokePromise).toBe(true);
      // a wandering hostile from a parley nobody opened changes nothing
      expect(drive([talk(kind, "hostile")]).s.hostile).toBe(false);
    }
  });

  it("the three complications move the clock and the grace, nothing else", () => {
    const by: Partial<Record<ComplicationId, SuccessionState>> = {};
    for (let seed = 1; seed < 800 && Object.keys(by).length < 4; seed++) {
      const s = def.init(cm(seed), 0, seed);
      by[s.complication] ??= s;
    }
    expect(Object.keys(by).sort()).toEqual(["fog", "none", "outriders", "rain"]);
    const base = (s: SuccessionState): number => 300 + ((s.bell - (s.complication === "rain" ? -60 : s.complication === "fog" ? 60 : 0)) - 300);
    expect(base(by.rain!)).toBeGreaterThanOrEqual(SUCCESSION.bellMin);
    expect(by.rain!.bell).toBeLessThan(SUCCESSION.bellMax - 30);
    expect(by.fog!.bell).toBeGreaterThanOrEqual(SUCCESSION.bellMin + SUCCESSION.fogBell);
    expect(by.outriders!.grace).toBe(SUCCESSION.graceS + SUCCESSION.outridersGrace);
    expect(by.none!.grace).toBe(SUCCESSION.graceS);
    for (const s of Object.values(by)) {
      const v = def.view(s, 5000);
      if (s.complication !== "none") expect(v.complication).toBe(s.complication);
      expect(v.hint.length).toBeGreaterThan(60);
    }
  });

  it("every Highmark sentence is authored text: no unfilled placeholder, no real-world term", () => {
    const banned = /\b(london|england|britain|british|france|french|german|spain|rome|india|china|japan|africa|arab|egypt|turk|islam|muslim|christ|jewish|hindu|buddh|america|russia|paris|berlin|cairo|kenya|zulu|maasai|ethiopia)\b/i;
    const texts: string[] = [];
    for (const r of ENDINGS) for (const f of drive(SCRIPTS[r]!()).fx) if (typeof f === "object" && f.k === "say") texts.push(f.text);
    texts.push(...[def.brief, ...Object.values(def.view(def.init(C, 0, SEED), 1000)).filter((v): v is string => typeof v === "string")]);
    for (const r of ENDINGS) texts.push(def.view(drive(SCRIPTS[r]!()).s, 1000).hint);
    for (const t of texts) {
      expect(t).not.toMatch(/\{[a-z]+\}|undefined|NaN|\[object/);
      expect(t).not.toMatch(banned);
    }
    expect(texts.length).toBeGreaterThan(10);
  });
});

describe("The Vacant Chair: leave, views, roster, observation, determinism", () => {
  it("leave commits only what happened", () => {
    expect(def.leave(def.init(C, 0, SEED))).toBeUndefined();
    expect(def.leave(drive([near("court", 2)]).s), "turning up and leaving is nothing").toBeUndefined();
    expect(def.leave(drive([near("court"), talk("chamberlain", "open"), talk("chamberlain", "close")]).s)).toBeUndefined();
    const table: [string, ScenarioInput[], ResolutionId | undefined][] = [
      ["a barrel of grain given", [use("grange0")], "abandoned"],
      ["a form filed", [talk("chamberlain", "open"), talk("chamberlain", "survey")], "abandoned"],
      ["an heir pledged", [talk("claimant_elder", "open"), talk("claimant_elder", "paid", P.elder)], "abandoned"],
      ["a shot fired", [{ t: "tally", add: { wounded: 1 } }], "abandoned"],
      ["the guard drawn", [{ t: "hostile", at: "guards" }], "abandoned"],
      ["the cheque heard", [use("envoy")], "abandoned"],
      ["the cheque taken", [use("envoy"), use("envoy")], "crown_sold"],
    ];
    for (const [what, ev, want] of table) {
      const s = drive(ev).s;
      expect(def.leave(s), what).toBe(want);
      const left = drive([{ t: "leave" }], s);
      expect(left.s.resolution, what).toBe(want);
      expect(left.commits).toBe(want ? 1 : 0);
    }
    // a run that is already over leaves as what it was
    for (const r of ENDINGS) expect(def.leave(drive(SCRIPTS[r]!()).s)).toBe(r);
    // leaving with the cheque in the pocket takes its money
    expect(def.outcome(drive([use("envoy"), use("envoy"), { t: "leave" }]).s)!.loot).toBe(P.cheque);
  });

  it("the roster is the court: at most fourteen unique rows, authored, with the right roles, sides and sites", () => {
    const rows = def.roster(C, SEED, init0);
    expect(rows.length).toBeLessThanOrEqual(14);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
    expect(def.roster(C, SEED, init0)).toEqual(rows);
    const by = (role: number): number => rows.filter((r) => r.role === role).length;
    expect(by(NPC.CHAMBERLAIN)).toBe(1);
    expect(by(NPC.CLAIMANT)).toBe(2);
    expect(by(NPC.COURT_GUARD)).toBeGreaterThanOrEqual(2);
    expect(by(NPC.COURT_GUARD)).toBeLessThanOrEqual(4);
    expect(rows.filter((r) => r.group === "grange")).toHaveLength(3);
    expect(rows.filter((r) => r.group === "envoy")).toHaveLength(1);
    expect(rows.filter((r) => r.role === NPC.HERDER).length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(5);
      expect(r.bravery).toBeLessThanOrEqual(100);
      expect(Math.hypot(r.post.x, r.post.z)).toBeLessThan(150);
    }
    expect(rows.find((r) => r.id === "chamberlain")!.post).toEqual(HIGHMARK_SITES.chamberlain);
    expect(rows.filter((r) => r.group === "guards").map((r) => r.post)).toEqual([...HIGHMARK_SITES.guards]);
    expect(rows.find((r) => r.role === NPC.COURT_GUARD)!.brain).toBe("garrison");
    expect(rows.find((r) => r.role === NPC.CLAIMANT)!.brain).toBe("civil");
  });

  it("every id `observe` names exists: uses on a person, actors, groups; the throne is a place", () => {
    const rows = def.roster(C, SEED, init0);
    const ids = new Set(rows.map((r) => r.id));
    const groups = new Set(rows.map((r) => r.group));
    for (const u of def.observe.use) {
      expect([u.npc !== undefined, u.at !== undefined, u.mount === true].filter(Boolean).length, u.id).toBe(1);
      if (u.npc !== undefined) expect(ids.has(u.npc), `use ${u.id} -> ${u.npc}`).toBe(true);
      if (u.at !== undefined) expect(Number.isFinite(u.at.x + u.at.z)).toBe(true);
      if (u.talk !== undefined) expect(["chamberlain", "claimant_elder", "claimant_younger"]).toContain(u.talk);
    }
    expect(new Set(def.observe.use.map((u) => u.id)).size).toBe(def.observe.use.length);
    for (const a of def.observe.actors) expect(ids.has(a.id), `actor ${a.id}`).toBe(true);
    for (const o of def.observe.count) expect(groups.has(o.group), `count ${o.group}`).toBe(true);
    for (const g of def.observe.hostileGroups) expect(groups.has(g), `hostile group ${g}`).toBe(true);
    // the grain is a barrel, consumed; the three delegates' use ids are the ones the reducer reads
    for (let i = 0; i < 3; i++) expect(def.observe.use.find((u) => u.id === `grange${i}`)).toMatchObject({ npc: `grange-${i}`, carry: "barrel", consume: true });
    expect(def.observe.near.every((n) => Number.isFinite(n.x + n.z + n.r))).toBe(true);
  });

  it("every view has unique objective ids, a title, a hint, a timer that counts the bell and then the Syndicate", () => {
    for (let seed = 1; seed < 150; seed++) {
      const s = def.init(cm(seed), 0, seed);
      const v = def.view(s, 1000);
      expect(v.template).toBe("succession_dispute");
      expect(v.title).toBe("The Vacant Chair");
      expect(new Set(v.objectives.map((o) => o.id)).size).toBe(v.objectives.length);
      expect(v.objectives.length).toBeGreaterThan(3);
      expect(v.timerLabel).toBe("The harvest bell");
      expect(v.endsAtWorldMs).toBe(1000 + s.bell * 1000);
    }
    const late = drive(ticks(BELL + 1)).s;
    const v = def.view(late, 0);
    expect(v.timerLabel).toBe("The Syndicate buys the chair");
    expect(v.endsAtWorldMs).toBe(Math.round((BELL + SUCCESSION.graceS - late.t) * 1000));
    for (const r of ENDINGS) {
      const vv = def.view(drive(SCRIPTS[r]!()).s, 0);
      expect(vv.resolution).toBe(r);
      expect(vv.timerLabel).toBe("");
      expect(new Set(vv.objectives.map((o) => o.id)).size).toBe(vv.objectives.length);
      expect(vv.objectives.some((o) => o.id === "home")).toBe(true);
    }
    const fight = def.view(drive([near("court"), { t: "hostile", at: "guards" }, count(1, 1, 2)]).s, 0);
    expect(fight.objectives.map((o) => o.id)).toContain("break");
    expect(fight.objectives.map((o) => o.id)).toContain("sit");
  });

  it("init is deterministic and prices are in range; a different seed deals a different court", () => {
    const a = def.init(C, 0, SEED), b = def.init(structuredClone(C), 0, SEED);
    expect(a).toEqual(b);
    const prices = new Set<number>();
    for (let seed = 1; seed < 100; seed++) {
      const s = def.init(cm(seed), 0, seed);
      for (const [k, [lo, hi]] of [["elder", SUCCESSION.priceElder], ["younger", SUCCESSION.priceYounger], ["bribe", SUCCESSION.priceBribe], ["cheque", SUCCESSION.priceCheque]] as const) {
        expect(s.price[k], k).toBeGreaterThanOrEqual(lo);
        expect(s.price[k], k).toBeLessThanOrEqual(hi);
        expect(s.price[k] % 5).toBe(0);
      }
      prices.add(s.price.elder * 1000 + s.bell);
    }
    expect(prices.size).toBeGreaterThan(10);
    expect(TEMPLATES.succession_dispute).toBe(successionTemplate);
  });

  it("the parleys: three kinds, authored rounds, options re-derived on the server, a forged index re-issues the round", () => {
    const ctx = { price: 40, purse: 500, seed: 3, day: 2 };
    for (const kind of ["chamberlain", "claimant_elder", "claimant_younger"] as const) {
      const v = openSiteParley(kind, ctx);
      expect(v.options.length).toBeGreaterThanOrEqual(4);
      expect(v.options.map((o) => o.label).some((l) => /Walk away/.test(l))).toBe(true);
      for (const o of v.options) { expect(o.label.length).toBeGreaterThan(5); expect(o.hint.length).toBeGreaterThan(5); }
      for (const bad of [-1, 99, 1.5, NaN]) expect(answerSiteParley(kind, ctx, v, bad).done, `${kind} ${bad}`).toBeUndefined();
      expect(() => answerSiteParley(kind, ctx, { round: 9, toll: -5 } as never, 0)).not.toThrow();
      expect(() => answerSiteParley(kind, ctx, undefined as never, 0)).not.toThrow();
      const labels = v.options.map((o) => o.label);
      const idx = (re: RegExp): number => labels.findIndex((l) => re.test(l));
      // pay: the purse and the price are checked; "paid" is what comes back, at exactly the price
      const pay = answerSiteParley(kind, ctx, v, idx(/£/));
      expect(pay.done).toEqual({ result: "paid", paid: 40 });
      expect(answerSiteParley(kind, { ...ctx, purse: 3 }, v, idx(/£/)).done).toBeUndefined();
      // the file / regency option is free
      expect(answerSiteParley(kind, ctx, v, idx(kind === "chamberlain" ? /Form 11/ : /regency/))).toMatchObject({ done: { result: "survey", paid: 0 } });
      // ask: round 2, with a hint of what it would take
      const ask = answerSiteParley(kind, ctx, v, idx(/Ask/));
      expect(ask.view!.round).toBe(2);
      expect(ask.emit).toBe("learn");
      expect(ask.view!.options.length).toBeGreaterThanOrEqual(3);
      // threats end the talk badly; walking away is free
      expect(answerSiteParley(kind, ctx, v, idx(kind === "chamberlain" ? /Demand/ : /rifles/)).done).toEqual({ result: "hostile", paid: 0 });
      expect(answerSiteParley(kind, ctx, v, idx(/Walk away/)).done).toEqual({ result: "walked", paid: 0 });
    }
    // flattering a claimant moves the price (and the speaker stays in character)
    const v = openSiteParley("claimant_elder", { ...ctx, price: 60 });
    const prices = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const step = answerSiteParley("claimant_elder", { ...ctx, price: 60, seed }, v, v.options.findIndex((o) => /Flatter/.test(o.label)));
      prices.add(step.view!.toll);
      expect(step.line).toMatch(/Orla|Princess|Seniority|seniority/);
    }
    expect(prices.size).toBeGreaterThan(1);
  });

  it("5000 sequences of hostile events: never throws, never a second commit, never an unresolved resolution", () => {
    const rng = new Rng(0x5ec0de);
    const groups = ["guards", "court", "claimants", "grange", "envoy", "drovers", "ward", "", "late:x", "__proto__"];
    const targets = ["throne", "envoy", "grange0", "grange1", "grange2", "grange3", "grange-0", "chamberlain", "elder", "cage", "wagon", "__proto__", "constructor"];
    const ids = ["chamberlain", "claimant-elder", "claimant-younger", "grange-0", "grange-1", "grange-2", "envoy", "wagon", "x", "__proto__"];
    const kinds = ["chamberlain", "claimant_elder", "claimant_younger", "warden", "ransom", "surveyor", "ward_post", "ford_post", "nonsense"];
    const results = ["open", "close", "hostile", "paid", "bargained", "bribed", "ransom", "survey", "learn", "tell", "envelope", "tip", "nonsense"];
    const wild = [Number.NaN, Infinity, -Infinity, -5, 0, 1, 3, 4, 7.5, 99, 1e9, -1e9];
    const pickW = (): number => wild[rng.int(0, wild.length - 1)]!;
    const pick = <T,>(a: readonly T[]): T => a[rng.int(0, a.length - 1)]!;
    for (let run = 0; run < 5000; run++) {
      let s = def.init(cm(1 + (run % 37)), 0, run);
      let commits = 0;
      for (let k = 0, n = rng.int(3, 30); k < n; k++) {
        const e = pick<ScenarioInput>([
          { t: "tick", dt: pick([0.1, 1, 5, 40, pickW()]) }, { t: "weather", rain: pickW() }, { t: "near", at: pick(["court", "x", "__proto__"]), party: pickW() },
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
        expect(s.fed).toBeGreaterThanOrEqual(0);
        expect(s.fed).toBeLessThanOrEqual(7);
        expect(commits, "never a second commit").toBeLessThanOrEqual(1);
        if (s.phase === "resolved") expect(s.resolution).toBeDefined();
        else expect(s.resolution).toBeUndefined();
        if (s.resolution !== undefined) expect([...HIGHMARK_RESOLUTIONS, "abandoned"]).toContain(s.resolution);
        if (k % 7 === 0) expect(def.view(s, 1000).objectives.length).toBeGreaterThan(1);
      }
      if (s.phase === "resolved") expect(commits).toBe(1);
      expect(def.leave(s) === undefined || typeof def.leave(s) === "string").toBe(true);
    }
  }, 120_000);

  it("the fx it emits are all runner-known shapes", () => {
    const known = new Set(["spawn", "order", "war", "say", "open", "explode", "bridge", "commit", "wagon", "parley"]);
    for (const r of ENDINGS) {
      for (const f of drive(SCRIPTS[r]!()).fx) {
        if (typeof f === "string") expect(["garrison_alert", "garrison_stand_down", "gate_open", "arm_charge", "rival_advance", "commit"]).toContain(f);
        else expect(known.has((f as ScenarioFx).k), `${r}: ${JSON.stringify(f)}`).toBe(true);
      }
    }
  });
});
