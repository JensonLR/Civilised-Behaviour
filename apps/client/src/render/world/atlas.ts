import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { PALETTE, cssHex } from "@cb/shared";

/**
 * Runtime-drawn ephemera textures (no image assets): the Society's pennant and the signpost's board lettering share one canvas
 * atlas, so the flag and every sign are ONE draw call. Lettering is IM Fell English SC, bundled with the game; the atlas is
 * redrawn once the font finishes loading so it never bakes in a fallback face.
 */

export const ATLAS_W = 512;
export const ATLAS_H = 640;
export const FLAG_H = 256;
export const BOARD_H = 96;
export const BOARD_TEXT = ["THE INTERIOR (unimproved)", "LATRINE - approved pattern", "SOCIETY CLUB, LONDON  4,112 mi", "TO THE COAST (see Form 7)"] as const;

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
