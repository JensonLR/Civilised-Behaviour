import { BUTTON, FLAG, MOVEMENT } from "./constants.ts";
import type { NavPath, NpcBody, NpcBrain, NpcMode, NpcSenses, NpcSpec } from "./expeditionTypes.ts";
import { moraleBand, moraleStep, newMorale, MORALE } from "./morale.ts";
import { angleDelta, clamp, hyp } from "./math.ts";
import { newNavPath } from "./nav.ts";
import { yawToWire, type MoveCommand } from "./movement.ts";
import { hashFloat, seedFromString } from "./rng.ts";
import { WEAPON, WEAPONS, elevToWire, weaponFromWire, weaponToWire, type WeaponId } from "./weapons.ts";

/**
 * The garrison's brain (D-034): a small utility AI. Every NPC row gets one `npcThink` per server tick (via `Cast`); it is pure with respect to
 * (brain, body, senses, dt) and allocation-free, so the same command goes through the SAME `stepCharacter` + `Combat.onFrame` a player does.
 *
 * Decisions are scored at 4 Hz (staggered by `lookSeed`) with inertia, so nobody thrashes between modes; movement, aiming and trigger work happen
 * every tick from the current mode. FALLIBILITY is the point: a reaction time after a NEW target, turning at half rate meanwhile, an aim error
 * sampled per burst from a seeded hash that grows with range and with the shooter's or the target's motion and shrinks as a shooter RANGES IN on a
 * target that stands still, weapon cadence (one rifle shot then a think, pistol pairs, a blunderbuss only close in), and ATTACK TOKENS (only the
 * ones the host hands out may fire; the rest take cover, flank or close in), which is what lets a lone player live for tens of seconds.
 * All the numbers are in `NPC_TUNING`; nothing here reads a clock or `Math.random` (the host passes `sn.now`).
 */

export const NPC_TUNING = {
  /** Decisions per second, the bonus the current mode gets in the scoring and the least time between two mode changes (seconds). */
  thinkHz: 4, inertia: 0.15, dwell: 1.2,
  /** Reaction to a NEW target (not seen for `forget` seconds): base + (1 - skill/100) * perSkill + jitter * hash, seconds; the turn rate in the meantime is `turnFactor` of the walker's. */
  react: { base: 0.35, perSkill: 0.9, jitter: 0.3, forget: 2, turnFactor: 0.5 },
  /** Aim error sigma (radians) at the muzzle for each weapon id, before range, motion and skill scaling. */
  aimBase: { [WEAPON.PISTOL]: 0.026, [WEAPON.RIFLE]: 0.017, [WEAPON.BLUNDERBUSS]: 0.02, [WEAPON.SABRE]: 0, [WEAPON.UMBRELLA]: 0, [WEAPON.CANNON]: 0, [WEAPON.FISTS]: 0 } as Record<WeaponId, number>,
  /** sigma *= (1 + dist / aimRange) * (moving ? movingMul : 1) * (skillBase - skill/100); then * rangeShrink^(consecutive shots at a still target). */
  aimRange: 20, movingMul: 1.4, skillBase: 1.6, rangeShrink: 0.72, rangedMax: 6, aimElev: 0.02,
  /** Where each weapon wants to fight from (metres), and the farthest it will shoot. The blunderbuss only inside 14. */
  effRange: { [WEAPON.PISTOL]: 16, [WEAPON.RIFLE]: 28, [WEAPON.BLUNDERBUSS]: 14, [WEAPON.SABRE]: 1.6, [WEAPON.UMBRELLA]: 1.6, [WEAPON.CANNON]: 0, [WEAPON.FISTS]: 1.2 } as Record<WeaponId, number>,
  maxShot: { [WEAPON.PISTOL]: 30, [WEAPON.RIFLE]: 40, [WEAPON.BLUNDERBUSS]: 14, [WEAPON.SABRE]: 0, [WEAPON.UMBRELLA]: 0, [WEAPON.CANNON]: 0, [WEAPON.FISTS]: 0 } as Record<WeaponId, number>,
  /** Seconds of think between rifle shots (on top of the weapon's own cooldown), pistol burst length and pause, melee pad. */
  rifleThink: [0.3, 1.2], pistolBurst: 2, pistolPause: [1.0, 2.2], pistolGap: 0.12, meleePad: 0.4, scatterThink: [0.2, 0.7],
  hold: 0.15, retreatSoft: 0.4, fleeSeconds: 8, fleeClear: 25, rally: MORALE.rallyAt,
  /** Waypoint reached radius, how often a path is re-requested (seconds), sight to a target a straight walk may trust (metres). */
  search: 8, reach: 1.1, repath: 1, straight: 14, coverRadius: 10, flankDist: 14,
} as const;

