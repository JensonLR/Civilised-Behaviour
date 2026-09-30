import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { HILL, PALETTE, RIVER, TRAILS, VILLAGE_SIGNS, cssHex, riverCentre } from "@cb/shared";

/**
 * Runtime-drawn ephemera textures (no image assets): the Society's pennant and the signpost's board lettering share one canvas
 * atlas, so the flag and every sign are ONE draw call. Lettering is IM Fell English SC, bundled with the game; the atlas is
 * redrawn once the font finishes loading so it never bakes in a fallback face.
 */

export const ATLAS_W = 512;
export const MAP_H = 320;
export const FLAG_H = 256;
export const BOARD_H = 96;
export const BOARD_TEXT = ["THE INTERIOR (unimproved)", "LATRINE - approved pattern", "SOCIETY CLUB, LONDON  4,112 mi", "TO THE COAST (see Form 7)"] as const;

// The atlas, top to bottom: pennant, the four signboards, the survey map, HOLLOWMERE's boards, the gate clock's dial and the Society's crest, the two
// heraldic banners, the HQ notice board, the crate stencils. All drawn at runtime from palette colours in the bundled IM Fell faces.
const BOARDS_Y = FLAG_H;
const MAP_Y = BOARDS_Y + BOARD_H * BOARD_TEXT.length;
const VSIGN_H = 96;
export const VSIGN_Y = MAP_Y + MAP_H;
const CLOCK_Y = VSIGN_Y + VILLAGE_SIGNS.length * VSIGN_H;
const CLOCK_H = 256;
const ARMS_Y = CLOCK_Y + CLOCK_H;
const ARMS_H = 384;
const NOTICE_Y = ARMS_Y + ARMS_H;
const NOTICE_H = 256;
const STENCIL_Y = NOTICE_Y + NOTICE_H;
/** Four crate stencils, two lines each, in a 2 x 2 block of 256 x 128 tiles. */
export const STENCIL_TEXT = [
  ["THEODOLITES (2)", "HANDLE WITH OPTIMISM"],
  ["TINNED HOPE x24", "BEST BEFORE ARRIVAL"],
  ["SOCIETY PROPERTY", "NOT FOR NATIVES"],
  ["FRAGILE:", "THE COLONEL'S DIGNITY"],
] as const;
export const ATLAS_H = STENCIL_Y + 256;
/** Bunting swatches: four flat colours (Society red, cream, gilt, river blue) in the free strip beside the first signboard. */
export const swatchUv = (i: number): Rect => rectUv(432 + i * 18 + 3, 303, 10, 10);

export type Rect = readonly [number, number, number, number];
/** A canvas rectangle (x, y, w, h in pixels from the top-left) as a UV rectangle (u0, v0, u1, v1; v = 1 is the top). */
const rectUv = (x: number, y: number, w: number, h: number): Rect => [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];

/** UV rectangle of the pinned survey map. */
export const MAP_UV: Rect = rectUv(0, MAP_Y, ATLAS_W, MAP_H);
/** A small opaque white patch: cloth (shirts, hammock) samples it so its vertex colour is the whole colour. UV centre. */
export const WHITE_UV = [0.955, 1 - 279 / ATLAS_H] as const;

