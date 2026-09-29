# Performance log

Rule: never optimise from intuition; record measurements here with date, machine, build and method.

## Targets
60 fps @1080p on a mid-range Windows gaming PC; <400-600 draw calls; capped shadow casters; pooled particles/decals/projectiles;
no per-frame garbage in hot loops; bounded physics bodies/ragdolls; bounded memory. Server: tick < 33 ms budget with large headroom.

## Measurements
| Date | Build | Environment | Result |
|------|-------|-------------|--------|
| 2026-09-29 | M1 arena (dev server), 1 player | Headless Chromium, **SwiftShader software GL**, sandbox VM | 1280x720 medium: 10 fps (frame-cap 100 ms), 34 draw calls, 79k tris, 36 MB JS heap. 1280x720 low: 10 fps, 34 calls, 47k tris. 640x360 low: 15 fps. **Software rasteriser - GPU cost is not representative; draw-call/triangle/heap numbers are valid.** |

| 2026-09-29 | M2: 1 player + 13 props + new caricature rig, dev server | Same headless SwiftShader | 1280x720 medium: 61 draw calls, 91k tris (terrain ~51k of that), 35 MB heap, 10 fps (software). Reconciler drift 0.000/0.000 in a real browser. |
| 2026-09-29 | Character geometry only (150 seeds, `rig.test.ts`) | Node, no GPU | Triangles per character: **avg 5.9k, max 7.6k** after adaptive tessellation (was avg 16.6k, max 22.5k). 16-18 meshes per character (11-12 merged bone meshes + 5 face meshes). Shadow pass doubles both. |

| 2026-09-29 | Server tick, 1 room, 4 idle players, 17 Rapier bodies (`/metrics`) | Local Node 22, sandbox VM | avg **0.66 ms**, p99 1.5 ms, worst 80 ms (first-tick WASM warm-up). Budget is 33 ms. |
| 2026-09-29 | Server tick, 1 empty room, 14 Rapier bodies | Render **free** web service (throttled CPU), live | avg **4.5 ms**, p99 99 ms, worst 767 ms, 13 overruns in the first 30 s. ~7x slower than local: consistent with the free tier's CPU limits and cold start. **Not** a code regression, but confirms the free tier is unsuitable for real co-op sessions; re-measure on a paid instance before any playtest. |

| 2026-09-29 | Character geometry after art polish pass (150 seeds, `rig.test.ts`) | Node, no GPU | Without outline: **avg 6.6k, max 8.4k** tris, <=20 meshes. With outline hull: **avg 9.1k, max 11.9k** tris, 29 meshes (the hull is built coarse: +37%; the first naive hull was +91%). Outlines are therefore off on the low preset and must be off for crowds. |

| 2026-09-29 | Character geometry after the body rebuild (lofted torso/limbs/boots, toon material; 150 seeds) | Node, no GPU | Without outline: **avg 5.6k, max 7.1k** tris, 18 meshes (was 6.6k / 8.4k). With outline: **avg 7.7k, max 10.0k**, 29 meshes (was 9.1k / 11.9k). Fewer triangles AND better forms: lofts spend vertices on silhouette, not on stacked overlapping spheres. |
| 2026-09-29 | Character geometry after the face sculpt (one sculpted skin + swept/shell hair, beards, noses; 150 seeds) | Node, no GPU | Without outline: **avg 7.5k, max 8.6k** tris, 18 meshes. With outline: **avg 10.0k, max 11.8k**, 29 meshes. The head is **avg 3.3k** (skull 32x24 grid ~1.5k + shells/sweeps); every builder has a coarse mode (outline hull uses an 18x12 skull) which the future crowd LOD1 will use for the head. Hero characters only: crowds still need LOD before NPCs. |
| 2026-09-29 | Wound dressings (60 seeds, `rig.test.ts`) | Node, no GPU | All six zones grievous (worst case, unrealistic): **+2.0k tris**, +6 draw calls, geometry cached per (spec, zone, severity, gore). One or two wounds: roughly +300-700 tris. |
| 2026-09-29 | Client ragdoll world, 6 simultaneous ragdolls (the cap), 2 x 60 Hz Rapier steps per 30 Hz frame | Node 22, sandbox VM, no GPU | median **3.2 ms**/frame (physics + animation + pose writes), p95 11 ms, first-frame spike ~100 ms (JIT). One or two ragdolls (realistic) ~1 ms. Physics only runs while a ragdoll exists. |
| 2026-09-29 | Client bundle after `@cb/physics` | `vite build` | Eager JS unchanged in spirit (~0.85 MB raw). Rapier is a **lazy chunk: 4.3 MB raw / 1.67 MB gzip** (the `-compat` build inlines the WASM as base64), fetched when a game starts. Follow-up: switch to the non-compat build with a separate `.wasm` asset (compresses far better) before web release; irrelevant inside Electron. |

