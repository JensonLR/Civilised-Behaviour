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

