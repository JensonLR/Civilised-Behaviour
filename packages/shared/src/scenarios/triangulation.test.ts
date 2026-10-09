import { describe, expect, it } from "vitest";
import type { CampaignState, ScenarioView } from "../campaignTypes.ts";
import { NPC } from "../campaignTypes.ts";
import { rayWorld, type WorldHit } from "../ballistics.ts";
import { OBJECTIVE_SPOTS, objectiveMark } from "../compassMarks.ts";
import { REGION_COPY } from "../regionCopy.ts";
import { TEMPLATE_RESOLUTIONS, newCampaign } from "../factions.ts";
import { NavQuery, buildNavGrid, newNavPath } from "../nav.ts";
import { PROP_DEFS, PropKind } from "../props.ts";
import type { ScenarioInput } from "../scenario.ts";
import { VESPER_ANCHORS, VESPER_TRIG, createVesperWorld, vesperNavOptions, vesperPlan, vesperRoadDistance, vesperSitePoints } from "../vesper.ts";
import { answerSiteParley, openSiteParley } from "./parleys.ts";
import { CARRY_KIND, TEMPLATES, TEMPLATE_IDS, carryUsePrompt } from "./registry.ts";
import { OUTCOME_KIND, TERMS } from "./terms.ts";
import { TRIG, VIGIL_STATION, closed, triangulationTemplate as def, type TrigState } from "./triangulation.ts";
import type { Fx } from "./types.ts";

