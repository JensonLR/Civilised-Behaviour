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

**Known character-cost risk:** 30 NPCs x ~17 meshes x 2 (shadow) is ~1000 draw calls, over the 400-600 budget. Planned mitigations (M4/M12): a merged single-mesh LOD1 for mid distance (~1.5k tris, 1-2 calls), impostor/instanced LOD2 beyond, shadow casting only for near characters, and `InstancedMesh` per bone for identical-archetype crowds. Do not add NPC crowds before LOD lands.

Client production bundle (2026-09-29): 780 kB JS raw / 213 kB gzip (three + colyseus SDK + game), 2.9 kB CSS.

## TODO measurements (M12 unless noted)
Real-GPU frame time (CPU vs GPU split); shader compile stalls; GC spikes; server tick time and bandwidth per player with 4 players
and 30 NPCs; memory per room; soak (hours); reconnect storm; bad-network (100-150 ms + jitter).
