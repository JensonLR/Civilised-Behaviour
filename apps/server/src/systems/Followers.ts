import { FLAG, type PlayerStateType } from "@cb/shared";
// New shared modules are imported by path until the integrator adds their `export *` lines to the shared index (then switch these to "@cb/shared").
import type { ScenarioOutcome } from "@cb/shared";
import { NPC_SIDE, type CastApi, type Intent, type NpcBrain, type PartyState, type PlayersView } from "@cb/shared";
import { REFUSED, OBEYED, mindOf, resolveCommand, setIntent, type FollowerMind } from "@cb/shared";
import { effectiveBravery, followerSpecs, hire, dismiss, newParty, settleRoster, startMorale, type SettleReport } from "@cb/shared";
import { loadoutCost, prepEffects, trimLoadout, validateLoadout, type LoadoutCheck, type PrepEffects } from "@cb/shared";
import { NO_COMMAND, commandIndex, parseCommandMsg, parseHireMsg, parseLoadoutMsg, parseParty, serializeParty } from "@cb/shared";
import { moraleBand } from "@cb/shared";

/**
 * The hired hands, server side (D-034, package L). Hostile input in (`hire`, `loadoutSet`, `command`), the party's roster and manifest out
 * (`WorldState.party` JSON, published on change only), and a per-tick upkeep of the hands' brains: it hands the pure brain (`followerThink`, shared/command.ts)
 * the world facts a senses block cannot carry (the attack target's position, the prop, the patient) and answers the requests the brain writes back
 * (pick up, drop, tend). It never decides a fight: the Cast does, with attack tokens. Every message is hostile until `parse*` accepts it and the sender is a
 * connected, standing human; a hand is never ordered at anyone on the party's side or at a neutral.
 */

/** Per-sender message budget (messages per second), shared by hire, loadoutSet and command. */
export const FOLLOWERS_RATE = 4;
/** An order's point or prop must lie this close to the sender (metres). */
export const COMMAND_REACH = 60;
/** Humans within this many metres of a hand count as "the leader is near" for the shaken-attack rule. */
export const LEADER_NEAR = 18;
const TEND_SEARCH = 30;
const TEND_RETHINK = 0.5;
const DRESS_GAP = 1.2;

export interface FollowersHost {
  /** Humans (no NPC rows); `get` finds any row. Standing, connected humans only may send orders. */
  players: PlayersView;
  cast: CastApi;
  /** The brain of a spawned hand by follower id (the Cast owns it). */
  brainOf(id: string): NpcBrain | undefined;
  purse(): number;
  /** Takes pounds out of the campaign purse (never called with more than purse()). */
  spend(n: number): void;
  getParty(): string;
  setParty(json: string): void;
  /** The surgeon dresses a wound / works at a revive. `revive` is called every tick while he is within reach and returns true while the revive is going on or has just succeeded. */
  dress(medic: string, target: string): boolean;
  revive(medic: string, target: string): boolean;
  /** Where a free prop lies now, or undefined (consumed, held by somebody, never existed). */
  propPos(id: string): { x: number; z: number } | undefined;
  holdProp(key: string, id: string): boolean;
  dropProp(key: string): void;
  notice(sid: string, text: string): void;
  /** True while the party is at the table (the hub, not sailing, not on an expedition): the only time the manifest and the roster may change. */
  prepOpen(): boolean;
  inBounds(x: number, z: number): boolean;
  /** Campaign day (the hire pool is a function of seed and day). */
  day(): number;
  /** World seconds. */
  nowS(): number;
  seed: number;
  /** Optional: a follower who has died for good (the Casualties' call). */
  isDead?(key: string): boolean;
}

interface Hand {
  id: string;
  key: string;
  brain: NpcBrain;
  mind: FollowerMind;
  lastCmd: number;
  tendId: string;
  tendDown: boolean;
  tendAt: number;
  dressAt: number;
  shownMorale: number;
  shownCmd: number;
}

interface Bucket { t: number; n: number }

export const npcKeyOf = (id: string): string => `npc:${id}`;

/** Writes a plate field only when the schema has it (the integrator adds `PlayerState.morale` / `.cmd`); plain rows in tests accept it either way. */
function setRow(row: PlayerStateType, field: "morale" | "cmd", v: number): void {
  (row as unknown as Record<string, number>)[field] = v;
}

