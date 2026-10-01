import { BUTTON, FLAG } from "./constants.ts";
import type { CommandId, CommandMsg, FollowerKind, Intent, Morale, NpcBody, NpcBrain, NpcMode, NpcSenses } from "./expeditionTypes.ts";
import { clamp } from "./math.ts";
import { moraleBand, moraleStep, type MoraleBand } from "./morale.ts";
import { yawToWire, type MoveCommand } from "./movement.ts";
import { NPC_TUNING, npcThink, type NpcBrainState } from "./npcBrain.ts";
import { WEAPON, WEAPONS, weaponFromWire } from "./weapons.ts";

/**
 * Orders and the hired hand's brain (D-034, package L).
 *
 * `resolveCommand` is the table of who obeys what: a hand obeys by morale band (steady everything; shaken refuses `attack` unless the leader is near;
 * wavering obeys only follow / retreat; broken obeys nothing) and by trade (a porter does not shoot, only a porter fetches), and every refusal is an
 * authored one-liner the server sends as a `notice`. `followerThink` is a `BrainFn`: it runs the standing intent (follow, hold, attack, fetch,
 * retreat, and the surgeon's tend) and, whenever a hand has somebody to fight and the intent lets it, hands the decision to the garrison's
 * `npcThink` (the same utility brain, the same misses and attack tokens), so a hired rifleman fires, takes cover and breaks exactly as a sentry does.
 * Pure with respect to (brain, body, senses, dt) and allocation-free after the first call for a brain; the host (`Followers`) feeds it the world
 * facts a senses block cannot carry (the target's position, the prop, the patient) through `mindOf(brain)` and reads its requests back from it.
 */

export type Refusal = { refuse: string };
export type Resolved = { intent: Intent } | Refusal;

export interface CommandCtx {
  band: MoraleBand;
  /** A human is within shouting distance of this hand. */
  leaderNear: boolean;
  /** Seconds since this hand's last accepted order; under `COMMAND_GAP` the order is ignored silently (an empty refusal). */
  rate: number;
  /** Where the hand stands now (a `hold` with no point holds here). */
  here: { x: number; z: number };
}

export const COMMAND_GAP = 0.5;

const LINES = {
  shakenAttack: [
    "%n says he will attack when the leader is within shouting distance, and preferably holding something large.",
    "%n is shaken. %n will follow you into a fight, but not out in front of it.",
    "%n explains that the order is sound and that he is not.",
  ],
  waver: [
    "%n is not taking orders so much as taking stock of the exits.",
    "%n hears you perfectly well and has decided it was addressed to somebody braver.",
    "%n says that is a splendid idea and that he will think of it fondly from over there.",
  ],
  broken: [
    "%n is not listening. %n is composing a letter home.",
    "%n has gone somewhere inside himself and bolted the door.",
    "%n stares at you with the calm of a man whose contract has just expired.",
  ],
  porterAttack: ["%n carries. Shooting is a separate contract and a higher rate.", "%n holds up his empty hands. They are the weapon, and they are very tired.", "%n would sooner be hit by a crate than be asked that."],
  notPorter: ["%n is not paid to carry. There is a man for that.", "%n is a professional, and professionals do not lift things off the ground.", "%n suggests you ask the porter, and then suggests the porter's wage."],
  nothing: ["%n waits for you to say where.", "%n needs something to point at.", "%n stands there with a look of patient inquiry."],
} as const;

const line = (list: readonly string[], name: string, h: number): string => list[(h >>> 0) % list.length]!.replace(/%n/g, name);

const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * What a hand does with an order. `follower` is the roster entry (only its kind and name matter); the msg is already structurally valid
 * (`parseCommandMsg`) and the server has already checked range and that `target` exists and is allowed. Returns the intent to store or a refusal.
 */
