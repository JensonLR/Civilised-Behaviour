import {
  BUTTON, FLAG, SCENARIO, WEAPON, createWeather, hashFloat, isNpcKey, npcKey, weatherAt, yawToWire,
  type CollisionWorld, type MoveCommand, type PlayerStateType,
} from "@cb/shared";
// New shared modules are imported by path until the integrator adds their `export *` lines to the shared index (then switch these to "@cb/shared").
import { BEAST, NAV, NPC_SIDE, hash3 } from "@cb/shared";
import type {
  BrainFn, BrainId, CastApi, CastCount, CastOrder, NavApi, NavPath, NpcBody, NpcBrain, NpcSenses, NpcSide, NpcSpec, PlayersView,
} from "@cb/shared";
import { NavQuery, buildNavGrid, type NavOptions } from "@cb/shared";
import { npcBrainNew, npcHeardShot, npcThink, type NpcBrainState } from "@cb/shared";
import { moraleBand, type MoraleBand } from "@cb/shared";

/**
 * The Cast (D-034): ONE server system that runs every NPC row (garrison, rivals, deserters, hostages, hired hands) through the same step and combat
 * path a player takes. It replaces the old per-scenario NPC loop. Per tick and per living row it builds `NpcSenses` (the nearest HOSTILE person it can
 * see, by side, war and alert; its allies; fire it is under), hands out ATTACK TOKENS (two shooters per target at once, which is what lets a lone
 * player live a while and a party still win), lets at most `NAV.queriesPerTick` brains plan a path (round robin), calls the brain, and steps the row.
 * Scenarios steer people only through `order(group, ...)`; they read people only through `count` and `row`. Brains plug in through `host.brains`.
 */

export interface CastHost {
  /** The real party (no NPC rows); `get` finds any row, NPC rows included. */
  players: PlayersView;
  /** Creates the NPC row keyed `npcKey(spec.id)`; false when at NPC_CAP or already there. */
  spawnNpc(spec: NpcSpec): boolean;
  removeNpc(key: string): void;
  /** D-073: row `key` cried out in panic (cosmetic: the room broadcasts it). Optional. */
  cry?(key: string): void;
  /** stepCharacter + Combat.onFrame for that row. The command object is reused by the caller of this: copy it if you keep it. */
  stepNpc(key: string, cmd: MoveCommand): void;
  world(): CollisionWorld;
  worldMs(): number;
  seed: number;
  /** The Ward's fear of the party, 0..100 (the garrison's morale reads it). */
  fear(): number;
  brains: Partial<Record<BrainId, BrainFn>>;
  /** Navigation options for a world (Kessar closes the gorge and prunes the courtyard: `kessarNavOptions`). */
  navOptions?(world: CollisionWorld): NavOptions;
  sendTo?(sid: string, type: string, msg: unknown): void;
  /** D-094: a beast's horns struck `target` (a person within its reach): the room deals the blow (thrown, a hard wound) as from `key`. Optional: test hosts need not. */
  gore?(key: string, target: string): void;
}

interface Group { alert: boolean; standDown: boolean; holdFire: boolean; attack: NpcSide | "any" | undefined }
interface Rec {
  spec: NpcSpec;
  key: string;
  side: NpcSide;
  group: string;
  brain: NpcBrainState;
  fn: BrainFn | undefined;
  civil: boolean;
  /** D-094: a beast (civil too: it has no enemies and bolts from reports; it also shies from people, grazes, and charges whoever wounds it). */
  beast: boolean;
  /** The beast's last shooter, its charge (target, until), its next strike, and where it is grazing to. */
  lastShooter: string;
  chargeTarget: string;
  chargeUntil: number;
  hornAt: number;
  gx: number;
  gz: number;
  grazeUntil: number;
  gone: boolean;
  wasDown: boolean;
  lastHp: number;
  lastWounds: number;
  lastMissing: number;
  token: boolean;
  tokenHeld: boolean;
  tokenTarget: string;
  /** Who a `follow` order named (an NPC id or a session id); "" = the nearest human, for followers. */
  follow: string;
  fleeUntil: number;
  fleeX: number;
  fleeZ: number;
  /** D-073: the morale band after the last think (a soldier whose nerve goes cries out once), and when this row last cried out. */
  lastBand: MoraleBand;
  lastCry: number;
  // per-tick scratch
  tx: string;
  td: number;
  hasEnemy: boolean;
  ex: number;
  ez: number;
  ev: number;
  earmed: boolean;
  allies: number;
  alliesDown: number;
}

/** A nav view whose `path` is budgeted per tick: a brain whose request is refused simply asks again on a later tick. */
class BudgetedNav implements NavApi {
  budget = 0;
  constructor(public q: NavQuery) {}
  open(x: number, z: number): boolean { return this.q.open(x, z); }
  los(ax: number, az: number, bx: number, bz: number): boolean { return this.q.los(ax, az, bx, bz); }
  path(sx: number, sz: number, tx: number, tz: number, out: NavPath): boolean {
    if (this.budget <= 0) return false;
    this.budget--;
    return this.q.path(sx, sz, tx, tz, out);
  }
  cover(fx: number, fz: number, thx: number, thz: number, radius: number, out: { x: number; z: number }): boolean { return this.q.cover(fx, fz, thx, thz, radius, out); }
  flank(fx: number, fz: number, tx: number, tz: number, side: 1 | -1, dist: number, out: { x: number; z: number }): boolean { return this.q.flank(fx, fz, tx, tz, side, dist, out); }
  nearestOpen(x: number, z: number, out: { x: number; z: number }): boolean { return this.q.nearestOpen(x, z, out); }
}

