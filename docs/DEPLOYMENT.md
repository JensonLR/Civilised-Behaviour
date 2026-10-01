# Deployment

Status: interim test deployment on Render (free plan, see D-011). Railway/Cloudflare/R2 plan below is the intended production target and is not built yet; no Dockerfile exists.

## Interim: Render (D-011)
Services `cb-server` (Node web service) and `cb-client` (static site), Frankfurt, free plan, branch `claude/civilised-behaviour-architecture-jtce2l`, config mirrored in `render.yaml`. Free instances sleep after ~15 min idle: WebSockets drop and the next connection cold-starts (~30-60 s). Test use only; move to an always-on plan before any real playtest.

### Live test deployment (created 2026-09-29)
| Service | Type | URL | Render id |
|---------|------|-----|-----------|
| cb-server | Node web service, free, Frankfurt | https://cb-server-86wx.onrender.com (`/health`, `/metrics`) | srv-datqpblg1s2s73adt930 |
| cb-client | Static site | https://cb-client-42gz.onrender.com | srv-datqpe0u01pc73a6rm5g |

Both auto-deploy on every push to the branch. Client is built with `VITE_SERVER_URL=wss://cb-server-86wx.onrender.com`.

**Verified:** both deploys build and go live; `/health` 200; client page loads; matchmaking `POST /matchmake/create/world` works from the
client origin; server logs show real joins/leaves from a curl WebSocket handshake and from the Colyseus Node SDK over `wss://`.
**Not verified:** a full browser session against the deployment. The sandbox's Chromium gets a 404 on the `wss://` upgrade while curl and the
Node SDK succeed with identical headers, so this looks like a sandbox-proxy artefact, but it is unproven. Open the client URL in a normal
browser (two tabs) to confirm; `scripts/deploy-smoke.mjs <clientUrl>` automates it where the network allows.

**Known gaps:** Render health-check path is not set (the MCP tool cannot set it; set `/health` in the dashboard). `ALLOWED_ORIGINS` is enforced (see NETWORKING.md); the Electron build's renderer origin must be added to it when that app exists. First request after idle cold-starts the instance.

## Target
- Web + demo: Cloudflare Workers Static Assets; large assets on R2 behind a custom asset domain (not r2.dev), immutable hashed filenames.
- Game server: Railway, single Node process hosting many 1-4 player rooms + PostgreSQL. No Redis until measured load needs multiple processes.
- Staging + production environments; health endpoint `/health` (exists); graceful shutdown (Colyseus `gracefullyShutdown` enabled).

## Server env (validated in `apps/server/src/config.ts`)
`NODE_ENV`, `PORT` (default 2567), `LOG_LEVEL`, `ALLOWED_ORIGINS` (required in production), `DATABASE_URL` (optional until M10),
`SIMULATED_LATENCY_MS` (must be 0 in production).

Campaign persistence (`apps/server/src/persistence`, read by `persistenceConfig`; fails fast with a readable list):
| Variable | Default | Meaning |
|----------|---------|---------|
| `CAMPAIGN_STORE` | `memory` | `memory` (nothing survives a restart), `file` (atomic versioned JSON, single server process owns the directory) or `postgres` (Drizzle over `postgres`, tables created at boot from embedded SQL, no CLI) |
| `SAVE_DIR` | `./data/saves` | Directory for `file`. Put it on a persistent volume; `<id>.json` + one `.bak` per campaign, damaged files are moved to `<id>.corrupt-<ts>-<n>.json` and a file written by a newer build is refused and left alone |
| `DATABASE_URL` | none | Required for `postgres`. Never logged. A boot failure of any store downgrades to memory with a loud error rather than crashing |
| `IDENTITY_PEPPER` | dev constant | HMAC key for identity keys. REQUIRED (>= 16 chars) in production for `file`/`postgres`; secret, stable (rotating it orphans every membership) |
| `SAVE_RETENTION_DAYS` | `180` | Dormant campaigns older than this are purged at boot and daily (1-3650) |

## Production build plan
Server: bundle `apps/server/src/main.ts` with esbuild (inline `@cb/shared`, external node_modules), run `node dist/main.js` in a
Node 22 slim image. Client: `vite build`, upload `dist/`; set `VITE_SERVER_URL=wss://<game-host>`.

## Open items before first deploy
Railway proxy `x-forwarded-for` handling for the code-lookup rate limiter; CORS/ALLOWED_ORIGINS enforcement on HTTP endpoints;
DB migrations from zero (M10); rollback runbook; cost baseline and measurements required before scaling.

## Desktop shell (D-036, `apps/desktop`, package `@cb/desktop`)
An Electron shell around the SAME client build. It loads the game from disk through the `app://game` protocol (secure, standard, no fetch-from-other-origins, a CSP on every response), so the front door opens with **no network at all**. Playing needs a server: the hosted test server by default (`CB_SERVER_URL` overrides), or one you run (`pnpm dev:server`, then build/run with `CB_SERVER_URL=http://localhost:2567`). The menu probes `/health` (`platform/serverReach.ts`) and says plainly when the offices are shut. There is **no embedded server** (Rapier WASM plus Colyseus in the main process is its own slice).

