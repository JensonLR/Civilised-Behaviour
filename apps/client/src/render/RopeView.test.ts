import { describe, expect, it } from "vitest";
import { Matrix4, Scene, Vector3, type InstancedMesh, type Object3D } from "three";
import { LASSO } from "@cb/shared";
import { ROPE, RopeView } from "./RopeView.ts";

/** D-106: the lariat as the clients draw it. */
const meshes = (scene: Scene): Record<string, InstancedMesh> => {
  const out: Record<string, InstancedMesh> = {};
  scene.traverse((o: Object3D) => {
    if ((o as InstancedMesh).isInstancedMesh) out[o.name] = o as InstancedMesh;
  });
  return out;
};

describe("D-106: ropes and loops", () => {
  it("a held rope is a chain of segments from the hand to the man, sagging between, taut at full length", () => {
    const scene = new Scene();
    const v = new RopeView(scene);
    v.begin();
    v.rope(0, 1.4, 0, 0, 0.4, -LASSO.length);
    v.update(0.016);
    const segs = meshes(scene).rope_segments!;
    expect(segs.count).toBe(ROPE.segments);
    const at = new Vector3();
    const m = new Matrix4();
    let lowest = Infinity;
    for (let i = 0; i < segs.count; i++) {
      segs.getMatrixAt(i, m);
      at.setFromMatrixPosition(m);
      expect(at.z).toBeLessThanOrEqual(0.01);
      expect(at.z).toBeGreaterThanOrEqual(-LASSO.length - 0.01);
      lowest = Math.min(lowest, at.y);
    }
    expect(lowest).toBeLessThan(0.9); // (it sags below the straight line between 1.4 and 0.4)
    // slack (he is close): it sags further
    v.begin();
    v.rope(0, 1.4, 0, 0, 0.4, -1);
    v.update(0.016);
    segs.getMatrixAt(ROPE.segments >> 1, m);
    expect(at.setFromMatrixPosition(m).y).toBeLessThan(0.5);
    // nothing held: nothing drawn
    v.begin();
    v.update(0.016);
    expect(segs.count).toBe(0);
  });

  it("a loop thrown flies to its mark paying out rope and is gone when it lands; a miss falls away", () => {
    const scene = new Scene();
    const v = new RopeView(scene);
    v.thrown({ by: "ada", x: 0, y: 1.3, z: 0, tx: 0, ty: 1.1, tz: -8, hit: true });
    v.begin();
    v.update(LASSO.throwS / 2);
    const m = meshes(scene);
    expect(m.rope_loops!.count).toBe(1);
    expect(m.rope_segments!.count).toBe(ROPE.segments); // (the rope behind the loop)
    const at = new Vector3().setFromMatrixPosition(new Matrix4().copy((() => { const mm = new Matrix4(); m.rope_loops!.getMatrixAt(0, mm); return mm; })()));
    expect(at.z).toBeCloseTo(-4, 0);
    v.begin();
    v.update(LASSO.throwS);
    expect(v.flying).toBe(0);
    v.thrown({ by: "ada", x: 0, y: 1.3, z: 0, tx: 0, ty: 0, tz: -8, hit: false });
    for (let i = 0; i < 20; i++) {
      v.begin();
      v.update(0.1);
    }
    expect(v.flying).toBe(0);
    expect(m.rope_loops!.count).toBe(0);
    v.dispose();
    expect(Object.keys(meshes(scene))).toEqual([]);
  });
});
