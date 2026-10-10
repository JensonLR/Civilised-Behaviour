# Art direction

The look in one line: **a late-Victorian illustrated adventure, built from clay-like figures** - warm, slightly dusty colour, deep plum-brown
shadows, one ink line round everything, and faces that are designed rather than assembled.

## Pillars
1. **Silhouette first.** Every character reads at 30 m from its outline alone: hat, nose, belly, coat, boots. The outline (`PALETTE.ink`) is the only
   pure-dark colour in the game.
2. **One palette.** Every colour in the world and the interface comes from `packages/shared/src/palette.ts`. Nothing else may contain a colour
   literal (a test scans the rendering code). Adding a colour means adding it to the palette, where the rules below are enforced.
3. **Warm shadows.** Shadows are plum-brown (`light.bounce`), never grey or black; lighting is a 4-step toon ramp so form reads as clean bands.
4. **Faces are sculpted, not stacked.** One continuous skin surface with real features (below). Anything that sits on a face is *placed by asking the
   skin where it is*, so nothing floats or sinks.
5. **Gore is a style, not the message.** Dressings, plasters and posture say "hurt"; gore only recolours and adds mess (Off = iodine and grime).

## The palette and its rules (enforced by `palette.test.ts`)
- **Ink** is the darkest colour in the game; no material is darker or pure white.
- **Muted, not neon:** each group has a chroma cap (terrain/props 0.40, cloth 0.50, skin 0.40, metals 0.60).
- **Skin:** eight tones in one warm hue family (14-34 degrees), light to deep; blush, eye-socket shade and lips are *relative shifts* of the tone
  (`skinRamp`), never separate colours, so dark skin gets a rich warm cheek and pale skin a soft pink.
- **Cloth:** twelve dyes, each distinguishable from every other (RGB distance > 28), all muted Victorian.
- **Outline contrast:** the ink line reads on every surface (contrast > 1.6).
- **Gore Off contains no red:** stains are iodine and grime; hit particles are dust. Full and Reduced are the same red family, Reduced less saturated.
- **UI:** text on paper >= 7:1, primary button text >= 4.5:1, borders >= 3:1. The interface colours are published as CSS variables at startup
  (`--ink`, `--paper`, `--brass`, `--stamp` ...) so the menus and the 3D world share a palette.

## How a face is built (`packages/procedural/src/three/`)
- `headShape.ts`: the skin is a function `r(direction)`: an egg (jaw width follows the spec) plus *brushes* - smooth bumps and dents at fixed spots
  (brow ridge, eye sockets, cheekbones, cheeks, forehead, lips, mouth groove, chin ...). `front(x, y)` and `normal(p)` answer "where is the skin
  here" for everything that attaches. Vertex colours bake the blush, socket shade and lips.
- Things that grow out of it: `faceParts.ts` (nose as a tapered sweep, cupped ears, swept moustaches, beard lobes, sideburns),
  `shell.ts` (hair, jaw beards, sideburns as skin-hugging shells clipped at a smooth iso-line), `hair.ts` (the ten hairstyles).
- **The face grid is packed where the face has features** (`headShape.ts` `FACE_THETAS`): still 32x24, but two rows a lip's height apart bound the mouth seam (`MOUTH_BAND`), the eye rows are dense, and the rows
  above the brow and under the chin are far apart. The jaw and every mouth part are defined against those two rows (`faceMorph.ts` `jawWeight`). The outline hull uses its own 24x15 grid so the ink line
  is not a polygon in a close-up.
- **Expressions are data** (`expressions.ts`: neutral, pain, fear, triumph, drunk, angry, smug, disgust, surprise, laugh, sleep; `setExpression(id, intensity 0..1)`), eased and applied by `faceAnimate.ts`:
  brow height / tilt / arch / knit (a morph target set on the brow itself), upper-lid height and slant, lower-lid squint, gaze, pupil size, and twelve morph targets on the skin
  (jaw, smile, frown, squint, puff, pucker, stretch, snarl, smirkL, smirkR, browUp, browKnit). Append-only: new expressions and new targets go at the END.
- **Eyes** (`faceRig.ts`): a shaded sclera (lid shadow, pink inner corner), a domed iris with a bright inner ring, a hard dark limbal ring and radial streaks, a pupil disc that dilates, two catch-lights that stay
  put when the eye turns, an upper lid with a fold and a drawn lash-line ribbon, a lower lid with a wet edge. The lids close to a lash line just below the middle of the eye and meet there.
- **Brows** are a tapered body with a fan of pointed hairs (per-hair length, angle, tone), seated on the brow ridge by a depth table so they follow the skin as they rise, fall and draw together.
- **The mouth** (`mouthGeo.ts`) is ONE small mesh laid on the strip of skin between the two mouth rows: the lip seam, the dark opening, gums, six upper and six lower teeth (gold, missing, buck and crooked
  variants), a tongue. Shut, it has no area; it opens with the jaw morph and moves with every other morph because it is built from the same deformation function as the skin. Teeth cannot leave the lips.
- Hair and facial hair are **clumps, not sheets**: long hair is a dark under-layer plus two or three layers of tapering strand clumps that fall along the body-clearing profile (`hair.ts` `clump`), the ponytail
  is a bundle, beards carry overlapping locks with dark roots and light tips over a core (`faceParts.ts` `fringe`), greying is per strand (mottled, tips and chin first) and roots are darker than lengths.
