import { Color, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import * as K from "../catalog.ts";
import { skinRamp } from "./headShape.ts";
import { curve } from "./sweep.ts";
import { addHipGear, addNeckwear, addPack, type TorsoFrame } from "./gear.ts";
import type { Ring } from "./loft.ts";
import { CREAM, LEATHER, PartBuilder, SOOT, WOOD, singe, type V3 } from "./parts.ts";

/** Everything the body builders need, resolved once per character. */
export interface BodyCtx {
  spec: CharacterSpec;
  P: Proportions;
  skin: number;
  jacketC: number;
  trouserC: number;
  shirtC: number;
  /** Sleeve colour. */
  armC: number;
  accent: number;
  burnt: number;
  footH: number;
}

/** Scales a colour's brightness (ambient-occlusion style darkening baked into section colours). */
export function tone(color: number, k: number): number {
  const c = new Color(color);
  c.multiplyScalar(k);
  c.r = Math.min(1, c.r);
  c.g = Math.min(1, c.g);
  c.b = Math.min(1, c.b);
  return c.getHex();
}

/** Grime: mixes a colour toward soot. Hems, knees and cuffs of people who have been dragged through a colony pick this up first. */
export function soil(color: number, amount: number): number {
  return new Color(color).lerp(new Color(SOOT), Math.max(0, Math.min(1, amount))).getHex();
}

/** Linear interpolation of a ring table at height y (clamped), for placing details on the surface. */
export function ringAt(rings: readonly Ring[], y: number): Required<Pick<Ring, "rx" | "rz" | "cx" | "cz" | "pow">> {
  const pick = (r: Ring) => ({ rx: r.rx, rz: r.rz, cx: r.cx ?? 0, cz: r.cz ?? 0, pow: r.pow ?? 2.4 });
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  const lo = Math.min(first.y, last.y);
  const hi = Math.max(first.y, last.y);
  if (y <= lo) return pick(first.y <= last.y ? first : last);
  if (y >= hi) return pick(first.y <= last.y ? last : first);
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
      const A = pick(a);
      const B = pick(b);
      return { rx: A.rx + (B.rx - A.rx) * t, rz: A.rz + (B.rz - A.rz) * t, cx: A.cx + (B.cx - A.cx) * t, cz: A.cz + (B.cz - A.cz) * t, pow: A.pow + (B.pow - A.pow) * t };
    }
  }
  return pick(last);
}

/** Z (negative = front) of the surface of a section at lateral offset x. */
export function frontZ(section: ReturnType<typeof ringAt>, x = 0): number {
  const u = Math.min(0.999, Math.abs(x - section.cx) / section.rx);
  return section.cz - section.rz * (1 - u ** section.pow) ** (1 / section.pow);
}

/** Half-width of the waist: never much narrower than the shoulders it hangs from, or the figure reads as a wasp in a coat. */
export const waistHalf = (P: Proportions): number => Math.max(P.torsoWidth / 2 + P.bellyRadius * 0.5, P.shoulderHalfWidth * 0.74);

/** The torso's cross-sections, bone-local (origin at the waist joint, +Y up to the base of the neck). Shared with the wound dressings. */
export function torsoRings(P: Proportions, color: number): Ring[] {
  const h = P.torsoHeight;
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const BF = P.bellyForward;
  const BR = P.bellyRadius;
  const SH = P.shoulderHalfWidth;
  const WH = waistHalf(P);
  return [
    { y: -0.05 * h, rx: Math.max(W * 0.85, WH * 0.92), rz: D * 0.78, cz: -BF * 0.15, color: soil(tone(color, 0.8), 0.12) },
    { y: 0.1 * h, rx: Math.max(W * 0.95 + BR * 0.3, WH * 0.97), rz: D * 0.9 + BF * 0.15, cz: -BF * 0.45, color: tone(color, 0.9) },
    { y: 0.28 * h, rx: Math.max(W * 1.0 + BR * 0.5, WH), rz: D * 0.98 + BF * 0.4, cz: -BF * 0.55, pow: 2.2, color },
    { y: 0.5 * h, rx: Math.max(W * 1.04, WH * 1.03), rz: D * 0.95 + BF * 0.1, cz: -BF * 0.2, color },
    { y: 0.72 * h, rx: W * 1.12, rz: D * 0.9, cz: -BF * 0.05, pow: 2.6, color },
    { y: 0.87 * h, rx: SH * 0.96, rz: D * 0.78, pow: 3.4, color },
    { y: 0.96 * h, rx: SH * 0.55, rz: D * 0.55, pow: 2.6, color },
    { y: 1.0 * h, rx: P.neck * 1.7 + 0.03, rz: P.neck * 1.6 + 0.03, pow: 2, color },
  ];
}

// ---- torso ------------------------------------------------------------------------------------------------------

