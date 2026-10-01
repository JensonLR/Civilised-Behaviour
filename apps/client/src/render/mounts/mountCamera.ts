/**
 * The third-person camera while mounted: it pulls back and up (the horse is long and the rider sits high) and widens a little at a gallop. Pure and eased: the camera rig keeps
 * one `MountedCamera` state and adds `pull`/`rise`/`fov` to its usual distance, height and field of view. Allocation-free.
 */
export const MOUNTED_CAMERA = {
  /** Metres added to the camera's distance at rest on a horse, and the extra at a full gallop. */
  pull: 1.1,
  pullGallop: 0.9,
  /** Metres added to the camera's height, at rest and at a gallop. */
  rise: 0.45,
  riseGallop: 0.25,
  /** Degrees added to the field of view at a full gallop (a sense of speed). */
  fovGallop: 6,
  /** How quickly the camera settles (per second): getting on and off is a glide, not a cut. */
  rate: 4,
} as const;

export interface MountedCamera {
  pull: number;
  rise: number;
  fov: number;
}

export const newMountedCamera = (): MountedCamera => ({ pull: 0, rise: 0, fov: 0 });

/** The target for `speed01` (0..1 of a gallop); all zero when not mounted. */
export function mountedCameraTarget(mounted: boolean, speed01: number, out: MountedCamera): MountedCamera {
  const s = Number.isFinite(speed01) ? Math.min(1, Math.max(0, speed01)) : 0;
  out.pull = mounted ? MOUNTED_CAMERA.pull + MOUNTED_CAMERA.pullGallop * s : 0;
  out.rise = mounted ? MOUNTED_CAMERA.rise + MOUNTED_CAMERA.riseGallop * s : 0;
  out.fov = mounted ? MOUNTED_CAMERA.fovGallop * s * s : 0;
  return out;
}

const target = newMountedCamera();

/** Eases `state` toward the target; never overshoots. */
export function easeMountedCamera(state: MountedCamera, dt: number, mounted: boolean, speed01: number): MountedCamera {
  if (!(dt > 0) || !Number.isFinite(dt)) return state;
  mountedCameraTarget(mounted, speed01, target);
  const k = 1 - Math.exp(-MOUNTED_CAMERA.rate * Math.min(dt, 0.25));
  state.pull += (target.pull - state.pull) * k;
  state.rise += (target.rise - state.rise) * k;
  state.fov += (target.fov - state.fov) * k;
  return state;
}
