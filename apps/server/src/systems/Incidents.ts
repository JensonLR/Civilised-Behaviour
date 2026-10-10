import { FLAG, type PlayerStateType } from "@cb/shared";
import { npcKey, type CampaignState, type CastApi, type NpcSpec, type PlayersView, type RegionId, type ScenarioTemplateId } from "@cb/shared";
import {
  INCIDENT, INCIDENT_DONE, INCIDENT_OPEN, bandName, dealIncident, horseName, incidentDelayS, incidentDue, incidentRoster, incidentStep, placeIncident, ringOpen, wagonName,
  type IncidentEvent, type IncidentId, type IncidentRecord, type IncidentResult,
} from "@cb/shared";

/**
 * INCIDENTS (D-052, docs/_notes/incidents.md): the server half of chaos during play. `shared/incidents.ts` deals it, places it, names its people, says what settles it
 * and what it does to the campaign; this class spawns the people through the Cast, watches them (a revive, a press, a shot), and hands the result to the room's commit.
 * At most one per contract run, and nothing at the hub. It never touches the scenario: the two only meet in the room's commit, where the incident's record rides on the
 * contract's outcome (so a run dismissed before anything happened commits nothing, incident included).
 */
export interface IncidentsHost {
  /** The real party (no NPC rows). */
  party: PlayersView;
  cast: CastApi;
  campaign(): CampaignState;
  region(): RegionId;
  bounds(): number;
  seed: number;
  notice(text: string): void;
  /** Where the people with guns are (NPC rows on neither the party's side nor neutral, standing): the incident is placed clear of them. */
  hostiles(): { x: number; z: number }[];
  /** Open, DRY ground (the nav grid's open cells include the shallows and the sea off a landing: the first look put a courier in the surf). */
  land(x: number, z: number): boolean;
  /** True while the contract's fight is on: an incident waits for calm. */
  fighting(): boolean;
  /** A deserter signs on as a hand where he stands; false when the tent is full. */
  join(name: string, lookSeed: number, at: { x: number; z: number }): boolean;
  /** A saddled horse with nobody on it at `at` (the mounts' own); "" when the room has no room for another mount. */
  looseHorse(at: { x: number; z: number }): string;
  /** Who rides mount `id` ("" nobody, or the mount is gone). */
  riderOf(id: string): string;
  /** D-071: spill `n` powder kegs in a ring round `at`, the first one lit on a `fuseS` fuse (credited to ACCIDENT_OWNER; none lit when `fuseS` is 0); the ids of those that could be placed. Optional. */
  spillKegs?(at: { x: number; z: number }, n: number, ring: number, fuseS: number): string[];
  /** Whether prop `id` is still in the world (a keg that went off is gone), and whether a fuse burns on it. */
  propLive?(id: string): boolean;
  propLit?(id: string): boolean;
  /** D-107: the pacing director: the party is coasting (the incident may come early), or the run is pressed (it waits). Optional: test hosts need not. */
  coasting?(): boolean;
  pressed?(): boolean;
  /** D-055: `sid` settled an incident kindly by their own hand (the honours list counts it). Optional. */
  kind?(sid: string): void;
  hasRoom(): boolean;
}

/** How often the courier is re-pointed at the nearest player (seconds). */
const COURIER_REAIM_S = 2;
/** A settled courier or deserter turns away and is off the ground this many seconds later (his USE prompt went with him: it stayed while his body lingered). */
export const INCIDENT_LEAVE_S = 6;

export class Incidents {
  private id: IncidentId = "none";
  private t = 0;
  private delay = 0;
  private calm = 0;
  private live = false;
  private result: IncidentResult | undefined;
  private spec: NpcSpec | undefined;
  private wasDown = false;
  private reaim = 0;
  /** The runaway horse's mount id, and what the notices call it. */
  private horse = "";
  /** The name the notices give a horse or a wagon (they have no row of their own). */
  private horseLabel = "";
  /** D-071: the powder wagon's kegs. */
  private kegs: string[] = [];
  /** Seconds until a settled courier or deserter leaves the ground (0 = nobody leaving). */
  private leaving = 0;
  /** D-088: seconds of the collectors' invoice still to read (they open fire when it is done, or when one of them is hurt); -1 once they have. */
  private invoice = -1;

