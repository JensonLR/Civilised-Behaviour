import { describe, expect, it } from "vitest";
import type { CampaignState } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { NPC_SIDE } from "../expeditionTypes.ts";
import { peopleForNpc } from "../peoples.ts";
import { OBJECTIVE_SPOTS, objectiveMark } from "../compassMarks.ts";
import { newCampaign } from "../factions.ts";
import { kessarNavOptions } from "../garrison.ts";
import { createKessarWorld, kessarSitePoints } from "../kessar.ts";
import { NavQuery, buildNavGrid } from "../nav.ts";
import { newPowers } from "../powers.ts";
import { siegeAftermath } from "../raidAftermath.ts";
import type { ScenarioInput } from "../scenario.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { OUTPOST_STAGES } from "../worldTypes.ts";
import { PICKET_NAMES, SIEGE, SIEGE_SITES as S, countingHouseTemplate as def, hopeless, type SiegeState } from "./countingHouse.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { pickTemplate } from "./registry.ts";
import { OUTCOME_KIND, TERMS } from "./terms.ts";
import type { Fx } from "./types.ts";

/** D-095: the Siege of the Counting-House, Kessar's sixth contract (the GDD's siege). */
function seedWith(pred: (s: SiegeState) => boolean): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 600; seed++) {
    const c = { ...newCampaign(seed), purse: 300 };
    if (pred(def.init(c, 0, seed))) return { c, seed };
  }
  throw new Error("no seed");
}
const { c: C, seed: SEED } = seedWith((s) => s.complication === "none");
const S0 = def.init(C, 0, SEED);
function drive(events: readonly ScenarioInput[], s0: SiegeState = S0): { s: SiegeState; fx: Fx[] } {
  let s = s0;
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const near = (k: number, party = 1): ScenarioInput => ({ t: "near", at: `picket-${k}`, party });
const factor = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind: "siege_factor", result, paid });
const actor = (id: string, state: "down" | "arrived" | "left"): ScenarioInput => ({ t: "actor", id, state });
const count = (group: string, alive: number, down: number, total: number): ScenarioInput => ({ t: "count", group, alive, routed: 0, down, total });
const said = (fx: Fx[]): string => fx.map((f) => (typeof f === "object" && f.k === "say" ? f.text : "")).join(" | ");
const isCommit = (f: Fx): boolean => typeof f === "object" && f.k === "commit";
const orders = (fx: Fx[], group: string): string[] => fx.flatMap((f) => (typeof f === "object" && f.k === "order" && f.group === group ? [f.order.o] : []));
/** Plant all three and step off each. */
const INVEST: ScenarioInput[] = [near(0), near(0, 0), near(1), near(1, 0), near(2), near(2, 0)];
const INVESTED = drive(INVEST).s;

