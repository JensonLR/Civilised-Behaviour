import { describe, expect, it } from "vitest";
import type { CampaignState, CasualtyTally, ResolutionId, ScenarioOutcome, ScenarioTemplateId } from "./campaignTypes.ts";
import { HISTORY_CAP, NEEDS, POWERS, RESOLUTIONS, STANCES, TEMPLATE_RESOLUTIONS, TOLL_MAX, TOLL_MIN, WARD, applyOutcome, askingToll, consequenceLines, leverageOf, newCampaign, parseCampaign, serializeCampaign, stanceOf, wardMemory } from "./factions.ts";
import { Rng } from "./rng.ts";

const zero = (): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0 });
const outcome = (resolution: ResolutionId, o: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  scenario: "secure_crossing", resolution, toll: 50, paid: 0, bridge: "intact", tally: zero(), brokePromise: false, seconds: 120, ...o,
});
/** Realistic outcome per resolution, as the scenario would hand it over. */
const typical = (r: ResolutionId): ScenarioOutcome =>
  r === "paid" ? outcome(r, { paid: 50 }) : r === "bargained" ? outcome(r, { paid: 35 }) : r === "bribed" ? outcome(r, { paid: 25 })
  : r === "forced" ? outcome(r, { tally: { ...zero(), garrisonKilled: 3, garrisonRouted: 2 } }) : r === "sabotaged" ? outcome(r, { bridge: "collapsed" }) : outcome(r);
const isInt = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n);

function allNumbers(c: CampaignState): number[] {
  const out: number[] = [c.seed, c.day, c.expeditions, c.purse, c.lies, c.crossing.toll, c.crossing.tollPaidTotal, ...Object.values(c.tally)];
  for (const f of Object.values(c.factions)) out.push(f.trust, f.fear, f.grievance, f.playerInfluence, f.rivalInfluence, f.militaryStrength, f.prosperity);
  for (const h of c.history) out.push(h.seq, h.day);
  return out;
}

describe("campaign ledger", () => {
  it("starts as the slice spec says and round-trips through JSON", () => {
    const c = newCampaign(12345);
    expect(c.purse).toBe(120);
    expect(c.factions.ward).toMatchObject({ trust: 35, fear: 10, grievance: 15, militaryStrength: 55, prosperity: 50, need: "coin" });
    expect(c.factions.rival.rivalInfluence).toBe(30);
    expect(c.crossing).toMatchObject({ bridge: "intact", control: "ward", toll: 0 });
    const json = serializeCampaign(c);
    expect(json.length).toBeLessThan(4096);
    expect(parseCampaign(json)).toEqual(c);
    expect(serializeCampaign(parseCampaign(json)!)).toBe(json);
  });

  it("parse survives 2000 hostile strings: never throws, always clamped integers", () => {
    const rng = new Rng(77);
    const junk = [NaN, Infinity, -Infinity, 1e308, -1e308, 0.5, -7, "9", null, true, {}, [], "x".repeat(50), 2 ** 53, -(2 ** 40)];
    const base = JSON.parse(serializeCampaign(newCampaign(9))) as Record<string, unknown>;
    const mutate = (o: unknown, depth = 0): unknown => {
      if (Array.isArray(o)) return o.map((v) => mutate(v, depth + 1));
      if (o && typeof o === "object") {
        const r: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(o)) r[k] = rng.chance(0.25) ? junk[rng.int(0, junk.length - 1)] : mutate(v, depth + 1);
        if (rng.chance(0.1)) r["__proto__"] = { v: 2 };
        return r;
      }
      return o;
    };
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      let text: string;
      const k = i % 5;
      if (k === 0) text = JSON.stringify(mutate(base)) ?? "";
      else if (k === 1) { const n = rng.int(1, 40); text = "[".repeat(n * 2000) + "]".repeat(n * 2000); }
      else if (k === 2) text = Array.from({ length: rng.int(0, 60) }, () => String.fromCharCode(rng.int(0, 255))).join("");
      else if (k === 3) text = JSON.stringify({ ...(mutate(base) as object), history: Array.from({ length: rng.int(0, 60) }, () => mutate({ seq: 1, region: "kessar", resolution: "paid", day: 2 })) });
      else text = `{"v":1,"seed":${rng.int(-5, 5) * 1e15},"purse":${rng.range(-1e9, 1e9)},"factions":{"ward":{"trust":1e400,"need":"x"}}}`;
      let c: CampaignState | undefined;
      expect(() => { c = parseCampaign(text); }).not.toThrow();
      if (!c) continue;
      accepted++;
      for (const n of allNumbers(c)) expect(isInt(n), text.slice(0, 80)).toBe(true);
      for (const f of Object.values(c.factions)) {
        for (const n of [f.trust, f.fear, f.grievance, f.playerInfluence, f.rivalInfluence, f.militaryStrength, f.prosperity]) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(100); }
        expect(NEEDS).toContain(f.need);
      }
      expect(c.history.length).toBeLessThanOrEqual(HISTORY_CAP);
      expect(c.purse).toBeGreaterThanOrEqual(0);
      expect(c.v).toBe(1);
    }
    expect(accepted).toBeGreaterThan(300);   // the fuzz actually exercised the clamping path
    expect(parseCampaign("")).toBeUndefined();
    expect(parseCampaign('{"v":2}')).toBeUndefined();
    expect(parseCampaign("x".repeat(9000))).toBeUndefined();
    expect(parseCampaign('{"v":1,"seed":5,"factions":5}')?.factions.ward.trust).toBe(35);
  });
});

