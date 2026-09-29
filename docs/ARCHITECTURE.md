# Architecture

## Runtime topology
```
Browser / Electron renderer (apps/client)          Game server (apps/server, Node 22, one process, many rooms)
  input (KBM + pad) -> fixed-step sampler   ----->   WorldRoom (Colyseus)
  Predict.reconciler: local prediction               inputs.drain() -> stepCharacter() at 30 Hz
  Predict.attachAll: remote interpolation  <-----    state patches @ 20 Hz (schema delta-encoded)
  Three.js Stage (render only)                       metrics, /health, /metrics, /campaign/:code
                    \__________ @cb/shared ___________/
   protocol, schemas, constants, RNG, terrain, collision, stepCharacter   (pure, deterministic, browser+Node safe)
```
Persistence (PostgreSQL + Drizzle) attaches to the server at M10; Redis only when multiple game processes are needed.

## Packages
- `@cb/shared` - **only** code both sides need: wire schemas (`schema.ts`), constants, `protocol.ts`, `rng.ts`, `terrain.ts`,
  `collision.ts`, `movement.ts`, `arena.ts`. No DOM, no Node APIs. TypeScript source is consumed directly (no build step);
  the server bundles it with esbuild for production (see DEPLOYMENT.md).
- `@cb/physics` - Rapier init, collision-group helpers and `buildStaticWorld` (terrain heightfield + obstacles built from the shared
  `CollisionWorld`). Used by the server prop world and by the client's cosmetic ragdoll world, so both agree on where the ground is.
- `@cb/procedural` - caricature spec/codec/generator (server-safe) plus `./three`: rig, animator, wound dressings, outline (client only).
- `@cb/server` - Colyseus rooms, config validation, logging, metrics, rate limiting.
- `@cb/client` - Vite app. `render/` (Three only), `net/` (Colyseus session), `input/`, `game/` (frame orchestration), `ui/` (DOM).
- Planned, created when first used: `apps/desktop` (Electron), `apps/website`, `packages/game-data` (faction/scenario/newspaper data),
  foliage/kit generators, `infra/`.

## Simulation model
- Authoritative state lives in `WorldState` (Colyseus schema). Movement-relevant fields are scalars mirrored 1:1 into
  `CharState` so the reconciler can roll back and replay.
- One input frame == one fixed step. Client stages `MoveInput` (quantised: int8 sticks, uint16 yaw, uint16 buttons) and sends
  once per step; server `inputs.get(sid).drain()` applies frames in order with the same `stepCharacter`. Idle frames (no input)
  decelerate the character.
- Sanitisation happens at the wire boundary (`defineInput({ sanitize })`, NaN-safe clamps). Semantic checks (can this weapon
  fire? is target in range?) belong in the sim, server side.
- Dynamic physics (props, ragdolls, vehicles, projectiles): Rapier, server-authoritative, snapshot-replicated at low rate with
  client interpolation; never part of the replayed controller (D-006).
- Layers are fixed up front: `LAYER` bit masks in `constants.ts`.

## Rendering
`Stage` owns WebGLRenderer, lights, sky, terrain and instanced obstacles. Everything repeatable is instanced. The renderer is
behind `Stage` so WebGPU can be trialled later. Performance overlay: F3 (`DebugOverlay`). Capture with `scripts/perf-capture.mjs`.

## Platform abstraction (planned, M10/M13)
Adapters `PlatformIdentity`, `PlatformInvites`, `PlatformAchievements`, `PlatformOverlay`, `PlatformStorage`, `PlatformPresence`
with browser and Steam implementations. Gameplay code never imports either. Today `identityToken()` in `net/Session.ts` is the
browser identity stand-in.

## Security posture
Renderer untrusted. Server validates every message, rate limits (`maxMessagesPerSecond`, IP token bucket on code lookup),
sanitises player-visible text (`sanitizeDisplayName`), validates env at boot, never logs secrets. Electron hardening rules in CLAUDE.md.