export const CAST = {
  sightClear: 28, sightWet: 16, allyRange: 15, tokens: 2, witnessShock: 16, goreShock: 12, crySpacingS: 6, hurtShock: 0.35, noiseShock: 4, underFireSeconds: 4,
  civilFleeSeconds: 6, civilFleeRange: 22, followRange: 40,
} as const;

const sideKey = (a: NpcSide, b: NpcSide): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const popcount = (n: number): number => { let c = 0; for (let v = n & 0xff; v; v &= v - 1) c++; return c; };

export class Cast implements CastApi {
  private recs: Rec[] = [];
  private byKey = new Map<string, Rec>();
  private groups = new Map<string, Group>();
  private routes = new Map<string, { x: number; z: number }[]>();
  private war = new Set<string>();
  private worldRef: CollisionWorld | undefined;
  private navQ: NavQuery | undefined;

  /** D-052: open ground on the nav grid (false before a world is set). */
  /** D-060: a clear line on the nav grid (true before a world is set: nothing to block it). */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    return this.navQ ? this.navQ.los(ax, az, bx, bz) : true;
  }

  openAt(x: number, z: number): boolean {
    return this.navQ?.open(x, z) ?? false;
  }
  private readonly bnav = new BudgetedNav(undefined as unknown as NavQuery);
  private rr = 0;
  private rain = 0;
  private rainAt = -Infinity;
  private readonly wx = createWeather();
  // per-tick scratch (the tick allocates nothing)
  private humans: PlayerStateType[] = [];
  private humanIds: string[] = [];
  private readonly cmd: MoveCommand = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };
  private readonly body: NpcBody = { x: 0, z: 0, facing: 0, health: 100, weapon: 0, ammo: 0, flags: 0, vx: 0, vz: 0 };
  private readonly enemy = { id: "", x: 0, z: 0, armed: false, moving: 0, down: false };
  private readonly leader = { id: "", x: 0, z: 0 };
  private readonly senses: NpcSenses = { enemy: undefined, allies: 0, alliesDown: 0, alert: false, standDown: false, fear: 0, token: false, underFire: 0, leader: undefined, now: 0, rain: 0, nav: this.bnav };
  private readonly tokTarget: string[] = [];
  private readonly tokCount: number[] = [];
  private tokN = 0;
  private readonly collect = (p: PlayerStateType, id: string): void => {
    if (isNpcKey(id) || !p.connected || (p.flags & FLAG.DOWNED) !== 0) return;
    this.humans.push(p);
    this.humanIds.push(id);
  };
  /** Counters for tests and the debug overlay. */
  readonly stats = { ticks: 0, paths: 0, refused: 0, tokenGrants: 0, shots: 0 };

  constructor(private readonly host: CastHost) {}

  // ---- CastApi ---------------------------------------------------------------------------------------------------------------------------

  spawn(specs: readonly NpcSpec[]): number {
    this.ensureNav();
    let n = 0;
    for (const spec of specs) {
      if (this.byKey.has(npcKey(spec.id)) || !this.host.spawnNpc(spec)) continue;
      const side = spec.side ?? NPC_SIDE[spec.role] ?? "neutral";
      const beast = spec.brain === "beast";
      const civil = spec.brain === "civil" || beast;
      const rec: Rec = {
        spec, key: npcKey(spec.id), side, group: spec.group, brain: npcBrainNew(spec), civil, beast,
        lastShooter: "", chargeTarget: "", chargeUntil: -1, hornAt: -1, gx: spec.post.x, gz: spec.post.z, grazeUntil: -1,
        fn: civil ? undefined : this.host.brains[spec.brain] ?? this.host.brains.garrison ?? npcThink,
        gone: false, wasDown: false, lastHp: 100, lastWounds: 0, lastMissing: 0, token: false, tokenHeld: false, tokenTarget: "", follow: "", fleeUntil: -1, fleeX: 0, fleeZ: 0, lastBand: "steady", lastCry: -Infinity,
        tx: "", td: Infinity, hasEnemy: false, ex: 0, ez: 0, ev: 0, earmed: false, allies: 0, alliesDown: 0,
      };
      if (civil) rec.brain.mode = "civil";
      const row = this.host.players.get(rec.key);
      if (row) {
        rec.lastHp = row.health;
        rec.lastWounds = row.wounds;
        rec.lastMissing = row.missing;
      }
      this.recs.push(rec);
      this.byKey.set(rec.key, rec);
      if (!this.groups.has(rec.group)) this.groups.set(rec.group, { alert: false, standDown: false, holdFire: false, attack: undefined });
      n++;
    }
    return n;
  }

  order(group: string, o: CastOrder): void {
    const g = this.groupOf(group);
    const now = this.host.worldMs() / 1000;
    for (const r of this.recs) {
      if (r.group !== group || r.gone) continue;
      const b = r.brain;
      switch (o.o) {
        case "post":
          b.fled = false;
          b.mode = "post";
          b.since = now;
          b.px = r.spec.post.x;
          b.pz = r.spec.post.z;
          b.target = "";
          b.path.n = 0;
          r.follow = "";
          break;
        case "alert":
          break;
        case "stand_down":
          b.mode = "stand_down";
          break;
        case "hold_fire":
          break;
        case "flee":
          b.fled = true;
          b.fledAt = now;
          b.mode = "flee";
          b.since = now;
          b.morale.v = Math.min(b.morale.v, 15);
          if (r.civil) {
            r.fleeUntil = now + CAST.civilFleeSeconds;
          }
          break;
        case "march": {
          const pts = this.routes.get(o.route);
          if (!pts || pts.length === 0) break;
          const n = Math.min(pts.length, NAV.pathMax);
          for (let i = 0; i < n; i++) {
            b.path.x[i] = pts[i]!.x;
            b.path.z[i] = pts[i]!.z;
          }
          b.path.n = n;
          b.path.complete = n === pts.length;
          b.route = 0;
          if (o.join === true) {
            const row = this.host.players.get(r.key);
            if (row) {
              let best = Infinity;
              for (let i = 0; i < n; i++) {
                const d = Math.hypot(pts[i]!.x - row.x, pts[i]!.z - row.z);
                if (d < best) { best = d; b.route = i; }
              }
            }
          }
          b.fled = false;
          b.mode = "march";
          b.since = now;
          break;
        }
        case "guard": {
          const spread = Number.isFinite(o.r) ? Math.max(0, o.r) : 0;
          b.px = o.x + (hashFloat(r.spec.lookSeed, 0x6a, 1) - 0.5) * spread;
          b.pz = o.z + (hashFloat(r.spec.lookSeed, 0x6a, 2) - 0.5) * spread;
          if (this.navQ && this.navQ.nearestOpen(b.px, b.pz, this.snap)) {
            b.px = this.snap.x;
            b.pz = this.snap.z;
          }
          b.mode = "guard";
          b.since = now;
          b.path.n = 0;
          break;
        }
        case "follow":
          r.follow = typeof o.target === "string" ? o.target : "";
          b.mode = "follow";
          b.since = now;
          b.path.n = 0;
          b.fled = false;
          r.fleeUntil = -1;
          break;
        case "attack":
          break;
      }
    }
    // group flags (after the rows, so a `post` order clears what a `stand_down` set)
    switch (o.o) {
      case "post": g.alert = false; g.standDown = false; g.holdFire = false; g.attack = undefined; break;
      case "alert": g.alert = true; g.standDown = false; break;
      case "stand_down": g.standDown = true; g.alert = false; g.attack = undefined; break;
      case "hold_fire": g.holdFire = true; break;
      case "attack": g.attack = o.side ?? "any"; g.alert = true; g.standDown = false; g.holdFire = false; break;
      default: break;
    }
  }

  setWar(a: NpcSide, b: NpcSide, on: boolean): void {
    if (a === b) return;
    const k = sideKey(a, b);
    if (on) this.war.add(k);
    else this.war.delete(k);
  }

  atWar(roleA: number, roleB: number): boolean {
    const a = NPC_SIDE[roleA] ?? (roleA === 0 ? "party" : "neutral");
    const b = NPC_SIDE[roleB] ?? (roleB === 0 ? "party" : "neutral");
    return this.sidesAtWar(a, b);
  }

  count(group: string): CastCount {
    let alive = 0, routed = 0, down = 0, total = 0;
    for (const r of this.recs) {
      if (r.group !== group) continue;
      total++;
      const row = r.gone ? undefined : this.host.players.get(r.key);
      if (!row || (row.flags & FLAG.DOWNED) !== 0) down++;
      else if (r.brain.mode === "flee") routed++;
      else alive++;
    }
    return { alive, routed, down, total };
  }

  row(id: string): PlayerStateType | undefined {
    return this.host.players.get(npcKey(id));
  }

  /** The brain of a spawned row by NPC id (the hired hands' orders are written onto it; see Followers). */
  brainOf(id: string): NpcBrain | undefined {
    return this.byKey.get(npcKey(id))?.brain;
  }

  /**
   * Would a bullet from the row `shooter` (an NPC key) hurt `target` (a session id or NPC key)? Combat asks this so rounds pass through people the
   * shooter's side is not fighting: a sentry's shot does not kill the Syndicate man behind the player, a hand's shot does not hit his employer.
   * A hand ordered to attack a particular target is always at war with it (the order is the declaration).
   */
  hostileTo(shooter: string, target: string): boolean {
    const r = this.byKey.get(shooter);
    if (!r || r.gone) return false;
    const it = r.brain.intent;
    if (it !== undefined && it.k === "attack" && (it.target === target || npcKey(it.target) === target)) return true;
    const g = this.groupOf(r.group);
    const tr = this.byKey.get(target);
    if (tr === undefined) return isNpcKey(target) ? false : this.hostile(r, g, "party", false);
    return this.hostile(r, g, tr.side, this.groupOf(tr.group).alert);
  }

  defineRoute(name: string, pts: readonly { x: number; z: number }[]): void {
    this.routes.set(name, pts.map((p) => ({ x: p.x, z: p.z })));
  }

  /** A route defined by a scenario (the wagon's horse walks the same line). */
  routePoints(name: string): readonly { x: number; z: number }[] | undefined {
    return this.routes.get(name);
  }

  /**
   * D-041: `shooter`'s round hit the row `target`, or passed close by it. A soldier with nobody in sight goes and looks where the shot came from (npcHeardShot) and is
   * under fire meanwhile. Rows on the shooter's own side, civilians and hired hands do not: a hand's orders are its sight.
   */
  shotFrom(target: string, shooter: string): void {
    const r = this.byKey.get(target);
    if (r?.beast && !r.gone) {
      // D-094: a beast remembers who shot at it (a wound turns it on them: `sense`) and bolts from the report
      const from = this.host.players.get(shooter);
      if (!from || isNpcKey(shooter)) return;
      const now = this.host.worldMs() / 1000;
      r.lastShooter = shooter;
      if (now >= r.chargeUntil) {
        r.fleeUntil = now + CAST.civilFleeSeconds;
        r.fleeX = from.x;
        r.fleeZ = from.z;
      }
      return;
    }
    if (!r || r.gone || r.civil || r.spec.brain !== "garrison") return;
    const from = this.host.players.get(shooter);
    if (!from || this.byKey.get(shooter)?.side === r.side) return;
    const now = this.host.worldMs() / 1000;
    r.brain.hurtAt = Math.max(r.brain.hurtAt, now);
    npcHeardShot(r.brain, from.x, from.z, now);
  }

  /** A report carried `radius` metres from (x, z), fired by `src` (a session id or an NPC key): nearby people start; civilians bolt. */
  noise(x: number, z: number, radius: number, src: string): void {
    if (!Number.isFinite(x + z + radius) || radius <= 0) return;
    const now = this.host.worldMs() / 1000;
    const srcRec = this.byKey.get(src);
    for (const r of this.recs) {
      if (r.gone || r.key === src) continue;
      const row = this.host.players.get(r.key);
      if (!row || (row.flags & FLAG.DOWNED) !== 0) continue;
      const d = Math.hypot(row.x - x, row.z - z);
      if (r.civil) {
        if (r.beast && now < r.chargeUntil) continue; // (a charging beast does not stop for a bang)
        if (d <= Math.min(radius, CAST.civilFleeRange)) {
          if (r.fleeUntil < now && !r.beast) this.cry(r, now); // (D-073: a civilian who starts to run cries out)
          r.fleeUntil = now + CAST.civilFleeSeconds;
          r.fleeX = x;
          r.fleeZ = z;
        }
        continue;
      }
      if (srcRec && srcRec.side === r.side) continue; // friendly fire is not a surprise
      if (d <= radius * 0.5) r.brain.morale.shock = Math.min(60, r.brain.morale.shock + CAST.noiseShock);
    }
  }

  /**
   * D-103: row `key` is alight. A civilian (or a beast) bolts, crying out, away from (fromX, fromZ); a soldier's nerve goes (shock to the top: the morale step breaks him and
   * the brain runs), and he screams too. A burning man running is how a grass fire spreads through a crowd.
   */
  onFire(key: string, fromX: number, fromZ: number): void {
    const r = this.byKey.get(key);
    if (!r || r.gone) return;
    const now = this.host.worldMs() / 1000;
    if (r.civil) {
      if (r.fleeUntil < now && !r.beast) this.cry(r, now);
      r.fleeUntil = now + CAST.civilFleeSeconds;
      r.fleeX = fromX;
      r.fleeZ = fromZ;
      return;
    }
    r.brain.morale.shock = 60;
    r.brain.hurtAt = now;
    this.cry(r, now);
  }

  despawn(group?: string): void {
    const keep: Rec[] = [];
    for (const r of this.recs) {
      if (group === undefined || r.group === group) {
        if (!r.gone) this.host.removeNpc(r.key);
        this.byKey.delete(r.key);
      } else keep.push(r);
    }
    this.recs = keep;
    if (group === undefined) {
      this.groups.clear();
      this.war.clear();
    }
  }

  despawnOne(id: string): void {
    const key = npcKey(id);
    const r = this.byKey.get(key);
    if (!r) return;
    if (!r.gone) this.host.removeNpc(key);
    this.byKey.delete(key);
    this.recs = this.recs.filter((x) => x !== r);
  }

  setWorld(w: CollisionWorld): void {
    this.worldRef = w;
    this.navQ = new NavQuery(buildNavGrid(w, this.host.navOptions?.(w) ?? {}));
    this.bnav.q = this.navQ;
    // everyone replans: a collapsed bridge is a different map
    for (const r of this.recs) {
      r.brain.path.n = 0;
      r.brain.route = 0;
      r.brain.pathAt = -1e9;
    }
  }

  // ---- the tick --------------------------------------------------------------------------------------------------------------------------

  private readonly snap = { x: 0, z: 0 };

  tick(dt: number): void {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.5) : 0;
    if (this.recs.length === 0) return;
    this.ensureNav();
    this.stats.ticks++;
    const nowMs = this.host.worldMs();
    const now = nowMs / 1000;
    if (now - this.rainAt >= 1) {
      this.rainAt = now;
      weatherAt(this.host.seed, nowMs, this.wx);
      this.rain = this.wx.rain;
    }
    const sight = this.rain >= SCENARIO.wetRain ? CAST.sightWet : CAST.sightClear;
    this.humans.length = 0;
    this.humanIds.length = 0;
    this.host.players.forEach(this.collect);
    const nav = this.navQ!;
    this.bnav.budget = NAV.queriesPerTick;

    // pass 1: who each row sees, what it has been through (witnessed falls, wounds), its allies
    const n = this.recs.length;
    for (let i = 0; i < n; i++) this.sense(this.recs[i]!, nav, sight, now);

    // pass 2: attack tokens
    this.grantTokens(n);

    // pass 3: think and step, round robin so the path budget never starves the same man
    const fear = this.host.fear();
    for (let k = 0; k < n; k++) {
      const r = this.recs[(this.rr + k) % n]!;
      if (r.gone) continue;
      const row = this.host.players.get(r.key);
      if (!row) continue;
      this.think(r, row, step, now, fear);
      if (!r.civil) {
        const band = moraleBand(r.brain.morale.v);
        if (band === "broken" && r.lastBand !== "broken") this.cry(r, now);
        r.lastBand = band;
      }
    }
    this.rr = (this.rr + 1) % n;
  }

  private ensureNav(): void {
    const w = this.host.world();
    if (w !== this.worldRef || !this.navQ) this.setWorld(w);
  }

  private groupOf(name: string): Group {
    let g = this.groups.get(name);
    if (!g) {
      g = { alert: false, standDown: false, holdFire: false, attack: undefined };
      this.groups.set(name, g);
    }
    return g;
  }

  private sidesAtWar(a: NpcSide, b: NpcSide): boolean {
    if (a === b || a === "neutral" || b === "neutral") return false;
    if (a === "outlaw" || b === "outlaw") return true;
    return this.war.has(sideKey(a, b));
  }

  /** Is `t` (a side, and the alert state of its group) someone `r` fights? */
  private hostile(r: Rec, g: Group, ts: NpcSide, tAlert: boolean): boolean {
    const rs = r.side;
    if (rs === ts || rs === "neutral" || ts === "neutral") return false;
    if (g.attack !== undefined && (g.attack === "any" || g.attack === ts)) return true;
    // D-041: outlaws fight every other NPC side on sight, but the PARTY only once their camp is up. The playtest found the Orchard's lookout shooting a walker at 29 m before
    // the contract's own rules (a carouser's challenge at 5 m, the lookout's eyes at 12 m) had said a word, which made the quiet and the ransom endings unreachable.
    if (ts === "outlaw" && rs === "party") return tAlert; // (the party's hired hands answer fire, they do not start it)
    if (rs === "outlaw" && ts === "party") return g.alert;
    if (rs === "outlaw" || ts === "outlaw") return true;
    if (this.war.has(sideKey(rs, ts))) return true;
    if (ts === "party" && (rs === "ward" || rs === "rival")) return g.alert; // soldiers act on the party only once provoked
    if (rs === "party" && (ts === "ward" || ts === "rival")) return tAlert; // the party's hired hands answer fire, they do not start it
    return false;
  }

  private sense(r: Rec, nav: NavQuery, sight: number, now: number): void {
    r.hasEnemy = false;
    r.tx = "";
    r.td = Infinity;
    r.allies = 0;
    r.alliesDown = 0;
    if (r.gone) return;
    const row = this.host.players.get(r.key);
    if (!row) {
      r.gone = true;
      return;
    }
    const down = (row.flags & FLAG.DOWNED) !== 0;
    // wounds and witnessed falls feed morale
    if (r.beast && !down && row.health < r.lastHp && r.lastShooter !== "") {
      // D-094: wounded, it turns on whoever shot it
      r.chargeTarget = r.lastShooter;
      r.chargeUntil = now + BEAST.chargeSeconds;
      r.fleeUntil = -1;
    }
    if (row.health < r.lastHp || row.wounds !== r.lastWounds) {
      r.brain.hurtAt = now;
      r.brain.morale.shock = Math.min(60, r.brain.morale.shock + Math.max(0, r.lastHp - row.health) * CAST.hurtShock);
    }
    if (popcount(row.missing) > popcount(r.lastMissing)) {
      r.brain.morale.shock = Math.min(60, r.brain.morale.shock + CAST.witnessShock);
      this.witnessGore(r, row);
    }
    r.lastHp = row.health;
    r.lastWounds = row.wounds;
    r.lastMissing = row.missing;
    if (down && !r.wasDown) this.witnessFall(r, row);
    r.wasDown = down;
    if (down || r.civil) return;
    const g = this.groupOf(r.group);
    let bestD2 = Infinity;
    const s2 = sight * sight;
    // humans (side party)
    const humansHostile = this.hostile(r, g, "party", false);
    for (let i = 0; i < this.humans.length && humansHostile; i++) {
      const p = this.humans[i]!;
      const d2 = (p.x - row.x) ** 2 + (p.z - row.z) ** 2;
      if (d2 >= bestD2 || d2 > s2) continue;
      if (!nav.los(row.x, row.z, p.x, p.z)) continue;
      bestD2 = d2;
      r.tx = this.humanIds[i]!;
      r.ex = p.x; r.ez = p.z; r.ev = Math.hypot(p.vx, p.vz); r.earmed = p.weapon !== 0;
    }
    // other NPC rows, and allies / fallen allies
    for (let j = 0; j < this.recs.length; j++) {
      const o = this.recs[j]!;
      if (o === r || o.gone) continue;
      const orow = this.host.players.get(o.key);
      if (!orow) continue;
      const odown = (orow.flags & FLAG.DOWNED) !== 0;
      const d2 = (orow.x - row.x) ** 2 + (orow.z - row.z) ** 2;
      if (o.side === r.side) {
        if (d2 <= CAST.allyRange * CAST.allyRange) {
          if (odown) r.alliesDown++;
          else if (o.brain.mode !== "flee") r.allies++;
        }
        continue;
      }
      if (odown || d2 >= bestD2 || d2 > s2) continue;
      if (!this.hostile(r, g, o.side, this.groupOf(o.group).alert)) continue;
      if (!nav.los(row.x, row.z, orow.x, orow.z)) continue;
      bestD2 = d2;
      r.tx = o.key;
      r.ex = orow.x; r.ez = orow.z; r.ev = Math.hypot(orow.vx, orow.vz); r.earmed = orow.weapon !== 0;
    }
    // A hand ordered to attack someone attacks THAT person (in or out of sight: the order is the sight).
    const it = r.brain.intent;
    if (it !== undefined && it.k === "attack") {
      const o = this.byKey.get(npcKey(it.target));
      const orow = o && !o.gone ? this.host.players.get(o.key) : undefined;
      if (o && orow && (orow.flags & FLAG.DOWNED) === 0 && o.side !== r.side) {
        bestD2 = (orow.x - row.x) ** 2 + (orow.z - row.z) ** 2;
        r.tx = o.key;
        r.ex = orow.x; r.ez = orow.z; r.ev = Math.hypot(orow.vx, orow.vz); r.earmed = orow.weapon !== 0;
      }
    }
    if (r.tx !== "") {
      r.hasEnemy = true;
      r.td = Math.sqrt(bestD2);
    }
  }

  /**
   * D-064: a row lost a limb in plain view. Its friends nearby are shaken on top of anything a fall does (an arm in the road breaks a line faster than a man lying down), and every
   * civilian near enough to see it bolts, whether or not there was a report.
   */
  private witnessGore(victim: Rec, row: PlayerStateType): void {
    const now = this.host.worldMs() / 1000;
    for (const o of this.recs) {
      if (o === victim || o.gone) continue;
      const orow = this.host.players.get(o.key);
      if (!orow || (orow.flags & FLAG.DOWNED) !== 0) continue;
      const d = Math.hypot(orow.x - row.x, orow.z - row.z);
      if (o.civil) {
        if (d <= CAST.civilFleeRange) {
          if (o.fleeUntil < now) this.cry(o, now);
          o.fleeUntil = now + CAST.civilFleeSeconds;
          o.fleeX = row.x;
          o.fleeZ = row.z;
        }
      } else if (o.side === victim.side && d <= CAST.allyRange) o.brain.morale.shock = Math.min(60, o.brain.morale.shock + CAST.goreShock);
    }
  }

  /** D-073: a cry of panic from `r` (at most one per `crySpacingS` per row: a crowd bolting is a few voices, not a choir). */
  private cry(r: Rec, now: number): void {
    if (now - r.lastCry < CAST.crySpacingS) return;
    r.lastCry = now;
    this.host.cry?.(r.key);
  }

  /** A row went down: its friends nearby are shaken. */
  private witnessFall(fallen: Rec, row: PlayerStateType): void {
    for (const o of this.recs) {
      if (o === fallen || o.gone || o.side !== fallen.side) continue;
      const orow = this.host.players.get(o.key);
      if (!orow || (orow.flags & FLAG.DOWNED) !== 0) continue;
      if (Math.hypot(orow.x - row.x, orow.z - row.z) <= CAST.allyRange) o.brain.morale.shock = Math.min(60, o.brain.morale.shock + CAST.witnessShock);
    }
  }

  private claim(target: string): boolean {
    for (let k = 0; k < this.tokN; k++) {
      if (this.tokTarget[k] === target) {
        if (this.tokCount[k]! >= CAST.tokens) return false;
        this.tokCount[k]!++;
        return true;
      }
    }
    this.tokTarget[this.tokN] = target;
    this.tokCount[this.tokN] = 1;
    this.tokN++;
    return true;
  }

  /** Can this row actually shoot right now? (A rifle with an empty chamber is no use as a shooter; a routed man is no use at all.) */
  private canShoot(r: Rec): boolean {
    if (!r.hasEnemy || r.brain.mode === "flee" || r.brain.mode === "stand_down") return false;
    const row = this.host.players.get(r.key);
    if (!row) return false;
    const w = r.spec.weapon;
    return row.ammo > 0 || !(w === WEAPON.PISTOL || w === WEAPON.RIFLE || w === WEAPON.BLUNDERBUSS);
  }

  /** At most two shooters per target. Holders keep their token while they can still fire; the rest go nearest first. */
  private grantTokens(n: number): void {
    this.tokN = 0;
    const tried = this.tried;
    tried.length = n;
    for (let i = 0; i < n; i++) {
      this.recs[i]!.token = false;
      tried[i] = false;
    }
    for (let i = 0; i < n; i++) {
      const r = this.recs[i]!;
      if (!r.tokenHeld || r.tokenTarget !== r.tx || !this.canShoot(r)) continue;
      if (this.claim(r.tx)) {
        r.token = true;
        tried[i] = true;
      }
    }
    for (;;) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const r = this.recs[i]!;
        if (tried[i] || !this.canShoot(r)) continue;
        if (r.td < bestD) {
          bestD = r.td;
          best = i;
        }
      }
      if (best < 0) break;
      tried[best] = true;
      const r = this.recs[best]!;
      if (this.claim(r.tx)) {
        r.token = true;
        this.stats.tokenGrants++;
      }
    }
    for (let i = 0; i < n; i++) {
      const r = this.recs[i]!;
      r.tokenHeld = r.token;
      r.tokenTarget = r.token ? r.tx : "";
    }
  }
  private readonly tried: boolean[] = [];

  private think(r: Rec, row: PlayerStateType, dt: number, now: number, fear: number): void {
    const g = this.groupOf(r.group);
    const me = this.body;
    me.x = row.x; me.z = row.z; me.facing = row.facing; me.health = row.health; me.weapon = row.weapon; me.ammo = row.ammo; me.flags = row.flags; me.vx = row.vx; me.vz = row.vz;
    const sn = this.senses;
    sn.now = now;
    sn.rain = this.rain;
    sn.nav = this.bnav;
    sn.standDown = g.standDown;
    sn.alert = g.alert || r.hasEnemy || (g.attack !== undefined);
    sn.fear = r.side === "ward" ? fear : 10;
    sn.allies = r.allies;
    sn.alliesDown = r.alliesDown;
    sn.token = r.token;
    sn.underFire = Math.max(0, Math.min(1, 1 - (now - r.brain.hurtAt) / CAST.underFireSeconds));
    if (r.hasEnemy) {
      const e = this.enemy;
      e.id = r.tx; e.x = r.ex; e.z = r.ez; e.armed = r.earmed; e.moving = r.ev; e.down = false;
      sn.enemy = e;
    } else sn.enemy = undefined;
    sn.leader = this.leaderOf(r, row);

    if (r.beast) this.beastThink(r, row, now);
    else if (r.civil) this.civilThink(r, row, sn, dt, now);
    else (r.fn ?? npcThink)(r.brain, me, sn, dt, this.cmd);
    if (g.holdFire) this.cmd.buttons &= ~(BUTTON.FIRE | BUTTON.MELEE | BUTTON.THROW);
    if ((this.cmd.buttons & (BUTTON.FIRE)) !== 0) this.stats.shots++;
    this.host.stepNpc(r.key, this.cmd);
  }

  /** The person a `follow` brain keeps near: the one named by the order, else the nearest standing human. */
  private leaderOf(r: Rec, row: PlayerStateType): NpcSenses["leader"] {
    const l = this.leader;
    if (r.follow !== "") {
      const t = this.host.players.get(r.follow) ?? this.host.players.get(npcKey(r.follow));
      if (!t || (t.flags & FLAG.DOWNED) !== 0) return undefined;
      l.id = r.follow; l.x = t.x; l.z = t.z;
      return l;
    }
    if (r.spec.brain !== "follower" && r.brain.mode !== "follow") return undefined;
    let best = CAST.followRange * CAST.followRange;
    let found = false;
    for (let i = 0; i < this.humans.length; i++) {
      const p = this.humans[i]!;
      const d2 = (p.x - row.x) ** 2 + (p.z - row.z) ** 2;
      if (d2 < best) { best = d2; l.id = this.humanIds[i]!; l.x = p.x; l.z = p.z; found = true; }
    }
    return found ? l : undefined;
  }

  /** Hostages and drivers: stand there; bolt from gunfire; follow a rescuer once told to. They never fight. */
  private civilThink(r: Rec, row: PlayerStateType, sn: NpcSenses, dt: number, now: number): void {
    const out = this.cmd;
    out.moveF = 0; out.moveR = 0; out.buttons = 0;
    out.yaw = yawToWire(Number.isFinite(row.facing) ? row.facing : 0);
    out.aimYaw = out.yaw; out.aimElev = 0; out.weapon = 0;
    if ((row.flags & FLAG.DOWNED) !== 0) return;
    if (now < r.fleeUntil || sn.underFire > 0.2) {
      // away from the report (or from whoever is nearest when hit)
      let ax = r.fleeX, az = r.fleeZ;
      if (sn.underFire > 0.2 && this.humans.length > 0) {
        let bd = Infinity;
        for (const p of this.humans) {
          const d = Math.hypot(p.x - row.x, p.z - row.z);
          if (d < bd) { bd = d; ax = p.x; az = p.z; }
        }
      }
      out.yaw = yawToWire(Math.atan2(ax - row.x, az - row.z)); // heading (0 = -Z) away from the point (ax, az)
      out.aimYaw = out.yaw;
      out.moveF = 127;
      out.buttons = BUTTON.SPRINT;
      return;
    }
    if (r.brain.mode === "follow" && sn.leader !== undefined) (r.fn ?? npcThink)(r.brain, this.body, sn, dt, out);
  }

  /**
   * D-094: a beast. Down, it lies still. Charging (wounded by someone), it runs at them and strikes once in reach, then bolts. Bolting (a report close by), it runs from
   * the bang. Otherwise it walks away from anyone nearer than `BEAST.shyR` (trots inside `startleR`), pushed by every one of them at once, which is what lets a party
   * DRIVE it: come at it from the side you want it to leave by. With nobody near it grazes, a few slow steps at a time about where it stands. Deterministic per tick.
   */
  private beastThink(r: Rec, row: PlayerStateType, now: number): void {
    const out = this.cmd;
    out.moveF = 0; out.moveR = 0; out.buttons = 0;
    out.yaw = yawToWire(Number.isFinite(row.facing) ? row.facing : 0);
    out.aimYaw = out.yaw; out.aimElev = 0; out.weapon = 0;
    if ((row.flags & FLAG.DOWNED) !== 0) return;
    const toward = (x: number, z: number): number => yawToWire(Math.atan2(row.x - x, row.z - z));   // heading (0 = -Z) toward (x, z)
    if (now < r.chargeUntil) {
      const t = this.host.players.get(r.chargeTarget);
      if (t && t.connected && (t.flags & FLAG.DOWNED) === 0) {
        out.yaw = toward(t.x, t.z);
        out.aimYaw = out.yaw;
        out.moveF = 127;
        out.buttons = BUTTON.SPRINT;
        if (Math.hypot(t.x - row.x, t.z - row.z) <= BEAST.hornReach && now >= r.hornAt) {
          r.hornAt = now + BEAST.hornCooldown;
          this.host.gore?.(r.key, r.chargeTarget);
          // struck: it has made its point, and goes
          r.chargeUntil = -1;
          r.fleeUntil = now + CAST.civilFleeSeconds;
          r.fleeX = t.x;
          r.fleeZ = t.z;
        }
        return;
      }
      r.chargeUntil = -1;
    }
    if (now < r.fleeUntil) {
      out.yaw = yawToWire(Math.atan2(r.fleeX - row.x, r.fleeZ - row.z));   // away from the report
      out.aimYaw = out.yaw;
      out.moveF = 127;
      out.buttons = BUTTON.SPRINT;
      return;
    }
    // shy: walk away from everybody near, the nearer the harder
    let px = 0, pz = 0, nearest = Infinity;
    for (const p of this.humans) {
      const dx = row.x - p.x, dz = row.z - p.z, d = Math.hypot(dx, dz);
      if (d >= BEAST.shyR || d < 1e-3) continue;
      const w = (BEAST.shyR - d) / BEAST.shyR;
      px += (dx / d) * w;
      pz += (dz / d) * w;
      if (d < nearest) nearest = d;
    }
    if (px * px + pz * pz > 1e-6) {
      // along the push, but it jinks: a new angle up to ~30 degrees either side every two seconds, so a party driving it has to keep correcting
      const jh = hash3(r.spec.lookSeed >>> 0, Math.floor(now / 2), 0x1b4c);
      const jink = (((jh & 0xffff) / 65535) * 2 - 1) * BEAST.jink;
      out.yaw = yawToWire(Math.atan2(-px, -pz) + jink);
      out.aimYaw = out.yaw;
      out.moveF = nearest < BEAST.startleR ? 127 : 80;
      if (nearest < BEAST.startleR) out.buttons = BUTTON.SPRINT;
      r.grazeUntil = now + 3;   // (and it stands a while before it settles to graze)
      r.gx = row.x;
      r.gz = row.z;
      return;
    }
    // graze: a few slow steps to a spot near where it is, every few seconds; strayed from its post (the barley it came down for), it ambles back towards it
    if (now >= r.grazeUntil) {
      const h = hash3(r.spec.lookSeed >>> 0, Math.floor(now), 0xb3a5);
      const a = ((h & 0xffff) / 65536) * Math.PI * 2, d = BEAST.grazeR * (((h >>> 16) & 0xff) / 255);
      const hx = r.spec.post.x - row.x, hz = r.spec.post.z - row.z, home = Math.hypot(hx, hz);
      const back = home > BEAST.grazeR * 1.5 ? Math.min(BEAST.homeStep, home) / home : 0;
      r.gx = row.x + Math.cos(a) * d * 0.5 + hx * back;
      r.gz = row.z + Math.sin(a) * d * 0.5 + hz * back;
      r.grazeUntil = now + (back > 0 ? 2.5 : 4 + ((h >>> 24) & 3));
    }
    if (Math.hypot(r.gx - row.x, r.gz - row.z) > 0.6) {
      out.yaw = toward(r.gx, r.gz);
      out.aimYaw = out.yaw;
      out.moveF = 40;
    }
  }
}
