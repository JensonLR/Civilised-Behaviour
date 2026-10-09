import { describe, expect, it } from "vitest";
import { Group, Quaternion, Vector3, type Mesh } from "three";
import { PennantHold } from "./pennant.ts";

describe("PennantHold (D-095): a picket boy's pennant stays upright in the hand", () => {
  it("whatever the wrist is doing, its stick points up; the cloth stirs a little and stays on the stick", () => {
    const up = new Vector3();
    const q = new Quaternion();
    for (const [ax, ay, az, ang] of [[1, 0, 0, 1.4], [0, 0, 1, -2.2], [1, 1, 0, 0.9], [0.3, -1, 0.5, 3.0]] as const) {
      const root = new Group();
      const arm = new Group();
      root.add(arm);
      root.rotation.y = -0.4;
      arm.quaternion.setFromAxisAngle(new Vector3(ax, ay, az).normalize(), ang);
      root.updateMatrixWorld(true);
      const p = new PennantHold(7);
      p.attach(arm);
      for (const t of [0, 0.7, 3.1]) {
        p.update(true, t);
        root.updateMatrixWorld(true);
        p.group.getWorldQuaternion(q);
        up.set(0, 1, 0).applyQuaternion(q);
        expect(up.y, `wrist ${ax},${ay},${az} @${ang}`).toBeGreaterThan(0.97);
        const cloth = p.group.children[1] as Mesh;
        expect(Math.abs(cloth.rotation.y)).toBeLessThanOrEqual(0.36);
      }
      expect(p.group.visible).toBe(true);
    }
  });

  it("hidden when off; re-hung on a new hand after a rebuild; disposing takes it off the hand; every pennant shares one stick and one cloth", () => {
    const a = new Group(), b = new Group();
    const p = new PennantHold(1);
    p.attach(a);
    p.update(false, 0);
    expect(p.group.visible).toBe(false);
    p.dispose();
    expect(p.group.parent).toBeNull();
    p.attach(b);
    expect(p.group.parent).toBe(b);
    const other = new PennantHold(2);
    expect((other.group.children[0] as Mesh).geometry).toBe((p.group.children[0] as Mesh).geometry);
    expect((other.group.children[1] as Mesh).geometry).toBe((p.group.children[1] as Mesh).geometry);
  });

  it("the cloth is the Society's colours: red, with a cream band across its middle", () => {
    const g = (new PennantHold(3).group.children[1] as Mesh).geometry;
    const col = g.getAttribute("color");
    const seen = new Set<string>();
    for (let i = 0; i < col.count; i++) seen.add(`${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}`);
    expect(seen.size, "two colours, no blend between them").toBe(2);
  });
});
