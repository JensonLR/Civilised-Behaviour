import { clamp, smoothstep } from "./math.ts";
import { PALETTE } from "./palette.ts";
import { hashFloat } from "./rng.ts";
import type { DayState } from "./daycycle.ts";
import type { Rgb } from "./worldgen.ts";

/**
 * Weather as a pure function of (world seed, world time). The server owns "how old the world is" (the same number that drives the clock),
 * so the server and every client agree on the sky, the rain and the lightning WITHOUT a single weather message. Time is cut into slots
 * (~2.5 minutes); each slot has a state picked by a hash of (seed, slot), and the first 20-40 seconds of a slot blend from the previous
 * state's parameters into the new ones. The world always starts clear. Nothing here allocates once the caller supplies `out`.
 *
 * `applyWeather` then bends a `DayState` (sky, fog, light) toward the weather: it is a second, separate step, so the day cycle's own
 * invariants (in gamut, inside the palette's chroma) still hold and the weather adds its own.
 */

export type WeatherKind = "clear" | "overcast" | "drizzle" | "storm" | "fog" | "dust";

export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "overcast", "drizzle", "storm", "fog", "dust"];

export interface Weather {
  /** The dominant state right now (the previous one until the blend is half done). */
  kind: WeatherKind;
  /** 0..1: falling rain (drizzle ~0.5, storm 1). */
  rain: number;
  /** 0..1: cloud cover. */
  overcast: number;
  /** 0..1: fog banks. */
  fog: number;
  /** 0..1: wind strength (drives foliage sway and cloth). */
  wind: number;
  /** 0..1: blowing dust. */
  dust: number;
  /** 0..1: thunderstorm (lightning happens above ~0.5). */
  storm: number;
  /** 0..1: how wet the ground is (rises with rain, dries over ~1.5 minutes). */
  wet: number;
}

export const createWeather = (): Weather => ({ kind: "clear", rain: 0, overcast: 0, fog: 0, wind: 0, dust: 0, storm: 0, wet: 0 });

/** The parameters each state settles at. */
type Params = Omit<Weather, "kind" | "wet">;
const TABLE: Record<WeatherKind, Params> = {
  clear: { rain: 0, overcast: 0.06, fog: 0, wind: 0.22, dust: 0, storm: 0 },
  overcast: { rain: 0, overcast: 0.78, fog: 0.06, wind: 0.4, dust: 0, storm: 0 },
  drizzle: { rain: 0.5, overcast: 0.88, fog: 0.16, wind: 0.34, dust: 0, storm: 0 },
  storm: { rain: 1, overcast: 1, fog: 0.2, wind: 1, dust: 0, storm: 1 },
  fog: { rain: 0, overcast: 0.5, fog: 1, wind: 0.08, dust: 0, storm: 0 },
  dust: { rain: 0, overcast: 0.34, fog: 0.35, wind: 0.85, dust: 1, storm: 0 },
};

/** Odds of each state for a slot (must add up to 1). */
const ODDS: readonly (readonly [WeatherKind, number])[] = [
  ["clear", 0.34],
  ["overcast", 0.2],
  ["drizzle", 0.16],
  ["fog", 0.12],
  ["dust", 0.1],
  ["storm", 0.08],
];

export const WEATHER = {
  /** Length of one weather slot. */
  slotMs: 150_000,
  /** The blend into a new slot lasts between these. */
  blendMinMs: 20_000,
  blendMaxMs: 40_000,
  /** Ground dries over this long after the rain stops. */
  dryMs: 90_000,
  /** Lightning is rolled in windows of this length. */
  strikeWindowMs: 6_500,
} as const;

/** The state of a slot (slot 0 and anything earlier is clear). */
export function slotKind(seed: number, slot: number): WeatherKind {
  if (slot <= 0) return "clear";
  const r = hashFloat(seed >>> 0, slot, 0x3a7);
  let acc = 0;
  for (const [kind, p] of ODDS) {
    acc += p;
    if (r < acc) return kind;
  }
  return "clear";
}

/** How strongly a slot's state is expressed (0.85..1: a storm is not always THE storm). */
const strength = (seed: number, slot: number): number => 0.85 + 0.15 * hashFloat(seed >>> 0, slot, 0x5b1);

function slotParams(seed: number, slot: number, out: Params): Params {
  const t = TABLE[slotKind(seed, slot)];
  const k = slot <= 0 ? 1 : strength(seed, slot);
  out.rain = t.rain * k;
  out.overcast = t.overcast;
  out.fog = t.fog * (0.75 + 0.25 * k);
  out.wind = t.wind * (0.8 + 0.2 * k);
  out.dust = t.dust * k;
  out.storm = t.storm > 0 ? (k > 0.9 ? 1 : k * 1.05) : 0;
  return out;
}