/** The brain's private state: the contract's `NpcBrain` plus what only this brain needs. `npcBrainNew` is the only constructor; everything in it is plain numbers. */
export interface NpcBrainState extends NpcBrain {
  seed: number; skill: number; bravery: number; bold: number; side: 1 | -1;
  thinkAt: number; lastSeen: number; ranged: number; shotNo: number; errYaw: number; errElev: number; haveErr: boolean;
  fled: boolean; fledAt: number; coverOk: boolean; lastTx: number; lastTz: number; targetHash: number; sinceInit: boolean;
}

export function npcBrainNew(spec: NpcSpec): NpcBrainState {
  const bravery = clamp(Number.isFinite(spec.bravery) ? spec.bravery : 50, 0, 100);
  return {
    mode: "post", since: 0, morale: newMorale(clamp(52 + 0.3 * bravery, 40, 85)), target: "", cooldown: 0.4 + (spec.lookSeed % 7) * 0.1, react: 0, burst: 0, route: 0, px: spec.post.x, pz: spec.post.z,
    weapon: weaponToWire(spec.weapon), path: newNavPath(), pathAt: -1e9, hurtAt: -1e9,
    seed: spec.lookSeed >>> 0, skill: clamp(Number.isFinite(spec.skill) ? spec.skill : 50, 0, 100), bravery, bold: hashFloat(spec.lookSeed, 0xb01d, 1), side: hashFloat(spec.lookSeed, 0x51de, 2) < 0.5 ? 1 : -1,
    thinkAt: -1, lastSeen: -1e9, ranged: 0, shotNo: 0, errYaw: 0, errElev: 0, haveErr: false, fled: false, fledAt: 0, coverOk: false, lastTx: 0, lastTz: 0, targetHash: 0, sinceInit: false,
  };
}

/**
 * D-041: a round from (x, z) hit this row, or passed close by it. With nobody in sight, it goes and looks there, exactly as after losing sight of a man it was fighting
 * (the bot playtest sniped the Ward's ford patrol from 45 m, beyond their 28 m of sight, and from behind the bridge parapet, and nobody ever came). A row that can see
 * somebody is busy and keeps fighting him. The search lasts `NPC_TUNING.search` seconds from the latest report and only runs while the row is alert.
 */
export function npcHeardShot(nb: NpcBrain, x: number, z: number, now: number): void {
  const b = nb as NpcBrainState;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(now)) return;
  if (b.target !== "" && now - b.lastSeen < HEARD_BUSY_S) return;
  b.lastSeen = now;
  b.lastTx = x;
  b.lastTz = z;
}
/** A row that saw its target this recently is fighting it (sense() refreshes `lastSeen` every tick while it can see). */
const HEARD_BUSY_S = 0.5;

const fin = (v: number, d: number): number => (Number.isFinite(v) ? v : d);
/** Heading (0 = -Z, as everywhere) from (x, z) toward (tx, tz). */
const headingTo = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));
/** Roughly normal, mean 0, sigma 1: the sum of three seeded uniforms. Deterministic. */
const gauss = (seed: number, a: number, b: number): number => (hashFloat(seed, a, b, 1) + hashFloat(seed, a, b, 2) + hashFloat(seed, a, b, 3) - 1.5) * 2;
const lerpRange = (r: readonly number[], u: number): number => r[0]! + (r[1]! - r[0]!) * u;

const scratch = { x: 0, z: 0 };

/** Walk toward a point: face it and push the stick forward. */
function walkTo(me: NpcBody, tx: number, tz: number, out: MoveCommand, sprint: boolean): void {
  out.yaw = yawToWire(headingTo(me.x, me.z, tx, tz));
  out.aimYaw = out.yaw;
  out.moveF = 127;
  if (sprint) out.buttons |= BUTTON.SPRINT;
}