describe("the Siege of the Counting-House (D-095): the reducer", () => {
  it("is deterministic; its price is in range and in fives; the relief lands in its window; fog delays it, rain fills the stores, reinforcements enlarge it", () => {
    expect(def.init(C, 0, SEED)).toEqual(S0);
    for (let seed = 1; seed < 200; seed++) {
      const s = def.init({ ...newCampaign(seed), purse: 300 }, 0, seed);
      expect(s.price % 5).toBe(0);
      expect(s.price).toBeGreaterThanOrEqual(SIEGE.priceBuy[0]);
      expect(s.price).toBeLessThanOrEqual(SIEGE.priceBuy[1]);
      const fog = s.complication === "fog" ? SIEGE.fogRelief : 0;
      expect(s.reliefAt).toBeGreaterThanOrEqual(SIEGE.reliefMin + fog);
      expect(s.reliefAt).toBeLessThanOrEqual(SIEGE.reliefMax + fog);
      expect(s.storesS).toBe(SIEGE.storesS + (s.complication === "rain" ? SIEGE.rainStores : 0));
      expect(s.relief.total).toBe(SIEGE.relief + (s.complication === "reinforcements" ? SIEGE.extraRelief : 0));
    }
    expect(S0.phase).toBe("planning");
  });

  it("a picket mark stood on is planted (its boy spawned once, sent back after); all three invest the post and only then does the stores clock run", () => {
    const one = drive([near(0)]);
    expect(one.s.pickets).toEqual([true, false, false]);
    expect(one.fx).toContainEqual({ k: "spawn", group: "late:picket-0" });
    expect(said(one.fx)).toMatch(/penny an hour/);
    expect(one.s.phase).toBe("tension");
    // nothing runs down until all three stand
    expect(drive(ticks(60), one.s).s.starve).toBe(0);
    expect(INVESTED.pickets).toEqual([true, true, true]);
    expect(INVESTED.phase).toBe("standoff");
    const v = def.view(INVESTED, 0);
    expect(v.timerLabel).toBe("The garrison's stores");
    const out = drive(ticks(INVESTED.storesS + 1), INVESTED);
    expect(out.s.storesOut).toBe(true);
    expect(said(out.fx)).toMatch(/stores are out/);
    expect(hopeless(out.s)).toBe(true);
  });

  it("twice the garrison sallies for a picket; one reached with nobody on it is struck (the boy runs, the clock stops) and planted again by standing on it", () => {
    const go = drive(ticks(SIEGE.sallyAt[0] + 1), INVESTED);
    const k = go.s.sallyOut;
    expect(k).toBeGreaterThanOrEqual(0);
    expect(go.s.sallies).toBe(1);
    expect(go.fx).toContainEqual({ k: "order", group: "sally", order: { o: "march", route: `sally${k}` } });
    expect(orders(go.fx, "sally")).toContain("alert");
    expect(said(go.fx)).toContain(`${PICKET_NAMES[k]} picket`);
    expect(go.s.phase).toBe("fighting");
    const struck = drive([actor(`sally-0@p${k}`, "arrived")], go.s);
    expect(struck.s.pickets[k]).toBe(false);
    expect(struck.s.sallyOut).toBe(-1);
    expect(orders(struck.fx, `late:picket-${k}`)).toEqual(["flee"]);
    expect(orders(struck.fx, "sally")).toEqual(["post"]);
    const paused = drive(ticks(30), struck.s).s;
    expect(paused.starve, "the clock stops while the investment is broken").toBe(struck.s.starve);
    const again = drive([near(k)], paused);
    expect(again.s.pickets[k]).toBe(true);
    expect(orders(again.fx, `late:picket-${k}`), "the boy is sent back, not spawned twice").toEqual(["post"]);
    expect(again.fx.some((f) => typeof f === "object" && f.k === "spawn")).toBe(false);
    // a second sally later on; never a third
    const later = drive(ticks(SIEGE.sallyAt[1] - SIEGE.sallyAt[0] + 2), again.s);
    expect(later.s.sallies).toBe(2);
    const done = drive([actor(`sally-1@p${later.s.sallyOut}`, "arrived"), near(later.s.sallyOut), near(later.s.sallyOut, 0), ...ticks(200)], later.s).s;
    expect(done.sallies).toBe(2);
  });

  it("a sally that finds you standing on the mark does not strike it until you step off; a sally broken on the way strikes nothing", () => {
    const go = drive(ticks(SIEGE.sallyAt[0] + 1), INVESTED).s;
    const k = go.sallyOut;
    const held = drive([near(k), actor(`sally-1@p${k}`, "arrived")], go);
    expect(held.s.pickets[k]).toBe(true);
    expect(said(held.fx)).toMatch(/standing on it/);
    const off = drive([near(k, 0)], held.s);
    expect(off.s.pickets[k], "stepping off the mark with the sally on it").toBe(false);
    const broken = drive([count("sally", 0, 2, 2)], go);
    expect(broken.s.sallyOut).toBe(-1);
    expect(said(broken.fx)).toMatch(/sally is broken/);
    expect(drive([actor(`sally-0@p${k}`, "arrived")], broken.s).s.pickets[k]).toBe(true);
  });

  it("siege_honours: the summons is refused until the post is invested AND his case is hopeless (stores out, relief beaten or half the guns down); then the garrison marches out", () => {
    const bare = drive([factor("open"), factor("survey")]);
    expect(bare.s.phase).not.toBe("resolved");
    expect(said(bare.fx)).toMatch(/invested/);
    const early = drive([factor("open"), factor("survey")], INVESTED);
    expect(early.s.phase).not.toBe("resolved");
    expect(said(early.fx)).toMatch(/stores are good/);
    const starved = drive(ticks(INVESTED.storesS + 1), INVESTED).s;
    const ok = drive([factor("open"), factor("survey")], starved);
    expect(ok.s.resolution).toBe("siege_honours");
    expect(ok.fx.filter(isCommit)).toHaveLength(1);
    expect(ok.fx).toContainEqual({ k: "order", group: "garrison", order: { o: "guard", x: S.relief[1]!.x, z: S.relief[1]!.z, r: 5 } });
    expect(ok.fx).toContainEqual({ k: "order", group: "factor", order: { o: "guard", x: S.relief[1]!.x, z: S.relief[1]!.z, r: 5 } });
    expect(orders(ok.fx, "garrison")[0]).toBe("stand_down");
    // half the guns down is hopeless too (and a storm does not close the summons)
    const halved = drive([{ t: "hostile", at: "garrison" }, count("garrison", 0, 2, 2), factor("open"), factor("survey")], INVESTED);
    expect(halved.s.resolution).toBe("siege_honours");
    expect(OUTCOME_KIND.siege_honours).toBe("won");
  });

  it("siege_stormed: a shot into the post stands the whole garrison to; three of its four down is the storm; a shot at a sally that is out is not a storm", () => {
    const shot = drive([{ t: "hostile", at: "garrison" }]);
    expect(shot.s.storm).toBe(true);
    expect(orders(shot.fx, "garrison")).toEqual(["alert"]);
    expect(orders(shot.fx, "sally")).toEqual(["alert"]);
    expect(orders(shot.fx, "factor")).toEqual(["hold_fire"]);
    expect(def.view(shot.s, 0).rule, "the rule leaves the orders card once the storm has begun").toBeUndefined();
    const two = drive([count("garrison", 0, 2, 2)], shot.s);
    expect(two.s.phase).not.toBe("resolved");
    const three = drive([count("sally", 1, 1, 2)], two.s);
    expect(three.s.resolution).toBe("siege_stormed");
    expect(orders(three.fx, "factor")).toEqual(["stand_down"]);
    const out = drive(ticks(SIEGE.sallyAt[0] + 1), INVESTED).s;
    expect(drive([{ t: "hostile", at: "sally" }], out).s.storm, "a sortie in the open is fair game").toBe(false);
    expect(drive([{ t: "hostile", at: "sally" }]).s.storm, "the sally at home is the post").toBe(true);
    // while a sally is out, a round that only passes by the post is the sortie's crossfire; one that lands on its men is the storm; with no sally out, even a miss is
    expect(drive([{ t: "hostile", at: "garrison", near: true }], out).s.storm).toBe(false);
    expect(drive([{ t: "hostile", at: "garrison" }], out).s.storm).toBe(true);
    expect(drive([{ t: "hostile", at: "garrison", near: true }], INVESTED).s.storm).toBe(true);
    // a broken sally runs home through the post: for a few seconds a round after it is still the sortie's
    const broke = drive([count("sally", 0, 2, 2)], out).s;
    expect(drive([{ t: "hostile", at: "sally" }], broke).s.storm).toBe(false);
    expect(drive([{ t: "hostile", at: "garrison", near: true }], broke).s.storm).toBe(false);
    expect(drive([...ticks(SIEGE.crossfireS + 1), { t: "hostile", at: "garrison", near: true }], broke).s.storm).toBe(true);
    expect(OUTCOME_KIND.siege_stormed).toBe("won");
  });

  it("firing on the factor while he talks under the flag is a broken promise, and the storm", () => {
    const r = drive([factor("open"), { t: "hostile", at: "factor" }]);
    expect(r.s.brokePromise).toBe(true);
    expect(r.s.storm).toBe(true);
    expect(r.s.parley).toBeUndefined();
    expect(drive([factor("open"), factor("hostile")]).s.storm, "told to come and get it").toBe(true);
  });

  it("siege_bought: his price, inside the band and affordable; outside it nothing happens", () => {
    const ok = drive([factor("open"), factor("paid", S0.price)]);
    expect(ok.s.resolution).toBe("siege_bought");
    expect(ok.s.paid).toBe(S0.price);
    expect(def.outcome(ok.s)?.paid).toBe(S0.price);
    expect(drive([factor("open"), factor("paid", 1)]).s.phase).not.toBe("resolved");
    const poor = def.init({ ...C, purse: 10 }, 0, SEED);
    expect(drive([factor("open"), factor("paid", S0.price)], poor).s.phase).not.toBe("resolved");
    expect(OUTCOME_KIND.siege_bought).toBe("partial");
  });

  it("the relief: smoke on the river, the landing, forming up, the march; two of it in the yard lift the siege; broken, it makes his case hopeless", () => {
    const warn = drive(ticks(S0.reliefAt - SIEGE.warnS + 1));
    expect(warn.s.warned).toBe(true);
    expect(said(warn.fx)).toMatch(/Smoke on the river/);
    expect(def.view(warn.s, 0).timerLabel).toBe("The relief lands");
    const land = drive(ticks(SIEGE.warnS + 1), warn.s);
    expect(land.s.reliefLanded).toBe(true);
    expect(land.fx).toContainEqual({ k: "spawn", group: "late:relief" });
    expect(def.view(land.s, 0).timerLabel).toBe("The relief marches");
    const march = drive(ticks(SIEGE.formS + 1), land.s);
    expect(march.fx).toContainEqual({ k: "order", group: "late:relief", order: { o: "march", route: "relief", join: true } });
    const one = drive([actor("relief-0", "arrived")], march.s);
    expect(one.s.phase).not.toBe("resolved");
    const lifted = drive([actor("relief-1", "arrived")], one.s);
    expect(lifted.s.resolution).toBe("siege_lifted");
    expect(OUTCOME_KIND.siege_lifted).toBe("lost");
    // one in the yard shot down: the pair is broken
    expect(drive([actor("relief-0", "down"), actor("relief-1", "arrived")], one.s).s.phase).not.toBe("resolved");
    // broken: it runs, and the factor's case is hopeless
    const need = Math.ceil(S0.relief.total * SIEGE.brokenFraction);
    const broken = drive([count("late:relief", S0.relief.total - need, need, S0.relief.total)], march.s);
    expect(broken.s.reliefBroken).toBe(true);
    expect(orders(broken.fx, "late:relief")).toEqual(["flee"]);
    expect(hopeless(broken.s)).toBe(true);
    // shooting at it while it forms up sends it on at once
    const hurried = drive([{ t: "hostile", at: "late:relief" }], land.s);
    expect(hurried.s.marching).toBe(true);
    // an empty count before the landing says nothing
    expect(drive([count("late:relief", 0, 0, 0)]).s.relief).toEqual(S0.relief);
  });

  it("leaving: nothing done dismisses the run; once a picket is up or a word said, the siege is lifted; the party down is abandoned", () => {
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(drive([near(0)]).s)).toBe("siege_lifted");
    expect(def.leave(drive([factor("open"), factor("learn")]).s)).toBe("siege_lifted");
    expect(drive([{ t: "party_down" }]).s.resolution).toBe("abandoned");
  });

  it("the view: plain objectives in order, every placed objective has a compass spot, the strip walks the unplanted marks; the terms name what the code does", () => {
    const v0 = def.view(S0, 0);
    expect(v0.title).toBe("The Siege of the Counting-House");
    expect(v0.objectives[0]!.id).toBe("picket0");
    expect(objectiveMark("kessar", v0)).toMatchObject({ x: S.pickets[0]!.x, z: S.pickets[0]!.z });
    const after = def.view(drive([near(0), near(0, 0)]).s, 0);
    expect(after.objectives[0]!.id).toBe("picket1");
    expect(after.objectives[0]!.text).toContain("(1/3)");
    const inv = def.view(INVESTED, 0);
    expect(inv.objectives[0]).toMatchObject({ id: "invest", done: true });
    expect(objectiveMark("kessar", inv)).toMatchObject({ x: S.factor.x, z: S.factor.z });
    for (const st of [S0, INVESTED, drive(ticks(SIEGE.sallyAt[0] + 1), INVESTED).s, drive(ticks(S0.reliefAt + 1)).s, drive([{ t: "hostile", at: "garrison" }]).s]) {
      for (const o of def.view(st, 0).objectives) expect(o.id in OBJECTIVE_SPOTS.counting_house, o.id).toBe(true);
      for (const o of def.view(st, 0).objectives) expect(o.text.length, o.text).toBeLessThanOrEqual(60);
    }
    expect(TERMS.counting_house.win).toHaveLength(2);
    expect(def.view(S0, 0).rule).toBe(TERMS.counting_house.rule);
  });

  it("the roster: the factor at his counter, two guns in the yard, two sallying, the relief held back, three Ward picket boys held back and on nobody's side", () => {
    const r = def.roster(C, SEED, S0);
    expect(r.find((p) => p.id === "factor")).toMatchObject({ role: NPC.RIVAL_SURVEYOR, side: "rival", group: "factor", post: S.factor });
    expect(r.filter((p) => p.group === "garrison")).toHaveLength(2);
    expect(r.filter((p) => p.group === "sally")).toHaveLength(2);
    expect(r.filter((p) => p.group === "late:relief")).toHaveLength(S0.relief.total);
    const boys = r.filter((p) => p.group.startsWith("late:picket-"));
    expect(boys).toHaveLength(3);
    for (const b of boys) expect(b).toMatchObject({ role: NPC.PICKET, side: "neutral", faction: "ward" });
    expect(NPC_SIDE[NPC.PICKET], "a bystander to the Butcher's Bill and the client, not a hand").toBe("neutral");
    expect(peopleForNpc(NPC.PICKET, "kessar"), "drawn as Kessar's own people").toBe(peopleForNpc(NPC.DRIVER, "kessar"));
    expect(new Set(r.map((p) => p.id)).size).toBe(r.length);
    expect(r.length).toBeLessThanOrEqual(16);
    // every group the template orders is in the roster, and every hostile group is a Syndicate one
    for (const g of def.observe.hostileGroups) expect(r.some((p) => p.group === g && p.side === "rival"), g).toBe(true);
    // the parley gives the template what it reads
    const ctx = { price: S0.price, purse: 300, seed: 3, day: 2 };
    const v = openSiteParley("siege_factor", ctx);
    expect(v.frame?.heading).toMatch(/Counting-House/);
    const out = new Set<string>();
    for (let i = 0; i < v.options.length; i++) {
      const st = answerSiteParley("siege_factor", ctx, v, i);
      if (st.done) out.add(st.done.result);
      else if (st.view) for (let k = 0; k < st.view.options.length; k++) { const s2 = answerSiteParley("siege_factor", ctx, st.view, k); if (s2.done) out.add(s2.done.result); }
    }
    expect([...out].sort()).toEqual(["hostile", "paid", "survey", "walked"]);
  });

  it("offered at Kessar only while the Syndicate keeps a post there; a won or bought siege strikes it, a lifted one does not", () => {
    const presence = (postStage: 0 | 1 | 2): RivalPresence => ({ goal: "survey_route", arrivesInS: 300, escort: 1, wagon: false, surveyors: 1, postStage });
    const c = { ...newCampaign(5), history: [{ seq: 1, region: "kessar" as const, resolution: "paid" as const, day: 1, template: "secure_crossing" as const }], day: 2 };
    const offered = (st: 0 | 1 | 2): boolean => Array.from({ length: 60 }, (_, d) => pickTemplate({ ...c, day: 2 + d }, "kessar", 9 + d, presence(st))).includes("counting_house");
    expect(offered(0)).toBe(false);
    expect(offered(1)).toBe(true);
    expect(offered(2)).toBe(true);
    expect(Array.from({ length: 60 }, (_, d) => pickTemplate({ ...c, day: 2 + d }, "kessar", 9 + d)).includes("counting_house"), "no presence: never").toBe(false);
    const p = newPowers(5);
    const withPost = { ...p, rival: { ...p.rival, posts: 2 as const } };
    const o = (resolution: "siege_honours" | "siege_stormed" | "siege_bought" | "siege_lifted" | "abandoned") => ({
      scenario: "counting_house" as const, resolution, toll: 0, paid: 0, bridge: "intact" as const, brokePromise: false, seconds: 60,
      tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 },
    });
    for (const r of ["siege_honours", "siege_stormed", "siege_bought"] as const) {
      const a = siegeAftermath(withPost, o(r));
      expect(a.struck, r).toBe(true);
      expect(a.p.rival.posts, r).toBe(0);
    }
    for (const r of ["siege_lifted", "abandoned"] as const) expect(siegeAftermath(withPost, o(r)).p.rival.posts, r).toBe(2);
    expect(siegeAftermath(withPost, { ...o("siege_honours"), scenario: "outpost_raid" }).p).toBe(withPost);
  });
});

