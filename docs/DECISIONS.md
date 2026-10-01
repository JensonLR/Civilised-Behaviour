# Decision log

Format: ID - decision - why - revisit trigger. Newest last.

**D-001 Stack (2026-09-29).** pnpm 10 monorepo, Node 22, TypeScript 7 (native compiler, strict), Vite 8, Vitest 5, Three r186,
Colyseus 0.18. Versions verified against the npm registry on this date. *Why:* brief mandates web-native Three.js + Colyseus.
*Revisit:* any major bump of Three/Colyseus (both move fast; re-read installed `.d.ts`).

**D-002 Colyseus 0.18 built-ins for netcode.** Use `defineInput` (server input buffer, sanitise, idle frames),
`setFixedTimestep`, and client `Predict`/`reconciler` rather than a hand-rolled prediction layer. The client package is
`@colyseus/sdk` (the old `colyseus.js` is frozen at 0.16). *Why:* less code for the same result; lag-comp `Rewind` is available
for hitscan later. *Risk:* young API. *Mitigation:* movement logic is one pure shared function, so swapping the transport of
inputs is a small change. *Revisit:* if reconciliation shows drift we cannot tune, or API churn hurts.

**D-003 Sim rate 30 Hz, patches 20 Hz (50 ms), input 1 frame per step.** Starting values from the brief; profile in M12.

**D-004 Rendering baseline** WebGLRenderer/WebGL2 behind `Stage`. `PCFSoftShadowMap` was removed in r186; use `PCFShadowMap`.

**D-005 Persistence** PostgreSQL + Drizzle (0.45.x; drizzle-kit 0.31). Not integrated until M10; server runs in-memory before that.

**D-006 Character movement uses analytic collision, not a Rapier world.** The controller queries deterministic terrain
height + circle/OBB obstacles (`collision.ts`). *Why:* prediction replays ~10 steps per correction on the client; an analytic
world is bit-identical on both sides, allocation-free and has no WASM init/ordering hazards. Rapier (0.21) owns *dynamic*
things (props, ragdolls, vehicles, debris) server-side, which the controller never replays. Planned layers are defined in
`LAYER` (constants.ts). *Revisit:* if authored regions need mesh-accurate collision the controller cannot approximate.

**D-007 Join codes.** Campaign rooms are private (unlisted). A 5-char code from a 32-symbol alphabet (no 0/O/1/I) maps to a
room via a rate-limited `GET /campaign/:code` (10 burst, 1 per 6 s per IP). ~33M codes + rate limit makes enumeration impractical.
Behind a proxy the limiter trusts `x-forwarded-for`; document Railway proxy config in DEPLOYMENT.md.

**D-008 Close code 4000 = CONSENTED leave** (Colyseus). Any other close is treated as a drop and holds the slot for 45 s
(`allowReconnection`). Tests must not use 4000 to simulate a network drop.

**D-009 Test rendering.** Headless Chromium uses SwiftShader (~10 fps at 720p). E2E tests poll simulation state and never
assert wall-clock timing. Perf numbers from it are a floor only.

**D-010 Steam wrapper (open).** `steamworks.js` last published 2024-08-06 (stale). Candidates published Sep 2026:
`steam-bridge` 0.4.x, `steamworks-ffi-node` 0.11.x. Decide in M13 by building each into the packaged Electron app and testing
init, auth ticket, achievements, overlay. Gameplay never imports Steam directly (PlatformIdentity etc. adapters).

**D-011 Interim hosting on Render (2026-09-29).** Owner has a connected Render workspace, so test deployments use Render
(free web service for the Colyseus server + static site for the client, Frankfurt) instead of Railway/Cloudflare. Free plan sleeps
when idle, so it is for smoke tests only. Nothing in the code is Render-specific (PORT, /health, env config), so moving to Railway or
a paid Render plan later is a config change. `DATABASE_URL` is no longer required in production until persistence (M10).

**D-012 Origin enforcement (2026-09-29).** Exact-match allow-list applied to matchmaking, WS upgrade and code lookup; absent Origin
allowed. Patches Colyseus's shared `matchMaker.controller` (`invokeMethod`, `getCorsHeaders`) because the router exposes no per-request
hook; the patch is installed per server and restored on shutdown. Revisit if Colyseus adds a supported request guard.
**Correction (same day):** the first version also deleted `Access-Control-Allow-Credentials`, which broke every real browser (the SDK fetches with
`credentials:'include'`, and browsers then require `Allow-Credentials: true` with a non-wildcard origin). Node-based tests cannot see CORS; only the
Playwright e2e caught it, after it had already been deployed. Rule: any change to CORS/origin/headers needs a real-browser check
(`tests/e2e`, and `scripts/cors-check.mjs` against a deployment).
Testing note: `@colyseus/testing` `boot(server, port)` ignores `port` for Server instances - listen manually for a non-default port.

