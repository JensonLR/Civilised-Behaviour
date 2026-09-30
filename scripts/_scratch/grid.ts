import { skullGrid, headShape } from "../../packages/procedural/src/three/headShape.ts";
import { computeProportions } from "../../packages/procedural/src/proportions.ts";
import { generateCharacter } from "../../packages/procedural/src/spec.ts";
const g = skullGrid(false);
console.log("thetas", g.thetas.map((t, j) => `${j}:${t.toFixed(3)}`).join(" "));
console.log("phis(front half)", g.phis.slice(12, 21).map((t, j) => `${j + 12}:${t.toFixed(3)}`).join(" "));
const P = computeProportions(generateCharacter(3));
const s = headShape(P);
console.log("R", P.headRadius);
for (const j of [11, 12, 13, 14, 15, 16, 17]) { const th = g.thetas[j]!; const dx = 0, dy = Math.sin(th), dz = -Math.cos(th); const r = s.radius(dx, dy, dz); console.log(j, th.toFixed(3), "y/R", (dy * r / P.headRadius).toFixed(3), "z/R", (dz*r/P.headRadius).toFixed(3)); }
