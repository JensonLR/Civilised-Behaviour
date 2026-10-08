import { describe, expect, it } from "vitest";
import type { CampaignState, ScenarioOutcome } from "../campaignTypes.ts";
import { NPC, NPC_CAP } from "../campaignTypes.ts";
import { applyOutcome, newCampaign } from "../factions.ts";
import { newPowers } from "../powers.ts";
import { raidAftermath } from "../raidAftermath.ts";
import { hasFlag, withFlag } from "../relations.ts";
import { rivalPresence } from "../rival.ts";
import type { ScenarioInput } from "../scenario.ts";
import { defendOutpost, foundOutpost, newSettlements } from "../settlement.ts";
import type { RivalPresence } from "../worldTypes.ts";
import { kessarNavOptions } from "../garrison.ts";
import { createKessarWorld } from "../kessar.ts";
import { NavQuery, buildNavGrid } from "../nav.ts";
import { OUTPOST_STAGES } from "../worldTypes.ts";
import { KESSAR_OUTPOST, outpostPlan } from "../outpost.ts";
import { WEAPON } from "../weapons.ts";
import { RAID, RAID_SITES, WATCH_POSTS, outpostRaidTemplate as def, type RaidState } from "./outpostRaid.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { pickTemplate } from "./registry.ts";
import type { Fx } from "./types.ts";

function calm(): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 400; seed++) {
    const c = { ...newCampaign(seed), purse: 200 };
    if (def.init(c, 0, seed).complication === "none") return { c, seed };
  }
  throw new Error("no calm seed");
}
const { c: C, seed: SEED } = calm();
const isCommit = (f: Fx): boolean => typeof f === "object" && f.k === "commit";
function drive(events: readonly ScenarioInput[], s0?: RaidState): { s: RaidState; fx: Fx[]; commits: number } {
  let s = s0 ?? def.init(C, 0, SEED);
  const fx: Fx[] = [];
  for (const e of events) {
    const r = def.reduce(s, e);
    s = r.s;
    fx.push(...r.fx);
  }
  return { s, fx, commits: fx.filter(isCommit).length };
}
const ticks = (seconds: number, dt = 1): ScenarioInput[] => Array.from({ length: Math.ceil(seconds / dt) }, () => ({ t: "tick", dt }));
const talk = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind: "raid_captain", result, paid });
const arrive = (i: number): ScenarioInput => ({ t: "actor", id: `raider-${i}`, state: "arrived" });
const S0 = def.init(C, 0, SEED);
const LANDED = drive(ticks(S0.raidAt + 1)).s;
const said = (fx: Fx[]): string => fx.map((f) => (typeof f === "object" && f.k === "say" ? f.text : "")).join(" | ");

