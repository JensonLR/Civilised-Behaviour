import { BufferAttribute, BufferGeometry, Color } from "three";

/**
 * One cross-section of a lofted form. Sections are stacked along +Y; each is a superellipse in the XZ plane
 * (rx/rz half-axes, centre offset cx/cz) so a form can be round (pow 2), squarish (pow 3-5) or anything between.
 * The front of the character is -Z, so section angle 0 points at the viewer.
 */
export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
  /** Superellipse exponent: 2 = ellipse, higher = squarer. Default 2.4 (a soft, slightly squared body section). */
  pow?: number;
  /** Colour of this section (interpolated to its neighbours); falls back to the loft's colour. */
  color?: number;
  /**
   * Start a new smooth surface here: the previous span ends in a hard edge (cuffs, hems, collars). Implemented by
   * duplicating the section so normals do not blend across it.
   */
  crease?: boolean;
}

export interface LoftOptions {
  /** Default section colour. */
  color: number;
  /** Segments around the section. Default 10 (6 when the outline hull is being built). */
  segments?: number;
  /** Close the ends with fans. Default true. */
  capBottom?: boolean;
  capTop?: boolean;
  /** Faces point INTO the form (a lining, the inside of a hem): the winding is reversed, so it is seen from inside and culled from outside. */
  inward?: boolean;
}

const c = new Color();

/**
 * A smooth, closed tube through the given sections, as an indexed geometry with position, normal, uv (unused, but
 * kept so it merges with the stock three primitives) and per-vertex `color`.
 */
export function loftGeometry(rings: readonly Ring[], opts: LoftOptions): BufferGeometry {
  const seg = Math.max(4, opts.segments ?? 10);
  // Sections may be listed top-down (limbs hang from their joint): the winding follows the stacking direction so faces always point outward.
  const down = (rings.length > 1 && rings[0]!.y > rings[rings.length - 1]!.y) !== (opts.inward === true);
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  // Expand creases into duplicate sections so each smooth run owns its own vertices.
  const secs: Ring[] = [];
  const breaks = new Set<number>();
  rings.forEach((r, i) => {
    if (r.crease && i > 0 && i < rings.length - 1) {
      secs.push(r);
      breaks.add(secs.length); // the next copy starts a new run
      secs.push(r);
    } else secs.push(r);
  });

  const ringVertex = (r: Ring, k: number, out: number[]): void => {
    const th = (k / seg) * Math.PI * 2;
    const s = Math.sin(th);
    const co = Math.cos(th);
    const e = 2 / (r.pow ?? 2.4);
    out.push((r.cx ?? 0) + r.rx * Math.sign(s) * Math.abs(s) ** e, r.y, (r.cz ?? 0) - r.rz * Math.sign(co) * Math.abs(co) ** e);
  };

  for (let i = 0; i < secs.length; i++) {
    const r = secs[i]!;
    c.setHex(r.color ?? opts.color);
    for (let k = 0; k < seg; k++) {
      ringVertex(r, k, pos);
      col.push(c.r, c.g, c.b);
    }
  }
  // Quads between consecutive sections, except across a crease break.
  for (let i = 0; i < secs.length - 1; i++) {
    if (breaks.has(i + 1)) continue;
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      const a2 = a + seg;
      const b2 = b + seg;
      if (down) index.push(a, b, a2, b, b2, a2);
      else index.push(a, a2, b, b, a2, b2);
    }
  }
  // End caps: a fan around a centre vertex, so they shade like the tube's own end.
  const cap = (secIndex: number, up: boolean): void => {
    const r = secs[secIndex]!;
    const centre = pos.length / 3;
    pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
    c.setHex(r.color ?? opts.color);
    col.push(c.r, c.g, c.b);
    // Cap vertices are separate copies so the cap has its own flat normal.
    const base = pos.length / 3;
    for (let k = 0; k < seg; k++) {
      ringVertex(r, k, pos);
      col.push(c.r, c.g, c.b);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k;
      const b = base + ((k + 1) % seg);
      if (up !== down) index.push(centre, b, a);
      else index.push(centre, a, b);
    }
  };
  if (opts.capBottom !== false) cap(0, false);
  if (opts.capTop !== false) cap(secs.length - 1, true);

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  if (opts.inward) geo.userData.inward = true;
  return geo;
}
