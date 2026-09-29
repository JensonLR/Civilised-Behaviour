import { clamp, smoothstep } from "./math.ts";
import { PALETTE } from "./palette.ts";
import type { Rgb } from "./worldgen.ts";

/**
 * The day cycle as pure keyframes: given a clock (hours, 0..24) it fills a `DayState` with everything the renderer needs to light a
 * moment of the day - sun/moon colour and direction, sky bands, horizon glow, hemisphere bounce, fog density, how strongly the fire
 * and lanterns read. Every colour is a convex mix of PALETTE entries (the day, morning, dusk and night stops in `PALETTE.world` and
 * the sky/light blocks) scaled down by a sky exposure <= 1, so it can never leave the palette's chroma range. Nothing here allocates
 * after construction and nothing is random: the same hour is the same sky on every client.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DayState {
  hours: number;
  /** Colour of the directional light (sun by day, moon by night). */
  sun: Rgb;
  top: Rgb;
  mid: Rgb;
  /** The colour of distance: fog, the sky's lowest band, the skirt and the far hills. */
  horizon: Rgb;
  glow: Rgb;
  hemiSky: Rgb;
  hemiGround: Rgb;
  /** Unit vector toward the DIRECTIONAL LIGHT (sun by day, moon by night), never below ~10 degrees so shadows stay sane. */
  lightDir: Vec3;
  /** Unit vector toward the sun disc (below the horizon at night). */
  sunDir: Vec3;
  moonDir: Vec3;
  sunIntensity: number;
  hemiIntensity: number;
  fogDensity: number;
  /** 0 by day .. 1 in the middle of the night. */
  night: number;
  /** 1 at sunset/sunrise glow, 0 elsewhere. */
  dusk: number;
  /** Stars visible (0..1). */
  stars: number;
  /** Moon visible (0..1). */
  moon: number;
  /** Overall sky brightness multiplier (already applied to top/mid/horizon/glow). */
  exposure: number;
  /** How much the campfire and lanterns should read (0 in bright day, 1 at night). */
  fire: number;
  /** Brightness multiplier for things not lit by scene lights (far hills, unlit foliage silhouettes). */
  ambient: number;
}

interface Stop {
  h: number;
  sun: number;
  top: number;
  mid: number;
  horizon: number;
  glow: number;
  hemiSky: number;
  hemiGround: number;
  sunI: number;
  hemiI: number;
  fog: number;
  exposure: number;
  fire: number;
  ambient: number;
}

const L = PALETTE.light;
const S = PALETTE.sky;
const W = PALETTE.world;

const NIGHT: Omit<Stop, "h"> = { sun: W.nightSun, top: W.nightTop, mid: W.nightMid, horizon: W.nightHorizon, glow: W.nightGlow, hemiSky: W.nightSky, hemiGround: W.nightBounce, sunI: 0.95, hemiI: 0.62, fog: 0.0105, exposure: 0.4, fire: 1, ambient: 0.5 };

/** Stops on a 24 hour loop. Night appears at both ends so the span between the last and the first is a constant night. */
const STOPS: readonly Stop[] = [
  { h: 4.5, ...NIGHT },
  { h: 7.5, sun: W.morningSun, top: W.morningTop, mid: W.morningMid, horizon: W.morningHorizon, glow: W.morningGlow, hemiSky: W.morningSky, hemiGround: W.morningBounce, sunI: 2.6, hemiI: 0.95, fog: 0.0095, exposure: 0.96, fire: 0.3, ambient: 0.92 },
  { h: 13, sun: L.sun, top: S.top, mid: S.mid, horizon: S.horizon, glow: W.skyGlow, hemiSky: L.sky, hemiGround: L.bounce, sunI: 3.0, hemiI: 1.0, fog: 0.0085, exposure: 1, fire: 0.04, ambient: 1 },
  { h: 18.6, sun: W.duskSun, top: W.duskTop, mid: W.duskMid, horizon: W.duskHorizon, glow: W.duskGlow, hemiSky: W.duskSky, hemiGround: W.duskBounce, sunI: 2.2, hemiI: 0.82, fog: 0.0092, exposure: 0.86, fire: 0.7, ambient: 0.8 },
  { h: 21.5, ...NIGHT },
];

const cache = new Map<number, [number, number, number]>();
function rgb(hex: number): [number, number, number] {
  let c = cache.get(hex);
  if (!c) {
    c = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    cache.set(hex, c);
  }
  return c;
}

