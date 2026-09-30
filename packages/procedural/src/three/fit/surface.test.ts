import { Triangle, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { generateCharacter } from "../../spec.ts";
import { computeProportions } from "../../proportions.ts";
import { loftGeometry } from "../loft.ts";
import { polySurface } from "./surface.ts";
import { torsoRings } from "./torsoShape.ts";
import { STUBBY_WIDE, TALL_THIN } from "./shapes.ts";

/** Distance from p to the mesh (brute force). */
function distTo(geo: ReturnType<typeof loftGeometry>, p: Vector3): number {
  const pos = geo.attributes.position!;
  const ix = geo.index!;
  const t = new Triangle();
  const q = new Vector3();
  let best = Infinity;
  for (let i = 0; i < ix.count; i += 3) {
    t.set(new Vector3().fromBufferAttribute(pos, ix.getX(i)), new Vector3().fromBufferAttribute(pos, ix.getX(i + 1)), new Vector3().fromBufferAttribute(pos, ix.getX(i + 2)));
    t.closestPointToPoint(p, q);
    best = Math.min(best, q.distanceTo(p));
  }
  return best;
}

describe("polySurface: the surface of the loft as drawn", () => {
  for (const [name, spec] of [["stubby", STUBBY_WIDE], ["thin", TALL_THIN], ["seed5", generateCharacter(5)]] as const) {
    for (const seg of [10, 16]) {
      it(`${name}: points lie on the ${seg}-sided torso loft and lifted points sit \`lift\` out`, () => {
        const P = computeProportions(spec);
        const rings = torsoRings(P, 0, 1);
        const geo = loftGeometry(rings, { color: 0, segments: seg });
        const s = polySurface(rings, seg);
        let worst = 0;
        for (const y of [0.1, 0.3, 0.5, 0.7, 0.85].map((v) => v * P.torsoHeight)) {
          for (const phi of [0, 0.3, 0.9, 1.4, 2.2, 3.0, -0.6, -1.9, -2.7]) {
            const a = s.at(phi, y, 0);
            worst = Math.max(worst, distTo(geo, new Vector3(...a.p)));
            const b = s.at(phi, y, 0.02);
            // the lifted point is `lift` from the plane of its face
            expect(distTo(geo, new Vector3(...b.p)), `phi ${phi} y ${y}`).toBeGreaterThan(0.007);
          }
        }
        expect(worst, "surface points are ON the mesh").toBeLessThan(0.002);
        // atX: the point at a lateral offset really has that x
        for (const x of [-0.5, 0, 0.3, 0.6].map((k) => k * s.section(P.torsoHeight * 0.5).rx)) {
          const f = s.atX(x, P.torsoHeight * 0.5, 0);
          expect(Math.abs(f.p[0] - x)).toBeLessThan(0.002);
          expect(f.p[2]).toBeLessThan(s.section(P.torsoHeight * 0.5).cz);
          const bk = s.atX(x, P.torsoHeight * 0.5, 0, true);
          expect(bk.p[2]).toBeGreaterThan(s.section(P.torsoHeight * 0.5).cz);
        }
      });
    }
  }
});
