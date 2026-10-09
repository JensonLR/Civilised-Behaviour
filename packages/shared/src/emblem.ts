import { PALETTE, cssHex } from "./palette.ts";

/**
 * THE SOCIETY'S SEAL (D-053): the game's mark. A blot of red sealing wax pressed with the Imperial Cartographic & Improvement Society's die: a gilt ring, a compass
 * star and, over it, the expedition's pith helmet. It is the stamp the game already uses on its paper (the door, the ledger, the telegrams), made into a logo: it reads
 * at 16 px (the wax and the star), at a home-screen tile's 180 px (the helmet appears) and at a store capsule's size (the ticks of the bezel). Drawn as SVG from the
 * palette alone (no colour literal, by the palette rule); deterministic (no random: the wax's edge is a sum of sines). `scripts/icons.mts` renders every file a browser,
 * a phone, the desktop shell and the press kit ask for from these functions.
 */

export type EmblemDetail = "full" | "small";
export interface EmblemOptions {
  /** "small": the wax, the ring and the star only (a favicon: the helmet would be a smudge at 16-32 px). */
  detail?: EmblemDetail;
  /** Paint a square tile behind it (a home-screen or app icon cannot be transparent: iOS fills the gaps with black). */
  tile?: boolean;
  /** The seal's radius as a fraction of half the tile (default 0.86; a maskable Android icon keeps it inside the 80 % safe circle: 0.74). */
  scale?: number;
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The wax's edge: a circle pushed in and out by three sines (the lobes of a blot that was pressed while warm). Centre (cx, cy), base radius r. */
function waxPath(cx: number, cy: number, r: number): string {
  const n = 96;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * (1 + 0.035 * Math.sin(7 * a + 0.6) + 0.022 * Math.sin(11 * a + 1.9) + 0.012 * Math.sin(17 * a + 0.3));
    d += `${i ? "L" : "M"}${f(cx + Math.cos(a) * k)} ${f(cy + Math.sin(a) * k)}`;
  }
  return `${d}Z`;
}

/** A compass point: a kite from the centre, split down its spine into a lit half and a shaded half (the way an engraved rose is drawn). */
function point(cx: number, cy: number, angle: number, len: number, half: number, lit: string, shade: string): string {
  const tx = cx + Math.sin(angle) * len;
  const ty = cy - Math.cos(angle) * len;
  const lx = cx + Math.sin(angle - Math.PI / 2) * half;
  const ly = cy - Math.cos(angle - Math.PI / 2) * half;
  const rx = cx + Math.sin(angle + Math.PI / 2) * half;
  const ry = cy - Math.cos(angle + Math.PI / 2) * half;
  return `<path d="M${f(cx)} ${f(cy)}L${f(lx)} ${f(ly)}L${f(tx)} ${f(ty)}Z" fill="${lit}"/><path d="M${f(cx)} ${f(cy)}L${f(rx)} ${f(ry)}L${f(tx)} ${f(ty)}Z" fill="${shade}"/>`;
}

/** The pith helmet, side-on, centred at (cx, cy), `w` across the brim, tipped by `tilt` radians (a jaunty angle: the Society is pleased with itself). */
function helmet(cx: number, cy: number, w: number, tilt: number, c: { paper: string; paper2: string; under: string; band: string; ink: string }): string {
  const s = w / 220;
  const P = (x: number, y: number): string => `${f(x)} ${f(y)}`;
  const stroke = `stroke="${c.ink}" stroke-width="5" stroke-linejoin="round"`;
  // the brim: long, sloping down to a point at the front and the back, its underside showing below
  const under = `<path d="M${P(-110, 26)}C${P(-70, 4)} ${P(-30, 2)} ${P(0, 2)}C${P(30, 2)} ${P(70, 4)} ${P(110, 26)}`
    + `C${P(70, 22)} ${P(30, 26)} ${P(0, 26)}C${P(-30, 26)} ${P(-70, 22)} ${P(-110, 26)}Z" fill="${c.under}" ${stroke}/>`;
  const brim = `<path d="M${P(-110, 26)}C${P(-74, -2)} ${P(-34, -10)} ${P(0, -10)}C${P(34, -10)} ${P(74, -2)} ${P(110, 26)}`
    + `C${P(72, 8)} ${P(34, 4)} ${P(0, 4)}C${P(-34, 4)} ${P(-72, 8)} ${P(-110, 26)}Z" fill="${c.paper2}" ${stroke}/>`;
  // the crown: a tall egg, fuller at the back, rising to a rounded peak
  const crown = `<path d="M${P(-60, -4)}C${P(-64, -56)} ${P(-38, -104)} ${P(4, -106)}C${P(46, -104)} ${P(68, -58)} ${P(62, -4)}C${P(30, 2)} ${P(-28, 2)} ${P(-60, -4)}Z" fill="${c.paper}" ${stroke}/>`;
  // the pugaree, wound twice round the crown, and the small button on top
  const band = `<path d="M${P(-61, -8)}C${P(-62, -20)} ${P(-61, -28)} ${P(-59, -34)}C${P(-20, -26)} ${P(22, -26)} ${P(61, -34)}`
    + `C${P(63, -26)} ${P(63, -16)} ${P(62, -8)}C${P(22, -2)} ${P(-22, -2)} ${P(-61, -8)}Z" fill="${c.band}" ${stroke}/>`;
  const fold = `<path d="M${P(-58, -21)}C${P(-20, -14)} ${P(22, -14)} ${P(61, -21)}" fill="none" stroke="${c.ink}" stroke-width="3" opacity="0.6"/>`;
  const button = `<ellipse cx="4" cy="-106" rx="11" ry="6" fill="${c.band}" ${stroke}/>`;
  // a highlight down the lit side of the crown, so it reads as round
  const shine = `<path d="M${P(-38, -44)}C${P(-38, -72)} ${P(-22, -90)} ${P(-4, -96)}" fill="none" stroke="${c.paper2}" stroke-width="9" stroke-linecap="round"/>`;
  return `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f((tilt * 180) / Math.PI)}) scale(${f(s)})">${under}${brim}${crown}${shine}${band}${fold}${button}</g>`;
}