export function buildTorso(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P, burnt, accent } = c;
  const b = new PartBuilder();
  const h = P.torsoHeight;
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const BF = P.bellyForward;
  const sleeved = spec.jacket !== 0;
  const bodyC = spec.jacket === 3 ? c.trouserC : sleeved ? c.jacketC : c.shirtC;
  const rings = torsoRings(P, bodyC);
  b.loft(rings, bodyC);
  const at = (y: number) => ringAt(rings, y);
  const surf = (y: number, x = 0) => frontZ(at(y), x);
  const collarC = singe(CREAM, burnt);
  const facing = tone(spec.jacket === 3 ? c.jacketC : c.jacketC, 0.68); // lapel/collar cloth: a shade darker than the coat

  // Collar: a shirt collar with two points for shirt-sleeve and waistcoat wearers, a stand collar for tunics/greatcoats, a
  // folded lay-down collar with lapels for frock coats and hunting jackets.
  const neckY = h * 0.985;
  const nr = P.neck * 1.7 + 0.03;
  if (spec.jacket === 0 || spec.jacket === 3) {
    if (spec.shirt !== 3) {
      b.loft([{ y: neckY - 0.015, rx: nr * 1.15, rz: nr * 1.1, color: collarC }, { y: neckY + 0.045, rx: nr * 1.0, rz: nr * 0.95, crease: true, color: collarC }], collarC);
      for (const sx of [-1, 1]) b.box(0.06, 0.02, 0.09, collarC, [sx * nr * 0.75, neckY - 0.02, -nr * 0.95], [0.5, sx * 0.6, sx * 0.3]);
    } else b.loft([{ y: neckY - 0.01, rx: nr * 1.1, rz: nr * 1.05, color: collarC }, { y: neckY + 0.025, rx: nr, rz: nr * 0.95, crease: true, color: collarC }], collarC);
  } else if (spec.jacket === 2 || spec.jacket === 4) {
    b.loft([{ y: neckY - 0.03, rx: nr * 1.25, rz: nr * 1.2, color: facing }, { y: neckY + 0.05, rx: nr * 1.1, rz: nr * 1.05, crease: true, color: facing }], facing);
  } else {
    b.loft([{ y: neckY - 0.03, rx: nr * 1.3, rz: nr * 1.25, color: facing }, { y: neckY + 0.02, rx: nr * 1.1, rz: nr * 1.05, crease: true, color: facing }], facing);
  }

  // Front opening / shirt front / lapels.
  const lapel = (sx: number, top: number, bottom: number, wide: number): void => {
    const yMid = h * (top + bottom) * 0.5;
    const len = h * (top - bottom);
    const x = sx * W * 0.5;
    b.box(wide, len, 0.022, facing, [x, yMid, surf(yMid, x) - 0.008], [0, sx * -0.12, sx * 0.34]);
  };
  if (spec.jacket === 1 || spec.jacket === 5 || spec.jacket === 3) {
    // V of shirt between the lapels
    b.box(W * 0.62, h * 0.5, 0.02, collarC, [0, h * 0.7, surf(h * 0.7) - 0.006], [0, 0, 0]);
    lapel(-1, 0.94, 0.5, W * 0.42);
    lapel(1, 0.94, 0.5, W * 0.42);
  }
  if (spec.jacket === 4 || spec.jacket === 2) {
    // A dark front placket down the middle under a double row of buttons.
    b.box(0.03, h * 0.7, 0.02, tone(facing, 0.7), [0, h * 0.55, surf(h * 0.55) - 0.006]);
  }
  if (spec.jacket === 3) {
    // cream front peeks above the waistcoat's own V
    b.box(W * 0.5, h * 0.22, 0.02, collarC, [0, h * 0.86, surf(h * 0.86) - 0.005]);
  }

  // Buttons: proud, slightly flattened discs down the front (two rows on double-breasted coats).
  if (spec.jacket !== 0) {
    const rows = spec.jacket === 2 || spec.jacket === 4 ? [-1, 1] : [0];
    const count = spec.jacket === 4 ? 5 : 4;
    for (const rx of rows) {
      for (let i = 0; i < count; i++) {
        const y = h * (0.22 + i * (0.5 / count) * 1.15);
        const x = rx * W * 0.22;
        b.sphere(0.022, accent, [x, y, surf(y, x) - 0.012], [1, 1, 0.55]);
      }
    }
  }
  // Shirt pattern on the visible shirt: horizontal bands, plus vertical rules for checks.
  if ((spec.jacket === 0 || spec.jacket === 3) && (spec.shirt === 1 || spec.shirt === 2)) {
    const stripe = singe(PALETTE.trim.shirtStripe, burnt);
    const y0 = spec.jacket === 3 ? 0.78 : 0.3;
    const y1 = 0.94;
    for (let y = y0; y < y1; y += 0.07) {
      const s = at(h * y);
      b.loft(
        [
          { y: h * y - 0.007, rx: s.rx * 1.004, rz: s.rz * 1.004, cx: s.cx, cz: s.cz, pow: s.pow, color: stripe },
          { y: h * y + 0.007, rx: s.rx * 1.004, rz: s.rz * 1.004, cx: s.cx, cz: s.cz, pow: s.pow, color: stripe, crease: true },
        ],
        stripe,
        undefined,
        undefined,
        undefined,
        { capBottom: false, capTop: false },
      );
    }
    if (spec.shirt === 2) for (let x = -2; x <= 2; x++) b.box(0.012, h * 0.5, 0.008, stripe, [x * W * 0.3, h * 0.62, surf(h * 0.62, x * W * 0.3) - 0.003]);
  }
  // Braces (suspenders) for shirt sleeves.
  if (spec.jacket === 0) {
    const braceC = tone(c.trouserC, 0.85);
    for (const sx of [-1, 1]) {
      const x = sx * W * 0.42;
      const yTop = h * 0.94;
      const yBot = h * 0.16;
      const yMid = (yTop + yBot) / 2;
      b.box(0.045, yTop - yBot, 0.014, braceC, [x, yMid, surf(yMid, x) - 0.005], [0, 0, sx * -0.035]);
    }
  }

  // Belt / cummerbund: a proud band that follows the belly's own section.
  const waist = 0.2;
  const band = (y: number, halfH: number, k: number, color: number, buckle: boolean): void => {
    const s = at(h * y);
    b.loft(
      [
        { y: h * y - halfH, rx: s.rx * k, rz: s.rz * k, cx: s.cx, cz: s.cz, pow: s.pow, color },
        { y: h * y + halfH, rx: s.rx * k, rz: s.rz * k, cx: s.cx, cz: s.cz, pow: s.pow, color, crease: true },
      ],
      color,
      undefined,
      undefined,
      undefined,
      { capBottom: false, capTop: false },
    );
    if (buckle) b.box(0.07, halfH * 2.2, 0.03, accent, [0, h * y, frontZ({ ...s, rz: s.rz * k }, 0) - 0.012]);
  };
  if (spec.belt === 1) band(waist, 0.022, 1.03, LEATHER, true);
  if (spec.belt === 2) band(waist + 0.02, 0.055, 1.03, singe(PALETTE.trim.cummerbund, burnt), false);
  if (spec.jacket === 5) band(waist, 0.02, 1.03, LEATHER, true); // hunting jackets come belted
  if (spec.jacket === 5) {
    // patch pockets
    for (const sx of [-1, 1]) {
      const x = sx * W * 0.62;
      b.box(0.11, 0.1, 0.03, tone(c.jacketC, 0.9), [x, h * 0.34, surf(h * 0.34, x) - 0.012]);
      b.box(0.11, 0.025, 0.034, facing, [x, h * 0.34 + 0.05, surf(h * 0.34, x) - 0.013]);
    }
  }
  if (spec.jacket === 2) {
    // epaulettes
    for (const sx of [-1, 1]) b.box(0.13, 0.02, 0.09, accent, [sx * P.shoulderHalfWidth * 0.93, h * 0.94, 0], [0, 0, sx * 0.2]);
  }
  // Sash: a diagonal band or a broad waist wrap.
  if (spec.sash === 1) {
    // A ribbon that lies ON the torso: over the right shoulder, diagonally across the chest to the left hip, and the same path
    // mirrored on the back. Points come from the torso's own superellipse sections so it can never float or sink; the wide axis
    // follows the surface (normal x tangent).
    const sashC = singe(PALETTE.trim.sashRed, burnt);
    const surfacePoint = (y: number, phi: number, lift: number): V3 => {
      const q = at(y);
      const e = 2 / q.pow;
      const sn = Math.sin(phi);
      const cs = Math.cos(phi);
      const x = q.cx + (q.rx + lift) * Math.sign(sn) * Math.abs(sn) ** e;
      const z = q.cz - (q.rz + lift) * Math.sign(cs) * Math.abs(cs) ** e;
      return [x, y, z];
    };
    const path: V3[] = [];
    const normals: V3[] = [];
    const STEPS = 6;
    const push = (y: number, phi: number): void => {
      path.push(surfacePoint(y, phi, 0.014));
      normals.push([Math.sin(phi), 0, -Math.cos(phi)]);
    };
    const shoulderPhi = 0.72;
    const hipPhi = -1.0;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      push(h * (0.24 + 0.7 * t), hipPhi + (shoulderPhi - hipPhi) * t); // hip -> shoulder, front
    }
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      push(h * (0.945 + 0.04 * Math.sin(Math.PI * t)), shoulderPhi + (Math.PI - shoulderPhi - shoulderPhi) * t); // over the shoulder
    }
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      push(h * (0.94 - 0.7 * t), Math.PI - shoulderPhi + (shoulderPhi - hipPhi) * t); // shoulder -> hip, back (mirror of the front)
    }
    const half = 0.052;
    b.sweep(path, () => ({ rx: half, rz: 0.011, pow: 3.2 }), sashC, {
      segments: 6,
      round: "both",
      sideAt: (i) => {
        const a = path[Math.max(0, i - 1)]!;
        const c2 = path[Math.min(path.length - 1, i + 1)]!;
        const tx = c2[0] - a[0];
        const ty = c2[1] - a[1];
        const tz = c2[2] - a[2];
        const n = normals[i]!;
        // side = n x T (lies in the surface, across the ribbon)
        return [n[1] * tz - n[2] * ty, n[2] * tx - n[0] * tz, n[0] * ty - n[1] * tx];
      },
    });
  }
  if (spec.sash === 2) band(waist + 0.06, 0.06, 1.04, singe(PALETTE.trim.sashGold, burnt), false);
  // Medals on the left breast (-X), pinned to the surface.
  for (let i = 0; i < spec.medals; i++) {
    const mx = -W * 0.5 + (i % 3) * 0.055;
    const my = h * 0.74 - Math.floor(i / 3) * 0.07;
    const sz = surf(my, mx);
    b.cylinder(0.026, 0.026, 0.008, i % 2 ? K.ACCENT_COLORS[1] : accent, [mx, my, sz - 0.012], [Math.PI / 2, 0, 0]);
    b.box(0.02, 0.05, 0.006, i % 2 ? PALETTE.trim.ribbonBlue : PALETTE.trim.ribbonRed, [mx, my + 0.04, sz - 0.008]);
  }
  // Gear: neckwear, a pack on the back, something hanging from the belt.
  if (spec.neckwear || spec.pack || spec.hipGear) {
    const dyes = PALETTE.cloth;
    const frame: TorsoFrame = { b, spec, P, h, W, D, neckY, nr, burnt, accent, dye: singe(dyes[(spec.hatColor + 4) % dyes.length]!, burnt), at, tone };
    if (spec.neckwear) addNeckwear(frame);
    if (spec.pack) addPack(frame);
    if (spec.hipGear) addHipGear(frame);
  }
  // Scorch marks.
  if (burnt >= 2) {
    b.sphere(1, SOOT, [W * 0.4, h * 0.5, surf(h * 0.5, W * 0.4) - 0.004], [0.09, 0.07, 0.02]);
    b.sphere(1, SOOT, [-W * 0.2, h * 0.25, surf(h * 0.25, -W * 0.2) - 0.004], [0.07, 0.09, 0.02]);
  }
  void D;
  void BF;
  return b.build();
}

