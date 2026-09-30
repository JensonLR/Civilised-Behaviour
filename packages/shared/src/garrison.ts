import type { CampaignState, FactionId } from "./campaignTypes.ts";
import { KESSAR_ANCHORS, NPC, NPC_CAP } from "./campaignTypes.ts";
import type { MoveCommand } from "./movement.ts";
import { yawToWire } from "./movement.ts";
import { BUTTON, FLAG } from "./constants.ts";
import { clamp } from "./math.ts";
import { hash3 } from "./rng.ts";
import { WEAPON, weaponDef, weaponFromWire, weaponToWire, type WeaponId } from "./weapons.ts";

/**
 * The people of Kessar Reach: who stands where (roster) and what each decides to do this tick (a tiny utility brain).
 * Pure and allocation-free in the tick path: `npcDecide` writes into the caller's `MoveCommand`, and the server feeds that to the SAME
 * `stepCharacter` + `Combat.onFrame` a player goes through, so wounds, downing and dismemberment need no NPC-specific rules.
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

export interface NpcSpec { id: string; role: number /* NPC.* */; faction: FactionId; post: { x: number; z: number }; weapon: WeaponId; lookSeed: number; name: string }

// Authored, invented names. The Ward is prim and clerical; the Syndicate is brisk and corporate.
const SENTRY_NAMES = ["Pell Quillon", "Hobb Tallowby", "Marrow Dunce", "Tamsin Cray", "Orrin Bellwether", "Sedge Ashby", "Cobb Lanternside", "Wren Pickett"] as const;
const RIVAL_NAMES = ["Enforcer Garth Vesk-Lowe", "Enforcer Dilly Marrowgate", "Surveyor Ansel Quire-Dunmarrow"] as const;
/** First four sentries cover the bar; the rest by strength (the Ward prefers rifles on the wall and sabres where the ladies are watching). */
const SENTRY_ARMS: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.PISTOL, WEAPON.SABRE, WEAPON.RIFLE, WEAPON.RIFLE, WEAPON.SABRE, WEAPON.PISTOL, WEAPON.PISTOL];
const RIVAL_POSTS = [{ x: -2, z: 0 }, { x: 2, z: 1.5 }, { x: 0, z: -2.5 }] as const;

/** Up to 8 sentries (anchors in order), the Warden, and the Syndicate's three (two enforcers and a surveyor with a chain and opinions). Never above NPC_CAP. */
export function garrisonRoster(c: CampaignState, seed: number): NpcSpec[] {
  const out: NpcSpec[] = [];
  const n = garrisonSize(c.factions.ward.militaryStrength);
  for (let i = 0; i < n; i++) {
    const a = KESSAR_ANCHORS.sentries[i]!;
    out.push({ id: `sentry-${i}`, role: NPC.SENTRY, faction: "ward", post: { x: a.x, z: a.z }, weapon: SENTRY_ARMS[i]!, lookSeed: hash3(seed, i, NPC.SENTRY), name: `Sentry ${SENTRY_NAMES[i]!}` });
  }
  const w = KESSAR_ANCHORS.wardenPost;
  // a ceremonial pistol: the real weapon is the ledger
  out.push({ id: "warden", role: NPC.WARDEN, faction: "ward", post: { x: w.x, z: w.z }, weapon: WEAPON.PISTOL, lookSeed: hash3(seed, 0, NPC.WARDEN), name: "Lamp-Warden Ysolde Hask" });
  const camp = KESSAR_ANCHORS.rivalCamp;
  for (let i = 0; i < 3; i++) {
    const p = RIVAL_POSTS[i]!;
    out.push({
      id: `rival-${i}`, role: i < 2 ? NPC.RIVAL_GUARD : NPC.RIVAL_SURVEYOR, faction: "rival", post: { x: camp.x + p.x, z: camp.z + p.z },
      weapon: i === 0 ? WEAPON.BLUNDERBUSS : i === 1 ? WEAPON.PISTOL : WEAPON.UMBRELLA, lookSeed: hash3(seed, i, NPC.RIVAL_GUARD), name: RIVAL_NAMES[i]!,
    });
  }
  return out.slice(0, NPC_CAP);
}

// ---- the brain -----------------------------------------------------------------------------------------------------------------------------

export type NpcMode = "post" | "alert" | "attack" | "flee" | "stand_down" | "march";
export interface NpcBrain {
  mode: NpcMode; morale: number; target: string; cooldown: number; route: number;
  /** Home position, and the weapon (wire value: 0 none, id + 1) this NPC carries. Set by newBrain. */
  px: number; pz: number; weapon: number;
}
export function newBrain(spec: NpcSpec): NpcBrain {
  return { mode: "post", morale: spec.faction === "rival" ? 78 : 70, target: "", cooldown: 0.4 + (spec.lookSeed % 7) * 0.1, route: 0, px: spec.post.x, pz: spec.post.z, weapon: weaponToWire(spec.weapon) };
}

export interface NpcBody { x: number; z: number; facing: number; health: number; weapon: number; ammo: number; flags: number }
export interface NpcSenses { enemy: { id: string; x: number; z: number; armed: boolean; down: boolean } | undefined; allies: number; alert: boolean; standDown: boolean; fear: number }

/** The Syndicate's walk: camp, round the scrub, onto the bridge's south end, across, to the parley spot. */
export const RIVAL_ROUTE: readonly { x: number; z: number }[] = [
  { x: KESSAR_ANCHORS.rivalCamp.x, z: KESSAR_ANCHORS.rivalCamp.z }, { x: -12, z: 44 }, { x: 0, z: 34 }, { x: 0, z: 22 }, { x: 0, z: 12 },
  { x: KESSAR_ANCHORS.rivalParley.x, z: KESSAR_ANCHORS.rivalParley.z },
];