describe("stance and asking price", () => {
  it("cut points are trust - grievance + fear/2 at -10 / 10 / 30 / 55", () => {
    const f = newCampaign(1).factions.ward;
    const at = (score: number) => stanceOf({ ...f, trust: Math.max(0, score), grievance: Math.max(0, -score), fear: 0 });
    expect([at(-11), at(-10), at(9), at(10), at(29), at(30), at(54), at(55)]).toEqual(["hostile", "wary", "wary", "neutral", "neutral", "warm", "warm", "allied"]);
    expect(stanceOf(f)).toBe("neutral");
    expect(stanceOf({ ...f, trust: 0, grievance: 0, fear: 100 })).toBe("warm");   // fear alone buys deference, not love
  });

  it("asking toll is an integer in 25..90 over any state, and warmer stances are cheaper", () => {
    const rng = new Rng(5);
    const c = newCampaign(1);
    for (let i = 0; i < 500; i++) {
      const w = { ...c.factions.ward, trust: rng.int(0, 100), fear: rng.int(0, 100), grievance: rng.int(0, 100), prosperity: rng.int(0, 100), rivalInfluence: rng.int(0, 100), need: NEEDS[rng.int(0, 3)]! };
      const t = askingToll({ ...c, factions: { ...c.factions, ward: w } });
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(TOLL_MIN);
      expect(t).toBeLessThanOrEqual(TOLL_MAX);
    }
    const by = (trust: number, grievance: number) => askingToll({ ...c, factions: { ...c.factions, ward: { ...c.factions.ward, trust, grievance, fear: 0 } } });
    expect(by(80, 0)).toBeLessThan(by(35, 15));
    expect(by(35, 15)).toBeLessThan(by(0, 60));
    const rivalUp = askingToll({ ...c, factions: { ...c.factions, ward: { ...c.factions.ward, rivalInfluence: 90 } } });
    expect(rivalUp).toBeGreaterThan(askingToll(c));
  });

  it("the powers are fictional data: the Ward is fully authored, three more are sketched", () => {
    expect(POWERS.length).toBe(4);
    expect(new Set(POWERS.map((p) => p.id)).size).toBe(4);
    expect(WARD.leader.speaker).toContain(WARD.leader.name);
    for (const p of POWERS) for (const r of p.rivals) expect(POWERS.some((q) => q.id === r) || r === "rival").toBe(true);
    expect(STANCES.length).toBe(5);
  });
});

