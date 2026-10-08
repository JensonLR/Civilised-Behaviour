import {
  FACT_RANK, FLING_YARDS, NPC_SIDE, REQUESTS, WEAPON, ZONE, compassPoint, dealRequest, requestLine, flightYards, gazetteLine, newBill, spectacle,
  type Bill, type Cause, type LimbId, type MayhemFact, type NpcSide, type ObjectiveView, type RequestId, type RunEnd, type ScenarioTemplateId, type WeaponId,
} from "@cb/shared";

/**
 * D-084: the run's spectacle, as it happens. The room hands this the facts it already has (a hit and who dealt it, with what, where; a limb off; a body a blast threw;
 * a keg going up; a round fired) and it keeps the Butcher's Bill, watches the Society's request, and prints the best of each moment in the gazette (one line at a time,
 * never more often than `GAP` seconds; what is stale when its turn comes is dropped). Pure bookkeeping: no randomness of its own (the phrasing is hashed from the
 * moment), no wall clock (it counts the sim seconds `tick` is given).
 */

export interface MayhemHost {
  /** A row's display name ("" when unknown) and its NPC role (0 for a member of the party). */
  row(id: string): { name: string; npc: number } | undefined;
  /** The column's line, to every client, with the kind of moment it reports (the client stamps a commission met). */
  print(text: string, kind: MayhemFact["k"]): void;
  /** The request's objective changed (progress, or met): the tracker should republish. */
  changed(): void;
}

/** Seconds between two lines of the column (the HUD stays calm, D-063). */
export const GAP = 2.2;
/** A line older than this when its turn comes is not news. */
const STALE = 3.5;
/** Kegs going up within this many seconds of the last are one chain. */
const CHAIN_S = 2.5;
/** Downs by one hand within this many seconds are a streak. */
const STREAK_S = 2.5;

const causeOf = (w: WeaponId | undefined, by: string): Cause =>
  by === "mount" ? "horse" : w === WEAPON.SABRE ? "blade" : w === WEAPON.UMBRELLA ? "brolly" : w === WEAPON.FISTS ? "fists" : w === WEAPON.CANNON ? "blast" : "shot";

export interface HitFact {
  victim: string;
  by: string;
  weapon?: WeaponId;
  zone?: number;
  /** This hit put the victim down. */
  down: boolean;
  /** 0..1 as Casualties computes it (min(1, damage / 60)) and the blast's lift (0 for anything else). */
  power: number;
  lift: number;
  /** A limb this hit took off, and the way the blow pushed. */
  severed?: LimbId;
  dirX: number;
  dirZ: number;
}

export class Mayhem {
  bill: Bill = newBill();
  request: RequestId = "flight";
  private met = false;
  /** The bill has been settled (paid once: a second commit without a new contract pays nothing). */
  private settled = false;
  private t = 0;
  private queue: { f: MayhemFact; at: number; salt: number }[] = [];
  private nextPrint = 0;
  private lastKegAt = -Infinity;
  private runChain = 0;
  private readonly streak = new Map<string, { at: number; n: number }>();
  private progress = "";
  private salt = 0;

  constructor(private readonly host: MayhemHost) {}

  /** A contract begins: a clean bill and its commission (`kegs`: the powder in reach there, so it asks for nothing the contract cannot give). */
  begin(seed: number, day: number, template: ScenarioTemplateId, last?: RequestId, kegs?: number): void {
    this.bill = newBill();
    this.request = dealRequest(seed, day, template, last, kegs);
    this.met = false;
    this.settled = false;
    this.queue = [];
    this.lastKegAt = -Infinity;
    this.runChain = 0;
    this.streak.clear();
    this.salt = (seed ^ (day * 7919)) >>> 0;
    this.progress = REQUESTS[this.request].progress(this.bill);
  }

  /** The commission as an optional objective (the tracker's second line). */
  objective(): ObjectiveView {
    const r = REQUESTS[this.request];
    const p = this.met ? "" : r.progress(this.bill);
    return { id: "society", text: requestLine(this.request, p), done: this.met, optional: true };
  }

  private side(id: string): NpcSide | "party" | undefined {
    const r = this.host.row(id);
    if (!r) return undefined;
    return r.npc === 0 ? "party" : (NPC_SIDE[r.npc] ?? "neutral");
  }
  private name(id: string): string {
    return this.host.row(id)?.name ?? "";
  }

  /** A hit landed (the room's single entry point for harm). */
  onHit(h: HitFact): void {
    const vs = this.side(h.victim);
    if (!vs) return;
    const bySide = h.by === "" || h.by === "mount" ? undefined : this.side(h.by);
    const byParty = bySide === "party";
    const victimParty = vs === "party";
    const cause = causeOf(h.weapon, h.by);
    const b = this.bill;
    const victim = this.name(h.victim);
    const by = byParty ? this.name(h.by) : "";
    if (byParty && victimParty && h.by !== h.victim) {
      b.friendly++;
      if (h.down) this.say({ k: "friendly", victim, by });
    }
    if (h.severed !== undefined) this.severed(h.victim, h.severed, by, cause, h.dirX, h.dirZ);
    if (h.down) {
      if (victimParty) b.partyDowns++;
      if (byParty && !victimParty) {
        if (vs === "neutral") {
          b.civilians++;
          this.say({ k: "civilian", victim, by });
        } else {
          b.foes++;
          if (cause === "brolly") {
            b.brolly++;
            this.say({ k: "brolly", victim, by });
          } else if (h.zone === ZONE.HEAD && cause === "shot") {
            b.headshots++;
            this.say({ k: "headshot", victim, by });
          }
          this.onStreak(h.by, by);
        }
      }
      if (h.lift > 0) this.flung(h.victim, victim, by, victimParty, h.power, h.lift);
    }
    this.touch();
  }

