import { describe, expect, it } from "vitest";
import { computeProportions } from "../proportions.ts";
import { generateCharacter } from "../spec.ts";
import { buildHead } from "./head.ts";

const colors = { skin: 0xd29c76, hairC: 0x3b2616, hatC: 0x555555, accent: 0xd0a94a, burnt: 0 };

describe("hats cover the skull", () => {
  for (let hat = 1; hat <= 20; hat++) {
    it(`hat ${hat}: the crown clears the top of the head on every build`, () => {
      for (let seed = 0; seed < 30; seed++) {
        const spec = { ...generateCharacter(seed), hat, hair: 0 };
        const P = computeProportions(spec);
        const g = buildHead(spec, P, colors)!;
        g.computeBoundingBox();
        const bare = buildHead({ ...spec, hat: 0 }, P, colors)!;
        bare.computeBoundingBox();
        // (the sculpted skull is a little taller than a sphere, so compare with the bare head itself)
        expect(g.boundingBox!.max.y, `seed ${seed}`).toBeGreaterThan(bare.boundingBox!.max.y + 0.04 * P.headRadius);
      }
    });
  }
});