  constructor(private readonly host: IncidentsHost) {}

  /** The contract `template` has started in the current region: deal this run's incident ("none" more often than not). */
  begin(template: ScenarioTemplateId): void {
    this.reset();
    const c = this.host.campaign();
    this.id = dealIncident(c, template, this.host.region(), this.host.seed);
    this.delay = incidentDelayS(c, template, this.host.seed);
  }

  /** QA (the room's debug command): this run's incident is `id`, and it happens on the next tick that has somebody standing, calm or not. */
  force(id: Exclude<IncidentId, "none">): void {
    if (this.live) return;
    this.id = id;
    this.result = undefined;
    this.t = this.delay = 0;
    this.forced = true;
  }
  private forced = false;

  /** The people on the ground belong to an incident (revivable by the party; never reaped while it is live). */
  owns(key: string): boolean {
    return this.spec !== undefined && key === npcKey(this.spec.id);
  }

  get active(): IncidentId {
    return this.live ? this.id : "none";
  }

  tick(dt: number): void {
    if (this.leaving > 0) {
      this.leaving -= dt;
      if (this.leaving <= 0) this.host.cast.despawn("incident");
    }
    if (this.id === "none" || this.result !== undefined) return;
    this.t += dt;
    this.calm = this.host.fighting() ? 0 : this.calm + dt;
    if (!this.live) {
      if (this.forced || incidentDue(this.t, this.delay, this.calm, this.host.coasting?.() ?? false, this.host.pressed?.() ?? false)) this.fire();
      return;
    }
    if (this.id === "powder_wagon") {
      // settled when no fuse burns among the kegs any more (a chain lights the next before the last has gone): how many are still on the road
      const live = this.host.propLive ?? (() => false);
      const lit = this.host.propLit ?? (() => false);
      if (this.kegs.some((k) => live(k) && lit(k))) return;
      this.settle({ t: "kegs", left: this.kegs.filter((k) => live(k)).length });
      return;
    }
    if (this.id === "syndicate_collectors") {
      if (this.invoice > 0) {
        this.invoice -= dt;
        if (this.invoice <= 0) this.openFire();
      }
      // D-088: seen off once every collector is down or running (the Cast's count of the group)
      const c = this.host.cast.count("incident");
      if (c.total > 0 && c.alive === 0) this.settle({ t: "broken" });
      return;
    }
    if (this.id === "runaway_horse") {
      const rider = this.host.riderOf(this.horse);
      if (rider && this.host.party.get(rider) && !this.host.party.get(rider)!.npc) {
        this.settle({ t: "mounted" });
        this.host.kind?.(rider);
      }
      return;
    }
    const row = this.row();
    if (!row) return this.settle({ t: "shot" }); // taken off the ground (shot and reaped): it went badly
    if (this.id === "wounded_traveller") {
      const down = (row.flags & FLAG.DOWNED) !== 0;
      if (this.wasDown && !down) return this.settle({ t: "revived" });
      this.wasDown = down;
    } else if (this.id === "courier") {
      this.reaim -= dt;
      if (this.reaim <= 0) {
        this.reaim = COURIER_REAIM_S;
        const sid = this.nearestStanding(row.x, row.z);
        if (sid) this.host.cast.order("incident", { o: "follow", target: sid });
      }
    }
  }

