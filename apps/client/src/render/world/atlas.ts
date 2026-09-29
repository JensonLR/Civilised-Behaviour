import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { HILL, PALETTE, RIVER, TRAILS, cssHex, riverCentre } from "@cb/shared";

/**
 * Runtime-drawn ephemera textures (no image assets): the Society's pennant and the signpost's board lettering share one canvas
 * atlas, so the flag and every sign are ONE draw call. Lettering is IM Fell English SC, bundled with the game; the atlas is
 * redrawn once the font finishes loading so it never bakes in a fallback face.
 */

export const ATLAS_W = 512;
export const MAP_H = 320;
export const ATLAS_H = 640 + MAP_H;
export const FLAG_H = 256;
export const BOARD_H = 96;
export const BOARD_TEXT = ["THE INTERIOR (unimproved)", "LATRINE - approved pattern", "SOCIETY CLUB, LONDON  4,112 mi", "TO THE COAST (see Form 7)"] as const;

/** UV rectangle of the pinned survey map (the last MAP_H rows of the atlas). */
export const MAP_UV = [0, 0, 1, MAP_H / ATLAS_H] as const;
/** A small opaque white patch: cloth (shirts, hammock) samples it so its vertex colour is the whole colour. UV centre. */
export const WHITE_UV = [0.955, 1 - 279 / ATLAS_H] as const;

/** UV rectangle (u0, v0, u1, v1) of the pennant. v = 1 is the top of the canvas. */
export const FLAG_UV = [0, 1 - FLAG_H / ATLAS_H, 1, 1] as const;
export function boardUv(i: number): readonly [number, number, number, number] {
  const top = FLAG_H + i * BOARD_H;
  return [0, 1 - (top + BOARD_H) / ATLAS_H, 1, 1 - top / ATLAS_H];
}

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
  ctx.clearRect(0, FLAG_H, ATLAS_W, ATLAS_H - FLAG_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  BOARD_TEXT.forEach((text, i) => {
    const y = FLAG_H + i * BOARD_H;
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
  const y0 = FLAG_H + BOARD_H * BOARD_TEXT.length;
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
    drawMap(ctx);
  };
  paint();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  // Redraw once the bundled fonts are ready, so the lettering is IM Fell and not a fallback.
  void document.fonts?.load('40px "IM Fell English SC"').then(() => {
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
