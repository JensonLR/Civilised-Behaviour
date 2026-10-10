import { MOUNT } from "./mount.ts";

/**
 * RIDDEN DOWN (D-111), after the cavalry charges of the big medieval sandbox and the western's horses (the idea; built here). A horse at a trot or faster that meets a
 * man on foot goes through him: he is thrown ahead of it and off its line, onto his back, hurt by the hooves in proportion to the pace; the horse loses a little of its
 * own. The thrown body is the boot's (D-108): watched for the wall it meets and the drop it falls, so a charge along a wall or a cliff is the move.
 *
 * Pure numbers and two helpers. The server finds the contact (systems/Mounts.ts) and lands it (Combat's `trample`); the room decides who may be ridden down.
 */
export const TRAMPLE = {
  /** The slowest pace that rides a man down (between the walk and the trot: a horse that is merely walking stops, or shoulders past). */
  minSpeed: (MOUNT.walk + MOUNT.trot) / 2,
  /** Where the horse's chest is (metres ahead of the saddle), and how near a man must stand to it to be struck. */
  ahead: 0.95,
  reach: 1.05,
  /** No higher or lower than this from the horse (a man on a roof the horse passes under is not struck). */
  dy: 1.4,
  /** What the hooves do: a base, more per m/s over `minSpeed`, capped. A gallop does about twenty. */
  base: 8,
  perMs: 2.2,
  max: 30,
  /** The throw: this share of the horse's speed, off the line by `side` of it, lifted by up to `lift` at a gallop; he is floored for the boot's time. */
  carry: 0.85,
  side: 0.65,
  lift: 3.8,
  stumble: 1,
  /** What it costs the horse: this share of its speed is kept. */
  keep: 0.85,
  /** One man is struck by one horse once in this long (he is under it, not struck again every tick). */
  cooldownS: 1.2,
} as const;

/** The hooves' harm at `speed` m/s (0 below the trample pace). */
export function trampleDamage(speed: number): number {
  if (!(speed >= TRAMPLE.minSpeed)) return 0;
  return Math.min(TRAMPLE.max, TRAMPLE.base + TRAMPLE.perMs * (speed - TRAMPLE.minSpeed));
}

/**
 * The way he is thrown (a unit vector into `out`): ahead along the horse's heading (`fx`, `fz`, a unit vector), and off its line to the side of it he stood on
 * (`ox`, `oz`: him minus the horse's chest). A man dead ahead goes to the horse's right.
 */
export function trampleDir(fx: number, fz: number, ox: number, oz: number, out: { x: number; z: number }): void {
  // the side of the line he is on: the sign of the cross product (heading x offset); the right of a heading (fx, fz) is (-fz, fx)
  const cross = fx * oz - fz * ox;
  const s = cross < 0 ? -1 : 1;
  const x = fx + -fz * s * TRAMPLE.side;
  const z = fz + fx * s * TRAMPLE.side;
  const len = Math.hypot(x, z) || 1;
  out.x = x / len;
  out.z = z / len;
}

/** How high he is thrown at `speed` (0 at the trample pace, `TRAMPLE.lift` at a full gallop). */
export function trampleLift(speed: number): number {
  const t = (speed - TRAMPLE.minSpeed) / (MOUNT.gallop - TRAMPLE.minSpeed);
  return TRAMPLE.lift * Math.max(0, Math.min(1, t));
}