const ENGAGE_RANGE = 26;
const MORALE_BREAK = 55;
const FLEE_SECONDS = 8;
const FIRE_PAD = 0.35;

const fin = (v: number, d: number): number => (Number.isFinite(v) ? v : d);
/** Heading (0 = -Z, as everywhere) from (x, z) toward (tx, tz). */
const headingTo = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));

/**
 * One tick of thought. Modes: `stand_down` is latched and inert; `march` follows RIVAL_ROUTE unless provoked; otherwise three options are
 * scored (attack, flee, hold) and the best wins, with flee latched until morale recovers. Morale falls with fear, wounds and lonely odds.
 */
export function npcDecide(b: NpcBrain, me: NpcBody, sn: NpcSenses, dt: number, out: MoveCommand): void {
  out.moveF = 0;
  out.moveR = 0;
  out.buttons = 0;
  out.yaw = yawToWire(Number.isFinite(me.facing) ? me.facing : 0);
  out.aimYaw = out.yaw;
  out.aimElev = 0;
  out.weapon = b.weapon;
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.5) : 0;

  if (sn.standDown) b.mode = "stand_down";
  if (b.mode === "stand_down" || (me.flags & FLAG.DOWNED) !== 0) return;
  b.cooldown -= step;

  const hpLack = 100 - clamp(fin(me.health, 100), 0, 100);
  const moraleGoal = 70 - 0.25 * clamp(fin(sn.fear, 0), 0, 100) + 5 * clamp(fin(sn.allies, 0), 0, 4) - 0.6 * hpLack;
  b.morale = clamp(b.morale + clamp(moraleGoal - b.morale, -25 * step, 6 * step), 0, 100);

  const e = sn.enemy;
  const engaged = sn.alert && e !== undefined && !e.down;
  const dx = engaged ? e.x - me.x : 0;
  const dz = engaged ? e.z - me.z : 0;
  const dist = engaged ? Math.hypot(dx, dz) : Infinity;

  if (b.mode === "march" && !(sn.alert && engaged)) {
    // the Syndicate walk; on arrival they stand there being pleasant
    if (b.route >= RIVAL_ROUTE.length) return;
    const wp = RIVAL_ROUTE[b.route]!;
    if (Math.hypot(wp.x - me.x, wp.z - me.z) < 1.6) {
      b.route++;
      return;
    }
    out.yaw = yawToWire(headingTo(me.x, me.z, wp.x, wp.z));
    out.aimYaw = out.yaw;
    out.moveF = 127;
    return;
  }

  // ---- utility scores ----
  const inRange = engaged && dist <= ENGAGE_RANGE;
  const attack = inRange ? (0.35 + 0.65 * (b.morale / 100)) * (e.armed ? 1 : 0.7) * (1 - 0.4 * (dist / ENGAGE_RANGE)) : 0;
  const flee = inRange ? clamp((60 - b.morale) / 60, 0, 1) * 1.5 : 0;
  const hold = 0.2;
  if (b.mode === "flee") {
    if (b.morale >= MORALE_BREAK && !(inRange && dist < 25)) b.mode = "post";
  } else if (flee > attack && flee > hold) {
    b.mode = "flee";
    b.cooldown = FLEE_SECONDS;
  } else if (attack > hold) {
    b.mode = "attack";
  } else {
    b.mode = sn.alert ? "alert" : "post";
  }

  if (b.mode === "flee") {
    b.target = "";
    if (engaged || b.cooldown > 0) {
      const away = engaged ? headingTo(me.x, me.z, me.x - dx, me.z - dz) : me.facing;
      out.yaw = yawToWire(away);
      out.aimYaw = out.yaw;
      out.moveF = 127;
      out.buttons = BUTTON.SPRINT;
    }
    return;
  }

  if (b.mode === "attack" && e !== undefined) {
    b.target = e.id;
    const heading = headingTo(me.x, me.z, e.x, e.z);
    out.yaw = yawToWire(heading);
    out.aimYaw = out.yaw;
    const id = weaponFromWire(b.weapon);
    const def = id >= 0 ? weaponDef(id) : undefined;
    const r = def?.ranged;
    const keep = r ? Math.min(r.range * 0.5, 14) : (def?.melee?.reach ?? 1.2) * 0.8;
    if (dist > keep + 1) out.moveF = 127;
    else if (r && dist < keep * 0.4) out.moveF = -90;
    if (r) {
      if (dist <= keep + 6) out.buttons |= BUTTON.AIM;
      if (b.cooldown <= 0 && dist <= Math.min(r.range, ENGAGE_RANGE)) {
        if (me.ammo > 0) {
          out.buttons |= BUTTON.FIRE;
          b.cooldown = r.cooldown + FIRE_PAD;
        } else {
          out.buttons |= BUTTON.RELOAD;
          b.cooldown = 0.5;
        }
      }
    } else if (def?.melee && dist <= def.melee.reach + 0.4) out.buttons |= BUTTON.FIRE; // a held press keeps swinging
    return;
  }

  // post / alert: go home and keep watch
  b.target = "";
  const homeD = Math.hypot(b.px - me.x, b.pz - me.z);
  if (homeD > 1.2) {
    out.yaw = yawToWire(headingTo(me.x, me.z, b.px, b.pz));
    out.aimYaw = out.yaw;
    out.moveF = 127;
  }
}