describe("applyOutcome", () => {
  const FIELDS = (c: CampaignState): unknown[] => [c.crossing.bridge, c.crossing.control, c.crossing.toll, c.factions.ward.trust, c.factions.ward.fear, c.factions.ward.grievance, c.factions.ward.prosperity, c.purse];
  const six: ResolutionId[] = ["paid", "bargained", "bribed", "forced", "sabotaged", "rival_secured"];

  it("every pair of the six real resolutions differs in at least 3 of (bridge, control, toll, trust, fear, grievance, prosperity, purse)", () => {
    const base = newCampaign(3);
    for (let i = 0; i < six.length; i++) {
      for (let j = i + 1; j < six.length; j++) {
        const a = FIELDS(applyOutcome(base, typical(six[i]!))), b = FIELDS(applyOutcome(base, typical(six[j]!)));
        const diff = a.filter((v, k) => v !== b[k]).length;
        expect(diff, `${six[i]} vs ${six[j]}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("follows the outcome table: each resolution leaves the crossing the way the design says", () => {
    const base = newCampaign(3);
    const r = (x: ResolutionId) => applyOutcome(base, typical(x));
    expect(r("paid")).toMatchObject({ purse: 70, crossing: { control: "ward", toll: 50, bridge: "intact" } });
    expect(r("bargained")).toMatchObject({ purse: 85, crossing: { toll: 35 } });
    expect(r("bargained").factions.ward.trust).toBeGreaterThan(r("paid").factions.ward.trust);
    expect(r("bribed")).toMatchObject({ lies: 1, crossing: { toll: 0, bribed: true } });
    expect(r("forced")).toMatchObject({ crossing: { control: "society", toll: 0 } });
    expect(r("forced").factions.ward.militaryStrength).toBe(55 - 6 * 3 - 2 * 2);
    expect(r("forced").factions.ward.fear).toBeGreaterThan(base.factions.ward.fear);
    expect(r("forced").factions.ward.trust).toBeLessThan(base.factions.ward.trust);
    expect(r("sabotaged")).toMatchObject({ purse: 120, crossing: { bridge: "collapsed" } });
    expect(r("sabotaged").factions.ward.rivalInfluence).toBeGreaterThan(base.factions.ward.rivalInfluence);
    expect(r("rival_secured")).toMatchObject({ crossing: { control: "rival" } });
    expect(r("rival_secured").factions.ward.playerInfluence).toBeLessThan(base.factions.ward.playerInfluence);
    expect(r("abandoned")).toMatchObject({ purse: 120 });
    expect(r("abandoned").factions.ward.grievance).toBeGreaterThan(base.factions.ward.grievance);
    for (const x of RESOLUTIONS) expect(r(x)).toMatchObject({ day: 2, expeditions: 1 });
  });

  it("is pure and deterministic, clamps everything, and never overdraws the purse", () => {
    const base = newCampaign(11);
    const snap = serializeCampaign(base);
    const big = outcome("forced", { paid: 99999, tally: { wounded: 5000, downed: 9, limbsLost: 99, garrisonKilled: 99, garrisonRouted: 99, civiliansHarmed: 99, rivalKilled: 99 }, brokePromise: true });
    const a = applyOutcome(base, big), b = applyOutcome(base, big);
    expect(serializeCampaign(base)).toBe(snap);
    expect(serializeCampaign(a)).toBe(serializeCampaign(b));
    expect(a.purse).toBeGreaterThanOrEqual(0);
    for (const n of allNumbers(a)) expect(isInt(n)).toBe(true);
    for (const f of Object.values(a.factions)) for (const n of [f.trust, f.fear, f.grievance, f.militaryStrength, f.prosperity]) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(100); }
    expect(a.lies).toBe(1);
    expect(parseCampaign(serializeCampaign(a))).toEqual(a);
  });

  it("history is capped at 12 and the ledger stays under the wire budget after a long campaign", () => {
    let c = newCampaign(2);
    for (let i = 0; i < 40; i++) c = applyOutcome(c, typical(RESOLUTIONS[i % RESOLUTIONS.length]!));
    expect(c.history.length).toBe(HISTORY_CAP);
    expect(c.history[c.history.length - 1]!.seq).toBe(40);
    expect(c.expeditions).toBe(40);
    expect(serializeCampaign(c).length).toBeLessThan(4096);
  });

  it("a collapsed bridge stays collapsed; a bribe surfaces as grievance on the next run if it was destined to", () => {
    const c1 = applyOutcome(newCampaign(3), typical("sabotaged"));
    expect(applyOutcome(c1, typical("paid")).crossing.bridge).toBe("collapsed");
    // rivalInfluence >= 50 forces exposure
    const hot = newCampaign(3); hot.factions.ward.rivalInfluence = 70;
    const b = applyOutcome(hot, typical("bribed"));
    expect(b.crossing).toMatchObject({ bribed: true, exposed: true });
    const next = applyOutcome(b, outcome("abandoned"));
    const control = applyOutcome({ ...b, crossing: { ...b.crossing, bribed: false, exposed: false } }, outcome("abandoned"));
    expect(next.factions.ward.grievance - control.factions.ward.grievance).toBe(20);
    expect(next.crossing).toMatchObject({ bribed: false, exposed: true });
    expect(applyOutcome(next, outcome("abandoned")).crossing.exposed).toBe(false);
    // deterministic when rival influence is low: same campaign, same verdict
    const calm = newCampaign(99); calm.factions.ward.rivalInfluence = 10;
    expect(applyOutcome(calm, typical("bribed")).crossing.exposed).toBe(applyOutcome(calm, typical("bribed")).crossing.exposed);
    const verdicts = new Set(Array.from({ length: 40 }, (_, s) => applyOutcome({ ...calm, seed: s }, typical("bribed")).crossing.exposed));
    expect(verdicts.size).toBe(2);   // not always, not never
  });
});

describe("the Ward remembers", () => {
  it("memory decays by expedition and grows with lies", () => {
    let c = newCampaign(1);
    c = applyOutcome(c, typical("forced"));
    const fresh = wardMemory(c);
    expect(fresh).toMatchObject({ last: "forced", repeat: 1 });
    expect(fresh.resentment).toBeGreaterThan(40);
    const later = wardMemory(applyOutcome(applyOutcome(c, typical("paid")), typical("paid")));
    expect(later.resentment).toBeLessThan(fresh.resentment);
    expect(later.gratitude).toBeGreaterThan(0);
    expect(later.repeat).toBe(2);
    expect(wardMemory({ ...c, lies: 5 }).contempt).toBeGreaterThan(fresh.contempt);
    expect(wardMemory(newCampaign(1))).toMatchObject({ gratitude: 0, resentment: 0, last: undefined });
  });

  it("leverage is clamped and reads the campaign", () => {
    const c = newCampaign(1);
    const lv = leverageOf(c, { armed: 99, garrisonAlive: -4, garrisonTotal: 6, partyWounded: NaN });
    expect(lv).toEqual({ purse: 120, armed: 16, garrisonAlive: 0, garrisonTotal: 6, partyWounded: 0, rivalInfluence: 30, lies: 0 });
  });

  it("consequence lines describe what changed and nothing else", () => {
    const c = newCampaign(1);
    expect(consequenceLines(c, c)).toEqual([]);
    const lines = consequenceLines(c, applyOutcome(c, typical("sabotaged"))).join(" ");
    expect(lines).toMatch(/bridge is collapsed/);
    expect(lines).toMatch(/Nobody holds the crossing/);
  });
});

describe("applyOutcome: the three newer contracts (D-034)", () => {
  const OTHERS = ["hostage_rescue", "convoy_ambush", "border_incident"] as const;
  const FIELDS = (c: CampaignState): unknown[] => [
    c.crossing.bridge, c.crossing.control, c.crossing.toll, c.factions.ward.trust, c.factions.ward.fear, c.factions.ward.grievance, c.factions.ward.prosperity, c.factions.ward.playerInfluence,
    c.factions.ward.rivalInfluence, c.factions.ward.militaryStrength, c.factions.ward.need, c.factions.rival.militaryStrength, c.factions.rival.prosperity, c.factions.rival.grievance,
    c.purse, c.lies, JSON.stringify(c.sites), c.history[c.history.length - 1]!.resolution,
  ];
  const run = (scenario: ScenarioTemplateId, r: ResolutionId, o: Partial<ScenarioOutcome> = {}, base = newCampaign(3)): CampaignState =>
    applyOutcome(base, { scenario, resolution: r, toll: 0, paid: 0, bridge: "intact", tally: zero(), brokePromise: false, seconds: 100, ...o });

  it("every pair of endings WITHIN a template differs in at least 3 campaign fields", () => {
    for (const t of OTHERS) {
      const rs = TEMPLATE_RESOLUTIONS[t];
      expect(rs.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const extra = (r: ResolutionId): Partial<ScenarioOutcome> => (r === "ransomed" ? { paid: 45 } : r === "seized" ? { loot: 60 } : {});
        const a = FIELDS(run(t, rs[i]!, extra(rs[i]!))), b = FIELDS(run(t, rs[j]!, extra(rs[j]!)));
        const diff = a.filter((v, k) => v !== b[k]).length;
        expect(diff, `${t}: ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("never touches the crossing: bridge, control and toll stay, and the ledger and history say which template ran", () => {
    const base = applyOutcome(newCampaign(3), { scenario: "secure_crossing", resolution: "paid", toll: 50, paid: 50, bridge: "intact", tally: zero(), brokePromise: false, seconds: 1 });
    for (const t of OTHERS) for (const r of TEMPLATE_RESOLUTIONS[t]) {
      const c = run(t, r, {}, base);
      expect(c.crossing, `${t}/${r}`).toEqual({ ...base.crossing, bribed: false, exposed: false });
      expect(c.history[c.history.length - 1]).toMatchObject({ template: t, resolution: r });
      expect(c.sites.lastDay[t], `${t}/${r}`).toBe(base.day + 1);
    }
  });

  it("money: a ransom is paid from the purse, seized cargo comes into it, neither is toll", () => {
    const base = newCampaign(3);
    expect(run("hostage_rescue", "ransomed", { paid: 45 }).purse).toBe(base.purse - 45);
    expect(run("hostage_rescue", "ransomed", { paid: 45 }).crossing.tollPaidTotal).toBe(0);
    expect(run("hostage_rescue", "ransomed", { paid: 9999 }).purse).toBe(0);
    expect(run("convoy_ambush", "seized", { loot: 60 }).purse).toBe(base.purse + 60);
    expect(run("convoy_ambush", "burned", { loot: 60 }).purse).toBe(base.purse + 60);   // the rule is the outcome's, not the resolution's: the scenario simply never offers it
  });

  it("the ledger remembers: hostage, convoy, border and the complication dealt", () => {
    expect(run("hostage_rescue", "slipped_away", { complication: "rain" }).sites).toMatchObject({ hostage: "freed", convoy: "none", lastComplication: "rain" });
    expect(run("hostage_rescue", "hostage_lost").sites.hostage).toBe("lost");
    expect(run("convoy_ambush", "tipped_off").sites.convoy).toBe("tipped");
    expect(run("convoy_ambush", "passed").sites.convoy).toBe("passed");
    expect(run("border_incident", "sided_syndicate").sites.border).toBe("syndicate");
    expect(run("border_incident", "provoked").sites.border).toBe("war");
    expect(run("border_incident", "mediated", { complication: "none" }, run("border_incident", "escalated", { complication: "fog" })).sites).toMatchObject({ border: "mediated", lastComplication: "none" });
  });

  it("swings the powers: the Syndicate is armed by a passed wagon and weakened by a seized one; two sides trading fire weaken both", () => {
    const base = newCampaign(3);
    expect(run("convoy_ambush", "passed").factions.rival.militaryStrength).toBeGreaterThan(base.factions.rival.militaryStrength);
    expect(run("convoy_ambush", "seized").factions.rival.militaryStrength).toBeLessThan(base.factions.rival.militaryStrength);
    const esc = run("border_incident", "escalated");
    expect(esc.factions.ward.militaryStrength).toBeLessThan(base.factions.ward.militaryStrength);
    expect(esc.factions.rival.militaryStrength).toBeLessThan(base.factions.rival.militaryStrength);
    expect(run("border_incident", "sided_syndicate").factions.ward.grievance).toBeGreaterThan(run("border_incident", "sided_ward").factions.ward.grievance);
    expect(run("hostage_rescue", "hostage_lost").factions.ward.rivalInfluence).toBeGreaterThan(base.factions.ward.rivalInfluence);
  });

  it("no trust farming: the third identical good ending moves the Ward by half as much", () => {
    let c = newCampaign(3);
    const gains: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = c.factions.ward.trust;
      c = run("border_incident", "sided_ward", {}, c);
      gains.push(c.factions.ward.trust - before);
    }
    expect(gains[2]).toBeLessThan(gains[0]!);
    expect(wardMemory(c).repeat).toBe(4);
  });

  it("parse: a hostile site ledger is clamped, and an old save (no sites, no template) loads with defaults", () => {
    const c = run("convoy_ambush", "burned", { complication: "outriders" });
    expect(parseCampaign(serializeCampaign(c))).toEqual(c);
    const old = JSON.parse(serializeCampaign(newCampaign(2))) as Record<string, unknown>;
    delete old.sites;
    expect(parseCampaign(JSON.stringify(old))?.sites).toEqual({ lastDay: {}, hostage: "none", convoy: "none", border: "quiet", lastComplication: "none", succession: "open" });
    const bad = { ...JSON.parse(serializeCampaign(c)), sites: { lastDay: { hostage_rescue: 1e9, nonsense: 4 }, hostage: "x", convoy: 7, border: null, lastComplication: "<script>" }, history: [{ seq: 1, region: "kessar", resolution: "paid", day: 2, template: "elsewhere" }] };
    const p = parseCampaign(JSON.stringify(bad))!;
    expect(p.sites).toEqual({ lastDay: { hostage_rescue: 9999 }, hostage: "none", convoy: "none", border: "quiet", lastComplication: "none", succession: "open" });
    expect(p.history[0]!.template).toBe("secure_crossing");
  });

  it("the ledger stays inside the wire budget after a long campaign across all four contracts", () => {
    let c = newCampaign(11);
    const all: [ScenarioTemplateId, ResolutionId][] = OTHERS.flatMap((t) => TEMPLATE_RESOLUTIONS[t].map((r): [ScenarioTemplateId, ResolutionId] => [t, r]));
    for (let i = 0; i < 40; i++) { const [t, r] = all[i % all.length]!; c = run(t, r, { complication: "reinforcements" }, c); }
    expect(c.history.length).toBe(HISTORY_CAP);
    expect(serializeCampaign(c).length).toBeLessThan(4096);
  });

  it("consequence lines name what the newer contracts changed", () => {
    const base = newCampaign(3);
    expect(consequenceLines(base, run("hostage_rescue", "rescued")).join(" ")).toMatch(/Quim is home/);
    expect(consequenceLines(base, run("hostage_rescue", "hostage_lost")).join(" ")).toMatch(/did not come home/);
    expect(consequenceLines(base, run("convoy_ambush", "burned")).join(" ")).toMatch(/bonfire/);
    expect(consequenceLines(base, run("border_incident", "mediated")).join(" ")).toMatch(/Marker Stone No. 4/);
  });
});
