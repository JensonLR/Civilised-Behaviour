// Hollowmere's folk: build cost, schedule cost per call, and the crowd's per-frame CPU cost. Run: npx tsx scripts/folk-bench.ts (Node, no GPU: a floor for JS cost, not a frame time).
import { Scene } from "three";
import { buildFolk, createArena, createFolkClock, createVillagerPose, setFolkClock, villagerAt } from "../packages/shared/src/index.ts";
import { FOLK_BUDGETS, Villagers } from "../apps/client/src/render/world/villagers.ts";

const t0 = performance.now();
const world = createArena(7);
const t1 = performance.now();
const folk = buildFolk(world, 7);
const t2 = performance.now();
console.log(`arena ${(t1 - t0).toFixed(0)} ms; folk network + roster ${(t2 - t1).toFixed(0)} ms (${folk.nav.nodeCount} nodes, ${folk.nav.stations.length} stations, ${folk.roster.length} people)`);

const pose = createVillagerPose();
const clock = createFolkClock();
for (let h = 0; h < 24; h += 0.05) for (let i = 0; i < folk.roster.length; i++) villagerAt(folk, i, setFolkClock(clock, 7, 0, h, 30), pose); // (warm: routes are built on first use)
const t3 = performance.now();
let n = 0;
for (let r = 0; r < 4000; r++) {
  setFolkClock(clock, 7, r * 100, (r * 0.013) % 24, 30);
  for (let i = 0; i < folk.roster.length; i++, n++) villagerAt(folk, i, clock, pose);
}
console.log(`villagerAt: ${(((performance.now() - t3) * 1000) / n).toFixed(2)} us per person (${folk.roster.length} people = ${(((performance.now() - t3) / 4000)).toFixed(3)} ms per frame)`);

for (const name of ["low", "medium", "high"] as const) {
  const scene = new Scene();
  const crowd = new Villagers(scene, world, FOLK_BUDGETS[name], 0);
  const frame = { hours: 10, worldSec: 600, rain: 0, x: -21, y: 1.6, z: -54, walkers: [{ x: -20, z: -56 }], walkerCount: 1 };
  const b0 = performance.now();
  for (let f = 0; f < 60; f++) crowd.update(1 / 30, frame);
  const warm = performance.now() - b0;
  const N = 400;
  const quiet: number[] = [];
  let withBuilds = 0;
  for (let f = 0; f < N; f++) {
    frame.worldSec = 600 + f / 30;
    frame.hours = 10 + f * 0.004;
    const a = performance.now();
    crowd.update(1 / 30, frame);
    const dt = performance.now() - a;
    if (crowd.stats.builds > 0) withBuilds++;
    else quiet.push(dt);
  }
  quiet.sort((a, b) => a - b);
  const ms = quiet[Math.floor(quiet.length / 2)]!;
  const p95 = quiet[Math.floor(quiet.length * 0.95)]!;
  let meshes = 0;
  scene.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh && o.visible) {
      let shown = true;
      for (let q: typeof o | null = o; q; q = q.parent) if (!q.visible) shown = false;
      if (shown) meshes++;
    }
  });
  console.log(`${name}: ${crowd.stats.visible} drawn (lod0/1/2 ${crowd.stats.lod.join("/")}), ~${crowd.stats.triangles} tris, ${meshes} meshes, first 60 frames (builds) ${warm.toFixed(0)} ms, steady median ${ms.toFixed(2)} ms / p95 ${p95.toFixed(2)} ms per frame (${withBuilds} of ${N} frames also built or re-detailed a body)`);
  crowd.dispose();
}
