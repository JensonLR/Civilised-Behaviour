# Notes for DECISIONS / ART_DIRECTION: the character and cosmetics upgrade (2026-09-29)

Proposed entry **D-027 Garments are patches of the body's own surface; faces carry decals; crowds get real levels of detail.** Extends D-020 (lofts), D-021 (sculpted faces),
D-022 (one palette), D-023 (limbs and prosthetics). Everything below is in `packages/procedural` unless a path says otherwise.

## What changed and why
1. **Garments hug the body by construction (`patch.ts`, `garments.ts`, `torsoTrim.ts`, `limbs.ts`).** A `patch` is a masked piece of a parametric surface (the torso's
   own superellipse sections, a coat skirt cone, a veil): the mask is a signed distance (`inside`) turned into a coverage ramp a few cells wide, so the piecewise-linear
   cut lands exactly on the zero line and edges are smooth curves instead of a staircase (same idea as the hair shells, generalised). Waistcoat V's, lapels, shawl
   collars, frock-coat tails with a centre vent, capes, ponchos and the veil of a veiled pith are all patches or lofts on these surfaces, so nothing floats or sinks.
   Each jacket has its own torso cut (`JACKET_CUT`: nipped waist for frock and reefer, bulk for the greatcoat, boxy for hunting and Norfolk), collar (stand, fall, shawl,
   wing, shirt points), front, skirt and cuffs. Collars are sized from `neckRadii(P)` (the head's own neck), never smaller than the neck they sit on.
   *Lessons recorded:* (a) a hand-made mask that saturates inside one grid cell produces a sawtooth edge: always use `inside`; (b) two surfaces that cross at low tessellation
   show a sawtooth too, so under a closed coat skirt the thigh is slimmed to a core and the trouser top is tucked, and skirts are sized from `hipWidth + legRadius` in
   depth as well as width; (c) a dressing must lie on what a player sees: wounds over a cape or poncho use `outerTorsoRings`.
2. **Legs are slimmer (`legRadius` 0.10 x scale + 0.02, was 0.12; `hipWidth` >= 0.18).** The thigh pillars were as wide as the torso; coats could not drape over them.
3. **Faces gained marks that live on the skin (`faceDecor.ts`, `look.ts`, `headShape.ts`).** Freckles, sun spots, moles, warts, birthmarks, face paint (rouge, chalk stripes,
   soot mask, sunburnt bridge, zinc nose), tattoos, burns and age lines (forehead, frown, laughter lines, crow's feet, eye bags scale with the `age` slider) are decals: a fan or a strip
   of triangles projected onto the sculpt with `shape.front` and lifted 1.1% of the head radius (big ones get an inner ring so no triangle sinks between two skull facets).
   They are flagged morphable, so they move with the jaw, smile and squint. Stubble and ruddy cheeks are baked into the skull's vertex colours (`SkullOptions.paint`).
   Greying is per place (temples, streaks, silver) through `ShellSpec.tint`; brows, moustache and beard use the whole-hair grey.
4. **Hair has strands (`hair.ts`).** A `lock` is a thin ribbon laid on the head along an azimuth/height path with its wide side on the surface (shell + locks = layered hair).
   New styles: ponytail, plait (a pulsing braid cable), monk fringe, comb-over, thin wisps, shaggy mane, mop top. Locks are LOD0-only.
5. **21 hats in `hatsGeo.ts`** (fez, veiled pith, tricorn, kepi, deerstalker, topee, nightcap, busby, sou'wester, wide-awake added), all seated by `HAT_SEAT` + `shape.widthAt` +
   the `topH` rule, plus five hat trims (goggles on the brim, feather, cap badge, cockade, ribbon tails) placed by a per-hat band table.
6. **Cosmetics expansion (append-only).** See "New spec fields" below. Gear (`gear.ts`) gained ascot, neckerchief, ruff, fur collar, muffler; tin trunk, rifle, easel, birdcage, umbrella;
   sabre, machete, coiled rope, pocket watch, cartridge pouches. Belts (`torsoTrim.ts`): rope, ammunition belt, cross belts, bandolier; sashes: cross sashes, tasselled waist, order ribbon.
7. **Prosthetics (`prosthetics.ts`, `rig.setMissing`).** A lost leg whose side matches `spec.woodenLeg`, or a lost arm matching the new `spec.hook`, is fitted with a leather socket on
   the stump and a peg or iron forearm hanging from the knee/elbow joint (so it swings with the animation); an intact limb on that side wears the peg or the hook instead of shin and hand.
8. **Crowd levels of detail (`rig.setLod`, `buildCharacter(spec, { lod })`).** One cache key per (bone, spec, level); the hierarchy, joints and the face object are identical at every
   level (only the bone meshes swap), so the animator, ragdoll and actor keep every reference. Mechanics: skull grids 32x24 / 22x16 / 14x10; primitives below a bounding radius are dropped;
   tubes and rings thinner than 5 cm (LOD1) / 12 cm (LOD2) are dropped by their *cross-section* (a diagonal strap has a big box and no volume); lofts lose segments and every other interior
   section at LOD2; hands lose fingers at LOD1; the LOD2 head has no nose sweep, ears, moustache or eyes (the face root is hidden); no morph targets from LOD1.
9. **Animator.** Counter-rotation in run/sprint, wind-up before a jump and a landing spring, crouch, banking into turns, idle acts (hat, watch, look, shrug, stretch...), pain/fear/
   triumph/anger/drunk change the body as well as the face (all pre-existing in the previous slice; now under `animator.test.ts`). The "check the watch" idle act was capped at 1.75 rad of
   elbow flex because a body knocked down mid-act started the ragdoll near its elbow limit.

## Audit (the test that keeps the catalog honest)
`three/audit.test.ts` builds EVERY option of EVERY choice field (flag bits and sampled colours too) on three of eight body shapes (six archetypes + all-sliders-0 and all-255) and asserts:
finite position/normal/colour; every primitive faces outward (`PartBuilder.audit` records a per-primitive outwardness; open sheets are checked against the normals they carry);
no floating primitives (all primitives of a bone form one connected cluster, gap 1.2 cm: caught a rucksack, a specimen case, a birdcage, an umbrella crook, a plait and a boot buckle
that floated on short legs); the option changes the rig; and it differs from the option before it (an unfinished option that falls through to a default). Plus 150 generated people.
`PartBuilder.audit` / `auditTag` / `auditKind` are test hooks (never set in the game); `?hide=pelvis,upperLegL` in the lineup switches bone meshes off to see what lies under a garment.

## New spec fields (batch 2, indices 43..63; `FIELD_BATCHES[1]`, salt 0x7f4a7c15)
brows, eyeShape, eyeColor, earShape, stubble, greying, age (slider), complexion, mark, facePaint, tattoo, earring, ring, epaulettes, decoration, coatTrim, trouserTrim, shirtColor, bootColor,
hatTrim, hook (history, server-owned, in `HISTORY_KEYS`). Options appended to existing lists (order is the wire format): noses 6-7, hair 10-16, moustaches 10-13, beards 8-12,
sideburns 4-6, hats 11-20, jackets 6-10, shirts 4-6, trousers 4-6, boots 4-8, belts 3-6, eyewear 5-10, sashes 3-5, neckwear 4-8, packs 5-9, hip gear 5-9, gloves 3-5; scar bits 32/64/128
(nose, claws, burn), teeth bits 16/32 (buck, crooked); `scars` max 255, `teeth` max 63. Old looks decode (missing trailing bytes read as 0); old seeds keep their people (frozen option
counts per field feed the main stream, appended options arrive through their own `novelty` stream, batch 2 has its own stream) - all tested in `spec.test.ts`.
New palette entries only in `trim`, `material`, `face` (append-only): zinc, rouge, feathers, ribbons, gems, pearl, puttee; five leathers, rubber, fur, rope, linen; tattoo ink, gum, lash.
`palette.test.ts` covers them (leathers distinguishable, ink reads on all, zinc pale, tattoo readable on every skin tone, irises against sclera and pupil).

## Review commands
```
node scripts/shot.mjs "?showcase=lineup&n=6&seed=90&frame=body&sp=1.25&turn=0.35" out.png 1800x800            # a cast, whole bodies
node scripts/shot.mjs "?showcase=lineup&n=6&seed=90&frame=upper&sp=1&same=1&vary=jacket&turns=0.5" out.png   # one person in every jacket (voff=6 for the rest)
node scripts/shot.mjs "?showcase=lineup&n=5&seed=90&frame=face&sp=0.78&same=1&vary=moustache&voff=9&turns=0.15" out.png 1800x480
node scripts/shot.mjs "?showcase=lineup&n=5&frame=head&same=1&vary=hat&voff=11&set=hair:1" out.png 1500x600  # hats 11.. ; hatTrim:1..5 for trims
node scripts/shot.mjs "?showcase=lineup&n=6&frame=face&same=1&expr=neutral|pain|fear|triumph|drunk|angry" out.png 1800x460
node scripts/shot.mjs "?showcase=lineup&n=5&frame=body&same=1&missingVary=1&set=woodenLeg:1,hook:2" out.png   # prosthetics
node scripts/shot.mjs "?showcase=lineup&n=6&frame=body&lod=mix&outline=0" out.png                             # LOD0/1/2 side by side
```
New lineup switches: `frame=face`, `voff=N`, `hide=bone,...`, `lod=mix`.

## Weak spots (honest)
- Cape and poncho are closed bells: they read as a bowl from above and arms clip through them at extreme swings. Tricorn and busby are approximations (plates, no fur texture).
- Hands are still fists (fingers read only when the camera is close); gauntlets and mitts are cuffs on the same fist.
- Coat skirts are single-sided patches without thickness; the hem relies on the ink outline for its edge. Thighs poke through an OPEN frock-coat skirt only when the pose is extreme.
- Face parts (eyes, lids, brows, mouth) are rebuilt per rig instance (~2 ms even for a cached look, and built but hidden at LOD2): crowds of hundreds need those cached too.
- Decals are 1 cm off the skin; from grazing angles and under the toon ramp a few pale ones (chalk, zinc) can look flat. Freckles on dark skin are subtle by design.
- The audit's connectivity rule (1.2 cm) is a bounding-box test: it catches floaters, not a part that is merely visibly too far out on a curved surface.
- Ragdoll started mid idle-act can overshoot the elbow limit by ~0.3 rad for a frame or two (the ragdoll test now runs the animator without ambient acts).
