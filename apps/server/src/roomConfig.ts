import type { PersistenceRuntime } from "./persistence/runtime.ts";
import type { DemoConfig } from "./systems/Demo.ts";
/**
 * Process-wide settings that rooms need from the validated server config. Rooms are constructed by
 * Colyseus (no constructor injection), so createGameServer() publishes these once at startup.
 */
export interface RoomConfig {
  /** QA/dev commands over the `debug` message. Must be false in production. */
  debugCommands: boolean;
  /** Seconds with the whole party down before the rout. Overridable so tests need not wait 8 s. */
  routSeconds: number;
  /** Server default for the dismemberment campaign rule. */
  dismemberment: boolean;
  /** Server default for the friendly-fire campaign rule (the creator may still switch it off for their campaign). */
  friendlyFire: boolean;
  /** Clock hour the world starts at (default 9). */
  dayStartHour?: number;
  /** Real minutes for a full day (default 30; 0 freezes the clock). */
  dayMinutes?: number;
  /** The campaign store (D-035). Absent = rooms keep their campaign in memory only (unit rigs that build a room without a server). */
  persistence?: PersistenceRuntime;
  /** The bounded web demo (D-036; env `DEMO_MODE`). Absent or disabled = the full game. A demo room saves nothing and refuses `resume`. */
  demo?: DemoConfig;
}

let current: RoomConfig = { debugCommands: false, routSeconds: 8, dismemberment: true, friendlyFire: true, dayStartHour: 9, dayMinutes: 30 };

export const setRoomConfig = (c: RoomConfig): void => {
  current = c;
};
export const getRoomConfig = (): RoomConfig => current;
