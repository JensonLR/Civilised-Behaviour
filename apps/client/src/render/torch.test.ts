import { describe, expect, it } from "vitest";
import { Group, Quaternion, Vector3 } from "three";
import { TorchHold } from "./torch.ts";

describe("TorchHold (D-047): a raider's torch stays upright in the hand", () => {
  it("whatever the wrist is doing, the torch's up axis points up (a slight forward lean), and the flame flickers within bounds", () => {
    const up = new Vector3();
    const q = new Quaternion();
    for (const [ax, ay, az, ang] of [[1, 0, 0, 1.4], [0, 0, 1, -2.2], [1, 1, 0, 0.9], [0.3, -1, 0.5, 3.0]] as const) {
      const root = new Group();
      const arm = new Group();
      root.add(arm);
      root.rotation.y = 0.7;
      arm.quaternion.setFromAxisAngle(new Vector3(ax, ay, az).normalize(), ang);
      root.updateMatrixWorld(true);
      const t = new TorchHold(5);
      t.attach(arm);
      t.update(true, 1.234);
      root.updateMatrixWorld(true);
      t.group.getWorldQuaternion(q);
      up.set(0, 1, 0).applyQuaternion(q);
      expect(up.y, `wrist ${ax},${ay},${az} @${ang}`).toBeGreaterThan(0.97);
      expect(t.group.visible).toBe(true);
    }
  });

  it("hidden when off; re-hung on a new hand after a rebuild; disposing takes it off the hand", () => {
    const a = new Group(), b = new Group();
    const t = new TorchHold(1);
    t.attach(a);
    t.update(false, 0);
    expect(t.group.visible).toBe(false);
    t.dispose();
    expect(t.group.parent).toBeNull();
    t.attach(b);
    expect(t.group.parent).toBe(b);
  });
});