const cur: Params = { rain: 0, overcast: 0, fog: 0, wind: 0, dust: 0, storm: 0 };
const prev: Params = { rain: 0, overcast: 0, fog: 0, wind: 0, dust: 0, storm: 0 };

function paramsAt(seed: number, timeMs: number, out: Params): { slot: number; u: number } {
  const slot = Math.max(0, Math.floor(timeMs / WEATHER.slotMs));
  const into = timeMs - slot * WEATHER.slotMs;
  const blend = WEATHER.blendMinMs + (WEATHER.blendMaxMs - WEATHER.blendMinMs) * hashFloat(seed >>> 0, slot, 0x9c3);
  const u = slot === 0 ? 1 : smoothstep(0, 1, clamp(into / blend, 0, 1));
  slotParams(seed, slot, cur);
  if (u >= 1) {
    Object.assign(out, cur);
    return { slot, u };
  }
  slotParams(seed, slot - 1, prev);
  out.rain = prev.rain + (cur.rain - prev.rain) * u;
  out.overcast = prev.overcast + (cur.overcast - prev.overcast) * u;
  out.fog = prev.fog + (cur.fog - prev.fog) * u;
  out.wind = prev.wind + (cur.wind - prev.wind) * u;
  out.dust = prev.dust + (cur.dust - prev.dust) * u;
  out.storm = prev.storm + (cur.storm - prev.storm) * u;
  return { slot, u };
}

const scratch: Params = { rain: 0, overcast: 0, fog: 0, wind: 0, dust: 0, storm: 0 };
const WET_STEPS = 6;

/** Rain alone at a time (for the wetness history). */
function rainAt(seed: number, timeMs: number): number {
  if (timeMs <= 0) return 0;
  paramsAt(seed, timeMs, scratch);
  return scratch.rain;
}

/**
 * The weather `timeMs` milliseconds into the world's life. Pure in (seed, timeMs). Pass `out` to avoid allocating.
 */
export function weatherAt(seed: number, timeMs: number, out: Weather = createWeather()): Weather {
  const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const { slot, u } = paramsAt(seed, t, out as Params);
  out.kind = slotKind(seed, u < 0.5 ? slot - 1 : slot);
  // wetness: the rain of the last minute or so, fading linearly (a max of continuous terms is continuous)
  let wet = out.rain;
  const step = WEATHER.dryMs / (WET_STEPS + 1);
  for (let j = 1; j <= WET_STEPS; j++) wet = Math.max(wet, rainAt(seed, t - j * step) * (1 - j / (WET_STEPS + 1)));
  out.wet = Math.min(1, wet * 1.7);
  return out;
}

/**
 * D-103: where the wind blows TOWARDS, as a unit vector in the ground plane (it drives the fire's spread and the smoke's drift). Pure in (seed, timeMs): each world has a
 * prevailing direction, each weather slot veers from it by up to 60 degrees, the change blends in with the slot's other weather, and it wanders a little within a slot.
 */
export function windAt(seed: number, timeMs: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const slot = Math.max(0, Math.floor(t / WEATHER.slotMs));
  const into = t - slot * WEATHER.slotMs;
  const blend = WEATHER.blendMinMs + (WEATHER.blendMaxMs - WEATHER.blendMinMs) * hashFloat(seed >>> 0, slot, 0x9c3);
  const u = slot === 0 ? 1 : smoothstep(0, 1, clamp(into / blend, 0, 1));
  const prevailing = hashFloat(seed >>> 0, 0x77d, 0x1d) * Math.PI * 2;
  const veer = (s: number): number => (hashFloat(seed >>> 0, s, 0x1de) - 0.5) * 2.1;
  let d = veer(slot - 1) + (veer(slot) - veer(slot - 1)) * u;
  d += Math.sin(t / 23_000 + seed * 0.001) * 0.15;
  out.x = Math.sin(prevailing + d);
  out.z = Math.cos(prevailing + d);
  return out;
}

/** A state at full strength (review scenes, `?weather=`). */
export function weatherPreset(kind: WeatherKind, out: Weather = createWeather()): Weather {
  const p = TABLE[kind];
  out.kind = kind;
  out.rain = p.rain;
  out.overcast = p.overcast;
  out.fog = p.fog;
  out.wind = p.wind;
  out.dust = p.dust;
  out.storm = p.storm;
  out.wet = Math.min(1, p.rain * 1.7);
  return out;
}