export function resolveCommand(msg: CommandMsg, follower: { kind: FollowerKind; name: string }, ctx: CommandCtx): Resolved {
  const n = follower.name;
  if (!(ctx.rate >= COMMAND_GAP)) return { refuse: "" };
  const h = hashStr(follower.name) ^ hashStr(msg.intent);
  const c: CommandId = msg.intent;
  switch (ctx.band) {
    case "broken": return { refuse: line(LINES.broken, n, h) };
    case "wavering": if (c !== "follow" && c !== "retreat") return { refuse: line(LINES.waver, n, h) }; break;
    case "shaken": if (c === "attack" && !ctx.leaderNear) return { refuse: line(LINES.shakenAttack, n, h) }; break;
    default: break;
  }
  switch (c) {
    case "follow": return { intent: { k: "follow" } };
    case "retreat": return { intent: { k: "retreat" } };
    case "hold": {
      const p = msg.at ?? ctx.here;
      return { intent: { k: "hold", x: p.x, z: p.z } };
    }
    case "attack":
      if (follower.kind === "porter") return { refuse: line(LINES.porterAttack, n, h) };
      if (msg.target === undefined) return { refuse: line(LINES.nothing, n, h) };
      return { intent: { k: "attack", target: msg.target } };
    case "fetch": {
      if (follower.kind !== "porter") return { refuse: line(LINES.notPorter, n, h) };
      if (msg.target === undefined) return { refuse: line(LINES.nothing, n, h) };
      return msg.at !== undefined ? { intent: { k: "fetch", prop: msg.target, to: { x: msg.at.x, z: msg.at.z } } } : { intent: { k: "fetch", prop: msg.target } };
    }
    default: return { refuse: "" };
  }
}

/** The word on the plate and the notice line after an order: "Obeyed" or "Refused". */
export const OBEYED = "Obeyed";
export const REFUSED = "Refused";

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const FOLLOW = {
  /** Start walking when the leader is farther than `far`, stop inside `near` (so a hand keeps 2.5-4 m off and does not shuffle). */
  far: 4, near: 2.8, sprintAt: 14,
  /** How far from the leader a hand will go to fight, and how far from its post a `hold` will wander for cover. */
  tether: 20, holdLeash: 12,
  /** Arrival radii: a fetched prop, the drop point, a patient. */
  pickup: 1.1, drop: 2, tend: 1.5,
  /** A porter this close to a threat (m), or under fire, runs for the leader. */
  porterFear: 22, porterPanic: 12,
  /** Seconds the hand stays in the fight's hands after the enemy was last in sight (npcThink's own forget time). */
  engage: NPC_TUNING.react.forget,
  /** At the leader's side within this many metres a retreating hand fights again. */
  rally: 5,
} as const;

/** What the host and the brain tell each other. Plain numbers and booleans; reached through `mindOf(brain)`. */
export interface FollowerMind {
  kind: FollowerKind;
  /** Host -> brain, refreshed every tick by `Followers`. */
  paid: boolean;
  provisions: boolean;
  bravery: number;
  landX: number;
  landZ: number;
  /** Attack target position (tOn false: the target is gone or down, the brain falls back to follow). */
  tOn: boolean;
  tx: number;
  tz: number;
  /** Fetch: the prop's position while it lies there. */
  fOn: boolean;
  fx: number;
  fz: number;
  /** The patient a surgeon is sent to, and whether it needs reviving (else a dressing). */
  tendOn: boolean;
  tendX: number;
  tendZ: number;
  /** Brain -> host: requests the host answers (and clears) on its next tick. */
  wantPickup: boolean;
  wantDrop: boolean;
  /** Surgeon is within reach of the patient. */
  ready: boolean;
  /** Host -> brain: the porter is holding a prop. */
  carrying: boolean;
  // private
  moving: boolean;
  lastEngage: number;
  scratch: Morale;
}

const minds = new WeakMap<NpcBrain, FollowerMind>();

export function mindOf(b: NpcBrain): FollowerMind {
  let m = minds.get(b);
  if (m === undefined) {
    m = {
      kind: "rifleman", paid: true, provisions: false, bravery: 50, landX: (b as NpcBrainState).px, landZ: (b as NpcBrainState).pz, tOn: false, tx: 0, tz: 0, fOn: false, fx: 0, fz: 0,
      tendOn: false, tendX: 0, tendZ: 0, wantPickup: false, wantDrop: false, ready: false, carrying: false, moving: false, lastEngage: -1e9, scratch: { v: 70, shock: 0 },
    };
    minds.set(b, m);
  }
  return m;
}

/** Stores a new standing order and forgets everything the old one had planned. */
export function setIntent(b: NpcBrain, intent: Intent | undefined): void {
  b.intent = intent;
  b.pathAt = -1e9;
  b.route = 0;
  b.path.n = 0;
  const m = mindOf(b);
  m.wantPickup = m.wantDrop = false;
  m.tOn = m.fOn = false;
  m.moving = false;
}

