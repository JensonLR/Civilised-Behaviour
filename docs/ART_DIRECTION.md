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
- Eyes (`rig.ts`): white, iris, pupil and a **catch-light** (what makes an eye look alive), a skin-toned lid that matches the socket shade, and a
  tapered arched brow. The mouth is a shallow swept lip line that opens into a D-shaped cavity with teeth and a tongue.
- Sweeps (`sweep.ts`) and lofts (`loft.ts`) are the two forming tools: cross-sections along a curve or a stack. Anything organic uses one of them.

## Reviewing art (always look at renders)
```
node scripts/shot.mjs "?showcase=lineup&n=5&seed=3&heads=1&turn=0.2" out.png 1800x600          # a row of portraits
node scripts/shot.mjs "?showcase=lineup&n=4&seed=3&close=1&cd=1.25&turn=0.35&set=hat:0" out.png # one face, tight
node scripts/shot.mjs "?showcase=lineup&n=8&heads=1&vary=beard&set=hair:0,moustache:0,hat:0" out.png
node scripts/shot.mjs "?showcase=lineup&n=4&close=1&cd=1.25&expr=triumph|pain|fear|angry|drunk" out.png
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
- **Time of day** (`shared/daycycle.ts`, applied by `Stage`): a pure `dayState(hours)` gives sun/moon colour and direction, three sky bands, horizon glow, the
  colour of distance (fog, skirt, far hills), hemisphere bounce, fog density, how strongly the fire and lanterns read, stars and moon. `?time=13|dusk|night|17.5|6:30`
  fixes the hour (`&drift=1` keeps it running); without it the day drifts from 09:00, ~80 s per game hour, three times faster through the dark. The clock is cosmetic
  and per client. The directional light IS the sun by day and the moon by night (blended through twilight), so `Stage.followShadow` casts correct shadows at every hour;
  shadows are drawn at 72% strength (a toon ramp's darkest lit step is far brighter than raw hemisphere light, so full-strength shadows read as holes).
- **Sky** (`world/sky.ts`): banded gradient, azimuth-aware horizon glow, sun disc with ring and halo, **two parallax toon cloud layers** (a low puffy deck lit on the
  side facing the sun, a high thin deck of streaks, different speeds), a gibbous moon with halo, ~150 twinkling stars. Clouds dim with the sky's exposure squared.
- **Ground** (`worldgen.ts` `groundColour` + `landscape.ts`): two-tone grass, hard-edged meadow/shade/moss patches, hollows and rises, **footpaths** (`TRAILS`, Chaikin-smoothed:
  the Observatory way, the coast road with two continuous wheel ruts, a west hunters' track fading to the edge, and short paths between camp features), worn patches at the
  spawn, hearth, cart and doorways, sandy/muddy stream banks, the Observatory's paved plateau. Painted per vertex (soft, always) AND baked into a 1024^2 R/G/B mask
  (bare earth / ruts / trampled shoulder) that a shader patch sharpens with the SAME wear function (`trailProfile`), plus a hashed scatter of stones on the path (medium/high).
- **Water** (`world/water.ts`): the stream is carved into the shared terrain (`withLandscape`, a shallow ford, nothing to drown in, no obstacle) and drawn as one ribbon + pond
  at the shared channel level: three flat depth tones, crisp ripple highlights and streaks that travel downstream, sun glitter, foam hugging the banks; the source is a
  waterfall off the broken aqueduct (banded streaks running down, foam boil). Low draws flat bands.
- **The Observatory** (`world/ruins.ts`, one plan `shared/ruins.ts` for collision and looks): a hill 69 m north-east of the camp crowned by a drum tower with the ribs of its dome,
  a colonnade of standing and snapped columns under architraves, a kerbed plateau, and a broken aqueduct marching down the slope. A winding trail climbs to it.
- **Hills:** three rings (150 / 236 / 332 m) with **tree-line silhouettes** (instanced conifers and broadleaf on the wooded shoulders, hazed with distance) lit by the current sun.
- **Wind and walkers** (`world/toon.ts`): a gust field; tree crowns sway (trunks stiff, leaves flutter, the ink hull and the shadow sway with them); grass, flowers, ferns and reeds
  sway from the root and bend away from up to four walkers (`Stage.setPushers`, a uniform array, no allocation).
- **Vegetation** (`world/flora.ts`, placed by `world/scatter.ts`): broadleaf, acacia, snag, shrubs, berry bushes, stratified mossy boulders and leaning slabs (strata bands, dark seams,
  moss and lichen), pebbles, **stumps and fallen logs (collidable: step on a stump, jump a log)**, wind-swept grass, **flower meadows** (noise patches with a dominant hue, daisies with eight
  petals and cups with five, stems and leaves, five hues), ferns, toadstool rings under the broadleaf groves, cattail reeds at the water.
- **The camp** (`camp.ts` is the single source for collision, visuals and prop keep-out): two bell tents, campfire with pot and steam, flagpole with pennant, signpost, trunks, cart, crates,
  ruined wall, and now the **survey table** (the map is drawn from the real trails, stream and hill), a **telescope** trained on the Observatory, a **gramophone** on a tea table,
  a **washing line** with laundry, a **hammock**, and six **hanging lanterns** whose glass glows from dusk. Solid pieces merge into one geometry; lantern glass is a tiny unlit mesh.
- **Props** (`world/objects.ts`): slatted crates with corner posts, braces and nails; staved barrels with iron hoops; glass bottles with neck, cork, paper label and a glint; bentwood cane-seat
  chairs. Each stays within ~5% of its physics box (a test enforces it). One instanced set per kind, with the medium scenery ink.
- **Ambient life** (`world/ambient.ts`, all GPU-driven from the clock, one draw each, pooled by construction, capped by preset): pollen by day and fireflies at dusk, ~12 butterflies
  circling the flower patches, distant birds, campfire smoke and pot steam, lantern glow points. Low builds none of it except the lantern glow.
- **Review commands** (`?showcase=world`, real arena, deterministic):
```
node scripts/shot.mjs "?showcase=world&view=game&time=13" out.png 1280x720 6000      # the view a player has at spawn, at noon
node scripts/shot.mjs "?showcase=world&view=camp|tents|fire|flag|sign|wall|cart|luggage|crates|edge|hills|sky&time=dusk" out.png
node scripts/shot.mjs "?showcase=world&view=table|scope|gramophone|wash|hammock|lanterns|ruin|tower|colonnade|aqueduct|ford|pond|source|meadow|trail|stump|log&figures=0&props=0" out.png 1000x600
node scripts/shot.mjs "?showcase=world&view=tree&i=3" out.png                          # also rock, snag; i picks which one
node scripts/shot.mjs "?showcase=world&cam=13,0.8,22&at=14,0.25,20&push=14,20&figures=0" out.png   # a walker bending the grass
node scripts/shot.mjs "?showcase=world&view=game&gfx=low&props=0&figures=0" out.png    # low preset (no ink, no ambient life, vertex-painted paths)
```

## Interface (D-024)
The interface is the Society's stationery, not a game HUD skin: paper, brass, ink, rubber stamps, luggage tags, telegrams. Rules: colours only from the `--ink/--paper/--brass/--stamp...`
variables (which come from `PALETTE.ui`); meaning is never colour alone (gauge = needle + number + "!", injuries = fill + outline weight + hatching + words); type is IM Fell
English (text), IM Fell English SC (labels, buttons), Special Elite (codes and telegrams); ornament is CSS/inline SVG only; nothing animates with `prefers-reduced-motion`.
Review with `node scripts/shot.mjs "?x=1" out.png 1440x800 4000` (menu) and a scratch Playwright session for the in-game HUD (enter a campaign, send `debug` `hit:0:50`, `down`, `sever:4`).
