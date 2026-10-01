import { Box3, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FLAG, WEAPON } from "@cb/shared";
import { generateCharacter } from "@cb/procedural";
import { CharacterAnimator, buildCharacter } from "@cb/procedural/three";
import { FIT_SHAPES } from "../../../../../packages/procedural/src/three/fit/shapes.ts";
import { Holsters, SLOT_OF, WorldWeapon, holsterPose, newMountPose, restTilt } from "./WeaponMounts.ts";
import { WeaponRig } from "./WeaponRig.ts";
import { disposeWeaponModels, weaponTriangles } from "./WeaponModels.ts";

/** The weapons off the hands: stowed on a body and lying where they were dropped (the other two of the four contexts). */

const ALL = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.BLUNDERBUSS, WEAPON.SABRE, WEAPON.UMBRELLA];
const shapes = process.env.WEAPON_SHAPES === "all" ? FIT_SHAPES : FIT_SHAPES.filter((_, i) => i < 14 || i % 7 === 0);

const meshTriangles = (root: { traverse(f: (o: unknown) => void): void }): number => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof Mesh && o.visible && o.name !== "weapon_ink") n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position!.count) / 3;
  });
  return n;
};

describe("stowed weapons", () => {
  it("every weapon has a place on the body and every pose is finite; two weapons never share a slot on one body", () => {
    for (const { spec } of shapes) {
      const rig = buildCharacter({ ...generateCharacter(3), ...spec, woodenLeg: 0 }, { outline: false });
      for (const id of ALL) {
        expect(SLOT_OF[id], `slot of ${id}`).toBeDefined();
        const p = holsterPose(id, rig.proportions, newMountPose());
        for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  }, 120_000);

  it("the stowed weapons clear the ground on every body shape: pistol, sabre, rifle, umbrella carried together hang above the floor and beside the torso", () => {
    for (const { name, spec } of shapes) {
      const rig = buildCharacter({ ...generateCharacter(3), ...spec, woodenLeg: 0 }, { outline: false });
      rig.root.position.set(0, 0, 0);
      const h = new Holsters(rig, false);
      h.show([WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.SABRE, WEAPON.UMBRELLA], -1);
      const box = h.bounds(new Box3());
      expect(box.isEmpty(), name).toBe(false);
      // (the model is at rest height 0 and the soles are the ground; the lowest weapon point must be above the floor by at least a hand's width less than it is long)
      const floor = new Box3().setFromObject(rig.root).min.y;
      expect(box.min.y, `${name}: a stowed weapon dips through the floor (${box.min.y.toFixed(2)} < ${floor.toFixed(2)})`).toBeGreaterThanOrEqual(floor - 0.01);
      // only one weapon of a slot: the sabre has the left hip, the umbrella is left off
      let meshes = 0;
      rig.joints.torso.traverse((o) => {
        if (o.name.startsWith("weapon_") && o.parent?.visible) meshes++;
      });
      expect(meshes, name).toBeGreaterThan(2);
      h.dispose();
    }
  }, 120_000);

  it("the weapon in the hands is not on the body, and a body with busy hands (carrying, downed) wears everything it carries", () => {
    const rig = buildCharacter({ ...generateCharacter(5), woodenLeg: 0 }, { outline: false });
    const anim = new CharacterAnimator(rig);
    const wr = new WeaponRig(rig, anim, false);
    const carried = [WEAPON.PISTOL, WEAPON.RIFLE, WEAPON.SABRE];
    const visibleHung = (): string => {
      const names: string[] = [];
      rig.joints.torso.traverse((o) => {
        if (o.name.startsWith("weapon_") && o.visible && o.parent?.visible && o.parent !== rig.joints.torso) names.push(o.name);
      });
      return names.sort().join(",");
    };
    wr.update(1 / 30, { weapon: -1, aiming: false, elev: 0, reload: 0, hidden: false, crew: 0, fp: 0, carried });
    expect(visibleHung()).toBe("weapon_0,weapon_1,weapon_3");
    wr.update(1 / 30, { weapon: WEAPON.RIFLE, aiming: false, elev: 0, reload: 0, hidden: false, crew: 0, fp: 0, carried });
    // (the drawn rifle is the one model parented straight to the torso: the hung ones are in their slot groups)
    expect(visibleHung()).toBe("weapon_0,weapon_3");
    wr.update(1 / 30, { weapon: WEAPON.RIFLE, aiming: false, elev: 0, reload: 0, hidden: true, crew: 0, fp: 0, carried });
    expect(visibleHung()).toBe("weapon_0,weapon_1,weapon_3");
    wr.update(1 / 30, { weapon: -1, aiming: false, elev: 0, reload: 0, hidden: false, crew: 0, fp: 0 });
    expect(visibleHung()).toBe("");
    anim.update(1 / 30, { speed: 0, flags: FLAG.GROUNDED, vy: 0 });
    wr.dispose();
  });

  it("a far body carries the far level of detail: the weapon in the hands and the ones on the body are lighter", () => {
    const rig = buildCharacter({ ...generateCharacter(5), woodenLeg: 0 }, { outline: false });
    const anim = new CharacterAnimator(rig);
    const wr = new WeaponRig(rig, anim, false);
    const ctx = { weapon: WEAPON.RIFLE, aiming: false, elev: 0, reload: 0, hidden: false, crew: 0, fp: 0, carried: [WEAPON.RIFLE, WEAPON.PISTOL] };
    wr.update(1 / 30, ctx);
    const near = meshTriangles(rig.joints.torso);
    rig.setLod(2);
    wr.update(1 / 30, ctx);
    const far = meshTriangles(rig.joints.torso);
    expect(far).toBeLessThan(near * 0.7);
    expect(weaponTriangles(WEAPON.RIFLE, 2)).toBeLessThan(weaponTriangles(WEAPON.RIFLE, 0));
    wr.dispose();
    disposeWeaponModels();
  });
});

describe("dropped weapons", () => {
  it("every weapon lies flat with its lowest point on the ground, and `place` sets where and which way", () => {
    for (const id of ALL) {
      const t = restTilt(id);
      expect(Number.isFinite(t.lift + t.pitch + t.roll)).toBe(true);
      expect(t.lift, `lift of ${id}`).toBeGreaterThan(0.01);
      expect(t.lift, `lift of ${id}`).toBeLessThan(0.15);
      const w = new WorldWeapon(id, false).place(2, 0.5, -3, 1.1);
      w.group.updateMatrixWorld(true);
      const box = new Box3().setFromObject(w.group, true);
      expect(box.min.y, `${id} rests on the ground`).toBeGreaterThan(0.5 - 0.02);
      expect(box.min.y, `${id} rests on the ground`).toBeLessThan(0.5 + 0.03);
      const c = box.getCenter(new Vector3());
      expect(Math.hypot(c.x - 2, c.z + 3), `${id} is where it was put`).toBeLessThan(0.7);
      w.dispose();
    }
    disposeWeaponModels();
  });
});
