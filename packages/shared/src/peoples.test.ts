import { describe, expect, it } from "vitest";
import { NPC, REGION_IDS } from "./campaignTypes.ts";
import { DYE, PEOPLE, PEOPLE_IDS, PEOPLE_OF_REGION, WAYFARER_MIX, isPeopleId, peopleForNpc, peopleForVillager, resolvePeople } from "./peoples.ts";
import { PALETTE } from "./palette.ts";

describe("the native peoples contract", () => {
  it("has six fictional peoples, one home people per region and a hub-visitor mix", () => {
    expect(PEOPLE_IDS).toHaveLength(6);
    expect(new Set(PEOPLE_IDS).size).toBe(6);
    for (const id of PEOPLE_IDS) expect(PEOPLE[id].id).toBe(id);
    expect(REGION_IDS.map((r) => PEOPLE_OF_REGION[r])).toEqual(["mereborn", "kessarine", "marchers", "vesperine", "brinefolk"]);
    expect(PEOPLE.wayfarers.home).toBe("visitors");
    for (const r of REGION_IDS) expect(PEOPLE[PEOPLE_OF_REGION[r]].home).toBe(r);
    expect(isPeopleId("mereborn")).toBe(true);
    expect(isPeopleId("colonial")).toBe(false);
  });
  it("every people draws its dyes from the twelve cloth dyes, and the dye table matches the palette's length", () => {
    expect(Object.keys(DYE)).toHaveLength(PALETTE.cloth.length);
    for (const id of PEOPLE_IDS) {
      expect(PEOPLE[id].dyes.length).toBeGreaterThanOrEqual(5);
      for (const d of PEOPLE[id].dyes) expect(DYE[d]).toBeLessThan(PALETTE.cloth.length);
    }
    // two peoples never share the same three commonest dyes: they must read apart at a glance
    const key = (id: (typeof PEOPLE_IDS)[number]): string => PEOPLE[id].dyes.slice(0, 3).slice().sort().join();
    expect(new Set(PEOPLE_IDS.map(key)).size).toBe(PEOPLE_IDS.length);
  });
  it("every NPC role is placed: the Society's own are colonial, the locals belong to their people", () => {
    for (const region of REGION_IDS) {
      for (const role of Object.values(NPC)) {
        const p = peopleForNpc(role, region);
        expect(p === undefined || isPeopleId(p), `${role} in ${region}`).toBe(true);
      }
    }
    expect(peopleForNpc(NPC.SENTRY, "kessar")).toBe("kessarine");
    expect(peopleForNpc(NPC.CHAMBERLAIN, "highmark")).toBe("marchers");
    expect(peopleForNpc(NPC.MOURNER, "vesper")).toBe("vesperine");
    expect(peopleForNpc(NPC.FACTOR, "saltmarket")).toBe("brinefolk");
    expect(peopleForNpc(NPC.PORTER, "highmark")).toBe("marchers");
    for (const colonial of [NPC.RIVAL_GUARD, NPC.RIVAL_SURVEYOR, NPC.DESERTER, NPC.HIRED_RIFLE, NPC.SURGEON, NPC.FOREMAN]) expect(peopleForNpc(colonial, "kessar")).toBeUndefined();
  });
  it("villagers: the Society's depot staff stay colonial, the passing trade are wayfarers, the rest Mereborn", () => {
    expect(peopleForVillager("Retired Everything")).toBe("colonial");
    expect(peopleForVillager("Tea Merchant")).toBe("wayfarers");
    expect(peopleForVillager("Miller")).toBe("mereborn");
    expect(peopleForVillager("a trade nobody has heard of")).toBe("mereborn");
  });
  it("a wayfarer resolves to one of the mix, deterministically, and the mix covers all five", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 400; s++) {
      const r = resolvePeople("wayfarers", s * 7919);
      expect(WAYFARER_MIX).toContain(r);
      expect(resolvePeople("wayfarers", s * 7919)).toBe(r);
      seen.add(r);
    }
    expect(seen.size).toBe(WAYFARER_MIX.length);
    expect(resolvePeople("kessarine", 5)).toBe("kessarine");
  });
});
