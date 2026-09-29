# Changelog

## Unreleased
### Added
- World art pass (D-025): the environment shares the characters' toon + ink look. Painted terrain, hill rings and ground skirt past the arena edge, painterly sky with sun disc, three tree species, faceted rocks, shrubs, wind-swept grass and flowers, and a collidable expedition camp at the spawn (bell tents, campfire, Society pennant, signpost, luggage, supply cart, ruined wall). Instanced outlines, detailed crates/barrels/bottles/chairs, `?showcase=world` review scene.
- Faces rebuilt as one sculpted skin (brow, sockets, cheeks, lips, chin) with swept noses/moustaches/beards, shell hair, cupped ears, catch-light eyes, a real mouth with teeth and tongue.
- One shared game palette (`palette.ts`) driving characters, terrain, props, effects and UI, with art-direction tests and `docs/ART_DIRECTION.md`.
- Character rebuild: lofted torso, sleeves, trousers, coats and boots (real clothing forms), toon lighting, chunkier boots and hands, jacket details (lapels, epaulettes, braces, belts, pockets). Fewer triangles than before.
- Wounds (zone + severity, server-owned) with bandage/plaster/stain visuals, limp and flinch, hit particles and ground stains, HUD injury chart, Gore Full/Reduced/Off.
- Client-side Rapier ragdoll for knock-downs (capped, tethered, blends back to the lying pose); `@cb/physics` shared package.
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
