# CLAUDE.md - durable project rules

**Civilised Behaviour** (working title) - 1-4 player co-op satirical expedition sandbox. Commercial premium PC game
(Steam first), web-native TypeScript + Three.js, Colyseus authoritative server. Built by ONE developer with AI help:
every choice must maximise systemic depth per line of code, reuse, and maintainability. Not a prototype.

Read first: `docs/BUILD_STATE.md` (where we are), `docs/DECISIONS.md` (why), `docs/GDD.md` (what), `docs/ARCHITECTURE.md` (how).

## Decision priority (in order)
1. Is it fun? 2. Reliable in multiplayer? 3. One dev can maintain it? 4. Creates reusable systemic leverage?
5. Performs well? 6. Preserves visual identity? 7. Improves commercial readiness?

## Non-negotiables
- **Do not switch engine.** Three.js (WebGL2 shipping baseline; WebGPU only behind a flag after profiling). Electron for desktop.
- **Server-authoritative.** Never trust the client with damage, rewards, inventory creation, faction state, progression.
- **Client and server share one pure movement step** (`packages/shared/src/movement.ts`). It must stay deterministic and
  allocation-free. Never use `Math.random`/`Date.now` in shared sim code - use `Rng`/`hash3` from `rng.ts`.
- **No runtime LLMs.** Newspapers/dialogue are authored templates + deterministic generation. Utility-scored AI.
- **Fictional cultures only.** Satire targets institutions, never a real ethnicity/nation/religion/protected group.
  Local societies have agency, factions, humour, and manipulate the players back. Keep the comedy smart.
- **Every asset/AI-generated content is registered** in `docs/ASSET_REGISTER.md` / `docs/AI_CONTENT_REGISTER.md`.
- Gore has Full/Reduced/Off and dismemberment On/Off; gameplay must not depend on gore for readability.
- No ads, energy, pay-to-win, gambling, loot boxes. Payments only via storefronts. Minimise personal data (`docs/PRIVACY_DATA_MAP.md`).
- Electron: `nodeIntegration:false`, `contextIsolation:true`, narrow preload API. No secrets in the renderer.
- Never claim something is done if it is placeholder-only. Update `docs/BUILD_STATE.md` honestly.

## Repo map
```
apps/client   Vite + Three.js game (browser + Electron renderer)
apps/server   Colyseus 0.18 game server (Node 22)
packages/shared   protocol schemas, constants, deterministic sim (movement, collision, terrain, rng)
packages/procedural   caricature character system: pure spec/codec/generator (server-safe) + ./three rig & animator (client only)
(planned) apps/desktop, apps/website, packages/game-data, infra/ - create only when first used
tests/e2e     Playwright (real Chromium, multi-client)
scripts/      dev tooling (perf capture, ...)
```

## Commands
```
pnpm install
pnpm dev                     # server :2567 + client :5173
pnpm typecheck && pnpm test  # tsc + vitest in every package
pnpm e2e                     # Playwright (starts dev servers if not running)
node scripts/perf-capture.mjs 1280x720 medium
node scripts/shot.mjs "?showcase=lineup&n=6" out.png   # look at the art; ALWAYS view renders when changing visuals
```

## Working rules
- Reproduce -> root cause -> fix -> regression test. No symptom patching. Never hard-code around tests.
- Verify fast-moving APIs against the installed package types/docs, not memory. (Colyseus 0.18: client is `@colyseus/sdk`,
  not `colyseus.js`; schemas use `schema({...})`/`t.*`; inputs via `defineInput`/`room.input`; prediction via `Predict`.)
- A stale dev server is a classic false failure: `tsx watch` restarts on edits, but a server started by hand is NOT restarted, and a schema change
  then decodes as garbage on the client. Kill leftovers with `fuser -k 2567/tcp` before e2e. (`ss` is not installed; `pkill -f` can kill your own shell.)
- Headless Chromium here is software-rendered (~10 fps). Do not write timing-based e2e assertions; poll state instead.
  Software-GL numbers are a floor, never a perf claim.
- Keep hot loops allocation-free; pool particles/decals/projectiles; cap ragdolls and physics bodies.
- Do not refactor working code for aesthetics mid-feature. No speculative abstractions, no premature ECS.
- Commit coherent milestones; never force-push; develop on the designated branch.