export function parseWeatherKind(text: string | null | undefined): WeatherKind | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const alias: Record<string, WeatherKind> = { rain: "drizzle", drizzle: "drizzle", thunder: "storm", storm: "storm", cloud: "overcast", cloudy: "overcast", overcast: "overcast", mist: "fog", fog: "fog", wind: "dust", dust: "dust", clear: "clear", sun: "clear" };
  return alias[t];
}

// ---- lightning -------------------------------------------------------------------------------------------------------------------------

export interface Lightning {
  /** 0..1: how bright the sky and world are lit by a strike right now (0 when there is none). */
  flash: number;
  /** World time (ms) of the latest strike that has happened, or -Infinity. */
  lastStrikeMs: number;
  /** World time (ms) at which the next thunder that has not yet been heard arrives, or NaN. Thunder trails its flash by 1.4-7.9 s. */
  thunderMs: number;
}

export const createLightning = (): Lightning => ({ flash: 0, lastStrikeMs: -Infinity, thunderMs: NaN });

const THUNDER_MIN = 1400;
const THUNDER_SPAN = 6500;
const wx = createWeather();

/** Where strike `w` (a window index) happens, or NaN if the window has none. */
function strikeTime(seed: number, w: number, stormAtWindow: number): number {
  if (stormAtWindow < 0.5) return NaN;
  const p = 0.35 + 0.4 * stormAtWindow;
  if (hashFloat(seed >>> 0, w, 0x11) >= p) return NaN;
  return w * WEATHER.strikeWindowMs + hashFloat(seed >>> 0, w, 0x12) * WEATHER.strikeWindowMs * 0.82;
}

/** The brightness of one strike `dt` ms after it began: a hard flash, a stuttering re-strike a fraction of a second later, a slow fade. */
function pulse(dt: number, again: number): number {
  if (dt < 0) return 0;
  let f = Math.exp(-dt / 85) * (0.78 + 0.22 * Math.sin(dt * 0.045));
  const d2 = dt - again;
  if (d2 > 0) f = Math.max(f, 0.72 * Math.exp(-d2 / 130));
  return f < 0.004 ? 0 : f;
}

/**
 * Lightning at a moment: the flash brightness, when the last strike was and when its thunder will (or would) arrive. Strikes are rolled in
 * windows of a few seconds while a storm is on. Pure in (seed, timeMs); allocation-free with `out`. `forceStorm` (0..1) replaces the
 * schedule's storm strength (review scenes with `?weather=storm`).
 */
export function lightningAt(seed: number, timeMs: number, out: Lightning = createLightning(), forceStorm = -1): Lightning {
  const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  out.flash = 0;
  out.lastStrikeMs = -Infinity;
  out.thunderMs = NaN;
  const w = Math.floor(t / WEATHER.strikeWindowMs);
  for (let k = w - 2; k <= w; k++) {
    if (k < 0) continue;
    const mid = (k + 0.5) * WEATHER.strikeWindowMs;
    const s = forceStorm >= 0 ? forceStorm : weatherAt(seed, mid, wx).storm;
    const ts = strikeTime(seed, k, s);
    if (!(ts <= t)) continue;
    const again = 150 + 170 * hashFloat(seed >>> 0, k, 0x13);
    out.flash = Math.max(out.flash, pulse(t - ts, again));
    if (ts > out.lastStrikeMs) out.lastStrikeMs = ts;
    const td = ts + THUNDER_MIN + THUNDER_SPAN * hashFloat(seed >>> 0, k, 0x14);
    if (td >= t && !(td >= out.thunderMs)) out.thunderMs = td;
  }
  out.flash = Math.min(1, out.flash);
  return out;
}

// ---- bending the day toward the weather ------------------------------------------------------------------------------------------------

const cache = new Map<number, readonly [number, number, number]>();
function rgb(hex: number): readonly [number, number, number] {
  let c = cache.get(hex);
  if (!c) {
    c = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    cache.set(hex, c);
  }
  return c;
}

/** `c` <- c + (hex * k - c) * t. */
function toward(c: Rgb, hex: number, t: number, k = 1): void {
  if (t <= 0) return;
  const h = rgb(hex);
  c.r += (h[0] * k - c.r) * t;
  c.g += (h[1] * k - c.g) * t;
  c.b += (h[2] * k - c.b) * t;
}

/** A colour between two palette hexes (a -> b by t), for the sky colours that lean on both the overcast and the storm greys. */
function towardMix(c: Rgb, a: number, b: number, mix: number, t: number, k: number): void {
  if (t <= 0) return;
  const ca = rgb(a);
  const cb = rgb(b);
  c.r += ((ca[0] + (cb[0] - ca[0]) * mix) * k - c.r) * t;
  c.g += ((ca[1] + (cb[1] - ca[1]) * mix) * k - c.g) * t;
  c.b += ((ca[2] + (cb[2] - ca[2]) * mix) * k - c.b) * t;
}

