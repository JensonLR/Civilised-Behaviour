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

---

# Second pass: drapes, hands, rig cost, creator, fine cosmetics (2026-09-30)

## What changed
1. **Cape and poncho are draped garments (`three/drape.ts`, was in `garments.ts`).** Open at the front (cape: slit neck and a clasp; poncho: a slit neck and tassels), six pointed panels
   at the hem, a two-layer cloth (`thick`/`lining`/`rim` in `patch.ts`; the lining is a second colour, visible from below and at the open edges). The torso piece is fitted to the body
   with a clearance rule (`clearance()`: never wider than `shoulder - 1.5 x arm radius`, never inside the body + 2 cm) so the arms swing through free air; the part that
   covers the upper arm is carried on the upper-arm bone (`dressArmDrape`, `drapeCover`) so it follows the arm instead of being cut by it. `drape.test.ts` walks the animator's real
   pose envelope (every locomotion state x the extreme arm angles, portly and slim bodies) and asserts no arm/forearm vertex ends inside the cloth.
2. **Sideburns 4-6 are tapered whiskers (`faceParts.ts` `Whisker`).** Wing (bushy), Piccadilly weepers (long, curling forward) and sculpted points, each a swept tube with its own taper.
3. **Believable hands (`three/hand.ts`).** Palm, four fingers (two knuckle sections each) and a thumb, swept along skin-coloured tubes. `rig.setHandGrip(side, 0..1)` (0 open, 1 a fist)
   drives **two relative morph targets** on the forearm mesh (no extra draw call, no extra triangles, Lagrange weights `4a(1-a)` and `a(2a-1)` so grip 0, 0.5 and 1 are exact). Gloves
   follow the fingers (white cotton, leather, fingerless, fur mitts are one mass with a thumb, gauntlets flare at the wrist and stay put). `HandPoser` (`animatorExtras.ts`, used by
   `CharacterActor` and `CreatorPreview`) picks the grip from expression / carrying / sprinting / held weapon and eases it (closing faster than opening). Crowd levels: one fist, no morphs.
4. **Rig cost.** Face parts (eyes, lids, brows, mouth, teeth) are cached as shared geometry and materials (`faceRig.ts` `cachedGeo`/`cachedMat`) and built **lazily** (nothing at LOD2, on
   first need at LOD0/1; `dispose()` never frees the shared ones; `clearCharacterCaches` clears them). Clone cost of a cached look, avg (Node, `scripts/char-bench.ts`, 60 seeds, ms):
   LOD0 1.77 -> 0.4-0.6, LOD1 1.65 -> 0.4-0.5, LOD2 1.59 -> 0.15-0.2 (the range is machine noise: other agents share this box). LOD1 triangles avg 5.7k -> 4.55k.
5. **Coat skirts** have a rolled hem, a thickness, and an inward-facing lining loft visible from below (`garments.ts` `dressSkirts`, `LoftOptions.inward`).
6. **Decals** (chalk, zinc, soot) fade at the edge (`faceDecor.ts` per-vertex `soft` and an edge ring), so they no longer read as flat stickers at grazing angles.
7. **Ragdoll hinge limits** were mirrored (knees folded forward, elbows backward). `HINGE_LIMITS` are now in the rig's own rotation convention (knee bends -x, elbow +x) and `seedPose()`
   clamps the seeded animator pose into them, so a body knocked down mid idle-act no longer starts outside its limits. The `anim.autoBlink = false` workaround is gone from `Ragdoll.test.ts`;
   two new tests (limit signs; every seeded pose is legal) and a mutation check guard it.
8. **Tricorn and busby (`hatsGeo.ts`)** are real shapes now (three-cornered folded brim with a cockade loop; tall fur cap with a plume and a cord), and `hatHair.test.ts` audits every
   hat x every hairstyle x beard/sideburns on small, average and big heads: a ray up from every hair vertex above the hat band must hit hat. This found and fixed curls pushing through
   crowns (`hair.ts`: curls are capped at `hatSeat - 0.23`).