- Things that grow out of the skin: `faceParts.ts` (nose: a slim bridge swelling into a ball, nostril wings and dark nostrils; dished ears with a helix, lobe and antihelix; swept moustaches; beard lobes; sideburns),
  `shell.ts` (hair, jaw beards, sideburns as skin-hugging shells clipped at a smooth iso-line), `hair.ts` (the hairstyles).
- Sweeps (`sweep.ts`) and lofts (`loft.ts`) are the two forming tools: cross-sections along a curve or a stack. Anything organic uses one of them.

## Cloth, hands and fine detail on a character (second pass)
- **Garments are cloth, not solids.** A cape, poncho or coat skirt is a two-layer sheet (`patch.ts` `thick` / `lining` / `rim`): an outer dye, a second lining colour that shows at the open
  edges and from below, and a rolled rim. Capes and ponchos are open at the front with pointed panels; the part over the arm rides the arm bone and the torso piece stays clear of the
  arms' swing (`drape.test.ts` proves it over the animator's real poses). A new garment must state where it clears the body and be added to that kind of test.
- **Hands read at conversation range, not at 30 m.** Four fingers and a thumb, a grip from open to fist (`rig.setHandGrip`); the silhouette of a fist must stay compact. Gloves follow
  the fingers, mitts are one mass with a thumb, gauntlets flare and stay put. Expression drives the grip (anger, triumph and pain clench; fear opens).
- **Fine detail earns its place in the creator and in close-ups; it must never fight the silhouette.** Medals hang from a pin bar on a folded two-colour ribbon (four badge styles),
  belt buckles come in five shapes, cuffs carry buttons, links or a buckled strap, boots lace or strap, coats can have breast, flap or pencil pockets, and hair takes a bow, a comb,
  pins, a flower or a feather. Rules: every colour from `PALETTE` (`trim` group, append-only), pieces overlap what they sit on (the audit rejects floaters), nothing above the
  hat crown (accessories drop behind the ear under a hat), nothing depends on gore, and small things are LOD0-only.
- **Scars and eyepatches are history, not costume.** Their style (straight, jagged, stitched, forked; plain, skull, bandage, jewelled) is server-owned like the scar itself.
- **Look at these with the switches** `close=0&ty=&tx=&cd=` (a tight camera on one person), `vary=<field>&voff=N`, `heads=1`, `frame=torso|hands|feet`, `elev=` / `orbit=`
  (see the header of `showcase/Lineup.ts`); the creator's own poses (Turntable / Walk / Idle / Pain / Triumph) show a look moving.

## Reviewing art (always look at renders)
```
node scripts/shot.mjs "?showcase=lineup&n=5&seed=3&heads=1&turn=0.2" out.png 1800x600          # a row of portraits
node scripts/shot.mjs "?showcase=lineup&n=4&seed=3&close=1&cd=1.25&turn=0.35&set=hat:0" out.png # one face, tight
node scripts/shot.mjs "?showcase=lineup&n=8&heads=1&vary=beard&set=hair:0,moustache:0,hat:0" out.png
node scripts/shot.mjs "?showcase=lineup&n=4&close=1&cd=1.25&expr=triumph|pain|fear|angry|drunk|smug|disgust|surprise|laugh|sleep" out.png
node scripts/shot.mjs "?showcase=lineup&n=1&close=0&cd=1.8&expr=laugh&hideface=lid,lowerLid,glint&set=hat:0" out.png   # hideface= switches face parts off to see what lies under a lid
```
Checklist for a new feature: reads at distance? sits on the sculpt (no float/sink)? uses only palette colours? survives Gore Off? fits the triangle
budget in `docs/PERFORMANCE.md`?

## World (D-025, upgraded): an expedition into territory not yet improved by the Society
The environment is drawn with the same tools as the people in it: **`MeshToonMaterial` with the shared 4-step ramp** (`sharedToonRamp()` in `outline.ts`;
`rig.ts` holds an identical private copy, keep them equal), **vertex colours from the palette**, and the **inverted-hull ink outline** (instanced).
Nothing in the world is a plain PBR material or a texture, except the runtime canvases (pennant, signboards, the survey map) and the 1024^2 footpath mask.
- **Ink weight.** Scenery is drawn with `worldOutlineMaterial` (`WORLD_INK` small 1.05 / medium 1.45 / large 1.8 px, all thinner than a character's 2.2, and it never
  grows up close): trees, ruin and camp are "large"/"medium", rocks "medium", stumps and logs "small". The line eases to 42% of its width beyond ~12 m, so a far tower
  is a hairline. Hulls of solid things are the SAME mesh (rocks, slabs) or a coarse one fattened <= 3.5% (trees); a bigger fat shows as thick black slabs at arm's length
  (`geometry.test.ts` enforces <= 6%). Shrubs carry no hull and are double-sided: you can walk into them and a hull seen from inside is a black screen. Low: no ink.
- **Palette.** `PALETTE.world` (terrain, rocks, trees, blooms, hill rings, sky, water, the ruin, ambient life, and the **day-cycle keyframes** `morning*`, `dusk*`,
  `night*`), `PALETTE.props` and `PALETTE.camp` (canvas, rope, pennant, cart, luggage, fire, map table, lantern glass). Flames, embers and glows are the only
  saturated world colours. `palette.test.ts` covers all of it; `daycycle.test.ts` proves every keyframe mix stays inside the palette's chroma.
