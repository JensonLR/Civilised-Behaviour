import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import { PartBuilder, singe, type V3 } from "./parts.ts";
import { ringAt, tone, type BodyCtx } from "./bodyKit.ts";
import { CUFF_HANG, foreArmRings, handColour, wristSize } from "./limbRings.ts";
import { bandOn, clothLift } from "./limbKit.ts";

/**
 * Hands. At full detail a hand is a palm slab with four fingers (three joints each, fanned a little and curled a little when relaxed), a thumb and knuckles - not a
 * fist. The same builder can be run at any GRIP (0 relaxed and open .. 1 a closed fist) and the results have identical topology, so `buildForeArm` builds the pose
 * at 0, 0.5 and 1 and stores the differences as two morph targets: `rig.setHandGrip(side, amount)` is then one number per hand and no extra draw call.
 * Crowd levels use a plain fist ball (the fingers are a few pixels).
 *
 * Frame: the WRIST's (origin at the wrist joint, `rig.joints.wristL/R`, hanging down -Y): the hand is its own bone, a child of the forearm, so it can turn to follow a weapon's grip
 * (weaponPose.ts `solveWrist`) and its outline hull bends with it. The hand hangs from the wrist with its palm facing the body (inward = -sx) and the thumb to the front (-Z), the
 * way a relaxed arm hangs. Fingers curl toward the palm side, so a grip closes on a rod running front-to-back: THE GRIP AXIS IS THE HAND'S LOCAL Z (the line the knuckles lie on).
 * The top of the palm is a ball centred on the wrist joint (radius = the wrist), so however far the wrist turns the hand keeps closing the sleeve's open end.
 * The glove's cuff (gauntlet, band, fur) is part of the FOREARM (`handCuffs`): it stays with the sleeve.
 */

/** Colour of the hand: bare skin, or the glove (limbRings.ts: the sleeve's end is tucked onto it). */
export const handColor = handColour;

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
  let z = -hr * (0.51 - 0.34 * k);
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
  const relaxed = [at(0.2, 0.2, -0.58), at(0.3, 0.62, -0.74), at(0.4, 0.98, -0.84)];
  const fist = [at(0.26, 0.24, -0.58), at(0.68, 0.84, -0.6), at(0.72, 0.95, -0.12)];
  return relaxed.map((p, i) => [lerp(p[0], fist[i]![0], g), lerp(p[1], fist[i]![1], g), lerp(p[2], fist[i]![2], g)] as V3);
}

/**
 * The hand at grip g (0 relaxed .. 1 fist), hanging from the wrist at y = -armLength. Every branch of the geometry is identical in topology for every g (the morph
 * targets depend on it): only positions change.
 */