/** Follows b.path from b.route. Returns true while it still has somewhere to go (and has commanded the walk). */
function followPath(b: NpcBrain, me: NpcBody, out: MoveCommand, sprint: boolean): boolean {
  const p = b.path;
  while (b.route < p.n) {
    const wx = p.x[b.route]!, wz = p.z[b.route]!;
    const last = b.route === p.n - 1;
    if (hyp(wx - me.x, wz - me.z) < (last ? NPC_TUNING.reach * 0.7 : NPC_TUNING.reach)) {
      b.route++;
      continue;
    }
    walkTo(me, wx, wz, out, sprint);
    return true;
  }
  return false;
}

/** Re-plans toward (tx, tz) at most once per `repath` seconds; false when the budgeted nav refused (try again next tick). */
function plan(b: NpcBrain, me: NpcBody, sn: NpcSenses, tx: number, tz: number, force: boolean): void {
  if (!force && sn.now - b.pathAt < NPC_TUNING.repath) return;
  if (sn.nav.path(me.x, me.z, tx, tz, b.path)) {
    b.pathAt = sn.now;
    b.route = 0;
  }
}

/** Puts a single waypoint into the brain's path (cover, flank). */
function setGoal(p: NavPath, x: number, z: number): void {
  p.x[0] = x;
  p.z[0] = z;
  p.n = 1;
  p.complete = true;
}

function setMode(b: NpcBrainState, mode: NpcMode, now: number): void {
  if (b.mode === mode) return;
  b.mode = mode;
  b.since = now;
  b.route = 0;
  if (mode !== "fire" && mode !== "flank") b.burst = 0;
}

const isCombat = (m: NpcMode): boolean => m === "fire" || m === "advance" || m === "cover" || m === "flank" || m === "retreat" || m === "hold";

/**
 * One tick of thought. Contract: the host calls it every server tick for every living NPC row of brain `garrison`. `out` is overwritten.
 * Modes: `stand_down` is latched and inert; `flee` is latched until morale recovers and the enemy is far; `march` follows the brain's path (the host
 * fills it from a named route) unless it is engaged; otherwise the utility scores pick fire / advance / cover / flank / retreat / hold.
 */
