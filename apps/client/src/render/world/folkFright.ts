import { FOLK_RADIUS, hash3, routePoint, segmentOk, type CollisionWorld, type Folk, type Route, type Villager, type VillagerPose } from "@cb/shared";

/**
 * D-122: FOLK UNDER FIRE. The townsfolk (Hollowmere's, Lampside's) are the shared pure schedule, scenery that bullets never look at; until now a gunfight in the
 * street left the Lamp-Trimmer trimming. Now a shot or a blast near them is heard: they start, look at it, and then either crouch where they stand with their hands
 * over their heads or run for their own door (or the nearest one, if home is far) along the folk's own walking routes, and stay in until it has been quiet a while;
 * then they come back out and walk back into their day. Children always run for home; the old cower.
 *
 * Purely cosmetic and client-side, like the rest of the folk: nothing is sent, simulated on the server or hit. Each client hears the shots the server tells it about
 * (and its own), so two players see much the same panic, a few milliseconds apart. The schedule is never changed: this is an override of the pose the schedule gives,
 * and when it ends the person is handed back to the schedule where it says they are (walked back to it, never popped, unless they are out of sight).
 */

export const FRIGHT = {
  /** How far a shot and a blast are heard (m). */
  shotR: 42,
  blastR: 75,
  /** The start: how long they stand, flinched and looking, before they choose (s), plus up to `startleJitter`. */
  startle: 0.3,
  startleJitter: 0.45,
  /** Quiet needed before they come out again (s), plus up to `calmJitter`. */
  calm: 14,
  calmJitter: 10,
  /** Running pace (m/s): grown-ups and children. */
  run: 3.4,
  runChild: 3.8,
  /** A door further than this to walk to (m) is not run for: they cower instead. */
  maxRun: 42,
  /** Walking back out, metres per second at the person's own pace factor 1. */
  back: 1.4,
  /** How long the hand-back to the schedule takes (s), and how far apart the two may be for it to be a blend rather than another walk (m). */
  blend: 0.8,
  blendNear: 2.5,
  /** D-132: burning ground is seen and smelt, not heard far: it frightens within `fireR` (m). A refuge must stand `fireClear` from it, and a run passes no nearer than `firePass`. */
  fireR: 16,
  fireClear: 10,
  firePass: 4,
  /** From fire even the old get up and go, at this share of a run. */
  fireElder: 0.55,
  /** One place's flames are told again only after `fireAgain` seconds, or `fireApart` metres on (a spreading fire is a few noises a second, never hundreds). */
  fireAgain: 2,
  fireApart: 6,
} as const;

// ---- what was heard --------------------------------------------------------------------------------------------------------------------------------------

/** The kind of noise and so how far it carries (D-132: and fire, which is seen rather than heard). */
export type FolkNoiseKind = "shot" | "blast" | "fire";

const RING = 32;
const noiseX = new Float64Array(RING);
const noiseZ = new Float64Array(RING);
const noiseR = new Float64Array(RING);
const noiseFire = new Uint8Array(RING);
let noiseSeq = 0;

/** A noise somewhere in the world (CombatView: every shot it draws, every cannon and every blast; `noteFolkFire`: the flames). */
export function noteFolkNoise(x: number, z: number, kind: FolkNoiseKind): void {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const i = noiseSeq % RING;
  noiseX[i] = x;
  noiseZ[i] = z;
  noiseR[i] = kind === "blast" ? FRIGHT.blastR : kind === "fire" ? FRIGHT.fireR : FRIGHT.shotR;
  noiseFire[i] = kind === "fire" ? 1 : 0;
  noiseSeq++;
}

const FIRE_RING = 16;
const fireX = new Float64Array(FIRE_RING);
const fireZ = new Float64Array(FIRE_RING);
const fireT = new Float64Array(FIRE_RING).fill(-Infinity);
let fireSeq = 0;

/**
 * D-132: flames at (x, z) at `now` seconds (the game: a few burning cells a frame, in turn, and everybody alight). Told as a fire noise unless the same place was told
 * within `fireAgain` seconds, so a fire that keeps burning keeps them away and a wildfire's hundred cells are a handful of noises. Returns whether it was told.
 */
export function noteFolkFire(x: number, z: number, now: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  for (let k = 0; k < FIRE_RING; k++) if (now - fireT[k]! < FRIGHT.fireAgain && now >= fireT[k]! && Math.hypot(fireX[k]! - x, fireZ[k]! - z) < FRIGHT.fireApart) return false;
  const i = fireSeq++ % FIRE_RING;
  fireX[i] = x;
  fireZ[i] = z;
  fireT[i] = now;
  noteFolkNoise(x, z, "fire");
  return true;
}

