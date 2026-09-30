READY

The fit engine (agent T) is usable. Read `docs/_notes/fit.md` for the API and how to run the audit. Short version:

- Place things by asking the body: `import { makeBodyField } from "./fit/bodyField.ts"` (safe from limbs.ts / body.ts / head code: no dependency on them) or
  `import { bodyField } from "./fit/index.ts"` (tests and code that already imports limbs/garments: it also knows the REAL sleeves, trouser legs and drapes).
- `field.headSurface(dir, lift)`, `field.limbSurface(bone, y, phi, lift, layer)`, `field.torsoSurface(y, phi, lift, layer)` give a point + outward normal on the skin ("skin") or on
  the outermost garment ("worn"), `lift` metres out. Use `LAYER.*` from `fit/layers.ts` for the standard lifts.
- The audit: `pnpm --filter @cb/procedural exec vitest run src/three/fit/fit.test.ts` (about 50 s) writes `test-results/fit-report.json`, ranked per metric / field option / body shape.
  `FIT_FIELDS=hat,beard FIT_VERBOSE=1` runs only those fields and prints the summary. The test FAILS when a metric gets worse than the RATCHET table at the top of `fit.test.ts`
  (per group of bones: `trunk` = torso/pelvis, `limbs` = arms/legs, `head`; findings are grouped by the bone the piece is on): lower the numbers of YOUR group when you fix things.
- Head fields (hat, hair, beard, moustache, eyewear ...) are judged as `headPenetration` (against the sculpted head + neck as skin, and the coat as the worn surface);
  limb garments (boots, trousers, gloves, sleeves) as `garmentPenetration`; accessories on the coat as `accessoryPenetration` / `accessorySink`; `floating`; `poseClip` (animator poses) and
  `poseExtreme` (joint-range extremes).

More helpers: `fit/surface.ts` (`polySurface(rings, seg)`: the surface of a loft AS DRAWN, polygon faces; `patchSurface`; `faceAlong`, `alongY`), `fit/torsoKit.ts` (bands, ribbons, plates, frames on the trunk), `fit/skirtShape.ts`, `fit/collarShape.ts`.
Limb code: `limbKit.ts` (agent L) does the same for limbs; the field's `limbSurface` answers the smooth analytic surface (use `polySurface` on your own ring table for the drawn polygon).
