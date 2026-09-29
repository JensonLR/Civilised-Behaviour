import { Color } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import type { HeadShape } from "./headShape.ts";
import { skinRamp } from "./headShape.ts";
import { buildShell, smooth } from "./shell.ts";
import { PartBuilder, type V3 } from "./parts.ts";
import { curve } from "./sweep.ts";

/** Shared context for the things that grow out of the face: nose, ears, sideburns, beard, moustache. */
export interface FaceCtx {
  spec: CharacterSpec;
  P: Proportions;
  shape: HeadShape;
  b: PartBuilder;
  /** Head centre height in the bone frame (all builders take centre-relative points and add this). */
  cy: number;
  skin: number;
  hairC: number;
  accent: number;
}

const mix = (a: number, b: number, t: number): number => new Color(a).lerp(new Color(b), t).getHex();

/** A point `off` metres outside the skin where the ray from the front at (x, y) lands, in the bone frame. */
export function onSkin(c: FaceCtx, x: number, y: number, off = 0): V3 {
  const p = c.shape.front(x, y);
  const n = c.shape.normal(p);
  return [p[0] + n[0] * off, p[1] + n[1] * off + c.cy, p[2] + n[2] * off];
}

/** Point on the skin in direction (dx,dy,dz) (need not be unit), `off` metres proud, in the bone frame. */
export function skinDir(c: FaceCtx, dx: number, dy: number, dz: number, off = 0): V3 {
  const l = Math.hypot(dx, dy, dz) || 1;
  const d: V3 = [dx / l, dy / l, dz / l];
  const r = c.shape.radius(d[0], d[1], d[2]);
  const p: V3 = [d[0] * r, d[1] * r, d[2] * r];
  const n = c.shape.normal(p);
  return [p[0] + n[0] * off, p[1] + n[1] * off + c.cy, p[2] + n[2] * off];
}

const lerpAt = (arr: readonly number[], t: number): number => {
  const f = Math.max(0, Math.min(1, t)) * (arr.length - 1);
  const i = Math.min(arr.length - 2, Math.floor(f));
  return arr[i]! + (arr[i + 1]! - arr[i]!) * (f - i);
};

// ---- nose ----------------------------------------------------------------------------------------------------------------

/**
 * A nose is a swept form that rises out of the bridge of the face: narrow at the root, widening to a tip, with two nostrils
 * underneath. The style picks the spine (how it projects and droops) and the widths; `noseLength` (spec) sets the projection.
 */
