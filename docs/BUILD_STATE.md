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
Done + verified (downed/drag/revive, 2026-09-29):
- Health + down state through one damage entry point; timed revive (server ticks), drag with server-steered velocity, rout; kneel/haul animations; wounds HUD,
  revive progress, "you are down" banner, nametag markers, prompts; Grab control (F / RB). 16 casualty integration tests + 4 prediction/flood bot tests
  (mutation-checked) + 12 shared tests + a two-browser Playwright scenario (revive, then drag).
- Security finding + fix: input-frame flooding gave 3.0x speed; now bounded to ~1.03x by a server-side input budget (D-017).
Done + verified (character art polish pass, 2026-09-29):
- Inverted-hull silhouette outline (smoothed-normal, clip-space thickness, distance-scaled, fog-aware), coarse hull geometry cached separately; on for medium/high
  presets, off on low (`GraphicsPreset.outlines`, `CharacterActor` param). Baked per-vertex shading + per-primitive clay tint; head rebuilt (`head.ts`): brow
  ridges, nose that cannot swallow the mouth, face features placed on the real face surface, 10 hair styles, 8 beards, 10 moustaches, 11 hats; fist hands with
  thumb and knuckles; teeth (gold/missing) and a mouth interior. New catalog entries are append-only so old looks still decode. Verified by renders
  (`?showcase=lineup`), 26 procedural tests incl. outline regressions, and the full Playwright suite. Judged by eye on software GL only: needs a look on a real GPU.
Done + verified (wounds and ragdoll, 2026-09-29):
- Wounds: 6 body zones x severity 0-3 packed in `PlayerState.wounds`; `Casualties.damage` takes zone + direction, stacks wounds, emits a cosmetic `hit` event;
  revive patches to at most a dressing. Rig shows plasters/dressings/stains per zone (one merged mesh per wounded zone, ~2.0k tris only if all six are grievous);
  animator gains a limp (leg wounds) and a flinch spring; hit particles + ground stains pooled (`HitFx`); HUD injury chart (fill + outline weight + words);
  Gore Full/Reduced/Off in the menu (Off = bandages + iodine, no red; verified by a vertex-colour test).
- Ragdoll: client-side Rapier (lazy chunk), 11 bodies with hinge/ball joints and limits, capped at 6, tethered to the server capsule, ~2.6 s max, then blends
  into the animator's lying pose. Triggered by the `hit` event with `down`. `@cb/physics` extracted so server and client build identical static colliders.
  Tests: 22 wound/animator (shared 8, procedural 7, server 7 integration), 10 ragdoll (limits, tether, cap, no leaks, blend equality, no pops), 6 HitFx,
  plus a two-browser Playwright scenario (wounds visible to both, ragdoll seen and ended). Protections mutation-checked: revive cap, zone validation, joint limits,
  tether, animator channel reset.
- Found: `JointData.limits` is silently ignored in rapier 0.21 (limits must be set on the created joint) and the animator did not own every joint channel
  (a finished ragdoll left stale rotations); both fixed with regression tests.
Not done in M2 (next):
- Wounds have no gameplay effect yet (limp is animation only; a real slow-down needs `wounds` as a predicted input of the shared step). No bleed-out or
  medical supplies (M5). Dirt/mud accumulation and blood on clothing beyond the dressings. Outline rollout to NPC crowds (LOD).
- Dismemberment (detachable limbs + wound caps; the rig is rigid per bone for this reason; needs a Dismemberment On/Off setting), ragdolls for living
  characters (explosion knock-back) and NPCs, persistent limp bodies while dragged. Shoulder-carry a body (reuse prop-carry), wagon transport (M5).
- Character LOD for crowds (see PERFORMANCE.md risk); NPC use of the generator.
- Expression triggers beyond downed=pain; head-look; drunkenness from gameplay.
- Creator: colour-blind-safe review, UI scale, keyboard shortcuts; title/nickname editing.

## Open / blockers (human-only)
- Steam App ID, Steamworks account, Steam Direct fee, signing certificates, domain(s), Cloudflare + Railway accounts: none exist yet.
  All isolated behind config; see DEPLOYMENT.md / STEAM_RELEASE.md (drafts, not verified).
- Final title / trademark clearance search: not done (must happen before store page).
- Steam wrapper choice open (D-010).

## Test results (last full run 2026-09-29)
`pnpm typecheck` clean; shared 35/35; procedural 24/24; server 58/58 (origin, netcode bots, physics, interaction, look, casualties, flood); Playwright 5/5 (carry+throw, creator, revive+drag);  client production build OK (213 kB gzip JS).

## Conventions reminder
See CLAUDE.md. Keep this file current: completed / in progress / next / blockers / test results.
