import { describe, expect, it } from "vitest";
import { type CampaignState, type CasualtyTally, type ScenarioOutcome, type ScenarioTemplateId } from "./campaignTypes.ts";
import { COMPLICATION_POOL } from "./chaos.ts";
import { RESOLUTIONS, TEMPLATE_RESOLUTIONS, applyOutcome, consequenceLines, newCampaign, parseCampaign, serializeCampaign, wardMemory } from "./factions.ts";
import { MEMORY_LINE } from "./negotiationText.ts";
import { generatePaper } from "./newspaper.ts";
import { HEADLINES, SITE_LINES, STANDFIRSTS, STORY_HEADS } from "./newspaperText.ts";
import { HISTORY_PIECE } from "./outpostText.ts";
import { eventItem, newPowers, parsePowers, powersAfterOutcome, powersDispatches, serializePowers } from "./powers.ts";
import { NEWS } from "./powersText.ts";
import { REGIONS } from "./regions.ts";
import { REGION_COPY } from "./regionCopy.ts";
import { TEMPLATE_REGION, VESPER_RESOLUTIONS, type VesperEnding } from "./regionEndings.ts";
import { regionIsLive } from "./regionStatus.ts";
import { RELATION_FX } from "./relations.ts";
import { GRUDGE_FX } from "./rival.ts";
import { SCRIPTED_KINDS, answerSiteParley, openSiteParley, parleyScript } from "./scenarios/parleys.ts";
import { REGION_TEMPLATES, pickTemplate } from "./scenarios/registry.ts";
import { VESPER_STATUS } from "./vesper.ts";
import { VESPER_COMPLICATIONS, VESPER_ENDINGS, VESPER_FAVOUR, pickVesperContract } from "./vesperLedger.ts";
import { VESPER_COPY, VESPER_SIGNS, VESPER_STORY_HEADS } from "./vesperText.ts";
import type { PowersState } from "./worldTypes.ts";
import { POWERS_JSON_MAX } from "./worldTypes.ts";

const tally = (t: Partial<CasualtyTally> = {}): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0, ...t });
const TPL: Record<VesperEnding, "mine_rescue" | "claim_race"> = { dug_out: "mine_rescue", blasted_through: "mine_rescue", sealed: "mine_rescue", consecrated: "mine_rescue", staked: "claim_race", jumped: "claim_race", partnered: "claim_race", outpaced: "claim_race" };
const out = (resolution: VesperEnding, o: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  scenario: TPL[resolution], resolution, toll: 0, paid: 0, bridge: "intact", tally: tally(), brokePromise: false, seconds: 300, region: "vesper", ...o,
});
/** What each ending would realistically hand the ledger (distinct outcomes: money, blood). */
const OUTCOMES: Record<VesperEnding, ScenarioOutcome> = {
  dug_out: out("dug_out"),
  blasted_through: out("blasted_through", { tally: tally({ civiliansHarmed: 3, downed: 3, wounded: 4 }) }),
  sealed: out("sealed"),
  consecrated: out("consecrated", { paid: 70 }),
  staked: out("staked", { paid: 40 }),
  jumped: out("jumped", { paid: 40, tally: tally({ rivalKilled: 1, wounded: 2 }), brokePromise: true }),
  partnered: out("partnered"),
  outpaced: out("outpaced"),
};

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
const after = (r: VesperEnding): CampaignState => applyOutcome(before, OUTCOMES[r]);
const powers = (r: VesperEnding): PowersState => powersAfterOutcome(before, after(r), pw0, OUTCOMES[r]);
const MINE = ["dug_out", "blasted_through", "sealed", "consecrated"] as const;
const CLAIM = ["staked", "jumped", "partnered", "outpaced"] as const;

