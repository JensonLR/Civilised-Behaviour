import type { Object3D, Scene } from "three";
import { horseFromSeed } from "@cb/procedural";
import { HorseAnimator, buildHorse, buildWagon, newRideInput, type HorseRig, type RideInput, type WagonRig } from "@cb/procedural/three";
import { MOUNT, MOUNT_KIND, MOUNT_PHASE, WAGON } from "@cb/shared";

/**
 * Draws the room's mounts (`WorldState.mounts`) and gives the rider's figure what it needs to sit one. Horses are drawn from `MountState` when nobody rides them and from the RIDER'S
 * state (predicted for the local player, interpolated for others) when somebody does: a ridden horse is a picture of its rider, so there is nothing to reconcile and the horse
 * can never disagree with the body on its back. Wagons are drawn from their rows, smoothed. Everything is pooled by row id: a row appearing builds a rig, a row going frees it.
 *
 * Wiring (integrator): `Stage`/`Game` owns one `MountView(scene)`; each frame `update(dt, state.mounts, (sid) => riderPose)`; a rider's `CharacterActor` takes
 * `mountView.rideInput(sid)` as `PoseInput.ride` (and a downed body strapped to a wagon is lifted by `mountView.bodyLift(player.dragger)`).
 */

export interface MountRowLike {
  kind: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  speed: number;
  rider: string;
  hitch: string;
  coat: number;
  phase: number;
  hp: number;
  cargo: number;
}

/** What the view needs of a rider (the local player's PREDICTED state, a remote player's interpolated one). */
export interface RiderPoseLike {
  x: number;
  y: number;
  z: number;
  facing: number;
  vx: number;
  vz: number;
  vy?: number;
  flags: number;
}

export interface MountRows {
  forEach(cb: (row: MountRowLike, id: string) => void): void;
}

const G_BIT = 1; // FLAG.GROUNDED

const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

interface HorseView {
  kind: "horse";
  rig: HorseRig;
  anim: HorseAnimator;
  coat: number;
  harness: boolean;
  x: number;
  y: number;
  z: number;
  facing: number;
  seen: boolean;
  ride: RideInput;
  rider: string;
  frame: number;
}
interface WagonView {
  kind: "wagon";
  rig: WagonRig;
  x: number;
  z: number;
  y: number;
  facing: number;
  dist: number;
  seen: boolean;
  phase: number;
  cargo: number;
  frame: number;
}

export interface MountViewOptions {
  /** Silhouette ink on the mounts (default true: they are few). */
  outline?: boolean;
}

export class MountView {
  private readonly horses = new Map<string, HorseView>();
  private readonly wagons = new Map<string, WagonView>();
  private readonly byRider = new Map<string, HorseView>();
  private frameNo = 0;
  private outline: boolean;
  /** Seconds the view has run: for ambient idle life. */
  private clock = 0;

  constructor(private readonly scene: Scene, options: MountViewOptions = {}) {
    this.outline = options.outline ?? true;
  }

  get horseCount(): number {
    return this.horses.size;
  }
  get wagonCount(): number {
    return this.wagons.size;
  }

