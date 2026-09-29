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

## World (D-025): an expedition into territory not yet improved by the Society
The environment is drawn with the same tools as the people in it: **`MeshToonMaterial` with the shared 4-step ramp** (`sharedToonRamp()` in `outline.ts`;
`rig.ts` holds an identical private copy, keep them equal), **vertex colours from the palette**, and the **inverted-hull ink outline** (now instanced) on everything solid.
Nothing in the world is a plain PBR material or a texture, except the two runtime canvases below.
- **Palette.** `PALETTE.world` (terrain, rocks, trees, blooms, three hill rings, the sky's cloud/glow/sun colours), `PALETTE.props` (crate/barrel/bottle/chair detail) and
  `PALETTE.camp` (canvas, rope, the pennant, cart, luggage, fire). Flames, embers and the glow are the only world colours allowed to be properly saturated (`camp.flame*/ember/glow`,
  chroma cap 0.7, everything else 0.4). `palette.test.ts` covers all of it.
- **Ground** (`packages/shared/src/worldgen.ts`, `groundColour`): a soft two-tone grass base, deep green in hollows, dry gold on rises, *hard-edged* painted patches (sunny meadow, shaded
  clump, moss dapple) from three noise scales, a ragged worn-earth clearing round the camp with a scorched hearth, a track that leaves past the signpost, bare rock on slopes.
  Pure and tested (finite, in gamut, chroma <= 0.4 everywhere). Smooth normals, so the toon ramp bands the swells.
- **Beyond the map:** the visible ground eases to a flat plain 22 m past the playable radius, a ground skirt carries the meadow out to the fog, three low-poly hill rings (radius 150 / 236 / 332,
  paler and hazier with distance; aerial perspective is painted into their vertex colours; wooded shoulders) and a few unreachable groves. Fog, the sky's lowest band, the skirt and
  the hills all use `fogColour()` (horizon nudged 14% toward the sky's mid blue): one colour of distance.
- **Sky** (`world/sky.ts`): banded gradient, an azimuth-aware warm glow pooled on the horizon behind the sun, a sun disc with a thin ring and two halo bands, and toon clouds (flat shapes,
  a lit and a shaded tone, lit on the side facing the sun). Three octaves of noise, no textures.
- **Vegetation** (`world/flora.ts`): *broadleaf* (leaning tapered trunk, two limbs, six faceted crown lobes in deep green underneath and sunlit green on top), *acacia* (thin forked trunk, two flat
  dish canopies with a lighter sunlit skin), *snag* (bleached cracked trunk with bare limbs, standing near rock outcrops), shrubs, faceted mossy-footed rocks with pale weathered tops and pebble
  litter, wind-swept grass tufts and wildflowers. Species follow a low-frequency noise field (`treeSpecies`) so groves are of one kind with 14% strays. Every kind is one merged geometry
  instanced with per-instance colour and size variation; the ink hull uses a coarser geometry (`lod` 0, fattened 6%).
- **The camp** (`camp.ts` is the single source for collision, visuals and prop/spawn keep-out): two elliptical bell tents (sixteen flat canvas panels alternating in tone, red hem and crown, dark
  doorway, finial, guy ropes), a campfire ring with tripod, pot and charred logs under an unlit flame (seven curling tongues, flicker driven from `update`) plus a soft additive glow sprite and
  ground pool (no lights), a flagpole with the Society's pennant (compass rose and motto drawn on a runtime canvas, rippling in the vertex shader), a signpost whose four arrowed boards carry
  lettering, a steamer-trunk stack, a covered supply cart, the two step-up crates, and the ruined dry-stone wall (irregular courses, broken crown, mossy foot, fallen blocks; the collision box is the
  full-height footprint so breaks are limited to the top 0.5 m). Solid landmarks are ONE merged geometry; the pennant and lettering share one textured mesh.
- **Props** (`world/objects.ts`): slatted crates with corner posts, braces and nails; staved barrels with iron hoops; glass bottles with neck, cork, paper label and a glint; bentwood cane-seat chairs.
  Each stays within ~5% of its physics box (a test enforces it).
- **Review commands** (`?showcase=world`, real arena, deterministic):
```
node scripts/shot.mjs "?showcase=world&view=game" out.png 1280x720 5000     # the view a player has at spawn
node scripts/shot.mjs "?showcase=world&view=camp|tents|fire|flag|sign|wall|cart|luggage|crates|edge|hills|sky" out.png
node scripts/shot.mjs "?showcase=world&view=tree&i=3" out.png                # also rock, snag; i picks which one
node scripts/shot.mjs "?showcase=world&propline=1&figures=0&cam=0,0.9,-1.4&at=0,0.25,-3&fov=45" out.png 1200x500
node scripts/shot.mjs "?showcase=world&view=game&gfx=low&props=0&figures=0" out.png   # low preset (no ink), world-only counts
```

## Interface (D-024)
The interface is the Society's stationery, not a game HUD skin: paper, brass, ink, rubber stamps, luggage tags, telegrams. Rules: colours only from the `--ink/--paper/--brass/--stamp...`
variables (which come from `PALETTE.ui`); meaning is never colour alone (gauge = needle + number + "!", injuries = fill + outline weight + hatching + words); type is IM Fell
English (text), IM Fell English SC (labels, buttons), Special Elite (codes and telegrams); ornament is CSS/inline SVG only; nothing animates with `prefers-reduced-motion`.
Review with `node scripts/shot.mjs "?x=1" out.png 1440x800 4000` (menu) and a scratch Playwright session for the in-game HUD (enter a campaign, send `debug` `hit:0:50`, `down`, `sever:4`).
