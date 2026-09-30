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

---

# 2026-09-30 (third pass): Hollowmere, the HQ marquee, the waterside, ground and sky polish, wildlife

Judged by looking. Stills are in `/tmp/claude-0/shots/` (not in the repo): `fin_v{7,12,18,21}` (the village at dawn, noon, dusk, night), `fin_{low,high}`, `fin_{rain,fog,storm}`, `duck5` / `deer1` / `cat1` / `dfly_9000` (the wildlife), `mud3` (tracks in mud), `gold_16.8` / `gold_17.8` (the golden hour), `sh_{8,16.8}` (canopy shafts), and earlier `sky` studies at 6.3 / 9 / 16.5 / 18.4 / 19.4 / 21.5 / 0.5.
Everything below was rendered on SwiftShader (software GL); there are no GPU numbers.

## What was built
| Item | What |
|---|---|
| Village | `shared/village.ts`: ONE pure plan `villagePlan(terrain)` (WeakMap-cached, no `Math.random`, no seed) feeds collision (`villageObstacles`), client geometry, keep-outs (`villageKeepOut`, `villageYard`, `villageCobble`, `villageGarden`) and the ground pads (`VILLAGE_PADS`). 15 sites, 8 kinds: gate tower with a working clock (hands turn in the vertex shader from `uHour`), 3 cottages (tile, shingle, thatch), 2 stilted river houses (stairs adapt to the ground), 2 round-roofed granaries on mushroom stones, a terraced meeting hall, a smithy with chimney smoke, a water mill (the wheel turns, dips and splashes), 4 market awning stalls; streets (late trails), fences, gardens, washing lines, drying racks, a well, carts, crates, barrels, lanterns that light at dusk, 12 authored signs. Doors are real openings with dark interiors and walkable thresholds; walls are solid boxes (tests walk through every door and arch with the shared movement step). No villagers yet. The cat is one. |
| HQ | `CAMP.hq` + `hqPlan()` in `shared/camp.ts`, `world/hq.ts`: a striped pavilion (open front and south, canvas on the back and north) with flags, poles, lamps, a map table (moved to z = -7), chairs, chest, a supply pyramid with barrels, crates with stencilled text, a notice board and the Society's heraldry. Cloth is part of the swaying camp cloth mesh. |
| Waterside | A plank jetty on the pond's north shore with a moored punt that bobs (vertex kind 3), reeds, stepping stones across the stream, a timber weir with a walkway and a chute (`uWeir` in the water shader: sheet, boil of foam), lapping wavelets, wheel and punt splashes (`uSpots`), a mill wheel. `landscape.ts` exports `WEIR`, `MILL`, `JETTY` for the audio agent. |
| Ground | Macro tone variation, trampled ground, gravel on paths, mud belts by the water (`mudBelt`), cracked clay (`crackNoise`/`crackPatch`, voronoi cracks in the shader), flower-meadow lift, leaf litter under crowns (`CanopyIndex`), plaza cobbles; a second baked 320^2 RGBA detail texture (R litter, G clay, B mud, A cobbles) beside the 1024^2 trail mask. Tracks in the mud (short trails of paired prints, a hashed cell each). |
| Land | 10 crags per seed (`cliff` obstacles + `cliffGeometry` strata and ledges + a boulder field each), a windmill on a second summit (SW) and a distant snow range with layered haze, both inside the hills mesh (no extra draw; camera far = 820), valley mist at dawn (`mistLevel`, `uMist`). |
| Sky and light | Sunset silhouettes and cloud bellies, a warmer/cooler grade per hour with a **golden-hour stop at 16.6** (top still blue while horizon, glow and sun are well into dusk: a straight fade turned the whole dome violet by 16.8), two star layers and a milky band, shooting stars, **moon phases** (`worldDay`, `moonPhase`, `?moon=0..1`; moonlight scales with the phase), cheap canopy sun shafts (one instanced draw, fade with cloud, rain, night and high sun), lit windows at dusk (in the lantern-glass mesh, `aLit`). |
| Wildlife | `shared/fauna.ts`: ducks (4, open water of the pond, routes checked against the jetty and piles), deer (2 + a stag with antlers) at the forest edge east of the camp, and the village cat (naps near the granary by day, curled on the granary steps from 21:00 to 06:00; `sleepWeight`). Pure poses from the world clock and the hour. Client `world/animals.ts`: two instanced meshes (livestock; wildlife), each ONE geometry holding every species of its group with a per-vertex `aKind` and a per-instance `aSpec` (a vertex of another species collapses to nothing), the same vertex animation (legs, bob, head dip, per-species neck root, curl) for the mesh, the shadow and, through a new `pre` hook on `OutlineDisplace`, the ink hull. Ducks ride the pond's surface. Swallows are extra low, fast instances of the bird mesh (`aSwallow`); dragonflies are extra instances of the butterfly mesh (`aFly`: hover, then dart along the stream). No extra draws. |