**D-013 Empty ticks skip the player; no idle synthesis (2026-09-29).** With `defineInput({ idle: true })` a server tick that found a
player's input buffer empty stepped them with zero input. The client never predicted that step, so under normal timer jitter the
server drifted from prediction (measured: reconciler drift EMA up to 0.05, single corrections up to 1.26 m, varying run to run).
Server state must be a pure function of the input sequence, so `WorldRoom` now steps a player exactly once per received input and
skips empty ticks; only after `IDLE_AFTER_TICKS` (12 ticks = 400 ms, unified with the input budget in D-017; originally 6) of silence does it apply zero-input steps so a stalled or
disconnected player lands and stops. Result: drift exactly 0 at 0/100/150 ms RTT incl. wall collisions and 150 ms client hitches.
Consequence: a stall > 400 ms does desync briefly; the reconciler corrects it on resume. Revisit if playtests show stall corrections.
Gotcha: Colyseus reconciler drift telemetry is OFF unless `warnOnDivergence` is set (or debug bundle loaded) - zeros mean "not measuring".

**D-014 Props and interaction (2026-09-29).** Props are server-side Rapier bodies (capped at 48/room, sleeping when at rest, static world = heightfield +
obstacle colliders mirroring the analytic controller world). Replicated as `PropState` (pose + holder) only while awake or held, with sub-2 mm changes
suppressed; clients interpolate. Interaction is evaluated server-side per input frame on rising button edges using the shared `findInteractTarget`
rule (so the client prompt cannot disagree with the authority). Carrying is a server-owned `FLAG.CARRYING` bit in the predicted `flags` field; the
first few predicted steps after pickup are corrected by the reconciler. Held props ignore player capsules but collide with the world.
Gotcha: Colyseus schema strings default to `undefined`, not `""` - treat falsy as empty.

**D-015 Character system (2026-09-29).** `packages/procedural` holds a *pure* layer (spec, catalog, codec, sanitiser, seeded generator, proportions; safe for the
server) and a `./three` layer (rig, animator) that only the client imports. A character is a flat record of small integers (`FIELDS`, ~41 bytes, ~56-char
base64url string); order is the wire/save format, append-only. Untrusted input is decoded, clamped, and re-encoded by the server; **campaign history
fields (scars, teeth, eyepatch, burns, wooden leg) are server-owned** (`HISTORY_KEYS`, `applyClientAppearance`) so clients cannot fake battle damage.
Visuals are a rigid hierarchy (no skinning): one merged, vertex-coloured mesh per bone (cheap, cacheable by spec, dismember-ready) plus small
animated face meshes. Body is fitted into the fixed gameplay envelope by `computeProportions`, so customisation never changes collision or gameplay.
Tessellation is size-adaptive (see PERFORMANCE.md). Lesson: the first render exposed a real bug (face parts parented at the wrong height) that no unit test
would have caught; visual checks via `?showcase=lineup` + `scripts/shot.mjs` are part of the workflow.
Second instance: the animator laid downed characters face-down and the unit test asserted the same wrong sign (tests had encoded the bug); a render caught
it. Assert *geometry* (where does the head point?) rather than raw joint angles wherever a sign convention is involved.

**D-016 Casualties: down, revive, drag, rout (2026-09-29).** Players go DOWN at 0 health, never dead (brief: stories, not hard resets). All harm funnels through
`WorldRoom.damagePlayer` -> `Casualties.damage` (weapons/explosions/friendly fire will call it; today only debug commands do). Revive = hold Interact beside a
downed teammate for 2.5 s; the timer runs on SERVER ticks using the last known button state, so a client cannot speed it up by flooding frames; it cancels on
release, distance, state change, or when the client's frames stop for >1 s (tolerates hitches: a 300 ms stale window wrongly cancelled revives on loaded
machines). Drag = Grab (F / RB) on a downed teammate; the body trails the dragger. Dragged bodies are steered by a SERVER-WRITTEN VELOCITY (dragger velocity +
spring toward the trailing spot) that the shared `stepCharacter` DRAGGED branch integrates with normal collision and ground rules, ignoring input; this keeps
the client's prediction for the dragged player consistent instead of fighting the server (measured: mean positional correction 1.2 cm at 0 ms RTT, 5 cm at
120 ms; worst case ~1 m at 120 ms at the instant pulling starts - acceptable for a passive state, revisit if playtests complain). If every connected player is
down for 8 s, the whole party is hauled back up at spawn with 40% health ("rout", announced with an in-fiction line); this is the placeholder for campaign
consequences (M8). Flags widened to uint16. Not yet: shoulder carry of a body, wagon transport, bleed-out/death, medical supplies (M5).

