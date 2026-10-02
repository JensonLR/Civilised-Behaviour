import {
  FLAG, PropKind, SCENARIO, createWeather, hash3, isNpcKey, npcKey, weatherAt,
  type BridgeState, type CampaignState, type CasualtyTally, type Leverage, type ParleyKind, type ParleyStep, type ParleyView, type PlayerStateType,
  type ScenarioFx, type ScenarioInput, type ScenarioOutcome, type ScenarioTemplateId, type ScenarioView, type RivalPresence,
} from "@cb/shared";
// New shared modules are imported by path until the integrator adds their `export *` lines to the shared index (then switch these to "@cb/shared").
import type { CastApi, MountApi, NpcSpec, PlayersView } from "@cb/shared";
import { lingerDone } from "../../../../packages/shared/src/scenarios/common.ts";
import { answerSiteParley, openSiteParley, type SiteParleyKind } from "@cb/shared";
import { TEMPLATES } from "@cb/shared";
import type { AnyTemplate, BaseState, UseSpec } from "@cb/shared";

/**
 * The scenario RUNNER (D-034). Template-agnostic: it knows no scenario rules. Each template (shared/scenarios/*) is a pure state machine; this class
 * (1) spawns the template's people through the Cast, (2) turns what it observes in the room (who is near what, group counts, who saw whom, shots, deaths,
 * a wagon arriving) into the template's events, (3) carries out the effects the template answers with (orders, parleys, wagon, explosions, the commit),
 * and (4) publishes the view. Clients never send events: they send INTERACT and a parley option index, and every entry point validates who is asking
 * and from where. The Cast (not this class) runs every NPC row; the room ticks `cast.tick(dt)` once per server tick, before or after `tick` here.
 */

export interface ScenarioHost {
  players: PlayersView;
  worldMs(): number;
  campaign(): CampaignState;
  /** Called exactly once, when a run resolves (never for a run that was dismissed or started already resolved). */
  commit(o: ScenarioOutcome): void;
  cast: CastApi;
  /** Absent in a room without mounts: a template that needs the wagon then simply has no wagon to use. */
  mounts?: MountApi;
  consumeProp(id: string): void;
  propKind(id: string): number | undefined;
  propPos(id: string): { x: number; y: number; z: number } | undefined;
  propsNear(x: number, z: number, r: number, kind?: number): string[];
  spawnProp(kind: number, x: number, z: number): string | undefined;
  rebuildBridge(b: BridgeState): void;
  /** `owner` is the session id of whoever lit it ("" when nobody did): the blast follows the normal damage rules for that owner. */
  explode(x: number, y: number, z: number, radius: number, owner: string): void;
  publish(v: ScenarioView): void;
  send(sid: string, type: string, msg: unknown): void;
  /** The Ward's own parley (negotiation.ts), injected so this file imports none of it. */
  negotiation: {
    askingToll(c: CampaignState): number;
    leverageOf(c: CampaignState, live: { armed: number; garrisonAlive: number; garrisonTotal: number; partyWounded: number }): Leverage;
    openParley(c: CampaignState, lv: Leverage, seed: number): ParleyView;
    answerParley(c: CampaignState, lv: Leverage, seed: number, view: ParleyView, option: number): ParleyStep;
  };
  seed: number;
  groundY(x: number, z: number): number;
  /** D-035: what the Syndicate has in the region now (arrival time, escort, wagon); absent = the slice-1 numbers. */
  rivalPresence?(): RivalPresence | undefined;
}

const TICK_WATCH = 0.25, TICK_WEATHER = 1;
const PARLEY_LEASH = 6;
export const WET_SIGHT = 0.6, FOG_SIGHT = 0.5;
/** D-041: a crouching person is seen from this fraction of a watcher's range (the playtest crept up to the Orchard's cage bent double and was spotted at 5 m, as if strolling). */
export const CROUCH_SIGHT = 0.55;
/** D-041: metres from a standing member of the party inside which an escort boards with them (a follower that is not sprinting lags up to 14 m). */
export const BOARD_R = 20;
const LINE_HOSTILE = "You have made your point, with a bullet.";
const LINE_FUSE = "The Lamp-Warden hears a fuse, closes her ledger, and ends the audience.";
const LINE_RIVAL = "A gentleman from the Syndicate is waiting behind you with a cheque and a pen.";
const LINE_WANDER = "You wander off mid-sentence. The other party notes the time.";
const LINE_EXCUSED = "You excuse yourself. Nobody excuses you.";
const LINE_OVER = "Events have overtaken the conversation.";
const popcount = (n: number): number => { let c = 0; for (let v = n & 0xff; v; v &= v - 1) c++; return c; };

