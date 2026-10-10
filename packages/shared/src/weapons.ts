import type { Obstacle } from "./collision.ts";
import { INTERP_DELAY_MS, MOVEMENT, PATCH_RATE_MS } from "./constants.ts";
import { clamp } from "./math.ts";
import type { Vec3 } from "./daycycle.ts";
import { hash3, hashFloat } from "./rng.ts";
import type { Terrain } from "./terrain.ts";

/**
 * Weapon rules: ONE table shared by the server (authority), the client (prediction of cosmetics, HUD, animation) and the tests.
 * Everything here is pure, deterministic and allocation-free on the hot paths; nothing reads Math.random or the clock. The pattern
 * of a shotgun blast is a function of the world seed, the shooter's slot and their shot counter, so the client can draw exactly
 * the pattern the server will resolve without being told (the SERVER counter is the truth; a client only ever predicts a picture).
 *
 * Units: metres, seconds, radians, kilograms. Damage is health points (100 = a full constitution); wounds and dismemberment come
 * from the damage entry point (Casualties.damage) exactly as before: nothing here changes those rules.
 */

/** Weapon ids are wire format (uint8 in messages, bit index in `PlayerState.weapons`): append only. */
export const WEAPON = { PISTOL: 0, RIFLE: 1, BLUNDERBUSS: 2, SABRE: 3, UMBRELLA: 4, CANNON: 5, FISTS: 6, CRANK: 7 } as const;
export type WeaponId = (typeof WEAPON)[keyof typeof WEAPON];
export const WEAPON_COUNT = 8;

/** What a player can carry, in hotbar order (keys 1..5). The cannon and the crank gun are furniture, fists are what you have when nothing is drawn. */
export const CARRIED: readonly WeaponId[] = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA];
export const CARRIED_MASK: number = CARRIED.reduce<number>((m, w) => m | (1 << w), 0);

export const isWeapon = (w: unknown): w is WeaponId => typeof w === "number" && Number.isInteger(w) && w >= 0 && w < WEAPON_COUNT;
export const isCarried = (w: unknown): w is WeaponId => isWeapon(w) && (CARRIED_MASK & (1 << w)) !== 0;

/** How a weapon delivers harm. */
export type FireMode = "projectile" | "hitscan" | "melee";
/** Damage multiplier per ZONE id (head, torso, arm L, arm R, leg L, leg R). */
export type ZoneMul = readonly [number, number, number, number, number, number];
const zones = (head: number, torso: number, arms: number, legs: number): ZoneMul => [head, torso, arms, arms, legs, legs];

/** Splash damage from an explosion (a cannon ball, later dynamite). */
export interface BlastDef {
  radius: number;
  /** Damage at the centre; falls off smoothly to zero at `radius` (see `blastFalloff`). */
  damage: number;
  /** Velocity (m/s) given to a person at the centre, away from it, falling off the same way. */
  knock: number;
  /** Impulse (N s) given to a prop at the centre. */
  propImpulse: number;
  severBias: number;
}

export interface RangedStats {
  /** Damage per bullet or pellet at point blank, torso. */
  damage: number;
  pellets: number;
  zoneMul: ZoneMul;
  /** Full damage up to `falloffStart` metres, sliding to `falloffMin` (a multiplier) at `falloffEnd`, and that beyond. */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  /** Farthest a shot can carry, metres. */
  range: number;
  /** Seconds between two shots. */
  cooldown: number;
  /** Seconds to refill the magazine (the reload can be abandoned by switching weapon: progress is lost). */
  reload: number;
  magazine: number;
  /** Most spare rounds a player can hold, and how many they start with. */
  reserveMax: number;
  startReserve: number;
  /** Half-angle of the cone (radians) firing from the hip, aiming down the weapon, and extra per m/s of movement (halved while aiming). */
  spread: number;
  spreadAimed: number;
  spreadMove: number;
  /** Muzzle speed (m/s) and gravity (m/s^2) of a projectile; 0 speed = hitscan. */
  speed: number;
  gravity: number;
  /** Ball radius, metres: the hit ellipsoids are grown by this. */
  radius: number;
  /** Velocity (m/s) added to a person hit (once per shot, whatever the pellet count), and the time (s) their control is reduced. */
  knock: number;
  stumble: number;
  /** Impulse (N s) on a prop hit (total per shot, split across pellets). */
  propImpulse: number;
  /** Camera kick in radians (cosmetic; recoil is never a movement input). */
  recoil: number;
  blast?: BlastDef;
}