/** UV rectangle (u0, v0, u1, v1) of the pennant. v = 1 is the top of the canvas. */
export const FLAG_UV: Rect = rectUv(0, 0, ATLAS_W, FLAG_H);
export function boardUv(i: number): Rect {
  return rectUv(0, BOARDS_Y + i * BOARD_H, ATLAS_W, BOARD_H);
}
/** HOLLOWMERE's boards (`VILLAGE_SIGNS[i]`), 512 x 96 each (aspect 5.33:1). */
export const VSIGN_ASPECT = ATLAS_W / VSIGN_H;
export const vsignUv = (i: number): Rect => rectUv(0, VSIGN_Y + i * VSIGN_H, ATLAS_W, VSIGN_H);
/** The gate clock's dial (round, transparent outside), and the Society's crest (a square, transparent outside its shield). */
export const CLOCK_UV: Rect = rectUv(0, CLOCK_Y, 256, CLOCK_H);
export const CREST_UV: Rect = rectUv(256, CLOCK_Y, 256, CLOCK_H);
/** The Society's arms as a hanging banner, and Hollowmere's. 256 x 384 each. */
export const ARMS_SOCIETY_UV: Rect = rectUv(0, ARMS_Y, 256, ARMS_H);
export const ARMS_LOCAL_UV: Rect = rectUv(256, ARMS_Y, 256, ARMS_H);
/** The expedition's notice board, 512 x 256. */
export const NOTICE_UV: Rect = rectUv(0, NOTICE_Y, ATLAS_W, NOTICE_H);
export const NOTICE_ASPECT = ATLAS_W / NOTICE_H;
/** A crate stencil (`STENCIL_TEXT[i]`), 256 x 128 (aspect 2:1). */
export const stencilUv = (i: number): Rect => rectUv((i % 2) * 256, STENCIL_Y + Math.floor(i / 2) * 128, 256, 128);

function drawFlag(ctx: CanvasRenderingContext2D): void {
  const C = PALETTE.camp;
  ctx.fillStyle = cssHex(C.flagCloth);
  ctx.fillRect(0, 0, ATLAS_W, FLAG_H);
  // swallow-tail is cut by the geometry; a cream border and a compass rose near the hoist
  ctx.strokeStyle = cssHex(C.flagMark);
  ctx.lineWidth = 7;
  ctx.strokeRect(10, 10, ATLAS_W - 20, FLAG_H - 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, ATLAS_W - 44, FLAG_H - 44);
  const cx = 138;
  const cy = FLAG_H / 2;
  ctx.fillStyle = cssHex(C.flagMark);
  ctx.strokeStyle = cssHex(C.flagMark);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.stroke();
  const point = (ang: number, len: number, halfW: number, fill: string): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.lineTo(cx + Math.cos(ang + Math.PI / 2) * halfW, cy + Math.sin(ang + Math.PI / 2) * halfW);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = cssHex(C.canvasShade);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.lineTo(cx + Math.cos(ang - Math.PI / 2) * halfW, cy + Math.sin(ang - Math.PI / 2) * halfW);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, 48, 11, cssHex(C.flagMark));
  for (let i = 0; i < 4; i++) point((i * Math.PI) / 2 - Math.PI / 2, 100, 17, i === 0 ? cssHex(C.brass) : cssHex(C.flagMark));
  ctx.fillStyle = cssHex(C.flagCloth);
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssHex(C.flagMark);
  ctx.font = '28px "IM Fell English SC", serif';
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy - 106);
  // motto in the fly
  ctx.font = '21px "IM Fell English SC", serif';
  ctx.fillText("IMPROVEMENT", 300, cy - 8);
  ctx.font = '15px "IM Fell English SC", serif';
  ctx.fillText("WHERE NOT YET REQUESTED", 300, cy + 18);
}

function drawBoards(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, BOARDS_Y, ATLAS_W, BOARD_H * BOARD_TEXT.length);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  BOARD_TEXT.forEach((text, i) => {
    const y = BOARDS_Y + i * BOARD_H;
    ctx.strokeStyle = cssHex(PALETTE.camp.signPaint);
    ctx.lineWidth = 3;
    ctx.strokeRect(5, y + 6, ATLAS_W * 0.8, BOARD_H - 12);
    ctx.fillStyle = cssHex(PALETTE.camp.signPaint);
    let size = 40;
    ctx.font = `${size}px "IM Fell English SC", serif`;
    const maxW = ATLAS_W * 0.8 - 26;
    while (ctx.measureText(text).width > maxW && size > 14) {
      size -= 2;
      ctx.font = `${size}px "IM Fell English SC", serif`;
    }
    ctx.fillText(text, 5 + (ATLAS_W * 0.8) / 2, y + BOARD_H / 2 + 2);
  });
}