**D-017 Input budget (security, 2026-09-29).** Movement is a pure function of the input frames a client sends, so unbounded frames = speed hack. Measured on
open ground: a client sending 3 frames per step moved **3.0x** faster (the framework's own message cap only limits it to ~4x). `WorldRoom` now runs a per-player
token bucket: refill 1.05 frames per server tick (5% clock-drift tolerance), capacity 12 (=`HITCH_TOLERANCE_TICKS`, 400 ms) so a genuine stall's burst is
applied in full; excess frames are dropped and counted in `/metrics` `inputFramesDropped`. Steady-state flooding now yields ~1.03x. Tests are mutation-checked
(no budget -> ratio 3.0). Note the burst allowance is deliberate: a cheater can bank ~400 ms of extra movement after idling; bounded and not worth more complexity.
Also: `correctionMax` metrics must ignore server-owned flag changes (flags are numeric fields, so a DRAGGED flip reads as a 256 "correction").

**D-018 Character art pass (2026-09-29).** Silhouette identity comes from an inverted-hull outline rather than post-process edge detection: it works with
MSAA, costs nothing per pixel elsewhere, and is per-character switchable (post-process outlines are all-or-nothing and cost fill-rate at 4K). The hull uses a
smoothed `onormal` attribute (flat-shaded meshes have split normals that would tear the outline open) and offsets in clip space so line weight is stable, with a
distance clamp so far characters do not turn to ink. Hulls are built in a coarse `hullMode` and cached apart from the visible mesh, because a full-detail duplicate
cost +91% triangles versus +37%. Shading is baked into vertex colours (normal-y ramp plus per-primitive clay tint), so no extra lights or textures per bone.
Face features are placed from the real skull/jaw surface (`faceSurfaceZ`) rather than hand-tuned offsets, after noses, moustaches and beards kept clipping or
floating as proportions varied. Catalog options remain append-only so stored looks decode unchanged. Lesson repeated: two regressions (lost outline normals,
hair through hats) were only visible in renders, so the outline now has unit regressions and the lineup showcase is the review tool.

**D-019 Wounds and ragdoll (2026-09-29).** *Wounds* are server-owned state, not client decoration: a 12-bit mask (2 bits per zone) on `PlayerState`, changed only by
`Casualties.damage`, so every client, save file and newspaper agrees on who is injured where. Severity tiers come from damage (8/22/42), repeat hits on a zone
escalate it, unaimed hits use the room's seeded RNG (a campaign seed reproduces its injuries), and revives patch down to a dressing rather than clearing (the
story stays on the body). Visuals derive from the mask only; the `hit` event is cosmetic and lossy by design. Severity reads through the *dressings* (plaster,
wrap, bulky wrap with tail), while gore only recolours the stains, so Gore Off (iodine and grime, zero red vertices, asserted by a test) is exactly as readable.
Deliberately **no gameplay effect yet**: a slow-down must exist in the shared movement step to keep prediction honest, so it waits until wounds are a predicted
input; the limp is animation only. *Ragdoll* is client-side and cosmetic: the server keeps its capsule (zero bandwidth, no authority risk, no cross-platform
physics determinism to chase), the client plays about two seconds of Rapier tumble seeded from the victim's velocity and the blow, tethered to the capsule
(without the tether a sprinting victim ended ~5 m from where the server says they are), then blends world-space joint orientations back into the animated lying
pose. Rapier is lazy-loaded and capped at 6 ragdolls. Trade-off accepted: two clients see slightly different tumbles. The static arena colliders were extracted
into `@cb/physics` because a second consumer (the client) now needs them. Two traps recorded: rapier 0.21 silently ignores `JointData.limits` (set limits on the
created joint), and the animator must own every joint channel or a finished ragdoll leaves stale rotations behind.

**D-020 Character body construction: lofts and toon shading (2026-09-29).** After the art pass the bodies still read as "blobs": torsos, limbs and coats were
stacked scaled spheres and straight tubes, and PBR shading smeared the little form they had. Two changes. (1) `loft.ts`: a body part is a stack of
superellipse cross-sections (`Ring`: y, half-axes, offset, squareness, colour, optional crease), so coats, sleeves, trouser cuts, boots and hands get real
silhouettes with tapers, shoulders, cuffs and hems for fewer triangles than the sphere stacks, and per-section colour gives baked darkening at the bottom of
each form. Sections may be listed top-down (limbs hang from their joint); the winding follows, after a limb came out inside-out and drew as solid black under the
outline hull (tests now assert positive signed volume of every bone mesh and hull). (2) `MeshToonMaterial` with a 4-step ramp for bodies AND face parts:
banded light and shadow gives clay-figure readability that survives distance and fog; the baked normal-y shading was reduced so the two do not fight, and the
per-primitive tint was cut to ~4% because posterised tints made skin look camouflaged. `body.ts` owns the body builders (torso rings are shared with the
wound dressings so bandages sit on the real surface). Rejected: sculpted/skinned meshes and imported assets (one dev, rigid-bone dismemberment,
procedural variation); textures (vertex colour + ramp is enough for the target style).

