# Fit engine: placing wearables by asking the body (agent T, 2026-09-30)

Everything in `packages/procedural/src/three/fit/`. Goal: a wearable is PLACED by projecting onto the body's surface and lifting along the normal, so it fits any size and shape by
construction; and a REAL audit (not bounding boxes) measures interpenetration, floating and pose clipping for every option of every field on a grid of body shapes.

## Files
| file | what |
|---|---|
| `torsoShape.ts` | THE torso cross-sections (`torsoRings`, `JACKET_CUT`): the torso loft, wound dressings, the field and every wearable read the same rings (was in garments.ts, re-exported there). |
| `bodyField.ts` | `makeBodyField(spec, worn?, P?)`: analytic signed-distance + surface queries of the bare body ("skin") and of the outermost garment ("worn"). No dependency on limbs/garments/drape. |
| `worn.ts` | `bodyField(spec)`: the same with the REAL worn rings (sleeves, trouser legs, coat skirt, poncho panel) built from the garments' own ring tables. `wornRings(spec)`, `shapeCtx(spec)`. |
| `layers.ts` | `LAYER` (standard lifts) and `FIT_TOL` (audit tolerances). |
| `shapes.ts` | `FIT_SHAPES` (the body grid), `plainBase`, `NEEDS`, option enumeration. |
| `penetration.ts` | `measure(spec)` builds LOD0 with the primitive audit and returns every primitive with vertices; `judgePenetration`, `judgeFloating`, `judgePoseClip`, `FitReport`. |
| `run.ts` | `sweepCases`, `runCase`: the option sweep (also usable from a script). |
| `fit.test.ts`, `fieldSanity.test.ts` | the ratchet test and the field's own checks (frames equal the built rig's; surface points are on the zero level set; lifted points sit `lift` out). |

## Spaces
BONE space = the frame a bone's mesh is built in (origin at the joint, +Y up, the face looks toward -Z, limbs hang down -Y). RIG space = the root's frame at rest (feet on y=0).
`field.toRig(bone, p)`, `toBone`, `toRigDir`. A posed rig: `field.withFrames(framesFromRig(rig))`.

## Querying
```ts
const f = bodyField(spec);                          // or makeBodyField(spec) inside limbs.ts / body.ts / head code
f.torsoSurface(y, phi, lift, "worn")                // {p, n} bone space; phi 0 = front, +pi/2 = the character's right
f.limbSurface("upperLegL", -0.2, phi, lift, "worn") // y below the joint is negative
f.headSurface([0, 0.2, -1], lift)                   // direction from the head centre; head bone space (centre at (0, R, 0))
f.sdf(rigPoint, "worn", cap?, regions?)             // negative inside; regions restricts to "torso" | "pelvis" | "neck" | "head" | "upperArm" | ...
f.nearest(rigPoint, "worn")                         // {point, normal, region, dist}
f.torsoSection(y, layer) / f.torsoRings(layer)      // the section table a strap or belt wraps
f.neck, f.anchors                                   // collar sizing, shoulder seat, neck base
```
`skin` is the flesh core (torso rings x BODY_CORE 0.9 - cloth is thicker than the body it covers), `worn` is what a player sees. Straps, packs, buckles and medals sit on `worn` at
`LAYER.strap / mount / pack` (centre-line offsets that leave ~2 mm clear); cloth of the body's own garments is judged against `skin`.