// ---- pelvis: hips, trouser top, coat skirts -------------------------------------------------------------------------

export function buildPelvis(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P } = c;
  const b = new PartBuilder();
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const r = legRadius(c);
  const sc = P.scale;
  b.loft(
    [
      { y: 0.09 * sc, rx: waistHalf(P) * 0.95, rz: D * 0.78, cz: -P.bellyForward * 0.12, color: tone(c.trouserC, 0.95) },
      { y: -0.02 * sc, rx: Math.max(P.hipWidth + r * 1.1, waistHalf(P) * 1.02), rz: D * 0.86, color: c.trouserC },
      { y: -0.12 * sc, rx: P.hipWidth + r * 0.95, rz: D * 0.7, color: tone(c.trouserC, 0.85) },
    ],
    c.trouserC,
  );
  // Coat skirts. Frock coats have two back tails and open fronts (so the legs swing freely); tunics, hunting jackets and greatcoats
  // wear a closed bell skirt of increasing length.
  const hemC = soil(tone(c.jacketC, 0.7), 0.22);
  const top = 0.03 * sc;
  const bell = (len: number, flare: number): void => {
    const cz = -P.bellyForward * 0.2;
    b.loft(
      [
        { y: top, rx: W * 0.96, rz: D * 0.86 + P.bellyForward * 0.2, cz, pow: 2.6, color: tone(c.jacketC, 0.92) },
        { y: -len * 0.5, rx: W * (0.96 + (flare - 0.96) * 0.55), rz: (D * 0.86 + P.bellyForward * 0.2) * (1 + (flare - 1) * 0.5), cz, pow: 2.6, color: c.jacketC },
        { y: -len, rx: W * flare, rz: (D * 0.86 + P.bellyForward * 0.2) * flare, cz, pow: 2.6, color: tone(c.jacketC, 0.88) },
        { y: -len, rx: W * flare, rz: (D * 0.86 + P.bellyForward * 0.2) * flare, cz, pow: 2.6, color: hemC, crease: true },
        { y: -len - 0.025, rx: W * flare, rz: (D * 0.86 + P.bellyForward * 0.2) * flare, cz, pow: 2.6, color: hemC },
      ],
      c.jacketC,
      undefined,
      undefined,
      undefined,
      { capTop: false },
    );
  };
  if (spec.jacket === 2) bell(P.legUpper * 0.5, 1.12);
  else if (spec.jacket === 5) bell(P.legUpper * 0.36, 1.05);
  else if (spec.jacket === 4) bell(P.legUpper * 1.4, 1.32);
  else if (spec.jacket === 1) {
    const len = P.legUpper * 1.0;
    for (const sx of [-1, 1]) {
      // a swallowtail: each tail a broad flat panel that flares a little toward the hem
      b.loft(
        [
          { y: top, rx: W * 0.5, rz: 0.035, cx: sx * W * 0.5, cz: D * 0.78, pow: 3.4, color: tone(c.jacketC, 0.92) },
          { y: -len * 0.55, rx: W * 0.55, rz: 0.045, cx: sx * W * 0.55, cz: D * 0.95, pow: 3.4, color: c.jacketC },
          { y: -len, rx: W * 0.6, rz: 0.05, cx: sx * W * 0.6, cz: D * 1.02, pow: 3.4, color: tone(c.jacketC, 0.88) },
          { y: -len, rx: W * 0.6, rz: 0.05, cx: sx * W * 0.6, cz: D * 1.02, pow: 3.4, color: hemC, crease: true },
          { y: -len - 0.025, rx: W * 0.6, rz: 0.05, cx: sx * W * 0.6, cz: D * 1.02, pow: 3.4, color: hemC },
        ],
        c.jacketC,
      );
      // short side skirt so the coat reads as a coat from the front
      b.loft(
        [
          { y: top, rx: 0.035, rz: D * 0.55, cx: sx * W * 1.0, cz: -D * 0.05, pow: 3, color: tone(c.jacketC, 0.92) },
          { y: -len * 0.55, rx: 0.05, rz: D * 0.6, cx: sx * W * 1.12, cz: -D * 0.02, pow: 3, color: c.jacketC },
          { y: -len * 0.62, rx: 0.05, rz: D * 0.6, cx: sx * W * 1.12, cz: -D * 0.02, pow: 3, color: hemC },
        ],
        c.jacketC,
      );
    }
  }
  return b.build();
}

