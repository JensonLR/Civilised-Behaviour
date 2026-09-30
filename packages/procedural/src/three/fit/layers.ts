/**
 * Layer constants shared by the wearables and the fit audit, so layers stack with the same gaps on every body.
 *
 * Everything a wearable sits on is the body's WORN surface (the torso / sleeve / trouser loft: the outermost garment, `bodyField.wornTorso` etc.). A piece is placed by
 * projecting onto that surface and lifting it along the surface normal by `LAYER[kind]`: the centre-line offset of a piece of standard thickness (about 8-10 mm), which
 * leaves ~2 mm of clear surface under it (no z-fighting, no visible seam) whatever the size of the body. Stack order, innermost first:
 *
 *   skin -> shirt (the torso loft when no coat) -> waistcoat / vest -> coat (the torso loft) -> patch -> facing -> band / strap -> trim -> mount (hard) -> pack
 */
export const LAYER = {
  /** Cloth laid directly on the worn surface: waistcoat fronts, shirt fronts, lapel bases (patches). */
  patch: 0.006,
  /** Facings, collar falls, epaulette pads: one step above a patch. */
  facing: 0.01,
  /** Wraps round the trunk (belts, cummerbunds, waist sashes): the wrap's centre line. */
  band: 0.011,
  /** Ribbons and straps laid across the trunk (sashes, cross belts, bandoliers, pack straps): their centre line. */
  strap: 0.011,
  /** Piping, frogging, rolled edges, cords: on top of a facing or a patch. */
  trim: 0.014,
  /** Hard pieces mounted on the cloth (buckles, medals, buttons, badges): the centre of a piece ~1.5 cm thick, so its back is sunk 1 cm into the cloth. */
  mount: 0.018,
  /** The seat of a pack or a hanging load: the pack body's inner face sits this far from the surface (straps run beneath it). */
  pack: 0.03,
} as const;

export type LayerKind = keyof typeof LAYER;

/** The fit audit's tolerances (metres). The builders should aim well inside them; the ratchet in `fit.test.ts` lowers the thresholds as fixes land. */
export const FIT_TOL = {
  /** A cloth piece (loft, sweep, patch) may sink this far into the layer beneath it before it counts as clipping. */
  cloth: 0.015,
  /** A strap, ribbon or thin band laid ON the outermost garment may sink this far into it (it is 2 mm clear by construction). */
  strap: 0.008,
  /** A hard piece (button, buckle, plate, tool) may sink its own half thickness plus this. */
  hard: 0.005,
  /** A part that must touch (strap, pack, badge) must be within this of the body or of another part of its bone. */
  float: 0.012,
  /** Clipping that only appears in a pose (an arm through a skirt): new penetration beyond the rest pose. */
  pose: 0.015,
} as const;
