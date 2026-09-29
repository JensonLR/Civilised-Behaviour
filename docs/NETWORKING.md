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

## Wounds and hit events (D-019)
`PlayerState.wounds` (uint16): 2 bits of severity per body zone (head, torso, arms, legs; `@cb/shared` `wounds.ts`). Server-owned and delta-encoded, so a
wound costs two bytes once, not per tick. `Casualties.damage(id, amount, {zone?, dirX?, dirZ?})` picks a seeded-random zone when unaimed, adds severity
by damage tier, and broadcasts one small `hit` message `{id, zone, dx, dz, power, down}` (about 40 bytes). The message is cosmetic: it drives flinch,
spray and the ragdoll impulse, and losing it changes no authoritative state. Revive/rout patch wounds down to severity 2 (a dressing), never to zero.
Wounds and lost limbs change movement and carrying through the shared injury rules (next section); ragdolls are client-side and cosmetic
(see ARCHITECTURE/D-019), the server keeps a plain capsule.

## Injury modifiers (predicted input of the shared step)
`packages/shared/src/injury.ts` holds the ONE mapping `injuryMods(wounds, missing, prosthetic, out) -> {speedMul, sprintOk, jumpOk, carryMaxMass, throwMul}`
(fills a passed-in struct, allocation-free, table-tested). `stepCharacter` calls it once per step with `s.wounds`, `s.missing` and `FLAG.PEG_LEG`; the server
also uses it for pickup/throw. `wounds` and `missing` are on `CharState` and in `PREDICTED_FIELDS`: the step only READS them, but the reconciler mirrors them
with the position they produced, so a replay after a correction steps with the injuries the server had at that ack. `FLAG.PEG_LEG` (512) is raised by the
server (`refreshProsthetic`) when the look-history `woodenLeg` (0 none, 1 left, 2 right) sits where a leg is missing; it is an ordinary predicted flag.
| Injury | Effect |
|--------|--------|
| leg gash (2) | speed x0.9 |
| leg grievous (3) | speed x0.6, no sprint, no jump |
| leg lost | speed x0.45, no sprint, no jump (the stump's own wound is ignored) |
| leg lost + wooden leg | speed x0.7, no sprint, jump allowed; never as good as a leg |
| two legs | factors multiply (two lost = x0.2, about the crawl speed) |
| head or torso grievous | no sprint (dizzy / winded); nothing else |
| arms: two sound (present, at most a gash) | carry anything |
| arms: one sound | light props only (`lightPropMass` 8 kg: bottle, chair; not crate 12, barrel 20) |
| arms: none sound but one present | light props only |
| arms: both lost | cannot carry or throw |
| throw speed and lift | x mean of both arms (lost 0, grievous 0.4, gash 0.85, else 1) |
A downed body ignores all of it (crawl speed). Revive/rout patch wounds but never regrow a limb; `restoreLimbs` stays debug-only.
**Server enforcement:** the step ignores SPRINT/JUMP the body cannot use (a crafted frame gains nothing); a pickup is refused at the gate with a rate-limited
`notice` to that client only ("Your arm is in no state to carry that."); every tick a carrier is re-checked and drops what they can no longer lift (arm lost or
gashed to grievous mid-carry); throws scale by `throwMul`. The client prompt uses the same functions, so it never promises what the server will refuse.
**Why no snap:** `wounds`/`missing`/flags are adopted from the same snapshot as the position and ack, so inputs after the ack replay with the injuries the server
applies to them; only inputs the server processed before the wound landed used the old values, and those are exactly the ones the snapshot already covers.
Measured (`apps/server/src/bots/injuryNet.test.ts`, bot sprinting on an arc, injury lands at ~2.6 s; mean / worst single POSITION correction):
| Scenario | RTT 0 | RTT 120 ms |
|----------|-------|------------|
| no injury | 0 / 0 | 0 / 0 |
| grievous leg | 0.0 / 0.0 mm | 0.01 / 0.3 mm |
| leg torn off | 0.0 / 0.0 mm | 0.07 / 2.4 mm |
| leg torn off, wooden leg fitted | 0.0 / 0.0 mm | 0.04 / 1.5 mm |
| three hits within a second (leg, leg, head) | 0.19 / 7.9 mm | 1.0 / 45 mm |
Mutation: with `wounds`/`missing` removed from `PREDICTED_FIELDS` the same runs give mean 70-217 mm and worst 0.25-0.49 m (rubber-banding on every injury), and
the tests fail. Caveat: `driftEma` now also counts the numeric jump of the wounds/missing/flags fields themselves (unit-less, like the DRAGGED flag flip in D-017), so the
bot metrics to trust here are the positional `correction*` ones. Limits: localhost, fixed-delay latency, one player.

## Field dressing (treatment, not healing)
A standing player can be dressed by a comrade: same INTERACT hold as a revive (no new input bit), `CASUALTY.dressSeconds` (2 s, server ticks), in `reviveRange`, both
standing. It lowers the worst dressable wound ONE level (ties: legs, arms, torso, head) and the action ends; press again for the next. Floors make total healing finite:
a wound never drops below severity 1 (a scratch stays) and a stump never below 2. It does not restore health and cannot be done to yourself. Priority on an INTERACT press:
revive a downed comrade > lift a prop in reach (if the body can lift it) > dress a wounded comrade. A player who cannot lift the prop beside them dresses instead.
The patient sees the progress through the existing `reviver` / `reviveProgress` fields; the HUD labels it "Dressing" when the patient is not downed.

## Props and interaction
Physics props live in a server-only Rapier world (`apps/server/src/physics.ts`, layers from `LAYER`). Only awake/held props are written to
`state.props` (pose changes < 2 mm are skipped); clients interpolate with `Predict.attachAll("props")`. Pick up / drop / throw arrive as
INTERACT / THROW bits in the normal input stream; the server acts on **rising edges** per frame after stepping the player, validates reach and
ownership with the shared `findInteractTarget`, and never trusts client-reported positions. Leaving drops the load. A held prop is kinematic
in front of the holder and ignores player capsules. Client keyboard taps are latched between 30 Hz samples so a quick tap is never lost.

## QA debug commands
`DEBUG_COMMANDS` (default on outside production; config validation rejects it in production) registers a `debug` message on rooms. Currently
`peg:<0|1|2>` fits a wooden leg (look history is server-owned) and `nearProp` / `nearDowned` teleport the caller next to the nearest free prop / downed teammate; `hurt` (-40 health), `down` (health 0) and `hit:<zone>:<damage>` (aimed, pushed from behind the caller) harm the caller (all used by the browser e2e). Never ship these enabled.

## Dev controls
- `SIMULATED_LATENCY_MS` (server env, RTT ms) - forbidden in production by config validation.
- `/metrics` JSON: rooms, players, tick avg/p99/max, overruns, reconnects, heap/RSS.
- Client overlay (F3): RTT (application ping every 2 s), draw calls, etc. Bandwidth counters: TODO M12 (needs transport hook).

## Dismemberment and `sever` events (D-023)
`PlayerState.missing` (uint8, 4 bits: left arm 1, right arm 2, left leg 4, right leg 8) is server-owned and delta-encoded like `wounds`. `WorldState.dismemberment` is the
campaign rule (creator's `JoinOptions.dismemberment`, ignored when joining; server default from `DISMEMBERMENT`). `Casualties.damage` rolls `severChance(amount, zoneLevel)`
from the seeded room RNG for limb-zone blows, sets the bit, stamps a grievous wound on the zone and broadcasts `sever {id, limb, dx, dz, power}` after the `hit` event. The
event is cosmetic (debris, spray, camera shake); a client that misses it still renders the stump from `missing`. Debug commands: `sever:<bit>`, `restore`.
