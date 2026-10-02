import { Mesh, Scene, SkinnedMesh, Vector3, type Object3D } from "three";
import * as v8 from "node:v8";
import * as vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CROWD_MESH_BUDGET, buildFolk, createArena, type CollisionWorld, type Folk } from "@cb/shared";
import { characterCacheSize, clearCharacterCaches } from "@cb/procedural/three";
import { FOLK_BUDGETS, FOLK_TRIS, Villagers, planLods } from "./villagers.ts";
import { FOLK_DRAWS, crowdDraws } from "./folkMerged.ts";
import { folkSpec } from "./villagerLooks.ts";
import { FolkBody, createBodyState, type BodyState } from "./villagerPose.ts";
import { disposeProps } from "./villagerProps.ts";

let world: CollisionWorld;
let folk: Folk;
beforeAll(() => {
  world = createArena(7);
  folk = buildFolk(world, 7);
});
afterAll(() => {
  clearCharacterCaches();
  disposeProps();
});

const shown = (o: Object3D): boolean => {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const meshesIn = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => o instanceof Mesh && shown(o) && out.push(o));
  return out;
};
const triangles = (ms: Mesh[]): number => ms.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3, 0);

describe("the merged village crowd (D-036): draws, equivalence, memory", () => {
  it("every roster person costs at most FOLK_DRAWS meshes at every level (and a crowd level is exactly one), triangles unchanged", () => {
    const scene = new Scene();
    let l1Tris = 0;
    let l1Plain = 0;
    for (const v of folk.roster) {
      const spec = folkSpec(v);
      for (const ink of [false, true]) {
        const body = new FolkBody(spec, v.scale, 0, ink, scene);
        expect(body.rig.meshCount, `${v.name} lod 0 ink ${ink}`).toBeLessThanOrEqual(ink ? FOLK_DRAWS.lod0Ink : FOLK_DRAWS.lod0);
        for (const lod of [1, 2, 1, 0] as const) {
          body.setLod(lod);
          if (lod === 0) expect(body.rig.meshCount).toBeLessThanOrEqual(ink ? FOLK_DRAWS.lod0Ink : FOLK_DRAWS.lod0);
          else {
            expect(body.rig.meshCount, `${v.name} lod ${lod}`).toBe(lod === 1 ? FOLK_DRAWS.lod1 : FOLK_DRAWS.lod2);
            expect(meshesIn(body.rig.root)[0]).toBeInstanceOf(SkinnedMesh);
          }
        }
        body.dispose();
      }
      // triangles per level do not rise: the merged mesh has the vertices and triangles of the parts it replaces
      const a = new FolkBody(spec, v.scale, 1, false, scene, true);
      const b = new FolkBody(spec, v.scale, 1, false, scene, false);
      l1Tris += triangles(meshesIn(a.rig.root));
      l1Plain += triangles(meshesIn(b.rig.root));
      const c = new FolkBody(spec, v.scale, 2, false, scene, true);
      const d = new FolkBody(spec, v.scale, 2, false, scene, false);
      expect(triangles(meshesIn(c.rig.root))).toBe(triangles(meshesIn(d.rig.root)));
      [a, b, c, d].forEach((x) => x.dispose());
    }
    expect(l1Tris).toBe(l1Plain);
    expect(l1Tris / folk.roster.length).toBeLessThan(FOLK_TRIS.lod1 * 1.15);
  }, 60_000); // (CPU-bound: it builds every roster person six ways; the native peoples' layered hair made each build dearer, and a loaded machine is slower still. A time limit, not a budget.)

  it("a posed merged person is the unmerged person to 1e-4: idle, walk and sit, as the village drives them", () => {
    const scene = new Scene();
    const v = folk.roster[3]!;
    const spec = folkSpec(v);
    const states: [string, Partial<BodyState>][] = [["idle", { act: "idle" }], ["walk", { act: "walk", speed: 1.3 }], ["sit", { act: "sit" }], ["sweep", { act: "sweep" }]];
    for (const lod of [1, 2] as const) {
      for (const [name, st] of states) {
        const a = new FolkBody(spec, v.scale, lod, false, scene, true);
        const b = new FolkBody(spec, v.scale, lod, false, scene, false);
        const sa: BodyState = { ...createBodyState(), ...st };
        const sb: BodyState = { ...createBodyState(), ...st };
        for (let f = 0; f < 120; f++) {
          sa.t = sb.t = f / 30;
          a.place(4, 6, 1.1);
          b.place(4, 6, 1.1);
          a.update(1 / 30, sa);
          b.update(1 / 30, sb);
        }
        scene.updateMatrixWorld(true);
        const sk = meshesIn(a.rig.root).find((m) => m instanceof SkinnedMesh) as SkinnedMesh;
        sk.skeleton.update();
        // vertex order of the merged mesh = the bone meshes in rig order; the unmerged bone meshes are matched by name
        const order = ["pelvis", "torso", "head", "upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR", "upperLegL", "lowerLegL", "upperLegR", "lowerLegR"];
        let offset = 0;
        let worst = 0;
        let n = 0;
        const p = new Vector3();
        const q = new Vector3();
        for (const bone of order) {
          const m = meshesIn(b.rig.root).find((x) => x.name === `mesh_${bone}`);
          if (!m) continue;
          const count = m.geometry.attributes.position!.count;
          for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 30))) {
            sk.getVertexPosition(offset + i, p).applyMatrix4(sk.matrixWorld);
            q.fromBufferAttribute(m.geometry.attributes.position!, i).applyMatrix4(m.matrixWorld);
            worst = Math.max(worst, p.distanceTo(q));
            n++;
          }
          offset += count;
        }
        expect(n, `${name} lod ${lod}`).toBeGreaterThan(100);
        expect(worst, `${name} lod ${lod}`).toBeLessThan(1e-4);
        a.dispose();
        b.dispose();
      }
    }
  });

  it("every preset's crowd at its caps is inside CROWD_MESH_BUDGET (counted in Node from the real rigs), and well under what it was", () => {
    const was = { low: 93, medium: 232, high: 317 };
    for (const name of ["low", "medium", "high"] as const) {
      const b = FOLK_BUDGETS[name];
      const d = Array.from({ length: 22 }, (_, i) => 2 + i * 1.5);
      const out = new Int8Array(32);
      const r = planLods(d, d.map(() => -1), d.length, b, out, new Int32Array(32));
      // the real rigs, one per person the plan puts on stage, at the level it chose
      const scene = new Scene();
      let meshes = 0;
      const bodies: FolkBody[] = [];
      for (let i = 0; i < d.length; i++) {
        if (out[i]! < 0) continue;
        const v = folk.roster[i % folk.roster.length]!;
        const body = new FolkBody(folkSpec(v), v.scale, out[i] as 0 | 1 | 2, b.outlines, scene);
        bodies.push(body);
        meshes += body.rig.meshCount;
      }
      expect(meshes, name).toBeLessThanOrEqual(CROWD_MESH_BUDGET[name]);
      expect(meshes, name).toBeLessThanOrEqual(crowdDraws(b, r.lod));
      expect(crowdDraws(b, r.lod), name).toBeLessThanOrEqual(CROWD_MESH_BUDGET[name]);
      expect(meshes, name).toBeLessThan(was[name] * 0.62);
      bodies.forEach((x) => x.dispose());
    }
  });

  it("the whole crowd on stage at the highest preset is inside the budget too (Villagers.update, people on every level at once)", () => {
    const scene = new Scene();
    const crowd = new Villagers(scene, world, FOLK_BUDGETS.high, 0);
    const f = { hours: 10, worldSec: 600, rain: 0, x: -21, y: 1.6, z: -54, walkers: [{ x: -20, z: -56 }], walkerCount: 1 };
    for (let i = 0; i < 90; i++) crowd.update(1 / 30, f);
    const drawn = meshesIn(crowd.root).length;
    expect(drawn).toBeLessThanOrEqual(CROWD_MESH_BUDGET.high);
    expect(crowd.stats.visible).toBeGreaterThan(0);
    crowd.dispose();
  });

  it("22 people through all three levels cost about 30 cache entries each, not 50 (the village's eviction hitch)", () => {
    clearCharacterCaches();
    const scene = new Scene();
    const bodies: FolkBody[] = [];
    for (const v of folk.roster) {
      const body = new FolkBody(folkSpec(v), v.scale, 2, true, scene);
      body.setLod(1);
      body.setLod(0);
      bodies.push(body);
    }
    const per = characterCacheSize() / folk.roster.length;
    expect(per).toBeLessThanOrEqual(31);
    expect(characterCacheSize()).toBeLessThan(1536 * 0.5);
    bodies.forEach((x) => x.dispose());
  }, 30_000); // (CPU-bound: builds the whole roster at two levels of detail; 3.8 s alone, 4.2 s in the full run, over 5 s on a busy CI runner. A time limit, not a budget.)

  it("the 600-frame crowd retains nothing: heap after a forced GC does not grow", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const scene = new Scene();
    const crowd = new Villagers(scene, world, FOLK_BUDGETS.high, 0);
    const frame = (i: number) => ({ hours: 8 + (i % 600) / 100, worldSec: 600 + i / 30, rain: 0, x: -21 + Math.sin(i / 50) * 12, y: 1.6, z: -54 + Math.cos(i / 50) * 12, walkers: [{ x: -20, z: -56 }], walkerCount: 1 });
    for (let i = 0; i < 400; i++) crowd.update(1 / 30, frame(i)); // warm: every body built, levels visited
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 400; i < 1000; i++) crowd.update(1 / 30, frame(i));
    gc();
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    expect(grew).toBeLessThan(3_000_000);
    crowd.dispose();
  });
});
