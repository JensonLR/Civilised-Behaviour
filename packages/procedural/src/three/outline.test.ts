import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { instancedOutline, outlineMaterial, sharedToonRamp, syncInstancedOutline } from "./outline.ts";
import { addOutlineNormals } from "./parts.ts";

describe("outline on instanced meshes", () => {
  it("the shader moves the hull with the instance matrix and un-skews the normal (one draw covers every instance)", () => {
    const vs = outlineMaterial().vertexShader;
    expect(vs).toContain("#ifdef USE_INSTANCING");
    expect(vs).toContain("instanceMatrix * local");
    expect(vs).toContain("mat3(instanceMatrix)");
    // the characters' path is untouched: without instancing the position is the plain attribute
    expect(vs).toContain("vec4 local = vec4(position, 1.0)");
  });

  it("instancedOutline shares the source's instance buffer and count, and tracks count changes", () => {
    const geo = new BoxGeometry(1, 1, 1);
    addOutlineNormals(geo);
    const src = new InstancedMesh(geo, new MeshBasicMaterial(), 8);
    src.count = 3;
    const hull = instancedOutline(src);
    expect(hull.instanceMatrix).toBe(src.instanceMatrix);
    expect(hull.geometry).toBe(geo);
    expect(hull.count).toBe(3);
    src.setMatrixAt(0, new Matrix4().makeTranslation(1, 2, 3));
    expect(hull.instanceMatrix.array[12]).toBe(1); // same buffer: translation column of instance 0
    src.count = 6;
    syncInstancedOutline(hull, src);
    expect(hull.count).toBe(6);
    expect(hull.material).toBe(outlineMaterial());
  });

  it("addOutlineNormals gives any geometry unit, outward-ish smoothed normals (a cube's corners point along the diagonal)", () => {
    const geo = new BoxGeometry(2, 2, 2);
    addOutlineNormals(geo);
    const on = geo.getAttribute("onormal")!;
    const pos = geo.getAttribute("position")!;
    for (let i = 0; i < on.count; i++) {
      expect(Math.hypot(on.getX(i), on.getY(i), on.getZ(i))).toBeCloseTo(1, 4);
      expect(on.getX(i) * pos.getX(i) + on.getY(i) * pos.getY(i) + on.getZ(i) * pos.getZ(i)).toBeGreaterThan(0);
    }
  });

  it("the world's toon ramp has the same four bands as the characters' and is created once", () => {
    const ramp = sharedToonRamp();
    expect(Array.from(ramp.image.data as Uint8Array)).toEqual([120, 175, 225, 255]);
    expect(sharedToonRamp()).toBe(ramp);
  });
});