describe("the siege's ground (D-095): every stage, both bridges, both Syndicate posts, seven seeds", () => {
  it("every point is open and kept clear of the scatter; every leg the Cast walks straight is clear, both ways (the sallies and the relief; the march out is planned)", () => {
    const ids = new Set(kessarSitePoints().map((p) => p.id));
    for (const k of ["siege.yard", "siege.factor", "siege.picket0", "siege.picket2", "siege.relief0", "siege.sally1.3"]) expect(ids.has(k), k).toBe(true);
    const routes: (readonly { x: number; z: number }[])[] = [...S.sallies, S.relief];
    for (const r of routes) for (let i = 1; i < r.length; i++) expect(Math.hypot(r[i]!.x - r[i - 1]!.x, r[i]!.z - r[i - 1]!.z), "a leg the scatter cannot reach into").toBeLessThanOrEqual(9.1);
    const posts = [...S.garrison, ...S.sallyPosts, S.factor];
    for (const seed of [1, 7, 19, 42, 91, 4242, 4243]) for (const st of OUTPOST_STAGES) for (const bridge of ["intact", "collapsed"] as const) for (const syn of [1, 2]) {
      const w = createKessarWorld(seed, bridge, { outpost: st, telegraph: st === "town", railway: true, works: true, crank: true, rivalPost: syn });
      const q = new NavQuery(buildNavGrid(w, kessarNavOptions(w)));
      const tag = `${st} ${bridge} syn${syn} @${seed}`;
      for (const p of [S.yard, ...S.pickets, ...posts, ...S.relief]) expect(q.open(p.x, p.z), `${tag}: ${p.x},${p.z} open`).toBe(true);
      // (both ways: the grid's line test is not symmetric, and the march out walks the relief's road backwards)
      for (const r of routes) for (let i = 1; i < r.length; i++) for (const [a, b] of [[r[i - 1]!, r[i]!], [r[i]!, r[i - 1]!]] as const) expect(q.los(a.x, a.z, b.x, b.z), `${tag}: ${a.x},${a.z} -> ${b.x},${b.z}`).toBe(true);
      // the sally walks from its post to the sally port (and back to its post, planned, when sent home)
      for (const p of S.sallyPosts) expect(q.los(p.x, p.z, S.sallies[0]![0]!.x, S.sallies[0]![0]!.z), `${tag}: sally post ${p.x},${p.z} -> port`).toBe(true);
    }
  }, 600_000);

  it("a picket boy is a picket mark's own (spawned on it), the relief comes ashore on open ground, and the factor stands clear of the counter at both of the post's stages", () => {
    const r = def.roster(C, SEED, def.init(C, 0, SEED));
    for (const seed of [1, 42]) for (const syn of [1, 2]) {
      const w = createKessarWorld(seed, "intact", { rivalPost: syn, railway: true, works: true, crank: true });
      const q = new NavQuery(buildNavGrid(w, kessarNavOptions(w)));
      for (const p of r) expect(q.open(p.post.x, p.post.z), `${p.id} @${seed} syn${syn}`).toBe(true);
    }
    for (let k = 0; k < 3; k++) expect(r.find((p) => p.id === `picket-${k}`)!.post).toEqual(S.pickets[k]);
  });
});
