# Asset register

Every external asset must be listed: filename, creator/source, licence, URL/source reference, modification, attribution requirement.

| Filename | Source | Licence | URL | Modification | Attribution |
|----------|--------|---------|-----|--------------|-------------|
| _(none)_ | **Audio: none.** Every sound effect, ambience bed and piece of music is synthesised at runtime by `apps/client/src/audio/` (Web Audio oscillators, filtered noise, generated convolution reverb); there are no audio files, samples or recordings, so nothing to license. Logged as AI-authored code in `AI_CONTENT_REGISTER.md`. Interface: no new fonts or images (the settings, pause and manual screens are CSS and inline SVG in the existing IM Fell / Special Elite faces). All art so far is generated procedurally in code. The world (terrain, sky, trees, rocks, camp, props) is built from primitives at runtime; the pennant, signboard lettering and fire glow are drawn on `<canvas>` at runtime (lettering in the bundled IM Fell English SC, see Fonts below) | n/a | n/a | n/a | n/a |

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
