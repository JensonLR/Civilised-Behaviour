import {
  FLAG, PropKind, createWeather, hash3, weatherAt, type MoveCommand, type PlayerStateType,
  KESSAR_ANCHORS, NPC, SCENARIO, garrisonRoster, isNpcKey, lingerOver, newBrain, newScenario, npcDecide, npcKey, reduceScenario, scenarioOutcome, scenarioView,
  type BridgeState, type CampaignState, type CasualtyTally, type Leverage, type NpcBrain, type NpcBody, type NpcSenses, type NpcSpec, type ParleyStep, type ParleyView,
  type ScenarioEffect, type ScenarioInput, type ScenarioOutcome, type ScenarioState, type ScenarioView,
} from "@cb/shared";

/**
 * "Secure the river crossing" on the server. The pure machine (shared/scenario.ts) owns every phase decision; this class observes the room,
 * feeds it events, acts on its effects and runs the cast through the same movement + combat path a player uses. Clients only ever see
 * `publish(view)` and their own `parley` messages; nothing a client sends is an event. Every entry point validates who is asking and from where.
 */

export interface ScenarioHost {
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void; get(id: string): PlayerStateType | undefined };
  worldMs(): number;
  campaign(): CampaignState;
  /** Called exactly once, when a run resolves (never for a run that started already resolved). */
  commit(o: ScenarioOutcome): void;
  /** Creates the NPC row keyed `npcKey(spec.id)`; false when at NPC_CAP. `removeNpc` / `stepNpc` take that row key. */
  spawnNpc(spec: NpcSpec): boolean;
  removeNpc(key: string): void;
  /** stepCharacter + Combat.onFrame for that row. The command object is reused by the caller: copy it if you keep it. */
  stepNpc(key: string, cmd: MoveCommand): void;
  explode(x: number, y: number, z: number, radius: number): void;
  consumeProp(id: string): void;
  propKind(id: string): number | undefined;
  rebuildBridge(state: BridgeState): void;
  publish(view: ScenarioView): void;
  send(sid: string, type: string, msg: unknown): void;
  /** Package A's functions, injected so this file never imports them. */
  negotiation: {
    askingToll(c: CampaignState): number;
    leverageOf(c: CampaignState, live: { armed: number; garrisonAlive: number; garrisonTotal: number; partyWounded: number }): Leverage;
    openParley(c: CampaignState, lv: Leverage, seed: number): ParleyView;
    answerParley(c: CampaignState, lv: Leverage, seed: number, view: ParleyView, option: number): ParleyStep;
  };
  seed: number;
  /** Terrain height for the blast; 0 when the host has none to give. */
  groundY?(x: number, z: number): number;
}

interface Rec { spec: NpcSpec; key: string; brain: NpcBrain }

const TICK_ARRIVE = 1, TICK_WEATHER = 1, TICK_WATCH = 0.25;
const SIGHT_CLEAR = 28, SIGHT_WET = 16, ALLY_RANGE = 15;
const PARLEY_LEASH = 6;
const LINE_HOSTILE = "You have made your point, with a bullet.";
const LINE_FUSE = "The Lamp-Warden hears a fuse, closes her ledger, and ends the audience.";
const LINE_RIVAL = "A gentleman from the Syndicate is waiting behind you with a cheque and a pen.";
const LINE_WANDER = "You wander off mid-sentence. She notes the time.";
const LINE_EXCUSED = "You excuse yourself. She does not excuse you.";
const popcount = (n: number): number => { let c = 0; for (let v = n & 0xff; v; v &= v - 1) c++; return c; };