export function buildNose(c: FaceCtx): void {
  const { spec, P, b, shape } = c;
  const R = P.headRadius;
  const L = Math.max(0.05 * R, Math.min(P.noseLength, 1.5 * R));
  const ramp = skinRamp(c.skin);
  const tipTone = spec.noseStyle === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.65) : ramp.blush.getHex();

  // Spine control points as [y (x R), projection (fraction of L, or metres via `add`)], plus half-widths and depths (x R).
  interface Style {
    y: number[];
    f: number[];
    add?: number[];
    rx: number[];
    rz: number[];
  }
  const styles: Style[] = [
    { y: [0.08, -0.04, -0.2], f: [0, 0.55, 1], add: [-0.02, 0, 0], rx: [0.055, 0.085, 0.115], rz: [0.045, 0.075, 0.105] }, // button
    { y: [0.1, 0.0, -0.14, -0.3, -0.36], f: [0, 0.45, 0.85, 1, 0.8], add: [-0.02, 0, 0, 0, 0], rx: [0.05, 0.06, 0.075, 0.09, 0.075], rz: [0.04, 0.06, 0.075, 0.09, 0.07] }, // hooked
    { y: [0.06, -0.06, -0.22], f: [0, 0.55, 1], add: [-0.02, 0, 0], rx: [0.06, 0.13, 0.21], rz: [0.05, 0.12, 0.2] }, // bulb
    { y: [0.09, -0.02, -0.12, -0.24], f: [0, 0.4, 0.75, 1], add: [-0.02, 0, 0, 0], rx: [0.045, 0.05, 0.055, 0.085], rz: [0.04, 0.05, 0.055, 0.085] }, // long
    { y: [0.02, -0.2], f: [0, 1], add: [-0.02, 0], rx: [0.17, 0.21], rz: [0.035, 0.085] }, // flat
    { y: [0.06, -0.06, -0.24], f: [0, 0.6, 1], add: [-0.02, 0, 0], rx: [0.07, 0.15, 0.22], rz: [0.06, 0.14, 0.21] }, // ruddy lump
  ];
  const st = styles[spec.noseStyle] ?? styles[0]!;
  const len = spec.noseStyle === 4 ? Math.min(L, 0.5 * R) * 0.7 : spec.noseStyle === 0 ? Math.min(L, 0.9 * R) * 0.8 : L;
  const pts: V3[] = st.y.map((yy, i) => {
    const y = yy * R;
    const z = shape.front(0, y)[2] - (st.f[i]! * len + (st.add?.[i] ?? 0) * R);
    return [0, y + c.cy, z];
  });
  const spine = curve(pts, 9);
  const color = spec.noseStyle === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.35) : c.skin;
  const noseSection = (t: number) => ({
    rx: lerpAt(st.rx, t) * R,
    rz: lerpAt(st.rz, t) * R,
    pow: 2.4,
    color: t > 0.75 ? mix(color, tipTone, Math.min(1, (t - 0.75) * 3)) : color,
  });
  b.sweep(spine, noseSection, color, { side: [1, 0, 0], segments: 9, round: "end" });

  // Nostrils: two dark oval openings flush with the underside of the tip (a tiny tube sunk into the nose whose mouth lies on the surface),
  // so they read as holes in the nose rather than beads stuck beside it.
  const last = spine.length - 1;
  const iN = Math.max(1, Math.round(last * 0.9));
  const at = spine[iN]!;
  const prev = spine[iN - 1]!;
  const tan: V3 = norm3([at[0] - prev[0], at[1] - prev[1], at[2] - prev[2]]);
  // "Down" for the tip: world down projected off the tangent; a nose pointing straight down faces its nostrils forward (-Z).
  let under = norm3([0, -1, -0.25]);
  const dot = under[0] * tan[0] + under[1] * tan[1] + under[2] * tan[2];
  under = norm3([under[0] - tan[0] * dot, under[1] - tan[1] * dot, under[2] - tan[2] * dot]);
  if (Math.hypot(under[0], under[1], under[2]) < 0.2) under = [0, 0, -1];
  const secN = noseSection(iN / last);
  const depth = Math.max(secN.rx, secN.rz);
  const surfaceOff = secN.rz; // distance from the spine to the surface along `under` (the section's depth axis is the one facing down)
  const holeC = mix(c.skin, PALETTE.face.nostril, 0.85);
  for (const sx of [-1, 1]) {
    const cx = sx * secN.rx * 0.5;
    const start: V3 = [at[0] + cx + under[0] * (surfaceOff + R * 0.004), at[1] + under[1] * (surfaceOff + R * 0.004), at[2] + under[2] * (surfaceOff + R * 0.004)];
    const end: V3 = [start[0] - under[0] * depth * 0.9, start[1] - under[1] * depth * 0.9, start[2] - under[2] * depth * 0.9];
    b.sweep([start, end], () => ({ rx: Math.min(secN.rx * 0.42, R * 0.045), rz: Math.min(secN.rx * 0.3, R * 0.03), pow: 2 }), holeC, { side: [1, 0, 0], segments: 7 });
  }
  // alar wings: the nostril flare, only on the wider styles
  const tip = pts[pts.length - 1]!;
  const wide = lerpAt(st.rx, 1) * R;
  if (spec.noseStyle === 2 || spec.noseStyle === 5 || spec.noseStyle === 4) {
    for (const sx of [-1, 1]) b.sphere(R * 0.07, color, [sx * wide * 0.8, tip[1] + R * 0.03, tip[2] + len * 0.04 + R * 0.07], [1, 0.9, 0.9]);
  }
}

const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// ---- ears --------------------------------------------------------------------------------------------------------------------