export function npcThink(nb: NpcBrain, me: NpcBody, sn: NpcSenses, dt: number, out: MoveCommand): void {
  const b = nb as NpcBrainState;
  out.moveF = 0;
  out.moveR = 0;
  out.buttons = 0;
  out.yaw = yawToWire(Number.isFinite(me.facing) ? me.facing : 0);
  out.aimYaw = out.yaw;
  out.aimElev = 0;
  out.weapon = b.weapon;
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.5) : 0;
  const now = fin(sn.now, 0);

  if (sn.standDown) b.mode = "stand_down";
  if (b.mode === "stand_down" || (me.flags & FLAG.DOWNED) !== 0) return;
  if (!b.sinceInit) {
    b.sinceInit = true;
    b.since = now - NPC_TUNING.dwell; // the first decision may change the mode at once
    b.thinkAt = now + (b.seed % 250) / 1000; // staggered: a room of sentries does not decide on the same tick
  }
  b.cooldown -= step;
  if (b.react > 0) b.react = Math.max(0, b.react - step);

  moraleStep(b.morale, {
    dt: step, leader: sn.leader !== undefined ? 1 : 0, allies: fin(sn.allies, 0), alliesDown: fin(sn.alliesDown, 0), hpLack: 100 - clamp(fin(me.health, 100), 0, 100),
    underFire: clamp(fin(sn.underFire, 0), 0, 1), fear: clamp(fin(sn.fear, 0), 0, 100), paid: true, provisions: false,
  }, b.bravery);

  // ---- senses -> target memory, reaction clock ----
  const e = sn.enemy !== undefined && !sn.enemy.down && sn.alert ? sn.enemy : undefined;
  const w0 = weaponFromWire(b.weapon);
  const wid: WeaponId = w0 === -1 ? WEAPON.FISTS : w0; // nothing drawn = bare hands
  const rng = WEAPONS[wid].ranged;
  const eff = NPC_TUNING.effRange[wid];
  const maxShot = NPC_TUNING.maxShot[wid];
  let dist = Infinity;
  if (e !== undefined) {
    dist = hyp(e.x - me.x, e.z - me.z);
    if (b.target !== e.id || now - b.lastSeen > NPC_TUNING.react.forget) {
      if (b.target !== e.id) b.targetHash = seedFromString(e.id);
      b.react = NPC_TUNING.react.base + (1 - b.skill / 100) * NPC_TUNING.react.perSkill + NPC_TUNING.react.jitter * hashFloat(b.seed, b.targetHash, Math.floor(now * 4), 7);
      b.ranged = 0;
      b.haveErr = false;
      b.burst = 0;
    }
    b.target = e.id;
    b.lastSeen = now;
    b.lastTx = e.x;
    b.lastTz = e.z;
    if (fin(e.moving, 0) > 0.8) {
      b.ranged = 0;
      b.haveErr = false;
    }
  } else if (now - b.lastSeen > NPC_TUNING.react.forget) b.target = "";
  const band = moraleBand(b.morale.v);

  // ---- decisions (4 Hz) ----
  if (now >= b.thinkAt) {
    b.thinkAt = now + 1 / NPC_TUNING.thinkHz;
    const dwelled = now - b.since >= NPC_TUNING.dwell;
    // flee latch: set when morale breaks, cleared when it has recovered and the enemy is well away
    if (b.fled) {
      if (b.morale.v >= NPC_TUNING.rally && dist > NPC_TUNING.fleeClear && now - b.fledAt > NPC_TUNING.fleeSeconds && dwelled) {
        b.fled = false;
        setMode(b, sn.alert ? "alert" : "post", now);
      }
    } else if (band === "broken" && dwelled) {
      b.fled = true;
      b.fledAt = now;
      setMode(b, "flee", now);
    }
    if (e !== undefined) {
      if (dwelled && !b.fled) decideCombat(b, me, sn, e, dist, eff, rng !== undefined, now);
    } else if (isCombat(b.mode)) {
      if (dwelled && now - b.lastSeen > NPC_TUNING.react.forget) setMode(b, sn.alert ? "alert" : "post", now);
    } else if ((b.mode === "post" || b.mode === "alert") && dwelled) setMode(b, sn.alert ? "alert" : "post", now);
  }

  // ---- action (every tick) ----
  const m = b.mode;
  if (m === "flee") {
    b.target = "";
    if (e !== undefined || now - b.fledAt < NPC_TUNING.fleeSeconds) {
      const away = e !== undefined ? headingTo(me.x, me.z, me.x - (e.x - me.x), me.z - (e.z - me.z)) : fin(me.facing, 0);
      out.yaw = yawToWire(away);
      out.aimYaw = out.yaw;
      out.moveF = 127;
      out.buttons = BUTTON.SPRINT;
    }
    return;
  }
  if (m === "march") {
    followPath(b, me, out, false);
    return;
  }
  if (e === undefined || !isCombat(m)) {
    if (m === "follow" && sn.leader !== undefined) {
      const d = hyp(sn.leader.x - me.x, sn.leader.z - me.z);
      if (d > 4) {
        plan(b, me, sn, sn.leader.x, sn.leader.z, false);
        if (!followPath(b, me, out, d > 14)) walkTo(me, sn.leader.x, sn.leader.z, out, false);
      }
      return;
    }
    // lost sight of someone it was fighting (or heard a shot it could not place): go and look where it last saw them (a man behind a rock is not a man who has gone away)
    if (e === undefined && sn.alert && now - b.lastSeen < NPC_TUNING.search) {
      const d = hyp(b.lastTx - me.x, b.lastTz - me.z);
      // (to the distance it fights from, not to the man's boots; but from where it could SEE that spot, or it stands at its range behind the wall he is behind)
      if (d > 3 && (d > Math.max(eff * 0.75, 3) || !sn.nav.los(me.x, me.z, b.lastTx, b.lastTz))) {
        plan(b, me, sn, b.lastTx, b.lastTz, false);
        if (!followPath(b, me, out, false)) walkTo(me, b.lastTx, b.lastTz, out, false);
      }
      if (rng !== undefined && me.ammo <= 0 && b.cooldown <= 0) {
        out.buttons |= BUTTON.RELOAD;
        b.cooldown = 0.5;
      }
      return;
    }
    // post / alert / guard: go home and keep watch
    const homeD = hyp(b.px - me.x, b.pz - me.z);
    if (homeD > 1.2) {
      if (homeD > NPC_TUNING.straight || b.route < b.path.n) {
        plan(b, me, sn, b.px, b.pz, false);
        if (!followPath(b, me, out, false)) walkTo(me, b.px, b.pz, out, false);
      } else walkTo(me, b.px, b.pz, out, false);
    }
    if (rng !== undefined && me.ammo <= 0 && b.cooldown <= 0) {
      out.buttons |= BUTTON.RELOAD;
      b.cooldown = 0.5;
    }
    return;
  }

  // engaged: face the enemy, work the weapon
  const heading = headingTo(me.x, me.z, e.x, e.z);
  const reacting = b.react > 0;
  if (reacting) {
    const maxTurn = MOVEMENT.turnRate * NPC_TUNING.react.turnFactor * step;
    out.yaw = yawToWire(fin(me.facing, 0) + clamp(angleDelta(fin(me.facing, 0), heading), -maxTurn, maxTurn));
    out.aimYaw = out.yaw;
    out.buttons |= BUTTON.AIM;
    return;
  }
  out.yaw = yawToWire(heading);
  out.aimYaw = out.yaw;

  if (m === "advance") {
    const keep = Math.max(eff * 0.75, 1);
    if (dist > keep) {
      if (dist > NPC_TUNING.straight || !sn.nav.los(me.x, me.z, e.x, e.z)) {
        plan(b, me, sn, e.x, e.z, false);
        if (!followPath(b, me, out, dist > 22)) walkTo(me, e.x, e.z, out, dist > 22);
      } else walkTo(me, e.x, e.z, out, dist > 22);
    }
  } else if (m === "cover" || m === "flank") {
    if (b.path.n > 0 && followPath(b, me, out, false)) {
      out.yaw = yawToWire(headingTo(me.x, me.z, b.path.x[b.route] ?? e.x, b.path.z[b.route] ?? e.z));
      out.aimYaw = out.yaw;
    } else if (m === "cover") out.buttons |= BUTTON.CROUCH;
  } else if (m === "retreat") {
    plan(b, me, sn, b.px, b.pz, false);
    if (followPath(b, me, out, band === "wavering")) {
      /* a fighting withdrawal: facing the way it walks */
    }
  }

  // trigger work: only from a mode that fires, only with a token, only inside the weapon's reach
  if (rng !== undefined) {
    if (me.ammo <= 0) {
      if (b.cooldown <= 0) {
        out.buttons |= BUTTON.RELOAD;
        b.cooldown = 0.5;
      }
    } else if ((m === "fire" || m === "flank" || m === "hold") && sn.token && dist <= maxShot && b.cooldown <= 0) fireRanged(b, me, e, dist, wid, out);
    if (m === "fire" && dist <= maxShot) out.buttons |= BUTTON.AIM;
  } else if (WEAPONS[wid].melee !== undefined) {
    const reach = WEAPONS[wid].melee!.reach;
    if ((m === "advance" || m === "fire") && dist <= reach + 0.4) {
      if (sn.token && b.cooldown <= 0) {
        out.buttons |= BUTTON.FIRE;
        b.cooldown = WEAPONS[wid].melee!.cooldown + NPC_TUNING.meleePad;
      }
    }
  }
}

