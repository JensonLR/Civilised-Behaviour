import type { BufferGeometry } from "three";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import { LEATHER, PartBuilder, singe } from "./parts.ts";

export interface HeadColors {
  skin: number;
  hairC: number;
  hatC: number;
  accent: number;
  burnt: number;
}

/**
 * Geometry of the two head volumes, relative to the head CENTRE (the head group's origin is at the neck, R below it).
 * Every face feature (mouth, moustache, beard, glasses) is placed against these so nothing ends up buried in the jaw.
 */
export function faceSurfaceZ(P: Proportions, y: number, x = 0): number {
  const R = P.headRadius;
  // Skull ellipsoid (semi-axes R, 1.02R, R) and jaw ellipsoid; the face is whichever sticks out further at (x, y).
  const skull = -Math.sqrt(Math.max(0, R * R * (1 - (y / (1.02 * R)) ** 2) - x * x));
  const jr = R * 0.78 * Math.sqrt(P.jawSize);
  const ax = jr * P.jawSize ** 0.4;
  const ay = jr * 0.75;
  const az = jr * 0.95;
  const dy = y + R * 0.55;
  const jaw = -R * 0.28 - az * Math.sqrt(Math.max(0, 1 - (x / ax) ** 2 - (dy / ay) ** 2));
  return Math.min(skull, jaw);
}

/** Where the animated mouth sits (relative to head centre): just proud of the real face surface. */
export function mouthPlacement(P: Proportions): { y: number; z: number } {
  const y = -P.headRadius * 0.47;
  return { y, z: faceSurfaceZ(P, y) - P.headRadius * 0.03 };
}

