import { PALETTE } from "@cb/shared";
import { onSkin, type FaceCtx } from "./faceParts.ts";
import { ringAtAz, type HeadFit } from "./headFit.ts";
import { buildPatchDecor } from "./headExtras.ts";
import { LEATHER, type V3 } from "./parts.ts";
import { curve } from "./sweep.ts";
import { smooth } from "./shell.ts";
import { singe } from "./parts.ts";
import { tone } from "./bodyKit.ts";

/**
 * Eyewear and the eyepatch, fitted to the head. Nothing here is placed by an absolute offset:
 *  - the lenses sit on the eyes (`eye`), the bridge arches over the REAL nose (`HeadFit.nose().frontZ`) whatever its style, and nose pads rest on its flanks;
 *  - a spectacle arm runs back along the temple on the head as it is (skin + hair, `HeadFit.outer`) and ends over the top of the ear that was actually built (`HeadFit.ear`),
 *    for any ear size, head size or hairstyle, with a small hook behind the ear;
 *  - a strap goes round the head over the hair (never in it), rises over the ear instead of through it, and stays below the band of a hat.
 */

export interface EyeSpot {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface EyewearOpts {
  hatOn: boolean;
  seatY: number;
  burnt: number;
}

export function buildEyewear(fc: FaceCtx, hf: HeadFit, eye: EyeSpot, o: EyewearOpts): void {
  const { spec, P, b, cy, accent } = fc;
  const R = P.headRadius;
  const ex = eye.x;
  const ey = cy + eye.y;
  const glassZ = eye.z - eye.radius * 1.12; // just in front of the eyeball
  /** The lens plane: in front of the eye, and in front of the most forward point of the skin under the rim (brow, cheekbone), so a rim never sinks into the face. */
  const zFor = (r: number, clear = R * 0.03, x0 = ex, y0 = eye.y): number => {
    let z = glassZ;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = fc.shape.front(x0 + Math.cos(a) * r, y0 + Math.sin(a) * r);
      if (p[2] < -1e-9) z = Math.min(z, p[2] - clear);
    }
    return z;
  };
  let gz = glassZ;
  const nose = hf.nose();
  const bridgeAt = (yRelR: number): number => nose.frontZ(yRelR * R) - R * 0.024; // the top of the nose (height in R units), a hair off
  const eyeR = eye.y / R;

  /** Direction from the head centre at azimuth az (radians from the face, signed by sx) and height y (x R). */
  const dir = (sx: number, az: number, yR: number): V3 => {
    const yu = Math.max(-0.95, Math.min(0.95, yR));
    const k = Math.sqrt(1 - yu * yu);
    return [sx * Math.sin(az) * k, yu, -Math.cos(az) * k];
  };
  const ears = [hf.ear(1), hf.ear(-1)];
  const earTopR = (ears[0]!.top[1] - cy) / R;
  const earAzF = Math.atan2(Math.abs(ears[0]!.front[0]), -ears[0]!.front[2]);
  const earAzB = Math.atan2(Math.abs(ears[0]!.outer[0]), -(ears[0]!.back[2]));
  /** Height (x R) at azimuth az that clears the ear (over its top) and, under a hat, stays below the band. */
  const overEar = (az: number, yR: number): number => {
    const d = az < earAzF ? earAzF - az : az > earAzB ? az - earAzB : 0;
    const w = 1 - smooth(0, 0.55, d);
    const y = Math.max(yR, (earTopR + 0.09) * w + yR * (1 - w));
    return o.hatOn ? Math.min(y, o.seatY - 0.1) : y;
  };
  const glassR = (k: number): number => eye.radius * k;
  /** A point on the head as seen (skin + hair), `off` metres out. */
  const on = (sx: number, az: number, yR: number, off: number): V3 => {
    const d = dir(sx, az, yR);
    return hf.outer(d[0], d[1], d[2], off);
  };

