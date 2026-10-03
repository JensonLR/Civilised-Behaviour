import { describe, expect, it } from "vitest";
import { Box3, Group, Quaternion, Scene, Vector3, type Mesh } from "three";
import { GROUND_TORCH, GroundTorches, TorchHold, groundFlame } from "./torch.ts";

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

describe("GroundTorches: a fallen raider's torch lies in the grass and burns down", () => {
  it("burns at full flame, then shrinks to nothing and goes out", () => {
    expect(groundFlame(0)).toBe(1);
    expect(groundFlame(GROUND_TORCH.burnS - 0.01)).toBe(1);
    expect(groundFlame(GROUND_TORCH.burnS + GROUND_TORCH.outS / 2)).toBeCloseTo(0.5, 5);
    expect(groundFlame(GROUND_TORCH.burnS + GROUND_TORCH.outS)).toBe(0);
    const scene = new Scene();
    const g = new GroundTorches(scene);
    g.drop(1, 0.2, 3, 0.5, 7);
    expect(g.burning).toBe(1);
    const torch = scene.getObjectByName("groundTorch")!;
    expect(torch.position.toArray()).toEqual([1, 0.2, 3]);
    for (let t = 0; t < GROUND_TORCH.burnS + GROUND_TORCH.outS + 0.5; t += 0.25) g.update(0.25);
    expect(g.burning).toBe(0);
    expect(torch.visible).toBe(false);
  });

  it("a pool: never more than the cap in the scene (the oldest is relit), cleared on a new shore, gone on dispose", () => {
    const scene = new Scene();
    const g = new GroundTorches(scene);
    for (let i = 0; i < GROUND_TORCH.cap + 5; i++) g.drop(i, 0, 0, 0, i);
    let n = 0;
    scene.traverse((o) => { if (o.name === "groundTorch") n++; });
    expect(n).toBe(GROUND_TORCH.cap);
    expect(g.burning).toBe(GROUND_TORCH.cap);
    g.clear();
    expect(g.burning).toBe(0);
    g.dispose();
    n = 0;
    scene.traverse((o) => { if (o.name === "groundTorch") n++; });
    expect(n).toBe(0);
  });
});

describe("the torch's look (D-048, what the first render of a dropped torch showed)", () => {
  it("the stick carries vertex colours (the toon material reads them: without, it drew black), charred at the head", () => {
    const t = new TorchHold(2);
    const stick = t.group.children[0] as Mesh;
    const col = stick.geometry.getAttribute("color");
    expect(col).toBeTruthy();
    expect(col.count).toBe(stick.geometry.getAttribute("position").count);
    let darkest = 1, lightest = 0;
    for (let i = 0; i < col.count; i++) {
      const l = col.getX(i) + col.getY(i) + col.getZ(i);
      darkest = Math.min(darkest, l);
      lightest = Math.max(lightest, l);
    }
    expect(darkest).toBeGreaterThan(0.01);           // nothing black
    expect(lightest - darkest).toBeGreaterThan(0.02); // a charred head on a lighter stick
  });

  it("a lying torch's flame burns down toward its base on the grass: never under the ground, whatever its age", () => {
    const scene = new Scene();
    const g = new GroundTorches(scene);
    g.drop(0, 2, 0, 0.4, 1);
    const torch = scene.getObjectByName("groundTorch")!;
    const flameMeshes = (torch.children[1] as Group).children;
    const box = new Box3();
    for (const age of [0, GROUND_TORCH.burnS + 0.5, GROUND_TORCH.burnS + GROUND_TORCH.outS * 0.5, GROUND_TORCH.burnS + GROUND_TORCH.outS * 0.9]) {
      const fresh = new GroundTorches(scene);
      fresh.drop(0, 2, 0, 0.4, 1);
      fresh.update(age);
      const t = scene.children[scene.children.length - 1]!;
      t.updateMatrixWorld(true);
      if (!t.visible) continue;
      const [outer, core, glow] = (t.children[1] as Group).children as [Mesh, Mesh, Mesh];
      for (const m of [outer, core]) {
        box.setFromObject(m);
        expect(box.min.y, `age ${age}: a cone's base`).toBeGreaterThan(2 - 0.02);
        expect(box.max.y, `age ${age}`).toBeGreaterThan(2);
      }
      // (the glow is a halo of light round the flame: its centre stays above the grass, its rim may touch it)
      box.setFromObject(glow);
      expect((box.min.y + box.max.y) / 2, `age ${age}: the glow's centre`).toBeGreaterThan(2);
    }
    expect(flameMeshes.length).toBe(3);
  });
});