- **Time of day** (`shared/daycycle.ts`, applied by `Stage` through `world/skyclock.ts`): a pure `dayState(hours)` gives sun/moon colour and direction, three sky bands, horizon glow, the
  colour of distance (fog, skirt, far hills), hemisphere bounce, fog density, how strongly the fire and lanterns read, stars and moon. **The hour is owned by the server**: the room state carries
  the world's age (`worldMs`, refreshed every 4 s and on join), the start hour and the day length (`DAY_START_HOUR`, `DAY_MINUTES`, default 09:00 and a 30 minute day, the dark hours passing three
  times faster), and `worldHours(start, worldMs, dayMinutes)` is a pure function of them, so every player sees the same sky. `?time=13|dusk|night|17.5|6:30` still overrides locally (`&drift=1` runs
  on from it), the menu and the creator preview are pinned to 13:00 (`stage.setTime(13)`) until a room's clock takes over. The directional light IS the sun by day and the moon by night (blended
  through twilight), so `Stage.followShadow` casts correct shadows at every hour; shadows are drawn at 72% strength and fade with cloud (a toon ramp's darkest lit step is far brighter than raw
  hemisphere light, so full-strength shadows read as holes).
- **Weather** (`shared/weather.ts`, pure and server-agnostic: `weatherAt(seed, worldMs)`): six states (clear, overcast, drizzle, storm, fog banks, dusty wind) picked per 2.5 minute slot by a hash of
  (world seed, slot), blended over 20-40 s into each new one; the world always starts clear. Server and clients agree without a single message. `applyWeather` bends the day (greys the sky, takes the
  sun, thickens the colour of distance, darkens a storm); `lightningAt` rolls strikes while a storm is on (a flash that lights sky, hemisphere and sun, a bolt in the sky shader, thunder 1.4-7.9 s later).
  Visuals: **rain** is one pooled instanced quad set in a box that follows the camera (medium 2000 / high 3600, none on low); **puddles** on flat terrain grow with wetness (crisp hashed pools, stepped
  sky sheen, ring ripples while it falls; medium/high), all ground and stone darkens when wet (every preset); wind strength drives foliage and cloth sway; fog banks and dust are colour and density
  (the hills see the extra fog too). Low = tint and fog only. `render/world/atmosphere.ts` `getAtmosphere()` publishes `{ rain, wind, thunderAt, hour }` (plus wet, fog, storm, flash...) for the
  audio; `?weather=clear|overcast|rain|storm|fog|dust` forces a state for review, `?wms=` sits the schedule.
- **Motion** (`atmosphere.ts` `motionScale`): `prefers-reduced-motion` scales wind sway, cloth, butterflies, birds and drifting motes to 30% (amplitude, not the wind itself); `?motion=0` freezes them, `?motion=1` forces full.
- **Sky** (`world/sky.ts`): banded gradient, azimuth-aware horizon glow, sun disc with ring and halo, **two parallax toon cloud layers** (a low puffy deck lit on the
  side facing the sun, a high thin deck of streaks, different speeds), a gibbous moon with halo, ~150 twinkling stars. Clouds dim with the sky's exposure squared.
- **Ground** (`worldgen.ts` `groundColour` + `landscape.ts`): two-tone grass, hard-edged meadow/shade/moss patches, hollows and rises, **footpaths** (`TRAILS`, Chaikin-smoothed:
  the Observatory way, the coast road with two continuous wheel ruts, a west hunters' track fading to the edge, and short paths between camp features), worn patches at the
  spawn, hearth, cart and doorways, sandy/muddy stream banks, the Observatory's paved plateau. Painted per vertex (soft, always) AND baked into a 1024^2 R/G/B mask
  (bare earth / ruts / trampled shoulder) that a shader patch sharpens with the SAME wear function (`trailProfile`), plus a hashed scatter of stones on the path (medium/high).
- **Water** (`world/water.ts`): the stream is carved into the shared terrain (`withLandscape`, a shallow ford, nothing to drown in, no obstacle) and drawn as one ribbon + pond
  at the shared channel level: three flat depth tones, crisp ripple highlights and streaks that travel downstream, sun glitter, foam hugging the banks; the source is a
  waterfall off the broken aqueduct (banded streaks running down, foam boil). Low draws flat bands.
- **The Observatory** (`world/ruins.ts`, one plan `shared/ruins.ts` for collision and looks): a hill 69 m north-east of the camp crowned by a **drum tower you can walk into**: courses of
  tangent stone blocks in a running bond, cut by a doorway that faces the camp (a plank door hung open; the collision ring has the same gap), the crown snapped unevenly, and inside a dark round room
  (painted-dark inner faces, a flagged floor, a plinth bearing a brass armillary sphere, one hanging lantern whose warm glow reads through the door even at noon). Over it a **broken copper dome**:
  14 ribs, plates of verdigris and brown copper with overlapping courses, an observing slit, a fallen-in back and an open oculus. In the courtyard the Society's **Great Refractor** (a brass
  and leather tube as long as a rowing boat, tilted at the sky on a stone pier, with a finder and a counterweight). A colonnade of standing and snapped columns under architraves (hung with vines),
  a kerbed plateau, and a broken aqueduct marching down the slope. A winding trail climbs to it.