export function buildHead(spec: CharacterSpec, P: Proportions, c: HeadColors): BufferGeometry | undefined {
  const R = P.headRadius;
  const b = new PartBuilder();
  const { skin, hairC, hatC, accent, burnt } = c;
  const cy = R; // head centre above the neck joint
  const nose = P.noseLength;
  const surf = (yRel: number, x = 0): number => faceSurfaceZ(P, yRel, x);
  const jr = R * 0.78 * Math.sqrt(P.jawSize);

  // ---- skull, jaw, cheeks, neck, ears -------------------------------------------------------------------------
  b.sphere(R, skin, [0, cy, 0], [1, 1.02, 1.0]);
  b.sphere(jr, skin, [0, cy - R * 0.55, -R * 0.28], [P.jawSize ** 0.4, 0.75, 0.95]);
  b.sphere(R * 0.28, skin, [-R * 0.55, cy - R * 0.25, -R * 0.55]);
  b.sphere(R * 0.28, skin, [R * 0.55, cy - R * 0.25, -R * 0.55]);
  b.cylinder(R * 0.42, R * 0.5, P.neck * 2 + 0.06, skin, [0, 0.0, 0]);
  const es = P.earSize;
  b.sphere(es, skin, [-R * 0.98, cy, 0], [0.45, 1.25, 0.9]);
  b.sphere(es, skin, [R * 0.98, cy, 0], [0.45, 1.25, 0.9]);
  // brow ridge: a subtle heavy brow makes the eyes read as set back under it
  b.sphere(R * 0.5, skin, [-R * 0.38, cy + R * 0.3, -R * 0.78], [1, 0.32, 0.55]);
  b.sphere(R * 0.5, skin, [R * 0.38, cy + R * 0.3, -R * 0.78], [1, 0.32, 0.55]);

  // ---- nose ------------------------------------------------------------------------------------------------------------
  const nz = -R * 0.95;
  const ny = cy - R * 0.24; // below the eye line so the nose never swallows the eyes
  // Width is capped relative to the head while length is free: a caricature nose sticks OUT, it does not blot out the mouth.
  const nw = Math.min(nose, R * 0.5);
  const stretch = (r: number): number => Math.max(1, Math.min(3.2, (nose * 0.9) / r));
  switch (spec.noseStyle) {
    case 0: b.sphere(nw * 0.45, skin, [0, ny, nz], [1, 1, 0.9 * stretch(nw * 0.45) ** 0.5]); break; // button
    case 1: b.cone(nw * 0.32, nose * 1.4, skin, [0, ny + nose * 0.05, nz - nose * 0.4], [-Math.PI / 2 - 0.35, 0, 0]); b.sphere(nw * 0.22, skin, [0, ny - nose * 0.3, nz - nose * 0.9]); break; // hooked
    case 2: b.sphere(nw * 0.62, skin, [0, ny - nw * 0.05, nz - nose * 0.25], [1.05, 1, stretch(nw * 0.62)]); break; // bulb
    case 3: b.cylinder(nw * 0.2, nw * 0.32, nose * 1.8, skin, [0, ny - nose * 0.3, nz - nose * 0.4], [-Math.PI / 2 + 0.15, 0, 0]); b.sphere(nw * 0.32, skin, [0, ny - nose * 0.35, nz - nose * 1.3]); break; // long
    case 4: b.sphere(nw * 0.5, skin, [0, ny, nz + nose * 0.05], [1.5, 0.8, 0.7 * stretch(nw * 0.5) ** 0.5]); break; // flat
    default: b.sphere(nw * 0.55, skin, [0, ny - nw * 0.05, nz - nose * 0.15], [1, 1, stretch(nw * 0.55) ** 0.7]); b.sphere(nw * 0.28, 0xc4574a, [0, ny - nw * 0.12, nz - nose * 0.6]); break; // ruddy lump
  }

  // ---- hair (styles hug the skull; the front hairline stays clear of the brow) ---------------------------------------------------
  const hairY = cy + R * 0.1;
  const hatOn = spec.hat !== 0; // hair volume above the brow is suppressed under a hat so it cannot poke through the crown
  const cap = (scaleY: number, dy = 0, dz = 0.05): void => void b.sphere(R * 1.05, hairC, [0, hairY + dy, R * dz], [1, scaleY, 1.02]);
  switch (spec.hair) {
    case 1: cap(0.72, R * 0.08); b.box(R * 0.9, R * 0.08, R * 0.3, hairC, [-R * 0.25, cy + R * 0.82, -R * 0.55], [0.1, 0, 0.25]); break; // side part
    case 2: // wild tufts
      for (let i = 0; i < (hatOn ? 0 : 9); i++) { const a = (i / 9) * Math.PI * 2; b.cone(R * 0.16, R * 0.5, hairC, [Math.cos(a) * R * 0.75, cy + R * 0.7 + (i % 2) * R * 0.1, Math.sin(a) * R * 0.75], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]); }
      b.sphere(R * 1.02, hairC, [0, cy + R * 0.18, R * 0.05], [1, 0.6, 1.02]);
      break;
    case 3: { // curls: sides, back and (hatless) crown only - never a row of pearls across the brow
      b.sphere(R * 1.0, hairC, [0, cy + R * 0.2, R * 0.08], [1, 0.62, 1.0]);
      for (let i = 0; i < 11; i++) {
        const th = -2.3 + (i / 10) * 4.6; // 0 = straight behind (+z); +-pi = the front. +-2.3 rad stops short of the brow.
        b.sphere(R * 0.24, hairC, [Math.sin(th) * R * 0.9, cy + R * (0.3 + (i % 3) * 0.1), Math.cos(th) * R * 0.9]);
      }
      if (!hatOn) for (let i = 0; i < 5; i++) b.sphere(R * 0.26, hairC, [Math.cos(i * 1.26) * R * 0.42, cy + R * 0.98, Math.sin(i * 1.26) * R * 0.42 + R * 0.1]);
      break;
    }
    case 4: cap(0.66, R * 0.05, 0.06); break; // slicked
    case 5: // receding: sides and back only
      b.sphere(R * 1.0, hairC, [-R * 0.62, cy + R * 0.15, R * 0.2], [0.35, 0.55, 0.8]);
      b.sphere(R * 1.0, hairC, [R * 0.62, cy + R * 0.15, R * 0.2], [0.35, 0.55, 0.8]);
      b.sphere(R * 1.0, hairC, [0, cy + R * 0.1, R * 0.6], [0.9, 0.55, 0.4]);
      break;
    case 6: cap(0.62, R * 0.05); if (!hatOn) { b.sphere(R * 0.3, hairC, [0, cy + R * 1.05, 0]); b.sphere(R * 0.14, hairC, [0, cy + R * 1.3, 0]); } break; // top knot
    case 7: cap(0.78, R * 0.1, 0.02); b.box(R * 1.55, R * 0.2, R * 0.3, hairC, [0, cy + R * 0.58, -R * 0.8], [0.15, 0, 0]); break; // bowl cut with a blunt fringe
    case 8: { // long lank: curtains to the shoulders
      cap(0.74, R * 0.08);
      for (const sx of [-1, 1]) {
        b.cylinder(R * 0.13, R * 0.08, R * 1.5, hairC, [sx * R * 0.96, cy - R * 0.2, R * 0.12], [0, 0, sx * 0.05]);
        b.sphere(R * 0.14, hairC, [sx * R * 0.97, cy - R * 0.95, R * 0.13], [1, 0.8, 1]);
      }
      b.sphere(R * 0.98, hairC, [0, cy - R * 0.2, R * 0.72], [1.02, 1.35, 0.42]); // soft curtain behind the head, not a slab
      break;
    }
    case 9: cap(0.7, R * 0.05); if (!hatOn) b.sphere(R * 0.5, hairC, [0, cy + R * 0.98, -R * 0.3], [1.5, 0.8, 1.1], [0.4, 0, 0]); break; // pompadour
    default: break; // bald
  }
  const sb = [0, 0.16, 0.26, 0.32][spec.sideburns] ?? 0;
  if (sb > 0) for (const sx of [-1, 1]) b.sphere(R * sb, hairC, [sx * R * 0.9, cy - R * 0.15, -R * 0.2], [0.55, 1.6 + sb * 2, 0.8]);

  // ---- beard: shells that sit OUTSIDE the jaw and start below the mouth so the mouth stays visible --------------------------------------
  const chinY = -R * 0.98;
  const jawFrontZ = surf(-R * 0.8);
  switch (spec.beard) {
    case 1: b.sphere(jr * 1.12, hairC, [0, cy - R * 1.12, -R * 0.2], [P.jawSize ** 0.4 * 1.05, 0.72, 0.98]); break; // full: starts below the lip line
    case 2: b.sphere(R * 0.26, hairC, [0, cy + chinY * 0.98, jawFrontZ - R * 0.02]); break; // chin puff
    case 3: b.cone(R * 0.22, R * 0.6, hairC, [0, cy + chinY * 1.05, jawFrontZ - R * 0.05], [Math.PI, 0, 0]); break; // goatee
    case 4: // mutton beard: cheeks + chin, mouth left open
      for (const sx of [-1, 1]) b.sphere(R * 0.46, hairC, [sx * R * 0.66, cy - R * 0.5, -R * 0.2], [0.65, 1.2, 0.9]);
      b.sphere(R * 0.36, hairC, [0, cy + chinY, jawFrontZ]);
      break;
    case 5: b.cone(R * 0.5, R * 0.9, hairC, [0, cy + chinY * 1.2, jawFrontZ], [Math.PI, 0, 0], [1.1, 1, 0.8]); break; // spade: apex down, base under the mouth
    case 6: // wizard: a jaw shell melting into stacked, narrowing lobes so it reads as one flowing mass (a single cone showed a flat rim)
      b.sphere(jr * 1.08, hairC, [0, cy - R * 1.05, -R * 0.15], [P.jawSize ** 0.4, 0.8, 0.98]);
      b.sphere(R * 0.5, hairC, [0, cy - R * 1.55, jawFrontZ + R * 0.1], [1, 1.5, 0.7]);
      b.sphere(R * 0.32, hairC, [0, cy - R * 2.2, jawFrontZ + R * 0.12], [0.9, 1.9, 0.6]);
      b.sphere(R * 0.16, hairC, [0, cy - R * 2.8, jawFrontZ + R * 0.12], [0.8, 2, 0.6]);
      break;
    case 7: b.torus(jr * 0.98, R * 0.14, hairC, [0, cy - R * 0.72, -R * 0.24], [Math.PI / 2, 0, Math.PI * 0.925], [P.jawSize ** 0.4, 0.95, 1], Math.PI * 1.15); break; // neck fringe (chin strap): arc centred on the FRONT (in-plane spin is applied before the tilt)
    default: break;
  }

  // ---- moustache: just under the nose, on the actual lip line -------------------------------------------------------------------
  const my = -R * 0.33;
  const mY = cy + my;
  const lipOff = R * 0.04 + nose * 0.08;
  // z of a moustache piece centred at horizontal offset x: hugs the curved face instead of floating at the centre-line depth
  const mzAt = (x: number, dy = 0): number => surf(my + dy, x) - lipOff;
  switch (spec.moustache) {
    case 1: // handlebar: a bar that follows the cheek round, ending in a curl ring standing proud of the face
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const x = sx * R * (0.12 + k * 0.17);
          b.sphere(R * (0.09 - k * 0.012), hairC, [x, mY + R * (0.02 + k * 0.025), mzAt(x)], [1.5, 0.85, 0.9]);
        }
        const tx = sx * R * 0.62;
        b.torus(R * 0.1, R * 0.04, hairC, [tx, mY + R * 0.14, mzAt(tx) - R * 0.02], [0, 0, 0]);
      }
      break;
    case 2: for (const sx of [-1, 1]) { const x = sx * R * 0.24; b.sphere(R * 0.3, hairC, [x, mY - R * 0.05, mzAt(x)], [1.15, 0.9, 0.6]); const x2 = sx * R * 0.44; b.sphere(R * 0.16, hairC, [x2, mY - R * 0.24, mzAt(x2, -0.24 * 1) + 0.01], [0.7, 1.4, 0.6]); } break; // walrus
    case 3: b.box(R * 0.6, R * 0.05, R * 0.06, hairC, [0, mY + R * 0.03, mzAt(0)]); break; // pencil
    case 4: b.box(R * 0.24, R * 0.09, R * 0.07, hairC, [0, mY + R * 0.02, mzAt(0)]); break; // toothbrush
    case 5: for (const sx of [-1, 1]) { const x = sx * R * 0.18; b.sphere(R * 0.16, hairC, [x, mY, mzAt(x)], [1.2, 0.7, 0.6]); const x2 = sx * R * 0.55; b.cone(R * 0.05, R * 0.4, hairC, [x2, mY + R * 0.1, mzAt(x2)], [0, 0, -sx * (Math.PI / 2 - 0.5)]); } break; // imperial
    case 6: b.box(R * 0.55, R * 0.08, R * 0.07, hairC, [0, mY, mzAt(0)]); for (const sx of [-1, 1]) { const x = sx * R * 0.3; b.box(R * 0.07, R * 0.45, R * 0.07, hairC, [x, mY - R * 0.24, mzAt(x, -0.24)]); } break; // horseshoe
    case 7: for (let i = -3; i <= 3; i++) { const x = i * R * 0.13; b.sphere(R * 0.11, hairC, [x, mY - Math.abs(i) * R * 0.01, mzAt(x)], [0.8, 1.6, 0.6]); } break; // magnificent fringe
    case 8: { // waxed tips: a neat bar with two long needle points swept up
      b.box(R * 0.5, R * 0.06, R * 0.07, hairC, [0, mY + R * 0.02, mzAt(0)]);
      for (const sx of [-1, 1]) { const x = sx * R * 0.55; b.cone(R * 0.045, R * 0.85, hairC, [x, mY + R * 0.24, mzAt(x) - R * 0.02], [0, 0, -sx * (Math.PI / 2 - 0.85)]); }
      break;
    }
    case 9: // soup strainer: huge, drooping over the mouth and chin
      for (const sx of [-1, 1]) { const x = sx * R * 0.26; b.sphere(R * 0.34, hairC, [x, mY - R * 0.02, mzAt(x)], [1.2, 0.8, 0.65]); const x2 = sx * R * 0.46; b.sphere(R * 0.24, hairC, [x2, mY - R * 0.3, mzAt(x2, -0.3) + 0.005], [0.8, 1.9, 0.6]); }
      break;
    default: break;
  }

  // ---- eyewear -------------------------------------------------------------------------------------------------------------------
  const ey = cy + R * 0.1;
  const ex = R * 0.4;
  const ez = -R * 0.98;
  switch (spec.eyewear) {
    case 1: b.torus(R * 0.24, R * 0.02, accent, [ex, ey, ez], [0, 0, 0]); b.cylinder(0.004, 0.004, R * 0.9, accent, [ex + R * 0.14, ey - R * 0.5, ez + 0.02], [0, 0, 0.2]); break;
    case 2: for (const sx of [-1, 1]) b.torus(R * 0.22, R * 0.02, 0x2a2018, [sx * ex, ey, ez]); b.box(R * 0.2, R * 0.03, R * 0.03, 0x2a2018, [0, ey, ez]); for (const sx of [-1, 1]) b.box(R * 0.03, R * 0.03, R * 0.95, 0x2a2018, [sx * R * 0.83, ey, ez + R * 0.5]); break;
    case 3: for (const sx of [-1, 1]) b.cylinder(R * 0.26, R * 0.26, R * 0.16, 0x4a3a2a, [sx * ex, ey, ez - 0.005], [Math.PI / 2, 0, 0]); b.torus(R * 1.0, R * 0.05, LEATHER, [0, ey, 0], [Math.PI / 2, 0, 0]); break;
    case 4: for (const sx of [-1, 1]) b.torus(R * 0.14, R * 0.015, accent, [sx * R * 0.2, ey - R * 0.14, ez - R * 0.02]); b.box(R * 0.14, R * 0.02, R * 0.02, accent, [0, ey - R * 0.1, ez - R * 0.02]); break;
    default: break;
  }
  if (spec.eyepatch > 0) {
    const sx = spec.eyepatch === 1 ? -1 : 1;
    b.sphere(R * 0.27, 0x14100c, [sx * ex, ey, ez + R * 0.02], [1, 1, 0.35]);
    b.torus(R * 1.0, R * 0.025, 0x14100c, [0, ey + R * 0.08, 0], [Math.PI / 2 + 0.25 * sx, 0.1 * sx, 0]);
  }

  // ---- scars (thin raised welts) ---------------------------------------------------------------------------------------------------------
  const sc = spec.scars;
  const scarC = 0x9a4a4a;
  if (sc & 1) b.box(R * 0.35, R * 0.03, R * 0.03, scarC, [R * 0.62, cy - R * 0.28, -R * 0.72], [0, 0.6, -0.5]);
  if (sc & 2) b.box(R * 0.03, R * 0.3, R * 0.03, scarC, [-R * 0.38, cy + R * 0.42, -R * 0.9], [0, 0, 0.2]);
  if (sc & 4) b.box(R * 0.25, R * 0.03, R * 0.03, scarC, [-R * 0.1, cy - R * 0.88, -R * 0.6], [0.5, 0, 0.3]);
  if (sc & 8) b.box(R * 0.4, R * 0.03, R * 0.03, scarC, [0, -R * 0.1, -R * 0.4], [0, 0, 0.5]);
  if (sc & 16) b.box(R * 0.4, R * 0.03, R * 0.03, scarC, [R * 0.1, cy + R * 0.7, -R * 0.68], [0.3, 0, -0.2]);

  // ---- hats (every hat gets a band or trim so it reads as made, not as a primitive) -----------------------------------------------------
  const hy = cy + R * 0.78;
  const band = (radius: number, y: number, color = accent): void => void b.torus(radius, R * 0.04, color, [0, y, 0], [Math.PI / 2, 0, 0]);
  switch (spec.hat) {
    case 1: // top hat: tapered crown, flat brim with an upturned edge, band
      b.cylinder(R * 0.6, R * 0.68, R * 1.15, hatC, [0, hy + R * 0.52, 0]);
      b.cylinder(R * 0.6, R * 0.6, R * 0.03, hatC, [0, hy + R * 1.1, 0]);
      b.cylinder(R * 1.08, R * 1.05, R * 0.06, hatC, [0, hy - R * 0.02, 0]);
      b.torus(R * 1.07, R * 0.035, hatC, [0, hy + R * 0.01, 0], [Math.PI / 2, 0, 0]);
      band(R * 0.68, hy + R * 0.16, singe(0x1c1c22, burnt));
      break;
    case 2: // bowler: dome, rolled brim, band
      b.sphere(R * 0.8, hatC, [0, hy + R * 0.02, 0], [1, 0.86, 1.02]);
      b.cylinder(R * 1.02, R * 1.0, R * 0.05, hatC, [0, hy - R * 0.08, 0]);
      b.torus(R * 1.0, R * 0.04, hatC, [0, hy - R * 0.06, 0], [Math.PI / 2, 0, 0]);
      band(R * 0.8, hy + R * 0.0, singe(0x1c1c22, burnt));
      break;
    case 3: // pith helmet: broad dome, ridged brim all round, band, knob
      b.sphere(R * 1.12, hatC, [0, hy + R * 0.02, 0], [1, 0.62, 1.05]);
      b.cylinder(R * 1.3, R * 1.28, R * 0.05, hatC, [0, hy - R * 0.14, 0]);
      b.torus(R * 1.28, R * 0.04, hatC, [0, hy - R * 0.13, 0], [Math.PI / 2, 0, 0]);
      band(R * 1.06, hy - R * 0.1, singe(0xd9d0b8, burnt));
      b.sphere(R * 0.1, accent, [0, hy + R * 0.66, 0]);
      break;
    case 4: // shako: tall, flared crown, peak, cord and spike
      b.cylinder(R * 0.7, R * 0.85, R * 1.15, hatC, [0, hy + R * 0.5, 0]);
      b.box(R * 1.0, R * 0.05, R * 0.6, hatC, [0, hy - R * 0.02, -R * 0.75]);
      b.torus(R * 0.86, R * 0.035, accent, [0, hy + R * 0.16, 0], [Math.PI / 2, 0, 0]);
      b.cone(R * 0.16, R * 0.7, singe(0xd9d0b8, burnt), [0, hy + R * 1.3, 0]);
      break;
    case 5: // bicorne: wide crescent worn sideways with a cockade
      b.sphere(R * 1.0, hatC, [0, hy + R * 0.2, 0], [1.8, 0.5, 0.8], [0, 0, 0.06]);
      b.torus(R * 0.9, R * 0.05, accent, [0, hy + R * 0.02, 0], [Math.PI / 2, 0, 0], [1.9, 0.8, 1]);
      b.sphere(R * 0.14, accent, [R * 1.2, hy + R * 0.25, 0]);
      break;
    case 6: // slouch hat: soft dome, wide drooping brim, band
      b.sphere(R * 0.88, hatC, [0, hy + R * 0.18, 0], [1, 0.62, 1]);
      b.cylinder(R * 1.55, R * 1.55, R * 0.04, hatC, [0, hy - R * 0.06, 0], [0.12, 0, 0.06]);
      band(R * 0.86, hy + R * 0.06, singe(0x2a1c14, burnt));
      break;
    case 7: // peaked cap: low crown, visor, badge
      b.cylinder(R * 0.95, R * 1.0, R * 0.36, hatC, [0, hy + R * 0.05, 0]);
      b.box(R * 1.0, R * 0.04, R * 0.45, LEATHER, [0, hy - R * 0.1, -R * 0.95]);
      b.sphere(R * 0.1, accent, [0, hy + R * 0.02, -R * 0.98]);
      band(R * 1.0, hy - R * 0.07, singe(0x1c1c22, burnt));
      break;
    case 8: // flat cap: squashed dome with a short peak
      b.sphere(R * 1.06, hatC, [0, hy + R * 0.06, R * 0.04], [1.05, 0.4, 1.1]);
      b.box(R * 0.8, R * 0.05, R * 0.4, hatC, [0, hy - R * 0.02, -R * 1.02], [0.15, 0, 0]);
      b.sphere(R * 0.07, accent, [0, hy + R * 0.2, 0]);
      break;
    case 9: // plumed helmet: polished dome, crest ridge, swept plume
      b.sphere(R * 1.04, accent, [0, hy + R * 0.05, 0], [1, 0.9, 1.04]);
      b.cylinder(R * 1.1, R * 1.1, R * 0.05, accent, [0, hy - R * 0.06, 0]);
      b.box(R * 0.09, R * 0.14, R * 1.5, singe(0x8a2a2a, burnt), [0, hy + R * 0.9, R * 0.05]);
      for (let i = 0; i < 4; i++) b.cone(R * 0.16, R * 0.75, singe(0xb43a3a, burnt), [0, hy + R * (0.95 - i * 0.05), R * (0.4 + i * 0.32)], [Math.PI / 2 + 0.25 * i, 0, 0]);
      break;
    case 10: // boater: flat-topped straw crown, stiff flat brim, striped band
      b.cylinder(R * 0.7, R * 0.72, R * 0.5, singe(0xd9c48a, burnt), [0, hy + R * 0.24, 0]);
      b.cylinder(R * 1.15, R * 1.15, R * 0.04, singe(0xd9c48a, burnt), [0, hy - R * 0.02, 0]);
      b.cylinder(R * 0.73, R * 0.73, R * 0.14, singe(0x8f2d22, burnt), [0, hy + R * 0.1, 0]);
      break;
    default: break;
  }
  return b.build();
}
