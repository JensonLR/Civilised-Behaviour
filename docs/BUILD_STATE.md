# BUILD STATE - durable handoff

Last updated: 2026-09-29. Branch: `claude/civilised-behaviour-architecture-jtce2l`.
**Read this first after any context reset.** Be honest here: "done" means implemented AND verified.

## Now
- **M0 Foundation: done** except items listed under "Open".
- **M1 Multiplayer movement: mostly done.** Working & verified: authoritative movement, prediction/reconciliation via Colyseus
  `Predict`, remote interpolation, KBM + gamepad input, join code/invite link, reconnect window, hostile-input sanitising.
- Next: finish M1 (interaction primitive, bad-network verification, drift tuning), then M2 character sandbox.

## Milestone board
| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| M0 | Foundation | DONE | monorepo, CI, docs, client/server boot, basic Three scene, room connection |
| M1 | Multiplayer movement | IN PROGRESS | see below |
| M2 | Character sandbox | IN PROGRESS | see M2 detail |
| M3 | Combat | TODO | firearms, melee, cannon, damage zones, gore, friendly fire, downed/revive, Rewind lag comp |
| M4 | First region | TODO | terrain streaming, vegetation, village, HQ, weather, faction NPCs |
| M5 | Expedition | TODO | loadout, followers + command wheel, horse, wagon, boat, region travel |
| M6 | Factions + negotiation | TODO | relationship sim, leaders, offers, consequences, rival expedition |
| M7 | Missions + chaos | TODO | objective nodes, >=12 scenario templates, chaos director |
| M8 | Settlement + campaign | TODO | outposts, evolution, infrastructure, campaign map, tech, newspaper/history |
| M9 | Full content | TODO | 4 regions, factions, balancing |
| M10 | Persistence | TODO | Postgres + Drizzle, identity abstraction, saves, migrations, recovery |
| M11 | Presentation | TODO | full UI, audio, effects, accessibility, tutorial, settings |
| M12 | Optimisation + QA | TODO | profiling, LOD, load/soak tests, bug burn-down |
| M13 | Distribution | TODO | web deploy (Cloudflare/R2), Railway, Electron, Steam adapter, demo, Playtest, website |
| M14 | Release candidate | TODO | security audit, clean-machine, controller-only, bad network, licences, docs |

## M1 detail
Done + verified (tests in parens):
- Deterministic shared sim: RNG, terrain, analytic collision, `stepCharacter` (14 vitest cases: determinism, walls, sliding, step-up, jump, latch, stumble, bounds, cliff).
- WorldRoom: join/leave, unique slots, max 4, name sanitising, authoritative movement, hostile input, reconnect, code lookup (7 integration cases).
- Browser e2e with two real Chromium contexts: create, join by code, prediction, remote sync, bad-code error (2 Playwright cases).
- Client: Stage (instanced obstacles, terrain vertex colours, sky shader, texel-snapped shadow follow), CameraRig, Controls (KBM+pad),
  Menu (with basic pad focus), DebugOverlay (F3).
Also done (2026-09-29): server-authoritative props + pick up/carry/drop/throw (Rapier, D-014) verified in a real browser; QA debug command; origin enforcement (D-012); bot client (`apps/server/src/bots`); prediction verified at 0/100/150 ms RTT with 0 drift, and
fixed a real desync (D-013: idle-tick synthesis). See NETWORKING.md.
Not done in M1:
- Jitter/packet-loss simulation (Colyseus only supports fixed delay); bandwidth measurement; drift shown in the browser overlay.
- Player-vs-player collision (deliberately deferred: needs prediction-aware design).
- Pad remapping, settings UI, UI scale (M11).
- Real character art: `Puppet` is an M1 stand-in only.

## Deployment (see DEPLOYMENT.md)
Render free-tier test deploy is live: client https://cb-client-42gz.onrender.com, server https://cb-server-86wx.onrender.com.
Server-side WebSocket joins verified; end-to-end browser session against it NOT yet verified (sandbox Chromium gets 404 on wss upgrade).
ALLOWED_ORIGINS now enforced (D-012). Open: set health-check path in Render dashboard.

## M2 detail (started 2026-09-29)
Done + verified:
- `packages/procedural`: character spec (41 fields), catalogs, compact codec, sanitiser, archetype-driven seeded generator, proportions fitted to the gameplay
  envelope (24 tests incl. 2000-seed envelope sweep, hostile-input clamping, server-owned history).
- Three.js rig (rigid hierarchy, merged vertex-coloured bone meshes, cached by spec), procedural animator (distance-locked gait, crouch, carry, air, downed,
  blink, 6 expressions), adaptive tessellation (avg 5.9k tris/character).
- Server: `look` validated/canonicalised on join, `setLook` rate-limited, history stripped (5 integration tests, mutation-checked).
- Client: `CharacterActor` replaces the stand-in puppet; creator UI generated from field metadata with live 3D turntable preview, gamepad navigation (`PadNav`),
  look persisted per browser; lineup/close-up showcase scene; 4 Playwright tests incl. creator + cross-player look replication.
Not done in M2 (next):
- Art polish pass: outlines/silhouette pass, clay material response, dirt/blood accumulation, more hat/hair/moustache variety, hands with fingers.
- Wounds/damage zones, dismemberment (detachable limbs + wound caps), ragdoll (Rapier), drag body / revive - the rest of the M2/M3 board.
- Character LOD for crowds (see PERFORMANCE.md risk); NPC use of the generator.
- Expression triggers beyond downed=pain; head-look; drunkenness from gameplay.
- Creator: colour-blind-safe review, UI scale, keyboard shortcuts; title/nickname editing.

## Open / blockers (human-only)
- Steam App ID, Steamworks account, Steam Direct fee, signing certificates, domain(s), Cloudflare + Railway accounts: none exist yet.
  All isolated behind config; see DEPLOYMENT.md / STEAM_RELEASE.md (drafts, not verified).
- Final title / trademark clearance search: not done (must happen before store page).
- Steam wrapper choice open (D-010).

## Test results (last full run 2026-09-29)
`pnpm typecheck` clean; shared 23/23; procedural 24/24; server 38/38 (origin, netcode bots, physics, interaction, look); Playwright 4/4 (incl. carry+throw, creator);  client production build OK (213 kB gzip JS).

## Conventions reminder
See CLAUDE.md. Keep this file current: completed / in progress / next / blockers / test results.
