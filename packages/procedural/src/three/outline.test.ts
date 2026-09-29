import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { WORLD_INK, instancedOutline, instancedWorldOutline, isSharedInk, outlineMaterial, outlineSettings, sharedToonRamp, syncInstancedOutline, worldOutlineMaterial } from "./outline.ts";
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

  it("scenery ink is thinner than a character's, heavier for bigger things, and eases thinner with distance", () => {
    expect(WORLD_INK.small).toBeLessThan(WORLD_INK.medium);
    expect(WORLD_INK.medium).toBeLessThan(WORLD_INK.large);
    expect(WORLD_INK.large).toBeLessThan(outlineSettings.thickness);
    const m = worldOutlineMaterial({ thickness: WORLD_INK.medium });
    expect(m.uniforms.thickness!.value).toBe(WORLD_INK.medium);
    expect(m.vertexShader).toContain("clamp(near / max(-mvPosition.z, 0.1), far, 1.0)");
    // the thickness never grows up close (a character's does): the clamp tops out at 1
    expect(m.vertexShader).not.toContain("1.6");
    // one shared material per variant, and the same instancing path as the characters'
    expect(worldOutlineMaterial({ thickness: WORLD_INK.medium })).toBe(m);
    expect(worldOutlineMaterial({ thickness: WORLD_INK.small })).not.toBe(m);
    expect(m.vertexShader).toContain("instanceMatrix * local");
    expect(isSharedInk(m)).toBe(true);
    expect(isSharedInk(outlineMaterial())).toBe(true);
    expect(isSharedInk(new MeshBasicMaterial())).toBe(false);
  });

  it("a scenery hull shares the source's instance buffer like the character hull does", () => {
    const geo = new BoxGeometry(1, 1, 1);
    addOutlineNormals(geo);
    const src = new InstancedMesh(geo, new MeshBasicMaterial(), 4);
    const hull = instancedWorldOutline(src, { thickness: WORLD_INK.small });
    expect(hull.instanceMatrix).toBe(src.instanceMatrix);
    expect(hull.material).toBe(worldOutlineMaterial({ thickness: WORLD_INK.small }));
  });

  it("a displaced hull (trees swaying) gets its own cached variant carrying the wind uniforms", () => {
    const uniforms = { uTime: { value: 0 } };
    const a = worldOutlineMaterial({ thickness: 1.8, displace: { key: "tree", uniforms, header: "uniform float uTime;", apply: "local.x += sin(uTime);" } });
    expect(a).not.toBe(worldOutlineMaterial({ thickness: 1.8 }));
    expect(a.vertexShader).toContain("local.x += sin(uTime);");
    expect(a.uniforms.uTime).toBe(uniforms.uTime);
  });
});