## Running the audit
```
pnpm --filter @cb/procedural exec vitest run src/three/fit/fit.test.ts            # ~50 s, writes test-results/fit-report.json (ranked; byOption, byShape, top findings with positions)
FIT_FIELDS=pack,belt FIT_VERBOSE=1 pnpm --filter @cb/procedural exec vitest run src/three/fit/fit.test.ts --disable-console-intercept
FIT_SHAPES=40 ...   # every body shape for every option (slow)   FIT_POSES=0  # skip pose clipping
```
Metrics (tolerances in `FIT_TOL`): `garmentPenetration` (a body garment's cloth deeper than 1.5 cm into the skin core; hard pieces 0.5 cm + half thickness), `accessoryPenetration` (a
strap / loft sunk more than 8 mm into the worn surface), `accessorySink` (a hard piece whose centre is buried), `floating` (a group of primitives that touches neither the body nor the rest
of its bone within 1.2 cm), `poseClip` / `poseExtreme` (NEW penetration, beyond the rest overlap, into a moving limb / the trunk in the animator's real states / at joint-range extremes),
`headPenetration`. Vertices whose normal points into the body (a hat's underside, a lining) and the centre vertex of cap fans are not counted; limb pieces are judged against their own limb
only (the rest pose hangs arms beside the thighs, which the animator never does).

## What T changed with it (trunk, agent T)
- `fit/surface.ts` `polySurface`: the trunk AS DRAWN (14-sided at LOD0; 8 / 6 at crowd levels: the loft caps its sides). Every hard piece, strap, medal, pocket and plate on the torso is placed on those faces
  (`torsoKit.ts`: `bandAround`, `ribbon`, `hangingStrip`, `frameAt`, `plate`); ribbons take their side axis from the smooth normal so they never twist at a face edge.
- Coat skirts (`fit/skirtShape.ts`) are derived from the torso's lowest section, the trouser-top rings and BOTH thighs as cut (`upperLegRings`), plus ease and a swing allowance; folds only ever go outward; hems are the patch grid's own edge.
- `fit/collarShape.ts`: one definition of the collar; neckwear wraps `neckOuter` (torso top + collar), sized from the neck radii.
- Gear: packs stand on the back's most prominent point over their height, straps run back -> shoulder top (found by the section's half-width) -> chest; hip gear stands off `f.reach(y0, y1)` (torso, skirt, thighs over the item's whole span); tails and cords are `pushOut`-ed of that envelope.
- The audit ignores hidden faces (normal into the body), fan centres of caps, torus centres, `PartBuilder.anchored` pieces (a collar's foot), and subtracts the bare body's own overlap in a pose (`bodyOverlap`): a coat is not blamed for a forearm inside a belly.
- Ratchet groups: `trunk` / `limbs` / `head` by the bone a finding is on.

## Rig pass (agent R, 2026-09-30): numbers and audit corrections
Bones: `handL/handR` are audit bones now (frame = the wrist joint; `framesFromRig` reads `wristL/R`), the hand ellipsoid belongs to them and they are judged with the forearm's family.
Audit-side corrections (honest numbers, not hidden ones):
- Legs are judged against the trunk's FLESH (`skin`), not the coat: a leg folded inside a closed skirt is hidden by the skirt (the skirt's own clipping is judged from the trunk side); arms stay judged against what is worn.
- A lower-leg piece below the shoe's top (ankle + `max(footH*1.6+0.04, footLength*0.27)`) is not counted as sinking into the leg core (the shoe is meant to cover the ankle).
- A hand piece may sit a quarter of the hand radius inside the hand ellipsoid (mitts, big knuckles); rings likewise for the sink test.
- Under a closed coat skirt the thigh's flesh core is no bigger than the slimmed trouser (`WornRings.slimLeg`).
Before (start of the pass, FIT_SHAPES=2 default sweep) -> after, worst cm / count above tolerance:
| group.metric | before | after |
|---|---|---|
| trunk.garmentPenetration | 2.9 / 5 | 2.2 / 1 |
| trunk.accessoryPenetration | 3.5 / 12 | 2.0 / 11 |
| trunk.accessorySink | 1.2 / 6 | 1.3 / 6 |
| trunk.poseClip | 6.7 / 183 | 6.0 / 154 |
| trunk.poseExtreme | 8.0 / 119 | 6.8 / 101 |
| limbs.garmentPenetration | 5.5 / 152 | 1.6 / 2 |
| limbs.accessorySink | 3.0 / 24 | 1.2 / 16 |
| limbs.poseClip | 21.4 / 111 | 8.1 / 84 |
| limbs.poseExtreme | 17.5 / 160 | 8.9 / 116 |
| limbs.headPenetration | 2.9 / 22 | 0 / 0 |
How much is real: the Baggy crouch 21.4 -> ~3 is mostly the audit correction (legs inside a coat skirt) plus thinner Baggy/plus-fours legs and the belly/skirt-aware crouch; neckwear poseExtreme 7.6 -> 3.7 and
the garment/sink numbers on jackets (thigh core under skirts) are real fits or corrections as listed. Ratchets in `fit.test.ts` are lowered to the new actuals. `limbFit.test.ts` thresholds are unchanged.
Remaining worst: hip gear vs swinging hand on the stubby-wide extreme (6.7), poncho/cape arm piece vs torso piece (8.1-8.9), birdcage 6.2, baggy skirt deep-crouch extreme 6.8.