  // ---- spectacle arms: from the hinge along the temple over the top of the ear, hooking behind it -----------------------------------------------------
  const arm = (sx: 1 | -1, hinge: V3, color: number, rx: number, rz: number, yStartR: number): void => {
    const ea = hf.ear(sx);
    const azTop = Math.atan2(Math.abs(ea.top[0]), -ea.top[2]);
    const az0 = 0.75;
    const az1 = Math.max(az0 + 0.3, azTop - 0.1);
    const pts: V3[] = [hinge];
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const az = az0 + (az1 - az0) * t;
      const yR = yStartR + ((ea.top[1] - cy) / R - yStartR) * smooth(0.25, 1, t);
      pts.push(on(sx, az, yR, rz + R * 0.01));
    }
    const over: V3 = [ea.top[0], ea.top[1] + rz * 0.7, ea.top[2] - ea.size * 0.1];
    const behind: V3 = [ea.back[0] * 0.98, ea.top[1] - (ea.top[1] - ea.lobe[1]) * 0.42, ea.back[2] + rz * 1.2];
    pts.push(over, behind);
    b.sweep(curve(pts, 16), () => ({ rx, rz, pow: 2 }), color, { side: [0, 1, 0], segments: 5, round: "both" });
  };
  const bridgeSpine = (rimR: number, y1: number, y2: number): V3[] => {
    const yb = (y1 - cy) / R;
    const z = bridgeAt(yb);
    return [[-(ex - rimR), y1, gz], [-R * 0.05, y2, z], [R * 0.05, y2, z], [ex - rimR, y1, gz]];
  };
  const lens = (sx: number, r: number, color: number, tube = 0.02, yOff = 0): void => void b.torus(r, R * tube, color, [sx * ex, ey + yOff, gz], [0, 0, 0]);
  /** Pads that rest on the flanks of the nose, fixed to the rim by a short wire. */
  const pads = (rimR: number, color: number, yOff = 0): void => {
    const yb = eyeR - 0.02;
    for (const sx of [-1, 1]) {
      const px = nose.widthAt(yb * R) + R * 0.035;
      const pad = onSkin(fc, sx * px, (yb - 0.02) * R, R * 0.02);
      b.sphere(R * 0.022, color, pad, [0.6, 1.3, 0.8]);
      b.sweep([pad, [sx * (ex - rimR * 0.85), ey + yOff - rimR * 0.55, gz]], () => ({ rx: R * 0.007, rz: R * 0.007, pow: 2 }), color, { side: [0, 1, 0], segments: 4 });
    }
  };

  // ---- a strap: round the back of the head over the hair, over the ears --------------------------------------------------------------------------------
  const loop = (color: number, from: V3, to: V3, yBase: number, rx: number, rz: number, azStart = 0.75): void => {
    const pts: V3[] = [from];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const az = azStart + (2 * Math.PI - 2 * azStart) * (i / steps);
      const a = az > Math.PI ? 2 * Math.PI - az : az; // azimuth from the face, 0..pi
      const sx = az > Math.PI ? -1 : 1;
      pts.push(on(sx, a, overEar(a, yBase), rz + R * 0.008));
    }
    pts.push(to);
    b.sweep(curve(pts, 26), () => ({ rx, rz, pow: 2.2 }), color, { side: [0, 1, 0], segments: 5, round: "both" });
  };

  const frame = PALETTE.trim.frame;
  switch (spec.eyewear) {
    case 1:
    case 9: { // monocle on a chain (right eye, or the left eye for 9): the chain falls in front of cheek, jaw and beard to a weight
      const sx = spec.eyewear === 1 ? 1 : -1;
      const r = glassR(1.5);
      gz = zFor(r);
      lens(sx, r, accent);
      const ring: V3 = [sx * (ex + r * 0.35), ey - r, gz];
      const beard = spec.beard !== 0 ? R * 0.12 : 0;
      const chain = [ring, onSkin(fc, sx * (ex + R * 0.1), -R * 0.3, R * 0.09 + beard), onSkin(fc, sx * (ex + R * 0.16), -R * 0.75, R * 0.15 + beard), onSkin(fc, sx * (ex + R * 0.2), -R * 1.05, R * 0.17 + beard)];
      const spine = curve(chain, 10).map((p) => hf.pushOut(p, R * 0.02));
      b.sweep(spine, () => ({ rx: R * 0.01, rz: R * 0.01, pow: 2 }), accent, { side: [0, 0, 1], segments: 5, round: "end" });
      b.sphere(R * 0.035, accent, spine[spine.length - 1]!);
      break;
    }
    case 2: { // spectacles: two round rims, an arched bridge over the nose root, pads, arms over the ears
      const r = glassR(1.35);
      gz = zFor(r);
      for (const sx of [-1, 1] as const) {
        lens(sx, r, frame);
        arm(sx, [sx * (ex + r), ey, gz], frame, R * 0.014, R * 0.012, eyeR);
      }
      b.sweep(curve(bridgeSpine(r, ey + R * 0.01, ey + R * 0.035), 8), () => ({ rx: R * 0.014, rz: R * 0.014, pow: 2 }), frame, { side: [0, 1, 0], segments: 5 });
      pads(r, frame);
      break;
    }
    case 3: { // goggles: brass-rimmed lenses, a leather bridge and a strap round the head
      const r = glassR(1.5);
      gz = zFor(r);
      for (const sx of [-1, 1]) {
        b.cylinder(r, r, R * 0.14, PALETTE.trim.goggleGlass, [sx * ex, ey, gz - R * 0.075], [Math.PI / 2, 0, 0]);
        b.torus(r, R * 0.035, accent, [sx * ex, ey, gz - R * 0.145], [0, 0, 0]);
      }
      b.sweep(curve(bridgeSpine(r, ey, ey + R * 0.02), 8), () => ({ rx: R * 0.03, rz: R * 0.02, pow: 2 }), LEATHER, { side: [0, 1, 0], segments: 5 });
      loop(LEATHER, [ex + r, ey, gz], [-(ex + r), ey, gz], eyeR + 0.05, R * 0.05, R * 0.02, 0.85);
      break;
    }
    case 4:
    case 12: { // pince-nez: two small rims clipped on the nose bridge (12: gilt, with a black cord looping down to the collar)
      const rr = spec.eyewear === 4 ? R * 0.12 : R * 0.135;
      const yb = eyeR - 0.03;
      for (const sx of [-1, 1]) b.torus(rr, R * 0.015, accent, [sx * R * 0.2, cy + yb * R, zFor(rr, R * 0.03, sx * R * 0.2, yb * R)], [0, 0, 0]);
      const bz = bridgeAt(yb + 0.03);
      b.sweep(curve([[-R * 0.08, cy + (yb + 0.01) * R, bz + R * 0.01], [0, cy + (yb + 0.035) * R, bz - R * 0.008], [R * 0.08, cy + (yb + 0.01) * R, bz + R * 0.01]], 6), () => ({ rx: R * 0.012, rz: R * 0.012, pow: 2 }), accent, { side: [0, 1, 0], segments: 5 });
      if (spec.eyewear === 12) {
        const beard = spec.beard !== 0 ? R * 0.1 : 0;
        const cord = [[R * 0.32, ey - R * 0.03, gz + R * 0.01], onSkin(fc, R * 0.48, -R * 0.2, R * 0.08 + beard), onSkin(fc, R * 0.62, -R * 0.65, R * 0.14 + beard), onSkin(fc, R * 0.55, -R * 1.02, R * 0.2 + beard)] as V3[];
        const spine = curve(cord, 10).map((p) => hf.pushOut(p, R * 0.02));
        b.sweep(spine, () => ({ rx: R * 0.01, rz: R * 0.01, pow: 2 }), PALETTE.trim.frame, { side: [0, 0, 1], segments: 4, round: "end" });
        b.sphere(R * 0.04, accent, spine[spine.length - 1]!);
      }
      break;
    }
    case 5: { // smoked glasses: round black lenses in heavy rims, arms over the ears
      const r = glassR(1.42);
      gz = zFor(r);
      const dark = PALETTE.material.smoke;
      for (const sx of [-1, 1] as const) {
        b.cylinder(r, r, R * 0.03, dark, [sx * ex, ey, gz - R * 0.01], [Math.PI / 2, 0, 0]);
        lens(sx, r, frame, 0.034);
        arm(sx, [sx * (ex + r), ey, gz], frame, R * 0.02, R * 0.016, eyeR);
      }
      b.sweep(curve(bridgeSpine(r, ey + R * 0.01, ey + R * 0.035), 8), () => ({ rx: R * 0.02, rz: R * 0.02, pow: 2 }), frame, { side: [0, 1, 0], segments: 5 });
      pads(r, frame);
      break;
    }
    case 6: { // snow goggles: a carved wood band across the eyes with two slits and a strap round the head
      const wood = singe(PALETTE.material.wood, o.burnt);
      const pts: V3[] = [];
      for (let k = 0; k <= 10; k++) {
        const az = -1.05 + (2.1 * k) / 10;
        const d = dir(1, Math.abs(az), eyeR + 0.02);
        pts.push(hf.outer(Math.sign(az || 1) * d[0], d[1], d[2], R * 0.05));
      }
      b.sweep(curve(pts, 14), () => ({ rx: R * 0.15, rz: R * 0.05, pow: 2.6 }), wood, { side: [0, 1, 0], segments: 6, round: "both" });
      for (const sx of [-1, 1]) b.box(eye.radius * 1.7, R * 0.03, R * 0.06, PALETTE.material.soot, [sx * ex, ey, gz - R * 0.06]);
      const e1 = pts[pts.length - 1]!;
      const e0 = pts[0]!;
      loop(LEATHER, e1, e0, eyeR + 0.05, R * 0.05, R * 0.02, 1.1);
      break;
    }
    case 7: { // jeweller's loupe: a brass tube screwed into the right eye, on an arm from a head band
      const r = glassR(1.15);
      gz = zFor(r);
      b.cylinder(r, r * 1.15, R * 0.28, accent, [ex, ey, gz - R * 0.12], [Math.PI / 2, 0, 0]);
      b.torus(r * 1.16, R * 0.03, tone(accent, 0.8), [ex, ey, gz - R * 0.26], [0, 0, 0]);
      b.cylinder(r * 0.78, r * 0.78, R * 0.02, PALETTE.trim.goggleGlass, [ex, ey, gz - R * 0.27], [Math.PI / 2, 0, 0]);
      // the head band round the forehead, and the strap from it down to the tube
      const yBand = o.hatOn ? Math.min(0.36, o.seatY - 0.12) : 0.38;
      const band: V3[] = [];
      for (let k = 0; k <= 18; k++) {
        const az = (k / 18) * 2 * Math.PI;
        const a = az > Math.PI ? 2 * Math.PI - az : az;
        const sxk = az > Math.PI ? -1 : 1;
        band.push(on(sxk, a, overEar(a, yBand), R * 0.03));
      }
      b.sweep(curve(band, 26), () => ({ rx: R * 0.028, rz: R * 0.02, pow: 2.2 }), LEATHER, { side: [0, 1, 0], segments: 5 });
      const top = on(1, 0.42, yBand, R * 0.03);
      b.sweep(curve([top, [ex + r * 0.5, ey + r * 1.0, gz + R * 0.02], [ex + r * 0.4, ey + r * 0.2, gz - R * 0.02]], 6), () => ({ rx: R * 0.02, rz: R * 0.014, pow: 2 }), LEATHER, { side: [0, 0, 1], segments: 4 });
      break;
    }
    case 8: { // half-moons: small reading glasses low on the nose, only the lower half of each lens ringed
      const r = glassR(1.15);
      gz = zFor(r);
      const oy = -eye.radius * 0.7;
      for (const sx of [-1, 1] as const) {
        b.torus(r, R * 0.016, accent, [sx * ex, ey + oy, gz], [0, 0, 0], [1, 0.8, 1], Math.PI);
        b.box(r * 2, R * 0.016, R * 0.016, accent, [sx * ex, ey + oy, gz]);
        arm(sx, [sx * (ex + r), ey + oy, gz], accent, R * 0.011, R * 0.01, eyeR + oy / R);
      }
      b.sweep(curve(bridgeSpine(r, ey + oy + R * 0.01, ey + oy + R * 0.03), 8), () => ({ rx: R * 0.012, rz: R * 0.012, pow: 2 }), accent, { side: [0, 1, 0], segments: 5 });
      break;
    }
    case 10: { // pushed-up goggles: aviator goggles resting on the forehead, brass rims, glass, a strap round the head at the hairline (under a hat they ride on the hat: hatsGeo.ts)
      if (o.hatOn) break;
      const r = glassR(1.5);
      gz = zFor(r);
      const gy = o.hatOn ? Math.min(eyeR + 0.62, o.seatY - 0.16) : eyeR + 0.62;
      for (const sx of [-1, 1]) {
        const p = onSkin(fc, sx * ex * 0.85, gy * R, R * 0.09);
        b.cylinder(r, r, R * 0.12, PALETTE.trim.goggleGlass, [p[0], p[1], p[2]], [Math.PI / 2 - 0.35, 0, 0]);
        b.torus(r, R * 0.035, accent, [p[0], p[1], p[2] - R * 0.05], [-0.35, 0, 0]);
      }
      const mid = onSkin(fc, 0, gy * R, R * 0.1);
      b.box(R * 0.14, R * 0.04, R * 0.05, LEATHER, [mid[0], mid[1], mid[2] - R * 0.02]);
      loop(LEATHER, [ex * 0.85 + r, cy + gy * R, mid[2] + R * 0.02], [-ex * 0.85 - r, cy + gy * R, mid[2] + R * 0.02], gy, R * 0.05, R * 0.02, 0.8);
      break;
    }
    case 11: { // owl specs: big round tortoiseshell rims, a heavy bridge, thick arms
      const r = glassR(1.75);
      gz = zFor(r);
      const shell = PALETTE.trim.tortoise;
      for (const sx of [-1, 1] as const) {
        lens(sx, r, shell, 0.045);
        arm(sx, [sx * (ex + r), ey, gz], shell, R * 0.026, R * 0.018, eyeR);
      }
      b.sweep(curve(bridgeSpine(r, ey + R * 0.02, ey + R * 0.05), 8), () => ({ rx: R * 0.03, rz: R * 0.026, pow: 2 }), shell, { side: [0, 1, 0], segments: 5 });
      pads(r, shell);
      break;
    }
    case 13: { // green visor: an accountant's eyeshade on a band round the head (a hat takes its place: a visor under a brim is a hat's job)
      if (o.hatOn) break;
      const yBand = o.hatOn ? Math.min(0.34, o.seatY - 0.14) : 0.36;
      const pts: V3[] = [];
      for (let k = 0; k <= 10; k++) {
        const az = -1.2 + (2.4 * k) / 10;
        const bill = Math.max(0, Math.cos(az * 0.85));
        const d = dir(az < 0 ? -1 : 1, Math.abs(az), yBand);
        pts.push(hf.outer(d[0], d[1], d[2], R * (0.035 + 0.2 * Math.max(0, (bill - 0.3) / 0.7) ** 2)));
      }
      b.sweep(curve(pts, 16), () => ({ rx: R * 0.13, rz: R * 0.016, pow: 2.6 }), PALETTE.trim.visorGlass, { side: [0, 1, 0], segments: 5, round: "both" });
      const band: V3[] = [];
      for (let k = 0; k <= 22; k++) {
        const az = (k / 22) * 2 * Math.PI;
        const a = az > Math.PI ? 2 * Math.PI - az : az;
        const sxk = az > Math.PI ? -1 : 1;
        band.push(on(sxk, a, overEar(a, yBand + 0.02), R * 0.03));
      }
      b.sweep(curve(band, 30), () => ({ rx: R * 0.028, rz: R * 0.02, pow: 2.2 }), LEATHER, { side: [0, 1, 0], segments: 5 });
      break;
    }
    default:
      break;
  }

  if (spec.eyepatch > 0) {
    const sx = spec.eyepatch === 1 ? -1 : 1;
    const wrapStyle = spec.patchStyle === 2;
    const patchC = wrapStyle ? PALETTE.material.linen : PALETTE.ink;
    const strapC = wrapStyle ? tone(patchC, 0.88) : patchC;
    b.sphere(eye.radius * 1.4, patchC, [sx * ex, ey, eye.z - eye.radius * 0.95], [1, 1, 0.3]);
    // The strap climbs from the patch over the ear, round the back of the head and to the other temple.
    const start: V3 = [sx * ex, ey, eye.z - eye.radius * 0.75];
    const pts: V3[] = [start];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const az = 0.7 + (2 * Math.PI - 1.4 - 0.55) * (i / steps);
      const a = az > Math.PI ? 2 * Math.PI - az : az;
      const s = (az > Math.PI ? -1 : 1) * sx;
      const yR = overEar(a, eyeR + (0.3 - eyeR) * smooth(0, 0.35, i / steps));
      pts.push(on(s, a, yR, R * 0.028));
    }
    b.sweep(curve(pts, 28), () => ({ rx: R * 0.03, rz: R * 0.016, pow: 2.2 }), strapC, { side: [0, 1, 0], segments: 5, round: "both" });
    buildPatchDecor(fc, sx, ex, ey, eye.z - eye.radius * 1.1, eye.radius);
  }
  void ringAtAz;
}
