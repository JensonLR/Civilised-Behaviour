import { BufferAttribute, BufferGeometry, Color } from "three";
import { PALETTE, Rng, valueNoise } from "./shared.ts";
import { skirtY } from "./ground.ts";

/**
 * The delta's horizon: not hills (there are none) but a LINE. A ring of low reed banks and sandbars, a metre or two high, drifting in and out of the haze at 190..330 m, and a scatter of hairs on it: far masts,
 * pump-towers and the sails of stilted villages that nobody will reach. One vertex-coloured mesh, fogged by the scene like everything else; it is the silhouette the region is measured against, drawn.
 */
export function buildDeltaHorizon(masts = 18): BufferGeometry {
  const P = PALETTE.saltmarket;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const cc = new Color();
  const around = 96;
  const rings = [196, 232, 280, 336];
  const y0 = skirtY();
  const height = (r: number, th: number): number => {
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const n = valueNoise(511, x / 22, z / 22), m = valueNoise(513, x / 7, z / 7);
    return Math.max(0, (n - 0.4) * 5.0 + (m - 0.5) * 0.9);
  };
  const push = (r: number, th: number, tone: number): void => {
    const y = y0 + height(r, th) * (r < 300 ? 1 : 0.7);
    pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
    nor.push(0, 1, 0);
    cc.set(P.reedDark).lerp(new Color(P.silt), 0.35 + 0.45 * tone).lerp(new Color(P.reed), 0.25 * (1 - tone));
    col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < around; k++) {
      const t0 = (k / around) * Math.PI * 2;
      const t1 = ((k + 1) / around) * Math.PI * 2;
      const a = rings[i]!, b = rings[i + 1]!;
      const tone = i / rings.length;
      push(a, t0, tone);
      push(b, t1, tone + 0.2);
      push(b, t0, tone + 0.2);
      push(a, t0, tone);
      push(a, t1, tone);
      push(b, t1, tone + 0.2);
    }
  }
  // the far hairs: masts and pump-towers as thin four-sided spikes
  const rng = new Rng(0x4a57);
  for (let m = 0; m < masts; m++) {
    const th = rng.range(0, Math.PI * 2);
    const r = rng.range(250, 340);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const base = y0 + height(r, th) * 0.7;
    const h = rng.range(8, 17);
    const w = rng.range(0.25, 0.5);
    const top = base + h;
    const pts = [[-w, -w], [w, -w], [w, w], [-w, w]] as const;
    cc.set(P.pilingDark).lerp(new Color(P.silt), 0.4);
    for (let f = 0; f < 4; f++) {
      const a = pts[f]!, b = pts[(f + 1) % 4]!;
      for (const v of [[x + a[0], base, z + a[1]], [x + b[0], base, z + b[1]], [x, top, z]] as const) {
        pos.push(v[0], v[1], v[2]);
        nor.push(0, 0, 1);
        col.push(cc.r, cc.g, cc.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}