/** The Society's survey of the interior, drawn from the real trails, stream and hill so the pinned map is accurate (as far as anything the Society does is). */
function drawMap(ctx: CanvasRenderingContext2D): void {
  const y0 = MAP_Y;
  const W = ATLAS_W;
  const H = MAP_H;
  const ink = cssHex(PALETTE.ink);
  const C = PALETTE.camp;
  const Wd = PALETTE.world;
  ctx.save();
  ctx.translate(0, y0);
  ctx.fillStyle = cssHex(C.mapPaper);
  ctx.fillRect(0, 0, W, H);
  // land wash and sea
  const mx = (x: number): number => W / 2 + (x / 100) * (W * 0.46);
  const my = (z: number): number => 42 + ((z + 100) / 200) * (H - 66);
  ctx.fillStyle = cssHex(C.mapWash);
  ctx.beginPath();
  ctx.ellipse(mx(0), my(0), W * 0.42, (H - 66) * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssHex(C.mapSea);
  ctx.fillRect(0, my(78), W, H);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 9; i++) {
    const wx = 30 + i * 52;
    ctx.beginPath();
    ctx.moveTo(wx, my(88));
    ctx.quadraticCurveTo(wx + 8, my(85), wx + 16, my(88));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // the hill, hachured
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  for (let r = 34; r > 6; r -= 7) {
    ctx.beginPath();
    ctx.ellipse(mx(HILL.x), my(HILL.z), (r / 100) * W * 0.46, (r / 100) * (H - 66) * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // the stream and pond
  ctx.strokeStyle = cssHex(Wd.waterDeep);
  ctx.lineWidth = 3;
  ctx.beginPath();
  const c = { x: 0, z: 0 };
  for (let s = 0; s <= RIVER.length; s += 2) {
    riverCentre(s, c);
    if (s === 0) ctx.moveTo(mx(c.x), my(c.z));
    else ctx.lineTo(mx(c.x), my(c.z));
  }
  ctx.stroke();
  ctx.fillStyle = cssHex(Wd.waterDeep);
  ctx.beginPath();
  ctx.ellipse(mx(RIVER.b.x), my(RIVER.b.z), 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // trails: the Observatory way is dotted in stamp red, the others in brown
  ctx.lineCap = "round";
  for (const t of TRAILS) {
    if (t.width < 1.3) continue;
    ctx.strokeStyle = t.name === "observatory" ? cssHex(C.canvasTrim) : cssHex(Wd.trailWorn);
    ctx.lineWidth = t.name === "observatory" ? 2.4 : 1.6;
    ctx.setLineDash(t.name === "observatory" ? [2, 5] : [6, 4]);
    ctx.beginPath();
    for (let i = 0; i + 1 < t.line.length; i += 2) {
      const px = mx(t.line[i]!);
      const py = my(t.line[i + 1]!);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // camp: a tiny tent, and the Observatory: a colonnade mark and a cross for the summit
  ctx.fillStyle = cssHex(C.canvas);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(mx(0) - 8, my(3));
  ctx.lineTo(mx(0), my(3) - 11);
  ctx.lineTo(mx(0) + 8, my(3));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = cssHex(Wd.ruinPale);
  ctx.fillRect(mx(HILL.x) - 8, my(HILL.z) - 6, 16, 12);
  ctx.strokeRect(mx(HILL.x) - 8, my(HILL.z) - 6, 16, 12);
  for (let i = 0; i < 4; i++) ctx.fillRect(mx(HILL.x) - 6 + i * 4, my(HILL.z) - 11, 2, 6);
  ctx.fillStyle = cssHex(C.canvasTrim);
  ctx.font = 'bold 20px "IM Fell English SC", serif';
  ctx.textAlign = "center";
  ctx.fillText("X", mx(HILL.x) + 22, my(HILL.z) + 4);
  // lettering
  ctx.fillStyle = ink;
  ctx.font = '15px "IM Fell English SC", serif';
  ctx.fillText("SURVEY OF THE INTERIOR", W / 2, 20);
  ctx.font = 'italic 11px "IM Fell English", serif';
  ctx.fillText("(incomplete; the remainder to be improved)", W / 2, 33);
  ctx.font = '11px "IM Fell English SC", serif';
  ctx.fillText("CAMP", mx(0), my(3) + 14);
  ctx.fillText("OBSERVATORY (ruins)", mx(HILL.x) - 6, my(HILL.z) + 24);
  ctx.fillText("THE FORD", mx(17) - 30, my(-28) - 6);
  ctx.fillText("THE SEA", W * 0.5, my(90));
  // border and a compass rose
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.lineWidth = 1;
  ctx.strokeRect(9, 9, W - 18, H - 18);
  ctx.translate(W - 44, H - 74);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22);
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a + Math.PI / 4) * 10, Math.sin(a + Math.PI / 4) * 10);
  }
  ctx.stroke();
  ctx.font = '12px "IM Fell English SC", serif';
  ctx.fillText("N", 0, -26);
  ctx.restore();
}


// ---- HOLLOWMERE's boards, the clock, the heraldry, the notice board, the crate stencils -----------------------------------------------------------

const FACE_SC = '"IM Fell English SC", serif';
const FACE = '"IM Fell English", serif';

/** Sets the largest font (down from `size`) at which `text` fits `maxW`, and returns the size. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, face: string, style = ""): number {
  let px = size;
  ctx.font = `${style}${px}px ${face}`;
  while (ctx.measureText(text).width > maxW && px > 10) {
    px -= 2;
    ctx.font = `${style}${px}px ${face}`;
  }
  return px;
}

function drawSunDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35);
    ctx.lineTo(cx + Math.cos(a) * r * (i % 2 ? 1.65 : 1.9), cy + Math.sin(a) * r * (i % 2 ? 1.65 : 1.9));
    ctx.stroke();
  }
}

/** The village's boards: a painted board each (blue and gold for the name, cream and red for the plea, weathered timber for trade). */
function drawVillageSigns(ctx: CanvasRenderingContext2D): void {
  const W = PALETTE.world;
  VILLAGE_SIGNS.forEach((text, i) => {
    const y = VSIGN_Y + i * VSIGN_H;
    const style = i === 0 ? "name" : i === 1 ? "plea" : i === 7 ? "clock" : "trade";
    const bg = style === "name" ? W.vlHeraldBlue : style === "plea" ? W.vlAwningCream : style === "clock" ? W.vlPlaster : i % 2 ? W.plank : W.plankDark;
    const fg = style === "name" ? W.vlHeraldGold : style === "plea" ? W.vlAwningRed : style === "clock" ? W.vlTimber : W.vlAwningCream;
    ctx.fillStyle = cssHex(bg);
    ctx.fillRect(0, y, ATLAS_W, VSIGN_H);
    // planks
    ctx.strokeStyle = cssHex(W.vlTimber);
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 2;
    for (let k = 1; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(0, y + (k * VSIGN_H) / 3);
      ctx.lineTo(ATLAS_W, y + (k * VSIGN_H) / 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssHex(fg);
    ctx.lineWidth = 4;
    ctx.strokeRect(7, y + 7, ATLAS_W - 14, VSIGN_H - 14);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(13, y + 13, ATLAS_W - 26, VSIGN_H - 26);
    ctx.fillStyle = cssHex(fg);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (style === "name") {
      drawSunDisc(ctx, 70, y + VSIGN_H / 2, 15, cssHex(fg));
      drawSunDisc(ctx, ATLAS_W - 70, y + VSIGN_H / 2, 15, cssHex(fg));
      fitText(ctx, text, ATLAS_W - 250, 60, FACE_SC);
      ctx.fillText(text, ATLAS_W / 2, y + VSIGN_H / 2 + 3);
    } else {
      // long signs break into two lines at " - " or on the middle space
      const brk = text.indexOf(" - ");
      const lines = text.length > 26 ? (brk > 0 ? [text.slice(0, brk), text.slice(brk + 3)] : [text.slice(0, text.lastIndexOf(" ", text.length / 2 + 4)), text.slice(text.lastIndexOf(" ", text.length / 2 + 4) + 1)]) : [text];
      if (lines.length === 1) {
        fitText(ctx, lines[0]!, ATLAS_W - 60, 50, FACE_SC);
        ctx.fillText(lines[0]!, ATLAS_W / 2, y + VSIGN_H / 2 + 3);
      } else {
        const px = Math.min(fitText(ctx, lines[0]!, ATLAS_W - 60, 34, FACE_SC), fitText(ctx, lines[1]!, ATLAS_W - 60, 34, FACE_SC));
        ctx.font = `${px}px ${FACE_SC}`;
        ctx.fillText(lines[0]!, ATLAS_W / 2, y + VSIGN_H / 2 - px * 0.55);
        ctx.fillText(lines[1]!, ATLAS_W / 2, y + VSIGN_H / 2 + px * 0.6);
      }
    }
  });
}

/** The gate clock's dial (round, cream, numerals in soot) and the Society's crest tile (a round brass seal with a compass rose). */
function drawClock(ctx: CanvasRenderingContext2D): void {
  const W = PALETTE.world;
  const C = PALETTE.camp;
  ctx.save();
  ctx.translate(0, CLOCK_Y);
  const cx = 128;
  const cy = 128;
  ctx.fillStyle = cssHex(W.vlPlaster);
  ctx.beginPath();
  ctx.arc(cx, cy, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = cssHex(W.vlSoot);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 116, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = cssHex(W.vlSoot);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `26px ${FACE_SC}`;
  const romans = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  romans.forEach((n, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(n, cx + Math.cos(a) * 96, cy + Math.sin(a) * 96);
  });
  // a small sun-disc under XII and the maker's line
  drawSunDisc(ctx, cx, cy - 46, 7, cssHex(W.vlHeraldGold));
  ctx.font = `italic 13px ${FACE}`;
  ctx.fillText("Never Late", cx, cy + 46);
  ctx.restore();
  // the Society's seal
  ctx.save();
  ctx.translate(256, CLOCK_Y);
  ctx.fillStyle = cssHex(C.brass);
  ctx.beginPath();
  ctx.arc(cx, cy, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssHex(C.flagCloth);
  ctx.beginPath();
  ctx.arc(cx, cy, 104, 0, Math.PI * 2);
  ctx.fill();
  drawRose(ctx, cx, cy, 82, cssHex(C.flagMark), cssHex(C.brass));
  ctx.restore();
}

function drawRose(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, light: string, dark: string): void {
  const point = (ang: number, len: number, halfW: number): void => {
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.lineTo(cx + Math.cos(ang + Math.PI / 2) * halfW, cy + Math.sin(ang + Math.PI / 2) * halfW);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.lineTo(cx + Math.cos(ang - Math.PI / 2) * halfW, cy + Math.sin(ang - Math.PI / 2) * halfW);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  };
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, r * 0.6, r * 0.14);
  for (let i = 0; i < 4; i++) point((i * Math.PI) / 2 - Math.PI / 2, r, r * 0.2);
}

/** Two hanging banners with swallow-tails: the Society's arms (a quartered shield: compass rose, surveyor's chain, a spade, a teacup; motto on a scroll) and Hollowmere's (a gold sun over a blue river with a bridge). */
function drawArms(ctx: CanvasRenderingContext2D): void {
  const C = PALETTE.camp;
  const W = PALETTE.world;
  // the Society
  ctx.save();
  ctx.translate(0, ARMS_Y);
  const tail = (w: number, h: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(w - 6, 0);
    ctx.lineTo(w - 6, h - 46);
    ctx.lineTo(w / 2, h - 90);
    ctx.lineTo(6, h - 46);
    ctx.closePath();
    ctx.fill();
  };
  tail(256, ARMS_H, cssHex(C.flagCloth));
  ctx.strokeStyle = cssHex(C.flagMark);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(16, 10);
  ctx.lineTo(240, 10);
  ctx.lineTo(240, ARMS_H - 60);
  ctx.lineTo(128, ARMS_H - 100);
  ctx.lineTo(16, ARMS_H - 60);
  ctx.closePath();
  ctx.stroke();
  // shield
  const sx = 40;
  const sy = 40;
  const sw = 176;
  const sh = 190;
  ctx.fillStyle = cssHex(C.flagMark);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + sw, sy);
  ctx.lineTo(sx + sw, sy + sh * 0.6);
  ctx.quadraticCurveTo(sx + sw, sy + sh, sx + sw / 2, sy + sh);
  ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  const quad = (qx: number, qy: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(sx + qx * (sw / 2), sy + qy * (sh / 2), sw / 2, sh / 2);
  };
  quad(0, 0, cssHex(W.vlHeraldBlue));
  quad(1, 1, cssHex(W.vlHeraldBlue));
  quad(1, 0, cssHex(C.mapWash));
  quad(0, 1, cssHex(C.mapWash));
  drawRose(ctx, sx + sw / 4, sy + sh / 4, 34, cssHex(C.flagMark), cssHex(C.canvasShade));
  // surveyor's chain: interlocked links
  ctx.strokeStyle = cssHex(W.vlHeraldGold);
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    ctx.strokeRect(sx + sw * 0.56 + i * 9, sy + 22 + i * 14, 16, 9);
  }
  // spade
  ctx.fillStyle = cssHex(C.canvasShade);
  ctx.fillRect(sx + sw / 4 - 3, sy + sh / 2 + 16, 6, 44);
  ctx.beginPath();
  ctx.moveTo(sx + sw / 4 - 16, sy + sh / 2 + 56);
  ctx.lineTo(sx + sw / 4 + 16, sy + sh / 2 + 56);
  ctx.lineTo(sx + sw / 4, sy + sh - 14);
  ctx.closePath();
  ctx.fill();
  // teacup with steam
  ctx.fillStyle = cssHex(C.flagMark);
  ctx.beginPath();
  ctx.arc(sx + (sw * 3) / 4, sy + sh * 0.68, 20, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = cssHex(C.flagMark);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx + (sw * 3) / 4 + 20, sy + sh * 0.68 + 4, 8, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + (sw * 3) / 4 - 6, sy + sh * 0.68 - 6);
  ctx.quadraticCurveTo(sx + (sw * 3) / 4 - 14, sy + sh * 0.68 - 22, sx + (sw * 3) / 4 - 4, sy + sh * 0.68 - 34);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = cssHex(C.brass);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + sw, sy);
  ctx.lineTo(sx + sw, sy + sh * 0.6);
  ctx.quadraticCurveTo(sx + sw, sy + sh, sx + sw / 2, sy + sh);
  ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh * 0.6);
  ctx.closePath();
  ctx.stroke();
  // scroll and motto
  ctx.fillStyle = cssHex(C.flagMark);
  ctx.fillRect(28, ARMS_H - 138, 200, 44);
  ctx.fillStyle = cssHex(C.flagCloth);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `18px ${FACE_SC}`;
  ctx.fillText("IMPROVEMENT", 128, ARMS_H - 125);
  ctx.font = `13px ${FACE_SC}`;
  ctx.fillText("WHERE NOT YET REQUESTED", 128, ARMS_H - 105);
  ctx.restore();
  // Hollowmere
  ctx.save();
  ctx.translate(256, ARMS_Y);
  tail(256, ARMS_H, cssHex(W.vlHeraldBlue));
  ctx.strokeStyle = cssHex(W.vlHeraldGold);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(16, 10);
  ctx.lineTo(240, 10);
  ctx.lineTo(240, ARMS_H - 60);
  ctx.lineTo(128, ARMS_H - 100);
  ctx.lineTo(16, ARMS_H - 60);
  ctx.closePath();
  ctx.stroke();
  drawSunDisc(ctx, 128, 110, 42, cssHex(W.vlHeraldGold));
  // a river under the sun and a bridge of three arches over it
  ctx.strokeStyle = cssHex(W.waterGlint);
  ctx.lineWidth = 5;
  for (let r2 = 0; r2 < 3; r2++) {
    ctx.beginPath();
    for (let x = 34; x <= 222; x += 6) {
      const y = 214 + r2 * 20 + Math.sin(x * 0.09 + r2) * 6;
      if (x === 34) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = cssHex(W.vlAwningCream);
  ctx.fillRect(40, 196, 176, 10);
  for (let a2 = 0; a2 < 3; a2++) {
    ctx.beginPath();
    ctx.arc(72 + a2 * 56, 206, 20, 0, Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = cssHex(W.vlAwningCream);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `20px ${FACE_SC}`;
  ctx.fillText("HOLLOWMERE", 128, ARMS_H - 118);
  ctx.font = `italic 13px ${FACE}`;
  ctx.fillText("Please do not improve", 128, ARMS_H - 96);
  ctx.restore();
}

/** The expedition's notice board: a cork-and-timber board with pinned notices in the Society's officialese, and one in a different hand. */
function drawNotice(ctx: CanvasRenderingContext2D): void {
  const C = PALETTE.camp;
  const W = PALETTE.world;
  ctx.save();
  ctx.translate(0, NOTICE_Y);
  ctx.fillStyle = cssHex(C.leather);
  ctx.fillRect(0, 0, ATLAS_W, NOTICE_H);
  ctx.fillStyle = cssHex(W.vlThatch);
  ctx.fillRect(14, 14, ATLAS_W - 28, NOTICE_H - 28);
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = cssHex(i % 3 ? W.vlThatchDark : W.dirtDark);
    ctx.fillRect(16 + ((i * 97) % (ATLAS_W - 32)), 16 + ((i * 53) % (NOTICE_H - 32)), 3, 2);
  }
  ctx.globalAlpha = 1;
  const note = (x: number, y: number, w: number, h: number, tilt: number, head: string, body: string[], paper: number = PALETTE.ui.paper, ink: number = PALETTE.ink, stamp = false): void => {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(tilt);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w, h);
    ctx.fillStyle = cssHex(paper);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = cssHex(ink);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const hp = fitText(ctx, head, w - 14, 17, FACE_SC);
    ctx.fillText(head, 0, -h / 2 + 7);
    ctx.font = `italic ${Math.min(12, hp - 2)}px ${FACE}`;
    body.forEach((line, i) => ctx.fillText(line, 0, -h / 2 + 9 + hp + i * 13));
    if (stamp) {
      ctx.strokeStyle = cssHex(PALETTE.ui.stamp);
      ctx.fillStyle = cssHex(PALETTE.ui.stamp);
      ctx.lineWidth = 2;
      ctx.rotate(-0.25);
      ctx.strokeRect(-36, h / 2 - 34, 72, 20);
      ctx.font = `13px ${FACE_SC}`;
      ctx.fillText("APPROVED", 0, h / 2 - 31);
    }
    // the pin
    ctx.fillStyle = cssHex(C.flagCloth);
    ctx.beginPath();
    ctx.arc(0, -h / 2 + 3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  note(28, 26, 150, 98, -0.03, "BY ORDER", ["The Society regrets that", "tea is at four. Attendance", "is not optional. Nor is", "enjoyment."], PALETTE.ui.paper, PALETTE.ink, true);
  note(188, 22, 130, 108, 0.04, "LOST", ["One surveyor (Mr Pym).", "Answers to 'Pym'.", "Last seen improving.", "Reward: none."], PALETTE.ui.paper2);
  note(330, 30, 152, 92, -0.02, "LATRINE ROTA", ["Everyone but the", "Leader.", "(The Leader is above", "such things.)"], PALETTE.ui.field);
  note(36, 136, 138, 96, 0.03, "CORRECTION", ["The interior is not", "'unexplored'. It has", "people in it. They are", "quite cross."], PALETTE.ui.paper2);
  note(186, 140, 160, 92, -0.03, "EXPEDITION ROSTER", ["Colonel . . . . in command", "Cartographer . . in denial", "The rest . . . . expendable"], PALETTE.ui.paper);
  note(360, 134, 124, 100, 0.05, "IN A NEAT HAND", ["Please do not improve", "the mill. Or the bridge.", "Or us.", "- Hollowmere"], W.vlPlaster, W.vlHeraldBlue);
  ctx.restore();
}

function drawStencils(ctx: CanvasRenderingContext2D): void {
  const C = PALETTE.camp;
  STENCIL_TEXT.forEach((lines, i) => {
    const x = (i % 2) * 256;
    const y = STENCIL_Y + Math.floor(i / 2) * 128;
    ctx.clearRect(x, y, 256, 128);
    ctx.fillStyle = cssHex(C.canvasTrim);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const px = Math.min(fitText(ctx, lines[0], 224, 40, FACE_SC), fitText(ctx, lines[1], 224, 40, FACE_SC));
    ctx.font = `${px}px ${FACE_SC}`;
    ctx.fillText(lines[0], x + 128, y + 44);
    ctx.fillText(lines[1], x + 128, y + 44 + px * 1.15);
    // stencil bridges: thin gaps across the letters
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let bx2 = 14; bx2 < 250; bx2 += 26) ctx.fillRect(x + bx2, y + 24, 2, 84);
    ctx.globalCompositeOperation = "source-over";
    // a stencilled frame
    ctx.strokeStyle = cssHex(C.canvasTrim);
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 6]);
    ctx.strokeRect(x + 6, y + 6, 244, 116);
    ctx.setLineDash([]);
  });
}

function drawSwatches(ctx: CanvasRenderingContext2D): void {
  const cols = [PALETTE.camp.flagCloth, PALETTE.camp.flagMark, PALETTE.world.vlHeraldGold, PALETTE.world.vlHeraldBlue];
  cols.forEach((c, i) => {
    ctx.fillStyle = cssHex(c);
    ctx.fillRect(432 + i * 18, 300, 16, 16);
  });
}

function drawWhitePatch(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = cssHex(0xffffff);
  ctx.fillRect(470, 268, 30, 22);
}

/** Draws the atlas and returns the texture; needs a DOM (never called from unit tests). */
export function createAtlasTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d")!;
  const paint = (): void => {
    ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
    drawFlag(ctx);
    drawBoards(ctx);
    drawWhitePatch(ctx);
    drawSwatches(ctx);
    drawMap(ctx);
    drawVillageSigns(ctx);
    drawClock(ctx);
    drawArms(ctx);
    drawNotice(ctx);
    drawStencils(ctx);
  };
  paint();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  // Redraw once the bundled fonts are ready, so the lettering is IM Fell and not a fallback.
  void Promise.all([document.fonts?.load('40px "IM Fell English SC"'), document.fonts?.load('16px "IM Fell English"'), document.fonts?.load('italic 16px "IM Fell English"')]).then(() => {
    paint();
    tex.needsUpdate = true;
  });
  return tex;
}

/** A soft round glow (white centre fading to transparent) used, tinted and additive, for the campfire. */
export function createGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
