import { describe, expect, it } from "vitest";
import { createKessarWorld, createKessarTerrain } from "./kessar.ts";
import { OUTPOST_SITES, rivalPostObstacles } from "./outpost.ts";
import { newPowers, serializePowers } from "./powers.ts";
import { regionWorldOpts, worldKey } from "./settlement.ts";
import { createRegionWorld } from "./regions.ts";
import { newCampaign, serializeCampaign } from "./factions.ts";

/** The Syndicate's own post at Kessar was drawn and walk-through: a player could stand inside its hut. It is solid now, on both sides of the wire, from the same strings. */
describe("the Syndicate's post is solid", () => {
  const at = OUTPOST_SITES.kessar!.rivalSite;
  // (`posts` is 0..2 by type; a hand-edited or hostile save may carry more, which the world options clamp: hence the cast)
  const powersWith = (posts: number): string => {
    const p = newPowers(3);
    return serializePowers({ ...p, rival: { ...p.rival, posts: posts as 0 | 1 | 2 } });
  };

  it("one post is a flagpole, a board and a tent; two add the hut and the counter; none is nothing", () => {
    const t = createKessarTerrain(5);
    expect(rivalPostObstacles(0, t)).toEqual([]);
    expect(rivalPostObstacles(1, t).map((o) => o.tag)).toEqual(["pole", "pole", "tent"]);
    expect(rivalPostObstacles(2, t).map((o) => o.tag)).toEqual(["pole", "pole", "tent", "house", "stall"]);
    expect(rivalPostObstacles(2, t, "vesper")).toEqual([]); // (only Kessar's Syndicate builds)
  });

  it("the hut blocks a body walking into it; without the post the same spot is open; a world without a post is the old world byte for byte", () => {
    const hut = { x: at.x + 7, z: at.z + 3 };
    const plain = createKessarWorld(9, "intact");
    const built = createKessarWorld(9, "intact", { rivalPost: 2 });
    const y = plain.terrainHeight(hut.x, hut.z);
    const probe = (w: typeof plain): boolean => w.resolveXZ({ x: hut.x, z: hut.z }, y, 0.35, 1.7);
    expect(probe(built)).toBe(true); // (pushed out: something is there)
    expect(JSON.stringify(createKessarWorld(9, "intact", { rivalPost: 0 }).obstacles)).toBe(JSON.stringify(plain.obstacles));
    expect(built.obstacles.length).toBe(plain.obstacles.length + 5);
  });

  it("both sides read it from the same strings: the powers JSON sets it at Kessar only, and the world key moves only when there is a post", () => {
    const c = serializeCampaign(newCampaign(1));
    expect(regionWorldOpts(c, "", "kessar", powersWith(0)).rivalPost).toBeUndefined();
    expect(regionWorldOpts(c, "", "kessar", powersWith(1)).rivalPost).toBe(1);
    expect(regionWorldOpts(c, "", "kessar", powersWith(7)).rivalPost).toBe(2);
    expect(regionWorldOpts(c, "", "highmark", powersWith(2)).rivalPost).toBeUndefined();
    expect(regionWorldOpts(c, "", "kessar", "garbage").rivalPost).toBeUndefined();
    const k0 = worldKey(regionWorldOpts(c, "", "kessar", powersWith(0)));
    expect(k0).toBe(worldKey(regionWorldOpts(c, "", "kessar"))); // (the old key, unchanged)
    expect(worldKey(regionWorldOpts(c, "", "kessar", powersWith(1)))).not.toBe(k0);
    expect(worldKey(regionWorldOpts(c, "", "kessar", powersWith(2)))).not.toBe(worldKey(regionWorldOpts(c, "", "kessar", powersWith(1))));
    expect(createRegionWorld("kessar", 9, regionWorldOpts(c, "", "kessar", powersWith(2))).obstacles.length).toBe(createKessarWorld(9, "intact", { rivalPost: 2, outpost: "none", telegraph: false }).obstacles.length);
  });
});