describe("Vesper's ledger: the eight endings", () => {
  it("the region is live (stub flag off, reachable on) and every table is exhaustive, with real copy in every slot", () => {
    expect(VESPER_STATUS.stub).toBe(false);
    expect(REGIONS.vesper.reachable).toBe(true);
    expect(regionIsLive("vesper")).toBe(true);
    for (const r of VESPER_RESOLUTIONS) {
      expect(RESOLUTIONS).toContain(r);
      expect(RELATION_FX[r], r).toBeDefined();
      expect(Object.keys(RELATION_FX[r]).length, `${r} moves the map of grudges`).toBeGreaterThanOrEqual(3);
      expect(typeof GRUDGE_FX[r]).toBe("number");
      expect(HISTORY_PIECE[r].label.length).toBeGreaterThan(30);
      expect(MEMORY_LINE[r].length).toBeGreaterThanOrEqual(2);
      expect(HEADLINES[r].length).toBeGreaterThanOrEqual(3);
      expect(STANDFIRSTS[r].length).toBeGreaterThanOrEqual(3);
      expect((SITE_LINES as Record<string, readonly string[]>)[r]!.length).toBeGreaterThanOrEqual(2);
      expect(NEWS[`end_${r}`]!.head.length).toBeGreaterThanOrEqual(3);
      expect(NEWS[`end_${r}`]!.body.length).toBeGreaterThanOrEqual(3);
      const c = VESPER_COPY[r];
      expect(c.debrief.length).toBeGreaterThan(30);
      expect(c.debrief, "names the place").toMatch(/Vesper/);
      expect(c.piece.label.length).toBeGreaterThan(30);
      for (const list of [c.headlines, c.standfirsts]) expect(new Set(list).size).toBe(list.length);
      for (const h of c.headlines) expect(h.length, h).toBeLessThanOrEqual(90);
    }
    expect([...TEMPLATE_RESOLUTIONS.mine_rescue].sort()).toEqual([...MINE, "abandoned"].sort());
    expect([...TEMPLATE_RESOLUTIONS.claim_race].sort()).toEqual([...CLAIM, "abandoned"].sort());
    for (const t of ["mine_rescue", "claim_race"] as const) {
      expect(STORY_HEADS[t]).toBe(VESPER_STORY_HEADS[t]);
      expect(STORY_HEADS[t].length).toBeGreaterThanOrEqual(3);
      expect(COMPLICATION_POOL[t]).toEqual(VESPER_COMPLICATIONS[t]);
    }
  });

  it("inside each template the four endings give distinct campaign JSON and distinct powers JSON, at least three fields apart", () => {
    for (const group of [MINE, CLAIM] as const) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          expect(apart(after(group[i]!), after(group[j]!)), `campaign ${group[i]} vs ${group[j]}`).toBeGreaterThanOrEqual(3);
          expect(apart(JSON.parse(serializePowers(powers(group[i]!))), JSON.parse(serializePowers(powers(group[j]!)))), `powers ${group[i]} vs ${group[j]}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // and with the same outcome numbers the endings still differ by their own rules (the ledger, the relations, the minors)
    const same = (r: VesperEnding): ScenarioOutcome => out(r, { paid: 30 });
    for (const group of [MINE, CLAIM] as const) {
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const a = powersAfterOutcome(before, applyOutcome(before, same(group[i]!)), pw0, same(group[i]!)), b = powersAfterOutcome(before, applyOutcome(before, same(group[j]!)), pw0, same(group[j]!));
        expect(apart(JSON.parse(serializePowers(a)), JSON.parse(serializePowers(b))), `powers (equal outcomes) ${group[i]} vs ${group[j]}`).toBeGreaterThanOrEqual(3);
        expect(apart(applyOutcome(before, same(group[i]!)), applyOutcome(before, same(group[j]!))), `campaign (equal outcomes) ${group[i]} vs ${group[j]}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("sites.ends and history[].region are right, and Kessar's crossing, toll and bridge are left alone", () => {
    for (const r of VESPER_RESOLUTIONS) {
      const a = after(r);
      expect(a.sites.ends[TPL[r]], r).toBe(r);
      expect(a.history[a.history.length - 1], r).toMatchObject({ region: "vesper", resolution: r, template: TPL[r] });
      expect(TEMPLATE_REGION[TPL[r]]).toBe("vesper");
      expect(a.crossing, r).toEqual(before.crossing);
      expect(a.factions.ward.need, "the Ward's need is not Vesper's business").toBe(before.factions.ward.need);
      expect(a.sites.hostage).toBe(before.sites.hostage);
      expect(a.sites.succession).toBe(before.sites.succession);
      expect(a.sites.lastDay[TPL[r]]).toBe(before.day + 1);
      expect(parseCampaign(serializeCampaign(a))).toEqual(a);
    }
    // the last ending of each template is the one the ledger keeps
    let c = before;
    for (const r of ["dug_out", "sealed", "staked", "outpaced"] as const) c = applyOutcome(c, OUTCOMES[r]);
    expect(c.sites.ends).toEqual({ mine_rescue: "sealed", claim_race: "outpaced" });
    expect(c.history.map((h) => h.region)).toEqual(["vesper", "vesper", "vesper", "vesper"]);
  });

  it("the Lamp-Warden's garrison and trust are not what a gorge's dead cost her; the Syndicate's own are", () => {
    const bloody = applyOutcome(before, OUTCOMES.blasted_through);
    expect(bloody.factions.ward.militaryStrength).toBe(before.factions.ward.militaryStrength);
    expect(bloody.factions.ward.trust).toBe(before.factions.ward.trust);
    expect(bloody.tally.civiliansHarmed, "the ledger still counts them").toBe(3);
    const fight = applyOutcome(before, out("jumped", { tally: tally({ rivalKilled: 2 }) }));
    expect(fight.factions.rival.militaryStrength).toBeLessThan(before.factions.rival.militaryStrength);
    expect(applyOutcome(before, OUTCOMES.jumped).lies, "a promise broken, a peg pulled").toBe(before.lies + 2);
    const mem = new Set(VESPER_RESOLUTIONS.map((r) => JSON.stringify([wardMemory(after(r)).gratitude, wardMemory(after(r)).resentment, wardMemory(after(r)).contempt])));
    expect(mem.size, "she remembers each distinctly").toBe(8);
  });

  it("the Guild moves for every ending (the home power), its pairs carry the story, no two endings of a template read alike, and the saved powers stay inside their caps", () => {
    const base = pw0;
    for (const r of VESPER_RESOLUTIONS) {
      const p = powers(r);
      const moved = (["trust", "fear", "grievance", "playerInfluence", "rivalInfluence", "militaryStrength", "prosperity"] as const).filter((k) => p.minor.choir[k] !== base.minor.choir[k]);
      expect(moved.length, `${r} moves the Guild's own numbers`).toBeGreaterThanOrEqual(1);
      expect(serializePowers(p).length).toBeLessThan(POWERS_JSON_MAX);
      expect(parsePowers(serializePowers(p))).toEqual(p);
      expect(p.log[p.log.length - 1]).toMatchObject({ kind: `end_${r}`, a: VESPER_ENDINGS[r].news.a });
      expect(Object.keys(RELATION_FX[r]).some((k) => k.includes("choir")), `${r} touches the Guild's pairs`).toBe(true);
    }
    for (const group of [MINE, CLAIM] as const) {
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const a = RELATION_FX[group[i]!], b = RELATION_FX[group[j]!];
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof typeof a>;
        let d = 0;
        for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) d++;
        expect(d, `${group[i]} vs ${group[j]}`).toBeGreaterThanOrEqual(2);
      }
    }
    for (const r of CLAIM) expect(Object.keys(RELATION_FX[r]).some((k) => k === "rival|choir"), `${r} touches the Syndicate and the Guild`).toBe(true);
    for (const r of MINE) expect(Object.keys(RELATION_FX[r]).filter((k) => k.endsWith("|choir")).length, `${r}: the Guild's four pairs carry the story`).toBeGreaterThanOrEqual(4);
  });

  it("the paper prints a dispatch for each ending under end_<resolution>, with the ledger story under Vesper's headings, and the headlines and standfirsts vary", () => {
    const heads = new Set<string>();
    const dispatches = new Set<string>();
    for (const r of VESPER_RESOLUTIONS) {
      const c = after(r);
      const p = powers(r);
      const items = powersDispatches(p, 9);
      const mine = items.find((i) => i.slug === `end-${r.replace(/_/g, "-")}`);
      expect(mine, `${r} dispatch`).toBeDefined();
      expect(mine!.head.length).toBeGreaterThan(10);
      expect(mine!.body).not.toMatch(/[{}]|undefined/);
      dispatches.add(mine!.head);
      const paper = generatePaper(c, 9, { dispatches: items });
      expect(paper.stories.some((s) => s.slug === mine!.slug)).toBe(true);
      expect(VESPER_STORY_HEADS[TPL[r]]).toContain(paper.stories.find((s) => s.slug === "ledger")!.head);
      for (let seed = 0; seed < 60; seed++) heads.add(generatePaper(c, seed).headline);
      expect(new Set(Array.from({ length: 80 }, (_, s) => generatePaper(c, s).headline)).size, r).toBeGreaterThanOrEqual(3);
      expect(paper.headline).not.toMatch(/[{}]/);
      expect(eventItem({ day: 3, kind: `end_${r}`, a: VESPER_ENDINGS[r].news.a, n: 0 }, 1)).toBeDefined();
      expect(consequenceLines(before, c).join(" ")).toMatch(/Vesper/);
    }
    expect(dispatches.size).toBeGreaterThanOrEqual(8);
    expect(heads.size).toBeGreaterThanOrEqual(24);
  });

  it("the Guild's pledged favour (a respectable season of mourning) is satisfied by a sealed, blasted or consecrated gallery, and by neither a rescue nor a claim", () => {
    expect(VESPER_FAVOUR.choir).toEqual(["sealed", "blasted_through", "consecrated"]);
    for (const r of VESPER_RESOLUTIONS) {
      const pledged: PowersState = { ...pw0, flags: [...pw0.flags, "errand_choir"], minor: { ...pw0.minor, choir: { ...pw0.minor.choir } } };
      const p = powersAfterOutcome(before, after(r), pledged, OUTCOMES[r]);
      const pleased = VESPER_FAVOUR.choir!.includes(r);
      expect(p.flags.includes("errand_choir"), `${r}: the errand ${pleased ? "is done" : "stands"}`).toBe(!pleased);
      expect(p.minor.choir.owes, r).toBe(pleased ? pledged.minor.choir.owes + 1 : pledged.minor.choir.owes);
      if (pleased) expect(p.log.some((e) => e.kind === "favour_choir"), r).toBe(true);
    }
  });

  it("the next contract offered alternates and is weighted by the ledger: the Lower Gallery first, the Syndicate's presence calls for the race, never the same twice running", () => {
    expect(pickVesperContract(before, 3)).toBe("mine_rescue");
    const surveyors = { goal: "survey_route", arrivesInS: 60, escort: 2, wagon: false, surveyors: 2, postStage: 0 } as const;
    const pegging = { ...before, factions: { ...before.factions, ward: { ...before.factions.ward, rivalInfluence: 70 } } };
    // the first visit is the Guild's own contract, unless the Syndicate has the influence AND its surveyors are physically in the gorge
    expect(pickVesperContract(before, 3, surveyors), "surveyors without the influence").toBe("mine_rescue");
    expect(pickVesperContract(pegging, 3), "influence without the surveyors").toBe("mine_rescue");
    expect(pickVesperContract(pegging, 3, surveyors)).toBe("claim_race");
    let c = before;
    let last: ScenarioTemplateId | undefined;
    const seen = new Set<ScenarioTemplateId>();
    for (let i = 0; i < 8; i++) {
      const t = pickTemplate(c, "vesper", 20 + i)!;
      expect(REGION_TEMPLATES.vesper).toContain(t);
      expect(t, "never twice running").not.toBe(last);
      seen.add(t);
      last = t;
      c = applyOutcome(c, OUTCOMES[t === "mine_rescue" ? "sealed" : "staked"]);
    }
    expect(seen.size).toBe(2);
    // the same ledger always offers the same thing
    expect(pickVesperContract(c, 5)).toBe(pickVesperContract(c, 5));
    // Kessar's weights and Highmark's single contract are untouched
    expect(pickTemplate(before, "highmark", 3)).toBe("succession_dispute");
    expect(["secure_crossing"]).toContain(pickTemplate(before, "kessar", 3));
  });

  it("the parley scripts are complete: three kinds, open and second-round lines, a way out, a result for every option and no unfilled price", () => {
    const mine = ["foreman", "dirge_master", "assayer"] as const;
    for (const k of mine) expect(SCRIPTED_KINDS).toContain(k);
    for (const kind of mine) {
      const sc = parleyScript(kind)!;
      expect(sc.open.length).toBeGreaterThanOrEqual(2);
      expect(sc.round2.length).toBeGreaterThanOrEqual(2);
      expect(sc.walk.length).toBeGreaterThan(10);
      expect(sc.hostile.length).toBeGreaterThan(10);
      expect(Object.keys(sc.deal).length).toBeGreaterThanOrEqual(2);
      for (const r of [1, 2, 3]) {
        const opts = sc.options(r, 40);
        expect(opts.length).toBeGreaterThanOrEqual(2);
        expect(opts.some((o) => o.key === "walk")).toBe(true);
        expect(opts.some((o) => o.key === "pay"), `${kind} round ${r} offers a price`).toBe(true);
      }
      const v = openSiteParley(kind, { price: 45, purse: 100, seed: 3, day: 2 });
      expect(v.line).not.toMatch(/\{[a-z]+\}/);
      expect(v.line).toContain("£45");
      // the price gate: with too little in the purse the price stands and nothing is paid
      const pay = v.options.findIndex((o) => o.id === "pay");
      const poor = answerSiteParley(kind, { price: 45, purse: 10, seed: 3, day: 2 }, v, pay);
      expect(poor.done).toBeUndefined();
      expect(poor.view!.toll).toBe(45);
      expect(answerSiteParley(kind, { price: 45, purse: 100, seed: 3, day: 2 }, v, pay).done).toMatchObject({ result: "paid", paid: 45 });
      for (const k of ["walk", "hostile"] as const) expect(sc[k]).not.toMatch(/\{[a-z]+\}/);
      for (const line of [...sc.open, ...sc.round2, ...Object.values(sc.deal)]) expect(line.length).toBeGreaterThan(40);
      for (const l of Object.values(sc.deal)) expect(l, "deal lines are not price-filled").not.toMatch(/\{price\}/);
    }
  });

  it("the copy gathers in REGION_COPY with the sign boards, the presence lines, the parley heading and a chart note that reads the ledger", () => {
    const rc = REGION_COPY.vesper!;
    expect(rc.presence.length).toBeGreaterThanOrEqual(2);
    expect(rc.parley.asked).toContain("{price}");
    expect(rc.chartNote(before)).toMatch(/Not yet visited/);
    let c = applyOutcome(before, OUTCOMES.sealed);
    expect(rc.chartNote(c)).toMatch(/sealed/);
    c = applyOutcome(c, OUTCOMES.partnered);
    expect(rc.chartNote(c)).toMatch(/sealed.*shared/);
    for (const r of VESPER_RESOLUTIONS) expect(rc.chartNote(applyOutcome(before, OUTCOMES[r])).length).toBeLessThanOrEqual(240);
    expect(VESPER_SIGNS.length).toBeGreaterThanOrEqual(6);
    for (const s of VESPER_SIGNS) expect(s).toMatch(/^[A-Z0-9 .,:()'-]+$/);
  });

  it("noRealWorld: every sentence of the region's copy is free of real-world terms and unfilled placeholders", () => {
    const banned = /\b(london|england|britain|british|france|french|german|spain|rome|india|china|japan|africa|arab|egypt|turk|islam|muslim|christ|jewish|hindu|buddh|america|russia|paris|berlin|cairo|kenya|zulu|maasai|ethiopia|nairobi|church|bible|prayer|pope|jesus|allah)\b/i;
    const texts: string[] = [];
    for (const r of VESPER_RESOLUTIONS) {
      const c = VESPER_COPY[r];
      texts.push(c.piece.label, c.debrief, ...c.memoryLine, ...c.headlines, ...c.standfirsts, ...c.siteLines, ...c.news.head, ...c.news.body);
    }
    for (const k of ["foreman", "dirge_master", "assayer"] as const) {
      const sc = parleyScript(k)!;
      texts.push(sc.speaker, sc.walk, sc.hostile, ...sc.open, ...sc.round2, ...Object.values(sc.deal), ...(sc.flatter?.ok ?? []), ...(sc.flatter?.fail ?? []), sc.short);
    }
    texts.push(...VESPER_SIGNS, ...VESPER_STORY_HEADS.mine_rescue, ...VESPER_STORY_HEADS.claim_race);
    for (const t of texts) {
      expect(t, t).not.toMatch(banned);
      expect(t.replace(/\{(price|A|a|b|B|spin|purse|toll|bridge|dead|routed|wounded|limbs|civ|lies)\}/g, "")).not.toMatch(/[{}]|undefined|NaN/);
    }
    expect(texts.length).toBeGreaterThan(150);
  });

  it("an old campaign (no `ends`) loads and plays on; a hostile `ends` is clamped", () => {
    const old = JSON.parse(serializeCampaign(newCampaign(3))) as { sites: Record<string, unknown> };
    delete old.sites.ends;
    const c = parseCampaign(JSON.stringify(old))!;
    expect(c.sites.ends).toEqual({});
    const again = applyOutcome(c, OUTCOMES.consecrated);
    expect(again.sites.ends).toEqual({ mine_rescue: "consecrated" });
    const bad = JSON.parse(serializeCampaign(newCampaign(3))) as { sites: Record<string, unknown> };
    bad.sites.ends = { mine_rescue: "staked", claim_race: "sealed\u0000", smuggling_run: "informed" };
    expect(parseCampaign(JSON.stringify(bad))!.sites.ends).toEqual({ smuggling_run: "informed" });
  });
});