/** A cupped ear: a thick root into the head, a broad rim, and a darker inner bowl. Sized by the spec's ear slider. */
export function buildEars(c: FaceCtx): void {
  const { P, b, shape } = c;
  const es = P.earSize * 0.72; // the slider's range is generous; the sculpt wants ears that belong to the head
  const ramp = skinRamp(c.skin);
  const rim = ramp.skin.getHex();
  const bowl = mix(c.skin, PALETTE.trim.blushHot, 0.3);
  for (const sx of [-1, 1]) {
    const r = shape.radius(sx, 0.02, 0.06);
    const root: V3 = [sx * (r * 0.93), c.cy + P.headRadius * 0.02, P.headRadius * 0.05];
    // Stack along the outward X axis, then tilt so the ear's front edge stays close to the head and its rim flares out and back.
    const rot: V3 = [0.14, sx * 0.55, -sx * (Math.PI / 2)];
    b.loft(
      [
        { y: -0.1 * es, rx: 1.15 * es, rz: 0.8 * es, color: mix(rim, 0x000000, 0.08) },
        { y: 0.25 * es, rx: 1.6 * es, rz: 1.0 * es, pow: 2.4, color: rim },
        { y: 0.6 * es, rx: 1.65 * es, rz: 1.05 * es, pow: 2.6, color: mix(rim, 0xffffff, 0.04) },
        { y: 0.82 * es, rx: 1.4 * es, rz: 0.85 * es, pow: 2.4, color: rim },
      ],
      rim,
      root,
      rot,
    );
    // inner bowl (front-facing concavity read as a darker, pinker patch)
    b.loft(
      [
        { y: 0.7 * es, rx: 1.0 * es, rz: 0.6 * es, color: bowl },
        { y: 0.9 * es, rx: 0.9 * es, rz: 0.55 * es, color: bowl },
      ],
      bowl,
      [root[0] + sx * 0.01 * es, root[1], root[2] + es * 0.05],
      rot,
    );
  }
}

// ---- moustaches ------------------------------------------------------------------------------------------------------------------

/** A tapered, swept moustache piece along control points given as [x, y] (x R, y R, centre-relative) on the lip line. */
function stache(c: FaceCtx, pts: readonly (readonly [number, number])[], widths: readonly number[], lift = 0.05, thick = 0.5, samples = 7): void {
  const { P, b } = c;
  const R = P.headRadius;
  const spine = curve(
    pts.map(([x, y]) => onSkin(c, x * R, y * R, R * lift * (0.6 + thick))),
    8,
  );
  b.sweep(
    spine,
    (t) => ({ rx: lerpAt(widths, t) * R * 0.55, rz: lerpAt(widths, t) * R * thick, pow: 2.2 }),
    c.hairC,
    { side: [0, 1, 0], segments: 5, round: "end" },
  );
}

