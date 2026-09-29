import { Vector3, type PerspectiveCamera } from "three";
import { clamp, type CollisionWorld } from "@cb/shared";

export interface CameraSettings {
  fov: number;
  sensitivity: number;
  invertY: boolean;
  shake: number;
}

/**
 * Third-person over-the-shoulder follow camera. Owns yaw/pitch (the input stream reports yaw so
 * the shared movement step stays camera-relative) and keeps itself above the terrain.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  distance = 5.6;
  private readonly focus = new Vector3();
  private readonly desired = new Vector3();
  private shakeEnergy = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly world: CollisionWorld,
    readonly settings: CameraSettings,
  ) {}

  look(dx: number, dy: number): void {
    this.yaw -= dx * this.settings.sensitivity;
    this.pitch = clamp(this.pitch + dy * this.settings.sensitivity * (this.settings.invertY ? -1 : 1), -0.35, 1.25);
  }

  addShake(amount: number): void {
    this.shakeEnergy = Math.min(1, this.shakeEnergy + amount);
  }

  /** `target` is the character's feet position; `dt` in seconds. */
  update(target: Vector3, dt: number, aiming: boolean): void {
    this.focus.lerp(target, 1 - Math.exp(-dt * 18));
    if (this.focus.distanceToSquared(target) > 100) this.focus.copy(target);

    const dist = aiming ? this.distance * 0.62 : this.distance;
    const cp = Math.cos(this.pitch);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // Camera sits behind the look direction (look = -Z at yaw 0), offset to the right shoulder.
    const shoulder = aiming ? 0.9 : 0.55;
    this.desired.set(
      this.focus.x + sinY * cp * dist + cosY * shoulder,
      this.focus.y + 1.55 + Math.sin(this.pitch) * dist,
      this.focus.z + cosY * cp * dist - sinY * shoulder,
    );
    const floor = this.world.terrainHeight(this.desired.x, this.desired.z) + 0.4;
    if (this.desired.y < floor) this.desired.y = floor;

    this.camera.position.lerp(this.desired, 1 - Math.exp(-dt * 20));
    this.shakeEnergy = Math.max(0, this.shakeEnergy - dt * 2.2);
    const shake = this.shakeEnergy * this.shakeEnergy * 0.12 * this.settings.shake;
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }
    this.camera.lookAt(this.focus.x, this.focus.y + 1.35, this.focus.z);
    if (this.camera.fov !== this.settings.fov) {
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