**D-021 Faces are sculpted (2026-09-29).** A head used to be ~25 spheres, cones and boxes; it read as objects stacked on objects however carefully they were
placed. Now the skin is ONE surface, a function `r(direction)` (egg + brushes for brow, sockets, cheeks, lips, groove, chin) that is meshed on a grid dense at
the face, coloured with baked blush/shade/lips, and *queried* by everything that attaches (`front(x, y)`, `normal(p)`): eyes, nose, moustache, scars, plasters
and glasses. Hair, jaw beards and sideburns are shells built on the same shape, clipped at a mask iso-line so hairlines are smooth curves rather than the
grid's staircase; noses, moustaches, brows, lips and beard tufts are sweeps (tapered tubes along a curve). Analytic normals from the shape function keep
toon bands clean. Cost: the head grew from ~1.5k to ~3.3k triangles; recovered by 32x24 grid, shells on a coarser grid, and low sample/segment counts on
sweeps. Bug found on the way: `front(0, 0)` returned z = 0 (the centre of the head) and collapsed a nose control point; now tested. Rejected: an authored head
mesh with morph targets (asset pipeline for one dev, no procedural variety), and SDF meshing (marching cubes cost and faceting for no visible gain).

**D-022 One palette (2026-09-29).** Colours were scattered: 8 literals in Stage, 4 in PropViews, 40+ in the rig, a third set in CSS. `PALETTE` in
`packages/shared/src/palette.ts` is now the only place a world or interface colour is defined; everything else imports it, CSS variables are published from
it at startup (with fallbacks a test keeps identical), and `palette.test.ts` enforces the art direction (ink is darkest, chroma caps, one warm skin family
with derived blush, twelve distinguishable dyes, gore Off contains no red, UI contrast ratios). `paletteGuard.test.ts` fails on any six-digit colour literal in
rendering code, so drift is caught in CI. The retune that came with it: less orange skin, sun 0xffe0b8 at 3.0, plum "bounce" for warm coloured shadows, boot
leather lightened so it reads against the ink outline.


**D-023 Dismemberment (2026-09-29).** Two separate switches, because the two things they control are different. The *campaign rule* (`WorldState.dismemberment`,
default on, chosen by whoever founds the expedition, server default from `DISMEMBERMENT`) decides whether limbs can come off at all: authoritative, identical for
everyone. The *personal setting* ("Severed limbs: Shown/Hidden") decides only what you see: hidden, the same injury renders as the ordinary grievous-wound dressing
and no limb flies, so a squeamish player is never playing a different game. The server owns a 4-bit `missing` mask (arms and legs only; heads and torsos are never
severed, characters are downed not dead), rolls a seeded chance from the damage and the limb's existing wounds (`severChance`, pure and tested), stamps a grievous
wound, and broadcasts a cosmetic `sever` event. Clients hide the limb's bone meshes and cap a stump at the joint (`buildStump`); the flying limb is a frozen-pose copy of
the same geometry (`rig.detachLimb`) driven by a tiny pooled ballistic sim (`LimbDebris`, cap 8, 25 s life) rather than Rapier, since nothing depends on where it lands.
Rejected: skinned meshes with cut planes (the rig is rigid per bone precisely so a limb is a mesh you can hide and copy), and making the visuals part of the campaign
rule (it would let one player's taste change another's screen). Not done: prosthetics (a lost leg does not yet link to `spec.woodenLeg`) and any movement effect of
limb loss (same predicted-input constraint as wounds).

**D-024 Interface as expedition ephemera (2026-09-29).** The first interface was beige rounded boxes: correct, and interchangeable with any web form. It now looks like
the printed matter of the Society the game is about: the menu is a leather-bound charter (brass corners, double-ruled page, compass-rose letterhead, ruled form fields,
a rubber-stamp call to action), the creator is a ledger with index tabs and brass-knob sliders, vitality is a brass gauge with a needle (number and "!" as well, never
colour alone), the injury chart is a surgeon's luggage tag, nametags are luggage tags, notices are telegrams, prompts are tickets, being down is a mourning card. All of it
is CSS plus a few inline SVGs (no image assets), every colour is a palette variable, and type is IM Fell English / English SC (period printing) with Special Elite for the
telegraph, bundled via `@fontsource` (SIL OFL, listed in ASSET_REGISTER) so the game works offline on Steam. Contrast stays with the palette tests' ratios.

