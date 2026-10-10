import { describe, expect, it } from "vitest";
import { newCampaign, parseCampaign } from "./factions.ts";
import { GRUDGE, epithet, grudgeLook, grudgeLoss, grudgeName, pickGrudge, rememberGrudge, type Grudge } from "./grudges.ts";
import { LIMB } from "./limbs.ts";
import { NPC } from "./campaignTypes.ts";

/** D-109: survivors with grudges. Who he becomes, what he looks like when he is back, who is remembered, who comes back, and that the list survives a save. */
const man = (over: Partial<Grudge> = {}): Grudge => ({
  name: "Sentry Tamsin Cray", role: NPC.SENTRY, lookSeed: 77, faction: "ward", region: "kessar", missing: 0, burnt: false, cause: "boot", by: "Ada", day: 3, returns: 0, ...over,
});

describe("D-109: what he becomes", () => {
  it("named for the worst of it, the name kept whole around the nickname, the look to match, the loss in the paper's words", () => {
    expect(epithet(man({ missing: LIMB.ARM_R, cause: "limb" }))).toBe("Hook");
    expect(epithet(man({ missing: LIMB.LEG_L, cause: "limb", burnt: true }))).toBe("Peg");
    expect(epithet(man({ burnt: true, cause: "fire" }))).toBe("Smoky");
    expect(epithet(man({ cause: "boot" }))).toBe("Bootprint");
    expect(epithet(man({ cause: "rope" }))).toBe("Tether");
    expect(epithet(man({ cause: "hoof" }))).toBe("Hoofprint"); // (D-111: ridden down)
    expect(grudgeName("Sentry Tamsin Cray", "Hook")).toBe('Sentry Tamsin "Hook" Cray');
    expect(grudgeName("Picket Corporal Dunstan Aldous", "Peg")).toBe('Picket Corporal Dunstan "Peg" Aldous');
    expect(grudgeName('Sentry Tamsin "Hook" Cray', "Peg")).toBe('Sentry Tamsin "Hook" Cray'); // (one nickname is plenty)
    expect(grudgeName("Morrow", "Hook")).toBe('"Hook" Morrow');
    expect(grudgeLook(man({ missing: LIMB.ARM_R }))).toEqual({ hook: 2 });
    expect(grudgeLook(man({ missing: LIMB.ARM_L | LIMB.LEG_R }))).toEqual({ hook: 1, woodenLeg: 2 });
    expect(grudgeLook(man({ burnt: true }))).toMatchObject({ burnt: 2 });
    expect(grudgeLook(man())).toEqual({});
    expect(grudgeLoss(man({ missing: LIMB.ARM_L }))).toBe("an arm");
    expect(grudgeLoss(man({ missing: LIMB.ARM_L | LIMB.LEG_L }))).toBe("rather more than one limb");
    expect(grudgeLoss(man({ cause: "fire", burnt: true }))).toBe("his eyebrows");
    expect(grudgeLoss(man({ cause: "rope" }))).toBe("his liberty");
    expect(grudgeLoss(man({ cause: "hoof" }))).toBe("his hat");
  });
});

describe("D-109: who is remembered, who comes back", () => {
  it("the same man is remembered once (the newer account wins); past the cap the oldest is forgotten", () => {
    let list = rememberGrudge(undefined, man({ day: 1 }));
    list = rememberGrudge(list, man({ day: 2, cause: "limb", missing: LIMB.ARM_R }));
    expect(list).toHaveLength(1);
    expect(list[0]!.missing).toBe(LIMB.ARM_R);
    for (let i = 0; i < GRUDGE.cap + 2; i++) list = rememberGrudge(list, man({ lookSeed: 1000 + i, day: 10 + i }));
    expect(list).toHaveLength(GRUDGE.cap);
    expect(list[0]!.lookSeed).toBe(1002);
  });

  it("in his own region, after a night, the oldest first; never past his last return", () => {
    const list = [man({ lookSeed: 1, day: 5 }), man({ lookSeed: 2, day: 3 }), man({ lookSeed: 3, day: 1, region: "highmark" }), man({ lookSeed: 4, day: 2, returns: GRUDGE.maxReturns })];
    expect(pickGrudge(list, "kessar", 6)).toBe(1);
    expect(pickGrudge(list, "kessar", 3)).toBe(-1); // (day 3's man needs his night; day 5's too)
    expect(pickGrudge(list, "kessar", 4)).toBe(1);
    expect(pickGrudge(list, "highmark", 9)).toBe(2);
    expect(pickGrudge(list, "vesper", 9)).toBe(-1);
    expect(pickGrudge(undefined, "kessar", 9)).toBe(-1);
  });
});

describe("D-109: kept in the save", () => {
  it("round-trips through the campaign codec; a malformed one is dropped; an older save simply has none", () => {
    const c = newCampaign(5);
    const g = man({ missing: LIMB.LEG_R, cause: "limb", people: "kessarine" });
    const saved = JSON.stringify({ ...c, sites: { ...c.sites, grudges: [g, { ...g, lookSeed: 9, region: "atlantis" }, { name: 3 }, { ...g, lookSeed: 10, cause: "boredom" }] } });
    const back = parseCampaign(saved)!;
    expect(back.sites.grudges).toEqual([g]);
    const h = man({ lookSeed: 11, cause: "hoof" }); // (D-111: ridden down)
    expect(parseCampaign(JSON.stringify({ ...c, sites: { ...c.sites, grudges: [h] } }))!.sites.grudges).toEqual([h]);
    expect(parseCampaign(JSON.stringify(c))!.sites.grudges).toBeUndefined();
    expect(parseCampaign(JSON.stringify({ ...c, sites: { ...c.sites, grudges: "lots" } }))!.sites.grudges).toBeUndefined();
  });
});