| 2026-09-29 | World as illustrated ephemera (D-025): painted terrain, hill rings, 3 tree species, rocks, shrubs, grass, flowers, camp, toon + ink on everything; seed 7 arena | Headless Chromium, **SwiftShader**, `?showcase=world&figures=0&props=0` (renderer.info, includes the shadow pass), plus `perf-capture` | World alone, per frame: **low 22 draw calls / 168k tris**, **medium 28 / 268k**, **high 28 / 328k** (limit was ~45). Main-pass meshes: low 16, medium/high 22. In the game (1 player, ink outline, 14 props, 1280x720): **medium 86 calls, 297k tris, 12 fps, 68 MB heap; low 65 calls, 193k tris, 12 fps; high 81 calls, 355k tris, 10 fps** (frame-capped at 100 ms on a software rasteriser; the M2 baseline was 61 calls / 91k tris). **Software GL: counts are valid, fps is a floor.** |
| 2026-09-29 | **Environment upgrade** (`docs/_notes/environment.md`): trail overlay, stream + falls, Observatory, hill tree line, 3 tree species that sway, flower meadows, ferns, reeds, toadstools, stumps/logs, camp life, ambient life, day cycle; seed-7 arena | Headless Chromium, **SwiftShader**, `?showcase=world&view=game&time=13&figures=0&props=0` (`renderer.info`, includes the shadow pass) | World alone, per frame: **low 41 draw calls / 199k tris, medium 54 / 329k, high 54 / 413k** (main pass only: low 31 meshes / 133k, medium 44 / 262k, high 44 / 346k). Was 22 / 168k, 28 / 268k, 28 / 328k. The ceiling in `WorldView.test.ts` is now **60 draws (34 low)** and 150k / 300k / 380k tris (was 45 / 130k / 280k): every new thing is ONE instanced draw (+ one ink hull where solid), and that is where the ~16 extra draws went (ruin, camp glass, banners aside: water, falls, 2 tree-line sets, 7 ground-cover sets, 4 timber/slab sets, 5 ambient). fps unmeasured (software GL). |
| 2026-09-29 | Environment build cost (Node): one whole `WorldView` (medium), of which `planScatter` and the 1024^2 trail mask bake | Node 22, sandbox VM, no GPU, JIT-warm | **whole build 0.35-0.6 s** (first ~0.6 s, then ~0.36 s), `planScatter` 45-85 ms, mask bake 40-90 ms; the rest is the merged geometry builders (camp, ruin, trees, per-face colouring). Happens once per game start; the low preset skips the mask (4 MB texture). Not a frame cost. |
| 2026-09-29 | World geometry, one instance each (Node, `WorldView` + builders) | Node, no GPU | Triangles main / ink hull: broadleaf 370/170, acacia 288/100, snag 104/92, shrub 120/60, boulder 120/60, pebble 20, grass tuft 7, flower 7, camp (all solid landmarks merged) 6.6k/5.2k, crate 420/324, barrel 328/192, bottle 244/178, chair 460/302. Terrain 18k / 51k / 80k (96 / 160 / 200 segments). Seed-7 arena: 79 trees + 81 distant trees, 48 rocks, 3 snags. Medium world = 206k tris of which terrain 51k, grass 35k, broadleaf 31k (+14k hull), acacia 17k (+6k), shrubs 13k (+6k). |