export function buildMoustache(c: FaceCtx): void {
  const { spec, P, b } = c;
  const R = P.headRadius;
  const my = -0.34;
  // Right half is built and mirrored: the sweep helper takes points, so we simply emit both sides.
  const sides: (1 | -1)[] = [-1, 1];
  switch (spec.moustache) {
    case 1: // handlebar: a bar that sweeps out and curls up
      for (const s of sides) {
        stache(c, [[s * 0.02, my], [s * 0.2, my - 0.02], [s * 0.42, my - 0.06], [s * 0.6, my + 0.02], [s * 0.66, my + 0.14], [s * 0.58, my + 0.2]], [0.13, 0.14, 0.11, 0.07, 0.05, 0.03], 0.07, 0.55);
      }
      break;
    case 2: // walrus: a thick drooping curtain
      for (const s of sides) stache(c, [[s * 0.02, my + 0.02], [s * 0.22, my - 0.03], [s * 0.38, my - 0.14], [s * 0.42, my - 0.28]], [0.2, 0.22, 0.17, 0.08], 0.09, 0.6);
      break;
    case 3: // pencil
      for (const s of sides) stache(c, [[s * 0.01, my + 0.02], [s * 0.3, my + 0.01]], [0.05, 0.03], 0.04, 0.5);
      break;
    case 4: // toothbrush
      for (const s of sides) stache(c, [[s * 0.01, my + 0.02], [s * 0.13, my + 0.02]], [0.13, 0.12], 0.05, 0.55);
      break;
    case 5: // imperial: neat bar with long upswept points
      for (const s of sides) stache(c, [[s * 0.02, my + 0.02], [s * 0.22, my], [s * 0.42, my + 0.06], [s * 0.6, my + 0.2], [s * 0.66, my + 0.36]], [0.11, 0.11, 0.08, 0.05, 0.02], 0.06, 0.5);
      break;
    case 6: // horseshoe: bar with legs down the chin
      for (const s of sides) stache(c, [[s * 0.02, my + 0.02], [s * 0.28, my + 0.02], [s * 0.34, my - 0.12], [s * 0.34, my - 0.34]], [0.08, 0.08, 0.08, 0.05], 0.05, 0.5);
      break;
    case 7: // magnificent fringe: a row of short hanging tufts
      for (let i = -3; i <= 3; i++) stache(c, [[i * 0.1, my + 0.04], [i * 0.1 + Math.sign(i) * 0.015, my - 0.08 - Math.abs(i) * 0.005]], [0.07, 0.03], 0.06, 0.6, 3);
      break;
    case 8: // waxed tips: slim bar, needle points
      for (const s of sides) stache(c, [[s * 0.02, my + 0.02], [s * 0.2, my + 0.02], [s * 0.42, my + 0.1], [s * 0.6, my + 0.26], [s * 0.66, my + 0.44]], [0.07, 0.07, 0.05, 0.03, 0.008], 0.06, 0.5);
      break;
    case 9: // soup strainer: enormous, drooping over mouth and chin
      for (const s of sides) stache(c, [[s * 0.02, my + 0.03], [s * 0.2, my - 0.02], [s * 0.34, my - 0.18], [s * 0.38, my - 0.4], [s * 0.34, my - 0.56]], [0.24, 0.27, 0.2, 0.13, 0.04], 0.1, 0.6);
      break;
    default:
      break;
  }
  void P;
  void R;
  void b;
}

// ---- beards & sideburns ------------------------------------------------------------------------------------------------------------

/** A beard lobe: a tapered form hanging from the chin/jaw. `pts` are [x, y, projection] (x R). */
function lobe(c: FaceCtx, pts: readonly (readonly [number, number, number])[], widths: readonly number[], depths: readonly number[]): void {
  const { P, b } = c;
  const R = P.headRadius;
  const spine = curve(
    pts.map(([x, y, f]) => {
      const p = onSkin(c, x * R, y * R, 0);
      return [p[0], p[1], p[2] - f * R] as V3;
    }),
    7,
  );
  b.sweep(spine, (t) => ({ rx: lerpAt(widths, t) * R, rz: lerpAt(depths, t) * R, pow: 2.3 }), c.hairC, { side: [1, 0, 0], segments: 6, round: "end" });
}

