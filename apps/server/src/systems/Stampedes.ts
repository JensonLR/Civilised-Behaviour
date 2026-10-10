import { FLAG, STAMPEDE, TRAMPLE, encodeHerdRuns, herdAnimalAt, runDuration, type CollisionWorld, type HerdPlan, type HerdRun, type PlayerStateType } from "@cb/shared";

/**
 * THE STAMPEDE, server half (D-114; the rules and the animals' paths are `shared/stampede.ts`). It hears the reports and watches the fire near each herd; when one is close
 * enough it sets the herd running away from it, as far as the way is open (water, walls, steep ground and the map's edge stop it), and publishes the run (one short string the
 * clients draw from). While a herd runs, every animal's place and pace are worked out from the same formula as the clients', and whoever stands at an animal's chest is ridden
 * down: credited to whoever's report set it running (an accident's key when nobody did). Allocation-free in the tick.
 */
export interface StampedesHost {
  /** Every row (players and NPCs). */
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void };
  world(): CollisionWorld;
  /** The world clock the clients draw the herds with (seconds). */
  nowSec(): number;
  /** The animal at (fx, fz) heading, at `speed`, has struck `key` standing (ox, oz) from its chest: the room rides him down, credited to `by`. */
  trample(by: string, key: string, speed: number, fx: number, fz: number, ox: number, oz: number): void;
  /** The runs changed: the room puts them on the state. */
  publish(encoded: string): void;
  /** `by` set herd `k` running (the bill's shout). Optional. */
  started?(k: number, by: string): void;
  /** Burning ground within `r` of (x, z) (into `out`), as the horses ask (D-110). Optional: no fire, no fire panic. */
  fireNear?(x: number, z: number, r: number, out: { x: number; z: number }): boolean;
}

/** Rows a stampede does not strike: down, held (dragged, roped), a beast, a rider (the horse takes its own fright). */
const SPARED = FLAG.DOWNED | FLAG.DRAGGED | FLAG.BEAST | FLAG.MOUNTED;
const FIRE_EVERY = 10;

export class Stampedes {
  private plan: HerdPlan | undefined;
  private runs: (HerdRun | undefined)[] = [];
  /** Who set each herd running ("" for nobody's hand), and when each herd may run again. */
  private by: string[] = [];
  private restUntil: number[] = [];
  /** When each man may be struck again (by any herd). */
  private readonly struckUntil = new Map<string, number>();
  private ticks = 0;
  readonly stats = { runs: 0, tramples: 0 };
  // scratch (the tick allocates nothing)
  private readonly a = { x: 0, z: 0, yaw: 0, speed: 0 };
  private readonly fireAt = { x: 0, z: 0 };
  private readonly centre = { x: 0, z: 0 };
  private now = 0;
  private herd = 0;
  private cx = 0;
  private cz = 0;
  private fx = 0;
  private fz = 0;
  private speed = 0;

  constructor(private readonly host: StampedesHost) {}

  /** A region begins: its herds (Highmark's plan, or none), all at rest where their drift puts them. */
  begin(plan: HerdPlan | undefined): void {
    this.plan = plan;
    const n = plan?.herds.length ?? 0;
    this.runs = new Array<HerdRun | undefined>(n).fill(undefined);
    this.by = new Array<string>(n).fill("");
    this.restUntil = new Array<number>(n).fill(-Infinity);
    this.struckUntil.clear();
    this.host.publish("");
  }

  /** The runs as the clients draw them (tests). */
  get current(): readonly (HerdRun | undefined)[] {
    return this.runs;
  }

  /** A report (a shot, a blast) at (x, z), carrying `radius` metres, made by `src`: a herd near enough runs from it. */
  onNoise(x: number, z: number, radius: number, src: string): void {
    const plan = this.plan;
    if (!plan || !(radius > 0) || !Number.isFinite(x + z)) return;
    const now = this.host.nowSec();
    const reach = Math.min(radius, STAMPEDE.hearR);
    for (let k = 0; k < plan.herds.length; k++) {
      if (now < this.restUntil[k]!) continue;
      this.herdCentre(k, now);
      if (Math.hypot(this.centre.x - x, this.centre.z - z) <= reach) this.start(k, x, z, src, now);
    }
  }

