import { Box3, Mesh, Vector3 } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { HEAD, LIMB } from "@cb/shared";
import { generateCharacter } from "../spec.ts";
import { buildCharacter, clearCharacterCaches } from "./rig.ts";

afterAll(() => clearCharacterCaches());

const visible = (o: { visible: boolean; parent: unknown }): boolean => {
  for (let n: any = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};

/** D-118: a rig whose head has come off: everything on the head joint hidden, a neck stump on the collar, and the head itself as debris, as it was. */
describe("D-118: a head taken off", () => {
  it("hides the head joint and everything on it, stands a capped neck stump where it was, and gives it back when the bit goes", () => {
    for (let seed = 0; seed < 6; seed++) {
      const rig = buildCharacter(generateCharacter(seed), { outline: true });
      const headMesh = rig.joints.head.children.find((o) => o.name === "mesh_head") as Mesh;
      expect(headMesh).toBeDefined();
      expect(rig.headless).toBe(false);
      for (const gore of ["full", "reduced", "off"] as const) {
        rig.setMissing(HEAD | LIMB.ARM_L, gore);
        expect(rig.headless).toBe(true);
        expect(visible(headMesh), `seed ${seed}`).toBe(false);
        // the face's parts and the dressing are on the joint too: nothing on it shows
        rig.joints.head.traverse((o) => expect(visible(o)).toBe(false));
        const stump = rig.joints.torso.children.find((o) => o.name === "stump_head") as Mesh;
        expect(stump && visible(stump), `seed ${seed} ${gore}`).toBe(true);
        // it stands where the neck came out of the collar: its top a few centimetres above the joint, its foot inside the torso
        rig.root.updateMatrixWorld(true);
        const box = new Box3().setFromObject(stump);
        const joint = rig.joints.head.getWorldPosition(new Vector3());
        expect(box.max.y).toBeGreaterThan(joint.y);
        expect(box.max.y).toBeLessThan(joint.y + rig.proportions.headRadius * 0.3);
        expect(box.min.y).toBeLessThan(joint.y - rig.proportions.neck);
        // the arm's stump is there as before: a head is not a limb and takes nothing from the limbs
        expect(rig.joints.shoulderL.children.some((o) => o.name.startsWith("stump_") && visible(o))).toBe(true);
      }
      rig.setMissing(0);
      expect(rig.headless).toBe(false);
      expect(visible(headMesh)).toBe(true);
      expect(visible(rig.joints.torso.children.find((o) => o.name === "stump_head")!)).toBe(false);
      rig.dispose();
    }
  });

  it("the head comes away whole, as it was: its mesh (and hull) and the face, in place about the neck joint, the head standing up from it", () => {
    const rig = buildCharacter(generateCharacter(3), { outline: true });
    rig.root.position.set(4, 0, -2);
    rig.root.rotation.y = 1.1;
    rig.root.updateMatrixWorld(true);
    const before = new Box3().setFromObject(rig.joints.head.children.find((o) => o.name === "mesh_head")!);
    rig.setMissing(HEAD); // (whether or not it is already hidden)
    const piece = rig.detachLimb(HEAD)!;
    expect(piece).toBeDefined();
    const names = piece.children.map((o) => o.name);
    expect(names).toContain("mesh_head");
    expect(names).toContain("outline_head");
    expect(names).toContain("faceRoot");
    // the copy is where the head was (shared geometry, same size and place)
    piece.updateMatrixWorld(true);
    const copy = new Box3().setFromObject(piece.children.find((o) => o.name === "mesh_head")!);
    expect(copy.min.distanceTo(before.min)).toBeLessThan(1e-4);
    expect(copy.max.distanceTo(before.max)).toBeLessThan(1e-4);
    // the pivot is the neck joint, and the head stands up from it
    const joint = rig.joints.head.getWorldPosition(new Vector3());
    expect(piece.position.distanceTo(joint)).toBeLessThan(1e-6);
    expect(copy.max.y - piece.position.y).toBeGreaterThan(rig.proportions.headRadius * 1.5);
    rig.dispose();
  });
});
