import { Color } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import type { HeadShape } from "./headShape.ts";
import { gridLevel, skinRamp } from "./headShape.ts";
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
  /** Scalp hair colour. */
  hairC: number;
  /** Colour of moustache, beard and sideburns (the scalp colour turned toward grey by the spec's greying). */
  facialC: number;
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
  const tipTone = spec.facePaint === 1 ? PALETTE.trim.zinc : spec.noseStyle === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.65) : ramp.blush.getHex();

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
    { y: [0.07, -0.03, -0.13, -0.2], f: [0, 0.5, 0.85, 1], add: [-0.02, 0, 0, 0.01], rx: [0.05, 0.075, 0.095, 0.105], rz: [0.045, 0.07, 0.09, 0.095] }, // snub: short and turned up at the tip
    { y: [0.13, 0.03, -0.1, -0.24], f: [0, 0.62, 0.92, 1], add: [-0.02, 0.035, 0, 0], rx: [0.05, 0.05, 0.062, 0.09], rz: [0.045, 0.062, 0.075, 0.085] }, // roman: a high bridge with a bump, then straight and strong
  ];
  const st = styles[spec.noseStyle] ?? styles[0]!;
  const len = spec.noseStyle === 4 ? Math.min(L, 0.5 * R) * 0.7 : spec.noseStyle === 0 ? Math.min(L, 0.9 * R) * 0.8 : spec.noseStyle === 6 ? Math.min(L, 0.62 * R) * 0.8 : L;
  const pts: V3[] = st.y.map((yy, i) => {
    const y = yy * R;
    const z = shape.front(0, y)[2] - (st.f[i]! * len + (st.add?.[i] ?? 0) * R);
    return [0, y + c.cy, z];
  });
  const spine = curve(pts, 9);
  const color = spec.facePaint === 1 ? PALETTE.trim.zinc : spec.facePaint === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.45) : spec.noseStyle === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.35) : c.skin;
  // Paint on a nose is thickest on the tip and thins toward the bridge (a stick of zinc dragged down the nose), so the paint never reads as a white nose stuck on a face.
  const painted = spec.facePaint === 1;
  const noseSection = (t: number) => ({
    rx: lerpAt(st.rx, t) * R,
    rz: lerpAt(st.rz, t) * R,
    pow: 2.4,
    color: painted ? mix(c.skin, PALETTE.trim.zinc, 0.55 + 0.45 * smooth(0.05, 0.45, t)) : t > 0.75 ? mix(color, tipTone, Math.min(1, (t - 0.75) * 3)) : color,
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

/** Where an ear hangs (head-centre frame) and how big it is: enough for earrings and hats to find the lobe. */
export function earFrame(c: FaceCtx, sx: number): { root: V3; lobe: V3; size: number } {
  const { P, shape } = c;
  const kind = c.spec.earShape;
  const es = P.earSize * 0.72 * (kind === 3 ? 1.32 : 1);
  const r = shape.radius(sx, 0.02, 0.06);
  const push = kind === 3 ? 1.06 : 1;
  const root: V3 = [sx * (r * 0.93 * push), c.cy + P.headRadius * 0.02, P.headRadius * 0.05];
  const drop = kind === 4 ? 2.0 : 1.45;
  return { root, lobe: [root[0] + sx * es * (kind === 3 ? 0.9 : 0.5), root[1] - es * drop, root[2] + es * 0.05], size: es };
}

/**
 * A cupped ear: a thick root into the head, a broad rim and a darker inner bowl. Sized by the ear slider; `earShape` reshapes it: pointed
 * (a tip rising above the rim), cauliflower (a lumpy, thickened rim), jug (big and flared away from the skull) and long lobes.
 */
export function buildEars(c: FaceCtx): void {
  const { b } = c;
  const kind = c.spec.earShape;
  const ramp = skinRamp(c.skin);
  const rim = ramp.skin.getHex();
  const bowl = mix(c.skin, PALETTE.trim.blushHot, 0.3);
  for (const sx of [-1, 1]) {
    const { root, size: es } = earFrame(c, sx);
    // Stack along the outward X axis, then tilt so the ear's front edge stays close to the head and its rim flares out and back.
    const rot: V3 = [kind === 3 ? 0.22 : 0.14, sx * (kind === 3 ? 0.95 : kind === 1 ? 0.7 : 0.55), -sx * (Math.PI / 2)];
    const tall = kind === 1 ? 1.5 : kind === 4 ? 1.05 : 1;
    const thick = kind === 2 ? 1.35 : 1;
    b.loft(
      [
        { y: -0.1 * es, rx: 1.15 * es * tall, rz: 0.8 * es * thick, color: mix(rim, 0x000000, 0.08) },
        { y: 0.25 * es, rx: 1.6 * es * tall, rz: 1.0 * es * thick, pow: kind === 1 ? 2.0 : 2.4, color: rim },
        { y: 0.6 * es, rx: (kind === 1 ? 1.35 : 1.65) * es * tall, rz: 1.05 * es * thick, pow: kind === 1 ? 1.8 : 2.6, color: mix(rim, 0xffffff, 0.04) },
        { y: 0.82 * es, rx: (kind === 1 ? 0.7 : 1.4) * es * tall, rz: 0.85 * es * thick, pow: kind === 1 ? 1.6 : 2.4, color: rim },
      ],
      rim,
      root,
      rot,
    );
    // inner bowl (front-facing concavity read as a darker, pinker patch)
    b.loft(
      [
        { y: 0.7 * es, rx: 1.0 * es * (kind === 1 ? 1.2 : 1), rz: 0.6 * es, color: bowl },
        { y: 0.9 * es, rx: 0.9 * es * (kind === 1 ? 1.2 : 1), rz: 0.55 * es, color: bowl },
      ],
      bowl,
      [root[0] + sx * 0.01 * es, root[1], root[2] + es * 0.05],
      rot,
    );
    if (kind === 1) {
      // the pointed tip rising above the rim
      b.cone(es * 0.42, es * 1.1, rim, [root[0] + sx * es * 0.5, root[1] + es * 1.9, root[2] + es * 0.15], [0.1, 0, sx * -0.25]);
    }
    if (kind === 2) {
      // cauliflower: thick lumps of gristle round the rim
      const lumps: [number, number, number][] = [[0.6, 1.2, 0.2], [0.85, 0.5, 0.5], [0.85, -0.3, 0.55], [0.5, -0.95, 0.35], [0.7, 0.95, -0.3]];
      for (const [dx, dy, dz] of lumps) b.sphere(es * 0.5, tone(rim, 0.94 + 0.08 * dz), [root[0] + sx * dx * es, root[1] + dy * es, root[2] + dz * es * 0.6], [1, 1, 0.85]);
    }
    if (kind === 4) {
      // long lobes: a soft drop hanging below the rim
      b.loft(
        [
          { y: 0, rx: 0.34 * es, rz: 0.26 * es, color: tone(rim, 0.96) },
          { y: 0.3 * es, rx: 0.5 * es, rz: 0.36 * es, color: rim },
          { y: 0.75 * es, rx: 0.66 * es, rz: 0.45 * es, color: rim },
        ],
        rim,
        [root[0] + sx * es * 0.08, root[1] - es * 2.1, root[2] + es * 0.04],
        [0, 0, 0],
      );
    }
  }
}

const tone = (color: number, k: number): number => new Color(color).multiplyScalar(k).getHex();

/** Earrings (spec.earring): a gold hoop, a stud, a pearl drop, or a pair of hoops, hanging from the lobe. */
export function buildEarrings(c: FaceCtx): void {
  const { spec, b, P } = c;
  if (spec.earring === 0) return;
  const R = P.headRadius;
  const gold = c.accent;
  const sides: number[] = spec.earring === 4 ? [-1, 1] : [-1];
  for (const sx of sides) {
    const { lobe } = earFrame(c, sx);
    const out = sx * R * 0.045;
    if (spec.earring === 1 || spec.earring === 4) b.torus(R * 0.075, R * 0.014, gold, [lobe[0] + out, lobe[1] - R * 0.07, lobe[2] + R * 0.005], [0, 0, 0]);
    else if (spec.earring === 2) b.sphere(R * 0.035, gold, [lobe[0] + out, lobe[1] - R * 0.01, lobe[2] + R * 0.01]);
    else if (spec.earring === 3) {
      b.sphere(R * 0.026, gold, [lobe[0] + out, lobe[1] - R * 0.01, lobe[2] + R * 0.01]);
      b.cylinder(R * 0.006, R * 0.006, R * 0.08, gold, [lobe[0] + out, lobe[1] - R * 0.06, lobe[2] + R * 0.01]);
      b.sphere(R * 0.052, PALETTE.trim.pearl, [lobe[0] + out, lobe[1] - R * 0.13, lobe[2] + R * 0.01]);
    }
  }
}

// ---- moustaches ------------------------------------------------------------------------------------------------------------------

/** A tapered, swept moustache piece along control points given as [x, y] (x R, y R, centre-relative) on the lip line. */
function stache(c: FaceCtx, pts: readonly (readonly [number, number])[], widths: readonly number[], lift = 0.05, thick = 0.5, samples = 7): void {
  const { P, b } = c;
  const R = P.headRadius;
  const spine = curve(
    pts.map(([x, y]) => onSkin(c, x * R, y * R, R * lift * (0.6 + thick))),
    6,
  );
  b.sweep(
    spine,
    (t) => ({ rx: lerpAt(widths, t) * R * 0.55, rz: lerpAt(widths, t) * R * thick, pow: 2.2 }),
    c.facialC,
    { side: [0, 1, 0], segments: 4, round: "end" },
  );
  void samples;
}

export function buildMoustache(c: FaceCtx): void {
  const { spec } = c;
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
    case 10: // chevron: a thick straight brush covering the whole top lip, blunt at the ends
      for (const s of sides) stache(c, [[s * 0.01, my + 0.04], [s * 0.2, my + 0.02], [s * 0.4, my - 0.03]], [0.25, 0.24, 0.16], 0.09, 0.62);
      break;
    case 11: // lampshade: a bell of hair, narrow at the nose and flaring over the mouth with a straight hem
      for (const s of sides) stache(c, [[s * 0.03, my + 0.06], [s * 0.2, my - 0.01], [s * 0.36, my - 0.13], [s * 0.4, my - 0.22]], [0.16, 0.24, 0.24, 0.16], 0.09, 0.6);
      for (let i = 0; i < 5; i++) stache(c, [[-0.32 + i * 0.16, my - 0.1], [-0.32 + i * 0.16, my - 0.2]], [0.07, 0.03], 0.07, 0.6, 3);
      break;
    case 12: // cavalry: full and swept out and up like a dragoon's, thick to the tips
      for (const s of sides) stache(c, [[s * 0.02, my + 0.03], [s * 0.24, my], [s * 0.5, my + 0.02], [s * 0.72, my + 0.1], [s * 0.86, my + 0.2]], [0.18, 0.19, 0.16, 0.11, 0.04], 0.08, 0.58);
      break;
    case 13: // wisp: a few long thin strands drooping from the lip
      for (const s of sides) {
        stache(c, [[s * 0.03, my + 0.03], [s * 0.2, my - 0.05], [s * 0.3, my - 0.28], [s * 0.32, my - 0.5]], [0.05, 0.04, 0.03, 0.01], 0.05, 0.5);
        stache(c, [[s * 0.04, my + 0.03], [s * 0.14, my - 0.06], [s * 0.18, my - 0.24]], [0.04, 0.03, 0.01], 0.05, 0.5);
      }
      break;
    default:
      break;
  }
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
  b.sweep(spine, (t) => ({ rx: lerpAt(widths, t) * R, rz: lerpAt(depths, t) * R, pow: 2.3 }), c.facialC, { side: [1, 0, 0], segments: 6, round: "end" });
}

export function buildBeard(c: FaceCtx): void {
  const { spec } = c;
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
    case 8: // Van Dyke: a small pointed chin beard, detached from the moustache by a shaved gap
      lobe(c, [[0, -0.78, 0.03], [0, -1.0, 0.11], [0, -1.32, 0.14]], [0.2, 0.15, 0.015], [0.09, 0.11, 0.03]);
      lobe(c, [[-0.13, -0.68, 0.02], [0, -0.7, 0.05], [0.13, -0.68, 0.02]], [0.06, 0.07, 0.06], [0.04, 0.05, 0.04]);
      break;
    case 9: // forked: a long beard splitting into two tapering points
      for (const s of [-1, 1]) lobe(c, [[s * 0.06, -0.72, 0.03], [s * 0.2, -1.0, 0.14], [s * 0.42, -1.5, 0.14], [s * 0.62, -2.05, 0.1]], [0.26, 0.28, 0.2, 0.015], [0.1, 0.14, 0.12, 0.03]);
      break;
    case 10: // bib: a broad rounded beard that lies on the chest
      jawBeard(c, true, true);
      lobe(c, [[0, -0.7, 0.03], [0, -1.0, 0.2], [0, -1.6, 0.3], [0, -2.15, 0.28], [0, -2.45, 0.2]], [0.7, 0.85, 0.85, 0.7, 0.3], [0.1, 0.17, 0.2, 0.16, 0.06]);
      break;
    case 11: // soul patch: a small tuft under the lower lip
      lobe(c, [[0, -0.6, 0.02], [0, -0.7, 0.06]], [0.07, 0.06], [0.04, 0.045]);
      break;
    case 12: // sea captain: the chin curtain, whiskers along the jaw and no moustache to meet them
      jawBeard(c, true, false);
      lobe(c, [[0, -0.74, 0.03], [0, -1.0, 0.16], [0, -1.28, 0.2], [0, -1.4, 0.17]], [0.42, 0.44, 0.34, 0.14], [0.1, 0.16, 0.17, 0.11]);
      break;
    default:
      break;
  }
}