interface ParleyRun { owner: string; kind: ParleyKind; view: ParleyView; at: string; price: number }

export class Scenario {
  private readonly def: AnyTemplate;
  private s!: BaseState;
  private specs: NpcSpec[] = [];
  private bySpecKey = new Map<string, NpcSpec>();
  private spawned = new Set<string>();
  private started = false;
  private committed = false;
  private despawned = false;
  private parley: ParleyRun | undefined;
  private parleySeed = 0;
  private wagonId: string | undefined;
  private props = new Map<string, { id: string; x: number; z: number }>();
  private woundedSeen = new Set<string>();
  private limbs = new Map<string, number>();
  private nearSig = new Map<string, number>();
  private countSig = new Map<string, string>();
  private routedSeen = new Map<string, number>();
  private seeing = new Map<string, boolean>();
  private actorDone = new Set<string>();
  private wasWet = false;
  private complication = "none";
  private lastView = "";
  private lastEnds = 0;
  private acc = { weather: 0, watch: 0 };
  /** Who pressed INTERACT last (the blast's owner, whom a freed hostage follows) and who a `say` should go to during a press (undefined: everybody). */
  private actor = "";
  private audience: string | undefined;
  /** Who opened the parley being set up (the `parley` effect arrives while the press is still being handled). */
  private talker: { sid: string; at: string } | undefined;
  private wx = createWeather();
  private real: PlayerStateType[] = [];
  private realIds: string[] = [];
  private collect = (p: PlayerStateType, id: string): void => {
    if (isNpcKey(id)) return;
    this.real.push(p);
    this.realIds.push(id);
  };

  constructor(private readonly host: ScenarioHost, id: ScenarioTemplateId) {
    this.def = TEMPLATES[id];
  }

  get template(): ScenarioTemplateId { return this.def.id; }
  /** The phase on show ("" before start): the HUD and the room read it. */
  get phase(): string { return this.started ? this.s.phase : ""; }
  get resolution(): string | undefined { return this.started ? this.s.resolution : undefined; }

  start(): void {
    if (this.started) return;
    const c = this.host.campaign();
    const def = this.def;
    const presence = this.host.rivalPresence?.();
    this.s = def.init(c, this.host.negotiation.askingToll(c), this.host.seed, presence);
    this.parleySeed = hash3(this.host.seed, c.day, 0x7a11);
    this.started = true;
    for (const [name, pts] of Object.entries(def.routes ?? {})) this.host.cast.defineRoute(name, pts);
    this.specs = def.roster(c, this.host.seed, this.s, presence);
    for (const sp of this.specs) this.bySpecKey.set(npcKey(sp.id), sp);
    this.spawnGroups((g) => !g.startsWith("late:"));
    if (def.wagon && this.host.mounts) {
      this.wagonId = this.host.mounts.spawnWagon(def.wagon.at, { coat: hash3(this.host.seed, c.day, 0xc0a7), crates: def.wagon.crates, horse: true });
    }
    for (const p of def.props ?? []) {
      const id = this.host.spawnProp(p.kind, p.x, p.z);
      if (id !== undefined) this.props.set(p.id, { id, x: p.x, z: p.z });
    }
    for (const f of def.opening?.(this.s) ?? []) this.fx(f);
    this.publish(true);
  }

  // ---- entry points from the room (all validated here) -----------------------------------------------------------------------------------------