// ---- arms ---------------------------------------------------------------------------------------------------------------

/** Upper-arm sections in the shoulder frame (hanging down). Shared with the wound dressings. */
export function upperArmRings(P: Proportions, sleeveC: number): Ring[] {
  const r = P.armRadius;
  const L = P.armUpper;
  return [
    { y: 0.05, rx: r * 1.3, rz: r * 1.25, color: tone(sleeveC, 1.02) },
    { y: -L * 0.12, rx: r * 1.42, rz: r * 1.35, pow: 2.2, color: sleeveC },
    { y: -L * 0.5, rx: r * 1.18, rz: r * 1.15, color: sleeveC },
    { y: -L * 0.92, rx: r * 1.02, rz: r * 1.0, color: tone(sleeveC, 0.9) },
    { y: -L - r * 0.15, rx: r * 0.95, rz: r * 0.95, color: tone(sleeveC, 0.85) },
  ];
}

export function buildUpperArm(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P } = c;
  const b = new PartBuilder();
  const r = P.armRadius;
  const L = P.armUpper;
  const sleeveC = c.armC;
  b.loft(upperArmRings(P, sleeveC), sleeveC);
  if (spec.jacket === 5) b.box(r * 0.5, L * 0.25, r * 0.2, LEATHER, [0, -L * 0.98, r * 0.85]); // elbow patch (back of the arm)
  return b.build();
}