  /** A blast threw somebody already down (Casualties.toss), maybe taking a limb. */
  onToss(victim: string, by: string, power: number, lift: number, severed: LimbId | undefined, dirX: number, dirZ: number): void {
    const vs = this.side(victim);
    if (!vs) return;
    const byName = by !== "" && this.side(by) === "party" ? this.name(by) : "";
    if (severed !== undefined) this.severed(victim, severed, byName, "blast", dirX, dirZ);
    this.flung(victim, this.name(victim), byName, vs === "party", power, lift);
    this.touch();
  }

  /** A limb came off somebody: counted against the party or for the Museum. */
  private severed(victim: string, limb: LimbId, by: string, cause: Cause, dx: number, dz: number): void {
    const party = this.side(victim) === "party";
    if (party) this.bill.ownLimbs++;
    else {
      this.bill.limbs++;
      if (cause === "blade" && by !== "") this.bill.bladeLimbs++;
    }
    this.say({ k: "sever", victim: this.name(victim), limb, by, cause, party, dir: compassPoint(dx, dz) });
  }

  private flung(_id: string, victim: string, by: string, party: boolean, power: number, lift: number): void {
    const yards = flightYards(power, lift);
    if (yards < FLING_YARDS) return;
    const b = this.bill;
    b.flings++;
    if (yards > b.longest) {
      b.longest = yards;
      b.longestWho = victim.slice(0, 40);
    }
    this.say({ k: "fling", victim, yards, by, party });
  }

  /** One hand's downs in quick succession. */
  private onStreak(id: string, name: string): void {
    const s = this.streak.get(id);
    if (s && this.t - s.at <= STREAK_S) {
      s.n++;
      s.at = this.t;
      if (s.n === 2 || s.n === 3) this.say({ k: "double", by: name, n: s.n });
    } else this.streak.set(id, { at: this.t, n: 1 });
  }

  /** A keg went up (`owner`: whoever set off the first of its chain; "" or an accident's owner for nobody's hand). */
  onKeg(owner: string): void {
    const b = this.bill;
    b.kegs++;
    this.runChain = this.t - this.lastKegAt <= CHAIN_S ? this.runChain + 1 : 1;
    this.lastKegAt = this.t;
    if (this.runChain > b.chain) b.chain = this.runChain;
    if (this.runChain >= 2) {
      const by = this.side(owner) === "party" ? this.name(owner) : "";
      // (one line per chain: a later, longer one replaces the queued shorter one)
      this.queue = this.queue.filter((q) => q.f.k !== "chain");
      this.say({ k: "chain", kegs: this.runChain, by });
    }
    this.touch();
  }

  /** A round left a barrel (Combat's shot event). */
  onShot(shooter: string): void {
    if (this.side(shooter) !== "party") return;
    this.bill.shots++;
    if (this.bill.shots === 1) this.touch();
  }

  private say(f: MayhemFact): void {
    this.queue.push({ f, at: this.t, salt: (this.salt + this.queue.length * 131 + Math.round(this.t * 10)) >>> 0 });
    if (this.queue.length > 6) this.queue.shift();
  }

  /** The loud commissions are met the moment they are; the quiet ones wait for the end. Republishes the objective when its line changes. */
  private touch(): void {
    const r = REQUESTS[this.request];
    if (!this.met && !r.quiet && r.done(this.bill)) {
      this.met = true;
      this.queue.push({ f: { k: "request", id: this.request }, at: this.t, salt: 0 });
    }
    const p = this.met ? "met" : r.progress(this.bill);
    if (p !== this.progress) {
      this.progress = p;
      this.host.changed();
    }
  }

  /** Advances the column's clock; prints the best fresh line when the gap has passed. */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    this.t += Math.min(dt, 0.5);
    if (this.queue.length === 0 || this.t < this.nextPrint) return;
    this.queue = this.queue.filter((q) => this.t - q.at <= STALE);
    if (this.queue.length === 0) return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) if (FACT_RANK[this.queue[i]!.f.k] > FACT_RANK[this.queue[best]!.f.k]) best = i;
    const [q] = this.queue.splice(best, 1);
    this.host.print(gazetteLine(q!.f, q!.salt), q!.f.k);
    this.nextPrint = this.t + GAP;
  }

  /** The run is over: the commission settled (the quiet ones now), the supplement reckoned. The bill is handed over as it stands. */
  settle(end: RunEnd): { bill: Bill; request: RequestId; met: boolean; reward: number; spectacle: number; spectacleLine: string; requestLine: string } {
    if (this.settled) return { bill: newBill(), request: this.request, met: false, reward: 0, spectacle: 0, spectacleLine: "", requestLine: "" };
    this.settled = true;
    const r = REQUESTS[this.request];
    const met = this.met || r.done(this.bill, end);
    const sp = spectacle(this.bill);
    return { bill: { ...this.bill }, request: this.request, met, reward: met ? r.reward : 0, spectacle: sp.pay, spectacleLine: sp.line, requestLine: met ? r.met : "" };
  }
}