export interface MeleeStats {
  damage: number;
  zoneMul: ZoneMul;
  /** Distance from the wielder's centre at which a blow still lands, and half the arc (radians) it sweeps. */
  reach: number;
  arcHalf: number;
  /** Seconds from pressing the button to the blow landing (the swing is committed: the target is judged then), and between blows. */
  windup: number;
  cooldown: number;
  knock: number;
  stumble: number;
  /** How many people one swing can hit. */
  cleave: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Catalogue wording for the HUD. */
  label: string;
  kind: "pistol" | "long" | "scatter" | "blade" | "stick" | "artillery" | "hands";
  fire: FireMode;
  ranged?: RangedStats;
  /** The primary blow of a melee weapon, or the butt-strike (`V`) of a firearm. */
  melee?: MeleeStats;
  /** Seconds before it can be used after being drawn. */
  drawSeconds: number;
  /** Damage scale against comrades when friendly fire is on (the rules-lawyer's mercy). */
  ffScale: number;
  /** Multiplies the damage used for the dismemberment roll only (the damage itself is unchanged). */
  severBias: number;
  /** How far the report carries, metres (for the AI to hear, later). */
  noise: number;
  weight: number;
  hands: 1 | 2;
}

const bash: MeleeStats = { damage: 14, zoneMul: zones(1.4, 1, 0.8, 0.8), reach: 1.5, arcHalf: 0.6, windup: 0.2, cooldown: 0.9, knock: 3.6, stumble: 0.4, cleave: 1 };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  [WEAPON.PISTOL]: {
    id: WEAPON.PISTOL,
    name: "flintlock pistol",
    label: "Flintlock Pistol",
    kind: "pistol",
    fire: "projectile",
    ranged: {
      damage: 30, pellets: 1, zoneMul: zones(2, 1, 0.7, 0.7),
      falloffStart: 20, falloffEnd: 70, falloffMin: 0.45, range: 90,
      cooldown: 0.35, reload: 3.0, magazine: 2, reserveMax: 24, startReserve: 14,
      spread: 0.03, spreadAimed: 0.007, spreadMove: 0.006,
      speed: 190, gravity: 4.5, radius: 0.03, knock: 1.6, stumble: 0.15, propImpulse: 4, recoil: 0.05,
    },
    melee: bash,
    drawSeconds: 0.45, ffScale: 0.75, severBias: 1, noise: 90, weight: 1.2, hands: 1,
  },
  [WEAPON.RIFLE]: {
    id: WEAPON.RIFLE,
    name: "percussion rifle",
    label: "Percussion Rifle",
    kind: "long",
    fire: "hitscan",
    ranged: {
      damage: 70, pellets: 1, zoneMul: zones(2.2, 1, 0.75, 0.75),
      falloffStart: 60, falloffEnd: 160, falloffMin: 0.55, range: 200,
      cooldown: 0.8, reload: 3.6, magazine: 1, reserveMax: 20, startReserve: 12,
      spread: 0.05, spreadAimed: 0.003, spreadMove: 0.012,
      speed: 0, gravity: 0, radius: 0.02, knock: 3, stumble: 0.25, propImpulse: 8, recoil: 0.1,
    },
    melee: { ...bash, damage: 18, reach: 1.7 },
    drawSeconds: 0.7, ffScale: 0.7, severBias: 1, noise: 150, weight: 4.3, hands: 2,
  },
  [WEAPON.BLUNDERBUSS]: {
    id: WEAPON.BLUNDERBUSS,
    name: "double-barrel blunderbuss",
    label: "Double Blunderbuss",
    kind: "scatter",
    fire: "projectile",
    ranged: {
      damage: 11, pellets: 8, zoneMul: zones(1.6, 1, 0.85, 0.85),
      falloffStart: 5, falloffEnd: 24, falloffMin: 0.15, range: 30,
      cooldown: 0.5, reload: 4.2, magazine: 2, reserveMax: 14, startReserve: 8,
      spread: 0.1, spreadAimed: 0.075, spreadMove: 0.01,
      speed: 155, gravity: 6, radius: 0.03, knock: 4.5, stumble: 0.35, propImpulse: 10, recoil: 0.14,
    },
    melee: { ...bash, damage: 16, reach: 1.6 },
    drawSeconds: 0.7, ffScale: 0.7, severBias: 1.4, noise: 120, weight: 3.8, hands: 2,
  },
  [WEAPON.SABRE]: {
    id: WEAPON.SABRE,
    name: "cavalry sabre",
    label: "Cavalry Sabre",
    kind: "blade",
    fire: "melee",
    melee: { damage: 36, zoneMul: zones(1.5, 1, 1, 1), reach: 1.9, arcHalf: 0.8, windup: 0.2, cooldown: 0.7, knock: 2.2, stumble: 0.25, cleave: 3 },
    drawSeconds: 0.5, ffScale: 0.7, severBias: 1.8, noise: 14, weight: 1.1, hands: 1,
  },
  [WEAPON.UMBRELLA]: {
    id: WEAPON.UMBRELLA,
    name: "walking umbrella",
    label: "Walking Umbrella",
    kind: "stick",
    fire: "melee",
    melee: { damage: 12, zoneMul: zones(1.5, 1, 1, 1), reach: 1.8, arcHalf: 0.9, windup: 0.18, cooldown: 0.55, knock: 4.2, stumble: 0.6, cleave: 2 },
    drawSeconds: 0.35, ffScale: 0.6, severBias: 0, noise: 6, weight: 0.6, hands: 1,
  },
  [WEAPON.CANNON]: {
    id: WEAPON.CANNON,
    name: "field cannon",
    label: "Field Cannon",
    kind: "artillery",
    fire: "projectile",
    ranged: {
      damage: 160, pellets: 1, zoneMul: zones(1, 1, 1, 1),
      falloffStart: 400, falloffEnd: 401, falloffMin: 1, range: 450,
      cooldown: 1, reload: 4, magazine: 1, reserveMax: 0, startReserve: 0,
      spread: 0.004, spreadAimed: 0.004, spreadMove: 0,
      speed: 75, gravity: 9.81, radius: 0.15, knock: 11, stumble: 1, propImpulse: 70, recoil: 0.5,
      blast: { radius: 6, damage: 120, knock: 11, propImpulse: 90, severBias: 2.2 },
    },
    drawSeconds: 0, ffScale: 1, severBias: 2.2, noise: 320, weight: 480, hands: 2,
  },
  [WEAPON.FISTS]: {
    id: WEAPON.FISTS,
    name: "bare hands",
    label: "Bare Hands",
    kind: "hands",
    fire: "melee",
    melee: { damage: 7, zoneMul: zones(1.4, 1, 0.8, 0.8), reach: 1.25, arcHalf: 0.5, windup: 0.12, cooldown: 0.5, knock: 2, stumble: 0.3, cleave: 1 },
    drawSeconds: 0, ffScale: 0.5, severBias: 0, noise: 4, weight: 0, hands: 1,
  },
  // D-092: the post's crank gun (furniture, like the cannon: worked, never carried). A rifle's ball at a third of the weight, eight a second, from a wandering
  // cluster of barrels; `magazine` is its hopper. Never drawn by a player: the crew's lead fires it through `CRANK`.
  [WEAPON.CRANK]: {
    id: WEAPON.CRANK,
    name: "crank gun",
    label: "Crank Gun",
    kind: "artillery",
    fire: "hitscan",
    ranged: {
      damage: 24, pellets: 1, zoneMul: zones(2, 1, 0.75, 0.75),
      falloffStart: 35, falloffEnd: 90, falloffMin: 0.5, range: 110,
      cooldown: 0.125, reload: 3.5, magazine: 40, reserveMax: 0, startReserve: 0,
      spread: 0.03, spreadAimed: 0.03, spreadMove: 0,
      speed: 0, gravity: 0, radius: 0.02, knock: 1.2, stumble: 0.12, propImpulse: 3, recoil: 0.02,
    },
    drawSeconds: 0, ffScale: 0.6, severBias: 0.8, noise: 160, weight: 160, hands: 2,
  },
};

