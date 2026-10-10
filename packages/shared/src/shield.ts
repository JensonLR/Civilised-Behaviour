/**
 * THE HUMAN SHIELD (D-112), after the hostage grabs of the cover shooters and the westerns (the idea; built here). GRAB on a man staggered in front of you (down on a
 * knee or doubled over: the finisher's target, D-105) takes him by the collar and holds him up in front of you. You walk slowly and can still fire over his shoulder;
 * his own side's rounds meet him first, and his comrades hold their fire rather than shoot him, unless they are brave enough not to care (the comedy is the ones who do
 * not). GRAB again shoves him off, onto his back, watched for what he meets (D-108). He works himself free after a while; shot down, he slumps out of your hands.
 *
 * Pure numbers and one helper. The server holds him (systems/Casualties.ts), lets the holder fire (Combat), and stays his comrades' hands (Cast).
 */
export const SHIELD = {
  /** `PlayerState.roped` for a man held up as a shield (1 is the lariat's, D-106). */
  held: 2,
  /** Where he is held: this far in front of the holder's chest, facing the way the holder faces. */
  ahead: 0.62,
  /** How hard he is kept there (a spring toward the spot, per second) and how fast he can be moved. */
  stiff: 14,
  maxSpeed: 8,
  /** He works himself free after this long; and is let go if he ends up further than this from the holder (a wall between them, a fall). */
  holdS: 9,
  breakRange: 2.2,
  /** From this bravery a man fires through his own comrade (a returning grudge man has nerve to spare: D-109). */
  ruthless: 75,
  /** The shove that ends it: his speed, the lift, the stumble (his footing gone, as a boot's: D-108) and how long he lies. */
  shove: 7.5,
  shoveLift: 3,
  shoveStumble: 0.9,
  shoveFloorS: 1.8,
} as const;

/**
 * Whether the shield at (sx, sz) stands between a shooter at (ax, az) and the man holding it at (bx, bz): nearer the shooter than the holder is, and within
 * 0.75 m of the line between them. A man firing from behind or beside the holder has a clear shot; one in front has his comrade in the way.
 */
export function shieldBetween(ax: number, az: number, sx: number, sz: number, bx: number, bz: number): boolean {
  const lx = bx - ax;
  const lz = bz - az;
  const len2 = lx * lx + lz * lz;
  if (!(len2 > 1e-6)) return false;
  const t = ((sx - ax) * lx + (sz - az) * lz) / len2;
  if (t <= 0 || t >= 1) return false;
  const px = ax + lx * t - sx;
  const pz = az + lz * t - sz;
  return px * px + pz * pz <= 0.75 * 0.75;
}
