import { GAIT, MOUNT_KIND, MOUNT_PHASE, hash3, hqPlan, parseCampaign } from "@cb/shared";
import { playSfx, stopSfx } from "../audio/index.ts";
import type { PlayOpts } from "../audio/engine.ts";
import { GAIT_KEYS, HoofCadence } from "../audio/hooves.ts";

/**
 * The sounds of the expedition's world (D-035, R), derived ONLY from state every client already has, so a remote rider is heard from where he is and nothing travels the
 * wire for it: hoofbeats and tack from the mount rows, the sailing's creak and gulls from `travelPhase`, the paper and the HQ day bell from `campaignRev`, an outpost bell from
 * `settlementsRev`, the gun crew's calls from the cannon rows' phase. `update` runs once a frame and allocates nothing (bound callbacks, one scratch options object, typed-array
 * state, and a few maps that only grow when a new horse or gun appears).
 *
 * Wiring (integrator): `const content = new ContentAudio({ outpostSite })`; in the frame loop `content.update(dt, room.state)`; `content.dispose()` with the game. The room state fits
 * `ContentView` as it is (`settlementsRev` is optional until the settlements section lands).
 */

export interface MountRowView {
  kind: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  rider: string;
  hitch: string;
  phase: number;
}

export interface CannonRowView {
  x: number;
  y: number;
  z: number;
  /** 0 empty, 1 loading, 2 loaded, 3 fuse lit. */
  phase: number;
}

export interface ContentView {
  mounts: { forEach(cb: (row: MountRowView, id: string) => void): void };
  cannons?: { forEach(cb: (row: CannonRowView, id: string) => void): void };
  region: string;
  /** 0 idle, 1 vote, 2 sailing, 3 landfall. */
  travelPhase: number;
  campaign: string;
  campaignRev: number;
  seed: number;
  settlementsRev?: number;
}

/** What plays sounds: the audio module in the game, a recorder in tests. */
export interface Sfx {
  play(name: string, opts?: PlayOpts): void;
  stop(name: string): void;
}

const GAME_SFX: Sfx = { play: playSfx, stop: stopSfx };

interface HoofTrack {
  cad: HoofCadence;
  rider: string;
  hitch: string;
  /** The gait of the last frame (GAIT.*). */
  gait: number;
  seen: number;
}
interface GunTrack {
  phase: number;
  seen: number;
}

/** Seconds between gulls: 2.5 .. 7.5, from the campaign seed and how many have called (the same sailing sounds the same on every machine). */
export const gullGap = (seed: number, n: number): number => 2.5 + 5 * (hash3(seed >>> 0, n, 0x6011) / 4294967296);

const HQ = hqPlan();

export class ContentAudio {
  private readonly hoofs = new Map<string, HoofTrack>();
  private readonly guns = new Map<string, GunTrack>();
  /**
   * Two scratch option objects, never one: a field that is sometimes `undefined` and sometimes a double is stored as a pointer, and every double written to it would be boxed
   * (a heap number per store). `at` always has a position, `flat` never does, so each keeps plain double fields and the frame allocates nothing.
   */
  private readonly at: PlayOpts = { x: 0, y: 0, z: 0, volume: 1, key: undefined };
  private readonly flat: PlayOpts = { x: undefined, y: undefined, z: undefined, volume: 1, key: undefined, seed: undefined };
  private frame = 0;
  private dt = 0;
  private primed = false;
  private sailing = false;
  private gullN = 0;
  private readonly gullT = new Float64Array(1);
  private rev = -1;
  private day = -1;
  private bellDue = false;
  private sRev = -1;
  private view: ContentView | undefined;

  constructor(private readonly opts: { sfx?: Sfx; outpostSite?: () => { x: number; z: number } | undefined } = {}) {
    this.sfx = opts.sfx ?? GAME_SFX;
  }
  private readonly sfx: Sfx;

  private putAt(name: string, x: number, y: number, z: number, volume: number, key: string | undefined): void {
    const o = this.at;
    o.x = x;
    o.y = y;
    o.z = z;
    o.volume = volume;
    o.key = key;
    this.sfx.play(name, o);
  }

  private putFlat(name: string, volume: number, key: string | undefined, seed: number | undefined): void {
    const o = this.flat;
    o.volume = volume;
    o.key = key;
    o.seed = seed;
    this.sfx.play(name, o);
  }

  // ---- horses -------------------------------------------------------------------------------------------------------------------------------