9. **Creator (`apps/client/src/ui/CharacterCreator.ts` + pure `creatorLogic.ts`).** Sections inside each tab, "Shuffle" per section and "Randomise all" (campaign history and the
   `HISTORY_KEYS` are never touched), undo/redo of 20 steps (drag of a slider is one step), copy/paste of the look code with validation errors in words (`explainCodeError`), a pose
   picker (Turntable, Walk, Idle, Pain, Triumph; a `cb:creator-pose` window event, so creator and preview know nothing of each other), eight curated presets (`PRESETS`, all round-trip
   through the wire format, none carries history), keyboard/PadNav/accessible (labelled controls, `aria-live` status, visible focus). 30+ tests in `creatorLogic.test.ts`.
   `?showcase=lineup&presets=1` shows the presets.
10. **Fine cosmetics (append-only batch 3, indices 64..71, salt `0x3c1e9b47`).** Fields: `medalStyle` (round / draped ribbons / crosses / stars), `buckle` (square / round disc / oval plate /
    double prong / crest plate), `cuffDetail` (plain / button row / gold links / buckled strap), `laces` (standard / crossed / bowed / buckled straps), `pocket` (none / breast / pocket
    square / flap pockets / pens and pencils), `hairAcc` (none / ribbon bow / tortoiseshell comb / hairpins / silk flower / feather pin), `patchStyle` (plain / skull badge / bandage /
    jewelled) and `scarStyle` (straight / jagged / stitched / forked). The last two are the style of a campaign injury, so they are in `HISTORY_KEYS` (server-owned, never set by a client,
    kept by `rerollAppearance`, 0 for every generated recruit). Eyewear 11-13 (owl specs, corded pince-nez, green visor) are appended to the existing list (the monocle already had its chain).
    New palette entries (`trim`, append-only): `visorGlass, tortoise, bronze, blossom, pencil`. Code: `headExtras.ts` (accessories, patch badges, scar paths), `torsoTrim.ts` (`medal`,
    `buckleAt`, `addPockets`), `limbs.ts` (`cuffDetail`, boot fastenings). Hair accessories sit on the right side of the head over the hair; **under a hat they drop low behind the ear**
    (the feather hangs down) so nothing pokes through a crown (`hats.test.ts` asserts it for all 20 hats x 5 accessories). Pockets, cuff details and boot fastenings are LOD0-only.
    Nothing here depends on gore (scars use `face.scar`, not the wound stains), so Gore Off changes nothing. All eight fields are in the audit (`NEEDS` gives each a base where it shows).

## Numbers (Node, `scripts/char-bench.ts`, 60 seeds)
| level | tris avg / max | meshes avg | cold build | clone (cached) |
|---|---|---|---|---|
| LOD0 | 11804 / 14274 | 25.8 | 39-53 ms | 0.43-0.68 ms |
| LOD0 + hulls | 15522 / 19068 | 36.8 | 48-76 ms | 0.44-0.65 ms |
| LOD1 | 4548 / 5719 | 19.8 | 15-22 ms | 0.38-0.47 ms |
| LOD2 | 1368 / 1857 | 10.8 | 6-7 ms | 0.15-0.18 ms |
Budget: LOD0 avg <= 12k and max <= 15k (both met, 196 tris and 726 tris of headroom left); LOD1 < 4.6k (tested); the 4.5k aim is missed by 1%.

## Review commands (new lineup switches: `elev`, `orbit`, `arm=`, `grip=`, `ty`, `tx`, `presets=1`)
```
node scripts/shot.mjs "?showcase=lineup&n=4&same=0&frame=upper&sp=1&arm=..."                      # arm poses for the drape clip check
node scripts/shot.mjs "?showcase=lineup&n=1&close=0&ty=0.68&tx=0.1&cd=0.7&cx=0&cyo=0&set=jacket:2,medals:5,medalStyle:1" out.png 640x420   # medals, close (tx>0 is the character's left)
node scripts/shot.mjs "?showcase=lineup&n=5&same=0&heads=1&vary=hairAcc&voff=1&turn=0.9&set=hair:1,hat:0" out.png 1700x520                 # accessories
node scripts/shot.mjs "?showcase=lineup&n=4&same=0&heads=1&vary=scarStyle&set=scars:5,eyepatch:0" out.png 1400x520                         # scar styles
```
(Only the FIRST `set=` is read; put every override in one.)