const FOLLOW_INTENT: Intent = { k: "follow" };
const fin = (v: number, d: number): number => (Number.isFinite(v) ? v : d);
const headingTo = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));

function setMode(b: NpcBrain, mode: NpcMode, now: number): void {
  if (b.mode === mode) return;
  b.mode = mode;
  b.since = now - NPC_TUNING.dwell; // decidable at once: a hand that has just stopped following must be able to answer fire in the same breath
  b.route = 0;
  b.path.n = 0;
  b.pathAt = -1e9;
  b.burst = 0;
}

function walkTo(me: NpcBody, tx: number, tz: number, out: MoveCommand, sprint: boolean): void {
  out.yaw = yawToWire(headingTo(me.x, me.z, tx, tz));
  out.aimYaw = out.yaw;
  out.moveF = 127;
  if (sprint) out.buttons |= BUTTON.SPRINT;
}

function followPath(b: NpcBrain, me: NpcBody, out: MoveCommand, sprint: boolean): boolean {
  const p = b.path;
  while (b.route < p.n) {
    const wx = p.x[b.route]!, wz = p.z[b.route]!;
    const last = b.route === p.n - 1;
    if (Math.hypot(wx - me.x, wz - me.z) < (last ? NPC_TUNING.reach * 0.7 : NPC_TUNING.reach)) {
      b.route++;
      continue;
    }
    walkTo(me, wx, wz, out, sprint);
    return true;
  }
  return false;
}

/** Walks toward (gx, gz) by the nav (straight when it is close and clear). Returns false once within `stop` metres (nothing commanded). */
function goTo(b: NpcBrain, me: NpcBody, sn: NpcSenses, gx: number, gz: number, stop: number, sprint: boolean, out: MoveCommand): boolean {
  const d = Math.hypot(gx - me.x, gz - me.z);
  if (d <= stop) return false;
  if (d > NPC_TUNING.straight || !sn.nav.los(me.x, me.z, gx, gz)) {
    if (sn.now - b.pathAt >= NPC_TUNING.repath && sn.nav.path(me.x, me.z, gx, gz, b.path)) {
      b.pathAt = sn.now;
      b.route = 0;
    }
    if (!followPath(b, me, out, sprint)) walkTo(me, gx, gz, out, sprint);
  } else walkTo(me, gx, gz, out, sprint);
  return true;
}

/** npcThink with the hand's own morale in force: the garrison brain steps a scratch copy (its inputs assume paid wages and no provisions) which is then discarded. */
function delegate(b: NpcBrain, mind: FollowerMind, me: NpcBody, sn: NpcSenses, dt: number, out: MoveCommand): void {
  const real = b.morale;
  const s = mind.scratch;
  s.v = real.v;
  s.shock = real.shock;
  b.morale = s;
  npcThink(b, me, sn, dt, out);
  b.morale = real;
}

function reloadIfDry(b: NpcBrain, me: NpcBody, out: MoveCommand): void {
  const w = weaponFromWire(b.weapon);
  if (w !== -1 && WEAPONS[w].ranged !== undefined && me.ammo <= 0 && b.cooldown <= 0) {
    out.buttons |= BUTTON.RELOAD;
    b.cooldown = 0.5;
  }
}

/**
 * One tick for a hired hand. `out` is overwritten. Order of business: downed = inert; morale (own inputs); a broken or fleeing hand is the garrison brain's
 * to run (it flees and rallies); a porter never fights; a surgeon with a patient tends; then the standing intent, fighting through `npcThink` when
 * there is an enemy, the intent allows it and the hand is within its tether.
 */