/** How many noises there have been (a reader keeps the count it has seen). */
export const folkNoiseCount = (): number => noiseSeq;

/** Every noise after the `since`-th (at most the last 32), oldest first; returns the new count to keep. */
export function eachFolkNoise(since: number, fn: (x: number, z: number, r: number, seq: number, fire: boolean) => void): number {
  for (let s = Math.max(since, noiseSeq - RING); s < noiseSeq; s++) fn(noiseX[s % RING]!, noiseZ[s % RING]!, noiseR[s % RING]!, s, noiseFire[s % RING] === 1);
  return noiseSeq;
}

// ---- one person's fright --------------------------------------------------------------------------------------------------------------------------

export const FEAR = { none: 0, startle: 1, cower: 2, flee: 3, hidden: 4, back: 5, blend: 6, chase: 7 } as const;
type Mode = (typeof FEAR)[keyof typeof FEAR];

export interface Fright {
  mode: Mode;
  /** World seconds: when the current mode began, and when they may come out (moved on by every noise they hear). */
  since: number;
  calmAt: number;
  /** Where the noise was. */
  sx: number;
  sz: number;
  /** Where they are drawn (the last pose written), and where a lead-in or a blend starts. */
  x: number;
  y: number;
  z: number;
  facing: number;
  ax: number;
  ay: number;
  az: number;
  af: number;
  /** The route being run or walked, the lead-in to its start, how far along (negative: still on the lead-in), at what pace, and the station it ends at. */
  route: Route | undefined;
  lead: number;
  s: number;
  speed: number;
  goal: number;
  /** How many walks back it has taken (a moving schedule can be chased twice, then it is blended). */
  tries: number;
  /** On a seat when it started (they stay on it to cower, and get up off it to run). */
  seated: boolean;
  /** Where the schedule had them when it started (a station: the seat's bench, the stall). */
  at: number;
  /** 0..1, shown on the face and in the body (eases). */
  fear: number;
  /** The noise that started this fright (its line is picked from it). */
  noise: number;
  /** D-132: it was flames: everybody goes, and not toward them. */
  fire: boolean;
}

export const createFright = (): Fright => ({ mode: FEAR.none, since: 0, calmAt: 0, sx: 0, sz: 0, x: 0, y: 0, z: 0, facing: 0, ax: 0, ay: 0, az: 0, af: 0, route: undefined, lead: 0, s: 0, speed: 0, goal: -1, tries: 0, seated: false, at: -1, fear: 0, noise: -1, fire: false });

const h01 = (a: number, b: number, c: number): number => hash3(a >>> 0, b >>> 0, c >>> 0) / 4294967296;
const face = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const pt = { x: 0, z: 0, y: 0, tx: 0, tz: -1, clear: 0 };

/**
 * Somebody hears a noise at (x, z) that carries `r` metres, at world second `now`. Returns true when it frightens somebody who was at ease (the caller flinches the
 * body and gives them a line). Nobody indoors or asleep hears it; whoever is already frightened just stays in longer. `fire`: it is flames (D-132).
 */
export function hearFright(f: Fright, pose: VillagerPose, x: number, z: number, r: number, now: number, seq: number, who: number, fire = false): boolean {
  if (f.mode === FEAR.none && (!pose.visible || pose.act === "sleep")) return false;
  const px = f.mode === FEAR.none ? pose.x : f.x;
  const pz = f.mode === FEAR.none ? pose.z : f.z;
  const d = Math.hypot(px - x, pz - z);
  if (d > r) return false;
  const calm = now + FRIGHT.calm + h01(who, seq, 0x51) * FRIGHT.calmJitter;
  f.calmAt = Math.max(f.calmAt, calm);
  // (somebody down where they stand for a shot gets up and goes when the flames come near: D-132)
  if (f.mode !== FEAR.none && f.mode !== FEAR.back && f.mode !== FEAR.blend && !(fire && !f.fire && (f.mode === FEAR.cower || f.mode === FEAR.startle))) return false;
  // a fresh fright: stand where they are, start, look at it (the sound arrives at 340 m/s; the start takes a beat more)
  if (f.mode === FEAR.none) {
    f.x = pose.x;
    f.y = pose.y;
    f.z = pose.z;
    f.facing = pose.facing;
    f.seated = pose.seated && pose.act !== "walk";
    f.at = pose.act === "walk" ? -1 : pose.station;
  } else f.seated = false;
  f.ax = f.x;
  f.ay = f.y;
  f.az = f.z;
  f.af = f.facing;
  f.sx = x;
  f.sz = z;
  f.fire = fire;
  f.mode = FEAR.startle;
  f.since = now + d / 340;
  f.route = undefined;
  f.tries = 0;
  f.noise = seq;
  return true;
}

