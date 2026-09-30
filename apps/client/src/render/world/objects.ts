import { BoxGeometry, Color, CylinderGeometry, LatheGeometry, TorusGeometry, Vector2, type BufferGeometry } from "three";
import { PALETTE, PROP_DEFS, PropKind, type PropKindId } from "@cb/shared";
import { Kit, blend, type ColourFn, type V3 } from "./kit.ts";
import type { Lod } from "./flora.ts";

/**
 * Hand-made objects: server-owned props (crate, barrel, bottle, chair) and the crate that also stands in the camp. Each builder
 * draws around the local origin (the physics body's centre) and stays inside the physics half-extents (PROP_DEFS) to within ~5%,
 * so what you see is what collides. Small details (nails, glints) are skipped in the hull LOD, like the characters' hulls.
 */

const P = PALETTE.props;
const M = PALETTE.material;

const box = (k: Kit, s: V3, at: V3, colour: number | ColourFn, rot?: V3): void => {
  k.add(new BoxGeometry(s[0], s[1], s[2]), { at, rot, colour, flat: true });
};

/** A packing crate: slatted faces with a diagonal brace, corner posts, top and bottom rails, and nail heads. Centred on the origin. */
export function crateParts(k: Kit, w: number, h: number, d: number, lod: Lod, tone = 1): void {
  const post = 0.07 * Math.min(1, w / 0.8);
  const t = 0.012; // planks stand this proud of the body
  const plank: ColourFn = (p, _n, out) => blend(out, P.crate, P.crateDark, ((Math.floor(p.y * 40) % 3) + 3) % 3 === 0 ? 0.35 : 0);
  const dark = P.crateDark;
  box(k, [w - 0.02, h - 0.02, d - 0.02], [0, 0, 0], dark);
  // Posts and rails frame each face.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k, [post, h, post], [sx * (w / 2 - post / 2), 0, sz * (d / 2 - post / 2)], P.crate);
  for (const sy of [-1, 1]) {
    const y = sy * (h / 2 - post * 0.4);
    box(k, [w, post * 0.8, post * 0.9], [0, y, d / 2 - post * 0.45], P.crate);
    box(k, [w, post * 0.8, post * 0.9], [0, y, -d / 2 + post * 0.45], P.crate);
    box(k, [post * 0.9, post * 0.8, d], [w / 2 - post * 0.45, y, 0], P.crate);
    box(k, [post * 0.9, post * 0.8, d], [-w / 2 + post * 0.45, y, 0], P.crate);
  }
  // Slats on the four sides, three per face, each a shade apart.
  const slat = (fw: number, fh: number, z: number, axisX: boolean): void => {
    const n = 3;
    const sh = (fh - post * 1.8) / n;
    for (let i = 0; i < n; i++) {
      const y = -fh / 2 + post * 0.9 + sh * (i + 0.5);
      const shade = i % 2 ? 1.0 : 0.9;
      const c: ColourFn = (p, nn, out) => {
        plank(p, nn, out);
        out.multiplyScalar(shade * tone);
      };
      if (axisX) box(k, [fw - post * 2, sh - 0.012, t], [0, y, z], c);
      else box(k, [t, sh - 0.012, fw - post * 2], [z, y, 0], c);
    }
  };
  slat(w, h, d / 2 - t / 2 - 0.004, true);
  slat(w, h, -d / 2 + t / 2 + 0.004, true);
  slat(d, h, w / 2 - t / 2 - 0.004, false);
  slat(d, h, -w / 2 + t / 2 + 0.004, false);
  // Brace across the front and back, and nails at the corners of the brace.
  const bl = Math.hypot(w - post * 2.4, h - post * 1.8);
  const ang = Math.atan2(h - post * 1.8, w - post * 2.4);
  for (const sz of [-1, 1]) {
    box(k, [bl, post * 0.55, t * 1.4], [0, 0, sz * (d / 2 - t * 0.5)], P.crateDark, [0, 0, sz > 0 ? ang : -ang]);
    if (lod) for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(k, [0.022, 0.022, t * 2.2], [sx * (w / 2 - post * 0.5), sy * (h / 2 - post * 0.5), sz * (d / 2 - t * 0.6)], M.iron);
  }
}