export function buildBeard(c: FaceCtx): void {
  const { spec, P, b } = c;
  const R = P.headRadius;
  switch (spec.beard) {
    case 1: // full beard: a shell over cheeks and jaw with a window left for the mouth
      jawBeard(c, true, true);
      break;
    case 2: // chin puff
      lobe(c, [[0, -0.74, 0.03], [0, -0.92, 0.14], [0, -1.02, 0.14]], [0.22, 0.28, 0.2], [0.1, 0.17, 0.15]);
      break;
    case 3: // goatee: a pointed tuft
      lobe(c, [[0, -0.68, 0.03], [0, -0.92, 0.12], [0, -1.3, 0.13]], [0.2, 0.19, 0.02], [0.09, 0.13, 0.03]);
      break;
    case 4: // mutton beard: cheek whiskers and a chin tuft, mouth left open
      jawBeard(c, true, false);
      lobe(c, [[0, -0.74, 0.03], [0, -0.96, 0.13], [0, -1.05, 0.13]], [0.2, 0.22, 0.14], [0.1, 0.14, 0.12]);
      break;
    case 5: // spade: broad at the mouth, pointed at the bottom
      lobe(c, [[0, -0.62, 0.02], [0, -0.88, 0.16], [0, -1.26, 0.16]], [0.4, 0.3, 0.02], [0.09, 0.15, 0.04]);
      break;
    case 6: // wizard: a long flowing mass
      lobe(c, [[0, -0.62, 0.03], [0, -0.95, 0.2], [0, -1.6, 0.26], [0, -2.5, 0.22], [0, -2.95, 0.15]], [0.5, 0.52, 0.42, 0.24, 0.02], [0.1, 0.17, 0.2, 0.15, 0.04]);
      for (const s of [-1, 1]) lobe(c, [[s * 0.58, -0.05, 0.02], [s * 0.6, -0.5, 0.08], [s * 0.4, -0.9, 0.16]], [0.12, 0.2, 0.22], [0.06, 0.1, 0.14]);
      break;
    case 7: { // neck fringe: a chinstrap along the jaw line
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 6; i++) {
        const a = -1 + (2 * i) / 6;
        pts.push([a * 0.62, -0.72 - (1 - a * a) * 0.2, 0.02 + (1 - a * a) * 0.05]);
      }
      lobe(c, pts, [0.11, 0.13, 0.14, 0.14, 0.14, 0.13, 0.11], [0.06, 0.08, 0.09, 0.09, 0.09, 0.08, 0.06]);
      break;
    }
    default:
      break;
  }
  void b;
  void P;
}

export function buildSideburns(c: FaceCtx): void {
  const { spec, P, shape, b, cy } = c;
  void P;
  // [how far down the face they run, how far forward they start, flare toward the jaw]
  const style = [null, { bottom: -0.16, lo: 1.28, flare: 0 }, { bottom: -0.5, lo: 1.15, flare: 0.5 }, { bottom: -0.68, lo: 1.05, flare: 1.0 }][spec.sideburns];
  if (!style) return;
  const g = buildShell(shape, {
    color: c.hairC,
    coarse: PartBuilder.hullMode,
    mask: (d) => {
      const lo = style.lo - style.flare * 0.35 * smooth(0.2, style.bottom, d.y) * 0 - style.flare * 0.3 * smooth(0.1, style.bottom, d.y);
      const across = smooth(lo - 0.05, lo + 0.05, d.az) * (1 - smooth(1.5, 1.6, d.az));
      const along = smooth(style.bottom - 0.05, style.bottom + 0.06, d.y) * (1 - smooth(0.2, 0.3, d.y));
      return across * along;
    },
    thick: (d) => 0.055 + 0.03 * smooth(0.1, style.bottom, d.y),
  });
  if (g) b.add(g, c.hairC, [0, cy, 0]);
}

/**
 * A shell-based beard over the jaw. Its upper edge runs from the sideburn at the ear diagonally down to just under the lower lip (never up
 * over the cheekbone, never across the mouth or the moustache's ground), so it frames the face instead of masking it.
 */
function jawBeard(c: FaceCtx, cheeks: boolean, chin: boolean): void {
  const { shape, b, cy } = c;
  // y of the beard's upper edge by azimuth: under the lip at the front, up to the sideburn near the ear.
  const top = (az: number): number => -0.66 + (-0.16 + 0.66) * smooth(0.25, 1.15, az);
  const g = buildShell(shape, {
    color: c.hairC,
    coarse: PartBuilder.hullMode,
    mask: (d) => {
      const edge = 1 - smooth(top(d.az) - 0.04, top(d.az) + 0.04, d.y); // 1 below the edge
      const side = smooth(0.35, 0.6, d.az); // 0 at the front, 1 at the cheeks
      const region = chin ? (cheeks ? 1 : 1 - side) : cheeks ? side : 0;
      return edge * region * (1 - smooth(1.45, 1.6, d.az)) * (d.z < 0.55 ? 1 : 0);
    },
    thick: (d) => 0.09 + 0.14 * smooth(-0.45, -0.95, d.y),
    lift: (d) => {
      const w = Math.exp(-(((d.x / 0.4) ** 2) + (((d.y + 0.92) / 0.22) ** 2)));
      return [0, -0.22 * w, -0.06 * w];
    },
  });
  if (g) b.add(g, c.hairC, [0, cy, 0]);
}