export function buildHand(b: PartBuilder, c: BodyCtx, side: "L" | "R", g: number): void {
  const { P, spec } = c;
  const skin = handColor(c);
  const bare = c.skin;
  const hr = P.handRadius;
  const sx = side === "R" ? 1 : -1;
  const wristY = 0;
  const wr = wristSize(P);
  const Y = (f: number): number => wristY - hr * f; // f: heights below the wrist in hand radii
  const mitt = spec.gloves === 5;
  const fingerless = spec.gloves === 3;
  const tattooC = PALETTE.face.tattoo;
  const knuckleBands = spec.tattoo === 4 && !spec.gloves;

  if (PartBuilder.lod > 0) {
    fistBall(b, c, skin);
    return;
  }

  // ---- palm: the back of the hand and the palm as one rounded block, narrow at the wrist, as wide as the four fingers across the knuckles and rounded off under them ----------------------
  // (the top is a ball centred on the wrist joint: rings of a sphere of the wrist's radius, so a turning wrist never pushes the palm through the sleeve)
  const ball = (k: number): { y: number; rx: number; rz: number; color: number } => {
    const s = Math.sqrt(1 - k * k);
    return { y: wristY + Math.min(wr.rx, wr.rz) * 0.98 * k, rx: wr.rx * 0.98 * s, rz: wr.rz * 0.98 * s, color: tone(skin, 0.86) };
  };
  b.loft(
    [
      ball(0.86),
      ball(0.0),
      { y: Y(0.34), rx: hr * 0.4, rz: hr * 0.6, cz: -hr * 0.03, pow: 2.3, color: skin },
      { y: Y(0.74), rx: hr * 0.4, rz: hr * 0.7, cz: -hr * 0.02, pow: 2.4, color: knuckleBands ? tattooC : skin },
      { y: Y(0.96), rx: hr * 0.35, rz: hr * 0.69, pow: 2.5, color: knuckleBands ? tattooC : tone(skin, 0.97) },
      { y: Y(1.08), rx: hr * 0.22, rz: hr * 0.58, pow: 2.3, color: tone(skin, 0.88) },
    ],
    skin,
    undefined,
    undefined,
    undefined,
    { capBottom: false, segments: PartBuilder.hullMode ? 6 : 8 }, // (a palm block: eight sides are plenty)
  );
  // The outline hull is drawn once and never morphs, so it must not contain anything that moves with the grip (a hull of the relaxed fingers would hang below a fist as a black ghost).
  if (PartBuilder.hullMode) return;
  // ---- fingers -----------------------------------------------------------------------------------------------------------------------------------
  const ringOn = (side === "R" && (spec.ring === 1 || spec.ring === 2 || spec.ring === 4)) || (side === "L" && (spec.ring === 3 || spec.ring === 4));
  const palmBottom = Y(0.9);
  const section = (k: number, base: number) => (t: number) => ({
    rx: hr * (0.17 - 0.04 * t) * (mitt ? 1.2 : 1),
    rz: hr * (0.16 - 0.036 * t),
    pow: 2.2,
    // (a slightly darker band at each knuckle, a paler tip)
    color: fingerless && t > 0.36 ? bare : t > 0.68 ? tone(skin, (k % 2 ? 0.94 : 1.02) * 1.06) : t < 0.1 ? tone(base, 0.82) : Math.abs(t - 0.34) < 0.05 || Math.abs(t - 0.62) < 0.05 ? tone(base, 0.92) : base,
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
    (t) => ({ rx: hr * (0.235 - 0.085 * t), rz: hr * (0.225 - 0.08 * t), pow: 2.3, color: fingerless && t > 0.5 ? bare : t > 0.7 ? tone(skin, 1.05) : skin }),
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
}

/** The plain fist used at crowd levels: a rounded palm block with a knuckle ridge. */
function fistBall(b: PartBuilder, c: BodyCtx, skin: number): void {
  const hr = c.P.handRadius;
  const wr = wristSize(c.P);
  const hy = -hr * 0.7;
  b.loft(
    [
      { y: 0.012, rx: wr.rx * 0.95, rz: wr.rz * 0.95, color: tone(skin, 0.86) },
      { y: hy + hr * 0.2, rx: hr * 1.0, rz: hr * 0.72, pow: 2.8, color: skin },
      { y: hy - hr * 0.6, rx: hr * 1.02, rz: hr * 0.78, pow: 3, color: skin },
      { y: hy - hr * 0.95, rx: hr * 0.88, rz: hr * 0.62, pow: 2.8, color: tone(skin, 0.94) },
    ],
    skin,
  );
}

/**
 * The glove's wrist, laid on the sleeve's own rings (they do not move with the grip): a leather gauntlet that flares up the forearm, a knitted band, a shaggy fur cuff. All of them
 * are offsets of the forearm's sections (limbKit `bandOn`), lifted clear of the sleeve's cuff, and their length is a fraction of the forearm, so they fit a stubby arm and a long one.
 */
export function handCuffs(b: PartBuilder, c: BodyCtx, armLength: number): void {
  const skin = handColor(c);
  const { P, spec } = c;
  const g = spec.gloves;
  if (g < 2) return;
  const rings = foreArmRings(c);
  const r = P.armRadius;
  const bottom = -armLength - CUFF_HANG;
  const over = clothLift(r) * 1.9; // clear of the sleeve's own cuff (the biggest stands 1.5 lifts proud)
  const cl = clothLift(r);
  if (g === 2 || g === 4) {
    // leather gauntlet: a flared cuff running up the wrist; gauntlets are longer and stiffer
    const long = g === 4;
    const top = bottom + Math.min(armLength * (long ? 0.55 : 0.34), long ? 0.24 : 0.14);
    const col = tone(skin, 1.12);
    bandOn(b, rings, top, bottom, col, { lift: over + cl * (long ? 1.1 : 0.7), liftBottom: over, steps: 1, colorBottom: tone(skin, 0.9), crease: true });
    if (long) {
      const y = bottom + (top - bottom) * 0.62;
      const s = ringAtY(rings, y);
      const rm = (s.rx + s.rz) / 2 + over + cl * 0.55 + 0.004;
      b.torus(rm, 0.008, c.accent, [s.cx, y, s.cz], [Math.PI / 2, 0, 0], [(s.rx + over) / ((s.rx + s.rz) / 2 + over), (s.rz + over) / ((s.rx + s.rz) / 2 + over), 1]);
    }
  } else if (g === 3) {
    // fingerless glove: a knitted wrist band
    bandOn(b, rings, bottom + Math.min(0.06, armLength * 0.2), bottom, tone(skin, 1.08), { lift: over * 0.8, liftBottom: over * 0.8, steps: 1, colorBottom: skin });
  } else if (g === 5) {
    // fur mitts: a shaggy cuff round the wrist
    const fur = singe(PALETTE.material.fur, c.burnt);
    bandOn(b, rings, bottom + Math.min(0.085, armLength * 0.28), bottom - 0.002, fur, { lift: over * 0.9, liftBottom: over * 0.9, steps: 2, bulge: cl * 1.2, colorBottom: tone(fur, 0.8) });
  }
}

function ringAtY(rings: ReturnType<typeof foreArmRings>, y: number): { rx: number; rz: number; cx: number; cz: number } {
  return ringAt(rings, y);
}