| 2026-09-29 | Character upgrade: garments (patch-based fronts, skirts, capes), 21 hats, hair strands, face decals, 11 jackets / 7 trouser cuts / 9 boots, prosthetics, crowd LOD (120 seeds, `rig.test.ts` / `lod.test.ts`) | Node, no GPU | **LOD0 without outline: avg 10.6k, max 13.8k tris**, <= 26 meshes (with outline hulls: avg 14.8k, max 18.4k, <= 37 meshes). **LOD1: avg 5.7k / max 7.8k** (9.2k / 12.2k with hulls). **LOD2: avg 1.4k / max 1.9k, <= 11 meshes** (3.4k / 4.5k with hulls; crowds run without hulls). Face parts (eyes, lids, brows, mouth, ~1.3k tris, hidden and free at LOD2) are counted only when visible. Budget: LOD0 avg <= 12k, max <= 15k (tests fail above). Build time, cold cache, avg per rig: LOD0 27 ms (35 ms with hulls), LOD1 13 ms, LOD2 6 ms; a clone of a cached look costs ~2 ms at any level (the animated face parts are rebuilt per instance). Where LOD0 spends (avg): head 4.2k (skull 1.5k; hair, beard, nose, ears, hat, decals ~2.7k), torso 1.9k, forearms with hands 1.2k, boots and shins 0.8k, upper arms, thighs and pelvis 1.1k, animated face parts (eyes, lids, brows, mouth) ~1.2k. |

**Known character-cost risk:** 30 NPCs x ~17 meshes x 2 (shadow) is ~1000 draw calls, over the 400-600 budget. Planned mitigations (M4/M12): a merged single-mesh LOD1 for mid distance (~1.5k tris, 1-2 calls), impostor/instanced LOD2 beyond, shadow casting only for near characters, and `InstancedMesh` per bone for identical-archetype crowds. Do not add NPC crowds before LOD lands.

Client production bundle (2026-09-29): 780 kB JS raw / 213 kB gzip (three + colyseus SDK + game), 2.9 kB CSS.

## TODO measurements (M12 unless noted)
Real-GPU frame time (CPU vs GPU split); shader compile stalls; GC spikes; server tick time and bandwidth per player with 4 players
and 30 NPCs; memory per room; soak (hours); reconnect storm; bad-network (100-150 ms + jitter).

## World draw calls after the environment upgrade
Medium main pass = 44 meshes: terrain, skirt, hills, tree line (2), water, falls, broadleaf/acacia/snag (3) + hulls (3), rock/slab (2) + hulls (2), stump/log (2) + hulls (2),
bush/berry (2, no hull), pebbles, grass, daisies, cups, ferns, reeds, toadstools (6), camp + hull, ruin + hull, banners, lantern glass, flame, glow, pool (3), motes, butterflies, birds,
smoke, lantern glow (5). Low drops the hulls, motes, butterflies, birds and smoke and trims the counts. Triangles by part are in `WorldView.stats.parts` (`WORLD_STATS=1 pnpm test`).
Anything new must be one instanced set (or merged into the camp/ruin geometry) and needs a line here.

## World draw calls (2026-09-29, D-025)
Instancing plan: terrain 1, skirt 1, hills 1, sky 1; broadleaf / acacia / snag / shrubs / rocks = 1 instanced mesh each (+1 ink hull each on medium/high, +1 shadow pass for the casters);
pebbles 1, grass 1, flowers 1; the whole camp is one merged mesh (+hull), pennant and signboards one textured mesh, flame 1, fire glow 2. Props are one instanced mesh per KIND
(4, empty kinds are not drawn, +4 hulls) instead of one mesh per prop, so 48 props cost at most 8 draws. Static instances use real bounding spheres; grass/flowers skip culling (one draw either way).
`WorldView.stats` reports draws and triangles per part; `WorldView.test.ts` fails if the world exceeds 45 draw calls or the triangle ceilings on any preset.
