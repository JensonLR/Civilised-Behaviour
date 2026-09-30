import { CAMP, HILL, SITES } from "@cb/shared";

/**
 * The heading strip's maths, with no DOM: which way is a point from where you stand, where does it fall on a strip that shows `span` degrees
 * around the view, and what does the strip say for a heading. Yaw convention is the camera's: 0 looks down -Z, and it grows to the LEFT
 * (a positive yaw is a turn to the left, so east, at +X, is yaw -90 degrees).
 */

export const DEG = 180 / Math.PI;

/** The camera yaw that looks from (fx, fz) toward (tx, tz). */
export const yawTo = (fx: number, fz: number, tx: number, tz: number): number => Math.atan2(-(tx - fx), -(tz - fz));

/** Wraps to (-pi, pi]. */
export const wrapPi = (a: number): number => {
  const w = a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
  return w === -Math.PI ? Math.PI : w;
};

/** Compass heading in degrees 0..359 (0 = north = -Z, 90 = east = +X, clockwise) for a camera yaw. */
export const headingDegrees = (yaw: number): number => {
  const d = Math.round(-yaw * DEG);
  return ((d % 360) + 360) % 360;
};

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
/** The eight-point name of a heading ("NNE" is not used: the strip is a small brass thing). */
export const headingName = (deg: number): string => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

/**
 * Where a bearing falls on the strip: `-1..1` across it (0 = the middle notch, the way you are looking, negative = to your left), and whether it is
 * within the strip. Off the strip a mark is pinned to the edge on the side it lies (`clamped`), so it still says which way to turn.
 */
export interface StripPlace {
  x: number;
  inside: boolean;
}
export function stripPlace(viewYaw: number, bearingYaw: number, spanDeg: number, out: StripPlace): StripPlace {
  const rel = wrapPi(bearingYaw - viewYaw) * DEG; // + = to the left
  const half = spanDeg / 2;
  const x = -rel / half;
  out.inside = Math.abs(x) <= 1;
  out.x = Math.max(-1, Math.min(1, x));
  return out;
}

/** A place the strip points at. Fixed by the world's plan (the shared landscape data): no server message is needed. */
export interface Landmark {
  id: string;
  label: string;
  x: number;
  z: number;
}

const villageCentre = (): { x: number; z: number } => {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const s of SITES) {
    if (s.kind === "stall") continue;
    x += s.x;
    z += s.z;
    n++;
  }
  return { x: x / n, z: z / n };
};

/** The three places an expedition knows about from the first minute: the camp (the fire), Hollowmere (the middle of the village) and the Observatory. */
export function landmarks(): readonly Landmark[] {
  const v = villageCentre();
  return [
    { id: "camp", label: "Camp", x: CAMP.fire.x, z: CAMP.fire.z },
    { id: "village", label: "Hollowmere", x: v.x, z: v.z },
    { id: "observatory", label: "Observatory", x: HILL.x, z: HILL.z },
  ];
}

const POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
/** The sixteen-point name of a heading, for the readout in the middle of the strip. */
export const headingName16 = (deg: number): string => POINTS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;

/**
 * Lays chips (the places on the strip) out in rows so none sits on another: each chip has a centre `x` (0..1 across the strip) and a `width` (same
 * unit); chips are taken left to right and put in the first row whose last chip ends before this one starts (with `gap`). Returns each chip's row (0 =
 * the row nearest the strip) in the input order, using at most `rows` rows (the last row takes the overflow).
 */
export function stackRows(chips: readonly { x: number; width: number }[], gap: number, rows: number, out: number[]): number[] {
  const order = chips.map((_, i) => i).sort((a, b) => chips[a]!.x - chips[b]!.x);
  const ends: number[] = new Array(rows).fill(-Infinity);
  out.length = chips.length;
  for (const i of order) {
    const left = chips[i]!.x - chips[i]!.width / 2;
    let r = 0;
    while (r < rows - 1 && ends[r]! + gap > left) r++;
    ends[r] = chips[i]!.x + chips[i]!.width / 2;
    out[i] = r;
  }
  return out;
}

/** Ticks every 15 degrees; every 45th is a named point, every 90th a cardinal. Returns each tick's heading in degrees (0..345). */
export const TICKS: readonly number[] = Array.from({ length: 24 }, (_, i) => i * 15);
export const isCardinal = (deg: number): boolean => deg % 90 === 0;
export const isPoint = (deg: number): boolean => deg % 45 === 0;

/** Distance text for a landmark: metres up to 999, then kilometres to one decimal. */
export const distanceText = (m: number): string => (m < 1000 ? `${Math.max(0, Math.round(m))} m` : `${(m / 1000).toFixed(1)} km`);