/** The nearest standable station to (x, z) that can be walked to in a straight line (of the four nearest), or -1. */
const near4 = new Int32Array(4);
const near4d = new Float64Array(4);
function nearestStation(folk: Folk, world: CollisionWorld, x: number, y: number, z: number): number {
  const st = folk.nav.stations;
  near4.fill(-1);
  near4d.fill(Infinity);
  for (let k = 0; k < st.length; k++) {
    const s = st[k]!;
    if (!s.ok || s.hidden) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d >= near4d[3]!) continue;
    let j = 3;
    while (j > 0 && near4d[j - 1]! > d) {
      near4[j] = near4[j - 1]!;
      near4d[j] = near4d[j - 1]!;
      j--;
    }
    near4[j] = k;
    near4d[j] = d;
  }
  for (let j = 0; j < 4; j++) {
    const k = near4[j]!;
    if (k < 0) break;
    if (near4d[j]! < 0.05 || segmentOk(world, x, z, y, st[k]!.x, st[k]!.z, FOLK_RADIUS)) return k;
  }
  return -1;
}

/**
 * Where a frightened person runs: their own door if it is near enough, else the nearest door, else the nearest roof; -1 when none is within a run (they cower).
 * From fire (D-132) no refuge near the flames will do, and when there is no door or roof clear of it they go to the open ground furthest from it within a run.
 */
function refugeFor(folk: Folk, v: Villager, from: number, f: Fright, open = false): { to: number; hide: boolean } {
  const nav = folk.nav;
  const clear = (k: number): boolean => !f.fire || Math.hypot(nav.stations[k]!.x - f.sx, nav.stations[k]!.z - f.sz) >= FRIGHT.fireClear;
  const home = nav.index.get(`in:${v.home}`);
  if (!open && home !== undefined && nav.stations[home]!.ok && clear(home) && nav.distance(from, home) <= FRIGHT.maxRun) return { to: home, hide: true };
  let to = -1;
  let hide = false;
  let best: number = FRIGHT.maxRun;
  for (let k = 0; !open && k < nav.stations.length; k++) {
    const s = nav.stations[k]!;
    if (!s.ok || !(s.hidden || s.sheltered) || k === from || !clear(k)) continue;
    const d = nav.distance(from, k) + (s.hidden ? 0 : 6);   // (a door before a roof)
    if (d < best) {
      best = d;
      to = k;
      hide = s.hidden;
    }
  }
  if (to >= 0 || !f.fire) return { to, hide };
  let far: number = FRIGHT.fireClear;
  for (let k = 0; k < nav.stations.length; k++) {
    const s = nav.stations[k]!;
    if (!s.ok || s.hidden || k === from || nav.distance(from, k) > FRIGHT.maxRun) continue;
    const d = Math.hypot(s.x - f.sx, s.z - f.sz);
    if (d > far) {
      far = d;
      to = k;
    }
  }
  return { to, hide: false };
}

/** D-132: whether a run along `route` never takes them nearer the flames at (sx, sz) than `firePass` metres, or than they set off from if that was nearer (sampled every metre). */
function passesClear(route: Route, sx: number, sz: number): boolean {
  routePoint(route, 0, pt);
  const keep = Math.min(FRIGHT.firePass, Math.hypot(pt.x - sx, pt.z - sz)) - 0.25;
  for (let s = 1; s <= route.len; s += 1) {
    routePoint(route, s, pt);
    if (Math.hypot(pt.x - sx, pt.z - sz) < keep) return false;
  }
  return true;
}

/** Starts a walk (or run) along `route` from where they are drawn, by a straight lead-in to its start. */
function setOff(f: Fright, route: Route, speed: number, goal: number, mode: Mode, now: number): void {
  f.route = route;
  f.ax = f.x;
  f.ay = f.y;
  f.az = f.z;
  f.lead = Math.hypot(route.x[0]! - f.x, route.z[0]! - f.z);
  f.s = -f.lead;
  f.speed = speed;
  f.goal = goal;
  f.mode = mode;
  f.since = now;
}

