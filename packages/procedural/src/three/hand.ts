import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import { CREAM, PartBuilder, singe, type V3 } from "./parts.ts";
import { tone, type BodyCtx } from "./bodyKit.ts";

/**
 * Hands. At full detail a hand is a palm slab with four fingers (three joints each, fanned a little and curled a little when relaxed), a thumb and knuckles - not a
 * fist. The same builder can be run at any GRIP (0 relaxed and open .. 1 a closed fist) and the results have identical topology, so `buildForeArm` builds the pose
 * at 0, 0.5 and 1 and stores the differences as two morph targets: `rig.setHandGrip(side, amount)` is then one number per hand and no extra draw call.
 * Crowd levels use a plain fist ball (the fingers are a few pixels).
 *
 * Frame: the forearm's (origin at the elbow, hanging down -Y). The hand hangs from the wrist with its palm facing the body (inward = -sx) and the thumb to the
 * front (-Z), the way a relaxed arm hangs. Fingers curl toward the palm side, so a grip closes on a rod running front-to-back.
 */

/** Colour of the hand: bare skin, or the glove. */
export function handColor(c: BodyCtx): number {
  const g = c.spec.gloves;
  if (g === 1) return singe(CREAM, c.burnt);
  if (g === 2) return singe(c.leather, c.burnt);
  if (g === 3) return singe(tone(c.leather, 0.92), c.burnt);
  if (g === 4) return singe(tone(c.leather, 0.85), c.burnt);
  if (g === 5) return singe(PALETTE.material.fur, c.burnt);
  return c.skin;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Segment lengths of a finger (x hand radius) and how long each finger is relative to the middle one (index, middle, ring, little). */
const SEG = [0.46, 0.36, 0.28] as const;
const FINGER_LEN = [0.95, 1.0, 0.92, 0.72] as const;
/** Curl at each joint (radians): a hanging hand's fingers are bent a little, more toward the little finger; a fist folds them fully. */
const RELAXED = (k: number): readonly number[] => [0.2 + 0.05 * k, 0.5 + 0.06 * k, 0.4 + 0.05 * k];
const FIST = [1.5, 1.75, 1.3] as const;
const SPREAD = [-0.1, -0.03, 0.05, 0.14] as const;

/** The four control points of finger k (0 index .. 3 little) at grip g, in the forearm frame. `palmBottom` is the height of the knuckle row. */
function fingerPath(hr: number, sx: number, k: number, g: number, palmBottom: number): V3[] {
  const th = RELAXED(k).map((r, i) => lerp(r, FIST[i]!, g));
  const spread = lerp(SPREAD[k]!, 0, g);
  let x = -sx * hr * lerp(0.02, 0.22, g); // (in a fist the knuckles roll toward the palm side)
  let y = palmBottom;
  let z = -hr * (0.55 - 0.365 * k);
  const out: V3[] = [[x, y, z]];
  let a = 0;
  for (let i = 0; i < 3; i++) {
    const len = SEG[i]! * hr * FINGER_LEN[k]!;
    a += th[i]!;
    x += -sx * Math.sin(a) * len;
    y += -Math.cos(a) * len;
    z += Math.sin(spread) * len;
    out.push([x, y, z]);
  }
  return out;
}

/** The thumb's three control points at grip g: hanging forward of the palm, or folded across the front of the curled fingers. */
function thumbPath(hr: number, sx: number, g: number, wristY: number): V3[] {
  const at = (x: number, yf: number, z: number): V3 => [-sx * x * hr, wristY - yf * hr, z * hr];
  const relaxed = [at(0.24, 0.4, -0.62), at(0.34, 0.78, -0.82), at(0.46, 1.06, -0.86)];
  const fist = [at(0.3, 0.4, -0.62), at(0.7, 0.88, -0.62), at(0.72, 0.95, -0.12)];
  return relaxed.map((p, i) => [lerp(p[0], fist[i]![0], g), lerp(p[1], fist[i]![1], g), lerp(p[2], fist[i]![2], g)] as V3);
}

/**
 * The hand at grip g (0 relaxed .. 1 fist), hanging from the wrist at y = -armLength. Every branch of the geometry is identical in topology for every g (the morph
 * targets depend on it): only positions change.
 */
export function buildHand(b: PartBuilder, c: BodyCtx, armLength: number, side: "L" | "R", g: number): void {
  const { P, spec } = c;
  const skin = handColor(c);
  const bare = c.skin;
  const hr = P.handRadius;
  const sx = side === "R" ? 1 : -1;
  const wristY = -armLength;
  const Y = (f: number): number => wristY - hr * f; // f: heights below the wrist in hand radii
  const mitt = spec.gloves === 5;
  const fingerless = spec.gloves === 3;
  const tattooC = PALETTE.face.tattoo;
  const knuckleBands = spec.tattoo === 4 && !spec.gloves;

  if (PartBuilder.lod > 0) {
    fistBall(b, c, armLength, skin);
    cuffs(b, c, armLength, skin);
    return;
  }

  // ---- palm: a rounded slab, wider across the knuckles --------------------------------------------------------------------------------------------
  b.loft(
    [
      { y: wristY + 0.012, rx: hr * 0.34, rz: hr * 0.46, color: tone(skin, 0.9) },
      { y: Y(0.3), rx: hr * 0.4, rz: hr * 0.72, pow: 2.6, color: skin },
      { y: Y(0.76), rx: hr * 0.38, rz: hr * 0.82, pow: 2.8, color: knuckleBands ? tattooC : skin },
      { y: Y(0.94), rx: hr * 0.32, rz: hr * 0.78, pow: 2.8, color: knuckleBands ? tattooC : tone(skin, 0.96) },
      { y: Y(1.06), rx: hr * 0.2, rz: hr * 0.62, pow: 2.4, color: tone(skin, 0.88) },
    ],
    skin,
  );
  // The outline hull is drawn once and never morphs, so it must not contain anything that moves with the grip (a hull of the relaxed fingers would hang below a fist as a black ghost).
  if (PartBuilder.hullMode) {
    cuffs(b, c, armLength, skin);
    return;
  }
  // knuckles: two proud bumps on the back of the hand read the fist and the flat hand alike
  for (const zz of [-0.36, 0.36]) b.sphere(hr * 0.2, tone(skin, 1.04), [sx * hr * 0.34, Y(0.86), zz * hr], [0.7, 0.8, 1.2]);

  // ---- fingers -----------------------------------------------------------------------------------------------------------------------------------
  const ringOn = (side === "R" && (spec.ring === 1 || spec.ring === 2 || spec.ring === 4)) || (side === "L" && (spec.ring === 3 || spec.ring === 4));
  const palmBottom = Y(0.9);
  const section = (k: number, base: number) => (t: number) => ({
    rx: hr * (0.155 - 0.035 * t) * (mitt ? 1.2 : 1),
    rz: hr * (0.15 - 0.032 * t),
    pow: 2.3,
    color: fingerless && t > 0.36 ? bare : t > 0.62 ? tone(skin, (k % 2 ? 0.92 : 1.02) * 1.06) : t < 0.12 ? tone(base, 0.8) : base,
  });
  if (mitt) {
    // one mass for the four fingers (a mitten), then the thumb apart
    const pts = fingerPath(hr, sx, 1, g, palmBottom).map((p): V3 => [p[0], p[1], -hr * 0.02]);
    b.sweep(
      curve(pts, 4),
      (t) => ({ rx: hr * (0.62 - 0.12 * t), rz: hr * (0.26 - 0.04 * t), pow: 2.4, color: t > 0.7 ? tone(skin, 1.1) : skin }),
      skin,
      { side: [0, 0, 1], segments: 6, round: "end" },
    );
  } else {
    for (let k = 0; k < 4; k++) {
      const base = tone(skin, k % 2 ? 0.92 : 1.02);
      const pts = fingerPath(hr, sx, k, g, palmBottom);
      b.sweep(curve(pts, 4), section(k, base), base, { side: [0, 0, 1], segments: 4, round: "end" });
      // a ring on the finger next to the little finger (right hand: a signet on the little finger; left: a wedding band on the ring finger)
      if (ringOn && !spec.gloves && ((side === "R" && k === 3) || (side === "L" && k === 2))) {
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const ang = Math.atan2(-(p1[0] - p0[0]) * sx, -(p1[1] - p0[1])); // (the cylinder's axis is Y; it is turned about Z onto the finger)
        const mid: V3 = [lerp(p0[0], p1[0], 0.5), lerp(p0[1], p1[1], 0.5), lerp(p0[2], p1[2], 0.5)];
        b.cylinder(hr * 0.175, hr * 0.175, hr * 0.09, c.accent, mid, [0, 0, -sx * ang], undefined, true);
        if (side === "R" && spec.ring !== 3) {
          const gem = spec.ring === 2 || spec.ring === 4;
          b.sphere(gem ? 0.014 : 0.017, gem ? PALETTE.trim.gemRed : c.accent, [mid[0] + sx * hr * 0.18, mid[1], mid[2]], gem ? [0.8, 1, 1] : [0.5, 0.7, 1]);
        }
      }
    }
  }

  // ---- thumb --------------------------------------------------------------------------------------------------------------------------------------
  b.sweep(
    curve(thumbPath(hr, sx, g, wristY), 4),
    (t) => ({ rx: hr * (0.185 - 0.045 * t), rz: hr * (0.185 - 0.045 * t), pow: 2.3, color: fingerless && t > 0.5 ? bare : t > 0.7 ? tone(skin, 1.05) : skin }),
    skin,
    { side: [1, 0, 0], segments: 5, round: "end" },
  );

  if (spec.tattoo === 2 && !spec.gloves) {
    // an anchor on the back of the hand: shank, stock, arms and a ring
    const x = sx * hr * 0.4;
    b.box(0.005, hr * 0.9, 0.008, tattooC, [x, Y(0.55), 0]);
    b.box(0.005, 0.008, hr * 0.5, tattooC, [x, Y(0.3), 0]);
    b.torus(hr * 0.08, 0.004, tattooC, [x, Y(0.16), 0], [0, Math.PI / 2, 0]);
    b.box(0.005, 0.008, hr * 0.6, tattooC, [x, Y(0.82), 0]);
  }
  cuffs(b, c, armLength, skin);
}

/** The plain fist used at crowd levels: a rounded palm block with a knuckle ridge. */
function fistBall(b: PartBuilder, c: BodyCtx, armLength: number, skin: number): void {
  const hr = c.P.handRadius;
  const hy = -armLength - hr * 0.7;
  b.loft(
    [
      { y: hy + hr * 0.75, rx: hr * 0.62, rz: hr * 0.55, color: tone(skin, 0.9) },
      { y: hy + hr * 0.2, rx: hr * 1.0, rz: hr * 0.72, pow: 2.8, color: skin },
      { y: hy - hr * 0.2, rx: hr * 1.02, rz: hr * 0.77, pow: 3, color: skin },
      { y: hy - hr * 0.6, rx: hr * 1.02, rz: hr * 0.78, pow: 3, color: skin },
      { y: hy - hr * 0.95, rx: hr * 0.88, rz: hr * 0.62, pow: 2.8, color: tone(skin, 0.94) },
    ],
    skin,
  );
}

/** Glove cuffs at the wrist (they are part of the hand geometry but do not move with the grip). */
function cuffs(b: PartBuilder, c: BodyCtx, armLength: number, skin: number): void {
  const { P, spec } = c;
  const hr = P.handRadius;
  const hy = -armLength - hr * 0.7; // (the old fist's centre: the cuffs are placed relative to it, as they always were)
  const r = P.armRadius;
  if (spec.gloves === 2 || spec.gloves === 4) {
    // leather gauntlet: a flared cuff running up the wrist; gauntlets are longer and stiffer
    const long = spec.gloves === 4;
    const g = tone(skin, 1.12);
    b.loft(
      [
        { y: hy + hr * 0.95, rx: r * 0.95, rz: r * 0.92, color: tone(skin, 0.9) },
        { y: hy + hr * (long ? 1.9 : 1.5), rx: r * (long ? 1.25 : 1.1), rz: r * (long ? 1.2 : 1.06), color: g },
        { y: hy + hr * (long ? 2.7 : 2.0), rx: r * (long ? 1.42 : 1.16), rz: r * (long ? 1.36 : 1.12), color: g, crease: true },
      ],
      skin,
      undefined,
      undefined,
      undefined,
      { capTop: false },
    );
    if (long) b.torus(r * 1.3, 0.008, c.accent, [0, hy + hr * 2.2, 0], [Math.PI / 2, 0, 0]);
  }
  if (spec.gloves === 3) {
    // fingerless glove: a knitted wrist band
    b.loft(
      [
        { y: hy + hr * 1.5, rx: r * 0.98, rz: r * 0.95, color: tone(skin, 1.08) },
        { y: hy + hr * 0.95, rx: r * 0.92, rz: r * 0.9, color: skin },
      ],
      skin,
      undefined,
      undefined,
      undefined,
      { capTop: false, capBottom: false },
    );
  }
  if (spec.gloves === 5) {
    // fur mitts: a shaggy cuff round the wrist
    const fur = singe(PALETTE.material.fur, c.burnt);
    b.loft([{ y: hy + hr * 0.95, rx: r * 1.15, rz: r * 1.1, color: tone(fur, 0.8) }, { y: hy + hr * 1.5, rx: r * 1.32, rz: r * 1.26, color: fur }, { y: hy + hr * 2.0, rx: r * 1.18, rz: r * 1.12, color: tone(fur, 1.1) }], fur, undefined, undefined, undefined, { capTop: false });
  }
}
