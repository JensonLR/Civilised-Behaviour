import { describe, expect, it } from "vitest";
import { computeProportions } from "../proportions.ts";
import { generateCharacter } from "../spec.ts";
import { buildHead } from "./head.ts";
import { headShape } from "./headShape.ts";

const colors = { skin: 0xd29c76, hairC: 0x3b2616, hatC: 0x555555, accent: 0xd0a94a, burnt: 0 };

describe("hats cover the skull", () => {
  for (let hat = 1; hat <= 20; hat++) {
    it(`hat ${hat}: the crown clears the top of the head on every build`, () => {
      for (let seed = 0; seed < 30; seed++) {
        const spec = { ...generateCharacter(seed), hat, hair: 0, hairAcc: 0 };
        const P = computeProportions(spec);
        const g = buildHead(spec, P, colors)!;
        g.computeBoundingBox();
        // (the sculpted skull is a little taller than a sphere: compare with the skull's own top, not with a pointed ear beside it)
        const skullTop = P.headRadius + headShape(P).radius(0, 1, 0);
        expect(g.boundingBox!.max.y, `seed ${seed}`).toBeGreaterThan(skullTop + 0.04 * P.headRadius);
      }
    });
  }

  it("hair accessories never rise above a hat's crown or stick out past its brim (they hang low behind the ear under a hat)", () => {
    for (let hat = 1; hat <= 20; hat++) {
      for (let hairAcc = 1; hairAcc <= 5; hairAcc++) {
        for (const seed of [2, 6, 11]) {
          const spec = { ...generateCharacter(seed), hat, hair: 1, hairAcc: 0 };
          const P = computeProportions(spec);
          const plain = buildHead(spec, P, colors)!;
          plain.computeBoundingBox();
          const dressed = buildHead({ ...spec, hairAcc }, P, colors)!;
          dressed.computeBoundingBox();
          const label = `hat ${hat} accessory ${hairAcc} seed ${seed}`;
          expect(dressed.boundingBox!.max.y, label).toBeLessThanOrEqual(plain.boundingBox!.max.y + 1e-4);
          expect(dressed.boundingBox!.max.x, label).toBeLessThanOrEqual(plain.boundingBox!.max.x + P.headRadius * 0.3);
          expect(dressed.boundingBox!.min.x, label).toBeGreaterThanOrEqual(plain.boundingBox!.min.x - P.headRadius * 0.3);
        }
      }
    }
  });
});