export const weaponDef = (id: number): WeaponDef | undefined => (isWeapon(id) ? WEAPONS[id] : undefined);

/** The longest round trip whose shots are judged exactly where the shooter saw the target (D-043); a longer link starts to have to lead. */
const REWIND_RTT_MS = 250;

/** Combat-wide tuning that is not per weapon. */
export const COMBAT = {
  /**
   * Lag compensation (see docs/_notes/combat.md): a shot is judged against where the shooter SAW everyone, never further back than this,
   * however large a lag the client claims. Bounds what a hostile client can gain.
   * The lag a shot really carries is the WHOLE round trip (the picture came down, the trigger went up) plus the display delay, and then
   * up to a sim tick waiting to be read, less up to a patch since the last recorded pose: 250..350 ms at a 200 ms round trip (D-043: a
   * 250 ms clamp cut every one of those shots short). The patch interval on top is the slack for the tick and for timer jitter.
   * The people on the far end of a shot are almost always NPCs in this co-op game; the window costs a friend under friendly fire a little.
   */
  rewindMaxMs: REWIND_RTT_MS + INTERP_DELAY_MS + PATCH_RATE_MS,
  /**
   * A projectile keeps its shooter's view of the world (the same rewind as the shot that made it) for this long after leaving the muzzle, so a
   * ball that takes a tenth of a second to arrive still meets the man the shooter saw; it then blends to live positions over `projectileRewindFade`
   * (a ball in flight for longer than this is judged in the present: nothing is hit "around a corner" by more than the clamp, for more than this).
   */
  projectileRewindHold: 0.3,
  projectileRewindFade: 0.1,
  /** Live projectiles per room (pellets included); shots past it are still resolved but not simulated further. */
  maxProjectiles: 128,
  /** How far the shot direction may differ from the camera yaw (the third-person camera sits beside the head, so the crosshair and the muzzle differ). */
  aimYawSlack: 0.6,
  /** Highest elevation the aim may have (radians, both ways). */
  aimElevMax: 1.45,
  /** Height above the feet of the muzzle origin used by the server, standing and crouching (the eye line: shots leave from the head, not the gun). */
  eyeHeight: 1.55,
  eyeHeightCrouch: 1.05,
  /** Seconds to change weapon and the least time before the new one may be used. */
  switchSeconds: 0.35,
  /** Hits on props: impulses are capped so nothing leaves the map. */
  maxPropSpeed: 14,
  /** Player velocity (m/s) that a single knock may add, whatever the sources. */
  maxKnock: 14,
} as const;