- **Hills:** three rings (150 / 236 / 332 m). The innermost rises out of the meadow at ground level (its foot is painted meadow green), so the arena's edge melts into the hills instead of meeting a
  grey wall; their painted haze is capped by the real fog at the distance you stand from them (clear near the camera, paler far off) and the weather's extra fog closes in on top. **Tree-line
  trees** are proper silhouettes: three-tier pines and lumpy four-lobed broadleaves with a bark-brown trunk and a shaded underside, in whole autumn hillsides (`autumnAt`, the same region field
  that turns the arena's trees).
- **Wind and walkers** (`world/toon.ts`): a gust field scaled by the weather's wind and the motion preference (`uWindK`); tree crowns sway (trunks stiff, leaves flutter, the ink hull and the shadow
  sway with them); grass, flowers, ferns and reeds sway from the root and bend away from up to four walkers (`Stage.setPushers`, a uniform array, no allocation). **Cloth** (`wind: "cloth"`, geometry
  with an `aSway` weight per vertex): the washing swings from its line, the hammock's canvas belly rocks, the lanterns swing on their chains with their glass and glow, the pennant streams harder in a gale; mesh, shadow and ink sway together.
- **Vegetation** (`world/flora.ts`, placed by `world/scatter.ts`): four tree species by region (`treeSpecies`: silver birch on the low ground with white bark and black dashes, broadleaf, acacia, dark
  three-tier pine), snags, shrubs, berry bushes, **seasons by region** (`autumnAt`: whole patches of country turn red, orange or gold, on trees, shrubs and grass, and carry on into the hills),
  stratified mossy boulders with orange crust lichen, **weathered leaning slabs** (thin strata each their own tone, dark seams, frost cracks, moss caps and drips, lichen rosettes, an overhanging capstone),
  pebbles, **stumps and fallen logs (collidable: step on a stump, jump a log)**, wind-swept grass, **flower meadows** (noise patches with a dominant hue, daisies with eight petals and cups with five,
  stems and leaves, five hues), ferns, toadstool rings under the broadleaf groves, cattail reeds and **lily pads** on the pond and the slow stretch of the stream, hanging **vines** on the ruin.
- **The clearing's furniture** (`shared/clearing.ts` is the single source for collision and looks; `world/clearing.ts` draws it as one merged mesh): a **stone well** with a crank, bucket and gabled roof
  (flagged apron of flat **stepping stones**, a stepping-stone path to it from the camp); a **sheep pen** of post-and-rail fence with its gate hung open (jump the rails, walk the gate); four
  **signposts** with arrow boards where the paths part; a **plank footbridge** with handrails over the stream on its own short path (`footbridge`, ending at a fishing spot on the far bank; the deck is
  a walkable obstacle a hand above the water); more flat stones set into the ford. The clearing's rim is a ragged ring of flattened dry grass with streaks where feet went.
- **The flock** (`shared/fauna.ts`, `world/animals.ts`): 9 sheep (5 in the pen) and 3 goats as instanced toon animals with an ink hull each. Not simulated, not on the server, not collidable: each animal's route
  is a chain of clear waypoints fixed by the world, and where it is on the route is a pure function of the world clock (turn on the spot, stroll, graze), so every player sees them in the same place. Legs swing, the body
  bobs and the head dips in the vertex shader from three per-instance numbers. They stay in when it rains.
- **The camp** (`camp.ts` is the single source for collision, visuals and prop keep-out): two bell tents, campfire with pot and steam, flagpole with pennant, signpost, trunks, cart, crates,
  ruined wall, and now the **survey table** (the map is drawn from the real trails, stream and hill), a **telescope** trained on the Observatory, a **gramophone** on a tea table,
  a **washing line** with laundry, a **hammock**, and six **hanging lanterns** whose glass glows from dusk. Solid pieces merge into one geometry; the pieces that move in the wind (laundry, hammock canvas, lantern chains and frames) are a second, swaying geometry; lantern glass is a tiny unlit mesh.
- **Props** (`world/objects.ts`): slatted crates with corner posts, braces and nails; staved barrels with iron hoops; glass bottles with neck, cork, paper label and a glint; bentwood cane-seat
  chairs. Each stays within ~5% of its physics box (a test enforces it). One instanced set per kind, with the medium scenery ink.
- **Ambient life** (`world/ambient.ts`, all GPU-driven from the clock, one draw each, pooled by construction, capped by preset): pollen by day and fireflies at dusk, ~12 butterflies
  circling the flower patches, distant birds, campfire smoke and pot steam, lantern glow points. Low builds none of it except the lantern glow.
- **Hollowmere, the local society's village** (`shared/village.ts` is the single plan for collision, keep-outs, ground pads and looks; `world/village.ts` draws it as one merged mesh + one hull, `world/banners.ts` its
  signs, `world/atlas.ts` the lettering): fifteen sites, eight fictional building types (a gate tower with a working clock, tile / shingle / thatch cottages, stilted river houses with stairs that follow the ground, round-roofed
  granaries on mushroom stones, a terraced meeting hall, a smithy with chimney smoke, a water mill whose wheel turns, market awning stalls), streets as late trails, fences, gardens, washing lines, drying racks, a well, carts,
  crates and lanterns that light at dusk. Doors are real openings with dark interiors; walls are solid; the ground under each building is levelled by a pad (`withLandscape`). Palette: the `vl*` set in `PALETTE.world` (plaster, tile,
  shingle, thatch, awnings, cobble, herald blue and gold). Lit windows sit in the lantern-glass mesh (`aLit`, `windowLight`). Lod 0 (the hull, and the low preset) drops windows, framing, lamps, washing and small clutter.
  The other towns light theirs the same way (D-089, `world/litWindows.ts`): a pane set 12 mm proud of each window frame, about seven in ten warm (the same ones every night), the rest dark glass (`camp.windowDark`), coming on with the region's lamps.