  update(dt: number, rows: MountRows, riders: (sessionId: string) => RiderPoseLike | undefined): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.1);
    this.frameNo++;
    this.clock += dt;
    this.byRider.clear();
    rows.forEach((row, id) => {
      // (a row with a broken number is not drawn: nothing of ours may carry NaN into a transform)
      if (!Number.isFinite(row.x + row.y + row.z + row.facing + row.speed)) return;
      if (row.kind === MOUNT_KIND.wagon) this.updateWagon(id, row, dt);
      else this.updateHorse(id, row, dt, riders);
    });
    // rows that were not seen this frame are gone
    for (const [id, v] of this.horses) if (v.frame !== this.frameNo) this.drop(this.horses, id, v.rig.root, () => v.rig.dispose());
    for (const [id, v] of this.wagons) if (v.frame !== this.frameNo) this.drop(this.wagons, id, v.rig.root, () => v.rig.dispose());
  }

  private drop<T>(map: Map<string, T>, id: string, root: Object3D, dispose: () => void): void {
    root.removeFromParent();
    dispose();
    map.delete(id);
  }

  private updateHorse(id: string, row: MountRowLike, dt: number, riders: (sid: string) => RiderPoseLike | undefined): void {
    const hitched = row.hitch !== "";
    let v = this.horses.get(id);
    if (v && (v.coat !== row.coat || v.harness !== hitched)) {
      // a different animal, or the saddle swapped for a collar: rebuild (rare)
      const old = v;
      this.drop(this.horses, id, old.rig.root, () => old.rig.dispose());
      v = undefined;
    }
    if (!v) {
      const rig = buildHorse(horseFromSeed(row.coat, { harness: hitched }), { outline: this.outline });
      this.scene.add(rig.root);
      v = { kind: "horse", rig, anim: new HorseAnimator(rig, row.coat), coat: row.coat, harness: hitched, x: row.x, y: row.y, z: row.z, facing: row.facing, seen: false, ride: newRideInput(), rider: "", frame: 0 };
      this.horses.set(id, v);
    }
    v.frame = this.frameNo;
    const pose = row.rider ? riders(row.rider) : undefined;
    const ridden = pose !== undefined;
    // where it stands: the rider's body when ridden, its own row (smoothed) when not
    const tx = ridden ? pose.x : row.x;
    const ty = ridden ? pose.y : row.y;
    const tz = ridden ? pose.z : row.z;
    const tf = ridden ? pose.facing : row.facing;
    const lastFacing = v.facing;
    if (!v.seen || ridden || Math.hypot(tx - v.x, tz - v.z) > 5) {
      v.x = tx;
      v.y = ty;
      v.z = tz;
      v.facing = tf;
    } else {
      v.x = damp(v.x, tx, 16, dt);
      v.y = damp(v.y, ty, 16, dt);
      v.z = damp(v.z, tz, 16, dt);
      v.facing = wrap(v.facing + wrap(tf - v.facing) * (1 - Math.exp(-16 * dt)));
    }
    v.seen = true;
    v.rig.root.position.set(v.x, v.y, v.z);
    v.rig.root.rotation.y = v.facing;
    const speed = ridden ? Math.hypot(pose.vx, pose.vz) : row.speed;
    const grounded = ridden ? (pose.flags & G_BIT) !== 0 : true;
    const turn = wrap(v.facing - lastFacing) / dt;
    v.anim.ambient = !ridden && row.phase === MOUNT_PHASE.loose;
    v.anim.update(dt, {
      speed,
      grounded,
      vy: ridden ? (pose.vy ?? 0) : 0,
      turn: Math.abs(turn) < 40 ? turn : 0,
      load: hitched ? 0.6 : 0,
      bolting: row.phase === MOUNT_PHASE.bolting,
      ridden,
      hitched,
    });
    v.rider = ridden ? row.rider : "";
    if (ridden) {
      const m = v.anim.motion;
      v.ride.bob = m.bob;
      v.ride.bodyZ = m.bodyZ;
      v.ride.pitch = m.pitch;
      v.ride.roll = m.roll;
      v.ride.speed01 = Math.min(1, speed / MOUNT.gallop);
      v.ride.scale = v.rig.scale;
      this.byRider.set(row.rider, v);
    }
  }

  private updateWagon(id: string, row: MountRowLike, dt: number): void {
    let v = this.wagons.get(id);
    if (v && v.rig.root.userData.coat !== row.coat) {
      const old = v;
      this.drop(this.wagons, id, old.rig.root, () => old.rig.dispose());
      v = undefined;
    }
    if (!v) {
      const rig = buildWagon({ coat: row.coat % 12, cargo: row.cargo, outline: this.outline });
      rig.root.userData.coat = row.coat;
      this.scene.add(rig.root);
      v = { kind: "wagon", rig, x: row.x, y: row.y, z: row.z, facing: row.facing, dist: 0, seen: false, phase: row.phase, cargo: -1, frame: 0 };
      this.wagons.set(id, v);
    }
    v.frame = this.frameNo;
    const px = v.x;
    const pz = v.z;
    if (!v.seen || Math.hypot(row.x - v.x, row.z - v.z) > 6) {
      v.x = row.x;
      v.y = row.y;
      v.z = row.z;
      v.facing = row.facing;
    } else {
      v.x = damp(v.x, row.x, 18, dt);
      v.y = damp(v.y, row.y, 18, dt);
      v.z = damp(v.z, row.z, 18, dt);
      v.facing = wrap(v.facing + wrap(row.facing - v.facing) * (1 - Math.exp(-18 * dt)));
    }
    v.seen = true;
    // wheels turn with the distance travelled along the wagon's own heading (backwards counts backwards)
    const along = (v.x - px) * -Math.sin(v.facing) + (v.z - pz) * -Math.cos(v.facing);
    v.dist += along;
    v.rig.roll(v.dist);
    if (row.cargo !== v.cargo) {
      v.rig.setCargo(row.cargo);
      v.cargo = row.cargo;
    }
    const wrecked = row.phase === MOUNT_PHASE.wrecked;
    const root = v.rig.root;
    root.position.set(v.x, v.y, v.z);
    root.rotation.y = v.facing;
    // a wreck lists and settles: smashed (hp 0) a little, burned out (hp 1) leaning hard on a broken axle, its crates gone
    root.rotation.z = damp(root.rotation.z, wrecked ? (row.hp === 1 ? 0.5 : 0.28) : 0, 6, dt);
    root.position.y = v.y - (wrecked ? 0.12 : 0);
    v.phase = row.phase;
  }

  /** What `CharacterAnimator` needs to seat `sessionId` on their horse (`PoseInput.ride`), or undefined when they are not on one this frame. Valid until the next `update`. */
  rideInput(sessionId: string): RideInput | undefined {
    return this.byRider.get(sessionId)?.ride;
  }

  /** The horse `sessionId` is on (for effects and the camera), if any. */
  horseOf(sessionId: string): { x: number; y: number; z: number; scale: number } | undefined {
    const v = this.byRider.get(sessionId);
    return v ? { x: v.x, y: v.y, z: v.z, scale: v.rig.scale } : undefined;
  }

  /** How far (m) to raise a downed body whose `dragger` is `wagon:<id>`: it is strapped to the roof rack. 0 for anyone else, or a wrecked wagon's. */
  bodyLift(dragger: string | undefined): number {
    if (!dragger || !dragger.startsWith("wagon:")) return 0;
    const id = dragger.slice(6);
    const w = this.wagons.get(id);
    if (!w || w.phase === MOUNT_PHASE.wrecked) return 0;
    return WAGON.rack;
  }

  setOutline(on: boolean): void {
    this.outline = on;
    for (const v of this.horses.values()) v.rig.setOutline(on);
    for (const v of this.wagons.values()) v.rig.setOutline(on);
  }

  dispose(): void {
    for (const v of this.horses.values()) {
      v.rig.root.removeFromParent();
      v.rig.dispose();
    }
    for (const v of this.wagons.values()) {
      v.rig.root.removeFromParent();
      v.rig.dispose();
    }
    this.horses.clear();
    this.wagons.clear();
    this.byRider.clear();
  }
}
