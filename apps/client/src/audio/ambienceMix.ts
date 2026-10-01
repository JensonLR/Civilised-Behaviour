import { CAMP, RIVER, riverCentre, waterField, type RegionId, type WaterField } from "@cb/shared";
import type { Atmosphere } from "./atmosphereSource.ts";
import { REGION_AMBIENCE } from "./ambienceRegion.ts";
import { newSpatial, spatialise, type Listener, type SpatialOut } from "./spatial.ts";

/**
 * What the soundscape should be doing right now, as plain numbers: a pure function of where the listener stands, the weather and the hour, so
 * it is testable without any audio. `ambience.ts` turns these targets into gains and pans on the beds.
 */
export interface AmbienceTargets {
  wind: number;
  whistle: number;
  rain: number;
  /** 0..1 how loud crickets are (dusk and night, not in rain). */
  crickets: number;
  /** 0..1 how likely and how loud birdsong is (day, not in rain). */
  birds: number;
  fire: { gain: number; pan: number; cutoff: number };
  stream: { gain: number; pan: number };
  falls: { gain: number; pan: number };
}

export const newTargets = (): AmbienceTargets => ({
  wind: 0,
  whistle: 0,
  rain: 0,
  crickets: 0,
  birds: 0,
  fire: { gain: 0, pan: 0, cutoff: 20000 },
  stream: { gain: 0, pan: 0 },
  falls: { gain: 0, pan: 0 },
});

const sp: SpatialOut = newSpatial();
const wf: WaterField = { q: 0, s: 0, pond: false };
const nearest = { x: 0, z: 0 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Daylight 0..1 from the hour: dawn from 5 to 7, dusk from 18 to 20.5 (the day cycle's own dusk/night keyframes are close to this). */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return smooth(5, 7.2, h) * (1 - smooth(17.8, 20.5, h));
}

/**
 * `region` matters twice: the fire, the stream and the waterfall are Hollowmere's own landmarks (their positions are in its coordinates), so in every other region they stay silent
 * instead of sounding from empty ground; and each region leans the wind a little (the plain breezes, the gorge breathes).
 */
export function ambienceTargets(l: Listener, a: Atmosphere, out: AmbienceTargets = newTargets(), region: RegionId = "hollowmere"): AmbienceTargets {
  const day = daylight(a.hour);
  const dry = 1 - clamp01(a.rain * 1.4);
  out.wind = Math.min(1, 0.06 + 0.5 * clamp01(a.wind) + REGION_AMBIENCE[region].wind);
  out.whistle = clamp01(a.wind) ** 3 * 0.9;
  out.rain = clamp01(a.rain);
  // Crickets: the warm dusk and the night, silenced by rain.
  out.crickets = (1 - day) * dry;
  out.birds = day * dry;

  if (region !== "hollowmere") {
    out.fire.gain = 0;
    out.fire.pan = 0;
    out.fire.cutoff = 20000;
    out.stream.gain = 0;
    out.stream.pan = 0;
    out.falls.gain = 0;
    out.falls.pan = 0;
    return out;
  }
  const f = CAMP.fire;
  spatialise(l, f.x, l.y, f.z, 3, 42, sp);
  out.fire.gain = sp.gain * 0.9;
  out.fire.pan = sp.pan;
  out.fire.cutoff = Math.max(1200, sp.cutoff);

  // The stream babbles from its nearest reach; the waterfall roars from the broken aqueduct.
  waterField(l.x, l.z, wf);
  riverCentre(wf.s, nearest);
  spatialise(l, nearest.x, l.y, nearest.z, 2.5, 60, sp);
  const inChannel = wf.q < 1 ? 1 : 0;
  out.stream.gain = Math.min(1, sp.gain * (1 + inChannel * 0.4)) * 0.85;
  out.stream.pan = sp.pan;
  spatialise(l, RIVER.a.x, l.y, RIVER.a.z, 5, 90, sp);
  out.falls.gain = sp.gain;
  out.falls.pan = sp.pan;
  return out;
}