```
pnpm --filter @cb/desktop run build:client   # vite build --mode desktop -> apps/client/dist-desktop (relative paths; never the web deploy's dist)
pnpm --filter @cb/desktop run build          # tsc, then esbuild -> apps/desktop/dist/{main,preload}.cjs
pnpm --filter @cb/desktop run dist:dir       # client + shell + `electron-builder --dir`: the unpacked app in apps/desktop/release/ (git-ignored)
pnpm --filter @cb/desktop run dist           # the same, as installers (win nsis x64, mac dmg x64+arm64, linux AppImage + deb), UNSIGNED
```
Env (build-time values are baked as defaults; the same names override at run time; none is a secret):
| Variable | Meaning |
|----------|---------|
| `CB_SERVER_URL` | http(s)/ws(s) address of the game server. Default `https://cb-server-86wx.onrender.com` (the interim test server above). Also fixes the CSP `connect-src` and the request filter |
| `CB_WISHLIST_URL` | https store page. Absent = the wish-list card says "coming soon" and opens nothing. Opened in the system browser, never in the game window |
| `CB_STEAM` | `stub` selects the in-process stand-in (`steam/StubSteam.ts`); unset = off; `real` is not implemented and falls back to off WITH a warning |
| `CB_UPDATES` + `CB_UPDATE_FEED` | update checks. OFF by default; on only with `CB_UPDATES=1` AND an https feed. No updater library is installed: turning them on needs a release decision |

**Server side:** the renderer's origin is `app://game`. A production server must list it in `ALLOWED_ORIGINS` (exact match) or every desktop connection is refused with 403. `appId` is a placeholder (`game.civilisedbehaviour.desktop`); change it with the real identity. `electron-builder --dir` was run on Linux in this slice and the unpacked app was launched under a virtual display (see BUILD_STATE); installers, Windows and macOS packaging, signing and notarisation are NOT done (`desktop.yml` builds unsigned `--dir` output on three OSes, dispatch or `desktop-v*` tag only, no secrets).

## The bounded web demo (D-036)
A demo is a CONFIGURATION of the one game, never a fork. The SERVER enforces it (`apps/server/src/systems/Demo.ts`): Hollowmere and Kessar only, one session of `DEMO.sessionMinutes` (45) from the room's creation, warnings at 10 and 2 minutes left (the existing `notice` message), a hard close at zero with WebSocket code `4420` to every client (not 4010: that is Colyseus's own "may try reconnect" and the SDK would reconnect instead of showing the card), and nothing persisted (a demo room binds no saver whatever store the process is configured with, and refuses `resume`; a rejoin of a finished demo room is refused too). The client only SHOWS it (`DemoBanner`, `Wishlist`).
| Where | Variable | Meaning |
|-------|----------|---------|
| server | `DEMO_MODE` | `1`/`true`/`yes`/`on` turns the demo policy on; anything else, garbage included, is off |
| server | `DEMO_SESSION_SECONDS` | test override (5..2700). Honoured ONLY when `NODE_ENV` is not production |
| client build | `VITE_DEMO=1` | compiles `__DEMO__ = true` (the banner, the wish-list card, no Resume) |
| client build | `VITE_WISHLIST_URL` | https only; validated in `vite.config.ts` and compiled as `__WISHLIST_URL__` (empty when invalid) |
Run the demo as a SEPARATE server and client deployment from the full game: the policy lives in the server (`DEMO_MODE` is per process), so a demo-built client pointed at a full server would show a countdown that nothing enforces, and a full client pointed at a demo server simply gets the demo's limits. **The limit is per ROOM, not per person**: a demo holds no identity (it saves nothing), so a visitor who creates a new room gets a fresh 45 minutes; the demo is a taster, not a licence check, and a per-visitor cap would need identity the privacy map deliberately does not hold.

## The website (D-036, `apps/website`)
Plain files (`index.html`, `press.html`, `style.css`, `presskit.json`) plus a dependency-free `scripts/build.mjs`: `pnpm --filter @cb/website run site` writes `dist/` with a GENERATED `tokens.css` (from `PALETTE.ui`; the build fails if a pair the stylesheet uses drops under AA contrast), the bundled fonts copied out of `node_modules`, and the AI-content disclosure generated from `docs/AI_CONTENT_REGISTER.md` (the build FAILS on a Type it has no line for, and drops the "nothing model-generated" sentence if a model-made image or sound is ever registered). No script, no cookie, no tracker, no request to any other origin. `node scripts/preview.mjs` serves `dist/` on :5190. `website.yml` builds, tests and keeps `dist/` as an artifact.
**Hosting options (NOT built, decide later):** Cloudflare Workers Static Assets (matches the Target above, free, custom domain), GitHub Pages (simplest, the repo is already there, no headers control), any static bucket behind a CDN. Whichever is chosen, set response headers `Content-Security-Policy: default-src 'self'; img-src 'self' data:`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; the page needs nothing else.

## Open finding: production persistence defaults to memory (answered, not changed)
`CAMPAIGN_STORE` defaults to `memory` and `render.yaml` sets neither it nor `IDENTITY_PEPPER`, so the interim Render deployment forgets every campaign on restart (and free instances sleep after 15 minutes). That is acceptable for the interim test deployment and WRONG for anything players keep: before a real playtest set `CAMPAIGN_STORE=file` (with `SAVE_DIR` on a persistent volume) or `postgres`, and a secret, stable `IDENTITY_PEPPER` of at least 16 characters (production refuses to start a file/postgres store without it). Whether to change `render.yaml` is the integrator's decision; it is not changed here.
