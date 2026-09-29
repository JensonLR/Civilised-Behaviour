import { Box3, Mesh } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { LIMB } from "@cb/shared";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { buildCharacter, clearCharacterCaches } from "./rig.ts";

afterAll(() => clearCharacterCaches());

const look = (seed: number, over: Partial<CharacterSpec>): CharacterSpec => ({ ...generateCharacter(seed), woodenLeg: 0, hook: 0, ...over });
const meshes = (rig: ReturnType<typeof buildCharacter>, prefix: string): Mesh[] => {
  const out: Mesh[] = [];
  rig.root.traverse((o) => o instanceof Mesh && o.name.startsWith(prefix) && out.push(o));
  return out;
};
const visible = (m: Mesh): boolean => {
  for (let n: any = m; n; n = n.parent) if (!n.visible) return false;
  return true;
};

describe("prosthetics", () => {
  it("a lost leg shows a peg leg when the spec's wooden leg is on that side, and only then", () => {
    for (let seed = 0; seed < 8; seed++) {
      for (const [limb, side] of [[LIMB.LEG_L, 1], [LIMB.LEG_R, 2]] as const) {
        const fitted = buildCharacter(look(seed, { woodenLeg: side }), { outline: false });
        fitted.setMissing(limb);
        const shown = meshes(fitted, "prosthesis_").filter(visible);
        expect(shown.length, `seed ${seed} limb ${limb}`).toBe(1);
        // the peg reaches the ground: its lowest point is where the foot would have been
        fitted.root.updateMatrixWorld(true);
        const box = new Box3().setFromObject(shown[0]!);
        expect(box.min.y, "peg reaches the floor").toBeLessThan(0.08);
        expect(box.min.y).toBeGreaterThan(-0.06);
        fitted.dispose();

        const other = buildCharacter(look(seed, { woodenLeg: 3 - side }), { outline: false });
        other.setMissing(limb);
        expect(meshes(other, "prosthesis_").filter(visible).length, "a peg on the other side is not fitted").toBe(0);
        other.dispose();

        const bare = buildCharacter(look(seed, {}), { outline: false });
        bare.setMissing(limb);
        expect(meshes(bare, "prosthesis_").filter(visible).length).toBe(0);
        expect(meshes(bare, "stump_").filter(visible).length, "the stump is capped").toBe(1);
        bare.dispose();
      }
    }
  });

  it("the prosthesis follows the animated knee (it hangs from the knee joint) and disappears when the leg is back", () => {
    const rig = buildCharacter(look(3, { woodenLeg: 2 }), { outline: false });
    rig.setMissing(LIMB.LEG_R);
    const peg = meshes(rig, "prosthesis_")[0]!;
    expect(peg.parent).toBe(rig.joints.kneeR);
    rig.setMissing(0);
    expect(visible(peg)).toBe(false);
    rig.dispose();
  });

  it("a lost arm shows an iron arm with a hook when the spec has a hook on that side", () => {
    for (let seed = 0; seed < 6; seed++) {
      for (const [limb, side] of [[LIMB.ARM_L, 1], [LIMB.ARM_R, 2]] as const) {
        const rig = buildCharacter(look(seed, { hook: side }), { outline: false });
        rig.setMissing(limb);
        expect(meshes(rig, "prosthesis_").filter(visible).length, `seed ${seed} limb ${limb}`).toBe(1);
        rig.dispose();
        const other = buildCharacter(look(seed, { hook: 3 - side }), { outline: false });
        other.setMissing(limb);
        expect(meshes(other, "prosthesis_").filter(visible).length).toBe(0);
        other.dispose();
      }
    }
  });

  it("an intact limb with a wooden leg or a hook wears it (the mesh differs from the plain one)", () => {
    const key = (spec: CharacterSpec, bone: string): number => {
      const rig = buildCharacter(spec, { outline: false });
      let n = 0;
      rig.root.traverse((o) => o instanceof Mesh && o.name === `mesh_${bone}` && (n += o.geometry.attributes.position!.count * 1000 + o.geometry.attributes.position!.getX(3) * 1e3));
      rig.dispose();
      return n;
    };
    const base = look(5, {});
    expect(key({ ...base, woodenLeg: 1 }, "lowerLegL")).not.toBe(key(base, "lowerLegL"));
    expect(key({ ...base, woodenLeg: 1 }, "lowerLegR")).toBe(key(base, "lowerLegR"));
    expect(key({ ...base, hook: 2 }, "foreArmR")).not.toBe(key(base, "foreArmR"));
    expect(key({ ...base, hook: 2 }, "foreArmL")).toBe(key(base, "foreArmL"));
  });

  it("gore Off shows the same prosthetic without a red vertex", () => {
    const rig = buildCharacter(look(4, { woodenLeg: 1 }), { outline: false });
    rig.setMissing(LIMB.LEG_L, "off");
    for (const m of [...meshes(rig, "stump_"), ...meshes(rig, "prosthesis_")]) {
      const c = m.geometry.attributes.color!;
      for (let i = 0; i < c.count; i++) expect(c.getX(i) > 0.5 && c.getY(i) < 0.2 && c.getZ(i) < 0.2, `${m.name} vertex ${i} is red`).toBe(false);
    }
    rig.dispose();
  });
});