## Numbers (medium, seed 7, Node, `WORLD_STATS=1`)
Main-pass draws: low 36, medium 64, high 64 (was 34 / 60 / 60 before this pass; the brief was "about 70 or fewer"). Triangles: low 180k, medium 420k, high 525k. Ceilings in `WorldView.test.ts` moved to 37 / 66 draws and 195k / 430k / 540k triangles with the reasons written there and in `docs/PERFORMANCE.md`. Build time of one medium `WorldView`: ~1.2-1.35 s of CPU in a loaded 4-core sandbox (load average 12), ~1.0 s when idle. `weldedOutlineNormals` (kit.ts, typed hash instead of a string key per vertex) cut the village build from 245 ms to 140 ms.

## Decisions
- **One plan feeds everything.** Collision, geometry, keep-outs, ground pads and the atlas signs all read `villagePlan`. Adding or moving a building is one edit and the tests (no overlap, roads clear, doors walkable, walls solid, dry ground, level pads, parity) fail if something disagrees.
- **Existing forest never moves.** The village is appended to the arena after everything else; crags have their own Rng (`seed ^ 0xc1a6`); the village removes what stands inside it via `clashesFurniture`. Client scatter (flowers, ferns, pebbles, bushes) now also avoids the village keep-out, which does reshuffle those plants after the first rejected position (visual only, never on the server).
- **Pads level the ground under buildings** (`withLandscape(base, pads)`): level = mean of the ground samples, blend stretched to `4.2 * diff` on slopes, small pads weigh more than big ones. Cliffs and sloping floors under buildings were the failure of the first attempt.
- **Species share one draw by collapsing.** A vertex-shader `transformed = vec3(0)` for the other species costs vertex work, not fill, and keeps the draws at 4 for all five species (it was 4 for two). It also means `stats.triangles` counts the collapsed triangles.
- **Tracks in the mud are static.** A hashed pattern in the ground shader where the mud channel is high, not a record of where animals actually walked.

## Weak spots (honest)
- **SwiftShader only.** No GPU frame times. The ground detail shader (voronoi cracks, cobbles, litter flecks, tracks), the mist chunk in every toon material, and the sky's star layers are unmeasured on hardware.
- **The dragonflies are small and were seen once** (`dfly_9000`); they sit near the stream and are easy to miss. Swallows were checked by tests (attributes, determinism) and in the render stats, not judged in a still.
- **Mud tracks** appear only in the mud belt and are round dots at a distance.
- Animals do not react to players and leave no real tracks. The deer are not driven off by the camp; ducks do not dive.
- The collapsed-species approach makes `livestock` (16k) and `wildlife` (13.5k) triangles look bigger than what is rasterised.
- The `hill-foot` slopes on hostile seeds: pads guarantee level building floors on seeds 1, 7, 42 and 1234 (tests), not on every seed.
- Only one garden survives (the cot-a garden was removed because the weir walkway lands there).
- `ballistics` has a flaky ray test against grazing terrain in the working tree (passes on re-run); not touched.
- The village has no villagers, no interiors beyond a dark room behind each door, and no sound (the audio agent reads `WEIR`, `MILL`, `JETTY` from `landscape.ts`).
- Build time is at the edge of the 1.2 s target on a loaded machine (terrain 0.2 s, ground masks 0.15 s, village 0.14 s).

## Registers
Authored in-game text (village signs, notices, crate stencils, heraldry motto) is drawn at runtime on a canvas in the bundled IM Fell fonts; it is original satire written for the game and needs no external-asset entry. `docs/ASSET_REGISTER.md` still tells the truth: no external assets.

---

# 2026-09-30 (fourth pass): Villagers, Hollowmere's folk

Judged by looking (stills in `/tmp/claude-0/shots/folk/`, not in the repo: `cast0..3` the cast in their trades, `d_smith`, `d_fisher`, `d_keeper`, `d_clock`, `d_garden`, `d_bee`, `c_baker`, `c_elder`, `c_ferry`, `c_laundry`, `d_watch`, `d_rain`, `d_dusk`, `d_dawn`, `d_night`, `v1`, `v2`). Software GL only; no GPU numbers.

