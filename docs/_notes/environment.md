# Environment upgrade notes (final pass on the toon/ink storybook world)

Working notes, not a decision record (BUILD_STATE.md / DECISIONS.md are the parent's). Everything below was rendered and looked at unless it says otherwise.
Screenshots of the review pass are in `test-results/art/envC/` (gitignored); the commands are in `docs/ART_DIRECTION.md` (World).

## What changed

### Shared (pure, server-safe, tested in Node)
| File | Change |
|---|---|
| `packages/shared/src/landscape.ts` (new) | The Observatory `HILL` (flat-topped, +10 m), the `RIVER` (meander, level table that never runs uphill, shallow ford + pond, `waterField`/`waterEdgeDistance`), the `TRAILS` (10 Chaikin-smoothed footpaths + `WORN_PATCHES`), `trailSample`/`trailProfile`/`patchProfile` (the ONE wear function the vertex paint, the baked overlay and the ground-cover mask all use), `nearTrail`, `withLandscape(base)` (hill + carved channel over the noise terrain). Cart ruts are two continuous ~0.4 m tracks (thinner broke into dots at the overlay's texel size). |
| `packages/shared/src/ruins.ts` (new) | `ruinPlan`/`ruinObstacles`: drum tower, 14-column colonnade (standing and snapped), aqueduct piers marching to the stream source. One plan feeds collision and visuals. |
| `packages/shared/src/daycycle.ts` (new) | `dayState(hours, out)` (allocation-free): sun/moon colour+direction, sky bands, glow, colour of distance, hemisphere, fog, night/dusk/stars/moon, fire level. Keyframes are PALETTE entries (`world.morning*/dusk*/night*`). Also `CLOCK`, `advanceClock`, `parseClock` (`?time=`). Light direction is continuous through twilight (a small weight sends it straight up while both lights are out); the moon fades in at its rise, not before. |
| `packages/shared/src/arena.ts` | Uses `withLandscape`; adds ruin obstacles; nothing tall on a path, in the stream, or on the plateau (also the outcrop centres, which were unchecked before: seed 1 put a boulder on the plateau); appends 16 stumps/logs with their own Rng after everything else (existing trees and rocks do not move). |
| `packages/shared/src/camp.ts` | Map table, lantern post, telescope, gramophone tea table, wash poles, hammock posts + hammock box, six hanging lanterns; all collidable where large. |
| `packages/shared/src/collision.ts` | `ObstacleTag` += ruin, table, scope, pole, hammock, stump, log. |
| `packages/shared/src/worldgen.ts` | `groundColour` paints paths/shoulders/ruts/bank/plateau; `coverDensity` respects paths, water, camp; `flowerPatch` (noise meadows with a dominant hue), `reedDensity`. |
| `packages/shared/src/palette.ts` | `world`: blooms (+violet, pink), fern, reed, cattail, cap/spot/stem, berries, log cut, strata, lichen, dust/worn/rut/trampled/mud/sand, water x4, hill trees x3, ruin x2, pollen/firefly/smoke/bird/moon/star, and 21 day-cycle keyframe colours. `camp`: map paper/wash/sea, cloth, horn, glass, lantern glow. |
| `packages/shared/src/index.ts`, `worldgen.test.ts` | exports; camp-clearance test covers the new tags. |
| Tests: `daycycle.test.ts` (9), `landscape.test.ts` (16) | day cycle finite/in gamut/inside palette chroma at 192 hours, continuous (colour, intensity, light), pure and wrap-safe; river anchors, monotone level, ford depth <= 0.62 m, walkable banks, a walker wades across and another climbs the Observatory path with the SHARED movement step; every path starts at a camp feature, the ways out reach the edge; no tall thing on a path/in water/on the plateau for 5 seeds; ruin plan == ruin obstacles; stump step-able, log jump-only. |

### Procedural
`packages/procedural/src/three/outline.ts`: `worldOutlineMaterial` (thinner, never grows close, eases with distance, shared per variant, optional displacement so a tree's hull sways with the tree), `instancedWorldOutline`, `WORLD_INK`, `isSharedInk`. **Bug found while testing:** `UniformsUtils.merge` clones uniform values, which froze the wind clock in the displaced hull (and the water/birds); displaced uniforms are now assigned by reference and `life.test.ts` locks that in. 3 new tests in `outline.test.ts`.

### Client, render
| File | Change |
|---|---|
| `render/Stage.ts` | Owns the clock (`?time=13\|dusk\|night\|17.5\|6:30`, `&drift=1`; default drifts from 09:00), lights everything from one `dayState` per frame, sun follows the sun by day and the moon by night, `followShadow` uses the live light direction, shadow strength 72%, sky drawn first (`renderOrder -10`), `setTime`, `setPushers`, new preset fields (clutter, treeLine, trailOverlay, waterFx, motes, butterflies, birds, smoke). |
| `render/world/WorldView.ts` | Rebuilt on `scatter.ts` plans: terrain (+trail overlay), skirt, hills + tree line, trees/rocks/slabs/timber/ground cover, camp, ruin, water + falls, ambient life; `applyDay`, `setPushers`, `update(t, camera)`. |
| `render/world/scatter.ts` (new) | Pure placement (no three.js): trees, far trees, shrubs, berry bushes, rocks, slabs, pebbles, stumps, logs, grass, daisies/cups in noise meadows (five hues), ferns, toadstool rings, reeds, butterfly centres. Off paths, out of water, clear of every obstacle. |
| `render/world/toon.ts` | Wind (`tree`/`grass`/`flora`/`reed`), pusher bend (uniform `vec4[4]`), campfire warm term, `tinted` (only petals take the instance colour), trail-overlay patch hook, sway-aware shadow depth and ink hull. |
| `render/world/flora.ts` | Stratified per-face-coloured boulders and slabs, daisy (8 petals) and cup (5) with stems and leaves, ferns, toadstools, reeds and cattails, stumps with tree rings, fallen logs, berry bushes. |
| `render/world/terrain.ts` | Trail mask bake (1024^2 R/G/B) and its shader patch (crisp earth, ruts, shoulders, hashed stones). |
| `render/world/horizon.ts`, `sky.ts` | Hill uniforms driven by the day; tree line instances; two cloud decks; moon, stars; clouds dim at night. |
| `render/world/water.ts`, `ambient.ts` (new) | Toon water ribbon + pond, the falls; pollen/fireflies, butterflies, birds, smoke/steam, lantern glow. |
| `render/world/ruins.ts`, `camplife.ts` (new) | The Observatory; map table, telescope, gramophone, washing line, hammock, lanterns. `kit.ts` gained `perFace` colouring (crisp masonry courses). |
| `render/world/atlas.ts` | The pinned survey map, drawn from the real trails, stream and hill. |
| `render/PropViews.ts` | Props use the medium scenery ink instead of the character ink. |
| `showcase/World.ts` | New views, `?time=`, `?push=`. |
| `game/Game.ts` | 6 lines: gather up to four upright walkers' x/z each frame and call `stage.setPushers`. |
| Tests | `scatter.test.ts` (8), `life.test.ts` (4), `WorldView.test.ts` (8, budget + pushers + every hour), `geometry.test.ts` (61: every builder finite/outward/carries onormal, hull no dearer and <= 6% proud, ruin, camp footprints). |

## Counts (seed 7, medium)
44 main-pass meshes, 262k triangles (low 31 / 133k, high 44 / 346k); with the shadow pass the SwiftShader capture reports 54 calls / 329k (low 41 / 199k, high 54 / 413k). Medium instances: 143 broadleaf/acacia (80 collidable, 63 far beyond the edge) + 3 snags, 33 boulders + 7 slabs, 214 pebbles, 10 stumps, 6 logs, 74 shrubs + 33 berry bushes, 5000 grass tufts, 553 daisies + 347 cups, 118 ferns, 108 toadstools, 240 reeds, 900 hill-line trees (561 conifers, 339 round), 12 butterflies, 6 birds, 22 smoke puffs, 700 motes. The world test ceiling went from 45 to 60 draws (34 on low) and from 130k/280k to 150k/300k/380k triangles; see PERFORMANCE.md for the itemised draw list.

## Decisions
- **The ford is decorative-shallow, not an obstacle**: the channel is carved into the shared terrain (so server and client heights agree), the bed is 0.55 m at most, and there is no wading rule. Nothing to keep in sync beyond the terrain function.
- **Stumps and logs ARE obstacles** (server and client build them in `createArena`, with their own Rng so no existing tree moves): step onto a stump, jump a log.
- **Time of day is client-side scenery.** Two players at different hours play the same game. It is cheap to make it a server-synced value later (one number in the room state feeding `Stage.setTime`).
- **Shrubs have no ink hull** and are double-sided: you can stand inside one and a hull seen from inside is a black screen.
- **Rock hulls are the same mesh**, tree hulls fatten <= 3.5%: a coarser/fatter hull read as thick black slabs at arm's length (was a 5-6% fat).
- **Shadow strength 72%** (`sun.shadow.intensity`): with a toon ramp the darkest lit step is far brighter than raw hemisphere light, so full shadows looked like holes in the masonry.
- **Uniforms shared by reference**, never through `UniformsUtils.merge` (see above).

## Weak spots (honest)
- Only ever rendered on SwiftShader; no GPU numbers, no fps claims. Shader cost of the wind/pusher loop (4 iterations in the vertex shader for 5000+ blades) is unmeasured.
- **In-game shots with the real server were not taken** (no server allowed here): everything was checked through `?showcase=world` with the four figures; the parent should look at `env.mjs` shots.
- The **menu and character creator drift through the day** too (they build a `Stage`); call `stage.setTime(13)` there if the creator should have stable light (`boot.ts` / `CreatorPreview.ts` are not mine).
- The clock is not synced between players.
- **Low preset**: paths are vertex-painted only (soft edges, no ruts, no stones), no ambient life beyond lantern glow, no water animation.
- Far round-crown hill trees read as pale hexagons in haze (conifers read well). The terrain-to-skirt seam shows as a flat band from the arena edge.
- The Observatory tower's doorway is blind (the collision is a solid drum) and the dome is only ribs; nothing to explore inside yet. The leaning slab rocks are large plain monoliths up close.
- Camp cloth (washing, hammock) and lantern chains do not sway; the wind only moves plants and trees. No splash, footprints or sound where the player wades.
- Butterflies (0.2 m wings) and birds are small and only noticeable when you look; pollen is faint by day by design.
- Grass bend is a fixed 1.5 m radius; only four pushers exist, which is all four players. NPCs will need to choose the nearest four.
- The trail mask is 4 MB and takes a few tens of ms to bake at world build.
- No `prefers-reduced-motion` handling for wind/ambient life yet.
- `packages/procedural` audit/rig tests and `Ragdoll.test.ts` fail in the working tree: characters stream, not this work.

## Registers
`docs/ASSET_REGISTER.md` still tells the truth (no external assets; the pennant, lettering and now the survey map are drawn on canvas at runtime in the bundled IM Fell fonts). Nothing here needs an entry in `AI_CONTENT_REGISTER.md` beyond code and in-game text authored for this pass (the map legend: "SURVEY OF THE INTERIOR (incomplete; the remainder to be improved)", "OBSERVATORY (ruins)", "THE FORD", "THE SEA").
