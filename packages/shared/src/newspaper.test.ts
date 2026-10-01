import { describe, expect, it } from "vitest";
import type { CampaignState, CasualtyTally, ResolutionId, ScenarioOutcome, ScenarioTemplateId } from "./campaignTypes.ts";
import { RESOLUTIONS, TEMPLATE_RESOLUTIONS, applyOutcome, newCampaign } from "./factions.ts";
import { PAPER_LIMITS, generatePaper, type Paper } from "./newspaper.ts";
import { HEADLINES, NOTICES, SPIN_DEAD, STANDFIRSTS } from "./newspaperText.ts";

const tally = (t: Partial<CasualtyTally> = {}): CasualtyTally => ({ wounded: 0, downed: 0, limbsLost: 0, garrisonKilled: 0, garrisonRouted: 0, civiliansHarmed: 0, rivalKilled: 0, ...t });
const templateOf = (r: ResolutionId): ScenarioTemplateId => (["hostage_rescue", "convoy_ambush", "border_incident"] as const).find((t) => TEMPLATE_RESOLUTIONS[t].includes(r) && r !== "abandoned") ?? "secure_crossing";
const out = (resolution: ResolutionId, o: Partial<ScenarioOutcome> = {}): ScenarioOutcome => ({
  scenario: templateOf(resolution), resolution, toll: 50, paid: 0, bridge: "intact", tally: tally(), brokePromise: false, seconds: 100, ...o,
});
const paperText = (p: Paper): string => [p.masthead, p.dateline, p.headline, p.standfirst, ...p.stories.flatMap((s) => [s.head, s.body]), ...p.notices].join("\n");
const after = (r: ResolutionId, o: Partial<ScenarioOutcome> = {}, seed = 4): CampaignState => applyOutcome(newCampaign(seed), out(r, o));

const CASES: [ResolutionId, Partial<ScenarioOutcome>][] = [
  ["paid", { paid: 50 }], ["bargained", { paid: 33 }], ["bribed", { paid: 24 }], ["forced", { tally: tally({ garrisonKilled: 5, garrisonRouted: 2, wounded: 3 }) }],
  ["sabotaged", { bridge: "collapsed", tally: tally({ limbsLost: 2 }) }], ["rival_secured", {}], ["abandoned", { tally: tally({ wounded: 1 }) }],
];
/** The thirteen newer endings (D-034): hostage, convoy, border. */
const NEW_CASES: [ResolutionId, Partial<ScenarioOutcome>][] = [
  ["ransomed", { paid: 45 }], ["rescued", { tally: tally({ wounded: 2 }) }], ["slipped_away", {}], ["hostage_lost", { tally: tally({ civiliansHarmed: 1 }) }],
  ["seized", { loot: 60 }], ["tipped_off", {}], ["burned", { tally: tally({ rivalKilled: 2 }) }], ["passed", {}],
  ["mediated", {}], ["sided_ward", {}], ["sided_syndicate", { brokePromise: true }], ["provoked", { tally: tally({ garrisonKilled: 1 }) }], ["escalated", {}],
];
const ALL_CASES = [...CASES, ...NEW_CASES];

