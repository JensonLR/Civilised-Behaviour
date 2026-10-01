import { ARRIVE_TIMEOUT_S, PROPOSE_TIMEOUT_S, type RegionId } from "./campaignTypes.ts";
import { REGIONS, isReachableRegion } from "./regions.ts";

/**
 * The sailing state machine: pure, no I/O, no clock. The server's Travel system feeds it events and ticks and applies the effect it returns.
 *   0 idle -> (propose) 1 proposed -> (everyone connected is ready) 2 sailing -> (timer) 3 arriving [enter_region] -> (everyone has built the new
 *   world, or the timeout) 0 idle [done]. A proposal nobody joins lapses after PROPOSE_TIMEOUT_S; a lone player sails at once. `ready` is a bitmask
 *   of slots (phase 1: who said yes; phase 3: who has arrived). `connected` is always the bitmask of slots in the room right now, so leavers and
 *   latecomers never wedge the machine.
 */

export interface TravelState {
  phase: 0 | 1 | 2 | 3;
  to: RegionId;
  ready: number;
  left: number;
}

export interface TravelStep {
  s: TravelState;
  fx?: "enter_region" | "cancelled" | "done";
}

export const travelIdle = (to: RegionId = "hollowmere"): TravelState => ({ phase: 0, to, ready: 0, left: 0 });

const bit = (slot: number): number => (Number.isInteger(slot) && slot >= 0 && slot < 30 ? 1 << slot : 0);
const all = (ready: number, connected: number): boolean => connected !== 0 && (ready & connected) === connected;
/** `secs` (D-035): the steam launch's sailing time; absent = the region's own. */
const sail = (s: TravelState, secs?: number): TravelState => ({ phase: 2, to: s.to, ready: 0, left: secs !== undefined && secs > 0 ? Math.min(secs, REGIONS[s.to].sailSeconds) : REGIONS[s.to].sailSeconds });

/** Re-checks the phase against who is in the room (a leaver can complete a vote). */
function settle(s: TravelState, connected: number, secs?: number): TravelStep {
  if (s.phase === 1) {
    if (connected === 0) return { s: travelIdle(s.to), fx: "cancelled" };
    if (all(s.ready, connected)) return { s: sail(s, secs) };
  } else if (s.phase === 3 && all(s.ready, connected)) return { s: travelIdle(s.to), fx: "done" };
  return { s };
}

/** `slot` proposes sailing to `to` from `current`. Only from idle, to a real, REACHABLE (D-036: `REGIONS[to].reachable`), different region; the proposer has said yes. */
export function travelPropose(s: TravelState, current: RegionId, to: unknown, slot: number, connected: number, secs?: number): TravelStep {
  if (s.phase !== 0 || !isReachableRegion(to) || to === current || bit(slot) === 0 || (connected & bit(slot)) === 0) return { s };
  return settle({ phase: 1, to, ready: bit(slot), left: PROPOSE_TIMEOUT_S }, connected, secs);
}

/** `slot` votes. Only while a proposal is open. */
export function travelReady(s: TravelState, slot: number, on: boolean, connected: number, secs?: number): TravelStep {
  const b = bit(slot);
  if (s.phase !== 1 || b === 0 || (connected & b) === 0) return { s };
  return settle({ ...s, ready: on ? s.ready | b : s.ready & ~b }, connected, secs);
}

/** Calls the proposal off. Only while it is open. */
export function travelCancel(s: TravelState): TravelStep {
  return s.phase === 1 ? { s: travelIdle(s.to), fx: "cancelled" } : { s };
}

/** `slot` has built the new world. Only while arriving, and only for the region we sailed to. */
export function travelArrived(s: TravelState, slot: number, region: unknown, connected: number): TravelStep {
  const b = bit(slot);
  if (s.phase !== 3 || region !== s.to || b === 0) return { s };
  return settle({ ...s, ready: s.ready | b }, connected);
}

/** A slot left the room (or joined): re-evaluate. Also the place to clear a leaver's bit. */
export function travelReconcile(s: TravelState, connected: number, secs?: number): TravelStep {
  return settle({ ...s, ready: s.ready & connected }, connected, secs);
}

/** Advances the clock. Every phase but idle is finite, so nothing can wedge. */
export function travelTick(s: TravelState, dt: number, connected: number, secs?: number): TravelStep {
  if (s.phase === 0 || !(dt > 0)) return { s };
  const left = s.left - dt;
  if (s.phase === 1) {
    if (left <= 0) return { s: travelIdle(s.to), fx: "cancelled" };
    return settle({ ...s, left }, connected, secs);
  }
  if (s.phase === 2) {
    if (left > 0) return { s: { ...s, left } };
    return { s: { phase: 3, to: s.to, ready: 0, left: ARRIVE_TIMEOUT_S }, fx: "enter_region" };
  }
  if (left <= 0) return { s: travelIdle(s.to), fx: "done" };
  return settle({ ...s, left }, connected);
}