## Weak spots after this pass (honest)
- Fixed since the list above: capes/poncho closed bells and arm clipping, fist-only hands, per-instance face rebuild, decal flatness, ragdoll elbow overshoot, coat-skirt thickness.
- Boot laces and cuff details are a few centimetres of geometry: at gameplay distance they read as a speck (they matter in the creator and in close-ups). Laces on ankle boots are
  barely visible because the shaft is only ~4 cm; slippers, clogs and Wellingtons ignore the fastening choice (nothing to lace).
- Pockets are not drawn under a cape or poncho (they cover the torso); flap pockets sit near the coat's own waist flaps on frock coats and can look doubled.
- The ribbon bow, pins and feather are readable in profile and three-quarter view; from straight ahead they are hidden by the head. The comb is only visible from behind.
- The medal `Crosses` bronze on a gold-toned coat has little contrast (the palette, not the shape).
- Hand grip morphs are LOD0 only; at LOD1 a gripping crowd member shows a fist either way. The hand test bounds the fist size but does not check finger-finger penetration.
- Only LOD0 is audited item by item; LOD1/2 are covered by triangle budgets, the finite-geometry sweep of 150 people and `lod.test.ts`.
- `weaponPose.test.ts` (combat stream) currently fails on one reach-limit case; unrelated to this work.

---

# Limb fit pass (agent L, 2026-09-30): every sleeve, cuff, glove, hand, trouser leg, boot and prosthesis fits any body

Trigger: "ugly overlaps with cosmetics and wearables; everything must fit perfectly, whatever the size or shape". Evidence was the slider extremes (thick/short, thin/tall, big limbs).

## What was wrong (measured, not guessed)
- Cuff stripes, cuff bands, buttons, garters, knee patches, epaulettes, boot straps and laces were positioned with absolute offsets from a *guessed* radius (`r * 1.02`, `legR * 0.87`), while the sleeve tapers
  to 0.82 r at the wrist: naval stripes floated 2 cm off the cloth, epaulettes hovered 1.5 cm above the sleeve head, elbow patches sat *inside* the sleeve.
- Arms hung at a fixed 5 degrees, so on a body whose hips, belly or coat skirt are wider than its shoulders the sleeves, cuffs and hands were inside the skirt (thin/tall in a frock coat: both arms vanished).
- Breeches, jodhpurs and plus-fours were wider (1.6-1.7 x leg radius) than half the hip spacing: the two thighs interpenetrated; on short legs the boot's ring table ran *backwards* (inverted geometry).
- A shin ring and the thigh ring above it were different sizes at the knee, so the overlap zone z-fought (teeth at the knee of breeches); a small foot under a stout leg made a shoe narrower than the ankle.
- A gauntlet ran up past the elbow on a short forearm; the sole sank 6 mm into the ground, the peg's tip 1 cm.