- **The expedition HQ** (`CAMP.hq`, `hqPlan()`, `world/hq.ts`): a striped pavilion, open at the front, with flags, a map table, crates with stencilled text, a supply pyramid, a notice board (runtime canvas text) and the
  Society's heraldry (fictional). Its cloth flutters with the camp cloth.
- **Waterside**: a plank jetty with a moored punt that bobs, reeds, stepping stones, a timber weir with a walkway and a foaming chute, lapping wavelets and wheel/punt splashes in the water shader, a mill wheel. `landscape.ts`
  exports `WEIR`, `MILL`, `JETTY` (the audio agent reads them). Shore foam is a broken band at q 0.65-0.9, not a solid rim (a solid rim read as ice at noon).
- **Ground detail** (`worldgen.ts` + `terrain.ts` `bakeGroundDetail`, medium/high): macro tone variation, gravel on paths, mud belts by the water (with short trails of paired prints), sun-cracked clay (voronoi seams in the shader),
  flower-meadow lift, leaf litter in drifts under crowns, plaza cobbles. A second 320^2 RGBA texture (R litter, G clay, B mud, A cobbles) next to the 1024^2 trail mask.
- **Land and far view**: ten crags per seed (strata, ledges, a boulder field each; `cliff` obstacles), a windmill on a second summit and a distant snow range with layered haze (both inside the hills mesh; camera far 820),
  valley mist at dawn (`mistLevel`, `uMist`: one fog chunk in every toon material).
- **Sky and light polish**: sunset silhouettes and lit cloud bellies, a **golden-hour stop at 16.6** (blue top, warm horizon: a straight fade to dusk went violet 90 minutes early), two star layers, a milky band and shooting
  stars, **moon phases** (`worldDay`, `moonPhase`; `?moon=0..1` overrides; moonlight follows the phase), canopy sun shafts (one instanced draw, faded by cloud, rain, night and a high sun). Sunrise and sunset colours are convex
  mixes of palette entries (`daycycle.test.ts` proves the chroma).
- **Wildlife** (`shared/fauna.ts`, `world/animals.ts`, `world/ambient.ts`): ducks on the pond, deer (with a stag) at the forest edge, the village cat (naps by the granary, curled on its steps from 21:00 to 06:00), swallows over the
  village and pond, dragonflies over the stream. Scenery, not simulation: pure poses from the world clock. Each animal group is ONE instanced mesh holding every species (vertices of other species collapse in the shader) so five
  species cost the same four draws the two farm animals did. Swallows and dragonflies are extra instances of the bird and butterfly meshes.
- **Hollowmere's folk** (`shared/villagers.ts` + `villagerNav.ts` + `villagerLines.ts`, `world/villagers.ts` + `villagerPose.ts` + `villagerProps.ts` + `villagerLooks.ts` + `villagerOverlay.ts`): 22 scenery people with a day (see docs/_notes/environment.md, Villagers).
  Art rules: they wear the village's dyes (indigo, teal, ochre, sand, olive, rust; a red or green where a trade wants one) and the costume of their TRADE (a veiled pith helmet for the bees, an eyeshade for the
  registrar, pushed-up goggles at the forge, a sou'wester on the pond, a nightcap on the night watch); skin tones are spread evenly over the eight of the palette by seat in the roster, never by trade, and no costume is drawn
  from a real people's dress (no fez, poncho or top knot). Children are the same rig at 0.66-0.74 scale with big heads; the old are grey, stooped and carry a cane. Props are palette-only merged geometries with the
  ink line at LOD0 (broom, hammer, rod, bell, lantern, book, cane, lamplighter's pole, umbrella, bucket, sack, baskets, the shared crate/bottle/chair). Speech is a telegram slip (`.folk-say`, paper/ink/stamp variables),
  names the game's own luggage tag (`.nametag`). Poses are arm-IK hand targets (the broom's foot on the flags, the hammer over the anvil), so a fist is always on its handle.
