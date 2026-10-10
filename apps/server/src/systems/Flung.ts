import { FLAG, ZONE, fallDamage, isSplat, splatDamage, BOOT, type PlayerStateType, type PlayersView } from "@cb/shared";
import type { HitInfo } from "./Casualties.ts";

/**
 * THROWN BODIES (D-108; the rules are `shared/boot.ts`). A man booted or thrown by a blast is watched for a few seconds: if he meets something hard at speed (he loses
 * most of his speed in one step: the movement step kills momentum against a wall) he is hurt by it, a SPLAT; if he lands from high enough, the FALL hurts his legs. Both
 * are credited to whoever threw him. NPC rows only (a player's body is predicted on their own machine). Ticked after the Cast has stepped the rows.
 */
export interface FlungHost {
  /** Every row (players and NPCs). */
  players: PlayersView;
  damage(id: string, amount: number, hit: HitInfo): void;
  /** `id`, thrown by `by`, met a wall (`amount`: the speed lost, m/s) or a drop (`amount`: metres) at (x, y, z). Optional: the Society's column and the clients' thud. */
  struck?(id: string, by: string, kind: "wall" | "fall", amount: number, x: number, y: number, z: number): void;
}

interface Watch {
  id: string;
  by: string;
  t: number;
  /** Horizontal speed and velocity after the last step. */
  prev: number;
  pvx: number;
  pvz: number;
  /** The highest the body has been since it last stood on something, and whether it is off the ground. */
  peakY: number;
  airborne: boolean;
}

export class Flung {
  private readonly live: Watch[] = [];
  private readonly spare: Watch[] = [];
  readonly stats = { watched: 0, splats: 0, falls: 0 };

  constructor(private readonly host: FlungHost) {}

  /** `id` was just thrown by `by` (its velocity already set): watch it. A body already watched is watched afresh (a second blast, a boot in the air). */
  track(id: string, by: string): void {
    const p = this.host.players.get(id);
    if (!p || p.npc === 0 || (p.flags & FLAG.DOWNED) !== 0) return;
    let w = this.live.find((x) => x.id === id);
    if (!w) {
      w = this.spare.pop() ?? { id: "", by: "", t: 0, prev: 0, pvx: 0, pvz: 0, peakY: 0, airborne: false };
      w.peakY = p.y;
      w.airborne = false;
      this.live.push(w);
      this.stats.watched++;
    }
    w.id = id;
    w.by = by;
    w.t = 0;
    this.sample(w, p);
    // (thrown again in mid-air: the height he fell from is still the highest he has been)
    w.peakY = w.airborne ? Math.max(w.peakY, p.y) : p.y;
    w.airborne = (p.flags & FLAG.GROUNDED) === 0;
  }

  /** How many bodies are being watched (tests). */
  get watching(): number {
    return this.live.length;
  }

  tick(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const w = this.live[i]!;
      const p = this.host.players.get(w.id);
      if (!p || (p.flags & FLAG.DOWNED) !== 0) {
        this.drop(i);
        continue;
      }
      const speed = Math.hypot(p.vx, p.vz);
      if (isSplat(w.prev, speed)) {
        const lost = w.prev - speed;
        const harm = splatDamage(lost);
        this.stats.splats++;
        this.host.struck?.(w.id, w.by, "wall", lost, p.x, p.y + 1.1, p.z);
        // (the blow is along the way he was going: a ragdoll crumples into the wall it met)
        if (harm > 0) this.host.damage(w.id, harm, { zone: ZONE.TORSO, dirX: w.pvx, dirZ: w.pvz, severBias: 0, by: w.by, splat: true });
      }
      const grounded = (p.flags & FLAG.GROUNDED) !== 0;
      if (!grounded) {
        w.peakY = w.airborne ? Math.max(w.peakY, p.y) : p.y;
        w.airborne = true;
      } else if (w.airborne) {
        w.airborne = false;
        const drop = w.peakY - p.y;
        w.peakY = p.y;
        const harm = fallDamage(drop);
        if (harm > 0) {
          this.stats.falls++;
          this.host.struck?.(w.id, w.by, "fall", drop, p.x, p.y, p.z);
          // (the legs take it: the one on the side he was going; damage() ignores a body the wall has already put down)
          this.host.damage(w.id, harm, { zone: w.pvx >= 0 ? ZONE.LEG_R : ZONE.LEG_L, dirX: w.pvx, dirZ: w.pvz, severBias: 0, by: w.by, splat: true });
        }
      } else w.peakY = p.y;
      this.sample(w, p);
      w.t += dt;
      if (w.t >= BOOT.watchS && grounded) this.drop(i);
    }
  }

  /** Forget everybody (the region changed). */
  clear(): void {
    while (this.live.length > 0) this.drop(this.live.length - 1);
  }

  private sample(w: Watch, p: PlayerStateType): void {
    w.pvx = p.vx;
    w.pvz = p.vz;
    w.prev = Math.hypot(p.vx, p.vz);
  }

  private drop(i: number): void {
    const w = this.live[i]!;
    this.live[i] = this.live[this.live.length - 1]!;
    this.live.pop();
    this.spare.push(w);
  }
}
