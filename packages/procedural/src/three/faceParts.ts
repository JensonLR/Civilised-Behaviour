import { BufferAttribute, BufferGeometry, Color } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import type { HeadShape } from "./headShape.ts";
import { gridLevel, skinRamp } from "./headShape.ts";
import { buildShell, smooth, type Dir } from "./shell.ts";
import { PartBuilder, type V3 } from "./parts.ts";
import { curve, orientOutward } from "./sweep.ts";
import { addConformedSweep, earModel, headFit } from "./headFit.ts";
import { noseGeo } from "./noseShape.ts";

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

/** How big the nostril wings are, by nose style (x the tip's width): button, hooked, bulb, long, flat, lump, snub, roman. */
const ALAR = [0.5, 0.55, 0.85, 0.5, 1.05, 0.9, 0.62, 0.55] as const;

/**
 * A nose is a swept form that rises out of the bridge of the face: a slim bridge that swells into a rounded ball at the end (`noseSwell`), with a pair of nostril wings
 * flaring at either side of the ball and two dark nostril openings under and in front of it. The style picks the spine (how it projects and droops) and the widths;
 * `noseLength` (spec) sets the projection.
 */
export function buildNose(c: FaceCtx): void {
  const { spec, P, b } = c;
  const R = P.headRadius;
  const ng = noseGeo(P, c.shape, spec, c.cy);
  const ramp = skinRamp(c.skin);
  const tipTone = spec.facePaint === 1 ? PALETTE.trim.zinc : spec.noseStyle === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.65) : ramp.blush.getHex();
  const spine = ng.spine;
  const color = spec.facePaint === 1 ? PALETTE.trim.zinc : spec.facePaint === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.45) : spec.noseStyle === 5 ? mix(c.skin, PALETTE.trim.blushHot, 0.35) : c.skin;
  // Paint on a nose is thickest on the tip and thins toward the bridge (a stick of zinc dragged down the nose), so the paint never reads as a white nose stuck on a face.
  const painted = spec.facePaint === 1;
  const noseSection = (t: number) => ({
    rx: ng.rx(t),
    rz: ng.rz(t),
    pow: 2.3,
    color: painted ? mix(c.skin, PALETTE.trim.zinc, 0.55 + 0.45 * smooth(0.05, 0.45, t)) : t > 0.72 ? mix(color, tipTone, Math.min(1, (t - 0.72) * 3.2)) : color,
  });
  b.sweep(spine, noseSection, color, { side: [1, 0, 0], segments: 8, round: "end" });

  const last = spine.length - 1;
  const at = spine[last]!;
  const prev = spine[last - 1]!;
  const tan: V3 = norm3([at[0] - prev[0], at[1] - prev[1], at[2] - prev[2]]);
  const tip = noseSection(1);
  // "Down and forward" for the tip: the way the nostrils face, projected off the tangent (a nose pointing straight down faces its nostrils forward).
  let under = norm3([0, -0.75, -0.66]);
  const dot = under[0] * tan[0] + under[1] * tan[1] + under[2] * tan[2];
  under = norm3([under[0] - tan[0] * dot, under[1] - tan[1] * dot, under[2] - tan[2] * dot]);
  if (Math.hypot(under[0], under[1], under[2]) < 0.2) under = [0, 0, -1];
  // the nostril wings: two flattened lobes beside the ball and a little behind it, flowing back into the cheeks
  const alarF = ALAR[spec.noseStyle] ?? 0.6;
  const iA = Math.max(1, Math.round(last * 0.9));
  const aPt = spine[iA]!;
  const aSec = noseSection(iA / last);
  const lobeR = Math.max(aSec.rx, aSec.rz) * 0.62 * (0.7 + 0.5 * alarF);
  const lobeTone = mix(color, tipTone, 0.45);
  for (const sx of [-1, 1]) {
    b.sphere(lobeR, lobeTone, [aPt[0] + sx * aSec.rx * (0.62 + 0.3 * alarF), aPt[1] - aSec.rz * 0.32 + under[1] * lobeR * 0.15, aPt[2] + aSec.rz * 0.5], [1.0, 0.86, 0.95]);
  }
  // nostrils: dark, slightly sunk ovals on the underside of the ball, tilted a little outward (a flattened blob half buried in the surface reads as a hole)
  const holeC = mix(c.skin, PALETTE.face.nostril, 0.88);
  const off = Math.max(tip.rx, tip.rz) * 0.82;
  const holeR = Math.max(R * 0.02, Math.min(tip.rx * 0.34, R * 0.05)) * (0.85 + 0.3 * alarF);
  for (const sx of [-1, 1]) {
    const p: V3 = [at[0] + sx * tip.rx * 0.42, at[1] + under[1] * off, at[2] + under[2] * off];
    b.sphere(holeR, holeC, p, [1, 0.62, 1.15], [Math.atan2(under[1], -under[2]) * 0.0, 0, sx * 0.25]);
  }
}

