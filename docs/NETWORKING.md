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

## Verified prediction quality (2026-09-29)
`apps/server/src/bots/netcode.test.ts` drives a headless `Bot` (same SDK prediction wiring as the browser) against a real server
with `simulateLatency`. Metric: the reconciler's own drift (`drift.ema`, `lastCorrectionMag`) after a 2 s spawn-snap warm-up.
| Scenario | RTT | drift EMA | worst correction |
|----------|-----|-----------|------------------|
| circle walk (flat) | 0 / 100 / 150 ms | 0 | 0 |
| wall bump + slide + sprint (collision) | 0 / 100 / 150 ms | 0 | 0 |
| 6x client hitch (150 ms stall + input burst) | 60 ms | 0 | 0 |
Tests are mutation-checked: a 15% wrong client timestep gives EMA 0.05-0.06 and fails all of them; reverting D-013 fails the hitch test.
**Limits:** fixed-delay latency only (Colyseus `simulateLatency` has no jitter or loss; WebSocket is TCP so loss shows up as stalls),
localhost, one player, no player-vs-player interaction yet. Not a substitute for real-internet playtests.

## Origin policy (`apps/server/src/origins.ts`)
`ALLOWED_ORIGINS` (comma-separated, exact scheme+host+port, required in production, empty = open in dev/test) is enforced on:
matchmaking POSTs (`invokeMethod` wrapper), the WebSocket upgrade (`beforeUpgrade` -> 403), and `/campaign/:code` (403).
CORS headers name only the allowed origin and no longer advertise credentials (Colyseus default reflected any origin with credentials).
Requests without an `Origin` header (curl, native/Electron main-process, bots) pass: this stops cross-site *browser* abuse
(cross-site WebSocket hijacking, blind room creation via non-preflighted `text/plain` POST); it is not authentication.
Tests: `origins.test.ts` (mutation-checked: fail when enforcement is off). `/health` and `/metrics` are still readable by
non-browser clients; `/metrics` exposes counts only.

## Input budget and hitch tolerance (D-017)
The server applies at most ~1.05 input frames per tick per player on average (bucket of 12 for hitches); excess is dropped and counted
(`inputFramesDropped`). A client silent for >12 ticks (400 ms) is stepped with zero input so it lands and stops. Measured: flooding 3 frames/step:
3.0x speed without the budget, ~1.03x with. Legit 150 ms and 350 ms client stalls keep prediction drift at exactly 0.

## Casualties (D-016)
Health 0..100 (server-owned). At 0 the player is DOWNED (crawl only, no props, cannot revive). Revive: hold Interact within 1.8 m for 2.5 s (server-tick timed).
Drag: Grab within 1.7 m; body trails 1.2 m behind, velocity-steered by the server; auto-release beyond 3.2 m, on revive, or if either party goes down/leaves.
Rout: all connected players down for 8 s (`ROUT_SECONDS`) -> everyone up at spawn with 40 health + a `notice` broadcast.
Prediction while dragged (bot-measured, `casualtyNet.test.ts`): mean positional correction 1.2 cm @0 ms, 5.3 cm @120 ms RTT; worst ~1.07 m at pull start.

## Props and interaction
Physics props live in a server-only Rapier world (`apps/server/src/physics.ts`, layers from `LAYER`). Only awake/held props are written to
`state.props` (pose changes < 2 mm are skipped); clients interpolate with `Predict.attachAll("props")`. Pick up / drop / throw arrive as
INTERACT / THROW bits in the normal input stream; the server acts on **rising edges** per frame after stepping the player, validates reach and
ownership with the shared `findInteractTarget`, and never trusts client-reported positions. Leaving drops the load. A held prop is kinematic
in front of the holder and ignores player capsules. Client keyboard taps are latched between 30 Hz samples so a quick tap is never lost.

## QA debug commands
`DEBUG_COMMANDS` (default on outside production; config validation rejects it in production) registers a `debug` message on rooms. Currently
`nearProp` / `nearDowned` teleport the caller next to the nearest free prop / downed teammate; `hurt` (-40 health) and `down` (health 0) harm the caller (all used by the browser e2e). Never ship these enabled.

## Dev controls
- `SIMULATED_LATENCY_MS` (server env, RTT ms) - forbidden in production by config validation.
- `/metrics` JSON: rooms, players, tick avg/p99/max, overruns, reconnects, heap/RSS.
- Client overlay (F3): RTT (application ping every 2 s), draw calls, etc. Bandwidth counters: TODO M12 (needs transport hook).
