import { FLAG, HOLDUP, NPC_SIDE, WEAPONS, findCovered, weaponFromWire, type PlayerStateType } from "@cb/shared";

/**
 * THE HOLD-UP, server half (D-113; the rules are `shared/holdup.ts`). Each tick it looks down the gun of every member of the party who is aiming a firearm: the man in
 * the sights (in range, in the cone, the line open) is "covered", and the time he has been covered by that member is kept. Once he has been covered long enough and his
 * nerve will not hold (the Cast says), he gives in: the room drops his weapon, puts his hands up and bills it. A man who leaves the sights starts again.
 */
export interface HoldUpsHost {
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void; get(id: string): PlayerStateType | undefined };
  /** Whether the line from a gun at (ax, ay, az) to a man at (bx, by, bz) is open (no wall between). */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** Whether `key`'s nerve gives way at gunpoint now (Cast.yields). */
  yields(key: string): boolean;
  /** `key` gives in to `by`: the room does the rest (the gun dropped, the hands up, the bill). */
  surrender(key: string, by: string): void;
}

/** Rows that cannot be held up: down, held, a beast, a rider, a man at a crank gun. */
const UNCOVERABLE = FLAG.DOWNED | FLAG.DRAGGED | FLAG.BEAST | FLAG.MOUNTED | FLAG.OPERATING;

export class HoldUps {
  /** Each covered man: by whom, for how long, and the tick he was last seen in the sights. */
  private readonly cover = new Map<string, { by: string; t: number; seen: number }>();
  private stamp = 0;
  readonly stats = { surrenders: 0 };
  private dt = 0;
  private aimer = "";
  private aimRow: PlayerStateType | undefined;

  constructor(private readonly host: HoldUpsHost) {}

  tick(dt: number): void {
    this.stamp++;
    this.dt = dt;
    this.host.players.forEach(this.lookDown);
    for (const [key, c] of this.cover) if (c.seen !== this.stamp) this.cover.delete(key);
  }

  reset(): void {
    this.cover.clear();
  }

  /** How long `key` has been covered (tests). */
  coveredFor(key: string): number {
    return this.cover.get(key)?.t ?? 0;
  }

  private readonly lookDown = (p: PlayerStateType, id: string): void => {
    if (p.npc !== 0 || (p.flags & FLAG.AIMING) === 0 || (p.flags & (FLAG.DOWNED | FLAG.MOUNTED | FLAG.OPERATING | FLAG.CARRYING)) !== 0) return;
    const w = weaponFromWire(p.weapon);
    if (w === -1 || !WEAPONS[w].ranged) return;
    this.aimer = id;
    this.aimRow = p;
    const key = findCovered<string>(p, this.candidates, this.lineOpen);
    if (key === undefined) return;
    let c = this.cover.get(key);
    if (!c || c.by !== id) {
      c = { by: id, t: 0, seen: this.stamp };
      this.cover.set(key, c);
    }
    c.seen = this.stamp;
    c.t += this.dt;
    if (c.t >= HOLDUP.coverS && this.host.yields(key)) {
      this.cover.delete(key);
      this.stats.surrenders++;
      this.host.surrender(key, id);
    }
  };

  // (prebound, so the scan allocates nothing per tick)
  private emit: ((id: string, o: { x: number; z: number }) => void) | undefined;
  private readonly candidates = (cb: (id: string, o: { x: number; z: number }) => void): void => {
    this.emit = cb;
    this.host.players.forEach(this.candidate);
  };
  private readonly candidate = (o: PlayerStateType, k: string): void => {
    if (k === this.aimer || o.npc === 0 || NPC_SIDE[o.npc] === "party" || (o.flags & UNCOVERABLE) !== 0 || o.roped) return; // (roped: held already; an NPC row may never have had it set)
    this.emit!(k, o);
  };

  private readonly lineOpen = (o: { x: number; z: number }): boolean => {
    const p = this.aimRow!;
    const t = o as PlayerStateType;
    return this.host.clear(p.x, p.y + 1.35, p.z, t.x, t.y + 1.2, t.z);
  };
}
