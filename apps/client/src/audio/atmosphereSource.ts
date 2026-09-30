import { getAtmosphere } from "../render/world/atmosphere.ts";

/**
 * Weather and clock for the soundscape, read from the environment's `getAtmosphere()` (render/world/atmosphere.ts): `rain` and `wind` 0..1,
 * `hour` 0..24, and `thunderAt`, the moment the next thunderclap ARRIVES (seconds on the `performance.now() / 1000` clock; the flash has
 * already happened), or null. Only the four fields below are relied on; the module says they are stable.
 */
export interface Atmosphere {
  rain: number;
  wind: number;
  thunderAt: number | null;
  hour: number;
}

const calm: Atmosphere = { rain: 0, wind: 0.2, thunderAt: null, hour: 13 };

/** Current weather; a calm afternoon if the live values are not finite numbers. Allocation-free. */
export function readAtmosphere(): Atmosphere {
  const a = getAtmosphere();
  return Number.isFinite(a.rain) && Number.isFinite(a.wind) && Number.isFinite(a.hour) ? a : calm;
}
