import { Color, type BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import type { Proportions } from "../proportions.ts";
import type { CharacterSpec } from "../spec.ts";
import * as K from "../catalog.ts";
import type { Ring } from "./loft.ts";
import { CREAM, LEATHER, PartBuilder, SOOT, WOOD, singe } from "./parts.ts";

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

/** The torso's cross-sections, bone-local (origin at the waist joint, +Y up to the base of the neck). Shared with the wound dressings. */
export function torsoRings(P: Proportions, color: number): Ring[] {
  const h = P.torsoHeight;
  const W = P.torsoWidth / 2;
  const D = P.torsoDepth / 2;
  const BF = P.bellyForward;
  const BR = P.bellyRadius;
  const SH = P.shoulderHalfWidth;
  return [
    { y: -0.05 * h, rx: W * 0.85, rz: D * 0.78, cz: -BF * 0.15, color: tone(color, 0.8) },
    { y: 0.1 * h, rx: W * 0.95 + BR * 0.3, rz: D * 0.9 + BF * 0.15, cz: -BF * 0.45, color: tone(color, 0.9) },
    { y: 0.28 * h, rx: W * 1.0 + BR * 0.5, rz: D * 0.98 + BF * 0.4, cz: -BF * 0.55, pow: 2.2, color },
    { y: 0.5 * h, rx: W * 1.04, rz: D * 0.95 + BF * 0.1, cz: -BF * 0.2, color },
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
    const s = at(h * 0.6);
    b.torus(1, 0.04, singe(PALETTE.trim.sashRed, burnt), [0, h * 0.55, s.cz], [Math.PI / 2, 0.6, 0.28], [s.rx * 1.1, s.rz * 1.12, 1]);
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
      { y: 0.09 * sc, rx: W * 0.86, rz: D * 0.74, cz: -P.bellyForward * 0.12, color: tone(c.trouserC, 0.95) },
      { y: -0.02 * sc, rx: P.hipWidth + r * 1.2, rz: D * 0.82, color: c.trouserC },
      { y: -0.12 * sc, rx: P.hipWidth + r * 0.95, rz: D * 0.66, color: tone(c.trouserC, 0.85) },
    ],
    c.trouserC,
  );
  // Coat skirts. Frock coats have two back tails and open fronts (so the legs swing freely); tunics, hunting jackets and greatcoats
  // wear a closed bell skirt of increasing length.
  const hemC = tone(c.jacketC, 0.7);
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
      { y: -L * 0.9, rx: r * 0.82, rz: r * 0.8, color: tone(sleeveC, 0.9) },
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

/** A fist: palm block, four curled fingers across the front, thumb wrapped over them. Reads as a hand at any distance and holds a prop. */
function buildHand(b: PartBuilder, c: BodyCtx, armLength: number): void {
  const { P, skin } = c;
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
  for (let k = 0; k < 4; k++) {
    const x = (k - 1.5) * hr * 0.46;
    b.sphere(hr * 0.27, skin, [x, hy - hr * 0.72, -hr * 0.36], [1, 1.3, 1.05]);
  }
  b.sphere(hr * 0.3, skin, [0, hy + hr * 0.12, -hr * 0.66], [0.9, 1.35, 0.9]); // thumb
}

// ---- legs ---------------------------------------------------------------------------------------------------------------

export const legRadius = (c: BodyCtx): number => (c.spec.trousers === 3 ? 0.14 : 0.11) * c.P.scale + 0.02;

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
    rings = [
      { y: 0.04, rx: r * 1.25, rz: r * 1.2, color: tone(tc, 0.95) },
      { y: -L * 0.4, rx: r * 1.3, rz: r * 1.25, color: tc },
      { y: -L - 0.02, rx: r * 1.15, rz: r * 1.1, color: tone(tc, 0.88) },
    ];
  } else {
    rings = [
      { y: 0.04, rx: r * 1.3, rz: r * 1.25, color: tone(tc, 0.95) },
      { y: -L * 0.3, rx: r * 1.22, rz: r * 1.18, color: tc },
      { y: -L * 0.8, rx: r * 1.02, rz: r * 1.0, color: tone(tc, 0.92) },
      { y: -L - 0.02, rx: r * 0.95, rz: r * 0.95, color: tone(tc, 0.85) },
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
      { y: 0.02, rx: legR * 1.05, rz: legR * 1.02, color: tone(tc, 0.88) },
      { y: -len * 0.5, rx: legR * 0.95, rz: legR * 0.92, color: tc },
      { y: -len * (1 - bootTop) - 0.01, rx: legR * 0.84, rz: legR * 0.82, color: tone(tc, 0.9) },
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
  buildFoot(b, c, len, spec.boots === 2 ? leather : leather);
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