  /** INTERACT pressed by `sid`. Returns true when the press was taken (so the room does not also pick a prop up). `carriedProp` is the prop id the server recorded as held by `sid`. */
  onInteract(sid: string, p: PlayerStateType, carriedProp?: string): boolean {
    if (!this.started || isNpcKey(sid) || !p || (p.flags & FLAG.DOWNED) !== 0 || this.s.phase === "resolved") return false;
    this.refresh();
    const carrying = (p.flags & FLAG.CARRYING) !== 0;
    for (const u of this.def.observe.use) {
      const at = this.locate(u);
      if (!at || Math.hypot(p.x - at.x, p.z - at.z) > u.r) continue;
      if (u.carry === "barrel" || u.carry === "crate") {
        if (!carrying || carriedProp === undefined || this.host.propKind(carriedProp) !== (u.carry === "barrel" ? PropKind.BARREL : PropKind.CRATE)) continue;
        if (u.prop !== undefined && this.props.get(u.prop)?.id !== carriedProp) continue;
      } else if (u.carry === "none" && carrying) continue;
      this.actor = sid;
      this.audience = sid;
      try {
        if (u.talk) this.talk(sid, u);
        else {
          this.observeNear();
          const before = this.s;
          this.apply({ t: "use", target: u.id, slot: Number.isInteger(p.slot) ? p.slot : 0 });
          if (this.s !== before && u.consume && carriedProp !== undefined) this.host.consumeProp(carriedProp);
        }
      } finally {
        this.audience = undefined;
      }
      this.publish(false);
      return true;
    }
    return false;
  }

  onPick(sid: string, option: number): void {
    const pr = this.parley;
    if (!this.started || !pr || pr.owner !== sid) return;
    if (!Number.isInteger(option) || option < 0 || option >= pr.view.options.length) return;
    this.refresh();
    const c = this.host.campaign();
    this.actor = sid;
    if (pr.kind === "warden") {
      const step = this.host.negotiation.answerParley(c, this.leverage(c), this.parleySeed, pr.view, option);
      if (step.view) {
        pr.view = step.view;
        this.host.send(sid, "parley", { view: step.view });
        return;
      }
      const d = step.done;
      this.closeParley(step.line);
      if (d.resolution === "paid" || d.resolution === "bargained" || d.resolution === "bribed") this.apply({ t: "deal", resolution: d.resolution, toll: d.toll, paid: d.paid });
      else if (d.resolution === "hostile") {
        this.apply({ t: "parley_close" });
        this.apply({ t: "hostile", at: "ward" });
      } else this.apply({ t: "parley_close" });
      this.publish(false);
      return;
    }
    const step = answerSiteParley(pr.kind as SiteParleyKind, { price: pr.price, purse: c.purse, seed: this.parleySeed, day: c.day }, pr.view, option);
    if (step.view) {
      pr.view = step.view;
      this.host.send(sid, "parley", { view: step.view });
      if (step.emit) this.apply({ t: "talk", kind: pr.kind, result: step.emit, paid: 0 });
      this.publish(false);
      return;
    }
    const kind = pr.kind;
    this.audience = sid;
    this.closeParley(step.line);
    if (step.done.result === "walked") this.apply({ t: "talk", kind, result: "close", paid: 0 });
    else this.apply({ t: "talk", kind, result: step.done.result, paid: step.done.paid });
    this.audience = undefined;
    this.publish(false);
  }

  onParleyClose(sid: string): void {
    const pr = this.parley;
    if (!this.started || !pr || pr.owner !== sid) return;
    this.closeParley(LINE_EXCUSED);
    this.endTalk(pr.kind);
    this.publish(false);
  }

  /** A hit landed (Casualties.damage). `down` = this hit put the victim down. Tallies and first blood are counted from here. */
  onDamage(victim: string, attacker: string, _zone: number, down: boolean): void {
    if (!this.started || this.s.phase === "resolved") return;
    const add: Partial<CasualtyTally> = {};
    if (!this.woundedSeen.has(victim)) {
      this.woundedSeen.add(victim);
      add.wounded = 1;
    }
    if (down) add.downed = 1;
    const sp = this.bySpecKey.get(victim);
    if (sp && down) {
      if (sp.side === "ward") add.garrisonKilled = 1;
      else if (sp.side === "rival") add.rivalKilled = 1;
      else if (sp.side === "neutral") add.civiliansHarmed = 1;
    }
    if (add.wounded || add.downed) this.apply({ t: "tally", add });
    if (sp && !isNpcKey(attacker) && attacker !== "") {
      // first blood on anyone who is somebody's side is the declaration; a hostage or a driver is a bystander, but a bystander who is downed is a loss
      if (sp.id === "hostage" && down) this.apply({ t: "actor", id: "hostage", state: "down" });
      else if (this.def.observe.hostileGroups.includes(sp.group)) this.apply({ t: "hostile", at: sp.group });
    }
    this.publish(false);
  }

