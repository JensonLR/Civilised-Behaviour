# Civilised Behaviour (working title)

A 1-4 player cooperative third-person expedition sandbox with systemic strategy underneath and a mean streak of satire.
Grotesque caricature explorers, physical co-op chaos, a colonial campaign that remembers what you did.

> **Mature content** - strong violence, coarse language, dark political satire. All cultures depicted are fictional.

**Status:** early development (M0/M1 foundation). See [`docs/BUILD_STATE.md`](docs/BUILD_STATE.md) for exactly what works.

## Quick start

Requirements: Node >= 22.12, pnpm 10.

```bash
pnpm install
pnpm dev            # game server on :2567, client on http://localhost:5173
```

Open two browser tabs: create a campaign in one, then join with the 5-character code (or the invite link) in the other.

```bash
pnpm typecheck      # strict TypeScript, all packages
pnpm test           # unit + Colyseus integration tests
pnpm e2e            # Playwright multi-client browser tests
```

Controls: WASD move, Shift sprint, Space jump, C crouch, mouse look (click to capture), F3 performance overlay.
Gamepad: left stick move, right stick look, A jump, B crouch, L3 sprint.

## Layout

See [`CLAUDE.md`](CLAUDE.md) for the repo map and rules, and [`docs/`](docs) for design, architecture, networking and release docs.

## Licence

Proprietary - all rights reserved (source is not open). Third-party notices: [`docs/ASSET_REGISTER.md`](docs/ASSET_REGISTER.md).
