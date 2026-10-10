# Networking

Status: movement + join/reconnect implemented and tested; combat (M3) with bounded lag compensation implemented and tested against headless bots (see "Combat" below). Bandwidth measurements and bad-network runs are M12.

## Model
Server-authoritative, Colyseus 0.18 over WebSocket (TCP, ordered - so `mode: "reliable"` inputs, no redundancy ring).
- Sim: 30 Hz fixed timestep (`TICK_RATE`). Patches: 50 ms (`PATCH_RATE_MS`). Both are starting points to profile in M12.
- Client: `Predict.reconciler` applies inputs immediately, keeps unacked inputs, and on each authoritative state rewinds and replays
  through the shared `stepCharacter`; errors are absorbed by a decaying visual offset (`smoothMs: 65`).
- Remote players: `Predict.attachAll("players", ...)` with `lerp` and a 100 ms interpolation delay.
- Lag compensation for shots uses Colyseus `allowRewindState` (renderTime stamps): enabled for `facing` and `flags` (held) and positions (interpolated), clamped to 400 ms (`COMBAT.rewindMaxMs`: a 250 ms round trip + the 100 ms `INTERP_DELAY_MS` + a 50 ms patch of slack, D-043). See "Combat".

## Wire input (MoveInput)
`moveF:int8, moveR:int8, yaw:uint16, buttons:uint16` - delta-encoded by the framework, so idle frames are body-less. Combat appended three fields (append-only, the movement step never reads them): `aimYaw:uint16`, `aimElev:int16` (1/20000 rad), `weapon:uint8` (0 = nothing, else id+1). `BUTTON` gained `AIM` (1<<4, a movement-step input: it sets `FLAG.AIMING` and turns the body toward the camera), `FIRE`, `RELOAD`, `MELEE` (1<<5..7) on top of the existing bits; all of these except AIM are acted on by the server on rising edges.

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