  /** D-041: a person's round passed close by `victim` (Combat.nearMisses). For anyone who is somebody's side, being shot at is the same declaration as first blood. */
  onShotAt(attacker: string, victim: string): void {
    if (!this.started || this.s.phase === "resolved" || isNpcKey(attacker) || attacker === "") return;
    const sp = this.bySpecKey.get(victim);
    if (sp && sp.id !== "hostage" && this.def.observe.hostileGroups.includes(sp.group)) this.apply({ t: "hostile", at: sp.group });
  }

  /** A report carried `radius` metres from (x, z) (a shot, a blast). The site hears it as `noise`, loudest at its centre. */
  onNoise(x: number, z: number, radius: number, _src: string): void {
    const n = this.def.observe.noise;
    if (!this.started || !n || this.s.phase === "resolved" || !Number.isFinite(x + z + radius) || radius <= 0) return;
    const d = Math.hypot(x - n.x, z - n.z);
    if (d > radius) return;
    const level = Math.round(100 * (1 - d / radius));
    if (level >= 1) {
      this.apply({ t: "noise", level });
      this.publish(false);
    }
  }

  /** Something happened to a prop (`destroyed` before the room removes it). A barrel that goes up within reach of the wagon is the convoy's third ending. */
  onProp(what: "delivered" | "destroyed" | "seized", id: string): void {
    if (!this.started || this.s.phase === "resolved" || what !== "destroyed") return;
    let name = "";
    let pos: { x: number; z: number } | undefined = this.host.propPos(id);
    for (const [n, p] of this.props) if (p.id === id) { name = n; pos ??= p; }
    if (name === "" && this.host.propKind(id) === PropKind.BARREL) name = "barrel";
    if (name === "" || !pos) return;
    const w = this.wagonId !== undefined ? this.host.mounts?.pos(this.wagonId) : undefined;
    if (!w) return;
    this.apply({ t: "prop", what: "destroyed", at: name, n: Math.round(Math.hypot(pos.x - w.x, pos.z - w.z)) });
    this.publish(false);
  }

  /** The party sails away (the room calls this BEFORE `dispose`). The template says what that commits: nothing when nothing happened, else its own ending. */
  leave(): void {
    if (!this.started || this.s.phase === "resolved") return;
    this.refresh();
    this.board();
    this.apply({ t: "leave" }); // (a run the boarding just resolved is frozen: no second commit)
    this.publish(true);
  }

  /** An escort (`boards`) standing near a standing member of the party when it sails gets into the boat with them: it has arrived. */
  private board(): void {
    for (const a of this.def.observe.actors) {
      if (!a.boards || this.actorDone.has(`${a.id}:arrived`) || this.actorDone.has(`${a.id}:down`)) continue;
      const row = this.host.cast.row(a.id);
      if (!row || (row.flags & FLAG.DOWNED) !== 0) continue;
      const near = this.real.some((p) => p.connected && (p.flags & FLAG.DOWNED) === 0 && Math.hypot(p.x - row.x, p.z - row.z) <= BOARD_R);
      if (!near) continue;
      this.actorDone.add(`${a.id}:arrived`);
      this.apply({ t: "actor", id: a.id, state: "arrived" });
    }
  }