export function buildForeArm(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P, burnt } = c;
  const b = new PartBuilder();
  const r = P.armRadius;
  const L = P.armLower;
  const sleeveC = c.armC;
  const cuffC = spec.jacket === 0 ? tone(c.shirtC, 0.95) : singe(CREAM, burnt);
  b.loft(
    [
      { y: r * 0.25, rx: r * 0.98, rz: r * 0.96, color: tone(sleeveC, 0.88) },
      { y: -L * 0.3, rx: r * 1.02, rz: r * 1.0, color: sleeveC },
      { y: -L * 0.78, rx: r * 0.86, rz: r * 0.84, color: sleeveC },
      { y: -L * 0.9, rx: r * 0.82, rz: r * 0.8, color: soil(tone(sleeveC, 0.9), 0.22) },
    ],
    sleeveC,
  );
  // cuff: a separate stiff band, proud of the sleeve
  b.loft(
    [
      { y: -L * 0.86, rx: r * 0.93, rz: r * 0.9, color: cuffC },
      { y: -L * 1.0 - 0.005, rx: r * 0.88, rz: r * 0.85, color: cuffC, crease: true },
    ],
    cuffC,
  );
  buildHand(b, c, L);
  return b.build();
}

/** Colour of the hand: bare skin, or the glove. */
export function handColor(c: BodyCtx): number {
  if (c.spec.gloves === 1) return singe(CREAM, c.burnt);
  if (c.spec.gloves === 2) return singe(LEATHER, c.burnt);
  return c.skin;
}

/**
 * A fist: a palm block with four curled fingers (tapered tubes that run down the front of the palm and curl back under it, the middle
 * one longest), knuckle ridges, and a thumb wrapped across them. Reads as a hand at any distance and holds a prop.
 */