/** Mixes two palette hexes into `out`, scaled by `k` (a convex mix scaled toward black stays inside the palette's chroma range). */
function mixInto(out: Rgb, a: number, b: number, t: number, k: number): void {
  const ca = rgb(a);
  const cb = rgb(b);
  out.r = (ca[0] + (cb[0] - ca[0]) * t) * k;
  out.g = (ca[1] + (cb[1] - ca[1]) * t) * k;
  out.b = (ca[2] + (cb[2] - ca[2]) * t) * k;
}

const RISE = 6;
const SET = 19;
const MAX_ELEVATION = 52 * (Math.PI / 180);
const DEG = Math.PI / 180;

function direction(elevation: number, azimuth: number, out: Vec3): Vec3 {
  const ce = Math.cos(elevation);
  out.x = ce * Math.cos(azimuth);
  out.y = Math.sin(elevation);
  out.z = ce * Math.sin(azimuth);
  return out;
}

/** The sun's elevation (radians) at a clock hour: a sine arc between sunrise and sunset, continuing below the horizon after dark. */
export function sunElevation(hours: number): number {
  return MAX_ELEVATION * Math.sin((Math.PI * (hours - RISE)) / (SET - RISE));
}

/** Sun azimuth (radians from +x toward +z): rises north-east (-z is north), passes south (+z), sets north-west. */
export function sunAzimuth(hours: number): number {
  return (-40 + (hours - RISE) * 20) * DEG;
}