/**
 * A lighter packing crate for the places crates come in dozens (the HQ's supply pyramid, the market): corner posts, two slatted bands and a diagonal
 * brace on each long face; about a third of `crateParts`' triangles.
 */
export function crateSlim(k: Kit, w: number, h: number, d: number, tone = 1): void {
  const post = 0.07 * Math.min(1, w / 0.8);
  box(k, [w - 0.02, h - 0.02, d - 0.02], [0, 0, 0], (p, n, out) => blend(out, P.crate, P.crateDark, (((Math.floor(p.y * 9) % 2) + 2) % 2) * 0.35 + (n.y > 0.5 ? 0 : 0.1)).multiplyScalar(tone));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k, [post, h + 0.01, post], [sx * (w / 2 - post / 2), 0, sz * (d / 2 - post / 2)], P.crate);
  for (const sz of [-1, 1]) {
    box(k, [w - post * 2, post * 0.7, 0.02], [0, h / 2 - post * 0.5, sz * (d / 2)], P.crate);
    box(k, [w - post * 2, post * 0.7, 0.02], [0, -h / 2 + post * 0.5, sz * (d / 2)], P.crate);
    const bl = Math.hypot(w - post * 2.4, h - post * 1.8);
    box(k, [bl, post * 0.5, 0.025], [0, 0, sz * (d / 2)], P.crateDark, [0, 0, (sz > 0 ? 1 : -1) * Math.atan2(h - post * 1.8, w - post * 2.4)]);
  }
}

export function crateGeometry(lod: Lod): BufferGeometry {
  const h = PROP_DEFS[PropKind.CRATE].half;
  const k = new Kit();
  crateParts(k, h[0] * 2, h[1] * 2, h[2] * 2, lod);
  return k.build()!;
}

/** A cooper's barrel: 12 faceted staves bulging in the middle, four iron hoops, a lid with a bung. */
export function barrelGeometry(lod: Lod): BufferGeometry {
  const [r, hh] = PROP_DEFS[PropKind.BARREL].half;
  const k = new Kit();
  const prof: Vector2[] = [];
  const y = [-1, -0.7, -0.3, 0, 0.3, 0.7, 1];
  const rr = [0.85, 0.94, 0.99, 1, 0.99, 0.94, 0.85];
  for (let i = 0; i < y.length; i++) prof.push(new Vector2(rr[i]! * r * 0.98, y[i]! * hh));
  const stave: ColourFn = (p, _n, out) => {
    const s = Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 12);
    blend(out, P.barrel, P.barrelDark, s % 2 ? 0.55 : s % 3 === 0 ? 0.2 : 0);
  };
  k.add(new LatheGeometry(prof, lod ? 12 : 8), { colour: stave, flat: true });
  for (const [yy, rad] of [
    [-0.82, 0.9],
    [-0.36, 1.0],
    [0.36, 1.0],
    [0.82, 0.9],
  ] as const) {
    k.add(new CylinderGeometry(r * rad * 1.02, r * rad * 1.02, 0.05, lod ? 14 : 8, 1, true), { at: [0, yy * hh, 0], colour: M.iron });
  }
  k.add(new CylinderGeometry(r * 0.84, r * 0.84, 0.02, lod ? 12 : 8), { at: [0, hh - 0.005, 0], colour: P.barrelDark, flat: true });
  if (lod) k.add(new CylinderGeometry(0.035, 0.035, 0.03, 6), { at: [r * 0.3, hh + 0.004, 0], colour: M.soot });
  return k.build()!;
}

