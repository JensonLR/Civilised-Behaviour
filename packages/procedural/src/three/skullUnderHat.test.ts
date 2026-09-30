import { describe, expect, it } from "vitest";
import { generateCharacter, type CharacterSpec } from "../spec.ts";
import { auditHead } from "./headAudit.ts";
import { HAT_COVERS_ABOVE } from "./head.ts";

/**
 * The skull above a hat's band is not drawn (head.ts: HAT_COVERS_ABOVE) - it saves ~100 triangles a head. That is only allowed if a hat really does cover that skin: from every
 * point of the skin more than HAT_COVERS_ABOVE above the band a ray straight up must meet the hat.
 */
function above(tris: Float32Array[], x: number, y: number, z: number): boolean {
  for (const t of tris) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as unknown as number[];
    if (Math.max(ay!, by!, cy!) < y) continue;
    const m = 0.004;
    if (x < Math.min(ax!, bx!, cx!) - m || x > Math.max(ax!, bx!, cx!) + m || z < Math.min(az!, bz!, cz!) - m || z > Math.max(az!, bz!, cz!) + m) continue;
    const d = (bz! - cz!) * (ax! - cx!) + (cx! - bx!) * (az! - cz!);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz! - cz!) * (x - cx!) + (cx! - bx!) * (z - cz!)) / d;
    const l2 = ((cz! - az!) * (x - cx!) + (ax! - cx!) * (z - cz!)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
    if (l1 * ay! + l2 * by! + l3 * cy! >= y - 1e-4) return true;
  }
  return false;
}

describe("skull under a hat", () => {
  it("every skin point above the omit line of every hat has hat above it (tiny, average and huge heads)", () => {
    for (const headScale of [10, 128, 250]) {
      for (let hat = 1; hat <= 20; hat++) {
        const spec = { ...generateCharacter(5), headScale, hat, hatTrim: 0, hair: 0, beard: 0, moustache: 0, sideburns: 0, eyewear: 0, scars: 0, earring: 0, hairAcc: 0 } as CharacterSpec;
        const a = auditHead(spec);
        const R = a.P.headRadius;
        const tris: Float32Array[] = [];
        for (const p of a.prims) {
          if (p.label !== "hat") continue;
          for (let t = 0; t < p.tris.length; t += 3) {
            const t9 = new Float32Array(9);
            for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) t9[k * 3 + c] = p.verts[p.tris[t + k]! * 3 + c]!;
            tris.push(t9);
          }
        }
        let bad = 0;
        for (let i = 0; i < 40; i++) {
          for (let j = 0; j < 12; j++) {
            const az = (i / 40) * Math.PI * 2;
            const dy = a.seatY + HAT_COVERS_ABOVE + 0.001 + (j / 11) * (0.98 - a.seatY - HAT_COVERS_ABOVE);
            if (dy > 0.98) continue;
            const k = Math.sqrt(1 - dy * dy);
            const dx = Math.sin(az) * k;
            const dz = -Math.cos(az) * k;
            const r = a.hf.shape.radius(dx, dy, dz);
            if (!above(tris, dx * r, R + dy * r, dz * r)) bad++;
          }
        }
        expect(bad, `hat ${hat} on head ${headScale}`).toBe(0);
      }
    }
  }, 300_000);
});
