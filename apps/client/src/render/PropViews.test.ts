import { InstancedMesh, Scene } from "three";
import { describe, expect, it } from "vitest";
import { INTERACT, PropKind } from "@cb/shared";
import { PropViews } from "./PropViews.ts";

type P = { kind: number; x: number; y: number; z: number };
const sync = (views: PropViews, props: P[]): void =>
  views.sync({ forEach: (cb) => props.forEach((p, i) => cb(p as never, String(i))) }, (p, f) => {
    const q = p as unknown as P;
    return f === "x" ? q.x : f === "y" ? q.y : f === "z" ? q.z : f === "qw" ? 1 : 0;
  });

const meshes = (scene: Scene): InstancedMesh[] => scene.children.filter((c): c is InstancedMesh => (c as InstancedMesh).isInstancedMesh && !c.name.endsWith("_outline") && c.name.startsWith("props_"));

describe("PropViews", () => {
  it("draws every prop of a kind in one instanced mesh, at its interpolated position, with a shared-buffer ink hull", () => {
    const scene = new Scene();
    const views = new PropViews(scene, true);
    sync(views, [
      { kind: PropKind.CRATE, x: 1, y: 0.3, z: 2 },
      { kind: PropKind.CRATE, x: -4, y: 0.3, z: 5 },
      { kind: PropKind.BOTTLE, x: 3, y: 0.15, z: -1 },
    ]);
    expect(views.count).toBe(3);
    const byName = Object.fromEntries(meshes(scene).map((m) => [m.name, m]));
    expect(byName.props_crate!.count).toBe(2);
    expect(byName.props_bottle!.count).toBe(1);
    expect(byName.props_barrel!.count).toBe(0);
    expect(byName.props_barrel!.visible).toBe(false); // an empty kind is not drawn
    expect(byName.props_crate!.visible).toBe(true);
    const m = byName.props_crate!.instanceMatrix.array;
    expect([m[12], m[13], m[14]].map((v) => Math.round(v! * 1000) / 1000)).toEqual([1, 0.3, 2]);
    expect([m[28], m[29], m[30]].map((v) => Math.round(v! * 1000) / 1000)).toEqual([-4, 0.3, 5]);
    const hull = scene.children.find((c) => c.name === "props_crate_outline") as InstancedMesh;
    expect(hull.instanceMatrix).toBe(byName.props_crate!.instanceMatrix);
    expect(hull.count).toBe(2);
    // removing a prop shrinks the set the next sync
    sync(views, [{ kind: PropKind.CRATE, x: 1, y: 0.3, z: 2 }]);
    expect(byName.props_crate!.count).toBe(1);
    expect(hull.count).toBe(1);
    expect(views.count).toBe(1);
  });

  it("without outlines (low preset) there are no hull meshes; unknown kinds fall back to a crate; the room cap is respected", () => {
    const scene = new Scene();
    const views = new PropViews(scene, false);
    expect(scene.children.some((c) => c.name.endsWith("_outline"))).toBe(false);
    sync(views, Array.from({ length: INTERACT.maxPropsPerRoom + 10 }, (_, i) => ({ kind: i % 2 ? 99 : PropKind.CRATE, x: i, y: 0, z: 0 })));
    expect(views.count).toBe(INTERACT.maxPropsPerRoom);
    views.dispose();
    expect(scene.children.length).toBe(0);
  });
});