## What was built
22 ambient, non-interactive, non-colliding people who keep the village's hours. **No server work, no messages:** every client computes the same people in the same places from the world clock (`worldMs`, the hour of day, and the weather that follows from the room seed).

| File | What |
|---|---|
| `shared/villagerNav.ts` (new) | The walking network: the village's own trails (street, lanes, doorstep lanes, the fishing path) as nodes, a 2 m grid over the village core for plaza/yards/gardens (dearer to route over, so people keep to the street when the detour is small), 80 named **stations** at real features of `villagePlan` (each door and the room inside it, the well, four bench seats, the hall porch benches, four stalls with seller and customer spots, the jetty, the weir walkway, the anvil, the trough, the mill yard, the gate, gardens, washing lines, hives, ten lamp posts, six conversation spots). Every station, edge and route sample is validated against the SAME `CollisionWorld` the players use (`standingHeight`: nothing solid in the way, stairs/decks/jetty/weir walkable under the shared step rule, out of the water); what fails is dropped and the schedule falls back. Routes are resampled every 0.5 m with the ground height a walker would follow (stairs become a ramp), corners rounded, with how far a walker may stray to either side (they keep to the right of the road). |
| `shared/villagers.ts` (new) | The roster from the world seed (names from invented pools, 17 trades across 22 people in 7 households: Keeper of the Hours, miller, smith, baker, ferryman, clockkeeper, registrar of non-events, three sellers, fisher, gardener, beekeeper, laundress, lamplighter, warden, night watch, two elders, three children), and `villagerAt(folk, i, clock, out)` -> position, height, facing, speed (m/s), activity, what is carried, visible/indoors, conversation partner. A day is a ring of **stints** (arrive at a station at an hour, do something, optionally loop to a second station: sacks from the pile to the cart, water from the well) with walks timed to arrive on time; speeds are plain (1.25 m/s x the person's pace), eased in and out. Pairs **meet** at conversation spots (face each other, 0.4 m to 2.4 m apart). **Rain** sends people who work in the open under a roof (nearest awning, the gate's arch, the smithy, the hall porch) or indoors (children, elders, fisher, gardener, beekeeper, laundress, ferryman, lamplighter): whether a stint is rained off is decided from the weather at its arrival (stints are cut to <= 0.8 h so a shower is noticed within a minute), which keeps every position continuous in time. `villagerSays` picks the speech from the trade's pool, the general pool, the weather or the hour, by hash, so everybody reads the same slip. |
| `shared/villagerLines.ts` (new) | 89 authored lines: gentle satire of forms, surveys, "improvement", timetables and tourism, kind to the villagers ("Tuesday, again. It is always Tuesday at the market.", "Do sign the visitors' book. We press flowers in it.", "Nothing to report. Nothing to report is a great achievement."). A test scans every line for real nations, peoples and faiths. |
| `render/world/villagers.ts` (new) | The crowd: ranks the people the schedule says are outdoors by distance and dresses them inside a **budget** (`FOLK_BUDGETS`: head count, per-level caps, triangle ceiling, distances; `planLods` is pure and tested), builds bodies on demand one at a time, reacts to players (heads follow you inside 9 m, a wave and a greeting slip when you come near an idle villager, somebody in your way steps aside if the ground beside them is fair), and runs the overlay. `noteFolk(seed, dayMinutes, layer, camera)` is the one call `Game` makes. |
| `render/world/villagerPose.ts` (new) | `FolkBody`: rig + animator + hand poser + props. The animator owns the pose each frame, so the trades run AFTER it: hand targets in the torso frame turned into shoulder/elbow angles by the weapons' `solveArm`, a torso lean and a head tilt. Sweep, hammer, scrub, hang washing, tend (bent double), hive, fish, read/write, sell, ring, look up, draw water, light the lamp, lift a sack, chat (gestures while a slip is up), lean/fold arms, sit (thighs level, feet found from leg length), play (hop). Carrying: sack, basket (pears, loaves, washing), crate of fish (the shared crate prop), bucket, lantern, book, bottle (shared prop), chair (shared prop). Rain: an umbrella or a hand over the head. Canes for the old. |
| `render/world/villagerProps.ts`, `villagerLooks.ts`, `villagerOverlay.ts` (new) | Palette-only merged prop geometries (one per prop, shared); the costume of each trade by catalog NAME in the village's dyes; pooled DOM name tags (`.nametag`) and telegram slips (`.folk-say`, injected CSS on the interface's variables). |
| `render/world/WorldView.ts`, `game/Game.ts`, `showcase/World.ts` | WorldView: `addFolk` (the crowd is created with the world, built on first update), walkers fed to it from `setPushers`, `folkView`. Game: one line next to `syncWorldClock` (`noteFolk`). Showcase: `view=folk|folkplaza|folkgate|folkmill|folkjetty|folkwell|folkcast`, `who=<id|trade>` (follow one villager), `tags=1`, `folkbudget=review`, `castFrom/castN/castGap`. |