  tick(dt: number): void {
    if (!this.started) return;
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 5) : 0;
    this.refresh();
    this.apply({ t: "tick", dt: step });
    this.acc.weather += step;
    this.acc.watch += step;
    if (this.acc.weather >= TICK_WEATHER) {
      this.acc.weather = 0;
      this.readWeather();
    }
    if (this.acc.watch >= TICK_WATCH) {
      this.acc.watch = 0;
      this.watch();
      this.publish(false);
    }
    if (!this.despawned && lingerDone(this.s)) this.despawnAll();
  }

  dispose(): void {
    this.despawnAll();
    this.started = false;
    this.parley = undefined;
  }

  // ---- the machine -----------------------------------------------------------------------------------------------------------------------

  private apply(e: ScenarioInput): void {
    const r = this.def.reduce(this.s, e);
    this.s = r.s;
    for (const f of r.fx) this.fx(f);
    if (this.parley && this.s.parley === undefined) {
      const crossing = this.def.id === "secure_crossing";
      this.closeParley(e.t === "hostile" ? LINE_HOSTILE : e.t === "use" || e.t === "charge_set" ? LINE_FUSE : e.t === "tick" ? (crossing ? LINE_RIVAL : LINE_OVER) : LINE_EXCUSED);
    }
  }

  private fx(f: ScenarioFx | string): void {
    if (typeof f === "string") {
      if (f === "commit") this.commitOnce();
      return;
    }
    const cast = this.host.cast;
    switch (f.k) {
      case "spawn": this.spawnGroups((g) => g === f.group); break;
      case "order": cast.order(f.group, f.order); break;
      case "war": cast.setWar(f.a, f.b, f.on); break;
      case "say": this.tell(f.text); break;
      case "open":
        if (f.what === "cage") cast.order("hostage", { o: "follow", target: this.actor });
        break;
      case "explode": {
        const at = f.at === "wagon" && this.wagonId !== undefined ? this.host.mounts?.pos(this.wagonId) : this.def.sites?.[f.at];
        if (at) this.host.explode(at.x, this.host.groundY(at.x, at.z), at.z, f.at === "pier" ? SCENARIO.chargeRadius : 6, this.actor);
        break;
      }
      case "bridge": this.host.rebuildBridge(f.state); break;
      case "wagon": this.wagon(f.op); break;
      case "parley": this.openParley(f.kind, f.price); break;
      case "commit": this.commitOnce(); break;
    }
  }

  private wagon(op: "go" | "halt" | "seize" | "wreck"): void {
    const m = this.host.mounts, id = this.wagonId;
    if (!m || id === undefined || !this.def.wagon) return;
    switch (op) {
      case "go": m.route(id, this.def.wagon.route); break;
      case "halt": m.route(id, ""); break;
      case "wreck": m.wreck(id, true); break;
      case "seize": this.apply({ t: "prop", what: "seized", at: "wagon", n: Math.max(0, Math.round(m.seize(id, this.actor))) }); break;
    }
  }

  private commitOnce(): void {
    const o = this.def.outcome(this.s);
    if (!o || this.committed) return;
    this.committed = true;
    this.host.commit(o);
  }

  private spawnGroups(want: (group: string) => boolean): void {
    const list: NpcSpec[] = [];
    for (const sp of this.specs) if (want(sp.group) && !this.spawned.has(sp.id)) { this.spawned.add(sp.id); list.push(sp); }
    if (list.length > 0) this.host.cast.spawn(list);
  }

  // ---- talking ---------------------------------------------------------------------------------------------------------------------------

  private talk(sid: string, u: UseSpec): void {
    const kind = u.talk!;
    if (this.parley) {
      if (this.parley.owner !== sid) this.host.send(sid, "notice", { text: "Somebody in your party is already talking to them. They can only ignore so many of you at once." });
      return;
    }
    this.talker = { sid, at: u.npc ?? u.id };
    if (kind === "warden") {
      this.apply({ t: "arrive", party: Math.max(1, this.countNear(this.def.observe.near.find((n) => n.id === "bar"))) });
      this.apply({ t: "parley_open" });
    } else this.apply({ t: "talk", kind, result: "open", paid: 0 });
    this.talker = undefined;
  }

  private openParley(kind: ParleyKind, price: number): void {
    const who = this.talker;
    if (!who || this.parley) return;
    const c = this.host.campaign();
    const view = kind === "warden"
      ? this.host.negotiation.openParley(c, this.leverage(c), this.parleySeed)
      : openSiteParley(kind as SiteParleyKind, { price, purse: c.purse, seed: this.parleySeed, day: c.day });
    this.parley = { owner: who.sid, kind, view, at: who.at, price };
    this.host.send(who.sid, "parley", { view });
  }

  /** The conversation is over without a deal. */
  private endTalk(kind: ParleyKind): void {
    if (kind === "warden") this.apply({ t: "parley_close" });
    else this.apply({ t: "talk", kind, result: "close", paid: 0 });
  }

  private closeParley(line: string): void {
    const pr = this.parley;
    if (!pr) return;
    this.parley = undefined;
    this.host.send(pr.owner, "parley", { closed: true, line });
  }

  // ---- observation (4 Hz) ----------------------------------------------------------------------------------------------------------------

  private watch(): void {
    this.noteLimbsAll();
    if (this.s.phase === "resolved") return;
    let connected = 0, down = 0;
    for (const p of this.real) {
      if (!p.connected) continue;
      connected++;
      if ((p.flags & FLAG.DOWNED) !== 0) down++;
    }
    if (connected > 0 && down === connected) {
      this.apply({ t: "party_down" });
      return;
    }
    this.leash();
    this.observeNear();
    this.observeCounts();
    this.observeSeen();
    this.observeActors();
  }

  private observeNear(): void {
    for (const n of this.def.observe.near) {
      const k = this.countNear(n);
      const was = this.nearSig.get(n.id);
      if (was === k || (was === undefined && k === 0)) continue;
      this.nearSig.set(n.id, k);
      this.apply({ t: "near", at: n.id, party: k });
    }
  }

  private observeCounts(): void {
    for (const o of this.def.observe.count) {
      const c = this.host.cast.count(o.group);
      const sig = `${c.alive}/${c.routed}/${c.down}/${c.total}`;
      if (sig === this.countSig.get(o.group)) continue;
      this.countSig.set(o.group, sig);
      const prev = this.routedSeen.get(o.group) ?? 0;
      if (o.routed && c.routed > prev) {
        this.apply({ t: "tally", add: { [o.routed]: c.routed - prev } as Partial<CasualtyTally> });
        this.routedSeen.set(o.group, c.routed);
      }
      this.apply({ t: "count", group: o.group, alive: c.alive, routed: c.routed, down: c.down, total: c.total });
    }
  }

  /** Who has seen the party: a standing member of the group within `sight` metres of a standing human (shorter in rain and fog, and for someone crouching). Edge-triggered. */
  private observeSeen(): void {
    if (this.def.observe.seen.length === 0) return;
    const k = (this.wasWet ? WET_SIGHT : 1) * (this.complication === "fog" ? FOG_SIGHT : 1) * (this.complication === "rain" ? WET_SIGHT : 1);
    for (const o of this.def.observe.seen) {
      const range = o.sight * k;
      let sees = false;
      for (const sp of this.specs) {
        if (sp.group !== o.group || !this.spawned.has(sp.id)) continue;
        const row = this.host.cast.row(sp.id);
        if (!row || (row.flags & FLAG.DOWNED) !== 0) continue;
        for (const p of this.real) {
          if (!p.connected || (p.flags & FLAG.DOWNED) !== 0) continue;
          if (Math.hypot(p.x - row.x, p.z - row.z) <= ((p.flags & FLAG.CROUCHING) !== 0 ? range * CROUCH_SIGHT : range)) { sees = true; break; }
        }
        if (sees) break;
      }
      const was = this.seeing.get(o.group) ?? false;
      this.seeing.set(o.group, sees);
      if (sees && !was) this.apply({ t: "seen", group: o.group });
    }
  }

  private observeActors(): void {
    for (const a of this.def.observe.actors) {
      let pos: { x: number; z: number } | undefined;
      let isDown = false;
      if (a.id === "wagon") pos = this.wagonId !== undefined ? this.host.mounts?.pos(this.wagonId) : undefined;
      else {
        const row = this.host.cast.row(a.id);
        if (row) { pos = row; isDown = (row.flags & FLAG.DOWNED) !== 0; }
      }
      if (!pos) continue;
      if (isDown) {
        if (!this.actorDone.has(`${a.id}:down`)) {
          this.actorDone.add(`${a.id}:down`);
          this.apply({ t: "actor", id: a.id, state: "down" });
        }
        continue;
      }
      if (a.goal && !this.actorDone.has(`${a.id}:arrived`) && Math.hypot(pos.x - a.goal.x, pos.z - a.goal.z) <= a.goal.r) {
        this.actorDone.add(`${a.id}:arrived`);
        this.apply({ t: "actor", id: a.id, state: "arrived" });
      }
    }
  }

  /** A parley is leashed to its speaker: walk off, go down or lose the speaker and it closes. */
  private leash(): void {
    const pr = this.parley;
    if (!pr) return;
    const owner = this.host.players.get(pr.owner);
    const them = this.host.cast.row(pr.at);
    if (!owner || !owner.connected || (owner.flags & FLAG.DOWNED) !== 0 || !them || (them.flags & FLAG.DOWNED) !== 0 || Math.hypot(owner.x - them.x, owner.z - them.z) > PARLEY_LEASH) {
      this.closeParley(LINE_WANDER);
      this.endTalk(pr.kind);
    }
  }

  private noteLimbsAll(): void {
    for (let i = 0; i < this.real.length; i++) this.noteLimbs(this.realIds[i]!, this.real[i]!);
    for (const sp of this.specs) {
      if (!this.spawned.has(sp.id) || this.despawned) continue;
      const row = this.host.cast.row(sp.id);
      if (row) this.noteLimbs(npcKey(sp.id), row);
    }
  }

  private noteLimbs(id: string, p: PlayerStateType): void {
    const n = popcount(p.missing);
    const before = this.limbs.get(id);
    this.limbs.set(id, n);
    if (before !== undefined && n > before && this.s.phase !== "resolved") this.apply({ t: "tally", add: { limbsLost: n - before } });
  }

  private readWeather(): void {
    weatherAt(this.host.seed, this.host.worldMs(), this.wx);
    const wet = this.wx.rain >= SCENARIO.wetRain;
    if (wet === this.wasWet) return;
    this.wasWet = wet;
    this.apply({ t: "weather", rain: wet ? this.wx.rain : 0 });
    if (this.s.phase !== "resolved") {
      const crossing = this.def.id === "secure_crossing";
      this.tell(wet ? (crossing ? "Rain. Fuses sputter; sentries squint and see rather less." : "Rain. Footsteps carry less and everybody sees rather less.") : "The rain eases. Everyone sees rather more.");
    }
  }

  private despawnAll(): void {
    if (this.despawned) return;
    this.despawned = true;
    // only OUR groups: hired hands and their like belong to somebody else
    const groups = new Set<string>();
    for (const sp of this.specs) groups.add(sp.group);
    for (const g of groups) this.host.cast.despawn(g);
    if (this.wagonId !== undefined) this.host.mounts?.remove(this.wagonId);
    this.wagonId = undefined;
  }

  // ---- helpers ---------------------------------------------------------------------------------------------------------------------------

  private locate(u: UseSpec): { x: number; z: number } | undefined {
    if (u.npc !== undefined) {
      const row = this.host.cast.row(u.npc);
      return row && (row.flags & FLAG.DOWNED) === 0 ? row : undefined;
    }
    if (u.mount) return this.wagonId !== undefined ? this.host.mounts?.pos(this.wagonId) : undefined;
    return u.at;
  }

  private refresh(): void {
    this.real.length = 0;
    this.realIds.length = 0;
    this.host.players.forEach(this.collect);
  }

  private tell(text: string): void {
    if (this.audience !== undefined) {
      this.host.send(this.audience, "notice", { text });
      return;
    }
    this.refresh();
    for (const id of this.realIds) this.host.send(id, "notice", { text });
  }

  private countNear(n: { x: number; z: number; r: number } | undefined): number {
    if (!n) return 0;
    let k = 0;
    for (const p of this.real) if (p.connected && (p.flags & FLAG.DOWNED) === 0 && Math.hypot(p.x - n.x, p.z - n.z) <= n.r) k++;
    return k;
  }

  private leverage(c: CampaignState): Leverage {
    let armed = 0, wounded = 0;
    for (const p of this.real) {
      if (!p.connected) continue;
      if (p.weapon !== 0 && (p.flags & FLAG.DOWNED) === 0) armed++;
      if (p.wounds !== 0 || p.missing !== 0) wounded++;
    }
    const g = this.host.cast.count("ward");
    return this.host.negotiation.leverageOf(c, { armed, garrisonAlive: g.alive, garrisonTotal: g.total, partyWounded: wounded });
  }

  /** Republish only when the picture changed (or the timer moved by more than half a second). */
  private publish(force: boolean): void {
    const v = this.def.view(this.s, this.host.worldMs());
    this.complication = v.complication ?? "none";
    const sig = JSON.stringify([v.phase, v.objectives, v.hint, v.timerLabel, v.resolution ?? "", v.title]);
    if (!force && sig === this.lastView && Math.abs(v.endsAtWorldMs - this.lastEnds) < 600) return;
    this.lastView = sig;
    this.lastEnds = v.endsAtWorldMs;
    this.host.publish(v);
  }
}