describe("the Raid on the Post (D-045): the reducer", () => {
  it("the raiders land on their clock, take their ranks behind the captain at the muster and halt for the captain's demand; when it runs out they go for the yard", () => {
    expect(def.view(S0, 0).timerLabel).toBe("The raiders land");
    // the runner reports the empty group every tick before the landing: the raid still lands with its full crew (the bot playtest saw "0 men with torches")
    const early = drive([{ t: "count", group: "late:raiders", alive: 0, routed: 0, down: 0, total: 0 }, ...ticks(S0.raidAt + 1)]);
    expect(early.s.crew.total).toBe(RAID.raiders);
    expect(said(early.fx)).toContain(`${RAID.raiders} men with torches`);
    expect(early.s.phase).toBe("standoff");
    expect(LANDED.landed).toBe(true);
    expect(LANDED.phase).toBe("standoff");
    const land = drive(ticks(S0.raidAt + 1));
    expect(land.fx).toContainEqual({ k: "spawn", group: "late:raiders" });
    expect(land.fx).toContainEqual({ k: "order", group: "late:raiders", order: { o: "guard", x: RAID_SITES.ranks.x, z: RAID_SITES.ranks.z, r: RAID.ranksR } });
    expect(land.fx).toContainEqual({ k: "order", group: "late:captain", order: { o: "guard", x: RAID_SITES.muster.x, z: RAID_SITES.muster.z, r: 0 } });
    expect(def.view(LANDED, 0).timerLabel).toBe("The captain's watch");
    const out = drive(ticks(RAID.demandS + 1), LANDED);
    expect(out.s.attacking).toBe(true);
    expect(out.fx).toContainEqual({ k: "order", group: "late:raiders", order: { o: "march", route: "assault", join: true } });
    expect(out.fx, "the captain sends them; he does not fight").toContainEqual({ k: "order", group: "late:captain", order: { o: "hold_fire" } });
  });

  it("post_burned: two raiders in the yard together for the torch time burn the stores; one alone, or one shot down, does not", () => {
    const at = drive([{ t: "hostile", at: "late:raiders" }], LANDED).s;
    expect(at.attacking).toBe(true);
    const one = drive([arrive(0), ...ticks(RAID.torchS + 5)], at);
    expect(one.s.phase).not.toBe("resolved");
    const shot = drive([arrive(0), arrive(1), ...ticks(RAID.torchS - 3), { t: "actor", id: "raider-1", state: "down" }, ...ticks(10)], at);
    expect(shot.s.phase, "the torch clock stops when the pair is broken").not.toBe("resolved");
    expect(shot.s.torchSince).toBe(0);
    const burned = drive([arrive(0), arrive(1), ...ticks(RAID.torchS + 1)], at);
    expect(burned.s.resolution).toBe("post_burned");
    expect(burned.commits).toBe(1);
    expect(said(burned.fx)).toMatch(/stores go up/);
    // D-086: a raider who ran back out of the yard is no longer in it (he was, for good, and his torch kept the clock running with nobody in the yard)
    const fled = drive([arrive(0), arrive(1), ...ticks(RAID.torchS - 3), { t: "actor", id: "raider-1", state: "left" }, ...ticks(10)], at);
    expect(fled.s.phase, "the clock stops when one of the pair runs out").not.toBe("resolved");
    expect(fled.s.inYard).toEqual(["raider-0"]);
    const back = drive([arrive(1), ...ticks(RAID.torchS + 1)], fled.s);
    expect(back.s.resolution, "and starts again when he comes back").toBe("post_burned");
    expect(def.observe.actors.filter((a) => a.id.startsWith("raider-")).every((a) => a.leaves === true)).toBe(true);
  });

  it("post_held: the raiders broken (70% down or routed) ends it, whatever the yard", () => {
    const at = drive([{ t: "hostile", at: "late:raiders" }], LANDED).s;
    const total = at.crew.total;
    const most = drive([{ t: "count", group: "late:raiders", alive: total - (Math.ceil(total * RAID.brokenFraction) - 1), routed: 1, down: Math.ceil(total * RAID.brokenFraction) - 2, total }], at);
    expect(most.s.phase).not.toBe("resolved");
    const broken = drive([{ t: "count", group: "late:raiders", alive: total - Math.ceil(total * RAID.brokenFraction), routed: 1, down: Math.ceil(total * RAID.brokenFraction) - 1, total }], at);
    expect(broken.s.resolution).toBe("post_held");
    expect(broken.fx).toContainEqual({ k: "order", group: "late:raiders", order: { o: "flee" } });
  });

  it("protection_paid: the captain's price at the muster; refused or short, he comes in; before the landing there is nobody to pay", () => {
    expect(drive([talk("open")]).fx.some((f) => typeof f === "object" && f.k === "parley"), "nobody to talk to before the landing").toBe(false);
    const paid = drive([talk("open"), talk("paid", LANDED.price)], LANDED);
    expect(paid.s.resolution).toBe("protection_paid");
    expect(def.outcome(paid.s)).toMatchObject({ scenario: "outpost_raid", region: "kessar", paid: LANDED.price });
    for (const bad of [0, LANDED.price * 3, NaN]) expect(drive([talk("open"), talk("paid", bad)], LANDED).s.phase).not.toBe("resolved");
    const refused = drive([talk("open"), talk("hostile")], LANDED);
    expect(refused.s.attacking).toBe(true);
    expect(drive([talk("open")], refused.s).fx.some((f) => typeof f === "object" && f.k === "parley"), "past consulting").toBe(false);
  });

  it("leaving: before the landing commits nothing; after it the raid has its way; down is abandoned; frozen once resolved", () => {
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(LANDED)).toBe("post_burned");
    expect(drive([{ t: "party_down" }]).s.resolution).toBe("abandoned");
    const done = drive([talk("open"), talk("paid", LANDED.price)], LANDED).s;
    const after = drive([{ t: "hostile", at: "late:raiders" }, arrive(0), arrive(1), ...ticks(40), { t: "party_down" }], done);
    expect(after.s.resolution).toBe("protection_paid");
    expect(after.commits).toBe(0);
  });

  it("complications: reinforcements bring two more raiders (on the roster and in the count), rain slows the torches, fog the launch", () => {
    const by = new Map<string, { s: RaidState; c: CampaignState; seed: number }>();
    for (let seed = 1; seed < 800 && by.size < 4; seed++) {
      const c = { ...newCampaign(seed), purse: 100 };
      const s = def.init(c, 0, seed);
      if (!by.has(s.complication)) by.set(s.complication, { s, c, seed });
    }
    expect([...by.keys()].sort()).toEqual(["fog", "none", "rain", "reinforcements"]);
    const R = by.get("reinforcements")!;
    expect(R.s.crew.total).toBe(RAID.raiders + RAID.extraRaiders);
    // the tracker names how many it takes AND how many came (the browser look read "Break the raiders (0 of 5)" with seven ashore)
    const fighting = drive([...ticks(R.s.raidAt + 1), { t: "hostile", at: "late:raiders" }], R.s).s;
    expect(def.view(fighting, 0).objectives.find((o) => o.id === "break")?.text).toBe("Drop 5 of the 7 raiders, or send them running (0 so far)");
    expect(def.roster(R.c, R.seed, R.s).filter((p) => p.group === "late:raiders").length).toBe(RAID.raiders + RAID.extraRaiders);
    expect(by.get("fog")!.s.raidAt).toBeGreaterThanOrEqual(RAID.raidMin + RAID.fogRaid);
    const wet = drive([...ticks(by.get("rain")!.s.raidAt + 1), { t: "hostile", at: "late:raiders" }, arrive(0), arrive(1), ...ticks(RAID.torchS + 2)], by.get("rain")!.s);
    expect(wet.s.phase, "rain: the torches take longer").not.toBe("resolved");
  });

  it("D-047: a post's stout sheds take longer to fire, by its stage (a fort is worth defending from); no post, or an old presence, is the plain 15 s", () => {
    const presence = (partyPost?: string): RivalPresence => ({ goal: "sabotage_party", arrivesInS: 200, escort: 1, wagon: false, surveyors: 1, postStage: 0, raidDue: true, ...(partyPost ? { partyPost } : {}) } as RivalPresence);
    const burnAt = (st?: string): number => {
      const s0 = def.init(C, 0, SEED, presence(st));
      const at = drive([...ticks(s0.raidAt + 1), { t: "hostile", at: "late:raiders" }, arrive(0), arrive(1)], s0).s;
      let t = 0;
      let s = at;
      while (s.phase !== "resolved" && t < 60) { s = def.reduce(s, { t: "tick", dt: 1 }).s; t++; }
      return t;
    };
    const base = burnAt();
    const wet = def.init(C, 0, SEED, presence()).complication === "rain" ? RAID.rainTorch : 0;   // (the same deal for every stage: the complication does not read the post)
    expect(base - wet).toBeGreaterThanOrEqual(RAID.torchS);
    expect(base - wet).toBeLessThanOrEqual(RAID.torchS + 1);
    expect(burnAt("camp")).toBe(base);
    expect(burnAt("trading_post") - base).toBe(RAID.stout.trading_post);
    expect(burnAt("fortified_outpost") - base).toBe(RAID.stout.fortified_outpost);
    expect(burnAt("town") - base).toBe(RAID.stout.town);
    // and the tracker says the real number
    const s0 = def.init(C, 0, SEED, presence("fortified_outpost"));
    const yard = drive([...ticks(s0.raidAt + 1), { t: "hostile", at: "late:raiders" }, arrive(0), arrive(1)], s0);
    expect(said(yard.fx)).toContain(`${RAID.torchS + RAID.stout.fortified_outpost + wet} seconds and the stores go up`);
    // an old presence (no partyPost) keeps the state byte-identical to before D-047
    expect("stout" in def.init(C, 0, SEED, presence())).toBe(false);
  });

  it("a stockaded post keeps a watch: riflemen on the party's side, by stage, who come down to the gate when the party reaches the post (once), never if it stays away", () => {
    const presence = (partyPost?: string): RivalPresence => ({ goal: "sabotage_party", arrivesInS: 200, escort: 1, wagon: false, surveyors: 1, postStage: 0, raidDue: true, ...(partyPost ? { partyPost } : {}) } as RivalPresence);
    for (const st of OUTPOST_STAGES) {
      const s0 = def.init(C, 0, SEED, presence(st));
      const want = RAID.watch[st];
      expect(s0.watch ?? 0, st).toBe(want);
      const watch = def.roster(C, SEED, s0).filter((p) => p.id.startsWith("watch-"));
      expect(watch.length, st).toBe(want);
      for (const w of watch) {
        expect(w).toMatchObject({ side: "party", group: "late:watch", brain: "garrison", weapon: WEAPON.RIFLE, role: NPC.HIRED_RIFLE });
        expect(Math.hypot(w.post.x - KESSAR_OUTPOST.site.x, w.post.z - KESSAR_OUTPOST.site.z), `${st}: inside the stockade`).toBeLessThan(15);
      }
      // nobody is on the ground until something calls them
      expect(def.roster(C, SEED, s0).every((p) => p.group.startsWith("late:"))).toBe(true);
      // the party reaches the post: the watch comes out, once (not again on a second arrival), and the tracker says so
      const spawned = (fx: Fx[]): number => fx.filter((f) => typeof f === "object" && f.k === "spawn" && f.group === "late:watch").length;
      const arrived = drive([{ t: "near", at: "post", party: 1 }, { t: "near", at: "post", party: 0 }, { t: "near", at: "post", party: 2 }], s0);
      expect(spawned(arrived.fx), st).toBe(want > 0 ? 1 : 0);
      if (want > 0) {
        expect(def.view(s0, 0).hint).toContain("it will stand with you once you are there");
        expect(def.view(arrived.s, 0).hint).toContain(`The post's watch (${want} rifles) stands inside the gate`);
        expect(said(arrived.fx)).toContain(`${want} Society pensioners with rifles`);
      } else expect(def.view(arrived.s, 0).hint).not.toContain("watch (");
      // a party that never comes has no watch: the raid lands, attacks and burns with nobody out
      const away = drive([...ticks(s0.raidAt + 1), { t: "hostile", at: "late:raiders" }], s0);
      expect(spawned(away.fx), `${st} away`).toBe(0);
      // and a resolved raid calls nobody
      expect(spawned(def.reduce({ ...s0, phase: "resolved", resolution: "post_burned" }, { t: "near", at: "post", party: 1 }).fx)).toBe(0);
    }
    expect(RAID.watch.fortified_outpost, "a fortified post is held with help").toBeGreaterThan(0);
    // a stage only has a watch if it has a stockade to keep (the gate the watch stands inside)
    for (const st of OUTPOST_STAGES) expect(RAID.watch[st] > 0, st).toBe(outpostPlan(st).gate !== undefined);
    expect("watch" in def.init(C, 0, SEED, presence())).toBe(false);
  });

  it("the people and the observe spec agree; under the cap", () => {
    const r = def.roster(C, SEED, S0);
    const ids = r.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.length).toBeLessThanOrEqual(Math.min(14, NPC_CAP));
    expect(r.every((p) => p.group.startsWith("late:"))).toBe(true);
    // everyone the raid marches walks (the Cast's civil brain ignores a march: the bot playtest's captain stood at the landing while his demand ran out)
    expect(r.filter((p) => p.brain === "civil").map((p) => p.id)).toEqual([]);
    for (const u of def.observe.use) if (u.npc) expect(ids).toContain(u.npc);
    const v = openSiteParley("raid_captain", { price: S0.price, purse: 200, seed: 3, day: 2 });
    expect(answerSiteParley("raid_captain", { price: S0.price, purse: 200, seed: 3, day: 2 }, v, v.options.findIndex((o) => /protection/.test(o.label)))).toMatchObject({ done: { result: "paid", paid: S0.price } });
  });
});