/** Scores the combat modes and moves to the best one (with inertia). Allocation-free: plain locals. */
function decideCombat(b: NpcBrainState, me: NpcBody, sn: NpcSenses, e: NonNullable<NpcSenses["enemy"]>, dist: number, eff: number, ranged: boolean, now: number): void {
  const m = clamp(b.morale.v / 100, 0, 1);
  const threat = e.armed ? 1 : 0.7;
  const token = sn.token ? 1 : 0;
  const rangeFit = dist <= eff ? 1 : Math.max(0, 1 - (dist - eff) / 12);
  const under = clamp(fin(sn.underFire, 0), 0, 1);
  let coverNear = 0;
  if ((under > 0.1 || token === 0) && ranged) {
    b.coverOk = sn.nav.cover(me.x, me.z, e.x, e.z, NPC_TUNING.coverRadius, scratch);
    coverNear = b.coverOk ? 1 : 0;
  } else b.coverOk = false;
  const allyGap = fin(sn.allies, 0) >= 2 ? 1 : fin(sn.allies, 0) === 1 ? 0.4 : 0;
  const inertia = (mode: NpcMode): number => (b.mode === mode ? NPC_TUNING.inertia : 0);

  let best: NpcMode = "hold";
  let bs = NPC_TUNING.hold + inertia("hold");
  const fire = threat * token * rangeFit * (0.4 + 0.6 * m) + inertia("fire");
  if (fire > bs) { bs = fire; best = "fire"; }
  const advance = threat * (1 - rangeFit) * m * (ranged ? 1 : token) + inertia("advance"); // melee closes only with a token
  if (advance > bs) { bs = advance; best = "advance"; }
  const cover = threat * Math.max(under, 1 - token) * coverNear * 0.9 + inertia("cover");
  if (cover > bs) { bs = cover; best = "cover"; }
  const flank = ranged ? threat * (1 - token) * b.bold * allyGap + inertia("flank") : 0;
  if (flank > bs) { bs = flank; best = "flank"; }
  const retreat = (1 - m) * threat * (m < 0.5 ? 1 : NPC_TUNING.retreatSoft) + inertia("retreat");
  if (retreat > bs) { bs = retreat; best = "retreat"; }

  if (best === b.mode) return;
  if (best === "cover" && b.coverOk) setGoal(b.path, scratch.x, scratch.z);
  else if (best === "flank") {
    if (sn.nav.flank(me.x, me.z, e.x, e.z, b.side, NPC_TUNING.flankDist, scratch)) setGoal(b.path, scratch.x, scratch.z);
    else best = "fire";
  } else if (best === "retreat") b.pathAt = -1e9;
  setMode(b, best, now);
  if (best === "cover" || best === "flank") b.route = 0;
}

