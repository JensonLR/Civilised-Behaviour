# Deployment

Status: interim test deployment on Render (free plan, see D-011). Railway/Cloudflare/R2 plan below is the intended production target and is not built yet; no Dockerfile exists.

## Interim: Render (D-011)
Free plan, Frankfurt, both pairs auto-deploy every push to `claude/civilised-behaviour-architecture-jtce2l`; config mirrored in `render.yaml`. Free instances sleep after ~15 min idle: WebSockets drop and the next connection cold-starts (~30-60 s). Test use only; move to an always-on plan before any real playtest.

### The play link (created 2026-10-01; this is the pair to hand out)
| Service | Type | URL | Render id | Health check |
|---------|------|-----|-----------|--------------|
| civilised-behaviour-server | Node web service | https://civilised-behaviour-server.onrender.com (`/health`, `/metrics`) | srv-dave76id0e5s73flf2u0 | `/health` (set by the owner 2026-10-03, read back from the Render API) |
| civilised-behaviour | Static site | https://civilised-behaviour.onrender.com | srv-dave78id0e5s73flf9u0 | n/a |

The client is built with `VITE_SERVER_URL=wss://civilised-behaviour-server.onrender.com`.

**The older duplicate pair is gone.** `cb-server` and `cb-client` (created 2026-09-29, same branch, nothing linked to them) were deleted by the owner in the dashboard on 2026-10-03 (checked through Render's API: only the pair above remains for this repo; `/health` 200 and the client 200 afterwards). Every push now builds two services, not four.

**Verified (2026-10-02, after the PR #1 merge deployed):** `/health` 200; matchmaking `POST /matchmake/create/world` works; the `wss://` upgrade answers 101 and streams state to curl; and **two real Chromium sessions played together on the live game** through the play link: `scripts/deploy-smoke.mjs` (run as `NODE_USE_ENV_PROXY=1 CB_WS_RELAY=1`) founded expedition 5G53V in one browser (42.9 s including a cold start), joined it by code in the other, and each saw the other in the Hollowmere camp (screenshot looked at).
**Why the relay:** in the Claude Code cloud sandbox, the browser's own `wss://` upgrade gets **404 from the sandbox's intercepting proxy** (`127.0.0.1` answers; `/root/.ccr/README.md` lists WebSocket upgrades as unsupported), while a CONNECT tunnel (curl, Node) is fine. It is not the deployment: the server logs the room as created, and Colyseus's transport never answers 404. `CB_WS_RELAY=1` hands the page's socket to Node's WebSocket, which tunnels through `HTTPS_PROXY`. A normal browser needs nothing.

**Known gaps:** `ALLOWED_ORIGINS` is enforced (see NETWORKING.md); the Electron build's renderer origin must be added to it when that app exists. First request after idle cold-starts the instance.

## Target
- Web + demo: Cloudflare Workers Static Assets; large assets on R2 behind a custom asset domain (not r2.dev), immutable hashed filenames.
- Game server: Railway, single Node process hosting many 1-4 player rooms + PostgreSQL. No Redis until measured load needs multiple processes.
- Staging + production environments; health endpoint `/health` (exists); graceful shutdown (Colyseus `gracefullyShutdown` enabled).

## Server env (validated in `apps/server/src/config.ts`)
`NODE_ENV`, `PORT` (default 2567), `LOG_LEVEL`, `ALLOWED_ORIGINS` (required in production), `DATABASE_URL` (optional until M10),
`SIMULATED_LATENCY_MS` (must be 0 in production), and the abuse limits (D-048; see NETWORKING.md): `TRUST_PROXY_HOPS` (production default 1),
`CLIENT_IP_HEADER` (on Render: `true-client-ip`, set in `render.yaml`; Render's right-most forwarded entry is a Cloudflare edge, D-050), `ROOM_CREATE_BURST` / `ROOM_CREATE_EVERY_S` (production default 6 / 20 s; 0 turns it off), `MAX_ROOMS` (production default 40; 0 = no cap).

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
| `CB_SERVER_URL` | http(s)/ws(s) address of the game server. Default `https://civilised-behaviour-server.onrender.com` (the interim test server above). Also fixes the CSP `connect-src` and the request filter |
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
