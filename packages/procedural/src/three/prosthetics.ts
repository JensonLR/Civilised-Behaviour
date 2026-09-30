import type { BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import { PartBuilder, SOOT, WOOD, singe, type V3 } from "./parts.ts";
import { legRadius, ringAt, tone, type BodyCtx } from "./bodyKit.ts";
import { CUFF_HANG, KNEE_LAP, foreArmRings, upperLegRings } from "./limbRings.ts";
import { bandOn, clothLift, limbSurface, mountOn } from "./limbKit.ts";

/**
 * Prosthetics. Two looks come from the campaign history (both server-owned): a wooden leg (`woodenLeg`: 1 left, 2 right) and a hook (`hook`: 1 left,
 * 2 right). Each shows in two situations:
 *   - on an intact limb: the leg is wood from the knee down; the hand is replaced by a leather cuff and a hook (built into the leg / forearm meshes,
 *     see `pegShin` and `hookHand`);
 *   - where the limb has been lost (`rig.setMissing`): the stump is fitted with a leather socket and a post runs down to the elbow / knee (`stumpPost`);
 *     the lower half hangs from that joint (`buildProsthesis`), so a peg leg or an iron arm swings and bends with the animation.
 */

/**
 * Wood from the knee down: a turned peg with a leather socket, a brass rim, an iron ferrule and a rubber tip. Knee frame, hanging down. The socket takes the size of the trouser leg it
 * hangs from (the thigh's last section), so it fits a stout leg and a thin one, and the tip stands exactly on the ground.
 */
export function pegShin(b: PartBuilder, c: BodyCtx, len: number): void {
  const knee = ringAt(upperLegRings(c), -c.P.legUpper - KNEE_LAP);
  const r = Math.max(0.02, (knee.rx + knee.rz) / 2);
  const wl = len + c.footH;
  const pr = Math.min(r * 0.62, legRadius(c) * 0.72); // (the peg is thinner than the leg it replaces)
  b.loft(
    [
      { y: 0.03, rx: pr, rz: pr, color: WOOD },
      { y: -wl * 0.35, rx: pr * 0.8, rz: pr * 0.8, color: tone(WOOD, 0.95) },
      { y: -wl * 0.75, rx: pr * 0.65, rz: pr * 0.65, color: tone(WOOD, 0.88) },
      { y: -wl + 0.03, rx: pr * 0.58, rz: pr * 0.58, color: tone(WOOD, 0.8) },
    ],
    WOOD,
  );
  socket(b, c, knee, 0);
  b.cylinder(pr * 0.68, pr * 0.58, 0.05, PALETTE.material.iron, [0, -wl + 0.04, 0]); // iron ferrule
  b.cylinder(pr * 0.7, pr * 0.72, 0.03, SOOT, [0, -wl + 0.015, 0]); // rubber tip (its underside is the ground)
}

/** A leather socket cup with a brass rim and two buckled straps, centred at height y0 on a limb whose section there is `end` (half-axes). */
function socket(b: PartBuilder, c: BodyCtx, end: { rx: number; rz: number }, y0: number): void {
  const leather = singe(c.leather, c.burnt);
  const { rx, rz } = end;
  b.loft(
    [
      { y: y0 + 0.06, rx: rx * 0.98, rz: rz * 0.95, color: tone(leather, 0.9) },
      { y: y0 - 0.02, rx: rx * 0.92, rz: rz * 0.9, color: leather },
      { y: y0 - 0.13, rx: Math.min(rx, rz) * 0.6, rz: Math.min(rx, rz) * 0.6, color: tone(leather, 0.85) },
    ],
    leather,
    undefined,
    undefined,
    undefined,
    { capBottom: false },
  );
  b.torus((rx + rz) * 0.49, 0.008, c.accent, [0, y0 + 0.055, 0], [Math.PI / 2, 0, 0], [rx / ((rx + rz) / 2), rz / ((rx + rz) / 2), 1]);
  for (const y of [y0 - 0.01, y0 - 0.075]) b.box(rx * 0.5, 0.018, 0.012, tone(leather, 0.7), [0, y, -rz * 0.95]);
  b.sphere(0.011, c.accent, [0, y0 - 0.01, -rz * 0.96 - 0.008]);
}

/** A hook: a swept steel J with a brass collar, hanging from `y0` (the wrist) down. `r` is the collar radius. */
export function hook(b: PartBuilder, c: BodyCtx, r: number, y0: number): void {
  const steel = PALETTE.material.iron;
  const shine = tone(steel, 1.5);
  const s = Math.max(0.9, r / 0.06);
  b.cylinder(r * 0.78, r * 0.7, 0.05, c.accent, [0, y0 - 0.025, 0]); // collar
  b.cylinder(r * 0.62, r * 0.62, 0.02, tone(c.accent, 0.8), [0, y0 - 0.055, 0]);
  const raw: V3[] = [[0, -0.05, 0], [0, -0.12, 0], [0, -0.19, -0.012], [0, -0.235, -0.06], [0, -0.215, -0.115], [0, -0.155, -0.135], [0, -0.11, -0.1]];
  const pts = raw.map((p): V3 => [p[0], y0 + p[1] * s, p[2] * s]);
  b.sweep(curve(pts, PartBuilder.lod > 0 ? 8 : 12), (t) => ({ rx: r * 0.34 * (1 - 0.72 * t * t), rz: r * 0.3 * (1 - 0.72 * t * t), pow: 2, color: t > 0.6 ? shine : steel }), steel, { side: [1, 0, 0], segments: 6, round: "end" });
}

/**
 * Replaces the hand on an intact forearm: a leather cuff strapped over the end of the sleeve, a socket cup under the wrist and the hook. Forearm frame (hanging down from the elbow);
 * `armLength` is the forearm length. The cuff is a band on the sleeve's own rings, so it fits the arm whatever its thickness.
 */
export function hookHand(b: PartBuilder, c: BodyCtx, armLength: number): void {
  const r = c.P.armRadius;
  const leather = singe(c.leather, c.burnt);
  const rings = foreArmRings(c);
  const y0 = -armLength - CUFF_HANG;
  const cl = clothLift(r);
  const w = ringAt(rings, y0);
  bandOn(b, rings, y0 + 0.08, y0, leather, { lift: cl * 1.5, liftBottom: cl * 1.9, steps: 1, colorBottom: tone(leather, 0.8) });
  const kx = w.rx + cl * 1.9;
  const kz = w.rz + cl * 1.9;
  b.loft(
    [
      { y: y0 - 0.002, rx: kx, rz: kz, color: tone(leather, 0.9) },
      { y: y0 - 0.05, rx: kx * 0.96, rz: kz * 0.96, color: leather },
      { y: y0 - 0.1, rx: kx * 0.72, rz: kz * 0.72, color: tone(leather, 0.8) },
    ],
    leather,
    undefined,
    undefined,
    undefined,
    { capTop: false },
  );
  const surf = limbSurface(rings);
  for (const y of [y0 + 0.055, y0 + 0.015]) b.torus((kx + kz) * 0.5, 0.007, tone(c.accent, 0.9), [w.cx, y, w.cz], [Math.PI / 2, 0, 0], [kx / ((kx + kz) / 2), kz / ((kx + kz) / 2), 1]);
  const m = mountOn(surf, 0, y0 + 0.035, cl * 1.9 + 0.006);
  b.sphere(0.012, c.accent, m.pos, [1, 1, 0.6], m.rot);
  hook(b, c, Math.min(kx, kz) * 0.78, y0 - 0.1);
}

/**
 * The lower half of a prosthesis for a limb that has been lost, in the elbow / knee frame. Arm: a jointed iron forearm with a leather sleeve and
 * the hook. Leg: the peg, from the knee to the ground.
 */
export function buildProsthesis(c: BodyCtx, kind: "arm" | "leg", _side: "L" | "R"): BufferGeometry | undefined {
  const b = new PartBuilder();
  const { P } = c;
  if (kind === "leg") {
    pegShin(b, c, P.legLower);
    return b.build();
  }
  const r = P.armRadius;
  const iron = PALETTE.material.iron;
  const L = P.armLower;
  b.sphere(r * 0.6, c.accent, [0, 0, 0]); // brass elbow hinge
  b.loft([{ y: 0, rx: r * 0.4, rz: r * 0.4, color: tone(iron, 1.1) }, { y: -L * 0.8, rx: r * 0.32, rz: r * 0.32, color: iron }], iron);
  const leather = singe(c.leather, c.burnt);
  b.loft([{ y: -L * 0.05, rx: r * 0.82, rz: r * 0.8, color: leather }, { y: -L * 0.42, rx: r * 0.72, rz: r * 0.7, color: tone(leather, 0.9) }], leather);
  hook(b, c, r * 0.72, -L * 0.8);
  return b.build();
}

/**
 * What the stump of a lost limb carries when a prosthesis is fitted, in the shoulder or hip frame: a leather socket around the stub and a post down to
 * the elbow or knee (wood for a leg, iron for an arm) ending in a brass hinge. `end` is the stub's cross-section at the cut.
 */
export function stumpPost(b: PartBuilder, c: BodyCtx, kind: "arm" | "leg", cut: number, end: { rx: number; rz: number }): void {
  const len = kind === "arm" ? c.P.armUpper : c.P.legUpper;
  socket(b, c, { rx: end.rx * 1.1, rz: end.rz * 1.1 }, -cut - 0.02);
  const postC = kind === "leg" ? WOOD : PALETTE.material.iron;
  const pr = kind === "leg" ? end.rx * 0.42 : end.rx * 0.3;
  b.loft([{ y: -cut - 0.12, rx: pr, rz: pr, color: tone(postC, 1.05) }, { y: -len, rx: pr * 0.9, rz: pr * 0.9, color: postC }], postC);
  b.sphere(pr * 1.25, c.accent, [0, -len, 0]); // hinge
}
