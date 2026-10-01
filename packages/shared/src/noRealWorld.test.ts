import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as factions from "./factions.ts";
import * as negText from "./negotiationText.ts";
import * as newsText from "./newspaperText.ts";
import { generatePaper } from "./newspaper.ts";
import { openParley } from "./negotiation.ts";
import { COMPLICATION_HINT } from "./chaos.ts";
import { TEMPLATES, TEMPLATE_IDS } from "./scenarios/registry.ts";
import { answerSiteParley, openSiteParley, type SiteParleyKind } from "./scenarios/parleys.ts";

/** The world is fictional. This scans the authored text of the campaign layer (and any other authored-text file that exists) for real-world names. */
const BANNED = [
  // nations, demonyms
  "england", "english", "britain", "british", "briton", "scotland", "scottish", "scots", "welsh", "ireland", "irish", "france", "french", "germany", "german", "spain", "spanish",
  "portugal", "portuguese", "italy", "italian", "dutch", "holland", "netherlands", "belgium", "belgian", "russia", "russian", "china", "chinese", "japan", "japanese", "india", "indian",
  "persia", "persian", "ottoman", "turkey", "turkish", "arabia", "arab", "arabs", "egypt", "egyptian", "america", "american", "canada", "canadian", "australia", "australian", "zulu",
  "ashanti", "sudan", "sudanese", "africa", "african", "europe", "european", "asia", "asian", "mexico", "mexican", "brazil", "brazilian", "korea", "korean", "vietnam", "afghan", "afghanistan",
  "boer", "maori", "bedouin", "mughal", "sikh", "pashtun", "swedish", "sweden", "norway", "norwegian", "denmark", "danish", "greek", "greece", "polish", "poland", "israel", "israeli", "palestine",
  // cities, landmarks, flags
  "london", "paris", "berlin", "rome", "madrid", "lisbon", "cairo", "delhi", "mumbai", "bombay", "calcutta", "istanbul", "constantinople", "khartoum", "lagos", "nairobi", "washington",
  "peking", "beijing", "tokyo", "kabul", "baghdad", "jerusalem", "mecca", "medina", "zanzibar", "suez", "gibraltar", "singapore", "hong kong", "new york", "cape town", "union jack", "stars and stripes",
  // religions, scripture, clergy
  "christian", "christians", "christianity", "muslim", "muslims", "islam", "islamic", "jewish", "jews", "judaism", "hindu", "hindus", "hinduism", "buddhist", "buddhists", "buddhism", "catholic",
  "catholics", "protestant", "anglican", "methodist", "allah", "jesus", "christ", "muhammad", "mohammed", "buddha", "mosque", "synagogue", "temple of", "bible", "koran", "quran", "pope", "imam", "rabbi", "missionary", "missionaries",
];
const RE = new RegExp(`(?<![a-z])(?:${BANNED.map((t) => t.replace(/ /g, "\\s+")).join("|")})(?![a-z])`, "i");

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};

describe("no real-world terms in authored text", () => {
  it("the banned list itself catches what it should", () => {
    for (const t of ["the British flag", "a Christian hymn", "Cairo nights", "new  york", "Union Jack"]) expect(RE.test(t), t).toBe(true);
    for (const t of ["Hollowmere Parish Notes", "the Kessar parapet", "Dunmarrow-Vesk Syndicate", "Ossuary Bay"]) expect(RE.test(t), t).toBe(false);
  });

  it("exported data tables are clean", () => {
    const all = [...strings(factions.POWERS), ...strings(factions.WARD), ...strings(negText), ...strings(newsText), ...strings(COMPLICATION_HINT)];
    for (const id of TEMPLATE_IDS) all.push(TEMPLATES[id].title, TEMPLATES[id].brief);
    expect(all.length).toBeGreaterThan(200);
    for (const s of all) expect(RE.test(s), s).toBe(false);
  });

  it("generated output is clean across seeds and states", () => {
    let c = factions.newCampaign(5);
    for (const r of factions.RESOLUTIONS) {
      const scenario = TEMPLATE_IDS.find((t) => t !== "secure_crossing" && factions.TEMPLATE_RESOLUTIONS[t].includes(r) && r !== "abandoned") ?? "secure_crossing";
      c = factions.applyOutcome(c, { scenario, resolution: r, toll: 40, paid: 20, bridge: "intact", brokePromise: true, seconds: 10,
        tally: { wounded: 2, downed: 1, limbsLost: 1, garrisonKilled: 2, garrisonRouted: 1, civiliansHarmed: 1, rivalKilled: 1 } });
      for (let s = 0; s < 25; s++) {
        const p = generatePaper(c, s);
        for (const t of strings(p)) expect(RE.test(t), t).toBe(false);
        const v = openParley(c, factions.leverageOf(c, { armed: 4, garrisonAlive: 4, garrisonTotal: 6, partyWounded: 0 }), s);
        for (const t of [v.line, v.speaker, ...v.options.flatMap((o) => [o.label, o.hint])]) expect(RE.test(t), t).toBe(false);
      }
    }
  });

  it("the people, parleys and hints of every template are clean", () => {
    const kinds: SiteParleyKind[] = ["ransom", "ward_post", "surveyor", "ford_post"];
    for (const kind of kinds) {
      for (let seed = 0; seed < 20; seed++) {
        const ctx = { price: 30 + seed, purse: 200, seed, day: seed };
        let v = openSiteParley(kind, ctx);
        const texts: string[] = [v.line, v.speaker];
        for (let o = 0; o < 5; o++) {
          const step = answerSiteParley(kind, ctx, v, o);
          texts.push(step.line);
          if (step.view) { texts.push(step.view.line, ...step.view.options.flatMap((x) => [x.label, x.hint])); if (o === 1) v = step.view; }
        }
        texts.push(...v.options.flatMap((x) => [x.label, x.hint]));
        for (const t of texts) expect(RE.test(t), t).toBe(false);
      }
    }
    const c = factions.newCampaign(9);
    for (const id of TEMPLATE_IDS) {
      const t = TEMPLATES[id];
      const s = t.init(c, 40, 9);
      for (const sp of t.roster(c, 9, s)) expect(RE.test(`${sp.name} ${sp.id}`), sp.name).toBe(false);
      const v = t.view(s, 0);
      for (const x of [v.hint, v.title, ...v.objectives.map((o) => o.text)]) expect(RE.test(x), x).toBe(false);
    }
  });

  it("the source files that carry the text are clean, comments included", () => {
    const dir = new URL(".", import.meta.url);
    for (const f of ["factions.ts", "negotiation.ts", "negotiationText.ts", "newspaper.ts", "newspaperText.ts", "campaignTypes.ts", "scenario.ts", "garrison.ts", "regions.ts", "chaos.ts", "kessar.ts",
      "scenarios/types.ts", "scenarios/common.ts", "scenarios/parleys.ts", "scenarios/crossing.ts", "scenarios/hostage.ts", "scenarios/convoy.ts", "scenarios/border.ts", "scenarios/registry.ts",
      // the hired hands, their orders and the manifest (D-034): authored names, grumbles, refusals, stores
      "followers.ts", "command.ts", "loadout.ts", "partyState.ts", "mount.ts", "morale.ts", "expeditionTypes.ts"]) {
      const url = new URL(f, dir);
      expect(existsSync(url), f).toBe(true);
      const hit = readFileSync(url, "utf8").split("\n").findIndex((l) => RE.test(l));
      expect(hit, `${f}:${hit + 1}`).toBe(-1);
    }
  });
});
