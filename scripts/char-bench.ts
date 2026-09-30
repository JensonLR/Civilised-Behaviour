// Character geometry cost per level of detail: triangles, cold build time, and the cost of cloning an already-cached look.
// Usage: npx tsx scripts/char-bench.ts [seeds=60]   (Node only, no GPU: counts are exact, times are this machine's)
import { Mesh, type Object3D } from "three";
import { generateCharacter } from "../packages/procedural/src/spec.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "../packages/procedural/src/three/rig.ts";

const N = Number(process.argv[2] ?? 60);
// SET="jacket:6,hat:0" forces spec fields on every character (a per-feature cost check)
const overrides = (process.env.SET ?? "").split(",").filter(Boolean).map((kv) => kv.split(":") as [string, string]);
const person = (seed: number) => Object.assign(generateCharacter(seed), Object.fromEntries(overrides.map(([k, v]) => [k, Number(v)])));
const LODS = (process.env.LODS ?? "0,1,2").split(",").map(Number) as (0 | 1 | 2)[];
const HULLS = (process.env.HULLS ?? "0,1").split(",").map((x) => x === "1");
const shown = (o: Object3D): boolean => {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const tris = (rig: CharacterRig): number => {
  let t = 0;
  rig.root.traverse((o) => {
    if (o instanceof Mesh && shown(o)) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
  });
  return t;
};
// warm the JIT
for (let s = 0; s < 6; s++) buildCharacter(generateCharacter(900 + s), { outline: false }).dispose();
clearCharacterCaches();
for (const lod of LODS) {
  for (const outline of HULLS) {
    let sum = 0;
    let max = 0;
    let cold = 0;
    let clone = 0;
    let meshes = 0;
    for (let seed = 0; seed < N; seed++) {
      const spec = person(seed);
      clearCharacterCaches();
      const t0 = performance.now();
      const rig = buildCharacter(spec, { outline, lod });
      cold += performance.now() - t0;
      const t = tris(rig);
      sum += t;
      max = Math.max(max, t);
      meshes += rig.meshCount;
      const t1 = performance.now();
      const reps = 5;
      for (let k = 0; k < reps; k++) buildCharacter(spec, { outline, lod }).dispose();
      clone += (performance.now() - t1) / reps;
      rig.dispose();
    }
    console.log(
      `LOD${lod} ${outline ? "hull" : "none"}: tris avg ${(sum / N).toFixed(0)} max ${max.toFixed(0)} | meshes avg ${(meshes / N).toFixed(1)} | cold ${(cold / N).toFixed(1)} ms | clone(cached) ${(clone / N).toFixed(2)} ms`,
    );
  }
}
