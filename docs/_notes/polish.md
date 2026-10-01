# Package P: polish (D-037). The characters and the Highmark skyline

Record of what was done, measured and looked at. Software-GL stills (`shot.mjs`, port 5183); nobody has seen any of this on a real GPU.

## Characters (packages/procedural)

1. **Hair sway** (`hairSway.ts`, `animator.ts updateHair`, `rig.ts`). Head geometry and its ink hull carry `hsw` (vec4: weight of each quadrant of the sway box) and `hsy`; a shader chunk moves each vertex by one per-rig `uSway` vec3 (`rig.hairSway`) that a spring in the animator drives. Weight = stand-off from the scalp (roots 0, long tips 1; Side Part / Bowl Cut ~0.02). Limits per quadrant keep hair out of skull, neck, trunk and arms (<= 5 mm deeper than at rest, tested over 5 heads x every style x every corner of the box). Same triangles, same draws; LOD0/1 only; merged crowd levels never build the attribute (`PartBuilder.sway = false` around `mergedGeometry`). Build cost about +13 ms per head (cached). Idle < 1 mm, run 2-8 cm, hard bounds `HAIR_SWAY_MAX` (5 / 1.5 / 8 cm); deterministic phase from the spec; `anim.motion` scales it (0.3 reduced motion).
2. **Nose-bridge ink** (`outline.ts` `hthin`, `sweep.ts hullThin`, `faceParts.ts`). Hull scale 0.4 on the bridge (t < 0.66 of the spine), back to 1.0 over the ball; skull, jaw, brow untouched. Props and limbs read 0 (default attribute), so the whole line.
3. **Closed eyes** (`faceAnimate.ts`, `faceRig.ts`). Past half-shut the whole eye widens 10%, flattens 40%, shallows 15%: visible closed lid width:height 2.3-3.2 on the 5 test heads (was 1.4-1.6); lid rim 16-gon at LOD0. Open and half-lidded eyes unchanged.
4. **Moods** (`moodBody.ts`, `animator.ts`). Exhaustive `MOOD_BODY: Record<ExpressionId, BodyMood>`; smug, disgust, surprise, laugh, sleep have bodies; the original five stay inline (their rows are `NONE`) and match golden poses within 1e-6. Mood weights now follow intensity (0 = neutral). Nothing while downed; air halves out via `free`.
5. **Hip gear** (`armClearance.gearOnSide`). Gear is measured from the widest the body gets over its span (as gear.ts places it), the sabre's scabbard swings out toward the chape, and a gear-side arm may rest to 1.0 rad.

| fit ratchet (default sweep, FIT_SHAPES=2) | before | after |
|---|---|---|
| trunk poseClip (count / worst cm) | 154 / 6.0 | 110 / 5.9 (ratchet 115 / 5.9) |
| hip gear poseClip, stubbyWide, every jacket | sabre walk 6.0-6.7 | worst 3.0 (`hipGear.test.ts` <= 3.0) |
| head headPenetration | actual 0 (ratchet 1.2 / 18) | ratchet lowered to 0 / 0 |
| trunk / limbs garmentPenetration | 2.3 / 1.7 ratchet | 2.2 / 1.6 ratchet |

`FIT_SHAPES=6` fails the EXISTING trunk garment/accessory/floating ratchets (3.0 cm, 28 findings, 2.3 cm floating): static fit, untouched by this package (they are calibrated for the default sweep). poseClip there: trunk 115 / 5.9, limbs 86 / 8.1.

Mutation checks (broken, seen to fail, reverted): hair weights = 0; hair limits removed; nose `hullThin` not passed; `SLIT_FLATTEN = 0`; `spanWidest` = 0; mood table `sleep: NONE`.

## Highmark skyline (apps/client/src/render/world/highmark)

`skyline.ts` is the data (lit tower, bell-gable, masts, pinnacles, terrace masts, extra banners); `structures.ts`, `cloth.ts` draw from it; `landmark.ts` is the haze answer; palette gained `roofDeep`, `lanternGlass` (swatch keys untouched).
- Lit tower 8+ m over the palace ridge (top 30.4 m above the plateau vs ridge 17.35), glazed lantern room whose glass is its own mesh (`palace-lantern`): slate by day, amber at the harvest bell hour (`applyDay`). Taller bell-gable, 4 tier-two pinnacles, 2 base-corner masts, 2 gate masts, stepped crests on every hall, the gate and the palace, merlons on the gate towers, deeper roofs.
- Cloth: 14 extra banners (gate lintel, gate masts, palace masts, 8 terrace masts), cloth triangles 748 -> 2428, all inside the atlas.
- Haze: the capital's material keeps 42% of its pre-fog colour from 70 m to 190 m (less in fog weather), its ink floor is 85% of the line (was 42%). Fog itself is 94% at 200 m.
- Measured (`view=capitalfar`, time=13, 1280x720, rows 290-392 x cols 420-870): luminance of walls vs haze behind 0.012 -> 0.086; band std 0.0995 -> 0.1315; p5-p95 0.302 -> 0.398; edge gradient 0.032 -> 0.066. All rose.
- Budgets (frozen) still hold: test 66.0k -> 69.6k of 120k, low 127.3k -> 130.8k of 170k, medium 386.4k -> 392.6k of 440k, high 513.6k -> 519.8k of 540k tris; meshes +1 (the lantern).

## Looked at

Lineup: nose 3/4 before/after (3 noses), closed eyes before/after (4 heads), hair-sway filmstrip (6 gait phases, ponytail, plait, mohawk-style), 11 expressions at intensity 1 in a row. Highmark: capitalfar, capital, palace, gate at time 7, 13, dusk; capitalfar dusk zoom on the lit lantern. Not looked at: hip gear on stubby bodies in a still after the 1.0 rad cap (measured only), lineup at LOD1/2, any real GPU.

## For the integrator

- `CharacterActor`/`Game`: set `anim.motion = getReduceMotion() ? 0.3 : 1` (the animator does not know the setting). DONE by the integrator in `CharacterActor.update` (not looked at under reduced motion).
- Authored-copy files: none (no `*Text.ts` / `*Copy.ts`).
- `highmark.ts` frozen; nothing asked of it.