  private readonly onMount = (row: MountRowView, id: string): void => {
    if (row.kind !== MOUNT_KIND.horse) return;
    let t = this.hoofs.get(id);
    if (!t) {
      t = { cad: new HoofCadence(), rider: row.rider, hitch: row.hitch, gait: 0, seen: this.frame };
      this.hoofs.set(id, t);
    }
    t.seen = this.frame;
    const live = this.primed;
    // a rider up or down, a wagon hitched or unhitched: the tack speaks
    if (t.rider !== row.rider || t.hitch !== row.hitch) {
      if (live) this.putAt("tack_jingle", row.x, row.y + 1.2, row.z, t.rider !== row.rider && row.rider !== "" ? 0.9 : 0.6, undefined);
      t.rider = row.rider;
      t.hitch = row.hitch;
    }
    if (row.phase === MOUNT_PHASE.wrecked) return;
    const beats = t.cad.step(this.dt, row.speed, true);
    const g = t.cad.gait;
    if (g >= GAIT.trot && g > t.gait && live) this.putAt("tack_jingle", row.x, row.y + 1.2, row.z, 0.5, undefined);
    t.gait = g;
    if (beats > 0 && live) {
      const key = GAIT_KEYS[g]!;
      const vol = t.cad.loud * (row.rider !== "" || row.hitch !== "" ? 1 : 0.85);
      for (let k = 0; k < beats; k++) this.putAt("hoof", row.x, row.y, row.z, vol, key);
    }
  };

  private readonly pruneHoof = (t: HoofTrack, id: string): void => {
    if (t.seen !== this.frame) this.hoofs.delete(id);
  };

  // ---- the gun crew ------------------------------------------------------------------------------------------------------------------------

  private readonly onGun = (row: CannonRowView, id: string): void => {
    let t = this.guns.get(id);
    if (!t) {
      t = { phase: row.phase, seen: this.frame };
      this.guns.set(id, t);
    }
    t.seen = this.frame;
    const p0 = t.phase;
    const p1 = row.phase;
    if (p1 === p0) return;
    t.phase = p1;
    if (!this.primed) return;
    if (p0 === 0 && p1 === 1) this.putAt("crew_shout", row.x, row.y + 1.5, row.z, 1, "loading");
    else if (p0 === 1 && p1 === 2) this.putAt("crew_shout", row.x, row.y + 1.5, row.z, 1, "stand_clear");
    else if (p0 === 2 && p1 === 3) this.putAt("crew_shout", row.x, row.y + 1.5, row.z, 1, "fire");
  };

  private readonly pruneGun = (t: GunTrack, id: string): void => {
    if (t.seen !== this.frame) this.guns.delete(id);
  };

  // ---- the frame ----------------------------------------------------------------------------------------------------------------------------

  update(dt: number, v: ContentView): void {
    if (!(dt >= 0) || !Number.isFinite(dt)) return;
    this.frame++;
    this.dt = dt;
    this.view = v;
    const hollowmere = v.region === "hollowmere";

    v.mounts.forEach(this.onMount);
    this.hoofs.forEach(this.pruneHoof);
    if (v.cannons) {
      v.cannons.forEach(this.onGun);
      this.guns.forEach(this.pruneGun);
    }

    // the sailing: timbers and water for the whole crossing, gulls as the coast comes up
    const phase = v.travelPhase;
    const sailing = phase === 2;
    if (sailing) this.putFlat("sail_creak", 0.85, undefined, undefined);
    else if (this.sailing) this.sfx.stop("sail_creak");
    if (sailing && !this.sailing) {
      this.gullN = 0;
      this.gullT[0] = 1.5 + gullGap(v.seed, 99) * 0.4;
    }
    this.sailing = sailing;
    if (phase === 2 || phase === 3) {
      this.gullT[0] = this.gullT[0]! - dt;
      if (this.gullT[0]! <= 0) {
        this.putFlat("gull", 0.8, undefined, this.gullN);
        this.gullN++;
        this.gullT[0] = gullGap(v.seed, this.gullN);
      }
    }

    // the campaign moved on: the paper is put up at the notice board, and when a new day has dawned the HQ bell tells the camp
    if (v.campaignRev !== this.rev) {
      if (this.primed) {
        if (hollowmere) this.putAt("paper_rustle", HQ.notice.x, 1.5, HQ.notice.z, 0.9, undefined);
        else this.putFlat("paper_rustle", 0.5, undefined, undefined);
      }
      const c = parseCampaign(v.campaign);
      if (c) {
        if (this.day >= 0 && c.day > this.day) this.bellDue = true;
        this.day = c.day;
      }
      this.rev = v.campaignRev;
    }
    if (this.bellDue && hollowmere && phase === 0) {
      this.bellDue = false;
      this.putAt("bell", HQ.marquee.x, HQ.marquee.ridge, HQ.marquee.z, 1, "hq");
    }

    // a settlement changed: its bell (where the integrator says the outpost stands)
    if (v.settlementsRev !== undefined && v.settlementsRev !== this.sRev) {
      if (this.primed && this.sRev >= 0) {
        const at = this.opts.outpostSite?.();
        if (at) this.putAt("bell", at.x, 4, at.z, 1, "outpost");
      }
      this.sRev = v.settlementsRev;
    }
    this.primed = true;
  }

  dispose(): void {
    if (this.sailing) this.sfx.stop("sail_creak");
    this.sailing = false;
    this.hoofs.clear();
    this.guns.clear();
    this.view = undefined;
  }
}