export function followerThink(b: NpcBrain, me: NpcBody, sn: NpcSenses, dt: number, out: MoveCommand): void {
  const mind = mindOf(b);
  const bs = b as NpcBrainState;
  out.moveF = 0;
  out.moveR = 0;
  out.buttons = 0;
  out.yaw = yawToWire(fin(me.facing, 0));
  out.aimYaw = out.yaw;
  out.aimElev = 0;
  out.weapon = b.weapon;
  mind.wantPickup = false; // requests last one tick: the host answers within the tick it sees them
  mind.wantDrop = false;
  mind.ready = false;
  if ((me.flags & FLAG.DOWNED) !== 0) return;
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.5) : 0;
  const now = fin(sn.now, 0);
  b.cooldown -= step;

  const leader = sn.leader;
  const dLeader = leader !== undefined ? Math.hypot(leader.x - me.x, leader.z - me.z) : Infinity;
  moraleStep(b.morale, {
    dt: step, leader: dLeader <= 20 ? 1 : 0, allies: fin(sn.allies, 0), alliesDown: fin(sn.alliesDown, 0), hpLack: 100 - clamp(fin(me.health, 100), 0, 100),
    underFire: clamp(fin(sn.underFire, 0), 0, 1), fear: clamp(fin(sn.fear, 0), 0, 100), paid: mind.paid, provisions: mind.provisions,
  }, mind.bravery);
  const band = moraleBand(b.morale.v);

  const enemy = sn.enemy !== undefined && !sn.enemy.down && sn.alert ? sn.enemy : undefined;

  // a hand who has run, or whose nerve is gone, belongs to the garrison brain's flee/rally latch
  if (bs.fled || band === "broken") {
    delegate(b, mind, me, sn, dt, out);
    return;
  }

  // porters carry; they do not fight
  if (mind.kind === "porter") {
    thinkPorter(b, mind, me, sn, enemy, dLeader, now, out);
    return;
  }

  // the surgeon goes to the fallen (unless he is being shot at and is not steady enough to ignore it)
  if (mind.tendOn && !(sn.underFire > 0.5 && band !== "steady")) {
    setMode(b, "tend", now);
    if (!goTo(b, me, sn, mind.tendX, mind.tendZ, FOLLOW.tend, Math.hypot(mind.tendX - me.x, mind.tendZ - me.z) > 8, out)) {
      mind.ready = true;
      out.yaw = yawToWire(headingTo(me.x, me.z, mind.tendX, mind.tendZ));
      out.aimYaw = out.yaw;
    }
    return;
  }

  const intent = b.intent ?? FOLLOW_INTENT;
  let engage = enemy !== undefined;
  if (engage) {
    switch (intent.k) {
      case "follow": engage = dLeader <= FOLLOW.tether; break;
      case "hold": engage = Math.hypot(intent.x - me.x, intent.z - me.z) <= FOLLOW.holdLeash; break;
      case "retreat": engage = dLeader <= FOLLOW.rally; break;
      default: break; // attack: always; fetch: a rifleman cannot fetch, so it never gets here
    }
  }
  if (engage || (now - mind.lastEngage < FOLLOW.engage && now >= mind.lastEngage)) {
    if (engage) mind.lastEngage = now;
    mind.moving = false;
    // our own "retreat" label would send the garrison brain back to its post; at the leader's side the hand stands and fires instead
    if (intent.k === "retreat" && b.mode === "retreat") setMode(b, "hold", now);
    delegate(b, mind, me, sn, dt, out);
    tether(intent, leader, me, out);
    return;
  }

  // ---- no fight: carry out the standing order ----
  switch (intent.k) {
    case "hold": {
      setMode(b, "hold", now);
      goTo(b, me, sn, intent.x, intent.z, 1.2, false, out);
      break;
    }
    case "attack": {
      if (mind.tOn) {
        setMode(b, "advance", now);
        const w = weaponFromWire(b.weapon);
        const eff = NPC_TUNING.effRange[w === -1 ? WEAPON.FISTS : w];
        goTo(b, me, sn, mind.tx, mind.tz, Math.max(eff * 0.75, 1.5), Math.hypot(mind.tx - me.x, mind.tz - me.z) > 22, out);
        break;
      }
      follow(b, mind, me, sn, leader, dLeader, now, out);
      break;
    }
    case "retreat": {
      setMode(b, "retreat", now);
      const panic = sn.underFire > 0.2 || band === "wavering";
      if (leader !== undefined) {
        if (dLeader > 3) goTo(b, me, sn, leader.x, leader.z, 2.5, panic || dLeader > FOLLOW.sprintAt, out);
      } else goTo(b, me, sn, mind.landX, mind.landZ, 3, panic, out);
      break;
    }
    default: follow(b, mind, me, sn, leader, dLeader, now, out); // follow, and a fetch a rifleman cannot do
  }
  reloadIfDry(b, me, out);
}

/**
 * A fight must not drag a hand off its anchor: the garrison brain advances on whoever it sees. Within 10% of the tether (a hold point, the leader's side
 * while retreating, the leader while following) a step that carries the hand farther out is cancelled; it stands and fires from where it is.
 */