- **Review commands** (`?showcase=world`, real arena, deterministic):
```
node scripts/shot.mjs "?showcase=world&view=game&time=13" out.png 1280x720 6000      # the view a player has at spawn, at noon
node scripts/shot.mjs "?showcase=world&view=camp|tents|fire|flag|sign|wall|cart|luggage|crates|edge|hills|sky&time=dusk" out.png
node scripts/shot.mjs "?showcase=world&view=table|scope|gramophone|wash|hammock|lanterns|ruin|tower|colonnade|aqueduct|ford|pond|source|meadow|trail|stump|log&figures=0&props=0" out.png 1000x600
node scripts/shot.mjs "?showcase=world&view=well|pen|bridge|waypost|door|inside|dome|refractor|flock&time=13&figures=0&props=0" out.png   # the clearing's furniture and the Observatory's doorway, dark room and dome
node scripts/shot.mjs "?showcase=world&view=folk|folkplaza|folkgate|folkmill|folkjetty|folkwell&time=9.5&tags=1&props=0" out.png 1400x760 16000   # the folk at the hour (weather=drizzle: rain)
node scripts/shot.mjs "?showcase=world&who=smith|keeper|ferry|fisher|clockkeeper|laundress|gardener|baker|miller|pip|lamplighter|watch|beekeeper&time=9&folkbudget=review&wd=3&wa=0.5&wh=1.4&tags=1&props=0" out.png 900x640 14000   # one villager, followed (wa = angle round them)
node scripts/shot.mjs "?showcase=world&view=folkcast&castFrom=0&castN=6&castGap=1.6&time=12&folkbudget=review&props=0" out.png 1500x700 14000   # the cast in a row in their trade's pose, full detail
node scripts/shot.mjs "?showcase=world&view=game&weather=storm|drizzle|fog|dust|overcast&time=13" out.png   # forced weather (lightning in a storm); try time=19 and time=0.5
node scripts/shot.mjs "?showcase=world&view=tree&i=3" out.png                          # also rock, snag; i picks which one
node scripts/shot.mjs "?showcase=world&cam=13,0.8,22&at=14,0.25,20&push=14,20&figures=0" out.png   # a walker bending the grass
node scripts/shot.mjs "?showcase=world&view=village|vtop|vmarket|vjetty|vweir|b-gate|b-hall|b-mill|b-shop|b-stilt-w|b-gran-a|b-stall-1&time=12&figures=0&props=0" out.png   # Hollowmere (d=N distance, a=N angle round a building)
node scripts/shot.mjs "?showcase=world&view=village&time=18.3|21|7&moon=0.5" out.png    # dusk, lit windows, dawn mist; moon phase 0..1
node scripts/shot.mjs "?showcase=world&cam=-13,3,-30&at=-21,-3,-35&time=11&figures=0&props=0&fov=45" out.png   # the pond and its ducks (camera y is world y; the village ground is about -2 to -3)
node scripts/shot.mjs "?showcase=world&view=game&gfx=low&props=0&figures=0" out.png    # low preset (no ink, no MSAA, coarse tree crowns, no ambient life, no rain or puddles, no flock, vertex-painted paths); gfx=test is the e2e preset (see PERFORMANCE.md)
```

## Highmark (D-036): region two, the savannah and its hill-capital

An art brief, not a copy of Kessar. Kessar is ochre sandstone, a curtain wall and round towers on a dry coast; Highmark is **chalk-white stepped walls and verdigris roofs over a golden grassland**. Heraldry is a **sun and a stag**; signage is Latin letters; there is no dome, minaret or script and nothing that codes a real people (`noRealWorld.test.ts` scans the plan, the signs, the template and the parleys).
- **The hill** (`shared/highmark.ts`, `highmarkPlan()`): FIVE concentric terraces round (0, -96): the granary (r 62-74), the market (50-62), the guild (38-50), the court terrace (20-38) and the plateau (r < 20), each 2.2 m above the one below. Every riser is a TRUE WALL (a 1.2 m chalk retaining wall with a 1.6 m parapet, a collision box per 4 m of arc) except where the Processional Road crosses it on a ramp (slope 0.31, six metres wide, walled both sides with sloping caps). The ramps alternate (south, east, west, south, east) so the road is a switchback; the gatehouse (the Chamberlain's Window in its west tower, the sun of the Crown over the arch, two verdigris-capped towers) straddles the top of the fourth ramp. No invisible walls: what you bump into is a wall you can see, and the view draws the very boxes the collision world has.
- **The wedding cake from the grassland**: every wall is capped with a verdigris coping (the piping) and stands on a battered chalk footing that hides the ground mesh's quad across the riser, so each tier reads as a tier from far off. The palace is three tiers (hall, hall, belvedere) with hips, a colonnade, a flight of steps and a bell-gable; the Vacant Chair stands on a dais before it, between two plinths with stag statues, on a gilt sun medallion.
- **Colour** (`PALETTE.highmark`, 43 entries, `highmark.test.ts` guards chroma, contrast and uniqueness): chalk (white, shade, dark, cap), verdigris (roof, dark, light), the savannah (gold, deep, pale, green, deep green), earth, road chalk and ruts, termite earth, acacia, timber, the Crown's blue and sun gold and stag brown, the Grange's green and wheat, the Syndicate's green and gilt, bell bronze, reed, herd hide. Each terrace has its own floor (stubble and earth, chalk flags, lawn, a chalk checker, the court's flagstones with its pale sun disc).
- **The grassland**: a wide golden swell pinned flat at the hill's foot, the landing and the camp; acacia flats (the world's `tree` obstacles drawn as the shared acacia, tinted), termite mounds (the `rock` obstacles, flattened boulders in earth), thorn scrub, long grass that bends away from walkers (the shared pusher slots), reeds on the river bank. The hill rings, tree line and snowy range are the game's own, scaled 1.66x so the first foot starts past the 150 m plain (they are built for Hollowmere's 90 m arena). The river is the shared toon-water shader along the south edge; the Reed Landing is a plank quay, bollards and a moored barge.
- **The Grange's fields** (D-116, `HIGHMARK_FIELDS`, `shared/fields.ts`): eight open-field plots on both sides of the road, each crop its own ground (barley straw rows, green drills, pale stubble, mown hay with windrows, ridge and furrow) and its own things (planted barley clumps; stooks; haycocks round a pole; a scarecrow in the Society's red coat and pith helmet over a sack face; the plough's ridges and the drills as low prisms that follow the ground). Palette: the savannah's golds, earth and earth-dark, the Grange's wheat, the camp's canvas, flag red and sack.
- **Herds** (`shared/highmark.ts` `herdPlan` / `herdAt`, `world/highmark/herds.ts`): four herds, 92 long-horned grazers (`HERD_CAP` 96), ONE instanced draw and one ink hull. Their positions are a pure function of (seed, world seconds): allocation-free, deterministic, always >= 8 m from the road and off the terraces and the water; scenery, nothing hits them.
- **Lamps and the harvest bell hour**: sixteen lanterns (a cage round a gilt flame, so the additive glow is seen through it) burn from dusk (`uLamp = max(fire, dusk * 0.9)`): the Reapers' Assembly ratifies at the bell, so the dusk matters.
- **Budget** (`HIGHMARK_VIEW_BUDGET`, counted in Node like `kessar.test.ts`): meshes 11 / 16 / 23 / 23 and 61k / 123k / 377k / 505k triangles (test / low / medium / high) against ceilings of 22 / 28 / 44 / 44 and 120k / 170k / 440k / 540k.
- **Review commands** (`?showcase=world&region=highmark`, no server needed):
```
node scripts/shot.mjs "?showcase=world&region=highmark&view=landing|quay|road|grass|herds|waiting|camp|foot|terraces|granary|market|ramp|gate|window|court|throne|palace|capital|capitalfar|plateau|top&figures=0" out.png 1280x720 6000
node scripts/shot.mjs "?showcase=world&region=highmark&view=capital|gate|ramp&time=dusk&figures=0" out.png    # the harvest bell hour: lamps, long shadows
node scripts/shot.mjs "?showcase=world&region=highmark&view=herds&wms=30000" out.png                         # wms sits the world clock (the herds are a function of it)
```
- **Showcase fix** (`showcase/World.ts`): the `lineup figures render sunk to the chest in region=kessar showcases` finding was the showcase's, not the game's. The animator rewrites `root.position.y` with its own offset on every update (CharacterActor adds the ground back after it, which is why the game was fine); the showcase set the ground height once and then let the animator overwrite it, so a figure stood on 0 where the ground is 0.5 (Kessar's level; Hollowmere's spawn is at 0). The showcase now adds the ground after each update.

