# Asset register

Every external asset must be listed: filename, creator/source, licence, URL/source reference, modification, attribution requirement.

| Filename | Source | Licence | URL | Modification | Attribution |
|----------|--------|---------|-----|--------------|-------------|
| _(none)_ | All art so far is generated procedurally in code | n/a | n/a | n/a | n/a |

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
