import { FLAG, PACE, PACING, coasting, hash3, isNpcKey, meterStep, newMeter, newPace, paceStep, pressed, tokensFor, type PaceMeter, type PlayerStateType, type PlayersView } from "@cb/shared";

/**
 * THE PACING DIRECTOR, server half (D-107; the model is `shared/pacing.ts`). Asleep at the hub and once a contract has resolved; during a run it reads
 * the party's rows every tick (health lost, a fall, men holding a token on them, blasts nearby), keeps each member's intensity and the run's phase,
 * and works three levers: the Cast's attack tokens per member (`tokens`), hunts for a party that has gone quiet (`host.hunt`), and the incident's
 * timing (`calm`, `coasting`, read by Incidents). It spawns nobody and writes no state the clients see.
 */
export interface PacingHost {
  /** The real party (the room's party view: no NPC rows). */
  party: PlayersView;
  /** How many men hold an attack token on member `sid` now. */
  shootersOn(sid: string): number;
  /** Up to `n` idle, roused soldiers hostile to the party within `range` of (x, z) go and look there; how many went. */
  hunt(x: number, z: number, n: number, range: number): number;
  seed: number;
}

interface Member {
  id: string;
  meter: PaceMeter;
  hp: number;
  /** Blows that arrived between ticks (a blast). */
  blow: number;
  seen: boolean;
}

const isMember = (p: PlayerStateType, id: string): boolean => p.npc === 0 && !isNpcKey(id);
const standing = (p: PlayerStateType): boolean => p.connected && (p.flags & FLAG.DOWNED) === 0;

export class Pacing {
  readonly state = newPace();
  private readonly members: Member[] = [];
  private readonly byId = new Map<string, Member>();
  private on = false;
  private huntIn = 0;
  private hunts = 0;
  // per-tick scratch (the tick allocates nothing once everybody has a meter)
  private dt = 0;
  private worst = 0;
  private count = 0;
  private pick = 0;
  private tx = 0;
  private tz = 0;
  /** Counters for tests and the debug line. */
  readonly stats = { peaks: 0, hunts: 0, sent: 0 };

  constructor(private readonly host: PacingHost) {}

  get awake(): boolean {
    return this.on;
  }

  /** One tick. `live`: a contract is running (the director wakes with it, everybody calm, and sleeps when it resolves or the party sails). */
  tick(dt: number, live: boolean): void {
    if (live !== this.on) this.reset(live);
    if (!this.on || !(dt > 0)) return;
    this.dt = dt;
    this.worst = 0;
    for (let i = 0; i < this.members.length; i++) this.members[i]!.seen = false;
    this.host.party.forEach(this.feel);
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i]!;
      if (m.seen) continue;
      this.byId.delete(m.id);
      this.members[i] = this.members[this.members.length - 1]!;
      this.members.pop();
    }
    const was = this.state.phase;
    paceStep(this.state, this.worst, dt);
    if (this.state.phase === PACE.PEAK && was !== PACE.PEAK) this.stats.peaks++;
    if (coasting(this.state)) {
      this.huntIn -= dt;
      if (this.huntIn <= 0) {
        this.huntIn = PACING.huntEveryS;
        this.hunt();
      }
    } else this.huntIn = 0; // (the first hunt comes the moment the party has coasted long enough)
  }

  /** One member's tick: what happened to him since the last, into his meter. */
  private readonly feel = (p: PlayerStateType, id: string): void => {
    if (!isMember(p, id)) return;
    let m = this.byId.get(id);
    if (!m) {
      m = { id, meter: newMeter(), hp: p.health, blow: 0, seen: false };
      this.byId.set(id, m);
      this.members.push(m);
    }
    m.seen = true;
    const down = (p.flags & FLAG.DOWNED) !== 0;
    let blows = m.blow;
    m.blow = 0;
    if (p.health < m.hp) blows += (m.hp - p.health) * PACING.hurtPerHp;
    m.hp = p.health;
    if (down) blows += PACING.downed; // (pinned at the top while down: the run eases off until he is up)
    const pressure = p.connected && !down ? this.host.shootersOn(id) * PACING.shotAtPerS * this.dt : 0;
    meterStep(m.meter, blows, pressure, this.dt);
    if (p.connected && m.meter.v > this.worst) this.worst = m.meter.v;
  };

  /** QA (the room's `pace:quiet`): the party coasts from now, and the first hunt goes on the next tick. Only in BUILD (a peak runs its course). */
  coastNow(): void {
    if (!this.on || this.state.phase !== PACE.BUILD) return;
    this.state.dull = Math.max(this.state.dull, PACING.dullS);
    this.huntIn = 0;
  }

  /** A blast at (x, z): every member within its reach (at least `PACING.blastR`) feels it, hurt or not. */
  blast(x: number, z: number, radius: number): void {
    if (!this.on || !Number.isFinite(x + z)) return;
    const r = Math.max(PACING.blastR, Number.isFinite(radius) ? radius : 0);
    for (const m of this.members) {
      const p = this.host.party.get(m.id);
      if (p && Math.hypot(p.x - x, p.z - z) <= r) m.blow += PACING.blast;
    }
  }

  /** The attack tokens on member `id`; undefined when the director is asleep or `id` is not a member (the Cast's own rule then). */
  tokens(id: string): number | undefined {
    if (!this.on) return undefined;
    const m = this.byId.get(id);
    return m ? tokensFor(this.state, m.meter.v) : undefined;
  }

  /** Member `id`'s intensity (0 when unknown). */
  intensity(id: string): number {
    return this.byId.get(id)?.meter.v ?? 0;
  }

  /** No incident starts while the run is at its height or easing off. */
  get calm(): boolean {
    return !this.on || !pressed(this.state);
  }

  /** The party has gone quiet in a run: an incident may come early. */
  get coasting(): boolean {
    return this.on && coasting(this.state);
  }

  /** Round robin over the members on their feet: the one looked for this time, a few metres off where he stands (a search, not a homing shot). */
  private hunt(): void {
    this.count = 0;
    this.host.party.forEach(this.countStanding);
    if (this.count === 0) return;
    this.pick = this.hunts % this.count;
    this.host.party.forEach(this.pickStanding);
    const h = hash3(this.host.seed >>> 0, this.hunts, 0x4a7);
    const a = ((h & 0xffff) / 0x10000) * Math.PI * 2;
    const r = (((h >>> 16) & 0xff) / 0xff) * PACING.huntScatter;
    this.hunts++;
    const sent = this.host.hunt(this.tx + Math.sin(a) * r, this.tz + Math.cos(a) * r, PACING.huntMax, PACING.huntRange);
    if (sent > 0) {
      this.stats.hunts++;
      this.stats.sent += sent;
    }
  }
  private readonly countStanding = (p: PlayerStateType, id: string): void => {
    if (isMember(p, id) && standing(p)) this.count++;
  };
  private readonly pickStanding = (p: PlayerStateType, id: string): void => {
    if (!isMember(p, id) || !standing(p)) return;
    if (this.pick-- === 0) {
      this.tx = p.x;
      this.tz = p.z;
    }
  };

  private reset(on: boolean): void {
    this.on = on;
    this.members.length = 0;
    this.byId.clear();
    const s = newPace();
    this.state.phase = s.phase;
    this.state.t = s.t;
    this.state.dull = s.dull;
    this.state.worst = s.worst;
    this.huntIn = 0;
  }
}
