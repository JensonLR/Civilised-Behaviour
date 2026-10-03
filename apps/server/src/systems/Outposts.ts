import {
  FLAG, OUTPOST_SITES, deliverTo, evolveSettlements, isNpcKey, raidOutpost, worldKey, regionWorldOpts, serializeCampaign, serializeSettlements, FOUNDATION_CRATES, YARD_R,
  type CampaignState, type PlayersView, type PlayerStateType, type PropKindId, type RegionClimate, type RegionId, type SettlementEvent, type SettlementsState,
} from "@cb/shared";

/**
 * The Society's outpost, server side (D-035): the physical act of founding and feeding it. A player CARRYING a prop presses INTERACT within reach of the foundation;
 * the prop is delivered (exactly one consume), the notice tells him how far it got, and the fourth crate founds the camp and asks the room to rebuild its collision world.
 * Later stages are earned by `evolve` (the daily pure rules in shared/settlement.ts) and kept alive by the same hauling. The position used is the player's ROW, never a
 * client claim; sailing, a downed carrier, a non-hub region, a prop that is not a thing the foundation takes, and a second press on the same prop are all ignored.
 */

export interface OutpostsHost {
  players: PlayersView;
  region(): RegionId;
  settlements(): SettlementsState;
  /** Replaces the settlements (publish, save) and tells the paper/powers what happened. */
  setSettlements(s: SettlementsState, events: readonly SettlementEvent[]): void;
  campaign(): CampaignState;
  climate(): RegionClimate;
  propKind(id: string): number | undefined;
  /** Removes the prop from the world (and from the carrier's hands). Called exactly once per accepted delivery. */
  consumeProp(id: string): void;
  /** A room-wide notice. */
  notice(text: string): void;
  send(sid: string, type: string, msg: unknown): void;
  /** The collision world depends on the stage: build it again and put everyone clear of the new solids. */
  rebuildWorld(): void;
  /** True while the party is at sea (nobody acts). */
  busy(): boolean;
  /** Campaign day. */
  day(): number;
  seed: number;
}

/** INTERACT reach to the foundation: inside the delivery yard. */
export const DELIVER_REACH = YARD_R - 1;
/** Minimum gap between deliveries by one sender (seconds of simulated time). */
const GAP_S = 0.4;

export class Outposts {
  private readonly last = new Map<string, number>();
  private readonly spent = new Set<string>();
  private t = 0;

  constructor(private readonly host: OutpostsHost) {}

  /** Advance the host clock used for the per-sender gap (called once a tick with dt, or leave it: the gap then never elapses and presses wait for a new press edge). */
  tick(dt: number): void {
    this.t += dt;
  }

  /** `carried`: the prop id the room recorded as held by `sid`. Returns true when the press was taken (the room then neither picks up nor drops anything). */
  onInteract(sid: string, p: PlayerStateType, carried?: string): boolean {
    if (!carried || isNpcKey(sid) || !p || p.npc || (p.flags & FLAG.DOWNED) !== 0 || this.host.busy()) return false;
    const region = this.host.region();
    const at = OUTPOST_SITES[region];
    if (!at) return false;
    if (Math.hypot(p.x - at.site.x, p.z - at.site.z) > DELIVER_REACH) return false;
    const now = this.t;
    if (now - (this.last.get(sid) ?? -Infinity) < GAP_S) return true; // a held key is one press, not a stream
    this.last.set(sid, now);
    if (this.spent.has(carried)) return true;
    const kind = this.host.propKind(carried);
    if (kind === undefined) return true;
    const c = this.host.campaign();
    const s = this.host.settlements();
    const post = s.posts[region];
    if (post?.ruined && post.stage === "none" && c.crossing.control === "rival") {
      this.host.send(sid, "notice", { text: "The Syndicate has put a signboard on the ruin and a man beside the signboard. The foundation will not be raised while they hold the crossing." });
      return true;
    }
    const before = worldKey(regionWorldOpts(serializeCampaign(c), serializeSettlements(s), region));
    const d = deliverTo(s, region, kind as PropKindId, c, this.host.seed);
    if (!d.accepted) {
      this.host.send(sid, "notice", { text: d.line });
      return true;
    }
    this.spent.add(carried);
    if (this.spent.size > 256) this.spent.clear();
    this.host.consumeProp(carried);
    this.host.setSettlements(d.s, d.events);
    if (d.events.some((e) => e.kind === "founded")) this.host.notice(d.line);
    else this.host.send(sid, "notice", { text: d.line });
    if (worldKey(regionWorldOpts(serializeCampaign(c), serializeSettlements(d.s), region)) !== before) this.host.rebuildWorld();
    return true;
  }

  /** The daily rules (once per campaign day, from the commit pipeline). Publishes through the host and rebuilds the world when a stage or the telegraph changed it. */
  evolve(day: number, climate: RegionClimate | ((region: RegionId) => RegionClimate), extra: readonly SettlementEvent[] = []): SettlementEvent[] {
    const c = this.host.campaign();
    const s0 = this.host.settlements();
    const here = this.host.region();
    const before = worldKey(regionWorldOpts(serializeCampaign(c), serializeSettlements(s0), here));
    const r = evolveSettlements(s0, c, climate, day);
    const events = [...extra, ...r.events];
    if (events.length === 0 && serializeSettlements(r.s) === serializeSettlements(s0)) return [];
    this.host.setSettlements(r.s, events);
    // (only the region the party stands in has a world to rebuild: a post elsewhere is built when they land there)
    if (worldKey(regionWorldOpts(serializeCampaign(c), serializeSettlements(r.s), here)) !== before) this.host.rebuildWorld();
    return events;
  }

  /** A raid lands on the outpost of `region` (the rival's `raided_outpost` event). Returns the event for the powers and the paper. */
  raid(region: RegionId, day: number): SettlementEvent[] {
    const r = raidOutpost(this.host.settlements(), region, day);
    if (r.events.length) this.host.setSettlements(r.s, r.events);
    return r.events;
  }

  onLeave(sid: string): void {
    this.last.delete(sid);
  }
}

export { FOUNDATION_CRATES };