/** The seal as an SVG document, 512 x 512 (it scales: every size is drawn from this one). */
export function emblemSvg(o: EmblemOptions = {}): string {
  const u = PALETTE.ui;
  const ink = cssHex(u.ink), paper = cssHex(u.paper), paper2 = cssHex(u.paper2), brass = cssHex(u.brass), brassDark = cssHex(u.brassDark);
  const stamp = cssHex(u.stamp), stampDark = cssHex(u.stampDark), backdrop = cssHex(u.backdrop);
  const full = (o.detail ?? "full") === "full";
  const C = 256;
  const R = 256 * (o.scale ?? 0.86) * 0.93; // (0.93: the lobes stand out to about R * 1.07)
  const parts: string[] = [];
  if (o.tile) parts.push(`<rect width="512" height="512" fill="${backdrop}"/>`);
  // the wax: a shadow under it, the blot, and the pressed hollow the die left
  parts.push(`<path d="${waxPath(C + R * 0.02, C + R * 0.05, R)}" fill="${stampDark}"/>`);
  parts.push(`<path d="${waxPath(C, C, R)}" fill="${stamp}"/>`);
  parts.push(`<circle cx="${C}" cy="${C}" r="${f(R * 0.8)}" fill="${stampDark}" opacity="0.55"/>`);
  parts.push(`<circle cx="${C}" cy="${C}" r="${f(R * 0.76)}" fill="${stamp}"/>`);
  // the gilt ring of the die, and (full) the bezel's ticks, every eleven and a quarter degrees, the four quarters longer
  parts.push(`<circle cx="${C}" cy="${C}" r="${f(R * 0.72)}" fill="none" stroke="${brass}" stroke-width="${f(R * (full ? 0.035 : 0.07))}"/>`);
  if (full) {
    parts.push(`<circle cx="${C}" cy="${C}" r="${f(R * 0.62)}" fill="none" stroke="${brassDark}" stroke-width="${f(R * 0.012)}"/>`);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r0 = R * (i % 8 === 0 ? 0.6 : 0.64);
      const r1 = R * 0.69;
      parts.push(`<line x1="${f(C + Math.sin(a) * r0)}" y1="${f(C - Math.cos(a) * r0)}" x2="${f(C + Math.sin(a) * r1)}" y2="${f(C - Math.cos(a) * r1)}"`
        + ` stroke="${brass}" stroke-width="${f(R * (i % 8 === 0 ? 0.022 : 0.012))}" stroke-linecap="round"/>`);
    }
  }
  if (full) {
    // the compass is the die's bezel: four brass points on the ring, north the longest (no needle through the crown: a spike on a helmet is a real army's mark, not ours)
    for (const [a, len] of [[0, 0.2], [Math.PI / 2, 0.13], [Math.PI, 0.13], [(3 * Math.PI) / 2, 0.13]] as const) {
      const out = R * (0.72 + len * 0.55);
      const inn = R * 0.6;
      const half = R * 0.055;
      const tip = { x: C + Math.sin(a) * out, y: C - Math.cos(a) * out };
      const l = { x: C + Math.sin(a) * inn + Math.cos(a) * half, y: C - Math.cos(a) * inn + Math.sin(a) * half };
      const r = { x: C + Math.sin(a) * inn - Math.cos(a) * half, y: C - Math.cos(a) * inn - Math.sin(a) * half };
      const mid = { x: C + Math.sin(a) * inn, y: C - Math.cos(a) * inn };
      parts.push(`<path d="M${f(mid.x)} ${f(mid.y)}L${f(l.x)} ${f(l.y)}L${f(tip.x)} ${f(tip.y)}Z" fill="${a === 0 ? paper : brass}"/>`
        + `<path d="M${f(mid.x)} ${f(mid.y)}L${f(r.x)} ${f(r.y)}L${f(tip.x)} ${f(tip.y)}Z" fill="${a === 0 ? paper2 : brassDark}"/>`);
    }
    // the helmet in the middle of the die, tipped back a little
    parts.push(helmet(C, C + R * 0.14, R * 1.06, -0.14, { paper, paper2, under: brassDark, band: stamp, ink }));
  } else {
    // a favicon: the compass star alone (the helmet would be a smudge at 16-32 px)
    const star = (len: number, half: number, at: number[]): void => {
      for (const a of at) parts.push(point(C, C, a, len, half, a === 0 ? paper : brass, a === 0 ? paper2 : brassDark));
    };
    star(R * 0.62, R * 0.16, [0, Math.PI]);
    star(R * 0.5, R * 0.16, [Math.PI / 2, (3 * Math.PI) / 2]);
    parts.push(`<circle cx="${C}" cy="${C}" r="${f(R * 0.09)}" fill="${ink}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${parts.join("")}</svg>`;
}

/** The colours a web manifest and a browser's chrome ask for (the tile and the theme). */
export const emblemColours = (): { background: string; theme: string } => ({ background: cssHex(PALETTE.ui.backdrop), theme: cssHex(PALETTE.ui.backdrop) });
