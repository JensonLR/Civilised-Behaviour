# Changelog

## Unreleased
### Added
- Character art polish: silhouette outlines (per-preset), baked clay shading, rebuilt heads and faces, fist hands, teeth, more hair/beard/moustache/hat options.
- Downed state, timed revive, dragging a downed teammate, and a party rout; wounds HUD and animations.
- Server input budget closing an input-flooding speed hack (3.0x -> ~1.03x).
- Procedural caricature character system, creator UI with 3D preview, server-owned campaign history.
- Server-authoritative Rapier props: pick up, carry, drop, throw.
- Monorepo scaffold (pnpm, TypeScript 7 strict, Vitest, Playwright, CI).
- Shared deterministic movement sim, terrain, analytic collision, seeded RNG.
- Colyseus WorldRoom: authoritative movement, private campaigns with join codes, reconnect window, metrics, health.
- Three.js client: instanced arena, sky/fog/shadows, third-person camera, KBM + gamepad controls, prediction + interpolation,
  performance overlay, menu (create/join), stand-in articulated puppet.
