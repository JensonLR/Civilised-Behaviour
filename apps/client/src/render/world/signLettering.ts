/**
 * Signboard lettering, one rule for every region's atlas. A sign is a long, low board (512 x 96 in the atlas): a short line is set large on one line,
 * centred; a long one, which on one line shrank to a third of the board's height and could not be read past a few metres, is split at the sentence
 * break nearest its middle (else the word break) and set on two lines, whichever of the two layouts gives the bigger letters. Pure layout
 * (`signLayout`, given a measure) and the drawing (`letterSign`).
 */
export const signFont = (px: number): string => `${px}px "IM Fell English SC", "IM Fell English", serif`;
const ONE_MAX = 48;
const TWO_MAX = 40;
const MIN = 14;

export interface SignLayout {
  lines: string[];
  px: number;
}

/** The biggest size, from `max` down in 2 px steps, at which every line fits `width` (`measure` gives a line's width at a size). */
function fitAll(lines: readonly string[], max: number, width: number, measure: (line: string, px: number) => number): number {
  let px = max;
  while (px > MIN && lines.some((l) => measure(l, px) > width)) px -= 2;
  return px;
}

export function signLayout(text: string, width: number, measure: (line: string, px: number) => number): SignLayout {
  const one = fitAll([text], ONE_MAX, width, measure);
  const mid = text.length / 2;
  const cuts: number[] = [];
  for (let k = text.indexOf(". "); k >= 0; k = text.indexOf(". ", k + 1)) cuts.push(k + 1);
  const space = text.lastIndexOf(" ", Math.floor(mid));
  const cut = cuts.length ? cuts.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : space;
  if (cut <= 0) return { lines: [text], px: one };
  const lines = [text.slice(0, cut).trim(), text.slice(cut).trim()];
  const two = fitAll(lines, TWO_MAX, width, measure);
  return two > one ? { lines, px: two } : { lines: [text], px: one };
}

/** Letters `text` centred on the strip at (x, y, w, h), in the current fill style. */
export function letterSign(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number): void {
  const layout = signLayout(text, w - 40, (line, px) => {
    ctx.font = signFont(px);
    return ctx.measureText(line).width;
  });
  ctx.font = signFont(layout.px);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (layout.lines.length === 1) ctx.fillText(text, x + w / 2, y + h / 2 + 2);
  else {
    ctx.fillText(layout.lines[0]!, x + w / 2, y + h * 0.3 + 1);
    ctx.fillText(layout.lines[1]!, x + w / 2, y + h * 0.7 + 1);
  }
}
