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

## Production build plan
Server: bundle `apps/server/src/main.ts` with esbuild (inline `@cb/shared`, external node_modules), run `node dist/main.js` in a
Node 22 slim image. Client: `vite build`, upload `dist/`; set `VITE_SERVER_URL=wss://<game-host>`.

## Open items before first deploy
Railway proxy `x-forwarded-for` handling for the code-lookup rate limiter; CORS/ALLOWED_ORIGINS enforcement on HTTP endpoints;
DB migrations from zero (M10); rollback runbook; cost baseline and measurements required before scaling.
