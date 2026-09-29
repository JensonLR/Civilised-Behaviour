/**
 * Process-wide settings that rooms need from the validated server config. Rooms are constructed by
 * Colyseus (no constructor injection), so createGameServer() publishes these once at startup.
 */
export interface RoomConfig {
  /** QA/dev commands over the `debug` message. Must be false in production. */
  debugCommands: boolean;
  /** Seconds with the whole party down before the rout. Overridable so tests need not wait 8 s. */
  routSeconds: number;
}

let current: RoomConfig = { debugCommands: false, routSeconds: 8 };

export const setRoomConfig = (c: RoomConfig): void => {
  current = c;
};
export const getRoomConfig = (): RoomConfig => current;
