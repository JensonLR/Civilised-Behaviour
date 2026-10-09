import { describe, expect, it } from "vitest";
import type { ScenarioTemplateId } from "./campaignTypes.ts";
import { newCampaign, parseCampaign, serializeCampaign } from "./factions.ts";
import {
  HOME_POWER, INCIDENT, INCIDENT_DONE, INCIDENT_IDS, INCIDENT_OPEN, INCIDENT_PAPER, INCIDENT_PROMPT, applyIncident, dealIncident, incidentDelayS, incidentRoster, incidentStep, kegRing, placeIncident, ringOpen,
} from "./incidents.ts";
import { newPowers } from "./powers.ts";
import { generatePaper } from "./newspaper.ts";
import { REGIONS } from "./regions.ts";
import { REGION_NAME, incidentStory } from "./incidents.ts";
import { applyOutcome } from "./factions.ts";
import { zeroTally } from "./scenario.ts";
import { TEMPLATES as TEMPLATE_DEFS, TEMPLATE_IDS } from "./scenarios/registry.ts";
import { TERMS } from "./scenarios/terms.ts";
import { collectorsWelcome } from "./incidents.ts";

const TEMPLATES: ScenarioTemplateId[] = ["secure_crossing", "hostage_rescue", "convoy_ambush", "border_incident", "outpost_raid", "succession_dispute", "reapers_strike", "mine_rescue", "claim_race", "winding_engine", "smuggling_run", "flooded_market"];