function buildHand(b: PartBuilder, c: BodyCtx, armLength: number): void {
  const { P, spec } = c;
  const skin = handColor(c);
  const hr = P.handRadius;
  const hy = -armLength - hr * 0.7;
  b.loft(
    [
      { y: hy + hr * 0.75, rx: hr * 0.62, rz: hr * 0.55, color: tone(skin, 0.9) },
      { y: hy + hr * 0.2, rx: hr * 1.0, rz: hr * 0.72, pow: 2.8, color: skin },
      { y: hy - hr * 0.6, rx: hr * 1.02, rz: hr * 0.78, pow: 3, color: skin },
      { y: hy - hr * 0.95, rx: hr * 0.88, rz: hr * 0.62, pow: 2.8, color: tone(skin, 0.94) },
    ],
    skin,
  );
  const LEN = [0.86, 1.0, 0.94, 0.74];
  for (let k = 0; k < 4; k++) {
    const x = (k - 1.5) * hr * 0.46;
    const l = LEN[k]!;
    const pts: V3[] = [
      [x, hy + hr * 0.08, -hr * 0.6],
      [x, hy - hr * 0.5 * l, -hr * 0.9],
      [x, hy - hr * 0.9 * l, -hr * 0.74],
      [x, hy - hr * 0.92 * l, -hr * 0.36],
    ];
    const tip = tone(skin, 1.04);
    b.sweep(curve(pts, 4), (t) => ({ rx: hr * (0.215 - 0.03 * t), rz: hr * (0.2 - 0.03 * t), pow: 2.3, color: t > 0.7 ? tip : skin }), skin, { side: [1, 0, 0], segments: 5, round: "end" });
  }
  // thumb: across the front of the fingers
  b.sweep(
    curve([[hr * 0.05, hy + hr * 0.38, -hr * 0.5], [hr * 0.1, hy + hr * 0.02, -hr * 0.98], [hr * 0.02, hy - hr * 0.42, -hr * 1.02], [-hr * 0.2, hy - hr * 0.6, -hr * 0.9]], 4),
    (t) => ({ rx: hr * (0.26 - 0.06 * t), rz: hr * (0.23 - 0.05 * t), pow: 2.3 }),
    skin,
    { side: [1, 0, 0], segments: 5, round: "end" },
  );
  if (spec.gloves === 2) {
    // leather gauntlet: a flared cuff running up the wrist
    const g = tone(skin, 1.12);
    const r = P.armRadius;
    b.loft(
      [
        { y: hy + hr * 0.95, rx: r * 0.95, rz: r * 0.92, color: tone(skin, 0.9) },
        { y: hy + hr * 1.5, rx: r * 1.1, rz: r * 1.06, color: g },
        { y: hy + hr * 2.0, rx: r * 1.16, rz: r * 1.12, color: g, crease: true },
      ],
      skin,
      undefined,
      undefined,
      undefined,
      { capTop: false },
    );
  }
}

// ---- legs ---------------------------------------------------------------------------------------------------------------

export const legRadius = (c: BodyCtx): number => (c.spec.trousers === 3 ? 0.15 : 0.12) * c.P.scale + 0.02;

/** Thigh sections in the hip frame (hanging down) for the spec's trouser cut. Shared with the wound dressings. */
export function upperLegRings(c: BodyCtx): Ring[] {
  const { spec, P } = c;
  const r = legRadius(c);
  const L = P.legUpper;
  const tc = c.trouserC;
  let rings: Ring[];
  if (spec.trousers === 2) {
    // breeches: puffed thigh, gathered tight above the knee
    rings = [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.35, rx: r * 1.6, rz: r * 1.5, pow: 2.2, color: tc },
      { y: -L * 0.8, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.9) },
      { y: -L - 0.02, rx: r * 0.9, rz: r * 0.9, color: tone(tc, 0.85) },
    ];
  } else if (spec.trousers === 3) {
    // baggy: hangs from the hip and billows, pinched a little at the knee, with a fold band where the cloth stacks
    rings = [
      { y: 0.04, rx: r * 1.25, rz: r * 1.2, color: tone(tc, 0.95) },
      { y: -L * 0.3, rx: r * 1.38, rz: r * 1.32, pow: 2.2, color: tone(tc, 1.03) },
      { y: -L * 0.62, rx: r * 1.28, rz: r * 1.22, color: tc },
      { y: -L * 0.88, rx: r * 1.2, rz: r * 1.14, color: tone(tc, 0.86) },
      { y: -L - 0.02, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.8) },
    ];
  } else {
    // a tailored leg: full at the thigh, easing to the knee, a fold band behind the bend
    rings = [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.25, rx: r * 1.28, rz: r * 1.22, pow: 2.3, color: tone(tc, 1.03) },
      { y: -L * 0.6, rx: r * 1.1, rz: r * 1.06, color: tc },
      { y: -L * 0.9, rx: r * 0.96, rz: r * 0.94, color: tone(tc, 0.9) },
      { y: -L - 0.02, rx: r * 0.92, rz: r * 0.92, color: tone(tc, 0.78) },
    ];
  }
  return rings;
}

export function buildUpperLeg(c: BodyCtx): BufferGeometry | undefined {
  const { spec, P, burnt } = c;
  const b = new PartBuilder();
  const r = legRadius(c);
  const L = P.legUpper;
  const tc = c.trouserC;
  b.loft(upperLegRings(c), tc);
  b.sphere(r * 0.62, tone(tc, 0.97), [0, -L - 0.01, -r * 0.55], [1, 0.9, 0.8]); // knee cap: gives the bend a visible pivot
  if (spec.trousers === 1) b.box(0.014, L * 0.95, 0.014, singe(CREAM, burnt), [-0, -L * 0.5, -r * 1.14]); // stripe down the front
  if (spec.trousers === 2) b.loft([{ y: -L * 0.86, rx: r * 1.0, rz: r * 1.0, color: LEATHER }, { y: -L * 0.93, rx: r * 1.0, rz: r * 1.0, color: LEATHER, crease: true }], LEATHER, undefined, undefined, undefined, { capBottom: false, capTop: false }); // garter strap
  return b.build();
}