// ---- damage rules ---------------------------------------------------------------------------------------------------------------

/** Multiplier 0..1 for a hit at `dist` metres: full up to `falloffStart`, `falloffMin` from `falloffEnd`, linear between. */
export function falloffMul(r: RangedStats, dist: number): number {
  if (!(dist > r.falloffStart)) return 1;
  if (dist >= r.falloffEnd) return r.falloffMin;
  return 1 + ((r.falloffMin - 1) * (dist - r.falloffStart)) / (r.falloffEnd - r.falloffStart);
}

/** Damage of one bullet/pellet: base x zone x range falloff (before the friendly-fire scale). */
export function rangedDamage(r: RangedStats, zone: number, dist: number): number {
  const z = r.zoneMul[zone] ?? 1;
  return r.damage * z * falloffMul(r, dist);
}

export function meleeDamage(m: MeleeStats, zone: number): number {
  return m.damage * (m.zoneMul[zone] ?? 1);
}

/** Smooth 1 -> 0 as `dist` goes 0 -> `radius` (smoothstep), so a blast is brutal at the centre and gentle at the rim. */
export function blastFalloff(dist: number, radius: number): number {
  if (!(dist < radius)) return 0;
  const t = clamp(1 - Math.max(0, dist) / radius, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Seconds a cannon crew of `crew` people (0 = nobody) needs to load one round. 2+ people work at full speed; one alone at half. */
export const CANNON = {
  crewRange: 2.6,
  loadSeconds: 4,
  soloFactor: 0.5,
  fuseSeconds: 0.7,
  /** Barrel slew rate, rad/s, with one and two crew. */
  slewSolo: 0.4,
  slewCrew: 0.9,
  /** How far the barrel may be traversed either side of its rest heading, radians. */
  traverse: 1.75,
  elevMin: -0.05,
  elevMax: 0.7,
  shells: 6,
  /** Trunnion height above the ground and barrel length ahead of it: where the ball leaves. */
  trunnion: 0.95,
  barrel: 1.7,
} as const;

/**
 * The camp's field cannon(s): authored, identical in every campaign, standing just outside the spawn clearing with the barrel trained outward.
 * `yaw` is the barrel's rest heading (0 = -Z, like every heading); the crew may traverse it `CANNON.traverse` either side.
 */
export const CANNON_SPOTS: readonly { x: number; z: number; yaw: number }[] = [{ x: 16.4, z: 4.4, yaw: Math.atan2(-Math.cos(0.2618), -Math.sin(0.2618)) }];

/** The cannon's carriage as a collidable obstacle (a low round base: wheels and trail; the barrel is drawn and simulated separately). */
export function cannonObstacles(terrain: Terrain): Obstacle[] {
  return CANNON_SPOTS.map((c) => {
    const y = terrain.height(c.x, c.z);
    return { kind: "circle", tag: "cannon", x: c.x, z: c.z, r: 0.8, y0: y - 0.5, y1: y + 1.05 } satisfies Obstacle;
  });
}

/**
 * D-092, the crank gun: emplaced inside a fortified post's gate once the works has cast it (`TechState.crank`). Worked like the cannon (hold Use within
 * `crewRange`; the first of the crew lays it), and fired by holding the trigger as well: a round every `ranged.cooldown` while the hopper lasts. An empty
 * hopper is changed from the limber (`hoppers` of them) by holding Use; a jam (one round in `jamOneIn`, decided by the gun's own shot count, so the
 * server alone knows it and replays it the same) is cleared by holding Use with the trigger let go. Replicated in `CannonState` with `kind` 1:
 * phase 2 ready (progress = rounds in the hopper), 1 changing the hopper (progress %), 4 jammed (progress = % cleared), 0 dry; shells = hoppers left.
 */
export const CRANK = {
  crewRange: 1.9,
  hoppers: 4,
  /** Seconds to change a hopper alone; a second pair of hands halves it. */
  changeSeconds: 3.5,
  clearSeconds: 1.6,
  jamOneIn: 34,
  /** Barrel slew (rad/s, one rate: it is light) and how far it traverses either side of its rest heading. */
  slew: 1.5,
  traverse: 1.1,
  elevMin: -0.12,
  elevMax: 0.32,
  /** Height of the barrels' axis above the ground and their length ahead of it. */
  trunnion: 1.05,
  barrel: 1.05,
} as const;

/** Phases of a crank gun (`CannonState.phase` when `kind` is 1). */
export const CRANK_PHASE = { DRY: 0, CHANGING: 1, READY: 2, JAMMED: 4 } as const;

/** Does the crank gun's `shotNo`-th round jam it? Deterministic per world, gun and round. */
export const crankJams = (worldSeed: number, gun: number, shotNo: number): boolean => hash3(worldSeed ^ 0x6c7a11d3, 300 + gun, shotNo) % CRANK.jamOneIn === 0;

export function cannonLoadRate(crew: number): number {
  if (crew <= 0) return 0;
  return (crew >= 2 ? 1 : CANNON.soloFactor) / CANNON.loadSeconds;
}

/** The lag (ms) a projectile of age `age` seconds is judged with: the shooter's full lag while young, none once old (see COMBAT.projectileRewindHold). */
export function projectileLag(lagMs: number, age: number): number {
  const t = clamp((age - COMBAT.projectileRewindHold) / COMBAT.projectileRewindFade, 0, 1);
  return Math.max(0, lagMs) * (1 - t * t * (3 - 2 * t));
}

// ---- accuracy ---------------------------------------------------------------------------------------------------------------------

export interface Stance {
  aiming: boolean;
  /** Horizontal speed, m/s. */
  speed: number;
  crouching: boolean;
  /** D-104: a wounded or missing arm's tremble (hitReaction.ts `aimShake`), a multiplier on the cone. Absent = 1, a steady hand. */
  shake?: number;
}

/** Cone half-angle (radians) for a shot in this stance. The HUD's crosshair and the server's resolution read this same number. */
export function spreadFor(r: RangedStats, s: Stance): number {
  const base = s.aiming ? r.spreadAimed : r.spread;
  const move = Math.min(Math.max(0, s.speed), MOVEMENT.sprintSpeed) * r.spreadMove * (s.aiming ? 0.5 : 1);
  const shake = s.shake !== undefined && s.shake > 1 ? s.shake : 1;
  return (base + move) * (s.crouching ? 0.75 : 1) * shake;
}

/** Seed for a shot's random pattern: world seed, shooter slot and the shooter's shot counter. */
export const shotSeed = (worldSeed: number, slot: number, shotNo: number): number => hash3(worldSeed ^ 0x5b07d1ce, slot, shotNo);

/** Unit direction for aim (yaw 0 = -Z; elevation + = up). */
export function aimDirection(yaw: number, elev: number, out: Vec3): Vec3 {
  const ce = Math.cos(elev);
  out.x = -Math.sin(yaw) * ce;
  out.y = Math.sin(elev);
  out.z = -Math.cos(yaw) * ce;
  return out;
}

/**
 * Direction of bullet/pellet `i` of a shot: the aim direction deflected by a seeded point in a cone of half-angle `spread`.
 * Deterministic (same inputs, same output, on any machine) and allocation-free.
 */
export function shotDirection(yaw: number, elev: number, spread: number, seed: number, i: number, out: Vec3): Vec3 {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const se = Math.sin(elev);
  const ce = Math.cos(elev);
  // f = forward, r = right, u = up: an orthonormal frame around the aim.
  const fx = -sy * ce;
  const fy = se;
  const fz = -cy * ce;
  const ux = sy * se;
  const uy = ce;
  const uz = cy * se;
  const rho = spread * Math.sqrt(hashFloat(seed, i, 1));
  const phi = hashFloat(seed, i, 2) * Math.PI * 2;
  const sr = Math.sin(rho);
  const cr = Math.cos(rho);
  const a = Math.cos(phi) * sr;
  const b = Math.sin(phi) * sr;
  out.x = fx * cr + cy * a + ux * b;
  out.y = fy * cr + uy * b;
  out.z = fz * cr - sy * a + uz * b;
  return out;
}

// ---- wire helpers --------------------------------------------------------------------------------------------------------------------

/** Elevation is sent as int16 in 1/20000 rad (about 0.003 degrees), clamped to the legal range. */
export const elevToWire = (rad: number): number => Math.round(clamp(Number.isFinite(rad) ? rad : 0, -COMBAT.aimElevMax, COMBAT.aimElevMax) * 20000);
export const elevFromWire = (w: number): number => clamp(Number.isFinite(w) ? w / 20000 : 0, -COMBAT.aimElevMax, COMBAT.aimElevMax);

/** Weapon slot on the wire: 0 = nothing drawn, else weapon id + 1. */
export const weaponToWire = (w: WeaponId | -1): number => (w < 0 ? 0 : w + 1);
export const weaponFromWire = (w: number): WeaponId | -1 => (Number.isInteger(w) && w >= 1 && w <= WEAPON_COUNT ? ((w - 1) as WeaponId) : -1);
