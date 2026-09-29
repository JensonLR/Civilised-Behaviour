# Performance log

Rule: never optimise from intuition; record measurements here with date, machine, build and method.

## Targets
60 fps @1080p on a mid-range Windows gaming PC; <400-600 draw calls; capped shadow casters; pooled particles/decals/projectiles;
no per-frame garbage in hot loops; bounded physics bodies/ragdolls; bounded memory. Server: tick < 33 ms budget with large headroom.

## Measurements
| Date | Build | Environment | Result |
|------|-------|-------------|--------|
| 2026-09-29 | M1 arena (dev server), 1 player | Headless Chromium, **SwiftShader software GL**, sandbox VM | 1280x720 medium: 10 fps (frame-cap 100 ms), 34 draw calls, 79k tris, 36 MB JS heap. 1280x720 low: 10 fps, 34 calls, 47k tris. 640x360 low: 15 fps. **Software rasteriser - GPU cost is not representative; draw-call/triangle/heap numbers are valid.** |

Client production bundle (2026-09-29): 780 kB JS raw / 213 kB gzip (three + colyseus SDK + game), 2.9 kB CSS.

## TODO measurements (M12 unless noted)
Real-GPU frame time (CPU vs GPU split); shader compile stalls; GC spikes; server tick time and bandwidth per player with 4 players
and 30 NPCs; memory per room; soak (hours); reconnect storm; bad-network (100-150 ms + jitter).
