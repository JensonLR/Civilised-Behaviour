/**
 * Colour-blind safe marks for the injury chart. Severity always has words beside it and a heavier outline; with the colour-blind option on it
 * also gets ink hatching (fill) and one mark per body zone whose SHAPE says how bad it is: one slash, two slashes, a cross, and a bar for a
 * lost limb. Pure, so the geometry is tested.
 */

/** Centre of each body zone in the chart's 40 x 88 viewBox, in ZONE order (head, torso, left arm, right arm, left leg, right leg). */
export const ZONE_CENTRES: readonly (readonly [number, number])[] = [
  [20, 9],
  [20, 33],
  [6, 33],
  [34, 33],
  [15, 67],
  [25, 67],
];

export const SEVERITY_SHAPES = ["none", "slash", "double slash", "cross", "bar"] as const;

const f = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path data for the mark on a zone at `severity` (0 none, 1 scratch, 2 gash, 3 grievous, 4 lost). Empty string for none. */
export function cuePath(severity: number, cx: number, cy: number): string {
  switch (severity) {
    case 1:
      return `M${f(cx - 2)} ${f(cy + 2.5)}L${f(cx + 2)} ${f(cy - 2.5)}`;
    case 2:
      return `M${f(cx - 3.2)} ${f(cy + 2.5)}L${f(cx - 0.4)} ${f(cy - 2.5)}M${f(cx + 0.4)} ${f(cy + 2.5)}L${f(cx + 3.2)} ${f(cy - 2.5)}`;
    case 3:
      return `M${f(cx - 3)} ${f(cy - 3)}L${f(cx + 3)} ${f(cy + 3)}M${f(cx + 3)} ${f(cy - 3)}L${f(cx - 3)} ${f(cy + 3)}`;
    case 4:
      return `M${f(cx - 3.5)} ${f(cy)}H${f(cx + 3.5)}`;
    default:
      return "";
  }
}

/** The pattern definitions the chart's hatched fills refer to (ids cb-hatch-1..3). Colours come from CSS classes, not from here. */
export const HATCH_DEFS = `<defs>
  <pattern id="cb-hatch-1" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hp-bg" width="6" height="6"/><line class="hp-line" x1="0" y1="0" x2="0" y2="6" stroke-width="1.1"/></pattern>
  <pattern id="cb-hatch-2" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hp-bg" width="4" height="4"/><line class="hp-line" x1="0" y1="0" x2="0" y2="4" stroke-width="1.2"/><line class="hp-line" x1="0" y1="0" x2="4" y2="0" stroke-width="1.2"/></pattern>
  <pattern id="cb-hatch-3" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hp-bg" width="3.2" height="3.2"/><line class="hp-line" x1="0" y1="0" x2="0" y2="3.2" stroke-width="1.35"/><line class="hp-line" x1="0" y1="0" x2="3.2" y2="0" stroke-width="1.35"/></pattern>
</defs>`;