export function buildLowerLeg(c: BodyCtx, wooden: boolean): BufferGeometry | undefined {
  const { spec, P, footH, burnt } = c;
  const b = new PartBuilder();
  const r = legRadius(c);
  const len = P.legLower;
  const leather = singe(LEATHER, burnt);
  if (wooden) {
    const wl = len + footH;
    b.loft(
      [
        { y: 0.03, rx: r * 0.6, rz: r * 0.6, color: WOOD },
        { y: -wl * 0.5, rx: r * 0.5, rz: r * 0.5, color: tone(WOOD, 0.9) },
        { y: -wl, rx: r * 0.38, rz: r * 0.38, color: tone(WOOD, 0.8) },
      ],
      WOOD,
    );
    b.cylinder(r * 0.66, r * 0.66, 0.06, leather, [0, -0.01, 0]); // leather cup at the knee
    b.cylinder(r * 0.45, r * 0.45, 0.035, PALETTE.material.iron, [0, -wl + 0.02, 0]); // iron ferrule
    return b.build();
  }
  const tc = c.trouserC;
  const tall = spec.boots === 0;
  const legR = spec.trousers === 3 ? r * 1.1 : r * 0.9;
  // trouser shin
  const bootTop = tall ? 0.36 : spec.boots === 2 ? 0.14 : 0.1;
  b.loft(
    [
      { y: 0.02, rx: legR * 1.05, rz: legR * 1.02, color: tone(tc, 0.78) },
      { y: -len * 0.22, rx: legR * 1.04, rz: legR * 1.08, pow: 2.2, color: tone(tc, 1.02) }, // calf
      { y: -len * 0.55, rx: legR * 0.94, rz: legR * 0.92, color: tc },
      { y: -len * (1 - bootTop) - 0.01, rx: legR * 0.82, rz: legR * 0.8, color: soil(tone(tc, 0.9), 0.22 + 0.1 * spec.boots) },
    ],
    tc,
    undefined,
    undefined,
    undefined,
    { capTop: false },
  );
  // boot shaft
  const shaftTop = -len * (1 - bootTop);
  const shaftC = spec.boots === 2 ? singe(PALETTE.trim.ivory, burnt) : leather;
  b.loft(
    [
      { y: shaftTop + 0.01, rx: legR * 0.9, rz: legR * 0.88, color: tone(shaftC, 1.15) },
      { y: shaftTop - 0.03, rx: legR * 0.86, rz: legR * 0.84, color: shaftC, crease: true },
      { y: -len + 0.02, rx: legR * 0.8, rz: legR * 0.8, color: tone(shaftC, 0.9) },
    ],
    shaftC,
    undefined,
    undefined,
    undefined,
    { capTop: false },
  );
  if (tall) b.loft([{ y: shaftTop + 0.03, rx: legR * 0.99, rz: legR * 0.97, color: tone(leather, 1.5) }, { y: shaftTop - 0.03, rx: legR * 0.99, rz: legR * 0.97, color: tone(leather, 1.5), crease: true }], leather, undefined, undefined, undefined, { capBottom: false, capTop: false }); // folded top
  if (!tall && spec.trousers !== 2) {
    // turn-up: a folded band of trouser cloth just above the boot, dirtier than the leg
    const cuff = soil(tone(tc, 1.12), 0.3);
    b.loft([{ y: shaftTop + 0.075, rx: legR * 0.92, rz: legR * 0.9, color: cuff }, { y: shaftTop + 0.06, rx: legR * 0.97, rz: legR * 0.95, color: cuff }, { y: shaftTop - 0.015, rx: legR * 0.97, rz: legR * 0.95, color: tone(cuff, 0.82), crease: true }], tc, undefined, undefined, undefined, { capBottom: false, capTop: false });
  }
  if (spec.boots === 1 || spec.boots === 3) {
    // laces: two little crossings up the front of the ankle (inside the shaft, never below the sole)
    const lace = singe(PALETTE.trim.ivory, burnt);
    const span = len * bootTop; // the whole ankle boot is only this tall
    for (let i = 0; i < 2; i++) {
      const y = shaftTop - span * (0.22 + 0.36 * i);
      for (const sx of [-1, 1]) b.box(legR * 0.42, 0.007, 0.007, lace, [sx * legR * 0.1, y, -legR * 0.87], [0, 0, sx * 0.55]);
    }
  }
  if (tall) b.box(0.028, 0.03, 0.022, c.accent, [legR * 0.9, shaftTop - 0.11, -legR * 0.05]); // strap buckle on the outer side
  buildFoot(b, c, len, leather);
  return b.build();
}

