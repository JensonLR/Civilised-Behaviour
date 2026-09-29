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
skips empty ticks; only after `IDLE_AFTER_TICKS` (6 ticks = 200 ms) of silence does it apply zero-input steps so a stalled or
disconnected player lands and stops. Result: drift exactly 0 at 0/100/150 ms RTT incl. wall collisions and 150 ms client hitches.
Consequence: a stall > 200 ms does desync briefly; the reconciler corrects it on resume. Revisit if playtests show stall corrections.
Gotcha: Colyseus reconciler drift telemetry is OFF unless `warnOnDivergence` is set (or debug bundle loaded) - zeros mean "not measuring".

**D-014 Props and interaction (2026-09-29).** Props are server-side Rapier bodies (capped at 48/room, sleeping when at rest, static world = heightfield +
obstacle colliders mirroring the analytic controller world). Replicated as `PropState` (pose + holder) only while awake or held, with sub-2 mm changes
suppressed; clients interpolate. Interaction is evaluated server-side per input frame on rising button edges using the shared `findInteractTarget`
rule (so the client prompt cannot disagree with the authority). Carrying is a server-owned `FLAG.CARRYING` bit in the predicted `flags` field; the
first few predicted steps after pickup are corrected by the reconciler. Held props ignore player capsules but collide with the world.
Gotcha: Colyseus schema strings default to `undefined`, not `""` - treat falsy as empty.
