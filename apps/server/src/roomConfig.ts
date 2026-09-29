/**
 * Process-wide settings that rooms need from the validated server config. Rooms are constructed by
 * Colyseus (no constructor injection), so createGameServer() publishes these once at startup.
 */
export interface RoomConfig {
  /** QA/dev commands over the `debug` message. Must be false in production. */
  debugCommands: boolean;
}

let current: RoomConfig = { debugCommands: false };

export const setRoomConfig = (c: RoomConfig): void => {
  current = c;
};
export const getRoomConfig = (): RoomConfig => current;