export class Followers {
  private p: PartyState;
  private shown: string;
  private readonly hands = new Map<string, Hand>();
  private readonly buckets = new Map<string, Bucket>();
  private landing = { x: 0, z: 0 };

  constructor(private readonly host: FollowersHost) {
    this.p = parseParty(host.getParty()) ?? newParty();
    this.shown = host.getParty();
  }

  get party(): Readonly<PartyState> {
    return this.p;
  }

  /** Followers on the ground now (spawned and not gone). */
  get active(): number {
    return this.hands.size;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  // hostile messages
  // ---------------------------------------------------------------------------------------------------------------------------------------------

  /** A connected, standing human (never an NPC row, never downed). */
  private sender(sid: string): PlayerStateType | undefined {
    if (typeof sid !== "string" || sid.length === 0 || sid.startsWith("npc:")) return undefined;
    const row = this.host.players.get(sid);
    if (!row || row.npc !== 0 || !row.connected || (row.flags & FLAG.DOWNED) !== 0) return undefined;
    return row;
  }

  private allow(sid: string): boolean {
    const now = this.host.nowS();
    let b = this.buckets.get(sid);
    if (!b) {
      if (this.buckets.size >= 32) this.buckets.clear();
      b = { t: now, n: 0 };
      this.buckets.set(sid, b);
    }
    if (!(now - b.t < 1) || now < b.t) {
      b.t = now;
      b.n = 0;
    }
    if (b.n >= FOLLOWERS_RATE) return false;
    b.n++;
    return true;
  }

  private humanCount(): number {
    let n = 0;
    this.host.players.forEach((p) => {
      if (p.npc === 0 && p.connected) n++;
    });
    return Math.max(1, n);
  }

  private humanNear(x: number, z: number, r: number): boolean {
    let near = false;
    this.host.players.forEach((p) => {
      if (p.npc === 0 && p.connected && (p.flags & FLAG.DOWNED) === 0 && Math.hypot(p.x - x, p.z - z) <= r) near = true;
    });
    return near;
  }

  /** The manifest is edited freely at the table; it is normalised here and validated again at propose and at sail. */
  onLoadoutSet(sid: string, raw: unknown): boolean {
    if (!this.sender(sid) || !this.allow(sid) || !this.host.prepOpen()) return false;
    const l = parseLoadoutMsg(raw);
    if (!l) return false;
    this.p = { ...this.p, loadout: l };
    this.publish();
    return true;
  }

  onHire(sid: string, raw: unknown): boolean {
    if (!this.sender(sid) || !this.allow(sid) || !this.host.prepOpen()) return false;
    const m = parseHireMsg(raw);
    if (!m) return false;
    const purse = this.host.purse();
    const r = m.on ? hire(this.p, purse, m.id, this.host.seed, this.host.day()) : dismiss(this.p, purse, m.id);
    this.host.notice(sid, r.why);
    if (!r.ok) return false;
    const spent = purse - r.purse;
    if (spent > 0) this.host.spend(spent);
    this.p = r.party;
    this.publish();
    return true;
  }

  /**
   * An order from a human. Returns a summary string starting `Obeyed` or `Refused` (also sent as a notice) or "" when the message was ignored.
   * Checks, in order: sender standing and under budget, structure, the expedition running, `at` near the sender and inside the bounds, `target` an
   * existing foe (attack) or a free prop (fetch), `who` naming real hands. Each hand then answers by its own morale and trade (resolveCommand).
   */
  onCommand(sid: string, raw: unknown): string {
    const me = this.sender(sid);
    if (!me || !this.allow(sid) || this.hands.size === 0) return "";
    const msg = parseCommandMsg(raw);
    if (!msg) return "";
    if (msg.at !== undefined && (Math.hypot(msg.at.x - me.x, msg.at.z - me.z) > COMMAND_REACH || !this.host.inBounds(msg.at.x, msg.at.z))) return "";
    if (msg.intent === "attack") {
      if (msg.target === undefined) return "";
      const id = msg.target.startsWith("npc:") ? msg.target.slice(4) : msg.target;
      const row = this.host.cast.row(id);
      if (!row || (row.flags & FLAG.DOWNED) !== 0 || this.hands.has(id)) return "";
      const side = NPC_SIDE[row.npc];
      if (side === undefined || side === "party" || side === "neutral") return "";
      msg.target = id;
    } else if (msg.intent === "fetch") {
      if (msg.target === undefined || this.host.cast.row(msg.target.startsWith("npc:") ? msg.target.slice(4) : msg.target) !== undefined) return "";
      const pp = this.host.propPos(msg.target);
      if (!pp || Math.hypot(pp.x - me.x, pp.z - me.z) > COMMAND_REACH || !this.host.inBounds(pp.x, pp.z)) return "";
    } else if (msg.target !== undefined) msg.target = undefined; // follow / hold / retreat take no target
    const now = this.host.nowS();
    let obeyed = 0;
    let refused = 0;
    const lines: string[] = [];
    let ix = -1;
    for (const f of this.p.roster) {
      ix++;
      const h = this.hands.get(f.id);
      if (!h) continue;
      if (msg.who !== undefined && msg.who !== 0 && (msg.who & (1 << ix)) === 0) continue;
      const row = this.host.cast.row(f.id);
      if (!row || (row.flags & FLAG.DOWNED) !== 0) continue;
      const res = resolveCommand(msg, f, { band: moraleBand(h.brain.morale.v), leaderNear: this.humanNear(row.x, row.z, LEADER_NEAR), rate: now - h.lastCmd, here: { x: row.x, z: row.z } });
      if ("refuse" in res) {
        if (res.refuse !== "") {
          refused++;
          if (lines.length < 3) lines.push(res.refuse);
        }
        continue;
      }
      h.lastCmd = now;
      this.apply(h, res.intent);
      obeyed++;
    }
    if (obeyed + refused === 0) return "";
    const summary = obeyed > 0 ? `${OBEYED}${refused > 0 ? ` (${obeyed} of ${obeyed + refused})` : ""}.` : `${REFUSED}.`;
    this.host.notice(sid, [summary, ...lines].join(" "));
    return summary;
  }

  /** Stores an order on a hand and primes what the brain needs to carry it out. */
  private apply(h: Hand, intent: Intent): void {
    if (h.mind.carrying && intent.k !== "fetch") {
      this.host.dropProp(h.key);
      h.mind.carrying = false;
    }
    setIntent(h.brain, intent);
    h.tendId = "";
    h.mind.tendOn = false;
    this.refreshIntent(h);
    this.markCmd(h, commandIndex(intent.k));
  }

  private markCmd(h: Hand, v: number): void {
    const row = this.host.cast.row(h.id);
    if (row && h.shownCmd !== v) {
      setRow(row, "cmd", v);
      h.shownCmd = v;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  // the expedition's life cycle
  // ---------------------------------------------------------------------------------------------------------------------------------------------

  /** Departure (the ship leaves): trims the manifest to the purse and the capacity, charges it, stores the stock. Returns the effects to apply at landfall. */
  prepCommit(): { effects: PrepEffects; lines: string[]; charged: number } {
    const humans = this.humanCount();
    const t = trimLoadout(this.p.loadout, { purse: this.host.purse(), humans, roster: this.p.roster });
    const charged = loadoutCost(t.loadout);
    if (charged > 0) this.host.spend(charged);
    const effects = prepEffects(t.loadout);
    this.p = { ...this.p, loadout: t.loadout, medical: effects.dressings, provisions: effects.provisions };
    this.publish();
    for (const l of t.lines) this.host.notice("*", l);
    return { effects, lines: t.lines, charged };
  }

  /** Whether the current manifest could sail now (the propose-time check). */
  check(): LoadoutCheck {
    return validateLoadout(this.p.loadout, { purse: this.host.purse(), humans: this.humanCount(), roster: this.p.roster });
  }

  /** Landfall: the roster stands around `near`. Hands the Cast refuses (cap) simply do not come. */
  landfall(near: { x: number; z: number }): number {
    this.hands.clear();
    this.landing = { x: near.x, z: near.z };
    const specs = followerSpecs(this.p, this.host.seed, near);
    const n = this.host.cast.spawn(specs);
    for (const s of specs) {
      const brain = this.host.brainOf(s.id);
      const f = this.p.roster.find((r) => r.id === s.id);
      if (!brain || !f) continue;
      const mind = mindOf(brain);
      mind.kind = f.kind;
      mind.landX = near.x;
      mind.landZ = near.z;
      mind.bravery = effectiveBravery(f);
      mind.paid = f.owed === 0 || this.p.provisions > 0;
      mind.provisions = this.p.provisions > 0;
      brain.morale.v = startMorale(f);
      brain.morale.shock = 0;
      setIntent(brain, { k: "follow" });
      const h: Hand = { id: s.id, key: npcKeyOf(s.id), brain, mind, lastCmd: -1e9, tendId: "", tendDown: false, tendAt: -1e9, dressAt: -1e9, shownMorale: -1, shownCmd: -1 };
      this.hands.set(s.id, h);
      const row = this.host.cast.row(s.id);
      if (row) {
        setRow(row, "cmd", NO_COMMAND);
        h.shownCmd = NO_COMMAND;
      }
    }
    return n;
  }

  /** The party's stock of dressings and provisions, used by humans' own first aid and the surgeon. Returns false when there are none. */
  takeDressing(): boolean {
    if (this.p.medical <= 0) return false;
    this.p = { ...this.p, medical: this.p.medical - 1 };
    this.publish();
    return true;
  }

  /** Per server tick, AFTER `cast.tick` (the brains' requests are read here). */
  tick(_dt: number): void {
    if (this.hands.size === 0) return;
    const now = this.host.nowS();
    for (const h of this.hands.values()) {
      const row = this.host.cast.row(h.id);
      if (!row) continue;
      const f = this.p.roster.find((r) => r.id === h.id);
      if (!f) continue;
      const down = (row.flags & FLAG.DOWNED) !== 0;
      h.mind.paid = f.owed === 0 || this.p.provisions > 0;
      h.mind.provisions = this.p.provisions > 0;
      h.mind.bravery = effectiveBravery(f);
      const m = Math.round(Math.min(100, Math.max(0, h.brain.morale.v)));
      if (m !== h.shownMorale) {
        setRow(row, "morale", m);
        h.shownMorale = m;
      }
      if (down) {
        if (h.mind.carrying) {
          this.host.dropProp(h.key);
          h.mind.carrying = false;
        }
        h.mind.tendOn = false;
        continue;
      }
      this.upkeepIntent(h, row);
      if (f.kind === "surgeon") this.tend(h, row, now);
    }
  }

  private refreshIntent(h: Hand): void {
    const it = h.brain.intent;
    if (it?.k === "attack") {
      const row = this.host.cast.row(it.target);
      if (row && (row.flags & FLAG.DOWNED) === 0) {
        h.mind.tOn = true;
        h.mind.tx = row.x;
        h.mind.tz = row.z;
      } else h.mind.tOn = false;
    } else if (it?.k === "fetch") {
      const pp = this.host.propPos(it.prop);
      if (pp) {
        h.mind.fOn = true;
        h.mind.fx = pp.x;
        h.mind.fz = pp.z;
      } else h.mind.fOn = false;
    }
  }

  /** Keeps the brain's world facts fresh; ends an order whose subject is gone (target downed, prop taken) by falling back to follow. */
  private upkeepIntent(h: Hand, row: PlayerStateType): void {
    const it = h.brain.intent;
    if (!it) return;
    if (it.k === "attack") {
      this.refreshIntent(h);
      if (!h.mind.tOn) this.cancel(h);
    } else if (it.k === "fetch") {
      if (!h.mind.carrying) {
        this.refreshIntent(h);
        if (!h.mind.fOn) return this.cancel(h);
      }
      if (h.mind.wantPickup) {
        h.mind.wantPickup = false;
        if (this.host.holdProp(h.key, it.prop)) h.mind.carrying = true;
        else this.cancel(h);
      } else if (h.mind.wantDrop) {
        h.mind.wantDrop = false;
        this.host.dropProp(h.key);
        h.mind.carrying = false;
        this.cancel(h); // delivered: back to the leader's heel
      }
    } else if (it.k === "hold" && Math.hypot(it.x - row.x, it.z - row.z) > 400) this.cancel(h);
  }

  private cancel(h: Hand): void {
    if (h.mind.carrying) {
      this.host.dropProp(h.key);
      h.mind.carrying = false;
    }
    setIntent(h.brain, { k: "follow" });
    this.markCmd(h, NO_COMMAND);
  }

  /** The surgeon: choose the nearest fallen (or, with dressings, badly hurt) member of the party, go, and work. */
  private tend(h: Hand, row: PlayerStateType, now: number): void {
    const m = h.mind;
    if (h.tendId !== "") {
      const t = this.host.players.get(h.tendId);
      const tDown = t !== undefined && (t.flags & FLAG.DOWNED) !== 0;
      const valid = t !== undefined && (tDown || (t.health < 60 && this.p.medical > 0)) && (t.npc === 0 ? t.connected : true);
      if (!valid) {
        h.tendId = "";
        m.tendOn = false;
      } else {
        m.tendX = t.x;
        m.tendZ = t.z;
        h.tendDown = tDown;
      }
    }
    if (h.tendId === "" && now - h.tendAt >= TEND_RETHINK) {
      h.tendAt = now;
      let best = Infinity;
      let bestDown = false;
      let bestId = "";
      const consider = (id: string, p: PlayerStateType): void => {
        const d = Math.hypot(p.x - row.x, p.z - row.z);
        if (d > TEND_SEARCH || id === h.key) return;
        const isDown = (p.flags & FLAG.DOWNED) !== 0;
        if (!isDown && !(p.health < 60 && this.p.medical > 0)) return;
        if (isDown && p.reviver !== "" && p.reviver !== h.key) return; // somebody is already on it
        const score = d - (isDown ? 40 : 0); // the fallen come first
        if (score < best) {
          best = score;
          bestId = id;
          bestDown = isDown;
        }
      };
      this.host.players.forEach((p, id) => {
        if (p.npc === 0 && p.connected) consider(id, p);
      });
      for (const o of this.hands.values()) {
        const r = this.host.cast.row(o.id);
        if (r) consider(o.key, r);
      }
      if (bestId !== "") {
        h.tendId = bestId;
        h.tendDown = bestDown;
        const t = this.host.players.get(bestId)!;
        m.tendOn = true;
        m.tendX = t.x;
        m.tendZ = t.z;
      }
    }
    if (m.tendOn && m.ready && h.tendId !== "") {
      if (h.tendDown) {
        if (!this.host.revive(h.key, h.tendId)) {
          h.tendId = "";
          m.tendOn = false;
        }
      } else if (now - h.dressAt >= DRESS_GAP) {
        h.dressAt = now;
        if (this.p.medical > 0 && this.host.dress(h.key, h.tendId)) this.takeDressing();
        else {
          h.tendId = "";
          m.tendOn = false;
        }
      }
    }
  }

  /** The expedition is over (outcome committed, or the region is being left): what happened to the hands, for `settleRoster`. Does not remove them. */
  report(): SettleReport {
    const down: string[] = [];
    const dead: string[] = [];
    const morale: Record<string, number> = {};
    for (const h of this.hands.values()) {
      const row = this.host.cast.row(h.id);
      morale[h.id] = Math.round(h.brain.morale.v);
      if (this.host.isDead?.(h.key)) dead.push(h.id);
      else if (row && (row.flags & FLAG.DOWNED) !== 0) down.push(h.id);
    }
    return { down, dead, morale };
  }

  /** `commitOutcome`: wages, wounds, desertions. Call AFTER `applyOutcome` (so a reward is in the purse before it is spent). Returns lines for the log. */
  settle(outcome: Pick<ScenarioOutcome, "resolution" | "brokePromise">): string[] {
    const purse = this.host.purse();
    const r = settleRoster(this.p, purse, outcome, this.report());
    const spent = purse - r.purse;
    if (spent > 0) this.host.spend(spent);
    this.p = r.party;
    this.publish();
    return r.lines;
  }

  /** Region change or room reset: the hands leave the ground (the Cast despawns the group), the plates go with them. */
  endExpedition(): void {
    for (const h of this.hands.values()) if (h.mind.carrying) this.host.dropProp(h.key);
    this.hands.clear();
    this.host.cast.despawn("party");
  }

  onLeave(sid: string): void {
    this.buckets.delete(sid);
  }

  private publish(): void {
    const s = serializeParty(this.p);
    if (s === this.shown) return;
    this.shown = s;
    this.host.setParty(s);
  }
}
