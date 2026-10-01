import { describe, expect, it } from "vitest";
import { KESSAR_ANCHORS, NPC, NPC_CAP } from "./campaignTypes.ts";
import { WARD, newCampaign } from "./factions.ts";
import { NPC_SIDE } from "./expeditionTypes.ts";
import {
  GARRISON_MAX, GARRISON_MIN, RIVAL_ROUTE, garrisonRoster, garrisonSize, isNpcKey, kessarNavOptions, npcKey,
} from "./garrison.ts";
import { createKessarWorld } from "./kessar.ts";
import { NavQuery, buildNavGrid } from "./nav.ts";
import { WEAPON } from "./weapons.ts";

describe("roster", () => {
  it("garrison size tracks militaryStrength from 4 to 8", () => {
    expect(garrisonSize(0)).toBe(GARRISON_MIN);
    expect(garrisonSize(100)).toBe(GARRISON_MAX);
    expect(garrisonSize(55)).toBe(6);
    expect(garrisonSize(Number.NaN)).toBeGreaterThanOrEqual(GARRISON_MIN);
    let last = 0;
    for (let m = 0; m <= 100; m += 5) {
      const n = garrisonSize(m);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it("sentries + Warden + three Syndicate, never above NPC_CAP, unique ids, posts on the anchors", () => {
    for (const mil of [0, 25, 55, 80, 100]) {
      const c = newCampaign(3);
      c.factions.ward.militaryStrength = mil;
      const r = garrisonRoster(c, 11);
      const sentries = r.filter((n) => n.role === NPC.SENTRY);
      expect(sentries.length).toBe(garrisonSize(mil));
      expect(r.filter((n) => n.role === NPC.WARDEN).length).toBe(1);
      expect(r.filter((n) => n.faction === "rival").length).toBe(3);
      expect(r.length).toBeLessThanOrEqual(NPC_CAP);
      expect(new Set(r.map((n) => n.id)).size).toBe(r.length);
      sentries.forEach((s, i) => expect(s.post).toEqual({ x: KESSAR_ANCHORS.sentries[i]!.x, z: KESSAR_ANCHORS.sentries[i]!.z }));
    }
  });

  it("is deterministic in (campaign, seed); the Warden is the Ward's authored leader", () => {
    const c = newCampaign(3);
    expect(garrisonRoster(c, 5)).toEqual(garrisonRoster(c, 5));
    expect(garrisonRoster(c, 5)[0]!.lookSeed).not.toBe(garrisonRoster(c, 6)[0]!.lookSeed);
    const w = garrisonRoster(c, 5).find((n) => n.role === NPC.WARDEN)!;
    expect(w.name).toContain(WARD.leader.name);
    expect(w.post).toEqual({ x: KESSAR_ANCHORS.wardenPost.x, z: KESSAR_ANCHORS.wardenPost.z });
  });

  it("keys are namespaced so they can never collide with a session id", () => {
    expect(npcKey("warden")).toBe("npc:warden");
    expect(isNpcKey("npc:warden")).toBe(true);
    expect(isNpcKey("abc123")).toBe(false);
  });
});

describe("roster fields (D-034)", () => {
  it("every row carries side, group, skill, bravery and a brain, and the side is the role's", () => {
    const r = garrisonRoster(newCampaign(3), 9);
    for (const s of r) {
      expect(s.side).toBe(NPC_SIDE[s.role]);
      expect(["ward", "rival"]).toContain(s.group);
      expect(s.skill).toBeGreaterThanOrEqual(0);
      expect(s.skill).toBeLessThanOrEqual(100);
      expect(s.bravery).toBeGreaterThanOrEqual(0);
      expect(s.bravery).toBeLessThanOrEqual(100);
      expect(s.brain).toBe("garrison");
    }
    expect(r.filter((s) => s.group === "ward").every((s) => s.faction === "ward")).toBe(true);
    expect(r.filter((s) => s.group === "rival").every((s) => s.side === "rival")).toBe(true);
    // the Syndicate's surveyor is a timid man with an umbrella; the enforcers are not
    const sur = r.find((s) => s.role === NPC.RIVAL_SURVEYOR)!;
    const enf = r.find((s) => s.role === NPC.RIVAL_GUARD)!;
    expect(sur.weapon).toBe(WEAPON.UMBRELLA);
    expect(sur.bravery).toBeLessThan(enf.bravery);
    expect(sur.skill).toBeLessThan(enf.skill);
  });

  it("is deterministic in every new field", () => {
    expect(garrisonRoster(newCampaign(3), 5)).toEqual(garrisonRoster(newCampaign(3), 5));
  });
});

describe("kessarNavOptions", () => {
  it("prunes the sealed fort and keeps the roster's posts reachable from the landing", () => {
    const w = createKessarWorld(5, "intact");
    const g = buildNavGrid(w, kessarNavOptions(w));
    const q = new NavQuery(g);
    expect(q.open(0, -70)).toBe(false);
    const snap = { x: 0, z: 0 };
    for (const s of garrisonRoster(newCampaign(3), 5)) {
      expect(q.nearestOpen(s.post.x, s.post.z, snap), s.id).toBe(true);
      expect(Math.hypot(snap.x - s.post.x, snap.z - s.post.z), s.id).toBeLessThanOrEqual(2.9);
    }
    // the Syndicate's route is walkable end to end
    const p = { n: 0, x: new Float32Array(48), z: new Float32Array(48), complete: false };
    for (let i = 0; i + 1 < RIVAL_ROUTE.length; i++) {
      const a = RIVAL_ROUTE[i]!, b = RIVAL_ROUTE[i + 1]!;
      expect(q.path(a.x, a.z, b.x, b.z, p), `leg ${i}`).toBe(true);
      expect(p.complete).toBe(true);
    }
  });
});