describe("incidents: chaos during play (D-052)", () => {
  it("are dealt deterministically, about one run in five is quiet (D-084), every incident turns up, and the last one is never dealt twice running; the hub has none", () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const c = { ...newCampaign(seed), day: seed % 9 };
      for (const t of TEMPLATES.slice(0, 3)) {
        const a = dealIncident(c, t, "kessar", seed);
        expect(dealIncident(c, t, "kessar", seed)).toBe(a);
        counts[a] = (counts[a] ?? 0) + 1;
        n++;
        if (a !== "none") {
          const again = { ...c, sites: { ...c.sites, lastIncident: { id: a, result: "helped" as const, day: c.day, region: "kessar" as const } } };
          for (let k = 0; k < 5; k++) expect(dealIncident(again, t, "kessar", seed + k)).not.toBe(a);
        }
      }
      expect(dealIncident(c, "secure_crossing", "hollowmere", seed)).toBe("none");
    }
    expect((counts.none ?? 0) / n).toBeGreaterThan(0.12);
    expect((counts.none ?? 0) / n).toBeLessThan(0.3);
    for (const id of INCIDENT_IDS) expect(counts[id] ?? 0, id).toBeGreaterThan(((n * 0.8) / INCIDENT_IDS.length) * 0.6); // (each a fair share of the busy four-fifths: at least 0.6 of an even split)
    for (const t of TEMPLATES) {
      const d = incidentDelayS(newCampaign(3), t, 3);
      expect(d).toBeGreaterThanOrEqual(INCIDENT.delayMinS);
      expect(d).toBeLessThanOrEqual(INCIDENT.delayMaxS);
    }
  });

  it("is placed 22..32 m from the party on open ground in the bounds, away from the fight, and nowhere at all when nothing is open", () => {
    const party = { x: 0, z: 0 };
    const hostiles = [{ x: 0, z: 30 }, { x: 5, z: 28 }];
    const at = placeIncident(party, hostiles, () => true, 120, 7)!;
    const d = Math.hypot(at.x, at.z);
    expect(d).toBeGreaterThanOrEqual(INCIDENT.distMin - 1e-9);
    expect(d).toBeLessThanOrEqual(INCIDENT.distMax + 1e-9);
    expect(Math.min(...hostiles.map((h) => Math.hypot(h.x - at.x, h.z - at.z)))).toBeGreaterThan(INCIDENT.clearOfHostiles);
    expect(at.z).toBeLessThan(0); // the side away from the fight
    // a wall to the south and east: only the open side is used
    const open = (x: number, z: number): boolean => x < 5 && z < 5;
    const walled = placeIncident(party, [], open, 120, 7)!;
    expect(open(walled.x, walled.z)).toBe(true);
    // the bounds are respected; nothing open: nothing placed
    const edge = placeIncident({ x: 110, z: 110 }, [], () => true, 120, 3);
    if (edge) expect(Math.max(Math.abs(edge.x), Math.abs(edge.z))).toBeLessThanOrEqual(116);
    expect(placeIncident(party, [], () => false, 120, 7)).toBeUndefined();
  });

  it("an incident's spilled kegs lie on open ground, a keg apart: where the ring meets a wall they slide round it or are left out, never spawned inside it", () => {
    const at = { x: 10, z: -4 };
    // open ground all round: the plain ring, the first keg at the given bearing
    const all = kegRing(at, 5, 1.7, 0.4, () => true);
    expect(all.length).toBe(5);
    expect(all[0]!.x).toBeCloseTo(at.x + Math.cos(0.4) * 1.7, 9);
    for (const p of all) expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeCloseTo(1.7, 9);
    // a wall along x = 11 (the wreck a pace from it): every keg on the open side, none on top of another, the same every time
    const open = (x: number): boolean => x < 11 - 0.4;
    const some = kegRing(at, 5, 1.7, 0.4, (x) => open(x));
    expect(some.length).toBeGreaterThanOrEqual(INCIDENT.wagonSalvage);
    expect(some.length).toBeLessThan(5);
    for (const p of some) expect(open(p.x)).toBe(true);
    for (let i = 0; i < some.length; i++) for (let j = i + 1; j < some.length; j++) expect(Math.hypot(some[i]!.x - some[j]!.x, some[i]!.z - some[j]!.z)).toBeGreaterThanOrEqual(0.7);
    expect(kegRing(at, 5, 1.7, 0.4, (x) => open(x))).toEqual(some);
    // nowhere open: no kegs (the incident then stays quiet)
    expect(kegRing(at, 5, 1.7, 0.4, () => false)).toEqual([]);
    // the wagon is placed only where its whole ring is open (so it never stands with kegs in the surf or against a wall)
    expect(ringOpen(at, 1.7, () => true)).toBe(true);
    expect(ringOpen(at, 1.7, (x) => open(x))).toBe(false);
    expect(ringOpen(at, 0.5, (x) => open(x))).toBe(true);
  });

  it("each incident's people are civilians of the right sort, on no side, unarmed, in their own group", () => {
    for (const id of INCIDENT_IDS) {
      const r = incidentRoster(id, { x: 3, z: 4 }, "vesper", 9);
      if (id === "runaway_horse" || id === "powder_wagon") {
        expect(r, "the horse is a mount and the wagon is kegs, not a person").toEqual([]);
        continue;
      }
      if (id === "syndicate_collectors") {
        // D-088: the exception, on purpose: three armed men on the Syndicate's side, garrison brains, three different arms, in a line abreast round the spot
        expect(r.length).toBe(INCIDENT.collectors);
        for (const c of r) expect(c).toMatchObject({ group: "incident", side: "rival", faction: "rival", brain: "garrison" });
        expect(new Set(r.map((c) => c.weapon)).size).toBe(3);
        expect(Math.max(...r.map((c) => Math.hypot(c.post.x - 3, c.post.z - 4)))).toBeLessThan(2);
        continue;
      }
      expect(r.length).toBe(1);
      expect(r[0]).toMatchObject({ group: "incident", side: "neutral", brain: "civil", post: { x: 3, z: 4 } });
    }
    expect(incidentRoster("none", { x: 0, z: 0 }, "kessar", 1)).toEqual([]);
  });

  it("D-088: the collectors are seen off (broken) or paid (the contract ended first), and are dealt only where their gunfire breaks no stated rule", () => {
    expect(incidentStep("syndicate_collectors", { t: "broken" })).toBe("repelled");
    expect(incidentStep("syndicate_collectors", { t: "end" })).toBe("collected");
    expect(incidentStep("syndicate_collectors", { t: "shot" })).toBeUndefined();
    for (const id of TEMPLATE_IDS) {
      const listens = TEMPLATE_DEFS[id].observe.noise !== undefined;
      expect(collectorsWelcome(id), id).toBe(!listens && TERMS[id].fighting !== "forbidden" && id !== "mine_rescue");
    }
    // never dealt where barred, whatever the seed and day
    for (const t of TEMPLATE_IDS.filter((x) => !collectorsWelcome(x))) {
      for (let seed = 1; seed < 80; seed++) expect(dealIncident({ ...newCampaign(seed), day: (seed % 9) + 1 }, t, "kessar", seed), `${t} ${seed}`).not.toBe("syndicate_collectors");
    }
    // and dealt somewhere
    let seen = 0;
    for (let seed = 1; seed < 200; seed++) if (dealIncident({ ...newCampaign(seed), day: (seed % 9) + 1 }, "convoy_ambush", "kessar", seed) === "syndicate_collectors") seen++;
    expect(seen).toBeGreaterThan(0);
    // their bag and the grudge when seen off; their take when paid
    const c = { ...newCampaign(3), purse: 100 };
    const p = newPowers(3);
    const won = applyIncident(c, p, { id: "syndicate_collectors", result: "repelled", day: 2, region: "kessar" });
    expect(won.c.purse).toBe(100 + INCIDENT.collectorBag);
    expect(won.p.rival.grudge).toBe(Math.min(100, p.rival.grudge + INCIDENT.collectorGrudge));
    expect(applyIncident(c, p, { id: "syndicate_collectors", result: "collected", day: 2, region: "kessar" }).c.purse).toBe(100 - INCIDENT.collectorTake);
    expect(applyIncident({ ...c, purse: 5 }, p, { id: "syndicate_collectors", result: "collected", day: 2, region: "kessar" }).c.purse, "never below nothing").toBe(0);
  });

  it("every incident reaches every one of its results, and nothing else settles it", () => {
    expect(incidentStep("wounded_traveller", { t: "revived" })).toBe("helped");
    expect(incidentStep("wounded_traveller", { t: "end" })).toBe("passed_by");
    expect(incidentStep("wounded_traveller", { t: "shot" })).toBe("passed_by");
    expect(incidentStep("wounded_traveller", { t: "use", room: true })).toBeUndefined();
    expect(incidentStep("courier", { t: "use", room: false })).toBe("delivered");
    expect(incidentStep("courier", { t: "end" })).toBe("missed");
    expect(incidentStep("courier", { t: "revived" })).toBeUndefined();
    expect(incidentStep("deserter", { t: "use", room: true })).toBe("enlisted");
    expect(incidentStep("deserter", { t: "use", room: false })).toBe("turned_away");
    expect(incidentStep("deserter", { t: "shot" })).toBe("turned_away");
    expect(incidentStep("runaway_horse", { t: "mounted" })).toBe("caught");
    expect(incidentStep("runaway_horse", { t: "end" })).toBe("strayed");
    expect(incidentStep("runaway_horse", { t: "use", room: true })).toBeUndefined();
    expect(incidentStep("powder_wagon", { t: "kegs", left: INCIDENT.wagonKegs - 1 })).toBe("salvaged");
    expect(incidentStep("powder_wagon", { t: "kegs", left: INCIDENT.wagonSalvage })).toBe("salvaged");
    expect(incidentStep("powder_wagon", { t: "kegs", left: INCIDENT.wagonSalvage - 1 })).toBe("went_up");
    expect(incidentStep("powder_wagon", { t: "end" })).toBe("went_up");
    expect(incidentStep("powder_wagon", { t: "shot" })).toBeUndefined();
    expect(incidentStep("powder_wagon", { t: "use", room: true })).toBeUndefined();
  });

  it("the courier's arrears go into the purse, a helped traveller earns the home power's trust (the Ward in Kessar, a minor power elsewhere), and the record is kept and saved", () => {
    const c = newCampaign(5);
    const p = newPowers(5);
    const paid = applyIncident(c, p, { id: "courier", result: "delivered", day: 2, region: "kessar" });
    expect(paid.c.purse).toBe(c.purse + INCIDENT.courierPay);
    expect(paid.c.sites.lastIncident).toEqual({ id: "courier", result: "delivered", day: 2, region: "kessar" });
    expect(applyIncident(c, p, { id: "runaway_horse", result: "caught", day: 2, region: "highmark" }).c.purse).toBe(c.purse + INCIDENT.horseReward);
    expect(applyIncident(c, p, { id: "runaway_horse", result: "strayed", day: 2, region: "highmark" }).c.purse).toBe(c.purse);
    const ward = applyIncident(c, p, { id: "wounded_traveller", result: "helped", day: 2, region: "kessar" });
    expect(ward.c.factions.ward.trust).toBe(Math.min(100, c.factions.ward.trust + INCIDENT.helpedTrust));
    expect(ward.p).toBe(p);
    const choir = applyIncident(c, p, { id: "wounded_traveller", result: "helped", day: 2, region: "vesper" });
    expect(choir.p.minor.choir.trust).toBe(Math.min(100, p.minor.choir.trust + INCIDENT.helpedTrust));
    expect(choir.c.factions.ward.trust).toBe(c.factions.ward.trust);
    const passed = applyIncident(c, p, { id: "wounded_traveller", result: "passed_by", day: 2, region: "vesper" });
    expect(passed.p).toBe(p);
    expect(passed.c.purse).toBe(c.purse);
    // saved and read back; a hostile record is dropped, not trusted
    expect(parseCampaign(serializeCampaign(paid.c))!.sites.lastIncident).toEqual(paid.c.sites.lastIncident);
    const bad = JSON.parse(serializeCampaign(paid.c));
    bad.sites.lastIncident = { id: "dragon", result: "helped", day: 1, region: "kessar" };
    expect(parseCampaign(JSON.stringify(bad))!.sites.lastIncident).toBeUndefined();
    expect(parseCampaign(serializeCampaign(c))!.sites.lastIncident).toBeUndefined();
    expect(HOME_POWER.hollowmere).toBeUndefined();
  });

  it("the copy is complete, names nobody real and keeps its placeholders", () => {
    const BANNED = /(?<![a-z])(england|english|paris|france|french|germany|german|spain|china|india|america|american|europe|african|africa|christian|muslim|jewish|church|bible|pope)(?![a-z])/i;
    const all = [...Object.values(INCIDENT_OPEN), ...Object.values(INCIDENT_PROMPT), ...Object.values(INCIDENT_DONE), ...Object.values(INCIDENT_PAPER).flatMap((x) => [x.head, x.body])];
    for (const t of all) expect(BANNED.test(t), t).toBe(false);
    for (const id of INCIDENT_IDS) expect(INCIDENT_OPEN[id]).toContain("%n");
    for (const v of Object.values(INCIDENT_PAPER)) expect(v.body).toContain("%r");
  });

  it("the next paper prints the incident beside the expedition it happened on, and not after the next one; the region names match the chart's", () => {
    for (const r of Object.keys(REGION_NAME) as (keyof typeof REGION_NAME)[]) expect(REGION_NAME[r]).toBe(REGIONS[r].name);
    let c = newCampaign(11);
    const o = { scenario: "hostage_rescue" as const, resolution: "rescued" as const, toll: 0, paid: 0, bridge: "intact" as const, tally: zeroTally(), brokePromise: false, seconds: 200 };
    const day = c.day + 1;
    c = applyOutcome(c, o);
    c = applyIncident(c, newPowers(11), { id: "deserter", result: "enlisted", day, region: "kessar" }).c;
    expect(incidentStory(c)).toEqual({ head: INCIDENT_PAPER.enlisted.head, body: INCIDENT_PAPER.enlisted.body.replace("%r", "Kessar Reach") });
    const paper = generatePaper(c, 11);
    expect(JSON.stringify(paper)).toContain(INCIDENT_PAPER.enlisted.head);
    const later = applyOutcome(c, o);
    expect(incidentStory(later)).toBeUndefined();
  });
});
