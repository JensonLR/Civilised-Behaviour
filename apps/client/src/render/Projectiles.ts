import { DynamicDrawUsage, InstancedMesh, MeshToonMaterial, Object3D, SphereGeometry, type Scene } from "three";
import { PALETTE, WEAPON, WEAPONS, newWorldHit, rayWorld, stepBallistic, type Ballistic, type CollisionWorld, type WeaponId } from "@cb/shared";
import { sharedToonRamp } from "@cb/procedural/three";
import type { ShotFx } from "./weapons/ShotFx.ts";

/**
 * The cosmetic flight of balls and pellets. The server owns where a round goes and what it hits; this is a picture of it: the same ballistic
 * step (shared `stepBallistic`, the weapon's own gravity), a streak behind it, a smoke trail behind a cannon ball, and a dark ball drawn on
 * the nose. It stops at the static world (the server's impact event draws the puff), so it is never a source of truth and needs no lag
 * compensation. Pooled; nothing is allocated per frame.
 */
export const PROJECTILES = { cap: 96 } as const;

const dummy = new Object3D();
const hit = newWorldHit();
const ball: Ballistic = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/** Drawn radius of the ball, by weapon (a little larger than life: it is a picture of something that must be seen to be understood). */
const DRAWN = { [WEAPON.PISTOL]: 0.045, [WEAPON.BLUNDERBUSS]: 0.028, [WEAPON.CANNON]: 0.17 } as const;

export class Projectiles {
  private readonly mesh: InstancedMesh;
  private readonly alive = new Uint8Array(PROJECTILES.cap);
  private readonly x = new Float64Array(PROJECTILES.cap);
  private readonly y = new Float64Array(PROJECTILES.cap);
  private readonly z = new Float64Array(PROJECTILES.cap);
  private readonly vx = new Float64Array(PROJECTILES.cap);
  private readonly vy = new Float64Array(PROJECTILES.cap);
  private readonly vz = new Float64Array(PROJECTILES.cap);
  private readonly life = new Float32Array(PROJECTILES.cap);
  private readonly weapon = new Uint8Array(PROJECTILES.cap);
  private readonly smoke = new Float32Array(PROJECTILES.cap);
  private next = 0;

  constructor(
    scene: Scene,
    private world: CollisionWorld,
    private readonly fx: ShotFx,
  ) {
    this.mesh = new InstancedMesh(new SphereGeometry(1, 8, 6), new MeshToonMaterial({ color: PALETTE.weapons.shell, gradientMap: sharedToonRamp() }), PROJECTILES.cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** The region changed: rounds stop at the new static world. */
  setWorld(world: CollisionWorld): void {
    this.world = world;
  }

  get live(): number {
    let n = 0;
    for (let i = 0; i < PROJECTILES.cap; i++) n += this.alive[i]!;
    return n;
  }

  /** A round leaves at (x,y,z) with velocity (vx,vy,vz) m/s. */
  spawn(weapon: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const r = WEAPONS[weapon as WeaponId]?.ranged;
    if (!r || r.speed <= 0) return;
    const i = this.next;
    this.next = (this.next + 1) % PROJECTILES.cap;
    this.alive[i] = 1;
    this.active = true;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = Math.min(4, r.range / r.speed);
    this.weapon[i] = weapon;
    this.smoke[i] = 0;
  }

  /** Told when a round stops at the static world (weapon, point, surface normal): the integrator scorches the ground under a cannon ball and chips a wall under a pellet. */
  onImpact: ((weapon: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void) | undefined;

  /** False while nothing is in flight: `update` then does no work and uploads nothing. */
  private active = false;

  update(dt: number): void {
    if (!this.active) return;
    let maxLive = 0;
    for (let i = 0; i < PROJECTILES.cap; i++) {
      if (this.alive[i] === 0) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const w = this.weapon[i]!;
      const r = WEAPONS[w as WeaponId].ranged!;
      const ox = this.x[i]!;
      const oy = this.y[i]!;
      const oz = this.z[i]!;
      ball.x = ox;
      ball.y = oy;
      ball.z = oz;
      ball.vx = this.vx[i]!;
      ball.vy = this.vy[i]!;
      ball.vz = this.vz[i]!;
      stepBallistic(ball, dt, r.gravity);
      const sx = ball.x - ox;
      const sy = ball.y - oy;
      const sz = ball.z - oz;
      const len = Math.hypot(sx, sy, sz);
      let ex = ball.x;
      let ey = ball.y;
      let ez = ball.z;
      let done = false;
      if (len > 1e-9 && rayWorld(this.world, ox, oy, oz, sx / len, sy / len, sz / len, len, hit)) {
        ex = ox + (sx / len) * hit.t;
        ey = oy + (sy / len) * hit.t;
        ez = oz + (sz / len) * hit.t;
        done = true;
      }
      this.fx.trail(ox, oy, oz, ex, ey, ez, w === WEAPON.CANNON);
      if (w !== WEAPON.CANNON) this.fx.nearMiss(ox, oy, oz, ex, ey, ez); // a ball going past the listener's head
      if (w === WEAPON.CANNON) {
        this.smoke[i]! -= dt;
        if (this.smoke[i]! <= 0) {
          this.smoke[i] = 0.035;
          this.fx.ballSmoke(ox, oy, oz);
        }
      }
      this.x[i] = ball.x;
      this.y[i] = ball.y;
      this.z[i] = ball.z;
      this.vx[i] = ball.vx;
      this.vy[i] = ball.vy;
      this.vz[i] = ball.vz;
      this.life[i]! -= dt;
      if (done || this.life[i]! <= 0) {
        if (done) this.onImpact?.(w, ex, ey, ez, hit.nx, hit.ny, hit.nz);
        this.alive[i] = 0;
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      maxLive = i + 1;
      dummy.position.set(ball.x, ball.y, ball.z);
      dummy.scale.setScalar(DRAWN[w as keyof typeof DRAWN] ?? 0.04);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.count = maxLive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (maxLive === 0) this.active = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshToonMaterial).dispose();
  }
}