/** A glass bottle: body, shoulder, neck, lip, cork and a paper label, with a pale glint stripe painted down one side. */
export function bottleGeometry(lod: Lod): BufferGeometry {
  const [r, hh] = PROP_DEFS[PropKind.BOTTLE].half;
  const top = hh + r; // capsule total half-length
  const k = new Kit();
  const s = r / 0.05;
  const pts: [number, number][] = [
    [0, -0.15],
    [0.04, -0.15],
    [0.05, -0.13],
    [0.05, -0.01],
    [0.046, 0.03],
    [0.032, 0.062],
    [0.02, 0.084],
    [0.018, 0.122],
    [0.024, 0.13],
    [0.024, 0.14],
    [0, 0.14],
  ];
  const glass: ColourFn = (p, _n, out) => {
    const a = Math.atan2(p.z, p.x);
    blend(out, P.bottle, P.bottleDark, (1 - Math.cos(a - 2.2)) * 0.28);
    if (Math.abs(a - 0.9) < 0.16 && p.y > -0.12 && p.y < 0.07) out.lerp(cGlint(), 0.55);
  };
  k.add(new LatheGeometry(pts.map(([x, y]) => new Vector2(x * s, y * (top / 0.15))), lod ? 10 : 7), { colour: glass });
  k.add(new CylinderGeometry(0.0505 * s, 0.0505 * s, 0.075, lod ? 10 : 7, 1, true), { at: [0, -0.06, 0], colour: M.cream });
  k.add(new CylinderGeometry(0.017, 0.015, 0.016, 6), { at: [0, top - 0.008, 0], colour: P.cork });
  return k.build()!;
}

let glint: Color | undefined;
const cGlint = (): Color => (glint ??= new Color(P.bottleGlint));

/** A bentwood café chair: caned round seat, four splayed legs with a stretcher ring, and a hooped back. */
export function chairGeometry(lod: Lod): BufferGeometry {
  const [hx, hy] = PROP_DEFS[PropKind.CHAIR].half;
  const k = new Kit();
  const rad = lod ? 6 : 5;
  const wood: ColourFn = (p, _n, out) => blend(out, P.chair, P.chairDark, 0.25 + 0.25 * Math.sin(p.y * 9));
  const seatY = -hy + 0.45;
  const sr = hx * 0.92;
  k.add(new CylinderGeometry(sr, sr * 0.96, 0.035, lod ? 14 : 8), { at: [0, seatY - 0.02, 0], colour: P.chairCane, flat: true });
  k.add(new TorusGeometry(sr, 0.02, 4, lod ? 16 : 10), { at: [0, seatY - 0.04, 0], rot: [Math.PI / 2, 0, 0], colour: P.chairDark });
  const lx = hx * 0.66;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top: V3 = [sx * lx * 0.8, seatY - 0.04, sz * lx * 0.8];
      const bot: V3 = [sx * hx * 0.94, -hy, sz * hx * 0.94];
      if (sz < 0) {
        // rear legs run on up to hold the back
        k.limb(bot, top, 0.017, 0.022, wood, rad);
        k.limb([top[0], top[1], top[2]], [sx * hx * 0.62, hy - 0.06, sz * hx * 0.88], 0.022, 0.017, wood, rad);
      } else k.limb(bot, top, 0.016, 0.022, wood, rad);
    }
  }
  // stretcher ring low on the legs
  k.add(new TorusGeometry(hx * 0.78, 0.014, 4, lod ? 14 : 9), { at: [0, -hy + 0.16, 0], rot: [Math.PI / 2, 0, 0], colour: wood });
  // hooped back: an arc of torus between the rear posts, plus a lower rail
  k.add(new TorusGeometry(hx * 0.6, 0.02, 4, lod ? 10 : 6, Math.PI), { at: [0, hy - 0.14, -hx * 0.86], rot: [0, 0, 0], colour: wood });
  k.limb([-hx * 0.62, hy - 0.3, -hx * 0.88], [hx * 0.62, hy - 0.3, -hx * 0.88], 0.017, 0.017, wood, rad);
  return k.build()!;
}

/** One geometry pair (visible, hull) per prop kind. */
export function propGeometry(kind: PropKindId, lod: Lod): BufferGeometry {
  switch (kind) {
    case PropKind.BARREL:
      return barrelGeometry(lod);
    case PropKind.BOTTLE:
      return bottleGeometry(lod);
    case PropKind.CHAIR:
      return chairGeometry(lod);
    default:
      return crateGeometry(lod);
  }
}