/** One whisker of a sideburn: a spine laid on the skin as [height y (x R), azimuth in front of the ear (radians), extra lift off the skin (x R)], and its width and thickness (x R) along it. */
interface Whisker {
  path: readonly (readonly [number, number, number])[];
  width: readonly number[];
  depth: readonly number[];
}

/**
 * Sideburns are SHAPED whiskers, not bands: each is a tapered mass that starts thin under the hairline, swells where the face is (fullest at the jaw for mutton chops, at the
 * cheek for wings), and ends in a rounded lobe, a flick or a point. The width axis follows the skin (tangent plane, perpendicular to the spine), so a diagonal whisker is
 * a diagonal mass and not a slanted plank; the colour deepens toward the root and lightens at the tip, so the mass has a grain instead of one flat brown.
 */
export function buildSideburns(c: FaceCtx): void {
  const { spec, P, b, shape } = c;
  const R = P.headRadius;
  const styles: Record<number, Whisker[]> = {
    // short: a neat strip in front of the ear
    1: [{ path: [[0.32, 1.25, 0], [0.12, 1.23, 0], [-0.12, 1.2, 0]], width: [0.06, 0.1, 0.075], depth: [0.035, 0.05, 0.035] }],
    // mutton chops (lamb-chops): thin at the temple, the fullest mass at the jaw, a rounded end that stops short of the mouth
    2: [{ path: [[0.32, 1.22, 0], [0.05, 1.17, 0], [-0.3, 1.07, 0.01], [-0.58, 0.97, 0.02]], width: [0.05, 0.1, 0.19, 0.21, 0.12], depth: [0.035, 0.06, 0.1, 0.105, 0.065] }],
    // flourishing: swept forward along the jaw toward the moustache, with the end flicked away from the face
    3: [{ path: [[0.3, 1.2, 0], [0.0, 1.13, 0], [-0.32, 0.98, 0.01], [-0.62, 0.78, 0.05], [-0.8, 0.62, 0.16]], width: [0.055, 0.115, 0.18, 0.15, 0.075, 0.014], depth: [0.035, 0.06, 0.085, 0.075, 0.05, 0.02] }],
    // bushy wings: a broad mass that stands off the cheek, with a second tuft flaring out behind it
    4: [
      { path: [[0.3, 1.22, 0], [0.0, 1.16, 0.03], [-0.3, 1.04, 0.08], [-0.55, 0.92, 0.1]], width: [0.09, 0.2, 0.28, 0.2, 0.08], depth: [0.06, 0.11, 0.15, 0.12, 0.06] },
      { path: [[0.2, 1.3, 0.03], [-0.08, 1.27, 0.14], [-0.34, 1.2, 0.24]], width: [0.07, 0.17, 0.1, 0.012], depth: [0.04, 0.08, 0.05, 0.02] },
    ],
    // Piccadilly weepers: long narrow falls hanging past the jaw beside the neck
    5: [
      { path: [[0.3, 1.2, 0], [-0.1, 1.14, 0], [-0.6, 1.08, 0.02], [-1.05, 1.06, 0.07], [-1.4, 1.06, 0.12]], width: [0.055, 0.075, 0.08, 0.06, 0.035, 0.01], depth: [0.035, 0.05, 0.05, 0.035, 0.025, 0.01] },
      { path: [[0.05, 1.22, 0.01], [-0.4, 1.16, 0.04], [-0.85, 1.12, 0.09], [-1.15, 1.14, 0.14]], width: [0.035, 0.055, 0.04, 0.01], depth: [0.025, 0.035, 0.026, 0.01] },
    ],
    // sculpted points: waxed into a spear that points down and forward
    6: [{ path: [[0.3, 1.2, 0], [0.0, 1.12, 0.01], [-0.3, 0.98, 0.03], [-0.62, 0.82, 0.07]], width: [0.06, 0.11, 0.15, 0.09, 0.008], depth: [0.035, 0.06, 0.075, 0.05, 0.015] }],
  };
  const whiskers = styles[spec.sideburns];
  if (!whiskers) return;
  for (const w of whiskers) {
    for (const sx of [-1, 1]) {
      const pts: V3[] = w.path.map(([y, az, lift]) => {
        const k = Math.sqrt(Math.max(0.05, 1 - y * y));
        return skinDir(c, sx * Math.sin(az) * k, y, -Math.cos(az) * k, R * (0.02 + lift));
      });
      const spine = curve(pts, 8);
      // the frame: the width axis lies in the skin's tangent plane, perpendicular to the spine
      const sideAt = (i: number): V3 => {
        const a = spine[Math.max(0, i - 1)]!;
        const z = spine[Math.min(spine.length - 1, i + 1)]!;
        const t: V3 = norm3([z[0] - a[0], z[1] - a[1], z[2] - a[2]]);
        const n = shape.normal([spine[i]![0], spine[i]![1] - c.cy, spine[i]![2]]);
        return norm3([t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]]);
      };
      b.sweep(
        spine,
        (t) => ({ rx: lerpAt(w.width, t) * R, rz: lerpAt(w.depth, t) * R, pow: 2.4, color: tone(c.facialC, 0.84 + 0.26 * smooth(0, 1, t)) }),
        c.facialC,
        { sideAt, segments: 6, round: "both" },
      );
    }
  }
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
    color: c.facialC,
    coarse: gridLevel(PartBuilder.lod, PartBuilder.hullMode),
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
  if (g) b.add(g, c.facialC, [0, cy, 0]);
}