/** Writes the walk so far into the fright's position; returns true at the end of the route. */
function along(f: Fright, dt: number): boolean {
  const r = f.route!;
  f.s = Math.min(r.len, f.s + f.speed * dt);
  if (f.s < 0) {
    const k = f.lead > 1e-6 ? 1 + f.s / f.lead : 1;
    f.x = f.ax + (r.x[0]! - f.ax) * k;
    f.z = f.az + (r.z[0]! - f.az) * k;
    f.y = f.ay + (r.y[0]! - f.ay) * k;
    if (f.lead > 0.05) f.facing = face(r.x[0]! - f.ax, r.z[0]! - f.az);
    return false;
  }
  routePoint(r, f.s, pt);
  f.x = pt.x;
  f.z = pt.z;
  f.y = pt.y;
  f.facing = face(pt.tx, pt.tz);
  return f.s >= r.len - 1e-6;
}

/**
 * Walks them back toward where the schedule has them now (`sched`), from the station `from`: by the routes while the schedule is somewhere else (twice at most:
 * it moves), then straight at it when it is in plain reach, and a short blend when they meet. A blend from far off would be a slide: never.
 */
function goBack(f: Fright, folk: Folk, v: Villager, sched: VillagerPose, from: number, now: number, world: CollisionWorld): void {
  const far = Math.hypot(sched.x - f.x, sched.z - f.z);
  if (far <= FRIGHT.blendNear) return startBlend(f, now);
  const goal = sched.station;
  const route = from >= 0 && goal !== from && f.tries < 3 ? folk.nav.route(from, goal) : undefined;
  f.tries++;
  if (route) return setOff(f, route, FRIGHT.back * v.walk, goal, FEAR.back, now);
  f.speed = FRIGHT.back * v.walk * 1.15;
  f.ax = f.x;
  f.az = f.z;
  f.route = undefined;
  f.mode = segmentOk(world, f.x, f.z, f.y, sched.x, sched.z, FOLK_RADIUS) ? FEAR.chase : FEAR.blend;
  f.since = now;
  if (f.mode === FEAR.blend) startBlend(f, now);
}

function startBlend(f: Fright, now: number): void {
  f.mode = FEAR.blend;
  f.since = now;
  f.ax = f.x;
  f.ay = f.y;
  f.az = f.z;
  f.af = f.facing;
  f.route = undefined;
}

/**
 * One frame of somebody's fright: `pose` comes in as the schedule has them and goes out as they are to be drawn. Returns false (and leaves the pose alone) when
 * they are at ease. `who` is their index (their choices are hashed from it and the noise); `now` world seconds, `dt` seconds since the last frame.
 */
