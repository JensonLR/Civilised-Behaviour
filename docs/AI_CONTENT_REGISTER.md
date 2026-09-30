# AI-assisted content register

Anything AI-assisted that ships to players (art, sound, dialogue, narrative, localisation, textures, marketing images) must be
logged here for storefront disclosure. Source code written with AI assistance is not player-facing content and is not listed.

| Date | Item | Type | Tool/model | Human edit | Ships? |
|------|------|------|------------|------------|--------|
| _(none yet)_ | Player-facing strings so far are minimal UI copy written in the development session ("Nameless Fool", menu tag line, help text) | text | Claude (AI assistant) | reviewed by developer | yes - listed for completeness |
| 2026-09-30 | Procedural audio: every sound effect recipe (`apps/client/src/audio/sounds.ts`), the ambience beds and event timing (`ambience.ts`), the generative score - scales, chord progressions, melody generator and instruments (`musicScore.ts`, `music.ts`) - and the on-screen caption wording (`captions.ts`). The sounds are computed at runtime by Web Audio; there are no audio files and no recorded or model-generated audio | sound (synthesis code) + text | Claude (AI assistant) | levels and spectra measured offline by the developer's test tooling; **not yet auditioned by a human** | yes |
| 2026-09-30 | Settings, pause, how-to and accessibility interface copy ("Standing Orders", "Field Manual", "Expedition Halted", option labels and notes) | text | Claude (AI assistant) | reviewed by developer | yes |
