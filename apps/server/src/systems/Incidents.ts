import { FLAG, type PlayerStateType } from "@cb/shared";
import { npcKey, type CampaignState, type CastApi, type NpcSpec, type PlayersView, type RegionId, type ScenarioTemplateId } from "@cb/shared";
import {
  INCIDENT, INCIDENT_DONE, INCIDENT_OPEN, dealIncident, incidentDelayS, incidentRoster, incidentStep, placeIncident,
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
  hasRoom(): boolean;
}

/** How often the courier is re-pointed at the nearest player (seconds). */
const COURIER_REAIM_S = 2;

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
    if (this.id === "none" || this.result !== undefined) return;
    this.t += dt;
    this.calm = this.host.fighting() ? 0 : this.calm + dt;
    if (!this.live) {
      if (this.forced || (this.t >= this.delay && this.calm >= INCIDENT.calmS)) this.fire();
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
  onInteract(_sid: string, p: PlayerStateType): boolean {
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
    return true;
  }

  /** Somebody shot or hit `victim` (a session id or an NPC row key). */
  onHurt(victim: string): void {
    if (this.live && this.result === undefined && this.owns(victim)) this.settle({ t: "shot" });
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
    const at = placeIncident({ x: sx / n, z: sz / n }, this.host.hostiles(), (x, z) => this.host.land(x, z), this.host.bounds(), seed);
    if (!at) {
      this.id = "none"; // nowhere open near the party: this run stays quiet (never in a wall)
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
    if (this.spec) this.host.notice(INCIDENT_DONE[r].replace("%n", this.spec.name));
    // whoever is left goes about their business (a helped traveller, a courier who delivered or gave up, a deserter turned away)
    if (r !== "enlisted") this.host.cast.order("incident", { o: "flee" });
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