**D-025 World as illustrated ephemera (2026-09-29).** The environment was PBR flat-shaded grey-green with lollipop trees, a tan box for a wall and a gradient sky: it looked like a
different, cheaper game next to the toon-shaded, ink-lined characters. It now uses the characters' language: `MeshToonMaterial` + the same 4-step ramp, palette vertex colours, and the
inverted-hull ink outline, extended to `InstancedMesh` (`#ifdef USE_INSTANCING` in the outline shader; the hull shares the instance buffer, so one extra draw covers every instance). The rules:
(1) **one source of truth for what a thing is**: obstacles carry a `tag` (tree, rock, snag, tent, fire, flag, sign, luggage, cart, crate, wall) and the authored camp lives in `camp.ts`, which feeds
collision (`createArena`), visuals (`world/landmarks.ts`) and keep-out (`scatterProps`), so the tent you see is the tent you hit and no prop ever spawns inside one; untagged obstacles keep the old
height contract (`classifyObstacle`). Fixing that contract also removed a latent bug: the tallest boulders (r > 2.1) were classified as trunks. (2) **Decisions are pure and shared**
(`worldgen.ts`: species by position, ground colour, cover density) so they are unit-tested in Node and identical everywhere. (3) **Everything repeated is instanced**; everything unique and solid
is merged into one geometry (the whole camp is one draw + one hull), so the world is 22-28 draw calls including the shadow pass. (4) **The world does not end**: the visible ground eases flat past
the playable radius, a skirt and three hazed hill rings continue it, fog/sky/skirt/hills share one colour of distance. (5) **Text is generated at runtime** (canvas, IM Fell bundled): no image assets.
Also changed: the sun shadow got a softer edge (`shadow.radius`) and a larger bias because faceted canvas and foliage dithered at the terminator. Rejected: PBR with a toon post-process (fights the
character look and costs a full-screen pass), imported tree/rock packs (asset pipeline and licence burden for one dev, no procedural variation, cannot share the character outline), impostor billboards
for distant trees (not needed at this triangle budget), real point lights for the fire (per-pixel cost on every material for a cosmetic; a baked warm tint, additive glow and flicker read the same).
Not done: wind on trees, weather, day/night (the sky is one fixed afternoon), grass that bends around walkers, collision for shrubs, vegetation streaming (M4), LOD for distant trees.


**D-026 Injuries matter (2026-09-29).** `wounds`, `missing` and `FLAG.PEG_LEG` are inputs of the shared movement step (via `injuryMods`, one pure table-tested mapping used by step, server rules and client prompts), so a wound landing mid-sprint costs about 1 mm mean correction instead of 70-217 mm. Leg loss/grievous wounds hobble and forbid sprint/jump; a peg leg softens it; arms gate carrying (two sound arms any prop, one only light props, none nothing) and scale throws; enforced at the pickup gate and every tick. Field dressing reuses the revive hold (no new input): one wound level per 2 s, floors at scratch, never self. Revive/rout never regrow limbs. Full rationale, rules table and rejected options: `docs/_notes/gameplay.md`, numbers in NETWORKING.md.

**D-027 Garments are patches of the body's own surface; faces carry decals; crowds get levels of detail (2026-09-29).** Garments, hair locks and face decals are built on the sculpt (masked parametric patches cut on a signed-distance line), so nothing floats or sinks; ~100 new options appended to the spec (batch 2, own rng stream, old looks/seeds unchanged); prosthetics through `setMissing`; `buildCharacter(spec, {lod})` with LOD0 10.6k / LOD1 5.7k / LOD2 1.4k average triangles; an audit test builds every option on several bodies. Details and lessons: `docs/_notes/characters.md`.

**D-028 The world has time, weather-free life and a destination (2026-09-29).** Day cycle (`?time=`), water, wind that bends grass around walkers, ambient life, a stream/ford, hill rings with tree lines and an Observatory ruin with a trail, thinner scenery outlines than characters. Landscape features are shared pure code so client and server agree; the ford is walkable. Details: `docs/_notes/environment.md`.

**D-029 First person is a camera mode over the same body (2026-09-29).** Toggle X / R3 (V is melee), `?view=first`, persisted; the local head is hidden (with an invisible shadow caster), arms are posed for the lens, remote players are unchanged, movement and interaction logic untouched. Details: `docs/_notes/firstperson.md`.

**D-030 Combat is server-resolved with bounded lag compensation (2026-09-30).** Weapons are pure data (`weapons.ts`) plus pure ballistics; the server resolves every shot against stacked body-zone ellipsoids and feeds the existing `Casualties.damage` entry point, so wounds, downs and dismemberment need no new rules. Rounds are hitscan (rifle) or pooled projectiles (pistol, blunderbuss pellets, cannon). Lag compensation rewinds targets to the shooter's view time, clamped to 250 ms (measured 14/14 at 100 ms RTT, 10/14 at 200 ms on a strafing target; 0/14 without it at 200 ms). Recoil and spread patterns are cosmetic on the client and are not movement inputs, so shooting leaves prediction untouched (worst correction 4e-7 m); server-applied knock is the one exception (up to 0.42 m at 100 ms). Friendly fire is a campaign rule (default on; off = rounds pass through comrades; your own blast is always halved). The field cannon needs crew (2 = 4 s load, 1 = 8 s). Nine protections mutation-checked. Balance is a first pass never played by humans. Detail: `docs/_notes/combat.md`.

