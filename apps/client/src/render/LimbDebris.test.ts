import { Group, Scene, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { DEBRIS, LimbDebris } from "./LimbDebris.ts";

const flat = (): number => 0;
const limb = (): Group => new Group();
const run = (d: LimbDebris, seconds: number, dt = 1 / 30): void => {
  for (let t = 0; t < seconds; t += dt) d.update(dt);
};

describe("LimbDebris", () => {
  it("flies off in the direction of the blow, lands, and comes to rest flat on the ground", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, flat);
    const g = limb();
    g.position.set(0, 1.1, 0);
    d.spawn(g, 1, 0, 1, "full");
    run(d, 0.5);
    expect(g.position.x).toBeGreaterThan(0.5); // thrown along +x
    run(d, 6);
    expect(g.position.y).toBeCloseTo(DEBRIS.restHeight, 3);
    const x = g.position.x;
    run(d, 1);
    expect(g.position.x).toBeCloseTo(x, 1); // stopped
    // lying: the limb's length axis (-Y) has been laid horizontal
    const axisY = -1 * (1 - 2 * (g.quaternion.x ** 2 + g.quaternion.z ** 2));
    expect(Math.abs(axisY)).toBeLessThan(0.1);
  });

  it("every throw comes to rest: on the ground, flat and still (a sweep of throws, not one random one)", () => {
    // A throw is a function of Math.random; pinning it to c in 0..1 sweeps the throws deterministically. A bounce whose last step landed
    // within the 1 mm the step treats as resting, but above the contact line, used to hover there for the limb's whole life, spinning
    // (c = 0.800..0.808 here, ~0.7% of random throws).
    const stuck: string[] = [];
    for (let k = 0; k < 1000; k++) {
      const c = k / 1000;
      const d = new LimbDebris(new Scene(), flat);
      const g = limb();
      g.position.set(0, 1.1, 0);
      const random = vi.spyOn(Math, "random").mockReturnValue(c);
      d.spawn(g, 1, 0, 1, "full");
      random.mockRestore();
      run(d, 8);
      const q = g.quaternion.clone();
      run(d, 1);
      const axisY = 1 - 2 * (g.quaternion.x ** 2 + g.quaternion.z ** 2);
      const turned = 2 * Math.acos(Math.min(1, Math.abs(q.dot(g.quaternion))));
      if (Math.abs(g.position.y - DEBRIS.restHeight) > 1e-4 || Math.abs(axisY) >= 0.1 || turned > 1e-3) {
        stuck.push(`c=${c}: y ${g.position.y.toFixed(4)}, axis ${axisY.toFixed(2)}, turned ${turned.toFixed(3)} rad in the last second`);
      }
    }
    expect(stuck).toEqual([]);
  });

  it("D-064: a blast throws the limbs lying near it up and away again; one out of reach stays put", () => {
    const d = new LimbDebris(new Scene(), flat);
    const near = limb();
    near.position.set(1, 1.1, 0);
    const far = limb();
    far.position.set(30, 1.1, 0);
    d.spawn(near, 0, 1, 0.3, "full");
    d.spawn(far, 0, 1, 0.3, "full");
    run(d, 8);
    const rest = { nx: near.position.x, fx: far.position.x, fz: far.position.z };
    let lands = 0;
    d.onLand = () => lands++;
    d.blast(0, near.position.z, 5);
    let top = 0;
    for (let t = 0; t < 0.4; t += 1 / 30) {
      d.update(1 / 30);
      top = Math.max(top, near.position.y);
    }
    expect(top).toBeGreaterThan(0.5);
    run(d, 8);
    expect(near.position.x).toBeGreaterThan(rest.nx + 1); // away from the blast (it was east of it)
    expect(near.position.y).toBeCloseTo(DEBRIS.restHeight, 3); // and down again
    expect(lands).toBe(1); // (where it lands it bleeds again)
    expect(far.position.x).toBeCloseTo(rest.fx, 5);
    expect(far.position.z).toBeCloseTo(rest.fz, 5);
  });

  it("follows uneven ground", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, (x) => 0.5 + 0.2 * Math.sin(x));
    const g = limb();
    g.position.set(0, 2, 0);
    d.spawn(g, 0, 1, 0.5, "off");
    run(d, 8);
    expect(g.position.y).toBeCloseTo(0.5 + 0.2 * Math.sin(g.position.x) + DEBRIS.restHeight, 2);
  });

  it("is capped, dropping the oldest, and cleans up after itself", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, flat);
    const groups = Array.from({ length: DEBRIS.max + 3 }, limb);
    for (const g of groups) d.spawn(g, 1, 0, 0.5, "reduced");
    expect(d.count).toBe(DEBRIS.max);
    expect(groups[0]!.parent).toBeNull();
    expect(groups[groups.length - 1]!.parent).toBe(scene);
    run(d, DEBRIS.life + 1, 0.5);
    expect(d.count).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("shrinks before it vanishes", () => {
    const d = new LimbDebris(new Scene(), flat);
    const g = limb();
    d.spawn(g, 1, 0, 0.5, "full");
    run(d, DEBRIS.life - DEBRIS.fade / 2, 0.25);
    expect(g.scale.x).toBeLessThan(0.7);
    expect(g.scale.x).toBeGreaterThan(0);
  });

  it("survives a zero blow direction and stays finite", () => {
    const d = new LimbDebris(new Scene(), flat);
    const g = limb();
    g.position.set(0, 1, 0);
    d.spawn(g, 0, 0, 0, "full");
    run(d, 5);
    for (const v of [g.position.x, g.position.y, g.position.z, g.quaternion.w]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("D-104: a weapon knocked out of a hand", () => {
  it("is shown (models are built hidden), flies with the blow, clatters once, never bleeds, and lies flat and still on its side", () => {
    const scene = new Scene();
    const d = new LimbDebris(scene, flat);
    let bled = 0;
    const clatters: number[] = [];
    d.onLand = () => void bled++;
    d.onClatter = (x) => void clatters.push(x);
    const gun = new Group();
    gun.visible = false;
    gun.scale.setScalar(0.8);
    gun.position.set(0, 1, 0);
    d.throwAway(gun, 1, 0, 0.7);
    expect(gun.visible).toBe(true);
    expect(d.count).toBe(1);
    run(d, 0.4);
    const piece = gun.parent!;
    expect(piece.position.x).toBeGreaterThan(0.4);
    run(d, 6);
    expect(clatters).toHaveLength(1);
    expect(bled).toBe(0);
    expect(piece.position.y).toBeGreaterThan(0);
    expect(piece.position.y).toBeLessThan(0.06);
    const x = piece.position.x;
    run(d, 1);
    expect(piece.position.x).toBeCloseTo(x, 2);
    expect(gun.scale.x).toBeCloseTo(0.8, 5); // (the size the body held it at survives the debris' own fade scale)
    // on its side: the barrel (-Z) level, and the model's up (+Y) turned to lie along the ground
    const v = new Vector3(0, 0, -1).applyQuaternion(piece.quaternion);
    expect(Math.abs(v.y)).toBeLessThan(0.1);
    const up = new Vector3(0, 1, 0).applyQuaternion(piece.quaternion);
    expect(Math.abs(up.y)).toBeLessThan(0.1);
    d.dispose();
    expect(gun.parent?.parent).toBeFalsy();
  });
});