## Vesper Gorge, the Saltmarket Delta and the polish pass (D-037): regions three and four

Records with the numbers: `docs/_notes/{vesper,saltmarket,polish}.md`. Three regions that must read as three places, enforced by tests (`regionPalettes.test.ts`: the five swatch colours of any two live regions differ in Lab, at least three slots >= 12 apart and a mean > 18; `skyline.test.ts`: the silhouette is measured from the ground).
- **Vesper Gorge is a NEGATIVE-SPACE region**: a cleft. Banded red-violet strata walls (TRUE walls) either side of a narrow floor, an iron headframe and an ore trestle against a bleached sky, the Long Cloister cut into the west cliff as a gallery of arches, black crepe, iron and lamp amber where people are; cool low light on the floor, warm on the upper walls. Colours: `PALETTE.vesper` (`paletteVesper.ts`). Swatch: dust, strata rust, crepe, the Guild's plum, the Company's cloth. The fall in the Lower Gallery is dressed by `applyScenario` (shored, dug, blasted, sealed, consecrated) and never changes collision.
- **The Saltmarket Delta is a HORIZONTAL region**: a line with hairs on it. A nearly flat silt plain under a wide sky, tarred plank and silvered piling, indigo and brick-coral canvas, slate-blue water, salt-white in small amounts, broken only by masts, cranes, lantern poles and the Exchange's cupola; lanterns at dusk. Colours: `PALETTE.saltmarket`. Water is a barrier on foot (deep channels), boardwalks and bridges are floors; the Exchange's flood rises as a pure function of the tide timer.
- **Rules both obey**: palette colours only (a test rejects a literal), instanced and ink-outlined, meshes and triangles inside `*_VIEW_BUDGET` per preset, signs in Latin capitals with no real-world term, fictional institutions only (a guild that bills per corpse, houses that auction the tide).
- **Characters**: hair sways (LOD0/1 only, millimetres at idle, centimetres running, 30% under reduce motion), the nose bridge's outline thins in three-quarter view, closed eyes are almonds, all eleven expressions have a body, hip gear leaves the swinging hand room on stubby bodies. **Highmark's skyline**: a lit lantern tower on the palace, finials, a taller bell-gable, more banners and a landmark haze share so the capital holds its edge at `capitalfar`.
- **Review commands**: `?showcase=world&region=vesper&view=landing|wharf|road|floor|headframe|trestle|assay|pegging|cloister|adit|fall|cleft|rim` and `region=saltmarket&view=landing|quay|boardwalk|channel|stilts|customs|berth|cove|drop|exchange|flood|horizon`, each at `time=13`, `time=dusk`, `weather=fog`; `?showcase=lineup&n=6`. Software-GL stills only; nobody has seen any of it on a real GPU or a calibrated display.