## How it is built now
1. **One ring table per limb region, `three/limbRings.ts`.** `upperArmRings`, `foreArmRings` (sleeve, elbow crease, the cuff hang, and a last "tuck" section that closes the sleeve onto the hand's wrist),
   `upperLegRings`/`trouserRings` (every cut, clamped to `legRxMax = hipWidth - 4 mm` so legs never touch), `lowerLegPlan` (shin + boot shaft + the two as one `surface`; the boot is never lower than the
   shoe it stands in, the shin starts a hair inside the thigh's last section), `footDims` (the shoe is at least as wide as the ankle it carries, at least twice as long as wide, heel behind the leg).
   Builders, the wound dressings, the prostheses, the fit engine's worn layer (`fit/worn.ts` should call `foreArmRings`/`lowerLegPlan` instead of its copies) and the new tests all read these.
2. **Everything on a limb is placed by asking its table, `three/limbKit.ts`.** `limbSurface(rings)` answers a point and a normal *on the loft polygon* (the loft is 10-sided, so a smooth-curve answer sinks
   into the flat by up to 5% of the radius); `bandOn` (cuffs, turn-ups, boot folds, garters, gauntlets: the table's sections lifted by a limb-proportional `clothLift(r)`, rolled edges),
   `patchOn` (knee/elbow patches, mends, mud, stitched rims: masked pieces of the limb's own surface in metres), `stripOn` (stripes, side braid), `mountOn`/`buttonOn`/`boxBetween` (buttons, buckles,
   tassels, threads). Nothing on a limb uses an absolute radius any more.
3. **Arms clear the body (`three/armClearance.ts`).** `bodyOutline(spec, P)` = the widest of torso, coat skirt (the real skirt rings) and hips/legs at each depth below the shoulder;
   `armRestAbduction` = the smallest resting abduction (0.08..0.5 rad) at which elbow, forearm and the back of the hand clear it. The animator adds the difference to its 0.08 base (not while carrying,
   hauling, kneeling, airborne-scaled). `kneeFlexLimit` caps the knee bend by the leg's thickness (a stout or short leg cannot fold as far as a thin one).
4. **Hands.** Palm is one rounded block narrow at the wrist and as wide as the four fingers across the knuckles; fingers touch (pitch = width), darker bands at the knuckles, no knuckle spheres (-40 tris);
   the thumb springs from the thenar. Gloves are bands on the forearm table (gauntlet length = a fraction of the forearm, flare over the sleeve's own cuff; fur mitts bulge). The sleeve's end is tucked onto
   `wristSize(P)`, which is tied to the hand radius, so a tiny hand in a big sleeve and a huge hand in a small one both join cleanly.
5. **Tried and dropped: wrist roll.** Rolling the forearm so the fist's axis lies along the weapon's grip changed the mean axis error by at most 0.17 rad (rifle at the hip 1.04 -> 0.87, sabre 1.44 -> 1.39, the rest within 0.02): the forearm
   points along the blade or barrel, so no roll can turn a fist (whose axis is across the forearm) onto it. A real fix needs a wrist joint (hand as its own bone, not a morph: the outline hull must bend with it); the holds read fine
   without it (rifle, pistol, sabre and umbrella checked from three sides with the real models).
6. **Boots.** Laces/eyelets/tongue/straps run along a *front line* (over the shoe's own instep sections, then up the shaft) so they lie on the surface of the shoe and the boot at any size.
   Sole underside is exactly y = 0; the peg tip too. Hobnails are cones. Puttees follow the leg's polygon. Spur and buckle sit on the shaft's surface.

## Numbers (Node; before = the commit this pass started from, measured with the same script on a worktree of it: `/tmp` scratch `cmp.mts`, 11 bodies x gaits)
| | before | after |
|---|---|---|
| limb bones, average triangles at LOD0 (60 seeds; foreArm x2, lowerLeg x2, upperArm x2, upperLeg x2) | 3399 | 3294 |
| sleeve / cuff / hand vertices inside the coat skirt, hips or thigh: worst over 7 gaits x 7 coats x 11 bodies | 14.2 cm (12-14 cm on most bodies: the arms are simply inside the skirt) | 2.8 cm (one body: the tiny-torso, wide-hip slider corner in a sprint; most bodies 0-2 cm) |
| left thigh vertices inside the right thigh (5 trouser cuts, rest and 7 gaits) | 3.3 cm (jodhpurs, baggy, breeches) | 0.0 |
| lowest point of the legs in the rest pose (9 boots, 2 leg kinds, 11 bodies) | -11 mm (the peg tip; soles -6 mm) | -2 mm (hobnail heads), soles and peg tip exactly 0 |

## Tests (`three/limbFit.test.ts`, 12 tests, ~45 s; 80 generated people included)
ring tables sound on 130 bodies (monotone, finite, legs never touch, shin continues thigh, sleeve closes on wrist, shoe carries ankle); details on limb (vertex-level vs the ring surface: floats, sinks, buried);
arms vs skirt/hips/belly in 7 gaits x 7 coats x 11 bodies; left vs right leg in all gaits; sole on ground for 9 boots x 2 legs;
limb triangle budget. `LIMB_VERBOSE=1 npx vitest run src/three/limbFit.test.ts -t "details sit" --disable-console-intercept` prints findings grouped by option.

## Review switches added to `showcase/Lineup.ts`
`act=0` (no idle acts: fit stills differ from figure to figure otherwise), `focus=handR|wristL|foreArmR|upperLegR|lowerLegR|kneeL|footR|legsR|body` with `fd fa fe ffov` (camera aimed at a body part *by
proportion*, so a contact sheet of one figure per page frames every option alike), `fc`/`fh` (frame centre/height in metres), `wield=rifle|blunderbuss|pistol|sabre|umbrella` `aimw=1` `sw=0.4`
(the real weapon model in the hands, hands closed on it), `pose=aim|pistol|sabre` now draw the weapon. Contact sheet driver used for this pass: one page per option, composed in a scratch Playwright page.

## Weak spots (honest)
- T's fit audit still counts the shoe (a 96-triangle loft on the lower-leg bone that is *meant* to cover the ankle) and mitten fingers as penetration of the leg / a hand ellipsoid: those "findings" for
  boots and fur mitts are a modelling mismatch of the audit, not clipping. Fix on the audit side: a "foot" region above the ankle, or skip the foot loft.
- Very wide bodies with narrow shoulders (pear shapes) hold their arms out up to 0.5 rad (29 degrees); a smaller angle would need a narrower coat skirt (garments) or thinner thighs.
- A rigid rig cannot fold a stout leg all the way: deep crouches on fat/short legs stop earlier now (`kneeFlexLimit`), the calf/thigh overlap at the joint itself is inherent.
- The hand has no wrist joint: a fist's axis is fixed across the forearm, so a weapon whose grip axis lies along the forearm (sabre thrust, rifle stock with the arm down the barrel) is held with the blade/barrel coming out of the fist along the arm (reads as a punch-dagger grip).
- Hands: still one chunky block per hand (caricature); a fingerless glove's bare finger ends and a mitt are single sweeps. Grip morphs are LOD0 only.
- Epaulette fringe and tassels are 6-mm boxes: they read in the creator and close-ups only.

---

# Third pass, agent H: everything on the head fits any head (2026-09-30)

Problem: caps with detached "propeller" brims, long hair as a detached curtain, loose-stick moustaches, pasted-on ears and spectacle arms; the audit only checked bounding boxes.
Principle: nothing is placed by an absolute offset. Everything asks the head (`headFit.ts`) and offsets along its normal.

## What changed (all in `packages/procedural/src/three`)
- `headFit.ts` (new): `headFit(fc)` = the head fit kit. `section(y)` skull cross-section radii; `outer()` skin plus hair; `ear(sx)` real ear anchors (top, lobe, front, back, outer) from `earModel`; `nose()` (from `noseShape.ts`: spine, `frontZ(y)`, `widthAt(y)`); `bodyDist` / `solidDist` / `pushOut` (neck, coat, arms via agent T's `makeBodyField`); `clearRadius` and `hangProfile` (the shoulder-clearance function: hair/veils/tails fall from the widest part of the head, follow the neck and shoulders, and end where they land instead of leaping over a shoulder). `starLoft`/`addStar`/`addBrim` build crowns as lofts through the skull's own sections and brims as two-layer patches rooted on the crown wall; `addConformedSweep` pushes every vertex of a tube out of the skull/neck/coat.
- `hatsGeo.ts` rewritten: 21 hats are `dome()`/`column()` crowns from `hf.section` plus hair thickness (`hairBandThickness`, measured from the hair plan), brims rooted on the crown wall (top hat rolled sides, pith shelf, shako/kepi/peaked visors as tongues, tricorn, bicorne folded at front/back with upturned points, sou'wester tail, deerstalker peaks), bands/cords/badges/trims placed by `Crown.at(phi, y)`; veil of the veiled pith is a `hangProfile` patch resting on the shoulders; nightcap tail hangs by `hangProfile`. `head.ts`: the band rises over tall ears (`hatSeat`).
- `hair.ts` rewritten around a plan (shells + extras): long lank and shaggy mane are curtains on the fall profile (fixed-resolution profile, so LODs share the silhouette), ponytail/plait leave the head at the tie and fall down the neck (conformed), hairlines are smooth ramps and open round the ear (`hole`), locks are densified in direction space and stop before the ear. `hairLiftFn` gives the hair thickness in any direction (bows, combs, pins, straps and the audit use it); `hairCoversFn` lets the skull skip cells fully under hair. `shell.ts`: strand grain, `settle` hook, lift fades with coverage.
- `faceParts.ts`: ears are a dished plate (rim + bowl) hinged at the front edge and pushed out of the skull, from `earModel`; earrings pass through the real lobe; nose from `noseShape.ts`; moustaches are ONE bar tip to tip with an arc-shaped curl and are conformed; beards root in the skin, lie on the chest (`clearRadius`, `settle`, `addConformedSweep`), jaw-beard edge ramp widened; Piccadilly weepers hang beside the neck.
- `eyewear.ts` (new, moved out of head.ts): lens plane in front of brow/cheek (`zFor`), bridge arches over the real nose, pads on its flanks, arms rise over the top of the ear that exists and hook behind it, straps loop over hair and ears (below a hat band), chains/cords pushed off the beard and coat, eyepatch strap over the ear.
- `headExtras.ts`: bows, combs, pins, flower, feather sit on the hair as seen (`hf.outer`); pins are stuck through the hair and point down under a hat. `faceDecor.ts`: neck swallows are laid on the skull side. `headShape.ts`: `omit` (skull cells fully under hair are not drawn).
- Tests: `headFit.test.ts` (new, real measurement: skull depth, body depth, floating gap for every option on tiny/huge/narrow/heavy/worst-body heads; ratchet), `headAudit.ts` (labelled primitives), `hatHair.test.ts` now uses it, `hats.test.ts` compares with the skull top. Agent T's `fit.test.ts` head ratchet lowered.

## Numbers
- `fit.test.ts` head group (FIT_SHAPES=6, head fields): headPenetration 173 findings / 8.7 cm worst before, 16 / 1.1 cm now (eyepatch on a tall thin head only); floating 16 / 6 cm before (hair pins), 0 now.
- `headFit.test.ts` (15 fields x 5 head shapes, plus hat x long hair x wizard beard): skull sink worst 1.4 cm (a plume socket), body sink worst 1.4 cm (hem of a mane resting on a very narrow jaw's shoulder), floating 0.
- Head triangles avg (150 seeds): 4412 before, 4414 now; LOD budgets unchanged.

## Weak spots (honest)
- Face-quality work asked for (eyelid/brow shapes, nostril and lip sculpt, neck-to-jaw blend, catchlights) was NOT done in this pass; only ears, nose data, hair grain and hairline ramps changed.
- Long-hair curtains are one smooth sheet with a ragged hem: from behind they read as a cloth, not as strands; the front locks of Long Lank are still simple ribbons.
- Nightcap tail and busby bag are hung by heuristics and were reviewed on a few heads only. Hats are reviewed at 3 angles on tiny/huge/average heads; extreme ear + hat combinations are only covered by the numeric audit.
- Screens were reviewed on the software renderer; toon shading of thin brims can flicker at grazing angles.