export function createDayState(): DayState {
  const c = (): Rgb => ({ r: 0, g: 0, b: 0 });
  const v = (): Vec3 => ({ x: 0, y: 1, z: 0 });
  return { hours: 0, sun: c(), top: c(), mid: c(), horizon: c(), glow: c(), hemiSky: c(), hemiGround: c(), lightDir: v(), sunDir: v(), moonDir: v(), sunIntensity: 0, hemiIntensity: 0, fogDensity: 0, night: 0, dusk: 0, stars: 0, moon: 0, exposure: 1, fire: 0, ambient: 1 };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wraps a clock into [0, 24). */
export const wrapHours = (h: number): number => ((h % 24) + 24) % 24;

/** Fills `out` for the clock hour `hoursIn` (any number; wrapped). Allocation-free. */
export function dayState(hoursIn: number, out: DayState): DayState {
  const hours = wrapHours(hoursIn);
  out.hours = hours;
  // neighbouring stops on the loop
  const first = STOPS[0]!;
  const last = STOPS[STOPS.length - 1]!;
  let a: Stop;
  let b: Stop;
  let t: number;
  if (hours < first.h) {
    a = last;
    b = first;
    t = (hours + 24 - last.h) / (first.h + 24 - last.h);
  } else if (hours >= last.h) {
    a = last;
    b = first;
    t = (hours - last.h) / (first.h + 24 - last.h);
  } else {
    let i = 0;
    while (i + 2 < STOPS.length && hours >= STOPS[i + 1]!.h) i++;
    a = STOPS[i]!;
    b = STOPS[i + 1]!;
    t = (hours - a.h) / (b.h - a.h);
  }
  const k = t * t * (3 - 2 * t);
  const exposure = lerp(a.exposure, b.exposure, k);
  mixInto(out.sun, a.sun, b.sun, k, 1);
  mixInto(out.top, a.top, b.top, k, exposure);
  mixInto(out.mid, a.mid, b.mid, k, exposure);
  mixInto(out.glow, a.glow, b.glow, k, exposure);
  mixInto(out.hemiSky, a.hemiSky, b.hemiSky, k, 1);
  mixInto(out.hemiGround, a.hemiGround, b.hemiGround, k, 1);
  // the colour of distance blends the two stops' horizon and mid bands
  const ha = rgb(a.horizon);
  const hb = rgb(b.horizon);
  const ma = rgb(a.mid);
  const mb = rgb(b.mid);
  const hr = lerp(ha[0], hb[0], k);
  const hg = lerp(ha[1], hb[1], k);
  const hbl = lerp(ha[2], hb[2], k);
  out.horizon.r = (hr + (lerp(ma[0], mb[0], k) - hr) * 0.14) * exposure;
  out.horizon.g = (hg + (lerp(ma[1], mb[1], k) - hg) * 0.14) * exposure;
  out.horizon.b = (hbl + (lerp(ma[2], mb[2], k) - hbl) * 0.14) * exposure;
  out.hemiIntensity = lerp(a.hemiI, b.hemiI, k);
  out.fogDensity = lerp(a.fog, b.fog, k);
  out.exposure = exposure;
  out.fire = lerp(a.fire, b.fire, k);
  out.ambient = lerp(a.ambient, b.ambient, k);

  // sun and moon
  const el = sunElevation(hours);
  direction(el, sunAzimuth(hours), out.sunDir);
  const u = ((hours + 4.5) % 24) / 10; // 0 at moonrise (19:30), 1 at moonset (05:30)
  const mu = clamp(u, 0, 1);
  const moonEl = 48 * DEG * Math.sin(Math.PI * mu) - (u > 1 ? 0.35 : 0);
  const moonAz = (260 - mu * 160) * DEG;
  direction(moonEl, moonAz, out.moonDir);
  const late = hours < 12 ? hours + 24 : hours; // 19:00 .. 29:00 (05:00 next day)
  out.moon = smoothstep(19.6, 21, late) * (1 - smoothstep(28.4, 29.5, late)); // rises at 19:30, sets at 05:30 (see u above)
  const sunUp = smoothstep(-3 * DEG, 9 * DEG, el);
  out.night = 1 - smoothstep(-8 * DEG, 8 * DEG, el);
  out.stars = 1 - smoothstep(-12 * DEG, -1 * DEG, el);
  out.dusk = Math.exp(-((el / (12 * DEG)) ** 2)) * (1 - out.night * 0.4);
  // The directional light is the sun and the moon blended by how strong each is, so the light (and every shadow) swings smoothly
  // through twilight instead of flipping when one sets and the other rises.
  const wS = lerp(a.sunI, b.sunI, k) * sunUp;
  const wM = NIGHT.sunI * out.moon * (1 - sunUp);
  const cs = Math.cos(Math.max(el, 10 * DEG));
  const ss = Math.sin(Math.max(el, 10 * DEG));
  const sa = sunAzimuth(hours);
  const me = Math.max(moonEl, 14 * DEG);
  const cm = Math.cos(me);
  const sm = Math.sin(me);
  const total = wS + wM;
  // A small floor weight sends the direction straight up while both lights are out (dusk, dawn), so it is continuous through the gap
  // instead of snapping between where the sun set and where the moon rises.
  const den = total + 0.04;
  const ws = wS / den;
  const wm = wM / den;
  const w0 = 0.04 / den;
  let lx = cs * Math.cos(sa) * ws + cm * Math.cos(moonAz) * wm;
  let ly = ss * ws + sm * wm + w0;
  let lz = cs * Math.sin(sa) * ws + cm * Math.sin(moonAz) * wm;
  const ln = Math.hypot(lx, ly, lz) || 1;
  lx /= ln;
  ly /= ln;
  lz /= ln;
  out.lightDir.x = lx;
  out.lightDir.y = ly;
  out.lightDir.z = lz;
  out.sunIntensity = total;
  return out;
}

// ---- the clock --------------------------------------------------------------------------------------------------------------------

/** Clock hours advanced per real second by default: a game hour takes ~80 s, and the dark hours pass three times faster. */
export const CLOCK = { hoursPerSecond: 1 / 80, nightSpeedup: 3, defaultStart: 9 };

export function clockRate(hours: number): number {
  const h = wrapHours(hours);
  const dark = h < 5.2 || h > 20.6;
  return CLOCK.hoursPerSecond * (dark ? CLOCK.nightSpeedup : 1);
}

/** Advances the clock by `dt` real seconds. */
export function advanceClock(hours: number, dt: number): number {
  return wrapHours(hours + clockRate(hours) * dt);
}

const NAMED: Record<string, number> = { dawn: 6.2, morning: 8, noon: 13, day: 13, afternoon: 15.5, dusk: 18.6, sunset: 18.6, evening: 19.6, night: 23.5, midnight: 0 };

/** Parses `?time=`: a clock hour ("17.5"), "17:30", or a name (morning, noon, afternoon, dusk, night). Undefined if unrecognised. */
export function parseClock(text: string | null | undefined): number | undefined {
  if (text == null || text === "") return undefined;
  const named = NAMED[text.toLowerCase()];
  if (named !== undefined) return named;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(text);
  if (m) return wrapHours(Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0));
  const n = Number(text);
  return Number.isFinite(n) ? wrapHours(n) : undefined;
}