  /** Once per room tick: the fire beside a herd (now and then), and the tramples of every herd that is running. */
  tick(): void {
    const plan = this.plan;
    if (!plan) return;
    const now = this.host.nowSec();
    this.ticks++;
    if (this.host.fireNear && this.ticks % FIRE_EVERY === 0) {
      for (let k = 0; k < plan.herds.length; k++) {
        if (now < this.restUntil[k]!) continue;
        this.herdCentre(k, now);
        if (this.host.fireNear(this.centre.x, this.centre.z, STAMPEDE.fireR, this.fireAt)) this.start(k, this.fireAt.x, this.fireAt.z, "", now);
      }
    }
    this.now = now;
    let first = 0;
    for (let k = 0; k < plan.herds.length; k++) {
      const n = plan.herds[k]!.n;
      const run = this.runs[k];
      if (run && now >= run.t0 && now <= run.t0 + runDuration(run.dist) / (1 - STAMPEDE.paceJitter) + 0.1) {
        this.herd = k;
        for (let i = first; i < first + n; i++) {
          if (!herdAnimalAt(plan, i, now, this.runs, this.a) || this.a.speed < TRAMPLE.minSpeed) continue;
          this.fx = Math.cos(this.a.yaw);
          this.fz = Math.sin(this.a.yaw);
          this.cx = this.a.x + this.fx * STAMPEDE.ahead;
          this.cz = this.a.z + this.fz * STAMPEDE.ahead;
          this.speed = this.a.speed;
          this.host.players.forEach(this.strike);
        }
      }
      first += n;
    }
  }

  private readonly strike = (p: PlayerStateType, key: string): void => {
    if ((p.flags & SPARED) !== 0) return;
    const ox = p.x - this.cx;
    const oz = p.z - this.cz;
    if (ox * ox + oz * oz > STAMPEDE.reach * STAMPEDE.reach) return;
    const ground = this.host.world().terrainHeight(this.cx, this.cz);
    if (Math.abs(p.y - ground) > STAMPEDE.dy) return;
    if (this.now < (this.struckUntil.get(key) ?? -Infinity)) return;
    this.struckUntil.set(key, this.now + STAMPEDE.cooldownS);
    this.stats.tramples++;
    this.host.trample(this.by[this.herd]!, key, this.speed, this.fx, this.fz, ox, oz);
  };

  /** Sets herd `k` running away from (x, z), as far as the way is open; the run starts from where its last one left it. */
  private start(k: number, x: number, z: number, by: string, now: number): void {
    let dx = this.centre.x - x;
    let dz = this.centre.z - z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      dx = 1;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    // straight away, else turned a quarter either way (whichever is more open)
    let best = this.openRun(dx, dz);
    let fx = dx;
    let fz = dz;
    if (best < STAMPEDE.minRun) {
      for (const turn of [0.8, -0.8, 1.4, -1.4]) {
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const tx = dx * c - dz * s;
        const tz = dx * s + dz * c;
        const d = this.openRun(tx, tz);
        if (d > best) {
          best = d;
          fx = tx;
          fz = tz;
        }
      }
    }
    if (best < STAMPEDE.minRun) return; // (penned in: it mills about, and nobody is hurt)
    const prev = this.runs[k];
    const ox = prev ? prev.ox + prev.fx * prev.dist : 0;
    const oz = prev ? prev.oz + prev.fz * prev.dist : 0;
    this.runs[k] = { k, t0: now, fx, fz, dist: best, ox, oz };
    this.by[k] = by;
    this.restUntil[k] = now + runDuration(best) / (1 - STAMPEDE.paceJitter) + STAMPEDE.restS;
    this.stats.runs++;
    this.host.publish(encodeHerdRuns(this.runs));
    this.host.started?.(k, by);
  }

  /** How far the herd can run from where it stands along (fx, fz): it stops short of water, a wall or a cliff, the map's edge, `maxRun` at most. */
  private openRun(fx: number, fz: number): number {
    const world = this.host.world();
    const t = world.terrain as { height(x: number, z: number): number; waterDepth?: (x: number, z: number) => number };
    const step = 3;
    let prevH = world.terrainHeight(this.centre.x, this.centre.z);
    let ok = 0;
    for (let d = step; d <= STAMPEDE.maxRun; d += step) {
      const x = this.centre.x + fx * d;
      const z = this.centre.z + fz * d;
      if (Math.hypot(x, z) > world.boundsRadius - 8) break;
      if ((t.waterDepth?.(x, z) ?? 0) > 0.15) break;
      const h = world.terrainHeight(x, z);
      if (Math.abs(h - prevH) > 1.6) break; // (a bank too steep to run down or up)
      if (world.groundHeight(x, z, h + 3) - h > 0.6) break; // (something built, or a rock, in the way)
      prevH = h;
      ok = d;
    }
    return ok;
  }

  /** Where herd `k` stands now (the middle of its animals), into `centre`. */
  private herdCentre(k: number, now: number): void {
    const plan = this.plan!;
    let first = 0;
    for (let q = 0; q < k; q++) first += plan.herds[q]!.n;
    const n = plan.herds[k]!.n;
    let sx = 0;
    let sz = 0;
    for (let i = first; i < first + n; i++) {
      herdAnimalAt(plan, i, now, this.runs, this.a);
      sx += this.a.x;
      sz += this.a.z;
    }
    this.centre.x = sx / n;
    this.centre.z = sz / n;
  }
}
