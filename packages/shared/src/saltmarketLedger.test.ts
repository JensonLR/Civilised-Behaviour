import { describe, expect, it } from "vitest";
import { type CampaignState, type CasualtyTally, type ResolutionId, type ScenarioOutcome, type ScenarioTemplateId } from "./campaignTypes.ts";
import { POWERS, TEMPLATE_RESOLUTIONS, applyOutcome, consequenceLines, newCampaign, parseCampaign, serializeCampaign, wardMemory } from "./factions.ts";
import { COMPLICATION_POOL } from "./chaos.ts";
import { MEMORY_LINE } from "./negotiationText.ts";
import { generatePaper } from "./newspaper.ts";
import { HEADLINES, SITE_LINES, STANDFIRSTS, STORY_HEADS } from "./newspaperText.ts";
import { HISTORY_PIECE } from "./outpostText.ts";
import { PALETTE } from "./palette.ts";
import { HOOKS, NEWS } from "./powersText.ts";
import { eventItem, newPowers, parsePowers, powersAfterOutcome, powersDispatches, serializePowers } from "./powers.ts";
import { REGION_COPY } from "./regionCopy.ts";
import { SALTMARKET_RESOLUTIONS, TEMPLATE_REGION, type SaltmarketEnding } from "./regionEndings.ts";
import { RELATION_FX } from "./relations.ts";
import { GRUDGE_FX } from "./rival.ts";
import { SALTMARKET_COMPLICATIONS, SALTMARKET_ENDINGS, SALTMARKET_FAVOUR, pickSaltmarketContract } from "./saltmarketLedger.ts";
import { SALTMARKET_COPY, SALTMARKET_SIGNS } from "./saltmarketText.ts";
import { SALTMARKET_PALETTE, SALTMARKET_SWATCH } from "./paletteSaltmarket.ts";
import { SCRIPTED_KINDS, answerSiteParley, openSiteParley, parleyScript } from "./scenarios/parleys.ts";
import { pickTemplate } from "./scenarios/registry.ts";
import type { PowersState } from "./worldTypes.ts";
import { POWERS_JSON_MAX } from "./worldTypes.ts";

const tally = (t: Partial<CasualtyTally> = {}): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0, ...t });
const out = (scenario: ScenarioTemplateId, resolution: ResolutionId, o: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  scenario, resolution, toll: 0, paid: 0, bridge: "intact", tally: tally(), brokePromise: false, seconds: 400, region: "saltmarket", ...o,
});
/** What each ending would realistically hand the ledger (distinct outcomes: money, loot, blood, a broken promise). */
const OUTCOMES: Record<SaltmarketEnding, ScenarioOutcome> = {
  landed: out("smuggling_run", "landed", { loot: 66 }),
  impounded: out("smuggling_run", "impounded", { tally: tally({ wounded: 1 }) }),
  scuttled: out("smuggling_run", "scuttled"),
  informed: out("smuggling_run", "informed", { loot: 60 }),
  lot_won: out("flooded_market", "lot_won", { paid: 100 }),
  consortium: out("flooded_market", "consortium", { paid: 25 }),
  shorted: out("flooded_market", "shorted", { loot: 35, brokePromise: true }),
  washed_out: out("flooded_market", "washed_out", { paid: 40 }),
  survey_home: out("lost_survey", "survey_home", { paid: 65 }),
  chart_ceded: out("lost_survey", "chart_ceded"),
  survey_sold: out("lost_survey", "survey_sold", { loot: 55 }),
  survey_lost: out("lost_survey", "survey_lost", { tally: tally({ wounded: 1 }) }),
};
const TEMPLATES = {
  smuggling_run: ["landed", "impounded", "scuttled", "informed"], flooded_market: ["lot_won", "consortium", "shorted", "washed_out"],
  lost_survey: ["survey_home", "chart_ceded", "survey_sold", "survey_lost"],
} as const;
type Tpl = keyof typeof TEMPLATES;

const leaves = (v: unknown, path = "", acc = new Map<string, string>()): Map<string, string> => {
  if (Array.isArray(v)) {
    acc.set(`${path}#len`, String(v.length));
    v.forEach((x, i) => leaves(x, `${path}[${i}]`, acc));
  } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, acc);
  else acc.set(path, JSON.stringify(v));
  return acc;
};
const apart = (a: unknown, b: unknown): number => {
  const A = leaves(a), B = leaves(b);
  let n = 0;
  for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) n++;
  return n;
};