describe("the raid in the campaign (D-045)", () => {
  const presence = (o: Partial<RivalPresence> = {}): RivalPresence => ({ goal: "sabotage_party", arrivesInS: 200, escort: 1, wagon: false, surveyors: 1, postStage: 0, ...o });
  it("Kessar offers it while a raid is due, and never otherwise (old presences carry no raidDue)", () => {
    let c = newCampaign(4);
    c = applyOutcome(c, { scenario: "secure_crossing", resolution: "paid", toll: 30, paid: 30, bridge: "intact", tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 }, brokePromise: false, seconds: 60 });
    for (let s = 1; s <= 30; s++) {
      expect(pickTemplate(c, "kessar", s, presence())).not.toBe("outpost_raid");
      expect(pickTemplate(c, "kessar", s)).not.toBe("outpost_raid");
    }
    const due = Array.from({ length: 30 }, (_, s) => pickTemplate(c, "kessar", s + 1, presence({ raidDue: true })));
    expect(due.filter((t) => t === "outpost_raid").length, "the raid is the likeliest thing on offer while it is due").toBeGreaterThan(15);
    // never at another region
    for (const r of ["highmark", "vesper", "saltmarket"] as const) expect(pickTemplate(c, r, 3, presence({ raidDue: true }))).not.toBe("outpost_raid");
  });

  it("rivalPresence reports a raid due only for the sabotage goal, with a post standing and not yet raided", () => {
    const p0 = newPowers(5);
    const p = { ...p0, rival: { ...p0.rival, goal: "sabotage_party" as const }, flags: withFlag(p0.flags, "party_post") };
    expect(rivalPresence(newCampaign(5), p).raidDue).toBe(true);
    expect("raidDue" in rivalPresence(newCampaign(5), { ...p, flags: withFlag(p.flags, "party_post_raided") })).toBe(false);
    expect("raidDue" in rivalPresence(newCampaign(5), { ...p, rival: { ...p.rival, goal: "lie_low" } })).toBe(false);
    expect("raidDue" in rivalPresence(newCampaign(5), p0)).toBe(false);
  });

  it("the aftermath: every raid ending spends the Syndicate's raid; burned or down lands it, held steadies the post, paid leaves it be; other contracts pass through", () => {
    const p = newPowers(6);
    const o = (resolution: ScenarioOutcome["resolution"], scenario: ScenarioOutcome["scenario"] = "outpost_raid"): ScenarioOutcome =>
      ({ scenario, resolution, toll: 0, paid: 0, bridge: "intact", tally: { wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 }, brokePromise: false, seconds: 60, region: "kessar" });
    expect(raidAftermath(p, o("post_burned"))).toMatchObject({ raid: true, defended: false });
    expect(raidAftermath(p, o("abandoned"))).toMatchObject({ raid: true, defended: false });
    expect(raidAftermath(p, o("post_held"))).toMatchObject({ raid: false, defended: true });
    expect(raidAftermath(p, o("protection_paid"))).toMatchObject({ raid: false, defended: false });
    for (const r of ["post_burned", "post_held", "protection_paid", "abandoned"] as const) expect(hasFlag(raidAftermath(p, o(r)).p, "party_post_raided"), r).toBe(true);
    const other = raidAftermath(p, o("paid", "secure_crossing"));
    expect(other.p).toBe(p);
    expect(other).toMatchObject({ raid: false, defended: false });
    // a held post's watch is steadier; a post that is not there is untouched
    const s = foundOutpost(newSettlements(), "kessar", newCampaign(6), 6);
    const camp = { ...s, posts: { ...s.posts, kessar: { ...s.posts.kessar!, stage: "camp" as const, security: 40 } } };
    expect(defendOutpost(camp, "kessar").posts.kessar!.security).toBe(55);
    expect(defendOutpost(newSettlements(), "kessar")).toEqual(newSettlements());
  });
});