const W = PALETTE.world;

/**
 * Bends a lit `DayState` (from `dayState`) toward the weather, in place: the sky greys and the sun weakens under cloud, fog banks and dust
 * haze thicken the colour of distance (which fog, the far hills and the skirt all share), a storm darkens everything, and a lightning
 * `flash` (0..1, from `lightningAt`) lights the sky and the world bluish-white for an instant. Allocation-free.
 */
export function applyWeather(d: DayState, w: Weather, flash = 0): DayState {
  const o = clamp(Math.max(w.overcast, w.rain * 0.95, w.storm), 0, 1);
  const st = w.storm;
  const ex = d.exposure;
  const dim = 1 - 0.3 * st - 0.08 * o;
  // greys with a cool cast: the storm ones are darker; night exposure keeps them dark
  towardMix(d.top, W.overcastTop, W.stormTop, st, o * 0.94, ex * dim);
  towardMix(d.mid, W.overcastMid, W.stormMid, st, o * 0.9, ex * dim);
  towardMix(d.horizon, W.overcastHorizon, W.stormHorizon, st, o * 0.82, ex * dim);
  toward(d.glow, W.overcastHorizon, o * 0.85, ex * dim);
  // fog banks: the colour of distance goes pale and milky; dust turns it ochre
  toward(d.horizon, W.mist, w.fog * 0.72, Math.max(ex, 0.16) * dim);
  toward(d.mid, W.mist, w.fog * 0.28, ex * dim);
  toward(d.horizon, W.dustHaze, w.dust * 0.78, Math.max(ex, 0.16) * (1 - 0.18 * o));
  toward(d.mid, W.dustHaze, w.dust * 0.4, ex);
  toward(d.top, W.dustHaze, w.dust * 0.14, ex);
  // light: cloud takes most of the sun and leaves a softer sky
  toward(d.sun, W.overcastHorizon, o * 0.55);
  toward(d.sun, W.dustHaze, w.dust * 0.4);
  d.sunIntensity *= 1 - 0.74 * o - 0.12 * w.fog - 0.2 * w.dust;
  toward(d.hemiSky, W.overcastMid, o * 0.5, ex);
  d.hemiIntensity *= 1 + 0.16 * o - 0.14 * st;
  d.ambient *= 1 - 0.32 * o;
  d.fogDensity += w.fog * 0.016 + o * 0.0014 + w.rain * 0.0032 + w.dust * 0.005;
  d.stars *= 1 - 0.96 * o;
  d.moon *= 1 - 0.75 * o;
  d.dusk *= 1 - 0.7 * o;
  d.cover = clamp(0.06 + 0.94 * o, 0, 1);
  d.rain = w.rain;
  d.flash = flash;
  if (flash > 0) {
    // the world lit from every side for a heartbeat: sky, hemisphere and sun go bluish-white
    toward(d.top, W.flash, Math.min(1, flash * 0.85));
    toward(d.mid, W.flash, Math.min(1, flash * 0.8));
    toward(d.horizon, W.flash, Math.min(1, flash * 0.55));
    toward(d.hemiSky, W.flash, Math.min(1, flash * 0.9));
    toward(d.sun, W.flash, Math.min(1, flash * 0.9));
    d.hemiIntensity += 2.4 * flash;
    d.sunIntensity += 1.7 * flash;
  }
  return d;
}

/**
 * The weather a contract's complication MEANS (D-046). A contract dealt "rain" or "fog" already plays by it (its own rules and the runner's sight factors), and its brief says so;
 * the sky has to agree, or a player is told the guards cannot see in the rain under a clear sun. Presentation only: the world's weather (`weatherAt`) stays what the server reads.
 */
export function complicationWeather(c: string | undefined): WeatherKind | undefined {
  return c === "rain" ? "drizzle" : c === "fog" ? "fog" : undefined;
}

/** Raises `out` to at least the settled state of `kind` (each field the stronger of the two; the ground as wet as that rain leaves it); the stronger state names it. */
export function weatherFloor(kind: WeatherKind, out: Weather): Weather {
  const p = TABLE[kind];
  const before = out.rain + out.fog + out.storm + out.dust;
  out.rain = Math.max(out.rain, p.rain);
  out.overcast = Math.max(out.overcast, p.overcast);
  out.fog = Math.max(out.fog, p.fog);
  out.wind = Math.max(out.wind, p.wind);
  out.dust = Math.max(out.dust, p.dust);
  out.storm = Math.max(out.storm, p.storm);
  out.wet = Math.max(out.wet, p.rain);
  if (p.rain + p.fog + p.storm + p.dust > before) out.kind = kind;
  return out;
}