export function stepFright(f: Fright, folk: Folk, world: CollisionWorld, who: number, pose: VillagerPose, now: number, dt: number): boolean {
  if (f.mode === FEAR.none) {
    f.fear = Math.max(0, f.fear - dt * 0.8);
    return false;
  }
  const v = folk.roster[who]!;
  const nav = folk.nav;
  switch (f.mode) {
    case FEAR.startle: {
      if (now < f.since + FRIGHT.startle + h01(who, f.noise, 0x52) * FRIGHT.startleJitter) break;
      // the choice: the old cower; children run home; the rest mostly run for a door, some get down where they are. From fire everybody goes (D-132), the old slower.
      const runs = f.fire || v.age === "child" ? true : v.age === "elder" ? false : h01(who, f.noise, 0x53) < 0.68;
      // (off a seat, by the bench's own station: a step out of it, not through it)
      const from = !runs ? -1 : f.seated && f.at >= 0 ? f.at : nearestStation(folk, world, f.x, f.y, f.z);
      let ref = from >= 0 ? refugeFor(folk, v, from, f) : { to: -1, hide: false };
      let route = ref.to >= 0 ? nav.route(from, ref.to) : undefined;
      if (route && f.fire && !passesClear(route, f.sx, f.sz)) {
        // their door is past the flames: the open ground furthest from them instead, if that way is clear
        ref = refugeFor(folk, v, from, f, true);
        route = ref.to >= 0 ? nav.route(from, ref.to) : undefined;
        if (route && !passesClear(route, f.sx, f.sz)) route = undefined;
      }
      const pace = (v.age === "child" ? FRIGHT.runChild : FRIGHT.run) * (f.fire && v.age === "elder" ? FRIGHT.fireElder : 1);
      if (route) setOff(f, route, pace * (0.9 + 0.2 * h01(who, f.noise, 0x54)), ref.to, FEAR.flee, now);
      else {
        f.mode = FEAR.cower;
        f.since = now;
        f.goal = from;
      }
      break;
    }
    case FEAR.flee: {
      if (along(f, dt)) {
        const g = nav.stations[f.goal]!;
        f.mode = g.hidden ? FEAR.hidden : FEAR.cower;
        f.since = now;
      }
      break;
    }
    case FEAR.cower:
    case FEAR.hidden: {
      if (now < f.calmAt) break;
      // quiet long enough: out again. Somebody indoors whom the schedule has indoors anyway simply stays (nobody sees the hand-back).
      if (f.mode === FEAR.hidden && (!pose.visible || pose.station === f.goal)) {
        f.mode = FEAR.none;
        return false;
      }
      const from = f.mode === FEAR.hidden ? f.goal : f.seated && f.at >= 0 ? f.at : nearestStation(folk, world, f.x, f.y, f.z);
      f.seated = false;
      goBack(f, folk, v, pose, from, now, world);
      break;
    }
    case FEAR.back: {
      if (along(f, dt)) goBack(f, folk, v, pose, f.goal, now, world);
      break;
    }
    case FEAR.chase: {
      // walking straight to where the schedule has them (it is coming, or just ahead), until they meet
      const d = Math.hypot(pose.x - f.x, pose.z - f.z);
      if (d < 0.35) startBlend(f, now);
      else if (!segmentOk(world, f.x, f.z, f.y, pose.x, pose.z, FOLK_RADIUS)) startBlend(f, now);
      else {
        const k = Math.min(1, (f.speed * dt) / d);
        f.x += (pose.x - f.x) * k;
        f.z += (pose.z - f.z) * k;
        f.y += (pose.y - f.y) * k;
        f.facing = face(pose.x - f.x, pose.z - f.z);
      }
      break;
    }
    case FEAR.blend:
      break;
  }

  // ---- write the override -----------------------------------------------------------------------------------------------------------------------
  const m = f.mode as Mode;
  if (m === FEAR.none) return false;
  if (m === FEAR.blend) {
    // the hand-back: from where they are drawn into the schedule's own pose (act and all) over a moment
    const k = Math.min(1, (now - f.since) / FRIGHT.blend);
    const e = k * k * (3 - 2 * k);
    f.fear = Math.max(0, f.fear - dt * 0.8);
    if (k >= 1) {
      f.mode = FEAR.none;
      f.x = pose.x;
      f.y = pose.y;
      f.z = pose.z;
      f.facing = pose.facing;
      return false;
    }
    f.x = f.ax + (pose.x - f.ax) * e;
    f.y = f.ay + (pose.y - f.ay) * e;
    f.z = f.az + (pose.z - f.az) * e;
    f.facing = f.af + wrap(pose.facing - f.af) * e;
    pose.x = f.x;
    pose.y = f.y;
    pose.z = f.z;
    pose.facing = f.facing;
    pose.visible = true;
    return true;
  }
  const away = face(f.x - f.sx, f.z - f.sz);
  pose.partner = -1;
  pose.seated = false;
  pose.carry = "none";
  pose.rained = false;
  if (m === FEAR.startle || m === FEAR.cower) {
    // turned from the noise when down (back to it, as people do); looking at it while they start. Somebody on a seat stays on it, hands over the head.
    if (m === FEAR.cower && !f.seated) f.facing += wrap(away - f.facing) * Math.min(1, dt * 3);
    pose.x = f.x;
    pose.y = f.y;
    pose.z = f.z;
    pose.facing = f.facing;
    pose.speed = 0;
    pose.act = m === FEAR.cower && now >= f.since ? "cower" : "idle";
    pose.seated = f.seated;
    pose.visible = true;
    f.fear = Math.min(1, f.fear + dt * 4);
    return true;
  }
  if (m === FEAR.chase) {
    pose.x = f.x;
    pose.y = f.y;
    pose.z = f.z;
    pose.facing = f.facing;
    pose.speed = f.speed;
    pose.act = "walk";
    pose.visible = true;
    f.fear = Math.max(0, f.fear - dt * 0.5);
    return true;
  }
  if (m === FEAR.hidden) {
    pose.x = f.x;
    pose.y = f.y;
    pose.z = f.z;
    pose.speed = 0;
    pose.act = "sleep";
    pose.visible = false;
    pose.station = f.goal;
    f.fear = 1;
    return true;
  }
  // running for the door, or walking back out
  const r = f.route!;
  pose.x = f.x;
  pose.y = f.y;
  pose.z = f.z;
  pose.facing = f.facing;
  pose.speed = f.speed;
  pose.act = "walk";
  pose.station = f.goal;
  pose.visible = f.s > r.hideUntil && f.s < r.hideFrom;
  f.fear = m === FEAR.flee ? Math.min(1, f.fear + dt * 4) : Math.max(0, f.fear - dt * 0.5);
  return true;
}
