# Asset register

Every external asset must be listed: filename, creator/source, licence, URL/source reference, modification, attribution requirement.

| Filename | Source | Licence | URL | Modification | Attribution |
|----------|--------|---------|-----|--------------|-------------|
| _(none)_ | **Audio: none.** Every sound effect, ambience bed and piece of music is synthesised at runtime by `apps/client/src/audio/` (Web Audio oscillators, filtered noise, generated convolution reverb); there are no audio files, samples or recordings, so nothing to license. Logged as AI-authored code in `AI_CONTENT_REGISTER.md`. Interface: no new fonts or images (the settings, pause and manual screens are CSS and inline SVG in the existing IM Fell / Special Elite faces). All art so far is generated procedurally in code. The world (terrain, sky, trees, rocks, camp, props) is built from primitives at runtime; the pennant, signboard lettering and fire glow are drawn on `<canvas>` at runtime (lettering in the bundled IM Fell English SC, see Fonts below) | n/a | n/a | n/a | n/a |

Slice 1 (2026-09-30): no new files or fonts. Kessar Reach (terrain, fort, bridge, toll station, camps, palms, banner cloth, river and sea) is built from primitives at runtime in `apps/client/src/render/world/kessar/`; its signs are drawn on a `<canvas>` in the bundled IM Fell faces; its colours are the `kessar` group in `packages/shared/src/palette.ts`. The map room chart, Sailing card, parley sheet, broadsheet and objective card are CSS and inline SVG. Invented heraldry only (nine lamps, chevrons); no real flags or scripts.

Expedition slice (D-034, 2026-10-01): no new files, fonts, audio or images. Horses (twelve coats, mane and tail styles, tack) and the wagon are built from primitives at runtime in `packages/procedural` (`horse.ts`, `three/horse.ts`, `three/wagon.ts`), the rider's seated pose is code (`three/ridePose.ts`), the three Kessar contract sites (the deserters' camp with its cage wagon, the Dry Cut keg, Marker Stone No. 4 and its flags) are merged geometry in `apps/client/src/render/world/kessar/sites.ts`, the manifest sheet and the command wheel are CSS (`loadout.css`, `commandWheel.css`). All colours come from `packages/shared/src/palette.ts`. Invented heraldry only. Still no audio for any of it.

Campaign slice (D-035, 2026-10-01): no new files, fonts, audio files or images. The Society's outpost (foundation stakes and string, camp, trading post, stockade, settlement, town, telegraph poles and wire, the steam launch, the road ribbon, the Syndicate's own post) is built from primitives at runtime in `apps/client/src/render/world/kessar/outpost.ts` from the shared `outpostPlan`; HQ's history pieces (a captured lamp, a bridge fragment, portraits, a stencilled crate, pennants, the scale model of the outpost) are primitives in `apps/client/src/render/world/hqHistory.ts`; the finger-posts of the HQ route are canvas lettering and primitives (`render/world/hqRoute.ts`); the orientation card and the campaign map are CSS and inline SVG (`orientation.css`, `campaignMap.css`). The eight new sounds (hooves, tack, sailing creak and gulls, paper rustle, bell, parley stamp, cannon-crew shouts) are synthesised at runtime (`audio/sounds.ts`, `audio/hooves.ts`); no recordings. All colours are in `packages/shared/src/palette.ts` (new `outpost` group). Invented heraldry and signage only.

Fonts: system serif stack only so far (Georgia / Iowan Old Style / Palatino). No web fonts are loaded.

## Software dependencies
Runtime dependency licences are audited before release (M14); generate the notices file from the lockfile. Key: three (MIT),
Colyseus (MIT), @colyseus/schema (MIT).

## Fonts (bundled via npm, SIL Open Font License 1.1, no attribution required; keep the licence files in the package)
| Package | Face | Use | Source |
|---------|------|-----|--------|
| `@fontsource/im-fell-english` 5.x | IM Fell English (regular + italic) | body text, inputs | Igino Marini's IM Fell types (digitisation of the Fell Types), via Fontsource |
| `@fontsource/im-fell-english-sc` 5.x | IM Fell English SC | labels, buttons, headings | same |
| `@fontsource/special-elite` 5.x | Special Elite | expedition codes, telegrams | Astigmatic, via Fontsource |
Only the Latin subsets are imported (`apps/client/src/main.ts`). The earlier "system serif stack, no web fonts" note no longer applies.