export class Scenario {
  private s!: ScenarioState;
  private recs: Rec[] = [];
  private byKey = new Map<string, Rec>();
  private started = false;
  private committed = false;
  private despawned = false;
  private detonated = false;
  private wardAlert = false;
  private rivalAlert = false;
  private standDown = false;
  private parley: { owner: string; view: ParleyView } | undefined;
  private parleySeed = 0;
  private woundedSeen = new Set<string>();
  private limbs = new Map<string, number>();
  private routedReported = 0;
  private gSig = "";
  private wasWet = false;
  private lastView = "";
  private lastEnds = 0;
  private acc = { arrive: 0, weather: 0, watch: 0 };
  private fear = 10;
  // scratch (the per-tick path allocates nothing)
  private cmd: MoveCommand = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };
  private body: NpcBody = { x: 0, z: 0, facing: 0, health: 100, weapon: 0, ammo: 0, flags: 0 };
  private enemy = { id: "", x: 0, z: 0, armed: false, down: false };
  private senses: NpcSenses = { enemy: undefined, allies: 0, alert: false, standDown: false, fear: 0 };
  private wx = createWeather();
  private real: PlayerStateType[] = [];
  private realIds: string[] = [];
  private collect = (p: PlayerStateType, id: string): void => {
    if (isNpcKey(id)) return;
    this.real.push(p);
    this.realIds.push(id);
  };

  constructor(private readonly host: ScenarioHost) {}

  start(): void {
    if (this.started) return;
    const c = this.host.campaign();
    this.s = newScenario(c, this.host.negotiation.askingToll(c));
    this.fear = c.factions.ward.fear;
    this.parleySeed = hash3(this.host.seed, c.day, 0x7a11);
    this.started = true;
    const ruined = this.s.phase === "resolved";
    for (const spec of garrisonRoster(c, this.host.seed)) {
      if (ruined && spec.faction === "rival") continue; // nobody is buying a ruin
      if (!this.host.spawnNpc(spec)) continue;
      const rec: Rec = { spec, key: npcKey(spec.id), brain: newBrain(spec) };
      this.recs.push(rec);
      this.byKey.set(rec.key, rec);
    }
    if (ruined) this.standDown = true;
    this.publish(true);
  }

  // ---- entry points from the room (all validated here) -----------------------------------------------------------------------------------------

  /** INTERACT pressed by `sid`. Returns true when the press was taken (so the room does not also pick a prop up). `carriedProp` is the prop id the server recorded as held by `sid`. */
  onInteract(sid: string, p: PlayerStateType, carriedProp?: string): boolean {
    if (!this.started || isNpcKey(sid) || !p || (p.flags & FLAG.DOWNED) !== 0 || this.s.phase === "resolved") return false;
    this.refresh();
    const carrying = (p.flags & FLAG.CARRYING) !== 0;
    const pier = KESSAR_ANCHORS.pier;
    if (carrying && carriedProp !== undefined && Math.hypot(p.x - pier.x, p.z - pier.z) <= SCENARIO.pierRange) {
      if (this.host.propKind(carriedProp) !== PropKind.BARREL) return false;
      if (this.s.chargeArmed) {
        this.host.send(sid, "notice", { text: "There is already a fuse burning. Two would be showing off." });
        return true;
      }
      this.host.consumeProp(carriedProp);
      this.apply({ t: "charge_set" });
      this.tellAll("The fuse is lit. Ten seconds, give or take the weather. Clear the deck.");
      this.publish(false);
      return true;
    }
    if (carrying) return false;
    const warden = this.byKey.get(npcKey("warden"));
    const row = warden && this.host.players.get(warden.key);
    if (!warden || !row || Math.hypot(p.x - row.x, p.z - row.z) > SCENARIO.talkRange) return false;
    if ((row.flags & FLAG.DOWNED) !== 0) return false;
    if (this.parley) {
      if (this.parley.owner !== sid) this.host.send(sid, "notice", { text: "The Lamp-Warden is already dealing with one of your party. She can only ignore so many of you at once." });
      return true;
    }
    if (this.s.hostile || this.s.chargeArmed) {
      this.host.send(sid, "notice", { text: this.s.chargeArmed ? "She will not negotiate with a lit fuse in the vicinity." : "She is not taking audiences at the moment. She is taking cover." });
      return true;
    }
    this.apply({ t: "arrive", party: Math.max(1, this.countNear()) });
    this.apply({ t: "parley_open" });
    if (this.s.phase !== "parley") return true;
    const c = this.host.campaign();
    const view = this.host.negotiation.openParley(c, this.leverage(c), this.parleySeed);
    this.parley = { owner: sid, view };
    this.host.send(sid, "parley", { view });
    this.publish(false);
    return true;
  }

  onPick(sid: string, option: number): void {
    const pr = this.parley;
    if (!this.started || !pr || pr.owner !== sid || this.s.phase !== "parley") return;
    if (!Number.isInteger(option) || option < 0 || option >= pr.view.options.length) return;
    this.refresh();
    const c = this.host.campaign();
    const step = this.host.negotiation.answerParley(c, this.leverage(c), this.parleySeed, pr.view, option);
    if (step.view) {
      pr.view = step.view;
      this.host.send(sid, "parley", { view: step.view });
      return;
    }
    const d = step.done;
    if (d.resolution === "paid" || d.resolution === "bargained" || d.resolution === "bribed") {
      this.closeParley(step.line);
      this.apply({ t: "deal", resolution: d.resolution, toll: d.toll, paid: d.paid });
    } else if (d.resolution === "hostile") {
      this.closeParley(step.line);
      this.apply({ t: "parley_close" });
      this.apply({ t: "hostile" });
    } else {
      this.closeParley(step.line);
      this.apply({ t: "parley_close" });
    }
    this.publish(false);
  }

  onParleyClose(sid: string): void {
    if (!this.started || !this.parley || this.parley.owner !== sid) return;
    this.closeParley(LINE_EXCUSED);
    this.apply({ t: "parley_close" });
    this.publish(false);
  }

  /** A hit landed (Casualties.damage). `down` = this hit put the victim down. */
  onDamage(victim: string, attacker: string, _zone: number, down: boolean): void {
    if (!this.started || this.s.phase === "resolved") return;
    const add: Partial<CasualtyTally> = {};
    if (!this.woundedSeen.has(victim)) {
      this.woundedSeen.add(victim);
      add.wounded = 1;
    }
    if (down) add.downed = 1;
    const rec = this.byKey.get(victim);
    if (rec && down) {
      if (rec.spec.faction === "ward") add.garrisonKilled = 1;
      else add.rivalKilled = 1;
    }
    if (add.wounded || add.downed) this.apply({ t: "tally", add });
    if (rec && !isNpcKey(attacker)) {
      // first blood on anyone the Ward employs is the declaration of war; on the Syndicate it merely annoys them
      if (rec.spec.faction === "ward") this.hostile();
      else this.rivalAlert = true;
    }
    this.publish(false);
  }

  tick(dt: number): void {
    if (!this.started) return;
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), SCENARIO.maxDt) : 0;
    this.refresh();
    this.apply({ t: "tick", dt: step });
    const s = this.s;
    if (s.chargeArmed && s.fuse <= 0 && !this.detonated) this.detonate();
    if (this.s.chargeArmed && !this.s.hostile) this.checkChargeAlarm();

    this.acc.arrive += step;
    this.acc.weather += step;
    this.acc.watch += step;
    if (this.acc.arrive >= TICK_ARRIVE) {
      this.acc.arrive = 0;
      if (this.s.phase === "approach" || this.s.phase === "standoff") this.apply({ t: "arrive", party: this.countNear() });
    }
    if (this.acc.weather >= TICK_WEATHER) {
      this.acc.weather = 0;
      this.readWeather();
    }
    if (this.acc.watch >= TICK_WATCH) {
      this.acc.watch = 0;
      this.watch();
      this.publish(false);
    }
    this.runCast(step);
    if (!this.despawned && lingerOver(this.s)) this.despawnAll();
  }

  dispose(): void {
    this.despawnAll();
    this.started = false;
    this.parley = undefined;
  }

  // ---- the machine -----------------------------------------------------------------------------------------------------------------------

  private apply(e: ScenarioInput): void {
    const r = reduceScenario(this.s, e);
    this.s = r.s;
    for (const f of r.fx) this.effect(f);
    if (this.parley && !this.s.parley) this.closeParley(e.t === "hostile" ? LINE_HOSTILE : e.t === "charge_set" ? LINE_FUSE : e.t === "tick" ? LINE_RIVAL : LINE_EXCUSED);
  }

  private effect(f: ScenarioEffect): void {
    switch (f) {
      case "garrison_alert":
        this.wardAlert = true;
        this.tellAll("The horn on the gatehouse sounds. The Ward would like a word, and it is not the gentle one.");
        break;
      case "garrison_stand_down":
        this.standDown = true;
        break;
      case "gate_open":
        this.tellAll("The toll bar swings up. A sentry salutes, unsure whom.");
        break;
      case "rival_advance":
        for (const r of this.recs) if (r.spec.faction === "rival") {
          r.brain.mode = "march";
          r.brain.route = 0;
        }
        this.tellAll("A Dunmarrow-Vesk surveyor has left the Syndicate camp with a measuring chain and an entourage. They intend to buy the crossing.");
        break;
      case "commit":
        this.commitOnce();
        break;
      case "arm_charge":
        break;
    }
  }

  private commitOnce(): void {
    const o = scenarioOutcome(this.s);
    if (!o || this.committed) return;
    this.committed = true;
    this.host.commit(o);
  }

  private hostile(): void {
    if (this.s.hostile) return;
    this.apply({ t: "hostile" });
  }

  private detonate(): void {
    this.detonated = true;
    const p = KESSAR_ANCHORS.pier, b = KESSAR_ANCHORS.bridge;
    this.host.explode(p.x, this.host.groundY?.(p.x, p.z) ?? 0, p.z, SCENARIO.chargeRadius);
    // bodies on the deck who are not the party (the party is told to clear it): they go into the river with the masonry
    let onBridge = 0;
    for (const r of this.recs) {
      const row = this.host.players.get(r.key);
      if (row && (row.flags & FLAG.DOWNED) === 0 && Math.abs(row.x - b.x) <= b.width / 2 + 0.5 && Math.abs(row.z - b.z) <= b.length / 2) onBridge++;
    }
    this.host.rebuildBridge("collapsed");
    this.apply({ t: "bridge_fell", onBridge });
    this.tellAll("The bridge leaves. The paper will call it a structural event.");
  }

  private checkChargeAlarm(): void {
    const p = KESSAR_ANCHORS.pier;
    for (const r of this.recs) {
      if (r.spec.faction !== "ward" || r.brain.mode === "flee") continue;
      const row = this.host.players.get(r.key);
      if (row && (row.flags & FLAG.DOWNED) === 0 && Math.hypot(row.x - p.x, row.z - p.z) <= SCENARIO.chargeAlarmRange) {
        this.hostile();
        return;
      }
    }
  }

  private readWeather(): void {
    weatherAt(this.host.seed, this.host.worldMs(), this.wx);
    const wet = this.wx.rain >= SCENARIO.wetRain;
    if (wet === this.wasWet) return;
    this.wasWet = wet;
    this.apply({ t: "weather", rain: wet ? this.wx.rain : 0 });
    if (this.s.phase !== "resolved") this.tellAll(wet ? "Rain. Fuses sputter; sentries squint and see rather less." : "The rain eases. Everyone sees rather more.");
  }

  /** 4 Hz: limbs lost (tally), the whole-party-down check, parley leash, garrison count. */
  private watch(): void {
    let connected = 0, down = 0;
    for (let i = 0; i < this.real.length; i++) {
      const p = this.real[i]!;
      this.noteLimbs(this.realIds[i]!, p);
      if (!p.connected) continue;
      connected++;
      if ((p.flags & FLAG.DOWNED) !== 0) down++;
    }
    for (const r of this.recs) {
      const row = this.host.players.get(r.key);
      if (row) this.noteLimbs(r.key, row);
    }
    if (this.s.phase === "resolved") return;
    if (connected > 0 && down === connected) {
      this.apply({ t: "party_down" });
      return;
    }
    const pr = this.parley;
    if (pr) {
      const owner = this.host.players.get(pr.owner);
      const w = this.host.players.get(npcKey("warden"));
      if (!owner || !owner.connected || (owner.flags & FLAG.DOWNED) !== 0 || !w || (w.flags & FLAG.DOWNED) !== 0 || Math.hypot(owner.x - w.x, owner.z - w.z) > PARLEY_LEASH) {
        this.closeParley(LINE_WANDER);
        this.apply({ t: "parley_close" });
      }
    }
    this.reportGarrison();
  }

  private noteLimbs(id: string, p: PlayerStateType): void {
    const n = popcount(p.missing);
    const before = this.limbs.get(id);
    this.limbs.set(id, n);
    if (before !== undefined && n > before && this.s.phase !== "resolved") this.apply({ t: "tally", add: { limbsLost: n - before } });
  }

  private reportGarrison(): void {
    let total = 0, alive = 0, routed = 0;
    for (const r of this.recs) {
      if (r.spec.role !== NPC.SENTRY) continue;
      total++;
      const row = this.host.players.get(r.key);
      if (!row || (row.flags & FLAG.DOWNED) !== 0) continue;
      if (r.brain.mode === "flee") routed++;
      else alive++;
    }
    const sig = `${alive}/${routed}/${total}`;
    if (sig === this.gSig) return;
    this.gSig = sig;
    if (routed > this.routedReported) {
      this.apply({ t: "tally", add: { garrisonRouted: routed - this.routedReported } });
      this.routedReported = routed;
    }
    this.apply({ t: "garrison", alive, routed, total });
  }

  // ---- the cast --------------------------------------------------------------------------------------------------------------------------

  private runCast(dt: number): void {
    const wet = this.wasWet;
    const sight = wet ? SIGHT_WET : SIGHT_CLEAR;
    const sn = this.senses;
    const me = this.body;
    for (const r of this.recs) {
      const row = this.host.players.get(r.key);
      if (!row) continue;
      me.x = row.x; me.z = row.z; me.facing = row.facing; me.health = row.health; me.weapon = row.weapon; me.ammo = row.ammo; me.flags = row.flags;
      // nearest live player in sight
      let best = Infinity;
      let bi = -1;
      for (let i = 0; i < this.real.length; i++) {
        const p = this.real[i]!;
        if (!p.connected || (p.flags & FLAG.DOWNED) !== 0) continue;
        const d = Math.hypot(p.x - row.x, p.z - row.z);
        if (d < best && d <= sight) { best = d; bi = i; }
      }
      if (bi >= 0) {
        const p = this.real[bi]!;
        this.enemy.id = this.realIds[bi]!; this.enemy.x = p.x; this.enemy.z = p.z; this.enemy.armed = p.weapon !== 0; this.enemy.down = false;
        sn.enemy = this.enemy;
      } else sn.enemy = undefined;
      let allies = 0;
      for (const o of this.recs) {
        if (o === r || o.spec.faction !== r.spec.faction || o.brain.mode === "flee") continue;
        const orow = this.host.players.get(o.key);
        if (orow && (orow.flags & FLAG.DOWNED) === 0 && Math.hypot(orow.x - row.x, orow.z - row.z) <= ALLY_RANGE) allies++;
      }
      const ward = r.spec.faction === "ward";
      sn.allies = allies;
      sn.alert = ward ? this.wardAlert : this.rivalAlert;
      sn.standDown = this.standDown;
      sn.fear = ward ? this.fear : 10;
      npcDecide(r.brain, me, sn, dt, this.cmd);
      this.host.stepNpc(r.key, this.cmd);
    }
  }

  private despawnAll(): void {
    if (this.despawned) return;
    this.despawned = true;
    for (const r of this.recs) this.host.removeNpc(r.key);
    this.recs.length = 0;
    this.byKey.clear();
  }

  // ---- helpers ---------------------------------------------------------------------------------------------------------------------------

  private closeParley(line: string): void {
    const pr = this.parley;
    if (!pr) return;
    this.parley = undefined;
    this.host.send(pr.owner, "parley", { closed: true, line });
  }

  private refresh(): void {
    this.real.length = 0;
    this.realIds.length = 0;
    this.host.players.forEach(this.collect);
  }

  private tellAll(text: string): void {
    this.refresh();
    for (const id of this.realIds) this.host.send(id, "notice", { text });
  }

  private countNear(): number {
    const t = KESSAR_ANCHORS.tollBar;
    let n = 0;
    for (const p of this.real) if (p.connected && Math.hypot(p.x - t.x, p.z - t.z) <= SCENARIO.arriveRange) n++;
    return n;
  }

  private leverage(c: CampaignState): Leverage {
    let armed = 0, wounded = 0;
    for (const p of this.real) {
      if (!p.connected) continue;
      if (p.weapon !== 0 && (p.flags & FLAG.DOWNED) === 0) armed++;
      if (p.wounds !== 0 || p.missing !== 0) wounded++;
    }
    return this.host.negotiation.leverageOf(c, { armed, garrisonAlive: this.s.alive, garrisonTotal: this.s.total, partyWounded: wounded });
  }

  /** Republish only when the picture changed (or the timer moved by more than half a second). */
  private publish(force: boolean): void {
    const v = scenarioView(this.s, this.host.worldMs());
    const sig = JSON.stringify([v.phase, v.objectives, v.hint, v.timerLabel, v.resolution ?? ""]);
    if (!force && sig === this.lastView && Math.abs(v.endsAtWorldMs - this.lastEnds) < 600) return;
    this.lastView = sig;
    this.lastEnds = v.endsAtWorldMs;
    this.host.publish(v);
  }
}
