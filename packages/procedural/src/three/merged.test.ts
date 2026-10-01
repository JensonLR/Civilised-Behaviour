import { Matrix4, Mesh, SkinnedMesh, Vector3, type Object3D } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { FLAG } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { mergeRigid } from "./merged.ts";
import { buildCharacter, characterCacheSize, clearCharacterCaches, type CharacterRig } from "./rig.ts";

afterAll(() => clearCharacterCaches());

const shown = (o: Object3D): boolean => {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const visibleMeshes = (rig: CharacterRig): Mesh[] => {
  const out: Mesh[] = [];
  rig.root.traverse((o) => o instanceof Mesh && shown(o) && out.push(o));
  return out;
};
const vertexCount = (m: Mesh): number => m.geometry.attributes.position!.count;
const triCount = (m: Mesh): number => (m.geometry.index ? m.geometry.index.count : vertexCount(m)) / 3;
/** The bone meshes' order in a merged geometry (the attachment order in rig.ts). */
const BONES = ["pelvis", "torso", "head", "upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR", "upperLegL", "lowerLegL", "upperLegR", "lowerLegR"];

const pairs = (seed: number, lod: 1 | 2): { merged: CharacterRig; plain: CharacterRig } => {
  const spec = generateCharacter(seed);
  return { merged: buildCharacter(spec, { outline: false, lod, merged: true }), plain: buildCharacter(spec, { outline: false, lod }) };
};

describe("merged crowd levels (rigid skin, D-036)", () => {
  it("a merged level is ONE draw with the vertices and triangles of its parts, on every sampled look", () => {
    for (let seed = 0; seed < 24; seed++) {
      for (const lod of [1, 2] as const) {
        const { merged, plain } = pairs(seed * 11, lod);
        const mm = visibleMeshes(merged);
        const pm = visibleMeshes(plain);
        expect(mm.length, `seed ${seed} lod ${lod}`).toBe(1);
        expect(mm[0]).toBeInstanceOf(SkinnedMesh);
        expect(merged.meshCount).toBe(1);
        expect(plain.meshCount).toBe(pm.length);
        expect(vertexCount(mm[0]!), `seed ${seed} lod ${lod} vertices`).toBe(pm.reduce((a, m) => a + vertexCount(m), 0));
        expect(triCount(mm[0]!), `seed ${seed} lod ${lod} triangles`).toBe(pm.reduce((a, m) => a + triCount(m), 0));
        merged.dispose();
        plain.dispose();
      }
    }
  });

  it("posed (idle, walk, run, crouch, an arm raised), every bone's vertices land where the unmerged rig puts them, within 1e-4", () => {
    const poses = [
      { name: "idle", pose: { speed: 0, flags: 0, vy: 0 }, frames: 90 },
      { name: "walk", pose: { speed: 1.6, flags: 0, vy: 0 }, frames: 40 },
      { name: "run", pose: { speed: 6, flags: FLAG.SPRINTING, vy: 0 }, frames: 40 },
      { name: "crouch", pose: { speed: 0, flags: FLAG.CROUCHING, vy: 0 }, frames: 60 },
    ] as const;
    for (const seed of [3, 17, 41]) {
      for (const lod of [1, 2] as const) {
        const { merged, plain } = pairs(seed, lod);
        const animA = new CharacterAnimator(merged);
        const animB = new CharacterAnimator(plain);
        for (const p of poses) {
          for (let f = 0; f < p.frames; f++) {
            animA.update(1 / 30, p.pose);
            animB.update(1 / 30, p.pose);
          }
          // an arm raised (a wave, a salute): joint angles written directly, the same on both
          for (const r of [merged, plain]) {
            r.joints.shoulderR.rotation.z = 2.2;
            r.joints.elbowR.rotation.x = 1.1;
            r.joints.torso.rotation.y = 0.4;
          }
          for (const r of [merged, plain]) {
            r.root.position.set(3, 0.2, -4);
            r.root.rotation.y = 0.7;
            r.root.scale.setScalar(1.08);
            r.root.updateMatrixWorld(true);
          }
          const sk = visibleMeshes(merged)[0] as SkinnedMesh;
          sk.skeleton.update();
          // the unmerged bone meshes in attachment order give the same vertex order the merged geometry was concatenated in
          let offset = 0;
          let worst = 0;
          let checked = 0;
          const pos = new Vector3();
          const ref = new Vector3();
          for (const bone of BONES) {
            const pm = visibleMeshes(plain).find((m) => m.name === `mesh_${bone}`);
            if (!pm) continue;
            const n = vertexCount(pm);
            for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 40))) {
              sk.getVertexPosition(offset + i, pos);
              pos.applyMatrix4(sk.matrixWorld);
              ref.fromBufferAttribute(pm.geometry.attributes.position!, i).applyMatrix4(pm.matrixWorld);
              worst = Math.max(worst, pos.distanceTo(ref));
              checked++;
            }
            offset += n;
          }
          expect(checked, `${p.name} seed ${seed} lod ${lod}: vertices compared`).toBeGreaterThan(100);
          expect(worst, `${p.name} seed ${seed} lod ${lod}`).toBeLessThan(1e-4);
        }
        merged.dispose();
        plain.dispose();
      }
    }
  });

  it("the level-1 face is baked in the right place: every face vertex sits where the live face part has it in its construction pose (mirrored brow included)", () => {
    const spec = generateCharacter(5);
    const merged = buildCharacter(spec, { outline: false, lod: 1, merged: true });
    const live = buildCharacter(spec, { outline: false, lod: 1 }); // the unmerged level-1 face, left as it was built
    merged.root.updateMatrixWorld(true);
    live.root.updateMatrixWorld(true);
    const sk = visibleMeshes(merged)[0] as SkinnedMesh;
    sk.skeleton.update();
    const bones = visibleMeshes(live).filter((m) => m.name.startsWith("mesh_"));
    const face = visibleMeshes(live).filter((m) => !m.name.startsWith("mesh_"));
    expect(face.length).toBeGreaterThanOrEqual(7); // two eyes of white, iris and lid, two brows, the mouth
    // (the face parts follow the scene order eye L, eye R, brow L, brow R, mouth, which is the order the face build lists them in)
    let offset = bones.reduce((a, m) => a + vertexCount(m), 0);
    expect(vertexCount(sk)).toBe(offset + face.reduce((a, m) => a + vertexCount(m), 0));
    const a = new Vector3();
    const b = new Vector3();
    let worst = 0;
    for (const m of face) {
      const n = vertexCount(m);
      for (let i = 0; i < n; i++) {
        sk.getVertexPosition(offset + i, a);
        a.applyMatrix4(sk.matrixWorld);
        b.fromBufferAttribute(m.geometry.attributes.position!, i).applyMatrix4(m.matrixWorld);
        worst = Math.max(worst, a.distanceTo(b));
      }
      offset += n;
    }
    expect(worst).toBeLessThan(1e-4);
    merged.dispose();
    live.dispose();
  });

  it("switching levels keeps the joints, hides what it must, rebuilds nothing at level 0 and never leaves two figures drawn", () => {
    const rig = buildCharacter(generateCharacter(9), { outline: true, lod: 0, merged: true });
    const joints = { ...rig.joints };
    const face = rig.face;
    const full = rig.meshCount;
    expect(full).toBeGreaterThan(30);
    for (const lod of [1, 2, 1, 0, 2, 0] as const) {
      rig.setLod(lod);
      expect(rig.lod).toBe(lod);
      expect(rig.joints.head).toBe(joints.head);
      expect(rig.face).toBe(face);
      if (lod === 0) expect(rig.meshCount).toBe(full);
      else {
        expect(rig.meshCount).toBe(1);
        expect(visibleMeshes(rig)[0]).toBeInstanceOf(SkinnedMesh);
      }
    }
    rig.dispose();
  });

  it("a rig built at a crowd level never builds per-bone geometry for it, and a crowd person stays a handful of cache entries at all three levels", () => {
    clearCharacterCaches();
    const spec = generateCharacter(21);
    const rig = buildCharacter(spec, { outline: false, lod: 2, merged: true });
    expect(characterCacheSize()).toBe(1); // the one merged geometry
    rig.setLod(1);
    expect(characterCacheSize()).toBe(2);
    rig.setLod(0);
    const afterFull = characterCacheSize();
    expect(afterFull).toBeLessThanOrEqual(2 + 14); // plus the level-0 bones only
    rig.setOutline(true);
    expect(characterCacheSize()).toBeLessThanOrEqual(2 + 28); // plus their hulls
    // the unmerged way, for comparison: ~13 per crowd level and level
    clearCharacterCaches();
    const old = buildCharacter(spec, { outline: false, lod: 2 });
    old.setLod(1);
    old.setLod(0);
    old.setOutline(true);
    expect(characterCacheSize()).toBeGreaterThan(afterFull + 20);
    rig.dispose();
    old.dispose();
  });

  it("the geometry cache is least-recently-USED: a look that is still being drawn is never the one evicted when the cache fills", () => {
    clearCharacterCaches();
    const hot = generateCharacter(100_000);
    const geometryOf = (r: CharacterRig): unknown => (visibleMeshes(r)[0] as SkinnedMesh).geometry;
    const first = buildCharacter(hot, { outline: false, lod: 2, merged: true });
    const g0 = geometryOf(first);
    // 1700 other looks (the cache holds 1536): the hot one is touched (a second rig of the same look: a hit) every 100 builds
    for (let i = 0; i < 1700; i++) {
      const r = buildCharacter(generateCharacter(i), { outline: false, lod: 2, merged: true });
      r.dispose();
      if (i % 100 === 0) buildCharacter(hot, { outline: false, lod: 2, merged: true }).dispose();
    }
    expect(characterCacheSize()).toBeLessThanOrEqual(1536 + 1);
    const again = buildCharacter(hot, { outline: false, lod: 2, merged: true });
    expect(geometryOf(again)).toBe(g0); // still the very same buffers: first-built-first-evicted would have rebuilt them
    again.dispose();
    first.dispose();
  }, 120_000);

  it("identical looks share the merged geometry (GPU memory), and dispose frees the skeleton and detaches the meshes", () => {
    const spec = generateCharacter(2);
    const a = buildCharacter(spec, { outline: false, lod: 1, merged: true });
    const b = buildCharacter(spec, { outline: false, lod: 1, merged: true });
    const ma = visibleMeshes(a)[0] as SkinnedMesh;
    const mb = visibleMeshes(b)[0] as SkinnedMesh;
    expect(ma.geometry).toBe(mb.geometry);
    expect(ma.skeleton).not.toBe(mb.skeleton);
    ma.skeleton.computeBoneTexture();
    expect(ma.skeleton.boneTexture).not.toBeNull();
    a.dispose();
    expect(ma.skeleton.boneTexture).toBeNull();
    expect(ma.parent).toBeNull();
    expect(a.root.children.some((c) => c instanceof SkinnedMesh)).toBe(false);
    b.dispose();
  });

  it("mergeRigid mirrors winding for mirrored parts, computes missing normals, and never touches its inputs", () => {
    const rig = buildCharacter(generateCharacter(1), { outline: false, lod: 2 });
    const bone = visibleMeshes(rig).find((m) => m.name === "mesh_torso")!;
    const g = bone.geometry;
    const before = Array.from(g.attributes.position!.array.slice(0, 12));
    const ident = mergeRigid([{ geometry: g, bone: 1, matrix: new Matrix4() }]);
    const mirror = mergeRigid([{ geometry: g, bone: 1, matrix: new Matrix4().makeScale(-1, 1, 1) }]);
    expect(Array.from(g.attributes.position!.array.slice(0, 12))).toEqual(before);
    expect(ident.index!.count).toBe(g.index ? g.index.count : g.attributes.position!.count);
    // a mirrored triangle keeps facing the way its (mirrored) normal says: geometric normal . stored normal > 0 for most triangles
    const p = mirror.attributes.position!;
    const n = mirror.attributes.normal!;
    const idx = mirror.index!;
    let agree = 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const e1 = new Vector3();
    const e2 = new Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(p, idx.getX(t));
      b.fromBufferAttribute(p, idx.getX(t + 1));
      c.fromBufferAttribute(p, idx.getX(t + 2));
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      e1.cross(e2);
      if (e1.dot(new Vector3().fromBufferAttribute(n, idx.getX(t))) > 0) agree++;
    }
    expect(agree / (idx.count / 3)).toBeGreaterThan(0.9);
    rig.dispose();
  });
});
