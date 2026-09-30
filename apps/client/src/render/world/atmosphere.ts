import { Color, Vector3 } from "three";
import type { WeatherKind } from "@cb/shared";

/**
 * The state of the air, in one tiny module. `Stage` writes it every frame from the world clock and the weather schedule; other systems
 * (the audio engine for rain, wind and thunder; the shaders for wet ground and sway) only read it.
 *
 *   getAtmosphere(): { rain, wind, thunderAt, hour, ... }   the live object: read it, never keep it, never write it
 *
 * `rain` 0..1 (drizzle ~0.5, storm 1), `wind` 0..1, `hour` the clock hour 0..24. `thunderAt` is the moment the next thunderclap arrives,
 * in seconds on the `performance.now() / 1000` time base (the flash has already happened; the sound follows it by 1.4-7.9 s), or null.
 * The extra fields (`wet`, `fog`, `overcast`, `storm`, `dust`, `flash`, `kind`) may grow; the four above are stable.
 */
export interface Atmosphere {
  rain: number;
  wind: number;
  thunderAt: number | null;
  hour: number;
  wet: number;
  fog: number;
  overcast: number;
  storm: number;
  dust: number;
  flash: number;
  kind: WeatherKind;
}

const state: Atmosphere = { rain: 0, wind: 0.2, thunderAt: null, hour: 13, wet: 0, fog: 0, overcast: 0, storm: 0, dust: 0, flash: 0, kind: "clear" };

/** The live atmosphere (one shared object: cheap to read every frame). */
export function getAtmosphere(): Readonly<Atmosphere> {
  return state;
}

/** For `Stage` (and tests): replaces the fields in place. */
export function setAtmosphere(next: Partial<Atmosphere>): void {
  Object.assign(state, next);
}

// ---- motion preference --------------------------------------------------------------------------------------------------------------

/**
 * How much ambient motion (wind sway, cloth, butterflies, birds, drifting motes) the player wants, 0..1. `?motion=0` switches it off,
 * `?motion=1` forces full motion, `?motion=0.5` anything between; otherwise `prefers-reduced-motion: reduce` gives a gentle 0.3 and
 * everyone else gets 1. Wind still MOVES the trees at 0.3: amplitude is what shrinks, not the wind itself.
 */
export function motionScale(params?: URLSearchParams, reduced?: boolean): number {
  const q = params?.get("motion");
  if (q !== null && q !== undefined && q !== "") {
    const n = Number(q);
    if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  }
  let pref = reduced;
  if (pref === undefined) {
    try {
      pref = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      pref = false;
    }
  }
  return pref ? 0.3 : 1;
}

// ---- GPU side -------------------------------------------------------------------------------------------------------------------------

/**
 * The uniforms every world shader shares (assigned by reference, never through `UniformsUtils.merge`, which would clone the values and
 * freeze them): wind strength times the motion preference, ground wetness, the sky colour puddles mirror, and where the light is.
 */
export const atmoUniforms = {
  /** Multiplies every sway amplitude: 1 is a light breeze, ~2.4 a gale, and the motion preference scales it down. */
  uWindK: { value: 1 },
  /** 0..1 how wet the ground is: darkens surfaces and grows puddles. */
  uWet: { value: 0 },
  /** The sky a puddle reflects (already dimmed by the weather) and the light that glints off it. */
  uSheen: { value: new Color(0.6, 0.7, 0.8) },
  uSunDirW: { value: new Vector3(0, 1, 0) },
  uSunColW: { value: new Color(1, 1, 1) },
  /** 0..1 rain falling right now (rain streak opacity, ripples in the puddles). */
  uRain: { value: 0 },
};

/** Wind strength (0..1) and the motion preference (0..1) -> the sway multiplier (0 = perfectly still). */
export const windGain = (wind: number, motion: number): number => (0.55 + 1.9 * Math.min(1, Math.max(0, wind))) * Math.min(1, Math.max(0, motion));

/** The motion preference in force (set once at start by `Stage`; ambient life reads it to scale flaps, orbits and drift). */
export const motion = { value: 1 };