describe("the raid's ground (D-045): every stage, both bridges, five seeds", () => {
  it("the landing, the muster, every assault waypoint and the yard are open on the nav grid, and every leg the Cast walks straight is clear", () => {
    const pts = [RAID_SITES.landing, RAID_SITES.muster, RAID_SITES.ranks, ...RAID_SITES.route, ...RAID_SITES.assault];
    expect(RAID_SITES.assault.slice(0, RAID_SITES.route.length), "the assault is the muster walk, continued").toEqual(RAID_SITES.route);
    for (const seed of [1, 7, 19, 42, 91, 4242, 4243]) for (const st of OUTPOST_STAGES) for (const bridge of ["intact", "collapsed"] as const) {
      const w = createKessarWorld(seed, bridge, { outpost: st, telegraph: st === "town" });
      const q = new NavQuery(buildNavGrid(w, kessarNavOptions(w)));
      for (const p of pts) expect(q.open(p.x, p.z), `${st} ${bridge} @${seed}: ${p.x},${p.z} open`).toBe(true);
      // (the bot playtest's town-stage check found 52,58 -> 46,60 through a house; the Cast does not plan between a route's points)
      for (const r of [RAID_SITES.route, RAID_SITES.assault]) for (let i = 1; i < r.length; i++) {
        expect(q.los(r[i - 1]!.x, r[i - 1]!.z, r[i]!.x, r[i]!.z), `${st} ${bridge} @${seed}: ${r[i - 1]!.x},${r[i - 1]!.z} -> ${r[i]!.x},${r[i]!.z}`).toBe(true);
      }
      // the watch stands on open ground and sees out of the gate to where the assault comes round to it, and across the yard
      const gateApproach = RAID_SITES.assault[RAID_SITES.route.length + 1]!;
      for (const w of WATCH_POSTS.slice(0, RAID.watch[st])) {
        expect(q.open(w.x, w.z), `${st} ${bridge} @${seed}: watch ${w.x},${w.z} open`).toBe(true);
        expect(q.los(w.x, w.z, gateApproach.x, gateApproach.z), `${st} ${bridge} @${seed}: watch ${w.x},${w.z} sees the gate's approach`).toBe(true);
        expect(q.los(w.x, w.z, KESSAR_OUTPOST.site.x, KESSAR_OUTPOST.site.z), `${st} ${bridge} @${seed}: watch ${w.x},${w.z} sees the yard`).toBe(true);
      }
    }
  }, 600_000);
});