/** D-096: the Triangulation, Vesper Gorge's fourth contract (the GDD's survey). */
function seedWith(pred: (s: TrigState) => boolean): { c: CampaignState; seed: number } {
  for (let seed = 1; seed < 600; seed++) {
    const c = { ...newCampaign(seed), purse: 300 };
    if (pred(def.init(c, 0, seed))) return { c, seed };
  }
  throw new Error("no seed");
}
const { c: C, seed: SEED } = seedWith((s) => s.complication === "none");
const S0 = def.init(C, 0, SEED);
function drive(events: readonly ScenarioInput[], s0: TrigState = S0): { s: TrigState; fx: Fx[] } {
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
const said = (fx: Fx[]): string => fx.map((f) => (typeof f === "object" && f.k === "say" ? f.text : "")).join(" | ");
const use = (k: number, slot = 0): ScenarioInput => ({ t: "use", target: `station-${k}`, slot });
/** A full round at station k by one person: a press, then the cooldown, `need` times. */
const round = (k: number, need = S0.need): ScenarioInput[] => Array.from({ length: need }, () => [use(k), { t: "tick", dt: TRIG.coolS + 0.05 } as ScenarioInput]).flat();
const names = (result: Extract<ScenarioInput, { t: "talk" }>["result"], paid = 0): ScenarioInput => ({ t: "talk", kind: "needle_names", result, paid });
const rival = (result: Extract<ScenarioInput, { t: "talk" }>["result"]): ScenarioInput => ({ t: "talk", kind: "railway_surveyor", result, paid: 0 });
/** All three stations booked before the vigil (station 1 first, while nobody keeps it). */
const CLOSED = drive([...round(1), ...round(0), ...round(2)]).s;

describe("the Triangulation (D-096): the reducer", () => {
  it("is deterministic; its prices are in range; the vigil and the filing in their windows; fog and rain lengthen a round, a rival bid hurries the Syndicate", () => {
    expect(def.init(C, 0, SEED)).toEqual(S0);
    for (let seed = 1; seed < 200; seed++) {
      const s = def.init({ ...newCampaign(seed), purse: 300 }, 0, seed);
      expect(s.price.names % 5).toBe(0);
      expect(s.price.names).toBeGreaterThanOrEqual(TRIG.priceNames[0]);
      expect(s.price.sale).toBeLessThanOrEqual(TRIG.priceSale[1]);
      expect(s.vigilAt).toBeGreaterThanOrEqual(TRIG.vigilMin);
      expect(s.vigilAt).toBeLessThanOrEqual(TRIG.vigilMax);
      const bid = s.complication === "rival_bid" ? TRIG.rivalBid : 0;
      expect(s.fileAt).toBeGreaterThanOrEqual(TRIG.fileMin + bid);
      expect(s.fileAt).toBeLessThanOrEqual(TRIG.fileMax + bid);
      expect(s.need).toBe(s.complication === "fog" || s.complication === "rain" ? TRIG.foulPresses : TRIG.presses);
    }
  });

  it("a round of angles is one press per person per cooldown; two people at one station take it twice as fast; a booked station takes no more", () => {
    const fast = drive([use(0, 0), use(0, 0), use(0, 0)]).s;
    expect(fast.obs[0], "one person, no time passing: one press").toBe(1);
    // (a press too soon is taken, a fresh state; a press at a booked station is refused, the same state: the runner drops the instrument only on the second)
    const once = drive([use(0, 0)]).s;
    expect(def.reduce(once, use(0, 0)).s).not.toBe(once);
    const booked = drive(round(0)).s;
    expect(def.reduce(booked, { t: "tick", dt: 2 } as ScenarioInput).s.obs).toEqual(booked.obs);
    const later = def.reduce(booked, { t: "tick", dt: 2 } as ScenarioInput).s;
    expect(def.reduce(later, use(0, 0)).s).toBe(later);
    const two = drive([use(0, 0), use(0, 1)]).s;
    expect(two.obs[0]).toBe(2);
    const one = drive(round(0));
    expect(one.s.obs[0]).toBe(S0.need);
    expect(said(one.fx)).toMatch(/Assay station is booked/);
    expect(drive([...round(0), use(0)]).s.obs[0]).toBe(S0.need);
    expect(drive([{ t: "use", target: "station-7", slot: 0 }, { t: "use", target: "nonsense", slot: 0 }]).s).toEqual(S0);
    expect(closed(CLOSED)).toBe(true);
    expect(CLOSED.phase).toBe("standoff");
  });

  it("the Guild's vigil: spawned at its time, walks to the west bench, goes home after; measuring it is noticed, a broken promise, and costs the Guild's names", () => {
    const at = drive(ticks(S0.vigilAt + 1));
    expect(at.fx).toContainEqual({ k: "spawn", group: "late:vigil" });
    expect(at.fx).toContainEqual({ k: "order", group: "late:vigil", order: { o: "guard", x: VESPER_TRIG.stations[VIGIL_STATION]!.x, z: VESPER_TRIG.stations[VIGIL_STATION]!.z, r: 3 } });
    expect(def.view(at.s, 0).objectives.some((o) => o.id === "vigil")).toBe(true);
    const over = drive(ticks(TRIG.vigilS + 1), at.s);
    expect(over.fx).toContainEqual({ k: "order", group: "late:vigil", order: { o: "post" } });
    expect(def.view(over.s, 0).objectives.find((o) => o.id === "vigil"), "its candle stays on the cairn").toMatchObject({ done: true, text: expect.stringMatching(/candle/) });
    // measuring it
    const rude = drive([use(VIGIL_STATION)], at.s);
    expect(rude.s.rude).toBe(true);
    expect(rude.s.brokePromise).toBe(true);
    expect(said(rude.fx)).toMatch(/vigil/);
    const all = drive([{ t: "tick", dt: TRIG.coolS + 0.05 }, ...round(VIGIL_STATION).slice(2), ...round(0), ...round(2), names("open"), names("paid", S0.price.names)], rude.s);
    expect(all.s.phase, "the Guild will not sell its names").not.toBe("resolved");
    expect(said(all.fx)).toMatch(/not for sale/);
    expect(drive([names("open"), names("tell")], all.s).s.resolution, "the Committee's names are still the party's to read").toBe("trig_committee");
    // not measuring it: the same station after the vigil is courteous
    expect(drive(round(VIGIL_STATION), over.s).s.rude).toBe(false);
  });

  it("trig_guild: the Guild's names for its fee, only once the triangle is closed; trig_committee: the Committee's, read to his face", () => {
    const early = drive([names("open"), names("paid", S0.price.names)]);
    expect(early.s.phase).not.toBe("resolved");
    expect(said(early.fx)).toMatch(/Measure them first/);
    const guild = drive([names("open"), names("paid", S0.price.names)], CLOSED);
    expect(guild.s.resolution).toBe("trig_guild");
    expect(guild.s.paid).toBe(S0.price.names);
    expect(def.outcome(guild.s)).toMatchObject({ scenario: "triangulation", region: "vesper", paid: S0.price.names, brokePromise: false });
    expect(drive([names("open"), names("paid", 1)], CLOSED).s.phase, "out of the band").not.toBe("resolved");
    const committee = drive([names("open"), names("tell")], CLOSED);
    expect(committee.s.resolution).toBe("trig_committee");
    expect(said(committee.fx)).toMatch(/Fothergill-Pym/);
    expect(OUTCOME_KIND.trig_guild).toBe("won");
    expect(OUTCOME_KIND.trig_committee).toBe("won");
  });

  it("trig_sold: the closed triangle to the Syndicate's surveyor, who pays; an open one he will not buy", () => {
    expect(drive([rival("open"), rival("survey")]).s.phase).not.toBe("resolved");
    const sold = drive([rival("open"), rival("learn"), rival("survey")], CLOSED);
    expect(sold.s.resolution).toBe("trig_sold");
    expect(def.outcome(sold.s)?.loot).toBe(S0.price.sale);
    expect(OUTCOME_KIND.trig_sold).toBe("partial");
  });

  it("trig_outsurveyed: the Syndicate files on its clock (warned first); shooting its surveyors stops it, a broken promise; leaving after anything is to be outsurveyed", () => {
    const warn = drive(ticks(S0.fileAt - TRIG.warnS + 1));
    expect(said(warn.fx)).toMatch(/folding their tripod/);
    expect(def.view(warn.s, 0).timerLabel).toBe("The Syndicate files");
    const filed = drive(ticks(TRIG.warnS + 1), warn.s);
    expect(filed.s.resolution).toBe("trig_outsurveyed");
    expect(OUTCOME_KIND.trig_outsurveyed).toBe("lost");
    const shot = drive([{ t: "hostile", at: "surveyors" }, ...ticks(S0.fileAt + 10)]);
    expect(shot.s.resolution).toBeUndefined();
    expect(shot.s.brokePromise).toBe(true);
    expect(shot.fx).toContainEqual({ k: "order", group: "surveyors", order: { o: "flee" } });
    expect(drive([{ t: "hostile", at: "surveyors" }, rival("open")]).s.parley, "nobody to sell to").toBeUndefined();
    expect(def.leave(S0)).toBeUndefined();
    expect(def.leave(drive([use(0)]).s)).toBe("trig_outsurveyed");
    expect(drive([{ t: "party_down" }]).s.resolution).toBe("abandoned");
    // a shot among the Guild's people: no names from the Guild after it
    const hurt = drive([{ t: "hostile", at: "guild" }], CLOSED);
    expect(hurt.s.brokePromise).toBe(true);
    expect(drive([names("open")], hurt.s).s.parley).toBeUndefined();
  });

  it("the view: short objectives, every placed one has a compass spot, the strip walks the unbooked stations then to the Dirge-Master; the rule is the terms'", () => {
    const v0 = def.view(S0, 0);
    expect(v0.title).toBe("The Triangulation");
    expect(objectiveMark("vesper", v0)).toMatchObject({ x: VESPER_TRIG.stations[0]!.x, z: VESPER_TRIG.stations[0]!.z });
    const one = def.view(drive(round(0)).s, 0);
    expect(objectiveMark("vesper", one)).toMatchObject({ x: VESPER_TRIG.stations[1]!.x, z: VESPER_TRIG.stations[1]!.z });
    expect(objectiveMark("vesper", def.view(CLOSED, 0))?.label).toBe("The Dirge-Master");
    for (const st of [S0, CLOSED, drive(ticks(S0.vigilAt + 1)).s, drive(ticks(S0.vigilAt + TRIG.vigilS + 2)).s, drive([names("open"), names("tell")], CLOSED).s]) {
      for (const o of def.view(st, 0).objectives) {
        expect(o.id in OBJECTIVE_SPOTS.triangulation, o.id).toBe(true);
        expect(o.text.length, o.text).toBeLessThanOrEqual(60);
      }
    }
    expect(def.view(S0, 0).rule).toBe(TERMS.triangulation.rule);
  });

  it("the roster and the parleys: the Dirge-Master, two railway surveyors, the vigil held back; nobody armed; the scripts report what the template reads", () => {
    const r = def.roster(C, SEED, S0);
    expect(r.find((p) => p.id === "dirge")).toMatchObject({ role: NPC.MOURNER, side: "neutral", brain: "civil" });
    expect(r.filter((p) => p.group === "surveyors")).toHaveLength(2);
    expect(r.filter((p) => p.group === "late:vigil").every((p) => p.brain === "garrison" && p.side === "neutral")).toBe(true);
    expect(r.every((p) => p.weapon === r[0]!.weapon), "nobody armed").toBe(true);
    expect(def.props).toEqual([{ id: "theodolite", kind: PropKind.INSTRUMENT, x: VESPER_TRIG.theodolite.x, z: VESPER_TRIG.theodolite.z }]);
    expect(PROP_DEFS[PropKind.INSTRUMENT]).toMatchObject({ name: "theodolite", carryable: true });
    const at2 = (dx: number, v = def.view(S0, 0), kind: number = PropKind.INSTRUMENT): string | undefined => carryUsePrompt(v, VESPER_TRIG.stations[2]!.x + dx, VESPER_TRIG.stations[2]!.z, kind);
    expect(at2(1)).toBe("Take a round of angles");
    expect(at2(1, def.view(S0, 0), PropKind.CRATE), "an ore crate measures nothing").toBeUndefined();
    expect(at2(9)).toBeUndefined();
    expect(at2(1, def.view(drive(round(2)).s, 0)), "a booked station takes no more").toBeUndefined();
    expect(at2(1, def.view(drive([names("open"), names("tell")], CLOSED).s, 0)), "nor anything after the end").toBeUndefined();
    const results = (kind: "needle_names" | "railway_surveyor", price: number): string[] => {
      const ctx = { price, purse: 300, seed: 3, day: 2 };
      const v = openSiteParley(kind, ctx);
      expect(v.frame?.heading.length).toBeGreaterThan(8);
      const out = new Set<string>();
      for (let i = 0; i < v.options.length; i++) {
        const st = answerSiteParley(kind, ctx, v, i);
        if (st.done) out.add(st.done.result);
        else if (st.view) for (let k = 0; k < st.view.options.length; k++) { const s2 = answerSiteParley(kind, ctx, st.view, k); if (s2.done) out.add(s2.done.result); }
      }
      return [...out].sort();
    };
    expect(results("needle_names", S0.price.names)).toEqual(["paid", "tell", "walked"]);
    expect(results("railway_surveyor", S0.price.sale)).toEqual(["survey", "walked"]);
  });
});

describe("the Triangulation's ground (D-096): five seeds", () => {
  const out = {} as WorldHit;
  it("each station is open, reached on foot from the wharf (the terrace by its east ramp), and in sight of the other two over the gorge; the theodolite's case is on open ground; all are story points", () => {
    const ids = new Set(vesperSitePoints().map((p) => p.id));
    for (const k of ["trig.station0", "trig.station1", "trig.station2", "trig.theodolite"]) expect(ids.has(k), k).toBe(true);
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const w = createVesperWorld(seed);
      const q = new NavQuery(buildNavGrid(w, vesperNavOptions(w)));
      const path = newNavPath();
      const S = VESPER_TRIG.stations;
      const eye = (p: { x: number; z: number }): number => w.terrainHeight(p.x, p.z) + 1.6;
      for (const p of [...S, VESPER_TRIG.theodolite]) {
        expect(q.open(p.x, p.z), `${p.x},${p.z} @${seed}`).toBe(true);
        expect(q.path(VESPER_ANCHORS.landing.x, VESPER_ANCHORS.landing.z - 6, p.x, p.z, path) && path.complete, `reach ${p.x},${p.z} @${seed}`).toBe(true);
      }
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const A = S[a]!, B = S[b]!;
        const dx = B.x - A.x, dy = eye(B) - eye(A), dz = B.z - A.z, L = Math.hypot(dx, dy, dz);
        expect(rayWorld(w, A.x, eye(A), A.z, dx / L, dy / L, dz / L, L - 0.5, out), `station ${a} sees station ${b} @${seed}`).toBe(false);
      }
      // the signals: solid, two paces off their stations (inside the reach of Use there), clear of the road and of every post, banner, lamp, tent and cart the plan stands up, and
      // on level ground (no signal at the lip of a drop)
      const plan = vesperPlan();
      const posts = [...plan.banners, ...plan.lamps, ...plan.signs, ...plan.tents, ...plan.carts, ...plan.pegs];
      VESPER_TRIG.signals.forEach((g, k) => {
        const d = Math.hypot(g.x - S[k]!.x, g.z - S[k]!.z);
        expect(d, `signal ${k} off its station`).toBeGreaterThan(1.9);
        expect(d, `signal ${k} within reach`).toBeLessThan(TRIG.stationR);
        expect(w.resolveXZ({ x: g.x, z: g.z }, w.terrainHeight(g.x, g.z) + 0.2, 0.3, 1.2), `signal ${k} is solid`).toBe(true);
        expect(vesperRoadDistance(g.x, g.z), `signal ${k} off the road`).toBeGreaterThan(2.5);
        for (const p of posts) expect(Math.hypot(p.x - g.x, p.z - g.z), `signal ${k} clear of ${p.x},${p.z}`).toBeGreaterThan(4);
        for (let a = 0; a < 8; a++) {
          const x = g.x + Math.cos(a * Math.PI / 4) * 2, z = g.z + Math.sin(a * Math.PI / 4) * 2;
          expect(Math.abs(w.terrainHeight(x, z) - w.terrainHeight(g.x, g.z)), `signal ${k} on level ground`).toBeLessThan(1.2);
        }
      });
      // the terrace station is up on the terrace (the climb is part of the job)
      expect(w.terrainHeight(S[2]!.x, S[2]!.z)).toBeGreaterThan(11);
    }
  }, 120_000);
});

