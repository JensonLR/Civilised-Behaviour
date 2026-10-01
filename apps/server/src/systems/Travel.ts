import { REGIONS, travelArrived, travelCancel, travelIdle, travelPropose, travelReady, travelReconcile, travelTick, type RegionId, type TravelState, type TravelStep } from "@cb/shared";

/** What the sailing needs from the room; keeps it testable and WorldRoom slim. */
export interface TravelHost {
  /** Bitmask of the slots currently in the room (bit n = slot n). NPCs are not slots. */
  connectedSlots(): number;
  /** The region the room is in now (flips inside `enterRegion`). */
  current(): RegionId;
  /** Dispose the old region and build `to`: worlds, physics, props, NPCs, scenario; teleport everyone to the arrival ring. */
  enterRegion(to: RegionId): void;
  notice(text: string): void;
  /** Publish the state to clients (travelPhase, travelTo, travelReady, travelLeft). Called only when something a client can see changed. */
  sync(s: TravelState): void;
  /** D-035: the steam launch's sailing time to `to` (seconds), or undefined for the region's own. */
  sailSeconds?(to: RegionId): number | undefined;
}

/**
 * The sailing, server side: validated messages in, the pure machine (shared/travel.ts) decides, this applies the effect. All inputs are hostile
 * until proven otherwise: the machine ignores anything out of phase, for the wrong region or from a slot that is not in the room.
 */
export class Travel {
  private s: TravelState = travelIdle();
  private shown = "";

  constructor(private readonly host: TravelHost) {}

  get state(): Readonly<TravelState> {
    return this.s;
  }

  /** Something is in motion (inputs are discarded while sailing or arriving: phases 2 and 3). */
  get busy(): boolean {
    return this.s.phase >= 2;
  }

  /** `sid` is the proposer's session (unused by the rules; kept for the room's logs). */
  propose(_sid: string, slot: number, to: unknown): void {
    this.apply(travelPropose(this.s, this.host.current(), to, slot, this.host.connectedSlots(), this.secs(to)));
  }

  ready(slot: number, on: unknown): void {
    this.apply(travelReady(this.s, slot, on === true, this.host.connectedSlots(), this.secs(this.s.to)));
  }

  cancel(): void {
    this.apply(travelCancel(this.s));
  }

  /** The client has built `region` (defaults to the region we sailed to: the wire message is validated by the room). */
  regionReady(slot: number, region: unknown = this.s.to): void {
    this.apply(travelArrived(this.s, slot, region, this.host.connectedSlots()));
  }

  tick(dt: number): void {
    if (this.s.phase === 0) return;
    this.apply(travelTick(this.s, dt, this.host.connectedSlots(), this.secs(this.s.to)));
  }

  /** A slot left: a vote it was blocking may now be unanimous, an arrival it was holding up may be complete. */
  onLeave(_slot: number): void {
    if (this.s.phase === 0) return;
    this.apply(travelReconcile(this.s, this.host.connectedSlots(), this.secs(this.s.to)));
  }

  private secs(to: unknown): number | undefined {
    return typeof to === "string" && (to === "hollowmere" || to === "kessar") ? this.host.sailSeconds?.(to) : undefined;
  }

  private apply(step: TravelStep): void {
    const before = this.s;
    this.s = step.s;
    if (step.fx === "enter_region") {
      this.host.enterRegion(step.s.to);
    } else if (step.fx === "cancelled") {
      this.host.notice("The sailing is called off. The kettle is relieved.");
    } else if (step.fx === "done") {
      this.host.notice(`Landfall: ${REGIONS[step.s.to].name}.`);
    } else if (before.phase === 0 && step.s.phase === 1) {
      this.host.notice(`A sailing to ${REGIONS[step.s.to].name} is proposed. Confirm at the map room.`);
    } else if (before.phase === 1 && step.s.phase === 2) {
      this.host.notice(`All aboard for ${REGIONS[step.s.to].name}. The Society regrets nothing.`);
    } else if (before.phase === 0 && step.s.phase === 2) {
      this.host.notice(`Casting off for ${REGIONS[step.s.to].name}.`);
    }
    const key = `${step.s.phase}|${step.s.to}|${step.s.ready}|${Math.ceil(step.s.left)}`;
    if (key !== this.shown) {
      this.shown = key;
      this.host.sync(step.s);
    }
  }
}