## Interface (D-024)
The interface is the Society's stationery, not a game HUD skin: paper, brass, ink, rubber stamps, luggage tags, telegrams. Rules: colours only from the `--ink/--paper/--brass/--stamp...`
variables (which come from `PALETTE.ui`); meaning is never colour alone (gauge = needle + number + "!", injuries = fill + outline weight + hatching + words); type is IM Fell
English (text), IM Fell English SC (labels, buttons), Special Elite (codes and telegrams); ornament is CSS/inline SVG only; nothing animates with `prefers-reduced-motion`.
Review with `node scripts/shot.mjs "?x=1" out.png 1440x800 4000` (menu) and a scratch Playwright session for the in-game HUD (enter a campaign, send `debug` `hit:0:50`, `down`, `sever:4`).

### Slips of paper (D-086, 2026-10-08): the words must read on anything
Ink with a halo straight on the picture smeared at night and over busy walls, and the small italic was hard work (the owner: "readability of the HUD looks quite unpleasant").
Every block of words on the HUD is now a **slip**:
- `--slip` is field paper at 93%. `--slip-edge` is a thin shadow and a faint ruled edge.
- The ink sits on it with no halo, upright, and a size larger than before.
- The slips are the orders (the contract's line, its rule in stamp red, the clock), the Society's commission (its own slip under the orders), the casualty column (each line a cutting), the key strip, the prompt, the armoury card, the goal's label and the compass reading.
- Figures come from the typewriter face everywhere on the HUD (`"CB Figures"`, the digits only): IM Fell's old-style zero reads as a letter.
- A short screen compacts the orders slip to about a quarter of the height.

This supersedes "legibility without boxes" below. The quiet plate's rules on WHAT is shown and WHEN still hold.

### The quiet plate (D-063, 2026-10-03): what is on screen, and when
On top of the Survey Plate's look: **one line** under the heading strip says what to do next (game/guidance.ts) and **one flag** in the world marks the place (ui/Guide.ts); everything else earns
its place by meaning something now. No pools of mist (a tight paper edge only). Telegrams are small slips top-right, never over the play area (one at a time on a phone; the pause
sheet keeps them all). The dial shows when hurt or armed, the armoury card with a piece in hand, the key hints for the first 90 s, the invite code at camp; the heading strip's
places are small marks, only the goal in red. A new screen element must answer "what does the player do with this, now?" before it goes on the HUD.

### The Survey Plate (D-062, 2026-10-03): the interface's current look
The HUD is engraved ink drawn ON the picture, as a surveyor annotates a plate, not cards laid over it. `apps/client/src/ui/plate.css` is its sheet (scoped to `#hud`, and the sheets under `html .panel`); it
supersedes the looks described in the passes below wherever they disagree (positions and behaviour from those passes still hold).
- **Legibility without boxes.** Every stroke and letter carries a paper halo (`--halo`); a block of words sits on a feathered pool of paper (`--mist`: a translucent body with a wide blur, never a hard
  edge). Large blocks (the contract, the orientation) keep their mist close so a corner of the picture is not washed out. High contrast trades the mist for solid paper and a ruled edge.
- **The heading strip** is a map's scale bar: a hairline with ticks, the reading above it on its own mist with a stamp-red notch, the places hanging below on dotted leaders (the objective in stamp red).
- **Telegrams** are ticker tape pasted on askew (Special Elite capitals, the stamp "TELEGRAM" at the left end); a crowded stack folds its older strips to one line.
- **Vitality** is an engraved dial (ink ring, stamp-red danger arc, ink needle); the surgeon's note beside it is italic; **arms** are line silhouettes with the piece in small caps; the **prompt** is an
  italic verb with the key as a wax seal; name plates over heads are italic names in ink.
- **The sheets** (front door, pause, manual, settings, parley, broadsheet, map room, manifest) are one sheet of fine laid paper with a hairline rule inset: no leather, no brass corners. Choices are
  ledger lines (a hairline under each; the one in hand gets a tint, a red margin rule and a pointing hand); the one action that matters is a flat rubber stamp in stamp red.
- Mocked first as three directions over a real Highmark frame (Survey Plate, Field Kit, Gazette); the Survey Plate was chosen as the most distinctive and the least boxy.

### Interface, second pass (2026-09-30)
- **Edges and order.** One margin (`--pad`: at least 0.9 rem, 2.4% of the short side, plus the platform's safe area) for everything hugging an edge. Top: the heading strip (centre), the expedition
  plaque (right), the telegram stack below the strip. Bottom-left: vitality gauge and surgeon's tag; bottom-right: armoury card over the key line; centre-low: the prompt ticket. Captions sit left above the gauge.
- **The heading strip** is a brass ruler with ink ticks, N in stamp red, a cartouche for the reading and luggage-tag chips for the camp, Hollowmere and the Observatory (shape + word + metres, never colour).
- **Telegrams** queue (three at a time); **vitals** are ink hatching from the edges of the picture, heavier as health falls, so the warning is a pattern and a word on the gauge, not only red.
- **Hit direction** is a wedge with an arrowhead on a ring round the sight, stamp red edged in paper and ink (ink alone in colour-blind and high-contrast modes).
- **Front door**: the camp at golden hour behind the charter and the creator's panel, the figure lit by the low sun with a warm rim and a cool fill; waiting is a brass compass whose needle seeks, failing is
  "The Society regrets..." in stamp red with the real reason; a small sound plaque says when the browser is waiting for a click.
- **First-person hands** are drawn with the same toon ramp, palette and ink as the body (the player's own sleeves and gloves); see `docs/_notes/firstperson.md`.
- **Effects** follow the palette and the tone curve: shader-written clouds now go through tonemapping and the output colour space (before, they were darker and more saturated than their palette colour).