function fireRanged(b: NpcBrainState, me: NpcBody, e: NonNullable<NpcSenses["enemy"]>, dist: number, wid: WeaponId, out: MoveCommand): void {
  const T = NPC_TUNING;
  if (!b.haveErr) {
    // one error per burst: grows with range and motion, shrinks as the shooter ranges in on a target that stands still
    const moving = fin(e.moving, 0) > 0.8 || Math.sqrt(me.vx * me.vx + me.vz * me.vz) > 0.8;
    let sigma = T.aimBase[wid] * (1 + dist / T.aimRange) * (moving ? T.movingMul : 1) * (T.skillBase - b.skill / 100);
    sigma *= Math.pow(T.rangeShrink, Math.min(b.ranged, T.rangedMax));
    b.errYaw = gauss(b.seed, b.shotNo, 11) * sigma;
    b.errElev = (hashFloat(b.seed, b.shotNo, 12) - 0.5) * 2 * T.aimElev;
    b.haveErr = true;
  }
  const heading = headingTo(me.x, me.z, e.x, e.z);
  out.aimYaw = yawToWire(heading + b.errYaw);
  out.aimElev = elevToWire(Math.atan2(-0.45, Math.max(dist, 1)) + b.errElev); // (the wire form: 1/20000 rad)
  out.buttons |= BUTTON.FIRE | BUTTON.AIM;
  b.shotNo++;
  if (fin(e.moving, 0) <= 0.8) b.ranged++;
  const u = hashFloat(b.seed, b.shotNo, 13);
  if (wid === WEAPON.PISTOL) {
    if (b.burst <= 0) b.burst = T.pistolBurst;
    b.burst--;
    b.cooldown = b.burst > 0 ? T.pistolGap : lerpRange(T.pistolPause, u);
    if (b.burst > 0) b.haveErr = true; // the pair shares one error: the second shot follows the first's mistake
    else b.haveErr = false;
  } else if (wid === WEAPON.RIFLE) {
    b.cooldown = lerpRange(T.rifleThink, u);
    b.haveErr = false;
  } else {
    b.cooldown = lerpRange(T.scatterThink, u);
    b.haveErr = false;
  }
}
