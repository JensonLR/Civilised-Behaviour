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

---

# 2026-09-30: weather, a shared clock, a walk-in Observatory, furniture and a flock

Second pass on the world, working the "weak spots" backlog above. Everything below was rendered and looked at unless it says otherwise; stills are in `test-results/art/envZ/` (gitignored):
`w-{clear,drizzle,storm,fog,dust,overcast}.png` (weather at noon), `g-{low,medium,high}.png` (presets, drizzle), `h1/h2-{edge,hills}.png` (the hills and the arena edge, before and after),
`r1..r6`, `z1..z3` (Observatory: door, dome, dark room, refractor), `s2-slab.png` (weathered slabs, lichen), `c1..c4`, `z4-flock.png` (well, pen, bridge, signpost, sheep), `n1..n7`, `t1..t5`
(storm at dusk, fog, night at the tower door with the lantern glowing through), `v1..v4` (pond with lilies, autumn regions).

## What changed
| Backlog | What was done |
|---|---|
| 1 warnings | `side: undefined` (toonMaterial passed it for single-sided materials) and `IcosahedronGeometry(...).toNonIndexed()` (polyhedra are already non-indexed) were the two sources. `WorldView.test.ts` now builds, animates and disposes the world on every preset with `console.warn`/`console.error` spied and expects none. |
| 2 shared clock | `WorldState` += `worldMs` (float64: the world's age, refreshed every 4 s and on join), `dayStartHour`, `dayMinutes` (append-only). `shared/daycycle.ts`: `worldHours(start, worldMs, dayMinutes)` (pure; dark hours 3x faster through a phase mapping), `WORLD_CLOCK`, `sanitizeDayMinutes`. Server: `DAY_START_HOUR` (default 9), `DAY_MINUTES` (default 30; 0 freezes), validated in `config.ts`, published through `roomConfig.ts`. Client: `render/world/skyclock.ts` (`SkyClock`: `?time=` > pinned hour > room clock > local drift) fed each frame by `Game` (`stage.syncWorldClock`). Menu and creator: `stage.setTime(13)` in `boot.ts`. Tests: `apps/server/src/rooms/clock.test.ts` (port 2591/2592: two clients join at different moments and compute the same hour/weather; the age refreshes unasked; config), `daycycle.test.ts`, `skyclock.test.ts`. |
| 3 weather | `shared/weather.ts`: `weatherAt(seed, timeMs)`, `lightningAt`, `applyWeather`, six states, 2.5 min slots, 20-40 s blends, always clear at the start, wetness from the last ~90 s of rain, lightning in 6.5 s windows with thunder 1.4-7.9 s behind the flash. Client: rain pool (`world/rain.ts`), puddles + wet darkening (`toon.ts`), sky (cover, dark thunderheads, jagged bolt, flash), fog and dust through the colour of distance, hill fog, wind gain. `world/atmosphere.ts` `getAtmosphere()` = `{ rain, wind, thunderAt, hour }` (+ wet, fog, overcast, storm, dust, flash, kind); `thunderAt` is on the `performance.now() / 1000` time base. Low = tint and fog only. Tests: `weather.test.ts` (13). |
| 4 hills | The innermost ring now starts at ground level with a meadow-green foot, its painted haze is capped by the real fog at the camera's distance (no more flat grey band), and the weather's fog swallows the hills. Tree line: lumpy four-lobed broadleaves and three-tier pines with bark-brown trunks, vertical shading, whole autumn hillsides. **Bug found:** `FogExp2` keeps its own copy of the colour, so `Stage` had been updating the background but leaving the FOG noon-cream all day and night; fixed (`fog.color.copy`). |
| 5 Observatory | The drum is built from courses of stone blocks with a real doorway (collision: a ring of 13 wall boxes + a plinth, agreeing with the visuals; tests walk a character in and out with the shared step and rays through the door), a plank door ajar, a dark round room with a flagged floor, an armillary sphere and a lantern (glass + glow, bright even at noon), a copper dome (14 ribs, 56 thick plates of verdigris/copper, an observing slit, a fallen-in back, an open oculus), the Great Refractor on a stone pier, vines. Slab rocks: strata, seams, frost cracks, moss caps and drips, orange lichen rosettes, an overhanging capstone. |
| 6 cloth and motion | `camp-cloth` mesh (`aSway` weights; mesh, shadow and ink hull sway together) for the washing, the hammock canvas and the lanterns' chains, frames and glass; the glow points and the pennant follow the wind. `atmosphere.ts` `motionScale`: `prefers-reduced-motion` -> 0.3, `?motion=0..1` overrides; it scales wind gain, butterflies, birds, motes. |
| 7 menu | `stage.setTime(13)` in `game/boot.ts` (one line); the room's clock takes over on join. |
| 8 clearing | `shared/clearing.ts` (well, pen + gate, four signposts computed from the trails, a plank footbridge on a new `footbridge` path over the stream, ford stepping stones), `shared/fauna.ts` (routes fixed by the world, pose a pure function of the world clock), `world/clearing.ts`, `world/animals.ts`, flagstones in `scatter.ts`. Trampled rim in `groundColour`, worn patches at the well and the gate. |
| 9 vegetation | Birch and pine species (`treeSpecies` is now four-way), `autumnAt` regions (trees, shrubs, grass, hill trees), lily pads, orange lichen on boulders, vines on the ruin; placement tests extended (flagstones on the ground / in the water, clearing furniture overlapping nothing on any of 5 seeds, animals never inside an obstacle or the water for 2 minutes on 4 seeds, sheep stay in the pen). |
| 10 presets | See `docs/PERFORMANCE.md` (2026-09-30). Low: 46 calls / 228k tris in the software capture, 34 main-pass meshes. |

Also: the campfire's pool of light now lies on the ground (its plane used to be clipped by every swell into a hard ellipse); a latent scatter bug (grass on the bare middle of a faded far path) surfaced when new obstacles shifted the random stream and is fixed.

## Decisions
- **The clock is a pure function of a server-owned age**, not a ticking counter in the state: one number every 4 s, nothing per frame, and weather needs no messages at all. The cost: clients trust a value up to ~one patch old at the instant of a refresh (latency-sized jitter, invisible at 100 s per game hour).
- **The Observatory's tower is a ring of wall boxes, not a solid drum**, because a doorway you cannot use is a lie. It is the only walk-in interior so far (13 boxes, one plinth).
- **The bridge is a footbridge on its own path**, not over the ford: the Observatory path runs ALONG the stream's source for 8 m, so no bridge fits it. The ford gets stepping stones. The deck is a walkable box obstacle (walkers step onto it like a crate); handrails are boxes on the middle spans.
- **Animals are scenery**: routes are validated once per world (clear of obstacles and water, straight legs), positions are a function of the clock. Nobody collides with a sheep. If they ever need to react to players, that is a server feature.
- **The clearing's furniture is added to the arena LAST** and removes the few trees/rocks/stumps that would stand inside it, instead of being placed first: placing it first shifted the random stream and moved the whole forest, which broke the combat test that fires the cannon along a fixed line (`combat.test.ts` "a loaded gun fires a heavy ball"). Existing trees and rocks keep the places they had.
- **Low keeps the same draw ceiling**: birch/pine stand as broadleaf/acacia, no rain/puddles/lilies/flock/hulls.

## Weak spots (honest)
- Still only rendered on SwiftShader; no GPU numbers, no fps claims. The puddle fragment code (dFdx flatness, hashed noise), the rain vertex shader and the animal vertex animation are unmeasured on a real GPU.
- **Never seen with the real server.** Everything was checked through `?showcase=world`; the room-clock hookup in `Game.ts` is covered by the server integration test and `skyclock.test.ts` but nobody has watched two browsers share a storm. (The `env.mjs` shots need a server on :2567, which I was not allowed to start.)
- Lightning was checked as stills (the bolt and the flash frames) and by tests; the stutter/decay timing is unseen. Thunder has no sound until the audio agent reads `thunderAt`.
- The autumn shade on leaves in shadow goes very dark (undersides of turned crowns read near-black maroon); a tone curve or a lighter shadow lift would help.
- Puddles glint hard at low sun (the sun's reflection fills the whole pool); rain has no splashes on the ground or on the water, no footprints, no wading sound.
- Fog banks are uniform exponential fog, not drifting banks; dust is colour and density plus the existing motes, no blown grit.
- The Observatory's interior is one small room: no stairs, no upper floor, nothing to interact with. The refractor and armillary are dressing. The dome's plates are flat-shaded plates without rivets. The tube of the refractor is huge on purpose but its ink hull goes black when the camera is inside it.
- A stray black cap on grazing sheep seen from behind is the head over the back with its ink hull; funny, not wrong, unfixed.
- The room clock resets the world's age when a room is recreated (worlds do not persist yet); when campaigns persist, `worldMs` must be stored with them.
- One `WorldView` build is now 0.6-0.7 s on medium (Node, warm): the block-built tower, the dome and the clearing. Not a frame cost, but worth watching if the world is ever rebuilt live (`Stage.setPreset` does).
- `packages/procedural` `weaponPose.test.ts` fails in the working tree (a character/combat change, not this work).