/** The shoe: a lofted last (heel to toe) with a raised toe cap, a darker sole and heel block, and optional spats or hobnails. */
function buildFoot(b: PartBuilder, c: BodyCtx, legLen: number, bootC: number): void {
  const { spec, P, footH } = c;
  const fl = P.footLength;
  const fw = P.footWidth;
  // Chunky on purpose: a caricature shoe is a loaf, not a plank. Height follows length so big feet stay bulky.
  const H = Math.max(footH * 1.6 + 0.04, fl * 0.27);
  const yFloor = -legLen - footH;
  const soleC = tone(bootC, 0.5);
  const heelZ = fl * 0.34;
  // Loft axis: local +Y = forward (world -Z) after the rotation, local Z = up; cz lifts the section off the ground.
  const rings: Ring[] = [
    { y: 0, rx: fw * 0.4, rz: H * 0.46, cz: H * 0.5, pow: 2.5, color: tone(bootC, 0.88) },
    { y: fl * 0.14, rx: fw * 0.47, rz: H * 0.5, cz: H * 0.52, pow: 2.8, color: bootC },
    { y: fl * 0.42, rx: fw * 0.5, rz: H * 0.5, cz: H * 0.5, pow: 3, color: bootC },
    { y: fl * 0.68, rx: fw * 0.55, rz: H * 0.4, cz: H * 0.42, pow: 2.8, color: tone(bootC, 1.08) },
    { y: fl * 0.9, rx: fw * 0.5, rz: H * 0.33, cz: H * 0.38, pow: 2.5, color: tone(bootC, 1.18) },
    { y: fl * 1.06, rx: fw * 0.3, rz: H * 0.24, cz: H * 0.36, pow: 2.2, color: tone(bootC, 1.12) },
  ];
  b.loft(rings, bootC, [0, yFloor + 0.01, heelZ], [-Math.PI / 2, 0, 0]);
  // sole slab (a touch wider than the upper) and a heel block
  b.loft(
    [
      { y: -0.01, rx: fw * 0.44, rz: 0.018, cz: 0.012, pow: 3, color: soleC },
      { y: fl * 0.55, rx: fw * 0.6, rz: 0.018, cz: 0.012, pow: 3, color: soleC },
      { y: fl * 1.08, rx: fw * 0.36, rz: 0.018, cz: 0.012, pow: 3, color: soleC },
    ],
    soleC,
    [0, yFloor, heelZ],
    [-Math.PI / 2, 0, 0],
  );
  b.box(fw * 0.75, footH * 0.9, fl * 0.2, soleC, [0, yFloor + footH * 0.45, heelZ - fl * 0.02]);
  if (spec.boots === 2) {
    // spats: cream cloth over the instep
    const spat = singe(PALETTE.trim.ivory, c.burnt);
    b.loft([{ y: 0.03, rx: fw * 0.5, rz: H * 0.5, cz: H * 0.55, color: spat }, { y: fl * 0.5, rx: fw * 0.55, rz: H * 0.42, cz: H * 0.5, crease: true, color: spat }], bootC, [0, yFloor + 0.025, heelZ - fl * 0.02], [-Math.PI / 2, 0, 0], undefined, { capBottom: false });
  }
  if (spec.boots === 3) for (let i = 0; i < 6; i++) b.sphere(0.014, PALETTE.trim.hobnail, [((i % 2) - 0.5) * fw * 0.6, yFloor - 0.004, heelZ - fl * (0.15 + (i >> 1) * 0.3)], [1, 0.5, 1]);
}

// ---- stumps (where a limb used to be) ----------------------------------------------------------------------------------------

/**
 * The end of a limb that has been taken off, in the shoulder or hip frame: a short stub of sleeve or trouser with a torn edge and a
 * capped wound - flesh, a ring of blood (iodine when gore is off) and the pale disc of bone. Bone-local, hanging along -Y.
 */
export function buildStump(c: BodyCtx, limb: "arm" | "leg", gore: "full" | "reduced" | "off"): BufferGeometry | undefined {
  const { P } = c;
  const b = new PartBuilder();
  const cloth = limb === "arm" ? c.armC : c.trouserC;
  const rings = limb === "arm" ? upperArmRings(P, cloth) : upperLegRings(c);
  const len = limb === "arm" ? P.armUpper : P.legUpper;
  const cut = len * (limb === "arm" ? 0.3 : 0.28);
  // Keep the top of the limb's own rings down to the cut, then close with a torn edge.
  const stub: Ring[] = [];
  for (const r of rings) if (-r.y <= cut) stub.push(r);
  const end = ringAt(rings, -cut);
  stub.push({ y: -cut, rx: end.rx, rz: end.rz, color: tone(cloth, 0.8) });
  stub.push({ y: -cut, rx: end.rx * 1.04, rz: end.rz * 1.04, color: tone(cloth, 0.6), crease: true });
  stub.push({ y: -cut - 0.02, rx: end.rx * 0.98, rz: end.rz * 0.98, color: tone(cloth, 0.5) });
  b.loft(stub, cloth, undefined, undefined, undefined, { capTop: false, capBottom: false });
  // The wound cap: flesh disc, blood ring, bone.
  const ramp = skinRamp(c.skin);
  const flesh = tone(ramp.lip.getHex(), 0.95);
  const blood = gore === "off" ? PALETTE.gore.off.fresh : gore === "reduced" ? PALETTE.gore.reduced.fresh : PALETTE.gore.full.fresh;
  const rx = end.rx * 0.93;
  const rz = end.rz * 0.93;
  const y = -cut - 0.022;
  b.loft([{ y: y + 0.01, rx, rz, color: blood }, { y: y - 0.012, rx: rx * 0.97, rz: rz * 0.97, color: blood }], blood);
  b.loft([{ y: y - 0.008, rx: rx * 0.78, rz: rz * 0.78, color: flesh }, { y: y - 0.02, rx: rx * 0.74, rz: rz * 0.74, color: flesh }], flesh);
  b.loft([{ y: y - 0.018, rx: rx * 0.34, rz: rz * 0.34, color: PALETTE.trim.ivory }, { y: y - 0.03, rx: rx * 0.3, rz: rz * 0.3, color: PALETTE.trim.ivory }], PALETTE.trim.ivory);
  return b.build();
}
