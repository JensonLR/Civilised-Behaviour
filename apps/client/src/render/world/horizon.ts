import { BufferAttribute, BufferGeometry, Color, SRGBColorSpace, Vector3 } from "three";
import { ARENA_RADIUS, PALETTE, Rng, groundColour, valueNoise, type Rgb } from "@cb/shared";

/**
 * The country beyond the arena: three low-poly hill rings that grow paler and hazier with distance (aerial perspective is
 * painted into the vertex colours, so they need no fog), and a ground skirt that carries the meadow out to the horizon where
 * fog dissolves it. The arena edge is therefore never the end of the world, only the edge of the map.
 */

export interface RingSpec {
  radius: number;
  width: number;
  height: number;
  haze: number;
  segments: number;
  colour: number;
  seed: number;
}

export const HILL_RINGS: readonly RingSpec[] = [
  { radius: 150, width: 38, height: 24, haze: 0.2, segments: 56, colour: PALETTE.world.hillNear, seed: 3 },
  { radius: 236, width: 64, height: 54, haze: 0.42, segments: 64, colour: PALETTE.world.hillMid, seed: 5 },
  { radius: 332, width: 96, height: 96, haze: 0.66, segments: 72, colour: PALETTE.world.hillFar, seed: 7 },
];

const FOOT = -12;

/** Crest height (0..1) at an angle: broad swells plus sharper peaks, periodic round the circle. */
export function ridge(seed: number, theta: number): number {
  const x = Math.cos(theta);
  const z = Math.sin(theta);
  return 0.18 + 0.55 * valueNoise(seed, x * 2.6 + 9, z * 2.6 + 9) + 0.27 * valueNoise(seed + 1, x * 7 + 3, z * 7 + 3);
}

/** All rings merged into one unlit, flat-faceted, vertex-coloured geometry. `sun` lights the facets in three steps. */
export function buildHills(fog: Color, sun: Vector3): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const base = new Color();
  const tmp = new Color();
  const forest = new Color(PALETTE.world.crownDeep);
  const sunN = sun.clone().normalize();
  for (const ring of HILL_RINGS) {
    const rng = new Rng(ring.seed * 977);
    base.set(ring.colour);
    const cols: { theta: number; rows: [number, number, number][]; tint: number[] }[] = [];
    for (let k = 0; k < ring.segments; k++) {
      const theta = ((k + rng.range(-0.3, 0.3)) / ring.segments) * Math.PI * 2;
      const H = ring.height * ridge(ring.seed, theta) * rng.range(0.85, 1.12);
      const foothill = H * rng.range(0.28, 0.5);
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      // cross-section: inner foot, foothill shoulder, crest, outer foot (radius, y)
      const prof: [number, number][] = [
        [ring.radius - ring.width, FOOT],
        [ring.radius - ring.width * rng.range(0.35, 0.6), foothill],
        [ring.radius + rng.range(-4, 4), H],
        [ring.radius + ring.width * 0.8, FOOT],
      ];
      // the foothill shoulder is wooded: tinted toward the trees' deep green, less so on the far rings
      cols.push({ theta, rows: prof.map(([r, y]) => [cx * r, y, cz * r] as [number, number, number]), tint: [0, 0.4 * (1 - ring.haze), 0.1, 0] });
    }
    for (let k = 0; k < ring.segments; k++) {
      const p = cols[k]!.rows;
      const q = cols[(k + 1) % ring.segments]!.rows;
      const pt = cols[k]!.tint;
      const qt = cols[(k + 1) % ring.segments]!.tint;
      for (let j = 0; j < 3; j++) {
        // two triangles per cell, flat colour by facing, hazier toward the foot
        const quad = [p[j]!, q[j]!, q[j + 1]!, p[j + 1]!];
        const quadTint = [pt[j]!, qt[j]!, qt[j + 1]!, pt[j + 1]!];
        for (const tri of [[0, 1, 2], [0, 2, 3]] as const) {
          const tints = [quadTint[tri[0]]!, quadTint[tri[1]]!, quadTint[tri[2]]!];
          a.set(...quad[tri[0]]!);
          b.set(...quad[tri[1]]!);
          c.set(...quad[tri[2]]!);
          n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
          if (n.y < 0) n.negate(); // faces are seen from inside the ring: light them by their upward side
          const lit = Math.min(1, Math.max(0, n.dot(sunN)));
          const step = lit > 0.62 ? 1.24 : lit > 0.3 ? 1.0 : 0.78;
          let vi = 0;
          for (const v of [a, b, c]) {
            const hazeY = ring.haze + (1 - Math.min(1, Math.max(0, (v.y - FOOT) / (ring.height * 0.6 - FOOT)))) * 0.42;
            tmp.copy(base).lerp(forest, tints[vi++]!).multiplyScalar(step).lerp(fog, Math.min(0.95, hazeY));
            pos.push(v.x, v.y, v.z);
            col.push(tmp.r, tmp.g, tmp.b);
          }
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/** Flat ground beyond the terrain: a disc ring from just inside the terrain's faded edge out past the farthest hills. */
export function buildSkirt(): BufferGeometry {
  const inner = ARENA_RADIUS + 24;
  const outer = 480;
  const radial = 10;
  const around = 72;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const rgb: Rgb = { r: 0, g: 0, b: 0 };
  const cc = new Color();
  const radii: number[] = [];
  for (let i = 0; i <= radial; i++) radii.push(inner * Math.pow(outer / inner, i / radial));
  const push = (r: number, th: number): void => {
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    groundColour(x, z, 0, 0, rgb);
    cc.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
    pos.push(x, -0.12, z);
    nor.push(0, 1, 0);
    col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < radial; i++) {
    for (let k = 0; k < around; k++) {
      const t0 = (k / around) * Math.PI * 2;
      const t1 = ((k + 1) / around) * Math.PI * 2;
      // counter-clockwise seen from above (+y)
      push(radii[i]!, t0);
      push(radii[i + 1]!, t1);
      push(radii[i + 1]!, t0);
      push(radii[i]!, t0);
      push(radii[i]!, t1);
      push(radii[i + 1]!, t1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}
