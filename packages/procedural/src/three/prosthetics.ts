import type { BufferGeometry } from "three";
import { PALETTE } from "@cb/shared";
import { curve } from "./sweep.ts";
import { PartBuilder, SOOT, WOOD, singe, type V3 } from "./parts.ts";
import { tone, type BodyCtx } from "./bodyKit.ts";

/**
 * Prosthetics. Two looks come from the campaign history (both server-owned): a wooden leg (`woodenLeg`: 1 left, 2 right) and a hook (`hook`: 1 left,
 * 2 right). Each shows in two situations:
 *   - on an intact limb: the leg is wood from the knee down; the hand is replaced by a leather cuff and a hook (built into the leg / forearm meshes,
 *     see `pegShin` and `hookHand`);
 *   - where the limb has been lost (`rig.setMissing`): the stump is fitted with a leather socket and a post runs down to the elbow / knee (`stumpPost`);
 *     the lower half hangs from that joint (`buildProsthesis`), so a peg leg or an iron arm swings and bends with the animation.
 */

/** Wood from the knee down: a turned peg with a leather socket, a brass rim, an iron ferrule and a rubber tip. Knee frame, hanging down. */
export function pegShin(b: PartBuilder, c: BodyCtx, len: number): void {
  const r = 0.12 * c.P.scale + 0.02;
  const wl = len + c.footH;
  b.loft(
    [
      { y: 0.03, rx: r * 0.62, rz: r * 0.62, color: WOOD },
      { y: -wl * 0.35, rx: r * 0.5, rz: r * 0.5, color: tone(WOOD, 0.95) },
      { y: -wl * 0.75, rx: r * 0.4, rz: r * 0.4, color: tone(WOOD, 0.88) },
      { y: -wl + 0.03, rx: r * 0.36, rz: r * 0.36, color: tone(WOOD, 0.8) },
    ],
    WOOD,
  );
  socket(b, c, r, 0);
  b.cylinder(r * 0.42, r * 0.36, 0.05, PALETTE.material.iron, [0, -wl + 0.04, 0]); // iron ferrule
  b.cylinder(r * 0.44, r * 0.46, 0.03, SOOT, [0, -wl + 0.005, 0]); // rubber tip
}

/** A leather socket cup with a brass rim and two buckled straps, centred at height y0 on a limb of radius r. */
function socket(b: PartBuilder, c: BodyCtx, r: number, y0: number): void {
  const leather = singe(c.leather, c.burnt);
  b.loft(
    [
      { y: y0 + 0.06, rx: r * 0.98, rz: r * 0.95, color: tone(leather, 0.9) },
      { y: y0 - 0.02, rx: r * 0.92, rz: r * 0.9, color: leather },
      { y: y0 - 0.13, rx: r * 0.6, rz: r * 0.6, color: tone(leather, 0.85) },
    ],
    leather,
    undefined,
    undefined,
    undefined,
    { capBottom: false },
  );
  b.torus(r * 0.97, 0.008, c.accent, [0, y0 + 0.055, 0], [Math.PI / 2, 0, 0]);
  for (const y of [y0 - 0.01, y0 - 0.075]) b.box(r * 0.5, 0.018, 0.012, tone(leather, 0.7), [0, y, -r * 0.95]);
  b.sphere(0.011, c.accent, [0, y0 - 0.01, -r * 0.96 - 0.008]);
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
 * Replaces the hand on an intact forearm: a leather cuff strapped over the wrist and the hook. Forearm frame (hanging down from the elbow);
 * `armLength` is the forearm length.
 */
export function hookHand(b: PartBuilder, c: BodyCtx, armLength: number): void {
  const r = c.P.armRadius;
  const leather = singe(c.leather, c.burnt);
  const y0 = -armLength * 1.0;
  b.loft(
    [
      { y: y0 + 0.06, rx: r * 0.92, rz: r * 0.9, color: tone(leather, 0.9) },
      { y: y0 - 0.02, rx: r * 1.02, rz: r * 1.0, color: leather },
      { y: y0 - 0.1, rx: r * 0.82, rz: r * 0.8, color: tone(leather, 0.8) },
    ],
    leather,
  );
  for (const y of [y0 + 0.02, y0 - 0.04]) b.torus(r * 1.0, 0.007, tone(c.accent, 0.9), [0, y, 0], [Math.PI / 2, 0, 0]);
  b.sphere(0.012, c.accent, [0, y0 - 0.005, -r * 1.02]);
  hook(b, c, r * 0.62, y0 - 0.1);
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
  const r = Math.max(end.rx, end.rz);
  socket(b, c, r * 1.1, -cut - 0.02);
  const postC = kind === "leg" ? WOOD : PALETTE.material.iron;
  const pr = kind === "leg" ? end.rx * 0.42 : end.rx * 0.3;
  b.loft([{ y: -cut - 0.12, rx: pr, rz: pr, color: tone(postC, 1.05) }, { y: -len, rx: pr * 0.9, rz: pr * 0.9, color: postC }], postC);
  b.sphere(pr * 1.25, c.accent, [0, -len, 0]); // hinge
}
