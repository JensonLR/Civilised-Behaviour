# Networking

Status: movement + join/reconnect implemented and tested. Combat lag-comp, bandwidth measurements and bad-network runs are M3/M12.

## Model
Server-authoritative, Colyseus 0.18 over WebSocket (TCP, ordered - so `mode: "reliable"` inputs, no redundancy ring).
- Sim: 30 Hz fixed timestep (`TICK_RATE`). Patches: 50 ms (`PATCH_RATE_MS`). Both are starting points to profile in M12.
- Client: `Predict.reconciler` applies inputs immediately, keeps unacked inputs, and on each authoritative state rewinds and replays
  through the shared `stepCharacter`; errors are absorbed by a decaying visual offset (`smoothMs: 65`).
- Remote players: `Predict.attachAll("players", ...)` with `lerp` and a 100 ms interpolation delay.
- Lag compensation for hitscan will use Colyseus `allowRewindState` (renderTime stamps) - not yet enabled.

## Wire input (MoveInput)
`moveF:int8, moveR:int8, yaw:uint16, buttons:uint16` - delta-encoded by the framework, so idle frames are body-less.

## Session lifecycle
1. `client.create("world", {name})` -> server picks a seed and 5-char code, room is private.
2. Friends resolve the code via `GET /campaign/:code` (rate limited) then `joinById`.
3. Drop (any close code except 4000): player kept in state with `connected=false` for 45 s; the SDK auto-reconnects and the
   server restores the same session id/slot. After 45 s the slot is freed. `4000` = deliberate leave (immediate removal).
4. Max 4 players. Fifth join is rejected.

## Hostile-client handling
Input sanitised in `defineInput`; `maxMessagesPerSecond = 120` (client is disconnected above it); names sanitised; codes validated
before any lookup. Tested in `apps/server/src/rooms/WorldRoom.test.ts`.

## Dev controls
- `SIMULATED_LATENCY_MS` (server env, RTT ms) - forbidden in production by config validation.
- `/metrics` JSON: rooms, players, tick avg/p99/max, overruns, reconnects, heap/RSS.
- Client overlay (F3): RTT (application ping every 2 s), draw calls, etc. Bandwidth counters: TODO M12 (needs transport hook).
