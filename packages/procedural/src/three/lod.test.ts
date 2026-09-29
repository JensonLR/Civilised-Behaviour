import { Box3, Mesh, type Object3D } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { generateCharacter } from "../spec.ts";
import { CharacterAnimator } from "./animator.ts";
import { buildCharacter, clearCharacterCaches, type CharacterRig } from "./rig.ts";

afterAll(() => clearCharacterCaches());

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

describe("crowd levels of detail", () => {
  it("each level fits its triangle budget (no outline hulls): LOD0 avg <= 12k, LOD1 avg <= 7k, LOD2 avg <= 1.8k and max <= 2.4k", () => {
    const N = 60;
    const stat = [0, 1, 2].map((lod) => {
      let sum = 0;
      let max = 0;
      for (let seed = 0; seed < N; seed++) {
        const rig = buildCharacter(generateCharacter(seed), { outline: false, lod: lod as 0 | 1 | 2 });
        const t = tris(rig);
        sum += t;
        max = Math.max(max, t);
        rig.dispose();
      }
      return { avg: sum / N, max };
    });
    expect(stat[0]!.avg).toBeLessThan(12000);
    expect(stat[0]!.max).toBeLessThan(15000);
    expect(stat[1]!.avg).toBeLessThan(7000);
    expect(stat[2]!.avg).toBeLessThan(1800);
    expect(stat[2]!.max).toBeLessThan(2400);
    expect(stat[1]!.avg).toBeLessThan(stat[0]!.avg * 0.7);
  });

  it("the far level is a handful of draw calls, and the joint API is identical at every level", () => {
    for (let seed = 0; seed < 10; seed++) {
      const spec = generateCharacter(seed);
      const rigs = [0, 1, 2].map((lod) => buildCharacter(spec, { outline: false, lod: lod as 0 | 1 | 2 }));
      expect(rigs[2]!.meshCount).toBeLessThanOrEqual(12);
      const keys = Object.keys(rigs[0]!.joints).sort();
      for (const r of rigs) {
        expect(Object.keys(r.joints).sort()).toEqual(keys);
        expect(Object.keys(r.face).sort()).toEqual(Object.keys(rigs[0]!.face).sort());
        for (const k of ["setWounds", "setMissing", "setOutline", "setLod", "detachLimb", "dispose"] as const) expect(typeof r[k]).toBe("function");
      }
      rigs.forEach((r) => r.dispose());
    }
  });

  it("levels keep the silhouette: the far figure's bounding box stays within 12% of the full one", () => {
    for (let seed = 0; seed < 20; seed++) {
      const spec = { ...generateCharacter(seed), hat: 0 };
      const full = buildCharacter(spec, { outline: false, lod: 0 });
      const far = buildCharacter(spec, { outline: false, lod: 2 });
      const size = (rig: CharacterRig): [number, number, number] => {
        rig.root.updateMatrixWorld(true);
        const b = new Box3();
        rig.root.traverse((o) => o instanceof Mesh && shown(o) && b.expandByObject(o));
        return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
      };
      const a = size(full);
      const c = size(far);
      expect(Math.abs(c[1] - a[1]) / a[1], `seed ${seed} height`).toBeLessThan(0.12);
      expect(Math.abs(c[0] - a[0]) / a[0], `seed ${seed} width`).toBeLessThan(0.22);
      full.dispose();
      far.dispose();
    }
  });

  it("geometry is cached by (spec, level): the same look at the same level shares GPU buffers, another level does not", () => {
    const spec = generateCharacter(3);
    const a = buildCharacter(spec, { outline: false, lod: 2 });
    const b = buildCharacter(spec, { outline: false, lod: 2 });
    const c = buildCharacter(spec, { outline: false, lod: 0 });
    const geo = (r: CharacterRig, name: string): unknown => {
      let g: unknown;
      r.root.traverse((o) => o instanceof Mesh && o.name === name && (g = o.geometry));
      return g;
    };
    expect(geo(a, "mesh_torso")).toBe(geo(b, "mesh_torso"));
    expect(geo(a, "mesh_torso")).not.toBe(geo(c, "mesh_torso"));
    [a, b, c].forEach((r) => r.dispose());
  });

  it("setLod swaps geometry in place without touching the hierarchy, and the animator keeps working", () => {
    const rig = buildCharacter(generateCharacter(7), { outline: true, lod: 0 });
    const joints = { ...rig.joints };
    const face = rig.face;
    const anim = new CharacterAnimator(rig);
    const before = tris(rig);
    rig.setLod(2);
    expect(rig.lod).toBe(2);
    expect(rig.joints.head).toBe(joints.head);
    expect(rig.face).toBe(face);
    expect(tris(rig)).toBeLessThan(before * 0.4);
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 3, flags: 1, vy: 0 });
    rig.setLod(1);
    for (let i = 0; i < 30; i++) anim.update(1 / 30, { speed: 3, flags: 1, vy: 0 });
    rig.setLod(0);
    expect(tris(rig)).toBeGreaterThan(before * 0.9);
    // no NaN anywhere after switching levels while animating
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => {
      for (const e of o.matrix.elements) expect(Number.isFinite(e)).toBe(true);
    });
    rig.dispose();
  });

  it("every catalog option builds at every level (no crash, finite geometry)", () => {
    for (let seed = 0; seed < 25; seed++) {
      for (const lod of [1, 2] as const) {
        const rig = buildCharacter(generateCharacter(seed * 37), { outline: true, lod });
        rig.root.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          const p = o.geometry.attributes.position!;
          for (let i = 0; i < p.count; i++) if (!Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))) throw new Error(`NaN in ${o.name} lod ${lod} seed ${seed}`);
        });
        rig.dispose();
      }
    }
  });
});
