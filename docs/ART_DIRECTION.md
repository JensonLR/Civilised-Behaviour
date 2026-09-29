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