const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// ---- ears --------------------------------------------------------------------------------------------------------------------------------------

/** Where an ear hangs (head-centre frame) and how big it is: kept for callers that only need the lobe. */
export function earFrame(c: FaceCtx, sx: number): { root: V3; lobe: V3; size: number } {
  const a = headFit(c).ear(sx < 0 ? -1 : 1);
  return { root: a.root, lobe: a.lobe, size: a.size };
}

/**
 * An ear: a dished plate with a thick rim standing off the head, an egg wider at the top that leans back, sized by the ear slider and reshaped by `earShape`. The mesh is built
 * from `earModel` (headFit.ts), the same data that gives spectacles, earrings, hats and hair their anchors. The rim layers share vertices, so its normals run smoothly round it, and
 * the bowl is a darker, pinker dish (the cap's apex is pulled INTO the plate).
 */
export function buildEars(c: FaceCtx): void {
  const { b } = c;
  const ramp = skinRamp(c.skin);
  const rim = ramp.skin.getHex();
  const bowl = mix(c.skin, PALETTE.trim.blushHot, 0.3);
  for (const sx of [-1, 1] as const) {
    const m0 = earModel(c, sx);
    // (a far figure keeps the ear's outline - it is part of a big-eared silhouette - but not the rim's inner edge or the bowl's wall)
    const far = PartBuilder.lod >= 2 && !PartBuilder.hullMode;
    const m = far ? { ...m0, layers: m0.layers.slice(0, 3), dish: m0.layers[2]![0]! } : m0;
    const K = m.layers[0]!.length;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const paint = [mix(rim, 0x000000, 0.1), rim, far ? bowl : mix(rim, 0xffffff, 0.05), mix(rim, bowl, 0.5), bowl];
    const tmp = new Color();
    m.layers.forEach((layer, li) => {
      tmp.setHex(paint[li]!);
      for (const p of layer) {
        pos.push(p[0], p[1], p[2]);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    });
    const nL = m.layers.length;
    for (let li = 0; li < nL - 1; li++) {
      for (let k = 0; k < K; k++) {
        const a = li * K + k;
        const b2 = li * K + ((k + 1) % K);
        idx.push(a, a + K, b2, b2, a + K, b2 + K);
      }
    }
    // the dish: a fan from the bowl's bottom to the last layer; the root: a fan closing the buried end
    const centre = pos.length / 3;
    pos.push(m.dish[0], m.dish[1], m.dish[2]);
    tmp.setHex(mix(bowl, 0x000000, 0.12));
    col.push(tmp.r, tmp.g, tmp.b);
    for (let k = 0; k < K; k++) idx.push((nL - 1) * K + k, centre, (nL - 1) * K + ((k + 1) % K));
    const root = pos.length / 3;
    const r0 = m.layers[0]!;
    let cx = 0;
    let cz = 0;
    for (const p of r0) {
      cx += p[0] / K;
      cz += p[2] / K;
    }
    pos.push(cx, r0[0]![1], cz);
    tmp.setHex(rim);
    col.push(tmp.r, tmp.g, tmp.b);
    for (let k = 0; k < K; k++) idx.push(k, (k + 1) % K, root);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    geo.setIndex(idx);
    orientOutward(geo);
    geo.computeVertexNormals();
    geo.setAttribute("uv", new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    PartBuilder.auditKind = "loft";
    b.add(geo, rim, m.pos, m.rot);
  }
}

const tone = (color: number, k: number): number => new Color(color).multiplyScalar(k).getHex();

/**
 * Earrings (spec.earring): a gold hoop, a stud, a pearl drop, or a pair of hoops, worn through the lobe of the ear as it was actually built (the lobe anchor of the ear
 * model), so they hang from the ear on a huge head, a tiny one, a jug ear and a long-lobed one alike.
 */
export function buildEarrings(c: FaceCtx): void {
  const { spec, b, P } = c;
  if (spec.earring === 0) return;
  const R = P.headRadius;
  const gold = c.accent;
  const hf = headFit(c);
  const sides: (1 | -1)[] = spec.earring === 4 ? [-1, 1] : [-1];
  for (const sx of sides) {
    const ear = hf.ear(sx);
    const es = ear.size;
    // the piercing: on the lobe, a little above its lowest point, on the outer face
    const pierce: V3 = [ear.lobe[0] + sx * es * 0.12, ear.lobe[1] + es * 0.22, ear.lobe[2] + es * 0.05];
    const ringR = Math.max(R * 0.05, Math.min(R * 0.1, es * 0.5));
    if (spec.earring === 1 || spec.earring === 4) {
      // a hoop hanging in the plane of the lobe's thickness, its top through the piercing
      b.torus(ringR, R * 0.014, gold, [pierce[0], pierce[1] - ringR * 0.85, pierce[2]], [0, sx * 1.1, 0]);
    } else if (spec.earring === 2) {
      b.sphere(R * 0.035, gold, [pierce[0] + sx * R * 0.015, pierce[1], pierce[2]]);
    } else if (spec.earring === 3) {
      b.sphere(R * 0.026, gold, [pierce[0] + sx * R * 0.012, pierce[1], pierce[2]]);
      b.cylinder(R * 0.006, R * 0.006, R * 0.08, gold, [pierce[0] + sx * R * 0.012, pierce[1] - R * 0.05, pierce[2]]);
      b.sphere(R * 0.052, PALETTE.trim.pearl, [pierce[0] + sx * R * 0.012, pierce[1] - R * 0.125, pierce[2]]);
    }
  }
}

// ---- moustaches ------------------------------------------------------------------------------------------------------------------------------------

/** A tapered, swept moustache piece along control points given as [x, y] (x R, y R, centre-relative) on the lip line. */
function stache(c: FaceCtx, pts: readonly (readonly [number, number])[], widths: readonly number[], lift = 0.05, thick = 0.5): void {
  const { P, b } = c;
  const R = P.headRadius;
  const spine = curve(
    pts.map(([x, y]) => onSkin(c, x * R, y * R, R * lift * (0.6 + thick))),
    6,
  );
  b.sweep(
    spine,
    (t) => ({ rx: lerpAt(widths, t) * R * 0.55, rz: lerpAt(widths, t) * R * thick, pow: 2.2, color: strandTone(c, 0.86 + 0.26 * t, 0.5 + 0.3 * t, t) }),
    c.facialC,
    { side: [0, 1, 0], segments: 4, round: "end" },
  );
}

/**
 * A moustache as ONE bar from tip to tip through the middle (no seam under the nose): `half` is the right half from the centre out, mirrored for the left. The bar grows out of
 * the lip, so its middle is the thickest; `curl` lifts the last stretch off the cheek in an arc (waxed tips stand off the face instead of lying on it).
 */
function bar(c: FaceCtx, half: readonly (readonly [number, number])[], widths: readonly number[], lift = 0.05, thick = 0.5, curl = 0): void {
  const { P, b } = c;
  const R = P.headRadius;
  const n = half.length;
  const full = [...half.map(([x, y]) => [-x, y] as const).reverse(), ...half];
  const w = [...widths].reverse().concat(widths);
  const N = full.length;
  const pts = full.map(([x, y], i) => {
    const t = Math.abs(i - (N - 1) / 2) / ((N - 1) / 2); // 0 in the middle .. 1 at the tips
    const lift0 = R * lift * (0.6 + thick) + R * curl * Math.max(0, (t - 0.55) / 0.45) ** 2;
    void n;
    return onSkin(c, x * R, y * R, lift0);
  });
  const spine = curve(pts, Math.max(9, N * 2));
  addConformedSweep(b, headFit(c), spine, (t) => ({ rx: lerpAt(w, t) * R * 0.55, rz: lerpAt(w, t) * R * thick, pow: 2.2, color: strandTone(c, 0.84 + 0.28 * Math.abs(2 * t - 1), 0.45 + 0.4 * Math.abs(2 * t - 1), Math.abs(2 * t - 1)) }), c.facialC, { side: [0, 1, 0], segments: 4, round: "both" }, 0.002);
}

export function buildMoustache(c: FaceCtx): void {
  const { spec } = c;
  const my = -0.34;
  switch (spec.moustache) {
    case 1: // handlebar: a bar that sweeps out and curls up
      bar(c, [[0.02, my], [0.2, my - 0.02], [0.42, my - 0.06], [0.6, my + 0.02], [0.66, my + 0.14], [0.58, my + 0.2]], [0.13, 0.14, 0.11, 0.07, 0.05, 0.03], 0.07, 0.55, 0.1);
      break;
    case 2: // walrus: a thick drooping curtain
      bar(c, [[0.02, my + 0.02], [0.22, my - 0.03], [0.38, my - 0.14], [0.42, my - 0.28]], [0.2, 0.22, 0.17, 0.08], 0.09, 0.6);
      break;
    case 3: // pencil
      bar(c, [[0.01, my + 0.02], [0.3, my + 0.01]], [0.05, 0.03], 0.04, 0.5);
      break;
    case 4: // toothbrush
      bar(c, [[0.01, my + 0.02], [0.13, my + 0.02]], [0.13, 0.12], 0.05, 0.55);
      break;
    case 5: // imperial: neat bar with long upswept points
      bar(c, [[0.02, my + 0.02], [0.22, my], [0.42, my + 0.06], [0.6, my + 0.2], [0.66, my + 0.36]], [0.11, 0.11, 0.08, 0.05, 0.02], 0.06, 0.5, 0.07);
      break;
    case 6: // horseshoe: bar with legs down the chin
      bar(c, [[0.02, my + 0.02], [0.28, my + 0.02], [0.34, my - 0.12], [0.34, my - 0.34]], [0.08, 0.08, 0.08, 0.05], 0.05, 0.5);
      break;
    case 7: // magnificent fringe: a row of short hanging tufts
      for (let i = -3; i <= 3; i++) stache(c, [[i * 0.1, my + 0.04], [i * 0.1 + Math.sign(i) * 0.015, my - 0.08 - Math.abs(i) * 0.005]], [0.07, 0.03], 0.06, 0.6);
      break;
    case 8: // waxed tips: slim bar, needle points
      bar(c, [[0.02, my + 0.02], [0.2, my + 0.02], [0.42, my + 0.1], [0.6, my + 0.26], [0.66, my + 0.44]], [0.07, 0.07, 0.05, 0.03, 0.008], 0.06, 0.5, 0.08);
      break;
    case 9: // soup strainer: enormous, drooping over mouth and chin
      bar(c, [[0.02, my + 0.03], [0.2, my - 0.02], [0.34, my - 0.18], [0.38, my - 0.4], [0.34, my - 0.56]], [0.24, 0.27, 0.2, 0.13, 0.04], 0.1, 0.6);
      break;
    case 10: // chevron: a thick straight brush covering the whole top lip, blunt at the ends
      bar(c, [[0.01, my + 0.04], [0.2, my + 0.02], [0.4, my - 0.03]], [0.25, 0.24, 0.16], 0.09, 0.62);
      break;
    case 11: // lampshade: a bell of hair, narrow at the nose and flaring over the mouth with a straight hem
      bar(c, [[0.03, my + 0.06], [0.2, my - 0.01], [0.36, my - 0.13], [0.4, my - 0.22]], [0.16, 0.24, 0.24, 0.16], 0.09, 0.6);
      for (let i = 0; i < 5; i++) stache(c, [[-0.32 + i * 0.16, my - 0.1], [-0.32 + i * 0.16, my - 0.2]], [0.07, 0.03], 0.07, 0.6);
      break;
    case 12: // cavalry: full and swept out and up like a dragoon's, thick to the tips
      bar(c, [[0.02, my + 0.03], [0.24, my], [0.5, my + 0.02], [0.72, my + 0.1], [0.86, my + 0.2]], [0.18, 0.19, 0.16, 0.11, 0.04], 0.08, 0.58, 0.05);
      break;
    case 13: // wisp: a few long thin strands drooping from the lip
      for (const s of [-1, 1]) {
        stache(c, [[s * 0.03, my + 0.03], [s * 0.2, my - 0.05], [s * 0.3, my - 0.28], [s * 0.32, my - 0.5]], [0.05, 0.04, 0.03, 0.01], 0.05, 0.5);
        stache(c, [[s * 0.04, my + 0.03], [s * 0.14, my - 0.06], [s * 0.18, my - 0.24]], [0.04, 0.03, 0.01], 0.05, 0.5);
      }
      break;
    default:
      break;
  }
}

// ---- beards & sideburns ------------------------------------------------------------------------------------------------------------

/**
 * A beard lobe: a tapered form hanging from the chin or jaw. `pts` are [x, y, projection] (x R, centre-relative). Points on the face are laid on the skin; points below the chin
 * hang in the air, so they are pushed out of the neck and the chest (`HeadFit.pushOut`) and a long beard lies ON the coat instead of sinking into it. The hair root may sink a
 * quarter of its own thickness into the skin, no more.
 */
function lobe(c: FaceCtx, ptsIn: readonly (readonly [number, number, number])[], widthsIn: readonly number[], depthsIn: readonly number[]): void {
  const { P, b } = c;
  const R = P.headRadius;
  const hf = headFit(c);
  // the tube ROOTS in the skin: one more, slimmer section just above its first point, lying on the surface
  const first = ptsIn[0]!;
  const pts: readonly (readonly [number, number, number])[] = [[first[0], first[1] + 0.08, 0], ...ptsIn];
  const widths = [widthsIn[0]! * 0.7, ...widthsIn];
  const depths = [depthsIn[0]! * 0.5, ...depthsIn];
  const n = pts.length;
  let last: V3 | undefined;
  const raw = pts.map(([x, y, f], i) => {
    const d = lerpAt(depths, i / (n - 1)) * R;
    let p: V3;
    if (hf.hits(x * R, y * R)) p = onSkin(c, x * R, y * R, d * 0.75 + f * R * 0.3);
    else p = [x * R, c.cy + y * R, (last ? last[2] : -R * 0.5) - f * R * 0.1];
    // in front of the neck and the chest: forward until the tube's inner side is clear of the body
    const r = hf.clearRadius(0, p[1], -p[2], d * 0.75, p[0]);
    p = [p[0], p[1], -r];
    last = p;
    return p;
  });
  const spine = curve(raw, 3 * n + 1).map((p, i, all) => {
    const g = lerpAt(depths, i / (all.length - 1)) * R * 0.75;
    return hf.bodyDist(p[0], p[1], p[2]) < g ? [p[0], p[1], -hf.clearRadius(0, p[1], -p[2], g, p[0])] as V3 : p;
  });
  // the mass: root darker, tip lighter, so a beard has a grain and not one flat colour
  addConformedSweep(b, hf, spine, (t) => ({ rx: lerpAt(widths, t) * R, rz: lerpAt(depths, t) * R, pow: 2.3, color: strandTone(c, 0.84 + 0.26 * smooth(0, 1, t), 0.5) }), c.facialC, { side: [1, 0, 0], segments: 6, round: "end" }, 0.002);
  fringe(c, hf, spine, widths, depths);
}

/** Facial hair colour for one strand: the beard colour, scaled by `k`, and (if the character is greying) some strands greyer than others, chin and tips first. `h` in 0..1 picks the strand. */
function strandTone(c: FaceCtx, k: number, h: number, tip = 0): number {
  const grey = [0, 0.35, 0.55, 0.9][c.spec.greying] ?? 0;
  const base = grey > 0 ? mix(c.facialC, PALETTE.hair[7]!, Math.min(1, grey * Math.max(0, h * 1.3 - 0.15 + tip * 0.3)) * 0.55) : c.facialC;
  return tone(base, k);
}

/**
 * A beard is a mass of hair, not a smooth cone: over the solid core of each lobe lie several overlapping locks that follow its spine at different lateral offsets and lengths, each
 * tapering to its own point with a dark root and a light tip. Where the locks part, the darker core shows. Full-detail heads only (locks are 1-3 cm wide; the ink line follows the core).
 */
function fringe(c: FaceCtx, hf: ReturnType<typeof headFit>, spine: readonly V3[], widths: readonly number[], depths: readonly number[]): void {
  if (PartBuilder.lod > 0 || PartBuilder.hullMode) return;
  const { P, b } = c;
  const R = P.headRadius;
  const n = spine.length;
  const last = spine[n - 1]!;
  const first = spine[0]!;
  const length = Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]);
  const wMax = Math.max(...widths) * R;
  if (length < R * 0.45 || wMax < R * 0.1) return;
  if (Math.abs(last[0] - first[0]) > length * 0.3) return; // (a lobe that runs diagonally across the chest, the forked beard, keeps its smooth form: locks laid over a bent, conformed tube fold)
  const K = wMax > R * 0.36 ? 5 : wMax > R * 0.2 ? 4 : 3;
  const prev = spine[Math.max(0, n - 3)]!;
  const dir: V3 = [last[0] - prev[0], last[1] - prev[1], last[2] - prev[2]];
  const dl = Math.hypot(...dir) || 1;
  const spacing = 2 / K;
  for (let k = 0; k < K; k++) {
    const u = -1 + spacing * (k + 0.5);
    const h = ((k * 37 + Math.round(length * 1000)) % 17) / 17;
    const lenK = 0.8 + 0.3 * (((k * 5 + 2) % 7) / 6); // how far down the spine this lock runs (a little past the end for the longest)
    const pts: V3[] = [];
    for (let j = 0; j < 5; j++) {
      const t = (j / 4) * lenK;
      const f = Math.min(t, 1) * (n - 1);
      const i0 = Math.min(n - 2, Math.floor(f));
      const q0 = spine[i0]!;
      const q1 = spine[i0 + 1]!;
      const fr = f - i0;
      const over = Math.max(0, t - 1);
      const px = q0[0] + (q1[0] - q0[0]) * fr;
      const py = q0[1] + (q1[1] - q0[1]) * fr;
      const pz = q0[2] + (q1[2] - q0[2]) * fr;
      const off = u * lerpAt(widths, Math.min(1, t)) * R * (1 - 0.12 * t);
      const tx = q1[0] - q0[0];
      const ty = q1[1] - q0[1];
      const tl = Math.hypot(tx, ty) || 1;
      // (the lock is displaced across the beard, perpendicular to its run, so a diagonal lobe gets diagonal locks and not sheared ones)
      const lx = -ty / tl;
      const ly = tx / tl;
      pts.push([px + lx * off + (dir[0] / dl) * over * R * 1.2, py + ly * off + (dir[1] / dl) * over * R * 1.2, pz + (dir[2] / dl) * over * R * 1.2 - R * 0.012 - lerpAt(depths, Math.min(1, t)) * R * (0.5 + 0.25 * Math.abs(u)) * (1 - 0.5 * t)]);
    }
    const sp = curve(pts, 5);
    const rx0 = ((wMax * 2) / K) * 0.62 * (0.85 + 0.3 * h);
    addConformedSweep(
      b,
      hf,
      sp,
      (t) => ({ rx: Math.min(rx0, lerpAt(widths, Math.min(1, t * lenK)) * R * 0.9 + R * 0.01) * (1 - 0.94 * t ** 1.5) + R * 0.003, rz: lerpAt(depths, Math.min(1, t * lenK)) * R * 0.8 * (1 - 0.6 * t), pow: 2.3, color: strandTone(c, 0.8 + 0.36 * t ** 0.8 * (0.92 + 0.16 * h), h, t) }),
      c.facialC,
      { sideAt: (i) => { const a = sp[Math.max(0, i - 1)]!; const e = sp[Math.min(sp.length - 1, i + 1)]!; const l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1; return [-(e[1] - a[1]) / l, (e[0] - a[0]) / l, 0] as V3; }, segments: 4, caps: true },
      0.014,
    );
  }
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
      for (const s of [-1, 1]) lobe(c, [[s * 0.6, -0.2, 0.02], [s * 0.6, -0.5, 0.08], [s * 0.4, -0.9, 0.16]], [0.12, 0.2, 0.22], [0.06, 0.1, 0.14]);
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
  /** Heights (x R, centre-relative) where the whisker leaves the face and hangs straight down beside the neck (Piccadilly weepers). */
  hang?: readonly number[];
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
      { path: [[0.3, 1.2, 0], [-0.1, 1.14, 0], [-0.6, 1.08, 0.02]], hang: [-1.05, -1.5], width: [0.055, 0.075, 0.08, 0.06, 0.035, 0.01], depth: [0.035, 0.05, 0.05, 0.035, 0.025, 0.01] },
      { path: [[0.05, 1.22, 0.01], [-0.4, 1.16, 0.04]], hang: [-0.85, -1.15], width: [0.035, 0.055, 0.04, 0.01], depth: [0.025, 0.035, 0.026, 0.01] },
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
      if (w.hang) {
        let last = pts[pts.length - 1]!;
        for (const yy of w.hang) {
          last = [last[0] * 0.985, c.cy + yy * R, last[2] - R * 0.02];
          pts.push(last);
        }
      }
      const hf = headFit(c);
      const spine = curve(pts, 8).map((p, i, all) => hf.pushOut(p, lerpAt(w.depth, i / (all.length - 1)) * R * 0.7));
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
  const R = c.P.headRadius;
  const hf = headFit(c);
  const thick = (d: Dir): number => 0.09 + 0.14 * smooth(-0.45, -0.95, d.y);
  const lift = (d: Dir): V3 => {
    const w = Math.exp(-(((d.x / 0.4) ** 2) + (((d.y + 0.92) / 0.22) ** 2)));
    return [0, -0.22 * w, -0.06 * w];
  };
  const g = buildShell(shape, {
    color: c.facialC,
    coarse: gridLevel(PartBuilder.lod, PartBuilder.hullMode),
    mask: (d) => {
      const edge = 1 - smooth(top(d.az) - 0.11, top(d.az) + 0.11, d.y); // 1 below the edge (a ramp about a grid cell wide, so the cut is a smooth curve and not a staircase)
      const side = smooth(0.35, 0.6, d.az); // 0 at the front, 1 at the cheeks
      const region = chin ? (cheeks ? 1 : 1 - side) : cheeks ? side : 0;
      let m = edge * region * (1 - smooth(1.45, 1.6, d.az)) * (d.z < 0.55 ? 1 : 0);
      if (m > 0 && d.y < -0.55) {
        // the underside of the jaw is hidden in the neck: where the hair would be inside the neck or the coat it is left out (the beard hangs in front of them)
        const r = shape.radius(d.x, d.y, d.z);
        const inside = hf.bodyDist(d.x * r, c.cy + d.y * r, d.z * r);
        m *= smooth(-0.004, 0.012, inside);
      }
      return m;
    },
    thick,
    lift,
    // vertices the downward sweep of the beard drags into the neck or the chest are moved forward until they lie on it
    settle: (p) => {
      const gap = 0.004;
      if (hf.bodyDist(p[0], p[1] + cy, p[2]) >= gap) return p;
      return [p[0], p[1], -hf.clearRadius(0, p[1] + cy, Math.max(0, -p[2]), gap, p[0])];
    },
  });
  if (g) b.add(g, c.facialC, [0, cy, 0]);
}
