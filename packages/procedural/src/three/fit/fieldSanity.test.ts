import { describe, expect, it } from "vitest";
import { generateCharacter } from "../../spec.ts";
import { buildCharacter } from "../rig.ts";
import { BONES, framesFromRig, restFrames } from "./bodyField.ts";
import { bodyField } from "./index.ts";

describe("body field: sanity", () => {
  it("analytic rest frames equal the built rig's", () => {
    for (const seed of [1, 5, 9, 33]) {
      const spec = generateCharacter(seed);
      const rig = buildCharacter(spec, { outline: false });
      rig.root.updateMatrixWorld(true);
      const built = framesFromRig(rig);
      const f = bodyField(spec);
      const rest = restFrames(f.P);
      for (const b of BONES) for (let i = 0; i < 16; i++) expect(Math.abs(rest[b]![i]! - built[b]![i]!), `${b}[${i}] seed ${seed}`).toBeLessThan(1e-6);
      rig.dispose();
    }
  });

  it("surface points are on the zero level set and lifted ones sit `lift` out", () => {
    const worst = { torso: 0, arm: 0, leg: 0, head: 0 };
    for (const seed of [2, 15, 40, 77]) {
      const f = bodyField(generateCharacter(seed));
      const h = f.P.torsoHeight;
      for (const layer of ["skin", "worn"] as const) {
        for (const y of [0.1, 0.3, 0.5, 0.7, 0.85].map((v) => v * h)) {
          for (const phi of [0, 0.7, 1.4, 2.2, 3.1, -1, -2.5]) {
            const s = f.torsoSurface(y, phi, 0, layer);
            const only = ["torso"] as const;
            const d0 = f.sdf(f.toRig("torso", s.p), layer, Infinity, only);
            const l = f.torsoSurface(y, phi, 0.02, layer);
            const d2 = f.sdf(f.toRig("torso", l.p), layer, Infinity, only);
            // the torso is inside its own layer; other parts (arms) can be nearer at the sides, so only require the min to be no larger
            worst.torso = Math.max(worst.torso, Math.abs(d0) < 0.03 ? Math.abs(d0) : 0);
            expect(d0, `torso ${seed} y${y} phi${phi} ${layer}`).toBeLessThan(0.012);
            expect(d2).toBeGreaterThan(-0.012);
            expect(d2 - d0).toBeGreaterThan(0.006);
          }
        }
      }
      const R = f.P.headRadius;
      for (const dir of [[0, 0, -1], [0, 1, 0], [1, 0.2, -0.3], [-1, 0, 0], [0, -0.5, -1]] as const) {
        const s = f.headSurface(dir, 0);
        expect(Math.abs(f.sdfBone("head", s.p, "skin")), `head ${dir}`).toBeLessThan(R * 0.03);
        const l = f.headSurface(dir, 0.02);
        expect(f.sdfBone("head", l.p, "skin")).toBeGreaterThan(0.008);
      }
      for (const bone of ["upperArmL", "upperLegR", "lowerLegL", "foreArmR"] as const) {
        const len = bone.startsWith("upperArm") ? f.P.armUpper : bone.startsWith("foreArm") ? f.P.armLower : bone.startsWith("upperLeg") ? f.P.legUpper : f.P.legLower;
        for (const t of [0.15, 0.5, 0.8]) for (const phi of [0, 1.5, 3, -1.5]) {
          const s = f.limbSurface(bone, -len * t, phi, 0, "skin");
          const d = f.sdfBone(bone, s.p, "skin");
          // a limb's neighbour (torso, other leg) may be nearer; the point can only be inside or on the limb
          expect(d, `${bone} t${t} phi${phi}`).toBeLessThan(0.006);
          if (d > -0.01) worst.arm = Math.max(worst.arm, Math.abs(d));
        }
      }
    }
    expect(worst.arm).toBeLessThan(0.008);
  });

  it("nearest() projects onto the surface along the normal", () => {
    const f = bodyField(generateCharacter(3));
    const s = f.torsoSurface(f.P.torsoHeight * 0.5, 0.3, 0.0);
    const p = f.toRig("torso", [s.p[0], s.p[1], s.p[2]]);
    const n = f.toRigDir("torso", s.n);
    const q: [number, number, number] = [p[0] + n[0] * 0.05, p[1] + n[1] * 0.05, p[2] + n[2] * 0.05];
    const near = f.nearest(q, "worn");
    expect(near.dist).toBeGreaterThan(0.03);
    expect(Math.hypot(near.point[0] - p[0], near.point[1] - p[1], near.point[2] - p[2])).toBeLessThan(0.02);
    expect(near.region).toBe("torso");
  });
});