## Numbers
Schedule: network + roster 0.25 s once, `villagerAt` ~2 us a person. Crowd: steady 0.2-0.3 ms a frame in Node; medium draws at most 14 people (~58k triangles, ~232 meshes), low 6 (~24k), high 18 (~92k). See `docs/PERFORMANCE.md` (Hollowmere's folk) and `scripts/folk-bench.ts`.

## Decisions
- **Pure schedule, not simulation.** Nothing is replicated; the price is that nobody reacts to anything but the clock and the weather (the players' cosmetic reactions are local and change no state).
- **They are scenery: nothing shoots them.** Villagers exist only in the client's scene graph; there is no server entity, no hitbox, no collision body, and hit resolution (server-side, against players) never sees them. Shooting them is **not implemented**. If they ever become targets or witnesses, that is a server feature (an entity per villager with the same `villagerAt` as its position).
- **Validation is against the shared collision world** (`standingHeight`), at build (every edge, station, route sample) and in tests (every position of every person for the whole day on six seeds, dry and in a downpour, with an independent checker).
- **Rain is decided per stint at its arrival.** Continuous movement beats instant reaction; the instant part (umbrellas) is cosmetic on the client.
- **Loops and commutes keep one pace for their whole length** (an hour's real length is fixed at the start of the stint), so nobody changes speed where the clock does (dusk, dawn).

## Tests
`shared/villagers.test.ts` (12): roster size/determinism/uniqueness, a bed and a workplace for everyone on six seeds, key stations reachable, **no position inside a wall, prop, counter or water at any hour, dry or in rain, six seeds**, never a jump or a speed above 3.4 m/s (also over an hour of changing weather, three weather seeds), nights empty and days full, rain moves the open-air workers, friends face each other, determinism and cost, speech is authored/deterministic/clean. `client/render/world/villagers.test.ts` (13): the LOD/cap/triangle plan, hysteresis, looks (valid, distinct, skin spread, no real-people costume pieces, trades read as trades, children small, the old grey), every prop builds sane geometry, every activity x carry x body type x level poses finite joints (a seat sits), tool trades hold their tool, the crowd builds/animates/disposes with `console.warn/error` spied, presets differ, rain/visitor reactions, and no retained memory over 600 frames.

## Weak spots (honest)
- **Only rendered on SwiftShader. Never seen in the real game with a real server** (I was not allowed to start one): the Game hook is one line and typechecks, the showcase drives the same code through the same WorldView.
- **Draw calls.** A person is 11-37 unmerged meshes; 14 people in the village core is ~230 main-pass meshes plus shadow casters. Merged LOD1 / instanced LOD2 (already the open item under characters) is the real fix.
- **Geometry cache thrash.** `rig.ts` keeps 512 bone geometries; 22 people at three levels need ~800, so crossing the village rebuilds people (6-40 ms hitches). Not mine to change (rig.ts is agent R's); raise `MAX_CACHE` or key it by live rigs.
- Cold body builds are 10-50 ms; they are spaced >= 140 ms apart and start at the distance the plan says, so a player who runs straight at the gate sees people pop in over a couple of seconds.
- No faces while talking: there is no public mouth control except expressions (which also move the body), so a talker gestures and bobs but the mouth stays shut.
- The night watch's lantern is an unlit yellow box with no halo; lit at dusk by the day cycle only as far as the lamps are. No window/lamp sync with the lamplighter (he walks the lamps at dusk; they light on the day cycle's own clock).
- Sitting feet dangle on short legs (charming on children, odd on a few adults); hands on knees are IK targets, not checked for clipping against coats.
- The hammer's and broom's grip orientation is approximate (a fist's axis is fixed across the forearm); the stroke reads from three metres, not in a macro.
- Day lengths far from the default 30 minutes make walkers hurry or dawdle (walk time is in game hours, clamped); a frozen clock (`dayMinutes = 0`) freezes everybody mid-stride.
- Review cameras (`who=`) can still end up behind a wall; the showcase tries ten angles and three distances but not line of sight.
- Weather for the schedule is the room's (seed + world age); `?weather=` forces it for the folk too (read from the URL), but a live change of `uRain` alone (tests) only moves umbrellas.