const before = newCampaign(11);
const pw0 = newPowers(11);
const after = (r: SaltmarketEnding): CampaignState => applyOutcome(before, OUTCOMES[r]);
const powers = (r: SaltmarketEnding): PowersState => powersAfterOutcome(before, after(r), pw0, OUTCOMES[r]);

describe("The Saltmarket's ledger: the twelve endings", () => {
  it("every table is exhaustive, each template's resolutions are its four plus abandoned, and the rows are real (not neutral)", () => {
    for (const r of SALTMARKET_RESOLUTIONS) {
      expect(RELATION_FX[r], r).toBeDefined();
      expect(Object.keys(RELATION_FX[r]).length, `${r} moves the map of grudges`).toBeGreaterThanOrEqual(3);
      expect(typeof GRUDGE_FX[r]).toBe("number");
      expect(HISTORY_PIECE[r].label.length).toBeGreaterThan(30);
      expect(MEMORY_LINE[r].length).toBeGreaterThanOrEqual(2);
      expect(HEADLINES[r].length).toBeGreaterThanOrEqual(3);
      expect(STANDFIRSTS[r].length).toBeGreaterThanOrEqual(3);
      expect(SITE_LINES[r]!.length).toBeGreaterThanOrEqual(2);
      expect(NEWS[`end_${r}`]!.head.length).toBeGreaterThanOrEqual(3);
      expect(NEWS[`end_${r}`]!.body.length).toBeGreaterThanOrEqual(3);
      const row = SALTMARKET_ENDINGS[r];
      expect(row.rule.toll, "the crossing's toll is Kessar's").toBe("keep");
      expect(row.rule.control).toBeUndefined();
      expect(row.rule.need, "no need: the Ward's need is not the delta's business").toBeUndefined();
      expect(row.news.a).toBe("brine");
      expect(Object.values(row.memory).some((v) => v > 0), `${r} has a memory`).toBe(true);
    }
    for (const [t, rs] of Object.entries(TEMPLATES)) expect([...TEMPLATE_RESOLUTIONS[t as ScenarioTemplateId]].sort()).toEqual([...rs, "abandoned"].sort());
  });

  it("inside each template the four endings give distinct campaign JSON and distinct powers JSON, at least three fields apart", () => {
    for (const rs of Object.values(TEMPLATES)) {
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        expect(apart(after(rs[i]!), after(rs[j]!)), `campaign ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
        expect(apart(JSON.parse(serializePowers(powers(rs[i]!))), JSON.parse(serializePowers(powers(rs[j]!)))), `powers ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
      }
    }
    // and with the SAME outcome numbers the endings still differ by their own rules (the relations, the Houses, the Syndicate's grudge)
    const same = (r: SaltmarketEnding): ScenarioOutcome => ({ ...OUTCOMES[r], paid: 30, loot: 0, brokePromise: false });
    for (const [t, rs] of Object.entries(TEMPLATES)) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = powersAfterOutcome(before, applyOutcome(before, same(rs[i]!)), pw0, same(rs[i]!)), b = powersAfterOutcome(before, applyOutcome(before, same(rs[j]!)), pw0, same(rs[j]!));
      expect(apart(JSON.parse(serializePowers(a)), JSON.parse(serializePowers(b))), `${t}: equal outcomes ${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("sites.ends and history[].region are right, and Kessar's crossing, toll, bridge, the Ward's need and the other sites are left alone", () => {
    for (const r of SALTMARKET_RESOLUTIONS) {
      const a = after(r);
      const tpl = OUTCOMES[r].scenario as Tpl;
      expect(a.sites.ends[tpl], r).toBe(r);
      expect(Object.keys(a.sites.ends)).toEqual([tpl]);
      expect(a.history[a.history.length - 1], r).toMatchObject({ region: "saltmarket", resolution: r, template: tpl });
      expect(TEMPLATE_REGION[tpl]).toBe("saltmarket");
      expect(a.crossing, r).toEqual(before.crossing);
      expect(a.factions.ward.need).toBe(before.factions.ward.need);
      expect(a.factions.ward.trust).toBe(before.factions.ward.trust);
      expect(a.sites.hostage).toBe(before.sites.hostage);
      expect(a.sites.succession).toBe(before.sites.succession);
      expect(a.sites.lastDay[tpl]).toBe(before.day + 1);
      expect(parseCampaign(serializeCampaign(a))).toEqual(a);
    }
    // money: what the party paid leaves the purse, loot comes in; a broken promise is a lie
    expect(after("lot_won").purse).toBe(before.purse - 100);
    expect(after("shorted").purse).toBe(before.purse + 35);
    expect(after("shorted").lies).toBe(before.lies + 1 + 1);   // the broken promise, and the rule's own lie
    expect(after("landed").lies).toBe(before.lies);
    // the Syndicate's own books move with the Houses' sale
    expect(after("lot_won").factions.rival.grievance).toBeGreaterThan(before.factions.rival.grievance);
    expect(after("impounded").factions.rival.prosperity).toBeLessThan(before.factions.rival.prosperity);
  });

  it("the Lamp-Warden's memory of each is distinct and none of it is a toll", () => {
    const mem = new Set(SALTMARKET_RESOLUTIONS.map((r) => JSON.stringify([wardMemory(after(r)).gratitude, wardMemory(after(r)).resentment, wardMemory(after(r)).contempt])));
    expect(mem.size).toBe(12);
  });

  it("the Houses move for every ending, the story pairs carry it, no two endings of a template read alike, and the saved powers stay inside their caps", () => {
    for (const r of SALTMARKET_RESOLUTIONS) {
      const p = powers(r);
      expect(apart(p.minor.brine, powersAfterOutcome(before, before, pw0, out("secure_crossing", "abandoned", { region: undefined })).minor.brine), `${r} moves the Houses`).toBeGreaterThanOrEqual(2);
      expect(serializePowers(p).length).toBeLessThan(POWERS_JSON_MAX);
      expect(parsePowers(serializePowers(p))).toEqual(p);
      expect(p.log[p.log.length - 1]).toMatchObject({ kind: `end_${r}`, a: "brine" });
      const keys = Object.keys(RELATION_FX[r]);
      expect(keys.some((k) => k === "rival|brine" || k === "ward|brine" || k === "brine|reapers" || k === "brine|choir"), `${r} touches the Houses' pairs`).toBe(true);
    }
    for (const rs of Object.values(TEMPLATES)) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = RELATION_FX[rs[i]!], b = RELATION_FX[rs[j]!];
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof typeof a>;
      let d = 0;
      for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) d++;
      expect(d, `${rs[i]} vs ${rs[j]}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("the paper prints a dispatch for each ending under its own heading, and the headlines and standfirsts are distinct and clean", () => {
    const heads = new Set<string>();
    const dispatches = new Set<string>();
    for (const r of SALTMARKET_RESOLUTIONS) {
      const c = after(r);
      const items = powersDispatches(powers(r), 9);
      const d = items.find((i) => i.slug === `end-${r.replace(/_/g, "-")}`);
      expect(d, `${r} dispatch`).toBeDefined();
      expect(d!.head.length).toBeGreaterThan(10);
      expect(d!.body).not.toMatch(/[{}]|undefined/);
      dispatches.add(d!.head);
      const paper = generatePaper(c, 9, { dispatches: items });
      expect(paper.stories.some((s) => s.slug === d!.slug)).toBe(true);
      const tpl = OUTCOMES[r].scenario as Tpl;
      expect(STORY_HEADS[tpl].length).toBeGreaterThanOrEqual(3);
      expect(STORY_HEADS[tpl]).toContain(paper.stories.find((s) => s.slug === "ledger")!.head);
      for (let seed = 0; seed < 60; seed++) heads.add(generatePaper(c, seed).headline);
      expect(new Set(Array.from({ length: 80 }, (_, s) => generatePaper(c, s).headline)).size, r).toBeGreaterThanOrEqual(3);
      expect(new Set(Array.from({ length: 80 }, (_, s) => generatePaper(c, s).standfirst)).size, `${r} standfirsts`).toBeGreaterThanOrEqual(3);
      expect(paper.headline).not.toMatch(/[{}]/);
      expect(paper.standfirst).not.toMatch(/[{}]/);
      expect(eventItem({ day: 3, kind: `end_${r}`, a: "brine", b: "rival", n: 0 }, 1)).toBeDefined();
      // every headline and standfirst fits the paper's column once filled
      for (let seed = 0; seed < 60; seed++) { const pp = generatePaper(c, seed); expect(pp.headline.length).toBeLessThanOrEqual(90); expect(pp.standfirst.length).toBeLessThanOrEqual(280); }
    }
    expect(dispatches.size).toBeGreaterThanOrEqual(11);
    expect(heads.size).toBeGreaterThanOrEqual(12 * 3);
    // the debrief card says what happened, and names the place
    for (const r of SALTMARKET_RESOLUTIONS) expect(consequenceLines(before, after(r)).join(" "), r).toMatch(/Saltmarket/);
    for (const r of SALTMARKET_RESOLUTIONS) expect(SALTMARKET_COPY[r].debrief.length).toBeGreaterThan(30);
  });

  it("the Houses' pledged favour is satisfied by a scuttled barge and by an informed-upon one, once each, and by nothing else of the delta's", () => {
    const hook = HOOKS.brine[1];
    expect(hook.kind).toBe("favour");
    expect(SALTMARKET_FAVOUR.brine).toEqual(["scuttled", "informed"]);
    const satisfied = (r: SaltmarketEnding): boolean => {
      const p = { ...pw0, flags: [...pw0.flags, "errand_brine"], minor: { ...pw0.minor, brine: { ...pw0.minor.brine, refusals: [...pw0.minor.brine.refusals] } } };
      const q = powersAfterOutcome(before, after(r), p, OUTCOMES[r]);
      return !q.flags.includes("errand_brine") && q.minor.brine.owes === p.minor.brine.owes + 1;
    };
    for (const r of ["scuttled", "informed"] as const) expect(satisfied(r), r).toBe(true);
    for (const r of ["landed", "impounded", "lot_won", "consortium", "shorted", "washed_out", "survey_home", "chart_ceded", "survey_sold", "survey_lost"] as const) expect(satisfied(r), r).toBe(false);
  });

  it("a campaign with every `ends` filled stays small, and the contract picker offers all three templates, never the same one twice running, and never the survey first", () => {
    let c = before;
    const seen = new Set<ScenarioTemplateId>();
    for (let i = 0; i < 12; i++) {
      const t = pickTemplate(c, "saltmarket", 100 + i)!;
      expect(["smuggling_run", "flooded_market", "lost_survey"]).toContain(t);
      if (i > 0) expect(t, "never twice running").not.toBe(c.history[c.history.length - 1]!.template);
      seen.add(t);
      c = applyOutcome(c, out(t, TEMPLATE_RESOLUTIONS[t][i % 4]!));
    }
    expect(seen.size).toBe(3);
    expect(Object.keys(c.sites.ends).length).toBe(3);
    // D-093: the Society sends its surveyor in only once it has been to the delta (a first visit never draws it)
    for (let seed = 0; seed < 200; seed++) expect(pickSaltmarketContract({ ...before, history: [] }, seed)).not.toBe("lost_survey");
    expect(serializeCampaign(c).length).toBeLessThan(2400);
    // deterministic from the ledger and the seed
    for (let seed = 0; seed < 40; seed++) expect(pickSaltmarketContract(c, seed)).toBe(pickSaltmarketContract(structuredClone(c), seed));
    // the ledger weights it: a Syndicate with goods to move runs more barges, a Syndicate arming the Houses runs more sales
    const share = (cc: CampaignState, presence: Parameters<typeof pickSaltmarketContract>[2], id: ScenarioTemplateId): number => {
      let n = 0;
      for (let s = 0; s < 600; s++) if (pickSaltmarketContract(cc, s, presence) === id) n++;
      return n / 600;
    };
    const idle = { ...before, history: [], day: 3 } as CampaignState;
    const rich = { ...idle, factions: { ...idle.factions, ward: { ...idle.factions.ward, rivalInfluence: 80 } } };
    expect(share(rich, undefined, "smuggling_run")).toBeGreaterThan(share(idle, undefined, "smuggling_run"));
    const arming = { goal: "arm_brine", arrivesInS: 0, escort: 2, wagon: false, surveyors: 0, postStage: 0 } as const;
    expect(share(idle, arming, "flooded_market")).toBeGreaterThan(share(idle, undefined, "flooded_market"));
    // ...and the Houses, with a grievance to collect on (a barge landed past their customs), hold the Society's surveyor more often
    const been = applyOutcome(idle, out("flooded_market", "consortium"));
    const landed = applyOutcome(applyOutcome(idle, out("smuggling_run", "landed")), out("flooded_market", "consortium"));
    expect(share(landed, undefined, "lost_survey")).toBeGreaterThan(share(been, undefined, "lost_survey"));
    for (const id of ["smuggling_run", "flooded_market", "lost_survey"] as const) expect(COMPLICATION_POOL[id]).toEqual(SALTMARKET_COMPLICATIONS[id]);
  });

  it("the parley scripts are complete: each opens, offers a way out and the options its templates read, and never reports a result its script does not offer", () => {
    for (const kind of ["tide_reeve", "auctioneer", "house_head", "dues_collector", "lost_surveyor"] as const) {
      expect(SCRIPTED_KINDS).toContain(kind);
      const sc = parleyScript(kind)!;
      expect(sc.speaker.length).toBeGreaterThan(8);
      for (const list of [sc.open, sc.round2]) expect(list.length).toBeGreaterThanOrEqual(2);
      // (the surveyor is not haggled with: he wants his books, not a compliment)
      if (kind !== "lost_surveyor") expect(sc.flatter!.ok.length).toBeGreaterThanOrEqual(2);
      if (kind !== "lost_surveyor") expect(sc.flatter!.fail.length).toBeGreaterThanOrEqual(2);
      for (const text of [...sc.open, ...sc.round2, sc.walk, sc.hostile, sc.short, ...Object.values(sc.deal)]) {
        expect(text.length, `${kind}: ${text}`).toBeGreaterThan(30);
        expect(text.replace(/\{price\}/g, "")).not.toMatch(/[{}]/);
      }
      const ctx = { price: 45, purse: 300, seed: 3, day: 2 };
      for (let seed = 0; seed < 12; seed++) {
        const v = openSiteParley(kind, { ...ctx, seed });
        expect(v.line).not.toMatch(/[{}]/);
        for (let i = 0; i < v.options.length; i++) {
          let step = answerSiteParley(kind, { ...ctx, seed }, v, i);
          if (step.view) { expect(step.line).not.toMatch(/[{}]/); step = answerSiteParley(kind, { ...ctx, seed }, step.view, 0); }
          expect(step.line).not.toMatch(/[{}]/);
        }
      }
      // every deal the script offers is a key it has an option for
      const results = new Set<string>();
      const v = openSiteParley(kind, ctx);
      const pushR = (view: typeof v): void => { for (let i = 0; i < view.options.length; i++) { const s = answerSiteParley(kind, ctx, view, i); if (s.done) results.add(s.done.result); else if (s.view && s.view.round === 2 && view.round === 1) pushR(s.view); } };
      pushR(v);
      for (const r of results) expect(["paid", "survey", "tell", "hostile", "walked", "envelope", "tip"], `${kind} ${r}`).toContain(r);
    }
    // what each template needs from its people is on offer
    const has = (kind: "tide_reeve" | "auctioneer" | "house_head" | "dues_collector" | "lost_surveyor", r: string): boolean => {
      const ctx = { price: 45, purse: 300, seed: 3, day: 2 };
      const v = openSiteParley(kind, ctx);
      return v.options.some((_, i) => answerSiteParley(kind, ctx, v, i).done?.result === r);
    };
    expect(has("tide_reeve", "survey") && has("tide_reeve", "paid") && has("tide_reeve", "tell")).toBe(true);
    expect(has("auctioneer", "paid") && has("auctioneer", "tip")).toBe(true);
    expect(has("house_head", "paid") && has("house_head", "survey") && has("house_head", "tell")).toBe(true);
    expect(has("dues_collector", "paid") && has("dues_collector", "survey") && has("dues_collector", "tip") && has("dues_collector", "hostile")).toBe(true);
    expect(has("lost_surveyor", "survey"), "the surveyor can be talked into leaving his books at once").toBe(true);
    expect(has("lost_surveyor", "paid") || has("lost_surveyor", "tip"), "and takes no money").toBe(false);
  });

  it("the region's own copy: the chart note grows with the ledger, the presence lines and the parley heading are filled, and the signs are Latin capitals", () => {
    const rc = REGION_COPY.saltmarket!;
    expect(rc.chartNote(newCampaign(2))).toMatch(/Not yet visited/);
    let c = newCampaign(2);
    c = applyOutcome(c, OUTCOMES.informed);
    c = applyOutcome(c, OUTCOMES.shorted);
    const note = rc.chartNote(c);
    expect(note).toMatch(/informed/);
    expect(note).toMatch(/shorted/);
    expect(note.length).toBeLessThanOrEqual(240);
    // all three of the delta's contracts on the books still fit the chart
    const all = applyOutcome(c, OUTCOMES.survey_sold);
    expect(rc.chartNote(all)).toMatch(/sold, with his survey/);
    expect(rc.chartNote(all).length).toBeLessThanOrEqual(240);
    expect(rc.parley.asked).toContain("{price}");
    expect(SALTMARKET_SIGNS.length).toBeGreaterThanOrEqual(4);
    for (const s of SALTMARKET_SIGNS) expect(/^[A-Z0-9 .,'!?:-]+$/.test(s), s).toBe(true);
    expect(POWERS.find((p) => p.id === "brine")!.region).toBe("saltmarket");
  });

  it("the palette: silt and salt, not Kessar's ochre; the swatch is the group's own", () => {
    expect(PALETTE.saltmarket).toBe(SALTMARKET_PALETTE);
    for (const v of Object.values(SALTMARKET_SWATCH)) expect(Object.values(SALTMARKET_PALETTE)).toContain(v);
  });
});
