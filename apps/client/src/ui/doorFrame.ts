/**
 * Where the figure behind the front door stands on screen (D-098). The door's panels cover part of the picture: on a PC the charter is on the left and the creator on the right; on a
 * phone held upright the charter sits at the foot of the screen; held sideways it sits on the left. The figure goes in the largest band of the picture no panel covers, as large as it
 * looked before (two fifths of the screen's height) or smaller when the band is short, and stays where it was when no band can hold it.
 */

/** A rectangle on screen, in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The figure's centre (as a share of the screen's width and height, from the top left) and its height as a share of the screen's. */
export interface FigureFocus {
  cx: number;
  cy: number;
  size: number;
}

/** The framing the preview was designed at: in the middle, two fifths of the screen tall. */
export const FIGURE_DEFAULT: FigureFocus = { cx: 0.5, cy: 0.5, size: 0.4 };

/** The figure's width over its height, with a little air (a hat brim, the arms at its sides). */
const ASPECT = 0.5;
/** How much of its band it may fill (a hat stands above the height the figure reports, so there is a margin over it). */
const FILL = 0.78;
/** Smaller than this share of the screen's height and the figure is not worth moving for. */
const SMALLEST = 0.18;

/** The stretches of [0, len] that none of `spans` covers. */
function gaps(len: number, spans: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = spans.map(([a, b]) => [Math.max(0, a), Math.min(len, b)] as const).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < len) out.push([at, len]);
  return out;
}

/** The figure's place on a `w` by `h` screen with `panels` over it (see the file comment). */
export function figureFocus(w: number, h: number, panels: readonly Box[]): FigureFocus {
  if (!(w > 0 && h > 0)) return FIGURE_DEFAULT;
  let best: FigureFocus | undefined;
  let bestH = 0;
  const consider = (cx: number, cy: number, tall: number): void => {
    if (tall > bestH) {
      bestH = tall;
      best = { cx: cx / w, cy: cy / h, size: Math.min(FIGURE_DEFAULT.size, tall / h) };
    }
  };
  // a band the full height of the screen beside the panels, or the full width above or below them
  for (const [a, b] of gaps(w, panels.map((p) => [p.left, p.right] as const))) consider((a + b) / 2, h / 2, Math.min(h * FILL, ((b - a) * FILL) / ASPECT));
  for (const [a, b] of gaps(h, panels.map((p) => [p.top, p.bottom] as const))) consider(w / 2, (a + b) / 2, Math.min((b - a) * FILL, (w * FILL) / ASPECT));
  return best && best.size >= SMALLEST ? best : FIGURE_DEFAULT;
}
