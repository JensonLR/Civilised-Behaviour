# Content pipeline

Status: DRAFT - conventions only; no external-asset pipeline exists yet (everything so far is procedural code).

## Principles
Procedural first (seeded, cached, instanced). External assets only when they clearly beat code, and only with a row in
`ASSET_REGISTER.md` (source, licence, URL, modification, attribution).

## GLB conventions (for assets that genuinely need external authoring)
- Units metres, +Y up, model forward = -Z (matches `facing 0`), right-handed, pivot at feet centre for characters/props,
  base centre for buildings.
- One material per slot name: `mat_<surface>`; textures <= 1024 px props, <= 2048 px hero; KTX2/Basis for shipping.
- LOD suffixes `_LOD0.._LOD2`; collision proxies `_COL_box|_COL_cyl|_COL_hull` (never render meshes); attachment empties `_ATT_<name>`
  (e.g. `_ATT_hand_r`, `_ATT_muzzle`).
- Compress with Meshopt where it reduces total load+decode time; Draco only for large static meshes.

## Characters (implemented, M2)
Source of truth: `packages/procedural/src/spec.ts` (fields) and `catalog.ts` (option names, palettes). To add an option: append to the catalog list
(never reorder), bump nothing else for pure appends; raise `max` accordingly; add a case in `three/rig.ts` (bone builders); the creator UI updates
automatically. Adding a new *field* appends to `FIELDS` and extends `SPEC_BYTES` (old saved strings are rejected, so also bump `SPEC_VERSION` and write
a migration once persistence exists, M10). Preview any character deterministically:
`/?showcase=lineup&seed=3&n=6` (row), `&close=0` (head shot), `&pose=walk|carry|crouch|down|air`, `&expr=pain|fear|triumph|drunk|angry`, `&marks=1`, `&set=field:val,...` (override spec fields by name), `&vary=field` (cycle one field across the row), `&zoom=`, `&turn=`, `&outline=0`
(campaign history), `&look=<encoded>`; capture with `node scripts/shot.mjs "<query>" out.png [WxH]`.

## Data-driven content (planned `packages/game-data`)
Factions, scenario templates, newspaper templates, names/titles, item defs as typed TS/JSON validated at build time.
Runtime never depends on an LLM.
