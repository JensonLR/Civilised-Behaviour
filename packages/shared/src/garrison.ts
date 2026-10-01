import type { CampaignState } from "./campaignTypes.ts";
import { KESSAR_ANCHORS, NPC, NPC_CAP } from "./campaignTypes.ts";
import type { CollisionWorld } from "./collision.ts";
import { NPC_SIDE, type NpcSpec } from "./expeditionTypes.ts";
import { KESSAR, type KessarTerrain } from "./kessar.ts";
import { clamp } from "./math.ts";
import type { NavOptions } from "./nav.ts";
import { hash3 } from "./rng.ts";
import { WEAPON, type WeaponId } from "./weapons.ts";
import type { RivalPresence } from "./worldTypes.ts";

/**
 * The people of Kessar Reach: who stands where (roster). What each decides to do is `npcBrain.ts` (`npcThink`), run by the server's `Cast`
 * through the SAME `stepCharacter` + `Combat.onFrame` a player goes through, so wounds, downing and dismemberment need no NPC-specific rules.
 * `NpcSpec` and the brain types are the expedition contract (`expeditionTypes.ts`).
 */

export const GARRISON_MIN = 4;
export const GARRISON_MAX = 8;
export const npcKey = (id: string): string => `npc:${id}`;
export const isNpcKey = (key: string): boolean => key.startsWith("npc:");

/** Sentries on the wall: 4 at militaryStrength 0, 8 at 100. */
export const garrisonSize = (militaryStrength: number): number => {
  const m = Number.isFinite(militaryStrength) ? clamp(militaryStrength, 0, 100) : 50;
  return clamp(GARRISON_MIN + Math.round(m * 0.04), GARRISON_MIN, GARRISON_MAX);
};

// Authored, invented names. The Ward is prim and clerical; the Syndicate is brisk and corporate.
const SENTRY_NAMES = ["Pell Quillon", "Hobb Tallowby", "Marrow Dunce", "Tamsin Cray", "Orrin Bellwether", "Sedge Ashby", "Cobb Lanternside", "Wren Pickett"] as const;
const RIVAL_NAMES = ["Enforcer Garth Vesk-Lowe", "Enforcer Dilly Marrowgate", "Surveyor Ansel Quire-Dunmarrow"] as const;
/** First four sentries cover the bar; the rest by strength (the Ward prefers rifles on the wall and sabres where the ladies are watching). */
const SENTRY_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.SABRE, WEAPON.RIFLE, WEAPON.RIFLE, WEAPON.SABRE, WEAPON.PISTOL, WEAPON.PISTOL];
const RIVAL_POSTS = [{ x: -2, z: 0 }, { x: 2, z: 1.5 }, { x: 0, z: -2.5 }] as const;

/** Up to 8 sentries (anchors in order), the Warden, and the Syndicate's three (two enforcers and a surveyor with a chain and opinions). Never above NPC_CAP. */
export function garrisonRoster(c: CampaignState, seed: number, presence?: RivalPresence): NpcSpec[] {
  const out: NpcSpec[] = [];
  const n = garrisonSize(c.factions.ward.militaryStrength);
  for (let i = 0; i < n; i++) {
    const a = KESSAR_ANCHORS.sentries[i]!;
    out.push({
      id: `sentry-${i}`, role: NPC.SENTRY, faction: "ward", side: NPC_SIDE[NPC.SENTRY]!, group: "ward", post: { x: a.x, z: a.z }, weapon: SENTRY_ARMS[i]!, lookSeed: hash3(seed, i, NPC.SENTRY),
      name: `Sentry ${SENTRY_NAMES[i]!}`, skill: 42 + (hash3(seed, i, 0x5ca1) % 24), bravery: 46 + (hash3(seed, i, 0xb4a7) % 24), brain: "garrison",
    });
  }
  const w = KESSAR_ANCHORS.wardenPost;
  // a ceremonial pistol: the real weapon is the ledger
  out.push({
    id: "warden", role: NPC.WARDEN, faction: "ward", side: NPC_SIDE[NPC.WARDEN]!, group: "ward", post: { x: w.x, z: w.z }, weapon: WEAPON.PISTOL, lookSeed: hash3(seed, 0, NPC.WARDEN),
    name: "Lamp-Warden Ysolde Hask", skill: 40, bravery: 62, brain: "garrison",
  });
  const camp = KESSAR_ANCHORS.rivalCamp;
  // The Syndicate's people: two enforcers and a surveyor, unless the rival agent (D-035) says otherwise: `escort` enforcers and `surveyors` surveyors.
  const guards = presence ? presence.escort : 2, surveyors = presence ? presence.surveyors : 1;
  for (let i = 0; i < guards + surveyors; i++) {
    const p = RIVAL_POSTS[i % RIVAL_POSTS.length]!;
    const guard = i < guards;
    const role = guard ? NPC.RIVAL_GUARD : NPC.RIVAL_SURVEYOR;
    const arm = guard ? (i === 0 ? WEAPON.BLUNDERBUSS : WEAPON.PISTOL) : WEAPON.UMBRELLA;
    out.push({
      id: `rival-${i}`, role, faction: "rival", side: NPC_SIDE[role]!, group: "rival", post: { x: camp.x + p.x + (i >= RIVAL_POSTS.length ? 2.5 * (i - RIVAL_POSTS.length + 1) : 0), z: camp.z + p.z },
      weapon: arm, lookSeed: hash3(seed, i, NPC.RIVAL_GUARD), name: RIVAL_NAMES[i % RIVAL_NAMES.length]!,
      skill: guard ? 60 : 30, bravery: guard ? 58 : 24, brain: "garrison",
    });
  }
  return out.slice(0, NPC_CAP);
}

/** The Syndicate's walk: camp, round the scrub, onto the bridge's south end, across, to the parley spot. */
export const RIVAL_ROUTE: readonly { x: number; z: number }[] = [
  { x: KESSAR_ANCHORS.rivalCamp.x, z: KESSAR_ANCHORS.rivalCamp.z }, { x: -12, z: 44 }, { x: 0, z: 34 }, { x: 0, z: 22 }, { x: 0, z: 12 },
  { x: KESSAR_ANCHORS.rivalParley.x, z: KESSAR_ANCHORS.rivalParley.z },
];

/**
 * Navigation options for Kessar: the gorge bed (water well below the banks) is closed, the ford and the shallows are not, and anything the landing
 * cannot walk to (the sealed fort's courtyard) is pruned. Pass to `buildNavGrid`. (The integrator's `Cast` host returns this for region "kessar".)
 */
export function kessarNavOptions(world: CollisionWorld): NavOptions {
  const wd = (world.terrain as Partial<KessarTerrain>).waterDepth;
  return {
    tag: "kessar",
    roots: [KESSAR_ANCHORS.landing],
    deep: wd === undefined ? undefined : (x, z, surf) => wd(x, z) > 0 && surf < KESSAR.level - 1.5,
  };
}
