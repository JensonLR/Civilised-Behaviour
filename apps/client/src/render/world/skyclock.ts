import { CLOCK, advanceClock, createLightning, createWeather, lightningAt, sanitizeDayMinutes, weatherAt, weatherPreset, worldHours, type Lightning, type Weather, type WeatherKind } from "@cb/shared";

/**
 * Which hour it is and what the weather is doing, resolved from the many places that can say. Precedence for the HOUR:
 *   1. `?time=` in the URL (review stills), fixed, unless `&drift=1`
 *   2. a pinned hour (`pin`): the menu and the creator preview sit at a calm fixed hour
 *   3. the room's clock: the server's world age + start hour + day length, extrapolated with this machine's monotonic clock
 *   4. a local drift from `CLOCK.defaultStart` (showcases with no room)
 * The WEATHER is `?weather=` when forced (review), otherwise a pure function of the room's seed and the world's age (and clear before there
 * is a room). No allocation per tick; pure logic, so it is tested in Node.
 */
export interface SkyClockOptions {
  /** `?time=` (already parsed). */
  urlHours?: number;
  /** `&drift=1`: keep running from `urlHours`. */
  drift?: boolean;
  /** `?weather=` (already parsed): forced at full strength. */
  forcedWeather?: WeatherKind;
  /** `?wms=`: where the local world clock starts (ms). */
  startWorldMs?: number;
  /** Seed for the local weather schedule. */
  localSeed?: number;
}

const FROZEN = 0;
const dayMinutesOf = (m: number): number => (m === FROZEN ? FROZEN : sanitizeDayMinutes(m));

export class SkyClock {
  hours: number;
  /** Milliseconds the world has been alive: the room's clock, or a local one. */
  worldMs: number;
  seed: number;
  readonly weather: Weather = createWeather();
  readonly lightning: Lightning = createLightning();
  /** Storm strength to force for lightning in review scenes (-1 = follow the schedule). */
  private forceStorm = -1;
  private drift: boolean;
  private readonly urlHours: number | undefined;
  private pinned: number | undefined;
  private room?: { seed: number; worldMs: number; at: number; startHour: number; dayMinutes: number };
  private readonly forced: WeatherKind | undefined;
  private localMs: number;

  constructor(o: SkyClockOptions = {}) {
    this.urlHours = o.urlHours !== undefined && !o.drift ? o.urlHours : undefined;
    this.hours = o.urlHours ?? CLOCK.defaultStart;
    this.drift = o.urlHours === undefined || o.drift === true;
    this.forced = o.forcedWeather;
    this.localMs = o.startWorldMs ?? 0;
    this.worldMs = this.localMs;
    this.seed = o.localSeed ?? 7;
  }

  get inRoom(): boolean {
    return this.room !== undefined;
  }

  /** Pins the hour (menu, creator) and stops it drifting unless `keepDrifting`. A room's clock takes over from a pin. */
  pin(hours: number, keepDrifting = false): void {
    this.hours = ((hours % 24) + 24) % 24;
    this.drift = keepDrifting;
    this.pinned = keepDrifting ? undefined : this.hours;
  }

  /** Feeds the server's world clock. Cheap; call every frame. `nowMs` is a monotonic clock (`performance.now()`). */
  sync(seed: number, worldMs: number, startHour: number, dayMinutes: number, nowMs: number): void {
    const r = this.room;
    if (!r) {
      this.room = { seed, worldMs, at: nowMs, startHour, dayMinutes: dayMinutesOf(dayMinutes) };
      this.pinned = undefined;
      this.drift = false;
      return;
    }
    if (worldMs !== r.worldMs) {
      r.worldMs = worldMs;
      r.at = nowMs; // a refresh: the age is exact again
    }
    r.seed = seed;
    r.startHour = startHour;
    r.dayMinutes = dayMinutesOf(dayMinutes);
  }

  /** Back to a local sky (left the room). */
  leave(): void {
    this.room = undefined;
  }

  /** Resolves the hour, the weather and the lightning for this frame. `dt` is seconds since the last frame (0 on the first). */
  update(nowMs: number, dt: number): void {
    const r = this.room;
    if (r) {
      this.worldMs = r.worldMs + (nowMs - r.at);
      this.seed = r.seed;
    } else {
      this.localMs += dt * 1000;
      this.worldMs = this.localMs;
    }
    if (this.urlHours !== undefined) this.hours = this.urlHours;
    else if (this.pinned !== undefined) this.hours = this.pinned;
    else if (r) this.hours = worldHours(r.startHour, this.worldMs, r.dayMinutes);
    else if (this.drift && dt > 0) this.hours = advanceClock(this.hours, dt);
    if (this.forced) {
      weatherPreset(this.forced, this.weather);
      this.forceStorm = this.weather.storm;
    } else {
      weatherAt(this.seed, this.worldMs, this.weather);
      this.forceStorm = -1;
    }
    if (this.weather.storm > 0.5 || this.forceStorm >= 0) {
      // a forced storm has no schedule to strike by: sit its lightning well into the world's life so review stills catch strikes
      lightningAt(this.seed, this.forced ? this.worldMs + 40_000 : this.worldMs, this.lightning, this.forceStorm);
    } else {
      this.lightning.flash = 0;
      this.lightning.thunderMs = Number.NaN;
      this.lightning.lastStrikeMs = -Infinity;
    }
  }

  /** The world time lightning is evaluated at (a forced storm is shifted), so thunder can be converted back to a real moment. */
  get lightningMs(): number {
    return this.forced ? this.worldMs + 40_000 : this.worldMs;
  }
}