## Rate limits and the client's address (D-048, `clientIp.ts`, `app.ts`)
Because a client without an `Origin` passes the origin policy, room creation is limited separately: `create`/`joinOrCreate` (a new campaign or a resume) get
`ROOM_CREATE_BURST` per address then one per `ROOM_CREATE_EVERY_S` (production default 6, then one per 20 s; 429), and past `MAX_ROOMS` live rooms
every create is refused (production default 40; 503). The join-code lookup keeps its 10-then-1-per-6-s limit. The address is the right-most
`X-Forwarded-For` entry `TRUST_PROXY_HOPS` from the end (production default 1, the platform's own proxy), or a header the trusted edge overwrites
(`CLIENT_IP_HEADER`), never the first entry: that one is whatever the client wrote (measured on the live server before the fix: thirteen forged lookups,
none limited). Addresses are used as bucket keys only: never stored or logged. Tests: `clientIp.test.ts`, `matchmakeLimits.test.ts` (both fail on the old key).
ON RENDER (measured after the D-048 deploy, D-050): one hop is WRONG. Render's edge is Cloudflare, `X-Forwarded-For` arrives as `<client>, <Cloudflare edge>`, and the right-most entry is an edge address that changes per request: fourteen lookups from one stable address (checked against an IP echo) never met the limit, forged entries or none. Production sets `CLIENT_IP_HEADER=true-client-ip` (in `render.yaml` and on the service), the header Render's edge sets; `TRUST_PROXY_HOPS=1` stays as the fallback. Re-measured live after that change: fourteen lookups each forging a different `True-Client-IP` and `X-Forwarded-For` got ten answers, then 429: the edge overwrites the header.

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
server (`refreshProsthetic`) when the look-history `woodenLeg` (0 none, 1 left, 2 right) sits where a leg is missing; it is an ordinary predicted flag. (D-118: `missing` has a
fifth bit, `HEAD`, set only on an enemy's row; the injury table reads the four limb bits and ignores it.)
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
`outcome:<resolution>` commits a synthetic ending of the matching contract through the real commit pipeline and `outpost:<stage>` founds the Society's outpost at Kessar at that stage at once (D-035; QA and e2e, so a campaign with a history needs no walking), `peg:<0|1|2>` fits a wooden leg (look history is server-owned) and `nearProp` / `nearDowned` teleport the caller next to the nearest free prop / downed teammate; `hurt` (-40 health), `down` (health 0) and `hit:<zone>:<damage>` (aimed, pushed from behind the caller) harm the caller (all used by the browser e2e). Never ship these enabled.

## Dev controls
- `SIMULATED_LATENCY_MS` (server env, RTT ms) - forbidden in production by config validation.
- `/metrics` JSON: rooms, players, tick avg/p99/max, overruns, reconnects, heap/RSS.
- Client overlay (F3): RTT (application ping every 2 s), draw calls, etc. Bandwidth counters: TODO M12 (needs transport hook).

## Dismemberment and `sever` events (D-023)
`PlayerState.missing` (uint8, 4 bits: left arm 1, right arm 2, left leg 4, right leg 8) is server-owned and delta-encoded like `wounds`. `WorldState.dismemberment` is the
campaign rule (creator's `JoinOptions.dismemberment`, ignored when joining; server default from `DISMEMBERMENT`). `Casualties.damage` rolls `severChance(amount, zoneLevel)`
from the seeded room RNG for limb-zone blows, sets the bit, stamps a grievous wound on the zone and broadcasts `sever {id, limb, dx, dz, power}` after the `hit` event. The
event is cosmetic (debris, spray, camera shake); a client that misses it still renders the stump from `missing`. Debug commands: `sever:<bit>`, `restore`.

## Combat (M3; design and numbers in `docs/_notes/combat.md`)
**Authority.** `apps/server/src/systems/Combat.ts` is the only writer of ammo, reload, weapon in hand, projectiles, hits, knock and explosions. Damage reaches players only through `Casualties.damage` (zone + direction + the weapon's `severBias`), so downing, revive and dismemberment behave exactly as before.
**Replicated state (append-only).** `PlayerState`: `weapon` (0 none, else id+1), `weapons` (owned bit mask), `ammo`, `reserve`, `reload` (0..100), `shots` (uint8, wraps: seeds the shot pattern and keys remote recoil/swing), `aim` (int8, 1/80 rad elevation, cosmetic pose for remote figures). `FLAG` gained `AIMING` (1024, derived by the shared step from the AIM button, mirrored by the reconciler) and `OPERATING` (2048, server-set while working the cannon, like `REVIVING`). `WorldState`: `friendlyFire` (campaign rule; creator's `JoinOptions.friendlyFire`, server default `FRIENDLY_FIRE`, a server-side off wins) and `cannons` (map of `CannonState`: x y z, barrel yaw/elev, phase 0-3, progress, crew, shells, `fired`).
**Events (cosmetic; state is authoritative).** `shot {id, w, x y z, dx dy dz, seed, spread, m?}` (one per trigger pull however many pellets; the pattern comes from `seed` via `shotDirection`), `impact {id, x y z, nx ny nz, s (SURFACE), w}` (capped per shot), `boom {x y z radius}`, `hitmark {zone, down, sever}` (to the shooter only), plus the existing `hit`/`sever`. A client that misses any of them still ends up with the right health, wounds, ammo and limbs.
**Prediction.** The shooter draws his own flash and pellets the frame he presses FIRE, using `shotSeed(worldSeed, slot, (replicated shots + pending) & 255)`; the server's `shot` event confirms (no double flash for the shooter). Recoil is a camera kick and an animator pose, never an input, so the reconciler is untouched: measured worst correction 3.7e-7 m at 0 ms and 3.5e-7 m at 100 ms RTT while firing (`bots/combatNet.test.ts`).
**Aim.** The client sends the direction from the eye to the point under the crosshair (a client-side world/body ray), as `aimYaw/aimElev`. The server clamps `aimYaw` to +-0.6 rad of the camera `yaw` (`COMBAT.aimYawSlack`) and `aimElev` to +-1.45 rad, and fires from the server's own eye height, never from a client position.
**Lag compensation.** `rewind.attachAll(players, {fields: ["facing", "flags"], mode: "snapshot", interpolate: "step", maxRewindMs: COMBAT.rewindMaxMs})` (400 ms); positions are interpolated linearly, `facing`/`flags` held. Hitscan and the first instants of a projectile ask `lastSeenBy(shooter)`; a projectile keeps that view for 0.3 s then fades to live over 0.1 s; melee uses the lag stored at the press. Cannon balls and blasts are live. `Predict.attachAll("players")` is required on the client so that what the shooter sees is what the rewind records. Trade-offs and measured hit rates (14/14 at 0, 100 and 200 ms in each of 20 runs since D-043, 0/14 at 200 ms without compensation) are in `_notes/combat.md`.
**Hostile input.** Refused and counted (`stats.refused`): weapons not owned or not carried, the cannon as a weapon, junk ids, FIRE on an empty gun (starts a reload instead), FIRE inside the cooldown or a reload, any action while DOWNED/CARRYING/DRAGGING/DRAGGED/REVIVING/OPERATING, weapon changes faster than `COMBAT.switchSeconds` (a change also carries the old cooldown forward, so swapping never launders it). Bounded: 128 live projectiles per room, prop impulses <= 14 m/s, a single knock <= 14 m/s, impacts per shot. The existing 120 msg/s cap and the input budget still apply.
**QA debug commands (added).** `give:<weaponId>|all` (grant and fill), `tp:<x>:<z>[:<facing>]`, `nearCannon` (teleport beside the cannon). `powder` (D-064: a row of five kegs ahead, the nearest lit on a 2 s fuse, to watch the powder catch). `hour:<h>` (set the world clock to that hour now, for renders and QA at dusk and at night; `startHourFor` inverts the clock). `ride` (D-083: step up to the nearest free horse and into the saddle, through the same `Mounts.onInteract` a player's USE runs, for looking at a rider). `fire` (D-103: light the nearest grass that will burn, about 4 m ahead; a notice says where). `react:<zone>[:<damage>[:<npc id>]]` (D-104: a blow, 26 unless given, to that zone of that NPC or the nearest standing one within 40 m, authored by nobody: 0 head, 1 torso, 2-3 arms, 4-5 legs).

## The expedition (D-034; wiring order and acceptance in `docs/_notes/expedition.md`)
**Schema (append-only).** `PlayerState.cmd` (uint8: a hired hand's standing order as a `COMMAND_IDS` index, 255 none) and `.morale` (0..100): plates only, written by `Followers`. `WorldState.mounts` (map of `MountState`: kind 0 horse / 1 wagon, x y z facing speed, `rider`, `hitch`, `coat` seed, `phase` 0 loose / 1 ridden / 2 led / 3 bolting / 4 wrecked, `hp`, `cargo` = crates in the low nibble and bodies in the high), `.party` (PartyState JSON, <= 2 KB: manifest, roster, dressings, provisions) and `.partyRev`. `FLAG.MOUNTED` 4096, `HITCHED` 8192, `GALLOPING` 16384: predicted like every flag.
**Client -> server (all hostile until the owning system accepts them).** `loadoutSet {loadout}` and `hire {id, on}` (only at the hub, not sailing, standing connected humans, 4 per second per sender; the manifest is normalised, never trusted), `command {intent, at?, target?, who?}` (`at` finite, within 60 m of the sender and inside the region; `attack` needs a live foe row, never a friend or a bystander; `fetch` needs a free prop; one order per hand per 0.5 s; a shaken or wavering hand may refuse and says so). Mount, dismount, hitch and load are INTERACT in the normal input stream.
**Server -> client.** `station {kind: "loadout"}` from the supply pyramid; `notice` carries the hands' "Obeyed." / "Refused. ..." answer (the wheel shows it); everything else is state.
**Prediction.** A ridden horse is a picture of the rider's PREDICTED state: `stepCharacter` hands a body with `MOUNTED` set (not downed, not dragged) to `stepMounted` (`shared/mount.ts`), the same pure, allocation-free step on both sides, and the server flips `MOUNTED`/`HITCHED` like it flips `CARRYING`. Measured through the real room (`bots/expeditionNet.test.ts`, 0 ms local RTT): mount, gallop, jump, dismount: the mount is a flag flip with no position correction, nothing accumulates while riding (mean correction < 0.1 m), the dismount is the one deliberate 1 m placement (`correctionMax` <= 1.5 m), and the client ends within 0.6 m of the server. In process at 100 and 150 ms RTT (`bots/mountNet.test.ts`): worst riding correction <= 0.5 m, replay identical to float32. NOTE the Bot's `driftEma` meter sums raw field differences and so is meaningless across a `MOUNTED` flip (4096 in `flags`): assert on positions.
**Sailing.** The manifest is trimmed and charged when the ship LEAVES the hub (never at propose; cancel is free); its effects are applied at landfall; `enterRegion` commits `scenario.leave()` before it disposes, then `cast`, `mounts` and the hands are torn down and the new shore's mounts are spawned clean (no stale `MOUNTED`).
**Debug / QA.** `JoinOptions.scenario` (create only, validated: `secure_crossing | hostage_rescue | convoy_ambush | border_incident`) forces the contract offered at Kessar; the client takes it from `&scenario=<id>`.

## The campaign grows a future (D-035; wiring order and acceptance in `docs/_notes/campaign.md`)
**Schema (append-only).** `WorldState.powers` (PowersState JSON, <= 3 KB: the three minor powers, the ten-pair relation map, the rival agent, <= 12 authored flags, the newest 6 log lines; `parsePowers`) and `.powersRev`; `.settlements` (SettlementsState JSON, <= 2 KB: the outposts and the latched tech; `parseSettlements`) and `.settlementsRev`. Both blobs are assigned at creation and replaced whole (as `party` and `campaign` are); both serialisers are CANONICAL (fixed key order), so a saved campaign resumes to the same bytes. No `PlayerState`, `MountState` or NPC change. `StationKind` gained `"foundation"` (a station the client prompts at; the server acts on it through INTERACT while carrying a prop: no sheet, no message).
**Client -> server.** `audienceOpen {power}` (a minor power id: only a standing human whose ROW is at the map table or the dock in the hub, only for a power that is pending today, one conversation per power, one open per sender per 1.2 s; everything else ignored). The answers reuse `parleyPick {option}` and `parleyClose` and the server's `parley {view?, line?, closed?}` message, so `Parley.ts` is unchanged (the room routes a pick to the audience when one is open for the sender, else to the scenario). `JoinOptions.resume` (create only): a join code; the server loads the saved record, requires that `token` (a UUID v4, turned into an HMAC key) belongs to a member, and starts the restored campaign at HQ; every refusal (unknown code, stranger, bad or missing token, a live campaign) returns the SAME error text.
**What is saved** (`persistence/`): `campaign`, `party`, `powers`, `settlements` (+ the seed and the join code), on every change of any of them, when the last player leaves and, awaited with a 5 s cap, on dispose. NOT saved: positions, props, NPCs, mounts, scenario progress, carried items, per-player look history. A campaign created without a valid token is not saved.
**The commit pipeline** (`WorldRoom.commitOutcome`): `applyOutcome` -> `powersAfterOutcome` -> `rivalAdvance(c, p, c.day + idle)` (idle = whole days of absence, capped at 3, given ONCE at the first commit after a resume; only the rival's clock moves) -> `Outposts.raid` for each `raided_outpost` -> `Outposts.evolve` (one campaign day) -> (`commitSettlements` -> `powersAfterSettlement`) -> publish campaign and powers -> save. A change of the collision world's identity `worldKey({bridge, outpost stage, telegraph})` rebuilds the world on the server (`rebuildWorld`, then every row is pushed out of whatever now stands where it is) and, by the same pure function over the same two replicated strings, on every client (`Session.worldKeyOf`); the delivery yard (5 m round the foundation) holds no collider at any stage.
**Where the powers bite.** `askingToll(c, powers)` (flags), the manifest charge at sailing (`manifestPct`), `Travel`'s sailing seconds (`techEffects.sailSeconds`: the launch halves it), `validateLoadout` capacity (`techEffects.capacityKg`), the map's intel (`techEffects.intelDays + powerEffects.intelDays`: whether the rival's goal is shown), `pickTemplate`/`newScenario`/`dealComplication`/`garrisonRoster` (`rivalPresence`). Every one of these is a trailing optional parameter: absent = the old behaviour (golden hashes over 200 campaigns in `backcompat.test.ts`).
**Metrics.** `/metrics` gained `persistence {recoveries, quarantined, refusedTooNew, dataLost}`; `saveFailures` counts saves that failed after their retries.

## The ship slice (D-036): NO wire change
**Schema and protocol: unchanged.** Highmark is a `RegionId`; its contract, endings and ledger value ride the existing `WorldState.region`, `scenario`, `campaign` (JSON) and `powers` fields. `travelPropose {to}` now accepts any REACHABLE region (`isReachableRegion`: the machine ignores a region whose `reachable` flag is false and every forged value); `WorldRoom` uses `regionNavOptions`/`regionLanding` so Highmark's nav grid and landing replace Kessar's hard-coded ones; `commitOutcome` needs no change (the outcome carries `region`; the debug command `outcome:<resolution>` sets it for the succession).
**The demo (`DEMO_MODE`).** A demo room refuses `travelPropose` to any region outside `DEMO.regions` on the SERVER (one explanatory `notice` at most every 4 s, forged values silently), sends the existing `notice` at 10 and 2 minutes left, and at zero closes every client with WebSocket code **`DEMO.closeCode` = 4420**. Not 4010: that is Colyseus's own `MAY_TRY_RECONNECT`, which the SDK answers by reconnecting (found by the first real-room demo test; the SDK reported 1006 and the card never showed). `WorldRoom.onLeave` treats 4420 as a consented leave (nobody reconnects into a finished demo) and `onJoin` refuses a rejoin of a finished demo room (`ServerError` 4420). A demo room binds NO saver (no record, no claim, no file) and refuses `resume` with the usual error.
**The platform seam is client-local.** Achievements, rich presence and invites live between the game client and the desktop shell (`window.cbDesktop`, closed IPC channels); nothing about them crosses the game's wire. An invite is mapped to a join code and the client uses the existing lookup (`/campaign/:code`) and `joinById`. The desktop renderer's origin is `app://game`: a production `ALLOWED_ORIGINS` must list it.
**Soak.** `scripts/soak.mjs` drives real rooms with real bots in one process; `/metrics` gained `tick.p50Ms/p95Ms/p99Ms` and per-section `sections` (the tick probe wired into `WorldRoom`'s fixed step).

## Regions three and four (D-037): NO wire change
**Schema and protocol: unchanged again.** Vesper Gorge and the Saltmarket Delta are `RegionId`s; their contracts, sixteen endings and the new `SiteLedger.ends` value ride the existing `WorldState.region`, `scenario`, `campaign` (JSON) and `powers` fields. `travelPropose {to}` accepts any REACHABLE region (all five now; a forged value is still ignored). The six new parley kinds and the `post` station kind are plain values on the existing `station`/`parley`/`parleyPick` messages, re-derived by the server from (kind, round). A world is a pure function of (region, seed); a scenario never changes collision (the scenery only SHOWS it through `RegionView.applyScenario`), so client prediction needs nothing new.

## The Society's appetites (D-084)
**Server -> client.** `gazette {text, k}` (`k`: the kind of moment, `MayhemFact.k`; the client stamps `request`): one line of the casualty column (a limb, a flight, a keg chain, a colleague shot, a bystander, an umbrella, a streak, a commission met), broadcast to the room, at most one every 2.2 s (`Mayhem.GAP`); the client shows it as text, never markup (`ui/Gazette.ts`). Cosmetic: the bill and the request are the server's (`systems/Mayhem.ts`), counted from the room's own damage, toss, keg and shot paths; nothing a client sends feeds them.
**State.** The contract's `ScenarioView` carries the Society's request as its LAST objective (`id: "society"`, `optional: true`, the progress in its text); the commit writes `CampaignState.sites.lastBill` (optional, validated field by field on load: `parseBillRecord`).
**D-087.** Message `bark` `{ id, k, salt }` (cosmetic, broadcast): a party row exclaims; `k` is a `BarkKind`, and the client picks the words with `barkLine(k, salt)` (the same on every client) and plays the babble in that row's voice. At most one per speaker per 5 s and one per party per 1.5 s (Mayhem).
**D-086.** `ScenarioView.rule` (optional string, in the view's JSON in `WorldState.scenario`) is the contract's one fighting rule while it still applies; an older client ignores it. Objective text writes the control as "(Use)"; the client shows the key of the device in hand. A scenario actor spec with `leaves: true` is reported `left` once it is 2.5 m outside its goal (and `arrived` again on return).

## Self-service erasure (HTTP)
`POST /privacy/erase {identity}` (JSON): the anonymous device token (`cb.identity`, a UUID v4; anything else is 400 `invalid_identity`). Origin-checked like the code lookup (403), rate-limited per IP (3, then 1 a minute: 429). The server derives the identity key with the pepper and calls `store.deleteByIdentity`; the answer is `{ok: true, campaigns: n}`. The log records `privacy.erase {campaigns}` only.