  /** USE pressed by a standing player. True when the press was this incident's (the courier's dispatch, the deserter's offer). */
  onInteract(sid: string, p: PlayerStateType): boolean {
    if (!this.live || this.result !== undefined || (this.id !== "courier" && this.id !== "deserter")) return false;
    const row = this.row();
    if (!row || (row.flags & FLAG.DOWNED) !== 0 || Math.hypot(row.x - p.x, row.z - p.z) > INCIDENT.useR || Math.abs(row.y - p.y) > 1.6) return false;
    const room = this.id === "deserter" && this.host.hasRoom();
    const at = { x: row.x, z: row.z };
    this.settle({ t: "use", room });
    if (this.result === "enlisted" && this.spec) {
      // he steps out of the incident and into the party: the incident's body goes, a hand's comes up where he stood
      this.host.cast.despawn("incident");
      if (!this.host.join(this.spec.name, this.spec.lookSeed, at)) this.result = "turned_away";
    }
    const settled = this.result as IncidentResult | undefined;
    if (settled === "delivered" || settled === "enlisted") this.host.kind?.(sid);
    return true;
  }

  /** Somebody shot or hit `victim` (a session id or an NPC row key). */
  onHurt(victim: string): void {
    // (the collectors are there to be shot at: their incident settles on the count, not on a wound; hurt one mid-invoice and they all open fire)
    if (this.live && this.result === undefined && this.id === "syndicate_collectors") {
      if (this.invoice > 0 && victim.includes("incident-collector-")) this.openFire();
      return;
    }
    if (this.live && this.result === undefined && this.owns(victim)) this.settle({ t: "shot" });
  }

  /** D-088: the invoice is read (or somebody interrupted it): the collectors come for the party. */
  private openFire(): void {
    this.invoice = -1;
    this.host.cast.order("incident", { o: "attack", side: "party" });
  }

  /**
   * The contract is being committed: what became of this run's incident (an incident still waiting for the party is settled as the contract ending; one that never
   * fired is nothing). `day` is the day the outcome is entered under (the history entry's).
   */
  take(day: number): IncidentRecord | undefined {
    if (this.live && this.result === undefined) this.settle({ t: "end" });
    const out = this.id !== "none" && this.result !== undefined ? { id: this.id, result: this.result, day, region: this.host.region() } : undefined;
    this.reset();
    return out;
  }

  /** Region change or room reset (the Cast takes everyone off the ground itself). */
  reset(): void {
    this.id = "none";
    this.t = 0;
    this.delay = 0;
    this.calm = 0;
    this.live = false;
    this.result = undefined;
    this.spec = undefined;
    this.wasDown = false;
    this.reaim = 0;
    this.forced = false;
    this.horse = "";
    this.horseLabel = "";
    this.kegs = [];
    this.leaving = 0;
    this.invoice = -1;
  }

