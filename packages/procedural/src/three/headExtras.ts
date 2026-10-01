import { Euler, Quaternion, Vector3 } from "three";
import { PALETTE } from "@cb/shared";
import { type FaceCtx } from "./faceParts.ts";
import { headFit } from "./headFit.ts";
import type { V3 } from "./parts.ts";
import { curve } from "./sweep.ts";
import { tone } from "./bodyKit.ts";

/** Fine head cosmetics that sit on top of the sculpt: hair accessories, eyepatch badges and scar shapes. Everything is placed by querying the head shape. */

const _q = new Quaternion();
const _e = new Euler();
const _y = new Vector3(0, 1, 0);
const _n = new Vector3();

/** Euler angles (XYZ) that turn a primitive's +Y axis toward `n`. */
export function orient(n: V3): V3 {
  _q.setFromUnitVectors(_y, _n.set(n[0], n[1], n[2]).normalize());
  _e.setFromQuaternion(_q, "XYZ");
  return [_e.x, _e.y, _e.z];
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A local frame on the skull in direction d: the point `off` proud of the skin, the outward normal and two tangents (t1 along the skin, roughly horizontal; t2 roughly up). */
function frame(c: FaceCtx, d: V3, off: number): { p: V3; n: V3; t1: V3; t2: V3 } {
  // `off` is measured from the head AS SEEN (skin plus the hair over it), so a bow or a comb rests on the hair whatever the hairstyle and head size
  const hf = headFit(c);
  const p = hf.outer(d[0], d[1], d[2], off);
  const q = hf.outer(d[0], d[1], d[2], off + 0.05);
  const n = norm([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
  const t1 = norm(cross([0, 1, 0], n));
  const t2 = norm(cross(n, t1));
  return { p, n, t1, t2 };
}

/**
 * Hair accessories, sitting over the hair on the right side of the head (or, under a hat, low behind the ear where a brim does not cover them):
 * 1 ribbon bow, 2 tortoiseshell comb, 3 hairpins, 4 silk flower, 5 feather pin.
 */
export function buildHairAccessory(c: FaceCtx, hatOn: boolean): void {
  const { spec, b, P } = c;
  const a = spec.hairAcc;
  if (a === 0) return;
  const R = P.headRadius;
  const gold = c.accent;
  const low = hatOn;
  if (a === 1) {
    // ribbon bow: two loops, a knot and two tails
    const d: V3 = low ? [0.8, 0.02, 0.6] : [0.8, 0.52, -0.3];
    const { p, n, t1, t2 } = frame(c, d, R * 0.045);
    const red = PALETTE.trim.ribbonRed;
    const rot = orient(n);
    for (const s of [-1, 1]) {
      // a loop: a flat wedge from the knot outward, widening to a folded end
      const outer = add(p, t1, s * R * 0.24);
      b.sweep([p, add(p, t1, s * R * 0.12), outer], (t) => ({ rx: R * (0.02 + 0.085 * t), rz: R * 0.014, pow: 2.6, color: t > 0.9 ? tone(red, 0.8) : red }), red, { side: t2, segments: 4 });
      const tailEnd = add(add(p, t1, s * R * 0.12), t2, -R * 0.42);
      b.sweep(curve([p, add(add(p, t1, s * R * 0.05), t2, -R * 0.18), tailEnd], 6), (t) => ({ rx: R * (0.05 + 0.016 * t), rz: R * 0.012 }), s > 0 ? red : tone(red, 0.85), { side: t1, segments: 4 });
    }
    b.sphere(R * 0.06, tone(red, 0.7), add(p, n, R * 0.015));
  } else if (a === 2) {
    // tortoiseshell comb: an arched spine over the hair with a row of teeth, and two brass studs
    const shell = PALETTE.trim.tortoise;
    const yy = low ? 0.05 : 0.55;
    const zz = low ? 0.95 : 0.85;
    const pts: V3[] = [];
    const hf = headFit(c);
    for (let k = 0; k <= 6; k++) {
      const s = (k / 6) * 2 - 1;
      pts.push(hf.outer(s * 0.5, yy, zz, R * 0.07));
    }
    const spine = curve(pts, 12);
    b.sweep(spine, (t) => ({ rx: R * (0.15 - 0.05 * Math.abs(t * 2 - 1)), rz: R * 0.04, pow: 2.4 }), shell, { side: [0, 1, 0], segments: 6, round: "both" });
    for (let k = 0; k < 7; k++) {
      const s = (k / 6) * 2 - 1;
      const at = hf.outer(s * 0.48, yy, zz, R * 0.02);
      b.box(R * 0.045, R * 0.24, R * 0.03, tone(shell, 0.85), [at[0], at[1] - R * 0.14, at[2]]);
    }
    for (const s of [-1, 1]) b.sphere(R * 0.04, gold, hf.outer(s * 0.52, yy, zz, R * 0.11));
  } else if (a === 3) {
    // three hairpins fanned out, each a slim metal shaft with a pearl or gem head
    const heads = [PALETTE.trim.pearl, PALETTE.trim.gemRed, PALETTE.trim.pearl];
    for (let k = 0; k < 3; k++) {
      const d: V3 = low ? [0.75, 0.15 + k * 0.12, 0.65] : [0.75, 0.5 + k * 0.14, 0.05 + k * 0.28];
      // (the pin is stuck into the hair: its shaft starts at the skin and comes out through the hair)
      const lift = headFit(c).hairLift(d[0], d[1], d[2]);
      const { p, n, t2 } = frame(c, d, -lift + R * 0.01);
      const dir = low ? norm(add(n, t2, -0.75 + 0.3 * (k - 1))) : norm(add(n, t2, 0.5 * (k - 1))); // (under a hat the pins point down behind the ear, never up through the crown)
      const len = R * 0.34 + lift;
      b.cylinder(R * 0.018, R * 0.018, len, gold, add(p, dir, len * 0.5), orient(dir));
      b.sphere(R * 0.06, heads[k]!, add(p, dir, len + R * 0.02));
    }
  } else if (a === 4) {
    // silk flower: a ring of petals round a gold heart, with two leaves
    const d: V3 = low ? [0.8, 0.05, 0.6] : [0.8, 0.5, -0.32];
    const { p, n, t1, t2 } = frame(c, d, R * 0.03);
    const petals = 6;
    for (let k = 0; k < petals; k++) {
      const ang = (k / petals) * Math.PI * 2;
      const at = add(add(p, t1, Math.cos(ang) * R * 0.11), t2, Math.sin(ang) * R * 0.11);
      b.sphere(R * 0.085, k % 2 ? tone(PALETTE.trim.blossom, 0.9) : PALETTE.trim.blossom, at, [1, 0.7, 1], orient(n));
    }
    b.sphere(R * 0.06, gold, add(p, n, R * 0.04));
    for (const s of [-1, 1]) {
      const root = add(p, t1, s * R * 0.1);
      const dir = norm(add(add(t1, t2, -0.35), n, 0.15));
      b.cone(R * 0.05, R * 0.26, PALETTE.trim.ribbonGreen, add(root, [dir[0] * s, dir[1], dir[2]], R * 0.14), orient([dir[0] * s, dir[1], dir[2]]));
    }
  } else if (a >= 6 && a <= 9) {
    // the fictional peoples' hair ornaments (D-038): copper rings, bone pins, glass beads, herd-tags. Bare-headed they hang at the side of the head; under a hat, low behind the ear.
    const d: V3 = low ? [0.82, 0.02, 0.58] : [0.84, 0.28, 0.12];
    const { p, n, t1, t2 } = frame(c, d, R * 0.02);
    if (a === 6) {
      // copper rings: three small rings strung one below another on a lock
      for (let k = 0; k < 3; k++) b.torus(R * (0.075 - 0.008 * k), R * 0.022, PALETTE.trim.bronze, add(add(p, t2, -R * 0.15 * k), n, R * 0.03), orient(t1));
    } else if (a === 7) {
      // bone pins: two long pins crossed through the hair, ivory
      for (const sgn of [-1, 1]) {
        const dir = norm(add(add(t1, t2, sgn * 0.7), n, 0.15));
        const len = R * 0.62;
        b.cylinder(R * 0.02, R * 0.02, len, PALETTE.trim.ivory, add(add(p, n, R * 0.02), dir, len * 0.45), orient(dir));
        b.sphere(R * 0.04, PALETTE.trim.ivory, add(add(p, n, R * 0.02), dir, len * 0.95));
      }
    } else if (a === 8) {
      // glass beads: a short cord of five beads hanging from the temple
      const cols = [PALETTE.trim.visorGlass, PALETTE.trim.pearl, PALETTE.trim.gemGreen, PALETTE.trim.visorGlass, PALETTE.trim.pearl];
      for (let k = 0; k < 5; k++) b.sphere(R * (0.045 + 0.006 * (k % 2)), cols[k]!, add(add(p, t2, -R * 0.12 * k), n, R * 0.03));
    } else {
      // herd-tags: three small brass tags on a cord, one for each herd the family keeps
      b.cylinder(R * 0.012, R * 0.012, R * 0.5, PALETTE.material.rope, add(add(p, t2, -R * 0.22), n, R * 0.02), orient(t2));
      for (let k = 0; k < 3; k++) b.box(R * 0.1, R * 0.13, R * 0.02, gold, add(add(p, t2, -R * (0.14 + 0.15 * k)), n, R * 0.045), orient(n));
    }
  } else {
    // feather pin: a brass pin head and a long curved quill sweeping up and back
    const d: V3 = low ? [0.8, 0.1, 0.6] : [0.85, 0.5, 0.05];
    const { p, n, t1, t2 } = frame(c, d, R * 0.02);
    b.sphere(R * 0.05, gold, add(p, n, R * 0.008));
    // (bare-headed: up and back; under a hat it hangs down behind the ear instead, so nothing pokes through the crown)
    const up = low ? -1 : 1;
    const tip = low ? add(add(add(p, t2, up * R * 0.6), n, R * 0.22), [0, 0, 1], R * 0.1) : add(add(add(add(p, t2, R * 0.75), t1, R * 0.08), n, R * 0.3), [0, 0, 1], R * 0.4);
    const mid = low ? add(add(add(p, t2, up * R * 0.3), n, R * 0.2), [0, 0, 1], R * 0.05) : add(add(add(add(p, t2, R * 0.38), n, R * 0.24), t1, R * 0.04), [0, 0, 1], R * 0.12);
    const green = PALETTE.trim.featherGreen;
    b.sweep(curve([p, mid, tip], 10), (t) => ({ rx: R * 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.08)), rz: R * 0.012, pow: 2.2, color: t < 0.12 ? PALETTE.trim.ivory : t > 0.75 ? tone(green, 1.2) : green }), green, { side: t1, segments: 4, round: "end" });
  }
}

/** The badge or wrap on an eyepatch, centred on the patch (`sx` side, eye centre `ex`/`ey`, patch face at `z`, eyeball radius `er`). Style 0 is the plain patch. */
export function buildPatchDecor(c: FaceCtx, sx: number, ex: number, ey: number, z: number, er: number): void {
  const { spec, b } = c;
  const style = spec.patchStyle;
  if (style === 1) {
    // a skull badge: ivory skull and crossed bones stitched on the patch
    const ivory = PALETTE.trim.ivory;
    b.sphere(er * 0.42, ivory, [sx * ex, ey + er * 0.1, z - er * 0.05], [1, 1, 0.5]);
    b.box(er * 0.5, er * 0.2, er * 0.14, ivory, [sx * ex, ey - er * 0.32, z - er * 0.02]);
    for (const s of [-1, 1]) b.box(er * 1.4, er * 0.13, er * 0.1, ivory, [sx * ex, ey - er * 0.1, z], [0, 0, s * 0.62]);
    for (const s of [-1, 1]) b.sphere(er * 0.09, PALETTE.ink, [sx * ex + s * er * 0.16, ey + er * 0.12, z - er * 0.2]);
  } else if (style === 2) {
    // a bandage: a linen pad with a strip across it and a knot at the temple
    const linen = PALETTE.material.linen;
    b.sphere(er * 1.5, linen, [sx * ex, ey, z + er * 0.05], [1, 1, 0.3]);
    b.box(er * 3.2, er * 0.5, er * 0.16, tone(linen, 0.9), [sx * ex, ey, z - er * 0.16], [0, 0, -0.6]);
    b.sphere(er * 0.32, tone(linen, 0.8), [sx * ex + sx * er * 1.3, ey + er * 0.7, z + er * 0.3], [1, 1, 0.7]);
  } else if (style === 3) {
    // a jewelled patch: a brass rim and a red stone
    b.torus(er * 1.0, er * 0.13, c.accent, [sx * ex, ey, z - er * 0.02], [0, 0, 0]);
    b.sphere(er * 0.42, PALETTE.trim.gemRed, [sx * ex, ey, z - er * 0.1], [1, 1, 0.6]);
    for (const s of [-1, 1]) b.sphere(er * 0.13, c.accent, [sx * ex + s * er * 0.9, ey, z - er * 0.04]);
  }
}

export type V2 = readonly [number, number];

/**
 * A scar's path in the chosen style, as one or more polylines in head units (x R, y R): 0 straight, 1 jagged (zig-zag), 2 stitched (the same line plus
 * the stitch points, returned separately), 3 forked (a branch off the middle). Deterministic.
 */
export function scarPaths(style: number, pts: readonly V2[]): { welts: V2[][]; stitches: { at: V2; angle: number }[] } {
  const welts: V2[][] = [[...pts]];
  const stitches: { at: V2; angle: number }[] = [];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const at = (t: number): V2 => {
    const f = t * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const k = f - i;
    return [pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * k, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * k];
  };
  if (style === 1) {
    const out: V2[] = [];
    const n = 7;
    for (let k = 0; k <= n; k++) {
      const p = at(k / n);
      const j = k === 0 || k === n ? 0 : (k % 2 ? 1 : -1) * len * 0.11;
      out.push([p[0] - uy * j, p[1] + ux * j]);
    }
    welts[0] = out;
  } else if (style === 2) {
    for (let k = 1; k <= 5; k++) {
      const p = at(k / 6);
      stitches.push({ at: p, angle: Math.atan2(ux, -uy) });
    }
  } else if (style === 3) {
    const m = at(0.5);
    const ang = 0.7;
    const bx = ux * Math.cos(ang) - uy * Math.sin(ang);
    const by = ux * Math.sin(ang) + uy * Math.cos(ang);
    welts.push([m, [m[0] + bx * len * 0.3, m[1] + by * len * 0.3], [m[0] + bx * len * 0.55, m[1] + by * len * 0.55]]);
  }
  return { welts, stitches };
}