describe("generatePaper", () => {
  it("is deterministic: equal input, equal paper; a different world seed changes the wording", () => {
    const c = after("forced", { tally: tally({ garrisonKilled: 3 }) });
    expect(generatePaper(c, 99)).toEqual(generatePaper(c, 99));
    expect(generatePaper(c, 99)).toEqual(generatePaper(structuredClone(c), 99));
    const texts = new Set(Array.from({ length: 40 }, (_, s) => paperText(generatePaper(c, s))));
    expect(texts.size).toBeGreaterThan(20);
  });

  it("edition increments with every expedition", () => {
    let c = newCampaign(1);
    const eds: number[] = [generatePaper(c, 1).edition];
    for (let i = 0; i < 5; i++) { c = applyOutcome(c, out("paid", { paid: 10 })); eds.push(generatePaper(c, 1).edition); }
    expect(eds).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("all 20 resolutions print distinct headlines, each with at least 3 templates and real variety", () => {
    const all = new Map<ResolutionId, Set<string>>();
    for (const [r, o] of ALL_CASES) {
      const heads = new Set<string>();
      for (let s = 0; s < 80; s++) heads.add(generatePaper(after(r, o), s).headline);
      expect(heads.size, r).toBeGreaterThanOrEqual(3);
      expect(HEADLINES[r].length).toBeGreaterThanOrEqual(3);
      expect(STANDFIRSTS[r].length).toBeGreaterThanOrEqual(3);
      all.set(r, heads);
    }
    expect(all.size).toBe(RESOLUTIONS.length);
    const keys = [...all.keys()];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      for (const h of all.get(keys[i]!)!) expect(all.get(keys[j]!)!.has(h), `${keys[i]} vs ${keys[j]}: ${h}`).toBe(false);
    }
  });

  it("the newer contracts get a ledger story named for the place, with the Society's own euphemism", () => {
    const heads: Record<string, RegExp> = { hostage_rescue: /Cage|Orchard|Insured/, convoy_ambush: /Cut|Syndicate Wagon|Convoy/, border_incident: /Marker Stone|Stone in the Ford|Border/ };
    for (const [r, o] of NEW_CASES) {
      const c = after(r, o);
      const led = generatePaper(c, 7).stories.find((x) => x.slug === "ledger");
      expect(led, r).toBeDefined();
      expect(led!.head, r).toMatch(heads[templateOf(r)]!);
      expect(led!.body, r).toContain(`Purse: \u00a3${c.purse}`);
      expect(led!.body, r).not.toMatch(/Toll:|Bridge:/);
    }
  });

  it("states the material facts: toll amount, bridge state and the dead count", () => {
    for (const [r, o] of ALL_CASES) {
      if (templateOf(r) !== "secure_crossing") continue;
      const c = after(r, o);
      const text = generatePaper(c, 5).stories.map((s) => s.body).join(" ") + generatePaper(c, 5).standfirst;
      const dead = c.tally.garrisonKilled + c.tally.rivalKilled;
      expect(text, r).toContain(`\u00a3${c.crossing.toll}`);
      expect(text, r).toContain(c.crossing.bridge);
      expect(text, r).toContain(`Fallen: ${dead}`);
      expect(generatePaper(c, 5).standfirst, r).toContain(c.crossing.bridge);
    }
    // the facts follow the state, not the wording
    const sab = generatePaper(after("sabotaged", { bridge: "collapsed" }), 3);
    expect(paperText(sab)).toContain("collapsed");
    expect(paperText(sab)).toMatch(/WANTED: one bridge/);
  });

  it("spins casualties into euphemism, and a retreat into a decisive strategic repositioning", () => {
    const esc = (t: string): string => t.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(SPIN_DEAD.slice(1).flatMap((t) => t.lines).map((l) => l.split("{dead}").map(esc).join("\\d+")).join("|"));
    for (const n of [1, 3, 8]) {
      const c = after("forced", { tally: tally({ garrisonKilled: n }) });
      for (let s = 0; s < 10; s++) {
        const p = generatePaper(c, s);
        const cas = p.stories.find((x) => x.slug === "casualty");
        expect(cas, `${n}/${s}`).toBeDefined();
        expect(cas!.body).toMatch(pattern);
        expect(paperText(p)).not.toMatch(/\bkilled\b|\bmurder/i);   // the paper never says it plainly
      }
    }
    const retreats = Array.from({ length: 60 }, (_, s) => paperText(generatePaper(after("abandoned", { tally: tally({ garrisonRouted: 3 }) }), s))).join("\n");
    expect(retreats).toMatch(/strategic repositioning/i);
    expect(retreats).toMatch(/repositioning, at speed|rapidly explored|prepared positions/);
    const quiet = generatePaper(after("paid", { paid: 40 }), 2);
    expect(quiet.stories.some((s) => s.slug === "casualty")).toBe(false);
  });

  it("scandals, promises and rival pressure show up only when the ledger says so", () => {
    const hot = newCampaign(3); hot.factions.ward.rivalInfluence = 80;
    const bribed = applyOutcome(hot, out("bribed", { paid: 20 }));
    expect(generatePaper(bribed, 1).stories.some((s) => s.slug === "scandal")).toBe(true);
    expect(generatePaper(bribed, 1).notices.join(" ")).toContain("quartermaster");
    const landed = applyOutcome(bribed, out("paid", { paid: 30 }));
    expect(generatePaper(landed, 1).stories.find((s) => s.slug === "scandal")!.body).toMatch(/receipt|accounts|boots/);
    expect(generatePaper(applyOutcome(landed, out("paid", { paid: 30 })), 1).stories.some((s) => s.slug === "scandal")).toBe(false);
    expect(generatePaper(after("paid", { paid: 30 }), 1).stories.some((s) => s.slug === "promise")).toBe(false);
    expect(generatePaper(after("paid", { paid: 30, brokePromise: true }), 1).stories.some((s) => s.slug === "promise")).toBe(true);
    const rival = generatePaper(after("rival_secured"), 1);
    expect(rival.notices.join(" ")).toMatch(/Dunmarrow-Vesk management/);
  });

  it("before any expedition there is a prospectus edition; nothing references news that has not happened", () => {
    const p = generatePaper(newCampaign(8), 8);
    expect(p.edition).toBe(1);
    expect(HEADLINES.none).toContain(p.headline);
    expect(p.stories[0]!.slug).toBe("prospectus");
    expect(paperText(p)).not.toMatch(/Fallen/);
  });

  it("coverage sweep: every combination obeys the length limits, prints no placeholders, and has distinct notices", () => {
    let n = 0;
    const tallies = [tally(), tally({ garrisonKilled: 1 }), tally({ garrisonKilled: 4, limbsLost: 3, civiliansHarmed: 2 }), tally({ garrisonRouted: 5, wounded: 4, rivalKilled: 2 }), tally({ garrisonKilled: 40, garrisonRouted: 40, wounded: 40, limbsLost: 40, civiliansHarmed: 40, rivalKilled: 40 })];
    const pools = new Set<string>();
    for (const [r, o] of ALL_CASES) for (const t of tallies) for (const rivalInf of [5, 40, 90]) for (const bribeFirst of [false, true]) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let c = newCampaign(seed * 31);
      c.factions.ward.rivalInfluence = rivalInf;
      if (bribeFirst) c = applyOutcome(c, out("bribed", { paid: 20 }));
      c = applyOutcome(c, out(r, { ...o, tally: t }));
      const p = generatePaper(c, seed);
      n++;
      expect(p.headline.length).toBeLessThanOrEqual(PAPER_LIMITS.headline);
      expect(p.standfirst.length).toBeLessThanOrEqual(PAPER_LIMITS.standfirst);
      expect(p.stories.length).toBeGreaterThanOrEqual(3);
      expect(p.stories.length).toBeLessThanOrEqual(PAPER_LIMITS.stories);
      expect(new Set(p.stories.map((s) => s.slug)).size).toBe(p.stories.length);
      for (const s of p.stories) { expect(s.head.length).toBeGreaterThan(0); expect(s.head.length).toBeLessThanOrEqual(PAPER_LIMITS.head); expect(s.body.length).toBeGreaterThan(10); expect(s.body.length).toBeLessThanOrEqual(PAPER_LIMITS.body); }
      expect(p.notices.length).toBeGreaterThanOrEqual(3);
      expect(p.notices.length).toBeLessThanOrEqual(PAPER_LIMITS.notices);
      expect(new Set(p.notices).size).toBe(p.notices.length);
      for (const x of p.notices) expect(x.length).toBeLessThanOrEqual(PAPER_LIMITS.notice);
      const text = paperText(p);
      expect(text).not.toMatch(/[{}]|undefined|NaN|\bnull\b/);
      expect(text).not.toMatch(/  /);
      pools.add(p.masthead);
    }
    expect(n).toBeGreaterThan(1000);
    expect(pools.size).toBeGreaterThan(1);   // the masthead is per world seed
  });

  it("authored pools are big enough to read fresh", () => {
    expect(NOTICES.length).toBe(16);   // the notice stride walk relies on a power-of-two pool
    for (const x of NOTICES) expect(x.length).toBeLessThanOrEqual(PAPER_LIMITS.notice);
    for (const k of Object.keys(HEADLINES) as (keyof typeof HEADLINES)[]) for (const h of HEADLINES[k]) expect(h.length).toBeLessThanOrEqual(PAPER_LIMITS.headline + 12);   // +12 for filled placeholders
  });
});