**D-031 All audio is synthesized; presentation settings are one persisted map (2026-09-30).** No audio asset files: every sound is arithmetic (filtered noise, swept tones, inharmonic partials, formants), rendered once into buffers and played through a capped voice pool with spatialisation, plus generative ambience and a seeded music bed. It has never been listened to by a human (validated by offline renders: peaks, RMS, spectra, worst-case pile-up peaks -1.2 dBFS): expect retuning by ear. Settings (sound, display, controls with rebinding, accessibility incl. colour-blind marks, high contrast, larger text, captions, reduced motion) all persist in localStorage with URL overrides that never touch the saved value; every sheet is keyboard and pad navigable. Detail: `docs/_notes/audio-ui.md`.

**D-032 Time and weather are pure functions of server state (2026-09-30).** The room replicates `worldMs`, `dayStartHour`, `dayMinutes`; `worldHours()` and `weatherAt(seed, ms)` are pure, so every client derives the same hour and weather without messages (six states in 2.5 min slots, 20-40 s blends, always clear at the start). Rain, puddles, lightning, fog and wind hang off `getAtmosphere()`. Clock verified live with two real browsers (0.2 s apart, equal to `worldHours` of the server's `worldMs`); weather checked by tests and stills only. Detail: `docs/_notes/environment.md`.

**D-033 Hollowmere is home; the game is played in colony regions reached from the map room (2026-09-30).** Hollowmere and the camp are the HQ hub (the jetty is the dock, the marquee's map table is the map room, the notice board carries the paper); the destinations are authored foreign regions, the first being Kessar Reach (river crossing, fortified hill-capital behind it, one local faction, one rival expedition). The core loop is now HQ -> choose destination -> sail -> scenario -> campaign state -> paper at HQ. Shape: (1) ONE Colyseus room per campaign holds ONE active region; `enterRegion` disposes the old region's physics, props, NPCs and scenario and builds the new one (only the active region simulates; join code, reconnect and campaign state survive; `JoinOptions.region` picks the start for dev/tests). Rejected: room-per-region (needs persistence hand-off, M10) and both regions resident. (2) Travel is a four-phase state machine in the schema (idle, proposed, sailing, arriving) with a client `regionReady` handshake, because the client must build a new world before it may send input. (3) NPCs are `PlayerState` rows (`npc != 0`, key `npc:<id>`) driven by synthetic `MoveCommand`s through the same step, combat and casualty code, so soldiers get wounds, dismemberment, lag compensation, ragdolls and rendering for free; rejected: a parallel NPC schema plus a second hit-resolution path in Combat. (4) Campaign state is plain data (`CampaignState`, JSON in one schema string, hostile-safe `parseCampaign`) with one `applyOutcome` rules table; the newspaper is a pure function of it, computed on the client (no message). (5) The scenario is a pure reducer over events (`reduceScenario`) with a thin server system around it, so three resolutions (negotiate, force, sabotage; plus bribe and the rival winning by waiting) are tested without a network. (6) Work is split into three packages with disjoint files and one integrator who alone edits schema, protocol, WorldRoom and client wiring; the shared types live in one frozen contract file. Not done: loadout, vehicles (sailing is a card), NPC-crewed cannons, a second scenario, persistence. Detail, exact types and acceptance tests: `docs/_notes/slice.md`.

**D-033 addendum (integration, 2026-09-30).** NPC rows take slots 16+ (the spec's 255 would make every NPC collide in Combat's pending-hit key, so a blast on three sentries wounded one). `Combat.hittable` decides who may hurt whom: party and garrison are always enemies, friendly fire only governs party-vs-party, garrison-vs-garrison never; hits on the garrison take full damage (`ffScale` softens a comrade's hit only). `Casualties` gets a party-only `players` view (revive/drag scans and the whole-party-down rout ignore NPC rows) while `get` still finds any row, so damage, downing and dismemberment run unchanged on soldiers. A sailing may only be proposed within reach of a map table or dock (the client offers it there; the server checks). The paper is computed on the client from the replicated campaign JSON. `Stance`/`Station` in the contract were renamed `FactionStance`/`UseStation` (name clash with weapons/villagers exports).

**D-034 The expedition gets weight: one NPC runner, one navigation grid, a second shared step for mounts, hired hands as NPC rows, scenarios as templates (2026-10-01).** Slice 1 proved the loop; this slice makes it worth repeating. (1) NPCs: ONE server `Cast` runs every NPC row (garrison, rivals, deserters, hostages, followers) through the same step/combat path; brains plug in (`BrainFn`: utility-scored garrison brain, follower brain, inline civil), scenarios steer groups only through `CastOrder`s. Enemies get a small shared 2 m navigation grid over the region's real `CollisionWorld` (A* in typed arrays with generation stamps: deterministic, allocation-free, rebuilt in <80 ms when the bridge falls), cover and flank queries, and believable fallibility: reaction time on a new target, per-burst aim error that ranges in on a still target, weapon cadence, and ATTACK TOKENS (two shooters per target at once) so a lone player survives a skirmish for tens of seconds and a party can still win. Morale is one pure function shared by garrison and followers. Rejected: a navmesh (one static world, one collapse), Rapier characters, a behaviour-tree library, per-package NPC loops. (2) Mounts: a SECOND pure shared step (`stepMounted`) selected by a predicted flag (`FLAG.MOUNTED`) flipped by the server like `CARRYING`; the horse is a picture of the rider's predicted state (no second reconciler), faster, wider turning, jumps, knocked off by wounds and impacts through a deterministic `throwRisk`. The wagon is a server-owned rigid trailer (`trailStep`) with prop and body bays, not a Rapier vehicle. (3) Followers (porter, rifleman, surgeon) are authored NPC rows with temperaments and wages; commands are pure intents the server validates and a morale band can refuse; loadout and roster live in their own `PartyState` blob so the campaign JSON stays about the world. Weight is a hard budget at the manifest table, not a movement penalty (that would be a new predicted input). (4) Scenarios are data-driven templates over a generic event vocabulary and an exhaustive `ResolutionId`; the crossing reducer is kept and wrapped; three new ones (hostage rescue, convoy ambush, border incident) resolve 4, 4 and 5 materially different ways; a pure chaos director deals one complication from state with a cooldown; the campaign (not the player) chooses which contract Kessar offers, from its ledger. (5) Decided slice-1 loose ends: leaving mid-scenario commits (`abandoned`, or the template's own leave outcome; a lit fuse falls as `sabotaged`; leaving before anything happened commits nothing); a paid, bargained, bribed or forced crossing is SETTLED for 3 campaign days so trust cannot be farmed by re-paying; far or off-screen name plates are culled; a scripted blast has an owner. (6) Process as D-033: a frozen phase-0 contract, four disjoint packages, one integrator; only the horse package may run the screenshot tool. Everything balance-related is a first pass tuned against scripted bots, never played by a human. Detail, exact types, acceptance tests and the ordered wiring list: `docs/_notes/expedition.md`.

**D-034 addendum: what the integration decided (2026-10-01).** (1) The phase-0 contract was never landed, so packages reconciled at the end: shared modules are exported from `index.ts` (no relative-path imports, the temporary mount shims are gone) and `stepCharacter` carries the single mounted dispatch (before the stumble clock, so a ridden step does not tick it twice). (2) Combat's `hittable` is now "who is this shooter at war with", answered by the Cast (`hostileTo`): a person's rounds reach enemies always and their own side only under friendly fire; an NPC's rounds reach only whom its side is fighting; a hand's attack order is itself a declaration of war. A scripted blast still follows its owner's rules. (3) Orders to the hands are validated twice: `parseCommandMsg` (structure) and `Followers.onCommand` (sender standing, rate, range, target a live foe row, never a friend or a bystander), then each hand answers by its own morale band and may refuse in words. (4) The manifest is charged when the ship leaves the hub, not at propose, and trimmed in a fixed order (powder, provisions, wagon, horses, ammunition, medical); propose only warns. (5) Hired hands are in the hub's `helpable` view so a human can revive one, and a surgeon works through `Casualties.assist` under the same rules as a human's hands (reach, standing medic, right patient, one at a time); the rout still counts humans only. (6) A barrel struck by a ranged round explodes: one rule for the powder keg of the manifest, the convoy's barrel and the camp's scatter. (7) The dev-forced contract (`JoinOptions.scenario`) never applies to the hub. (8) Command is a held action, T by default (pad: d-pad down), with no wire button: the order is its own message, and the number keys belong to the wheel while it is open.

**D-035 The campaign grows a future: more powers, a rival with goals, outposts that evolve, a saved ledger, and the release debt paid (2026-10-01).** D-033/D-034 made one visit worth playing; this slice makes the return worth making. (1) NEW STATE LIVES IN NEW BLOBS, not in `CampaignState`: `PowersState` (three more local powers, a ten-pair relation matrix, the rival agent, a short event log) and `SettlementsState` (outposts per region and latched tech) each get their own JSON string and revision on `WorldState`, their own hostile-safe parser and their own pure rules, exactly as `PartyState` did. `FactionId` and `CampaignState` stay frozen, F and O never edit the same file, and the 1.8 KB campaign string does not grow. They meet only through contract types (`RegionClimate`, `SettlementEvent`, `RivalPresence`, `PaperExtras`) in one frozen `worldTypes.ts`, which is the FIRST workflow step this time (D-034's phase 0 never landed before its packages started and the integrator reconciled at the end).
(2) THE POWERS ARE DIFFERENT SHAPES, not recolours: a merchant oligarchy that decides by auction (Brine Houses), a co-operative that decides slowly by show of hands and then astonishingly (Thornfield Reapers), a mourning guild with no army and all the records (Low Vesper). Relations between all five powers are a matrix that drifts toward authored bases and moves through ONE exhaustive table over the 20 resolutions (the compiler enforces it); the powers surface through audiences at HQ that reuse the existing parley sheet, the map room, the paper and `PowerEffects`, never a dashboard.
(3) THE RIVAL IS AN AGENT: six goals scored by utility from its purse, escort, grudge and the ledger, advanced by a pure function of (campaign, powers, day counter), so it acts between expeditions and, via `RivalPresence`, shapes what the party meets during one (arrival time, wagon, surveyors, the contract offered). It is made fair by rules that are tested: every payout is announced at least two days ahead, every goal has two real counters, a settled crossing blocks the purchase. Absence moves ONLY the rival and only by whole idle days capped at three; real minutes never do (the game must not punish a night's sleep).
(4) OUTPOSTS ARE A PHYSICAL ACT AND A SIMULATION: founding is carrying crates (the existing prop system) to a foundation and delivering them; later stages are earned by pure daily evolution from supply, security, trade, the Ward's prosperity and the rival's pressure, with hysteresis and dwell so nothing flaps, and kept alive by the same hauling (supply decays). Roads, a telegraph and a steam launch are LATCHED thresholds with no tech-tree UI; they show up in the world, the paper and the map, and change sailing time, capacity and intel. The collision world now depends on `(bridge, outpost stage, telegraph)` through one `RegionWorldOpts` and a `worldKey`; the view swaps its outpost group in place without rebuilding the world, and the delivery yard is always free of colliders so no stage change can trap a player. HQ is decorated by history on existing surfaces only (no new colliders).
(5) PERSISTENCE SAVES THE LEDGER, NOT THE LIVE WORLD: one `CampaignStore` interface (memory, an atomic versioned file store with `.bak` recovery and refusal of future versions, Postgres through Drizzle tested in-process with PGlite) over opaque per-module sections, optimistic `rev`, identity as an HMAC key (anonymous device id now, a verifier slot for Steam later; raw ids are never stored), resume only by a member through the join code and always at HQ, saves on every outcome and on dispose. Rejected: saving positions, props or NPCs; any database in the sandbox; resuming for anyone who knows a code (a dormant campaign is resumable only by a former member; a live one is joinable as before).
(6) HYGIENE: dev hooks (`JoinOptions.region/scenario`, client `?region/?scenario/?showcase`) are gated behind `debugCommands` and the build mode; loadout and hire require standing at the supply table; NPC timing runs on the simulated clock (reproducible per seed) and shared code has no `performance.now`; two per-frame allocation sites are removed; reconnect during a ride and during the sailing are tested; a skippable first-run orientation card, procedural audio for the new content and a signposted dock/map-room route at HQ. Only the outposts package takes screenshots (and must look at the backlog nobody has looked at); presentation work that cannot be looked at is looked at by the integrator at the end. Everything is a first pass nobody has played. Detail, exact types, acceptance tests and the ordered wiring list: `docs/_notes/campaign.md`.

**D-035 addendum: what the integration decided (2026-10-01).** (1) The phase-0 contract and packages F and O NEVER ran (their agents stopped at the missing `worldTypes.ts`, as the rule said); P and R ran without it. The integrator therefore landed `worldTypes.ts` and built F and O's modules itself (`powers.ts`, `relations.ts`, `rival.ts`, `audiences.ts`, `settlement.ts`, `outpost.ts`, `hqHistory.ts`, `mapData.ts`, the two text files, `Audience.ts`, `Outposts.ts`, the client views), smaller than the spec in places (BUILD_STATE lists exactly where). Contract additions made while building (append-only): `PowerState.refusals` (the price of refusal needs the last three refusal days), `OutpostState.raids`, and `OutpostState.crates` doing double duty (crates at the foundation until founded, then the consecutive days of supply < 15). (2) The collision world's keep-out is applied only when the stage is above "none": "none" stays byte-identical to the world before the slice; a stage clears the seeded trees and rocks out of a 32 m ring (the same set at every stage) and appends its own colliders, which draw no random numbers. The Syndicate's own post is visual only (it is not in `RegionWorldOpts`). (3) Serialisers of the new blobs are canonical (fixed key order) because a saved campaign must come back byte for byte; `parse(serialize(x))` and key-order shuffles are tested. (4) Absence moves ONLY the rival, by whole idle days capped at 3, at the first commit after a resume (not at resume itself, so the resumed JSON equals the saved JSON); settlements do not evolve while nobody plays. (5) A saver bug found by the first real-room resume test and fixed at the root: a save that landed overwrote the room's record with the stale copy it had started from, so a member who joined during the write was forgotten (regression test in `saver.test.ts`). (6) The first-run orientation, the HQ route, the new sounds and the gating of dev hooks are R's and are wired by reading R's integration notes; nothing in this slice has been played by a human.