describe("the Triangulation on Vesper's chart (D-096)", () => {
  it("the chart note remembers how the survey ended, and stays within the chart's 240 characters with every Vesper ending at once", () => {
    const rc = REGION_COPY.vesper!;
    let worst = 0;
    for (const m of TEMPLATE_RESOLUTIONS.mine_rescue) for (const cl of TEMPLATE_RESOLUTIONS.claim_race) for (const e of TEMPLATE_RESOLUTIONS.winding_engine) for (const t of TEMPLATE_RESOLUTIONS.triangulation) {
      const c = newCampaign(1);
      c.history.push({ region: "vesper" } as never);
      c.sites.ends = { mine_rescue: m, claim_race: cl, winding_engine: e, triangulation: t } as never;
      worst = Math.max(worst, rc.chartNote(c).length);
    }
    expect(worst).toBeLessThanOrEqual(240);
    const c = newCampaign(1);
    c.history.push({ region: "vesper" } as never);
    c.sites.ends = { triangulation: "trig_guild" } as never;
    expect(rc.chartNote(c)).toMatch(/Guild's names/);
  });
});

describe("carried things at use points (D-096): every fixed point that takes a carried thing says what it does", () => {
  it("each `at` use point that asks for a carried kind names its prompt, and the prompt is offered in reach and not out of it", () => {
    for (const id of TEMPLATE_IDS) {
      for (const u of TEMPLATES[id].observe.use) {
        if (!u.at || u.carry === undefined || u.carry === "none") continue;
        expect(u.prompt, `${id}:${u.id}`).toBeTruthy();
        expect(u.prompt!.length, `${id}:${u.id}`).toBeLessThanOrEqual(48);
        const v = { phase: "waiting", objectives: [], hint: "", timerLabel: "", endsAtWorldMs: 0, template: id, title: "" } as ScenarioView;
        expect(carryUsePrompt(v, u.at.x + u.r * 0.5, u.at.z, CARRY_KIND[u.carry]), `${id}:${u.id}`).toBe(u.prompt);
        expect(carryUsePrompt(v, u.at.x + u.r + 1, u.at.z, CARRY_KIND[u.carry]), `${id}:${u.id}`).toBeUndefined();
      }
    }
  });
});