function tether(intent: Intent, leader: NpcSenses["leader"], me: NpcBody, out: MoveCommand): void {
  if (out.moveF === 0 && out.moveR === 0) return;
  let ax: number, az: number, limit: number;
  if (intent.k === "hold") { ax = intent.x; az = intent.z; limit = FOLLOW.holdLeash; }
  else if (leader !== undefined && (intent.k === "retreat" || intent.k === "follow")) { ax = leader.x; az = leader.z; limit = intent.k === "retreat" ? FOLLOW.rally : FOLLOW.tether; }
  else return;
  const ox = me.x - ax, oz = me.z - az;
  if (Math.hypot(ox, oz) < limit * 0.9) return;
  // the stick walks along the yaw (0 = -Z), strafing aside: outward when the heading has a positive component along the offset
  const y = (out.yaw / 65536) * Math.PI * 2;
  const f = out.moveF / 127, r = out.moveR / 127;
  const wx = -Math.sin(y) * f + Math.cos(y) * r, wz = -Math.cos(y) * f - Math.sin(y) * r;
  if (wx * ox + wz * oz > 0) {
    out.moveF = 0;
    out.moveR = 0;
    out.buttons &= ~BUTTON.SPRINT;
  }
}

/** Keep 2.5-4 m off the leader (hysteresis, so nobody shuffles); with no leader in reach, go back to the post and wait. */
function follow(b: NpcBrain, mind: FollowerMind, me: NpcBody, sn: NpcSenses, leader: NpcSenses["leader"], dLeader: number, now: number, out: MoveCommand): void {
  setMode(b, "follow", now);
  if (leader === undefined) {
    goTo(b, me, sn, mind.landX, mind.landZ, 2.5, false, out);
    return;
  }
  if (!mind.moving && dLeader > FOLLOW.far) mind.moving = true;
  else if (mind.moving && dLeader < FOLLOW.near) mind.moving = false;
  if (mind.moving) goTo(b, me, sn, leader.x, leader.z, FOLLOW.near * 0.9, dLeader > FOLLOW.sprintAt, out);
}

function thinkPorter(b: NpcBrain, mind: FollowerMind, me: NpcBody, sn: NpcSenses, enemy: NpcSenses["enemy"], dLeader: number, now: number, out: MoveCommand): void {
  const leader = sn.leader;
  if (enemy !== undefined) {
    const dE = Math.hypot(enemy.x - me.x, enemy.z - me.z);
    if (sn.underFire > 0.2 || dE < FOLLOW.porterPanic || (dE < FOLLOW.porterFear && dLeader > 6)) {
      setMode(b, "retreat", now);
      if (leader !== undefined && dLeader > 2.5) goTo(b, me, sn, leader.x, leader.z, 2, true, out);
      else if (leader === undefined) {
        out.yaw = yawToWire(headingTo(me.x, me.z, me.x - (enemy.x - me.x), me.z - (enemy.z - me.z)));
        out.aimYaw = out.yaw;
        out.moveF = 127;
        out.buttons |= BUTTON.SPRINT;
      } else out.buttons |= BUTTON.CROUCH;
      return;
    }
  }
  const intent = b.intent ?? FOLLOW_INTENT;
  if (intent.k === "fetch" && (mind.fOn || mind.carrying)) {
    setMode(b, "fetch", now);
    if (!mind.carrying) {
      if (!goTo(b, me, sn, mind.fx, mind.fz, FOLLOW.pickup, false, out)) mind.wantPickup = true;
    } else {
      const dx = intent.to !== undefined ? intent.to.x : leader !== undefined ? leader.x : mind.landX;
      const dz = intent.to !== undefined ? intent.to.z : leader !== undefined ? leader.z : mind.landZ;
      if (!goTo(b, me, sn, dx, dz, FOLLOW.drop, false, out)) mind.wantDrop = true;
    }
    return;
  }
  if (intent.k === "hold") {
    setMode(b, "hold", now);
    goTo(b, me, sn, intent.x, intent.z, 1.2, false, out);
    return;
  }
  if (intent.k === "retreat") {
    setMode(b, "retreat", now);
    if (leader !== undefined) {
      if (dLeader > 3) goTo(b, me, sn, leader.x, leader.z, 2.5, dLeader > FOLLOW.sprintAt, out);
    } else goTo(b, me, sn, mind.landX, mind.landZ, 3, false, out);
    return;
  }
  follow(b, mind, me, sn, leader, dLeader, now, out);
}
