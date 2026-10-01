import { FLAG, NPC_SIDE, type RegionId, type ScenarioPhase } from "@cb/shared";
import type { MusicScenarioStage, MusicSignals } from "../audio/musicLayers.ts";

/**
 * WHAT THE MUSIC HEARS (D-038, docs/_notes/polish2.md section 6). `MusicSignaller.update` turns the rows the client already holds (`room.state.players`, with the NPC cast among them) into the
 * `MusicSignals` record the mood driver reads, once a frame. Nothing travels the wire for it: shots are the replicated `shots` counter moving, a death is a body going DOWNED (or its health
 * reaching zero), hostiles are cast rows whose side is not the party's or a bystander's. The NPC brain's mode is server-side only, so "aware" is read from what a client can see: a hostile with a
 * weapon raised (the AIMING or OPERATING pose flag) or one that has just fired. Allocation-free after a row is first seen.
 *
 * Wiring (integrator): `const signaller = new MusicSignaller()`; each frame `signaller.update(dt, view, signals)` with `view` filled from the session (see `SignalView`), then
 * `GameAudio.update(dt, signals)`.
 */

/** The fields of a replicated player row the signaller reads (a `PlayerStateType` fits as it is). */
export interface SignalRow {
  npc: number;
  x: number;
  z: number;
  flags: number;
  health: number;
  /** The replicated attack counter (wraps at 256): any change is a shot or a swing. */
  shots: number;
}

export interface SignalView {
  rows: { forEach(cb: (row: SignalRow, id: string) => void): void };
  /** The local player's id (their own row is the listener, never a "hostile"). */
  me: string;
  /** The listener's position. */
  x: number;
  z: number;
  region: RegionId;
  /** The scenario's phase ("" outside a scenario). */
  phase: ScenarioPhase | "";
  /** A parley or audience sheet is open. */
  parley: boolean;
  /** The menu, a sailing card or a sheet that owns the screen. */
  frozen: boolean;
}

/** Seconds a shot is remembered ("shots heard in 4 s") and a death ("deaths in 20 s"). */
export const SHOT_WINDOW = 4;
export const DEATH_WINDOW = 20;
export const AWARE_RANGE = 50;
export const NEAR_RANGE = 20;
export const HEARD_RANGE = 60;

/** The scenario phase as the music sees it. */
export function scenarioStage(phase: ScenarioPhase | ""): MusicScenarioStage {
  switch (phase) {
    case "fighting":
    case "escalated":
      return "clash";
    case "standoff":
    case "parley":
      return "standoff";
    case "tension":
    case "rigging":
      return "brewing";
    case "resolved":
      return "resolved";
    default:
      return "idle";
  }
}

interface Track {
  shots: number;
  flags: number;
  alive: boolean;
  seen: number;
  /** Seconds since this row last fired (large when it has not). */
  sinceShot: number;
}

const RING = 32;

export class MusicSignaller {
  private readonly tracks = new Map<string, Track>();
  private frame = 0;
  private primed = false;
  /** Times (on this class's own clock) of shots and deaths heard: fixed rings, oldest overwritten. */
  private readonly shotAt = new Float64Array(RING).fill(-1e9);
  private readonly deathAt = new Float64Array(RING).fill(-1e9);
  private shotHead = 0;
  private deathHead = 0;
  private clock = 0;
  private dt = 0;
  private view: SignalView | undefined;
  private aware = 0;
  private near = 0;
  private selfDowned = false;
  private alliesDowned = 0;

  private readonly onRow = (row: SignalRow, id: string): void => {
    const v = this.view!;
    let t = this.tracks.get(id);
    const alive = row.health > 0 && (row.flags & FLAG.DOWNED) === 0;
    if (!t) {
      t = { shots: row.shots, flags: row.flags, alive, seen: this.frame, sinceShot: 99 };
      this.tracks.set(id, t);
    }
    t.seen = this.frame;
    const dx = row.x - v.x;
    const dz = row.z - v.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const mine = id === v.me;
    if (row.shots !== t.shots) {
      t.shots = row.shots;
      t.sinceShot = 0;
      if (this.primed && (mine || d <= HEARD_RANGE)) this.shotAt[this.shotHead++ % RING] = this.clock;
    } else t.sinceShot += this.dt;
    if (t.alive && !alive && this.primed && (mine || d <= HEARD_RANGE)) this.deathAt[this.deathHead++ % RING] = this.clock;
    t.alive = alive;
    t.flags = row.flags;
    if (mine) {
      this.selfDowned = !alive;
      return;
    }
    if (row.npc === 0) {
      // another player in the party
      if (!alive) this.alliesDowned++;
      return;
    }
    const side = NPC_SIDE[row.npc];
    if (side === "party") {
      if (!alive) this.alliesDowned++;
      return;
    }
    if (!alive || side === "neutral" || side === undefined) return;
    // a hostile: aware when it has a weapon raised or has fired lately
    const raised = (row.flags & (FLAG.AIMING | FLAG.OPERATING)) !== 0 || t.sinceShot < SHOT_WINDOW;
    if (raised && d <= AWARE_RANGE) {
      this.aware++;
      if (d <= NEAR_RANGE) this.near++;
    }
  };

  private readonly prune = (t: Track, id: string): void => {
    if (t.seen !== this.frame) this.tracks.delete(id);
  };

  /** Fills `out` for this frame (and returns it). `dt` in seconds. */
  update(dt: number, view: SignalView, out: MusicSignals): MusicSignals {
    if (dt > 0 && Number.isFinite(dt)) {
      this.dt = dt;
      this.clock += dt;
    } else this.dt = 0;
    this.frame++;
    this.view = view;
    this.aware = 0;
    this.near = 0;
    this.selfDowned = false;
    this.alliesDowned = 0;
    view.rows.forEach(this.onRow);
    this.tracks.forEach(this.prune);
    this.primed = true;
    let shots = 0;
    for (let i = 0; i < RING; i++) if (this.clock - this.shotAt[i]! <= SHOT_WINDOW) shots++;
    let deaths = 0;
    for (let i = 0; i < RING; i++) if (this.clock - this.deathAt[i]! <= DEATH_WINDOW) deaths++;
    out.region = view.region;
    out.frozen = view.frozen;
    out.hostilesAware = this.aware;
    out.hostilesNear = this.near;
    out.shotsHeard = shots;
    out.selfDowned = this.selfDowned;
    out.alliesDowned = this.alliesDowned;
    out.deathsNear = deaths;
    out.scenario = scenarioStage(view.phase);
    out.parley = view.parley;
    return out;
  }

  /** Forget everything (a new region or a new room): the first frame after is a baseline again, so nothing already on the field counts as a shot or a death. */
  reset(): void {
    this.tracks.clear();
    this.shotAt.fill(-1e9);
    this.deathAt.fill(-1e9);
    this.primed = false;
  }
}
