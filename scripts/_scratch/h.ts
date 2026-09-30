import { generateCharacter } from "../../packages/procedural/src/spec.ts";
import { computeProportions } from "../../packages/procedural/src/proportions.ts";
for (const s of [3, 4, 5, 6]) { const P = computeProportions(generateCharacter(s)); console.log(s, "H", P.totalHeight.toFixed(3), "R", P.headRadius.toFixed(3), "ty default", (P.totalHeight * 0.82).toFixed(3), "head centre", (P.totalHeight - P.headRadius).toFixed(3)); }
