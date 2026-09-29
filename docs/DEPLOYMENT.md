# Deployment

Status: DRAFT design - nothing deployed yet. No Dockerfile / Railway config / Cloudflare config exists in the repo yet (M13).

## Target
- Web + demo: Cloudflare Workers Static Assets; large assets on R2 behind a custom asset domain (not r2.dev), immutable hashed filenames.
- Game server: Railway, single Node process hosting many 1-4 player rooms + PostgreSQL. No Redis until measured load needs multiple processes.
- Staging + production environments; health endpoint `/health` (exists); graceful shutdown (Colyseus `gracefullyShutdown` enabled).

## Server env (validated in `apps/server/src/config.ts`)
`NODE_ENV`, `PORT` (default 2567), `LOG_LEVEL`, `ALLOWED_ORIGINS` (required in production), `DATABASE_URL` (required in production),
`SIMULATED_LATENCY_MS` (must be 0 in production).

## Production build plan
Server: bundle `apps/server/src/main.ts` with esbuild (inline `@cb/shared`, external node_modules), run `node dist/main.js` in a
Node 22 slim image. Client: `vite build`, upload `dist/`; set `VITE_SERVER_URL=wss://<game-host>`.

## Open items before first deploy
Railway proxy `x-forwarded-for` handling for the code-lookup rate limiter; CORS/ALLOWED_ORIGINS enforcement on HTTP endpoints;
DB migrations from zero (M10); rollback runbook; cost baseline and measurements required before scaling.