  private fire(): void {
    const c = this.host.campaign();
    let sx = 0;
    let sz = 0;
    let n = 0;
    this.host.party.forEach((p) => {
      if (!p.connected || (p.flags & FLAG.DOWNED) !== 0) return;
      sx += p.x;
      sz += p.z;
      n++;
    });
    if (n === 0) return; // nobody standing to meet it: wait
    const seed = (this.host.seed ^ Math.imul(Math.max(0, Math.round(c.day)) + 1, 0x9e3779b1)) >>> 0;
    // (the powder wagon needs room for its spill: the whole ring of kegs on open, dry ground. It stood on Kessar's waterline with three of its kegs in the surf)
    const land = (x: number, z: number): boolean => this.host.land(x, z);
    const open = this.id === "powder_wagon" ? (x: number, z: number): boolean => land(x, z) && ringOpen({ x, z }, INCIDENT.wagonRing, land) : land;
    const at = placeIncident({ x: sx / n, z: sz / n }, this.host.hostiles(), open, this.host.bounds(), seed);
    if (!at) {
      this.id = "none"; // nowhere open near the party: this run stays quiet (never in a wall)
      return;
    }
    if (this.id === "powder_wagon") {
      this.kegs = this.host.spillKegs?.(at, INCIDENT.wagonKegs, INCIDENT.wagonRing, INCIDENT.wagonFuseS) ?? [];
      if (this.kegs.length < INCIDENT.wagonSalvage) {
        this.id = "none"; // (no room for the kegs: the room is at its props' cap; it stays quiet)
        return;
      }
      this.horseLabel = wagonName(seed);
      this.live = true;
      this.host.notice(INCIDENT_OPEN.powder_wagon.replace("%n", this.horseLabel[0]!.toUpperCase() + this.horseLabel.slice(1)));
      return;
    }
    if (this.id === "syndicate_collectors") {
      // D-088: the Syndicate arrives armed, not with a cheque: three collectors and their powder cart (unlit), ordered at the party
      const specs = incidentRoster(this.id, at, this.host.region(), seed, n);
      if (this.host.cast.spawn(specs) === 0) {
        this.id = "none";
        return;
      }
      // they halt short of the party, their cart just behind them, and read the invoice (the party's moment: the kegs are right there)
      const cx = sx / n, cz = sz / n;
      const d = Math.max(1, Math.hypot(at.x - cx, at.z - cz));
      const stand = { x: cx + ((at.x - cx) / d) * INCIDENT.collectorStandM, z: cz + ((at.z - cz) / d) * INCIDENT.collectorStandM };
      const back = { x: stand.x + ((at.x - cx) / d) * 2.6, z: stand.z + ((at.z - cz) / d) * 2.6 };
      this.host.spillKegs?.(this.host.land(back.x, back.z) && ringOpen(back, 0.8, land) ? back : at, INCIDENT.collectorKegs, 0.8, 0);
      this.host.cast.order("incident", { o: "guard", x: stand.x, z: stand.z, r: 3 });
      this.invoice = INCIDENT.collectorDemandS;
      this.horseLabel = bandName(seed);
      this.live = true;
      this.host.notice(INCIDENT_OPEN.syndicate_collectors.replace("%n", this.horseLabel));
      return;
    }
    if (this.id === "runaway_horse") {
      this.horse = this.host.looseHorse(at);
      if (!this.horse) {
        this.id = "none"; // (the room is at its mounts' cap)
        return;
      }
      this.horseLabel = horseName(seed);
      this.live = true;
      this.host.notice(INCIDENT_OPEN.runaway_horse.replace("%n", this.horseLabel));
      return;
    }
    const specs = incidentRoster(this.id, at, this.host.region(), seed);
    this.spec = specs[0];
    if (!this.spec || this.host.cast.spawn(specs) === 0) {
      this.id = "none";
      this.spec = undefined;
      return;
    }
    this.live = true;
    const row = this.row();
    if (this.id === "wounded_traveller" && row) {
      row.flags |= FLAG.DOWNED;
      this.wasDown = true;
    }
    if (this.id !== "wounded_traveller") this.reaim = 0;
    this.host.notice(INCIDENT_OPEN[this.id as Exclude<IncidentId, "none">].replace("%n", this.spec.name));
  }

  private settle(e: IncidentEvent): void {
    if (this.id === "none" || this.result !== undefined) return;
    const r = incidentStep(this.id, e);
    if (r === undefined) return;
    this.result = r;
    const who = this.spec?.name ?? (this.id === "runaway_horse" || this.id === "powder_wagon" || this.id === "syndicate_collectors" ? this.horseLabel : "");
    if (who) {
      const t = INCIDENT_DONE[r].replace("%n", who);
      this.host.notice(t[0]!.toUpperCase() + t.slice(1)); // (a wagon's name opens "the Syndicate's ...")
    }
    // whoever is left goes about their business (a helped traveller, a courier who delivered or gave up, a deserter turned away)
    if (r !== "enlisted") this.host.cast.order("incident", { o: "flee" });
    if (r !== "enlisted" && (this.id === "courier" || this.id === "deserter")) this.leaving = INCIDENT_LEAVE_S;
  }

  private row(): PlayerStateType | undefined {
    return this.spec ? this.host.cast.row(this.spec.id) : undefined;
  }

  private nearestStanding(x: number, z: number): string | undefined {
    let best: string | undefined;
    let d = Infinity;
    this.host.party.forEach((p, id) => {
      if (!p.connected || (p.flags & FLAG.DOWNED) !== 0) return;
      const k = Math.hypot(p.x - x, p.z - z);
      if (k < d) {
        d = k;
        best = id;
      }
    });
    return best;
  }
}
