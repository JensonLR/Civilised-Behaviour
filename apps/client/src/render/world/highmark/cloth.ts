import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshToonMaterial, SRGBColorSpace } from "three";
import { PALETTE, cssHex, type Terrain } from "@cb/shared";
import { sharedToonRamp } from "@cb/procedural/three";
import { atmoUniforms } from "../atmosphere.ts";
import { worldTime } from "../toon.ts";
import { HIGHMARK_SEALED_SIGNS, HIGHMARK_SIGNS, highmarkLevel, highmarkPlan, type HighmarkBanner } from "./shared.ts";
import { pushPlaques } from "../plaques.ts";
import { skylineBanners } from "./skyline.ts";

/**
 * Banners and signboards for Highmark: ONE canvas atlas (drawn at runtime from palette colours, in the game's bundled IM Fell faces: no image assets), ONE textured mesh with a `wave`
 * weight per vertex that the material turns into a ripple. The Crown flies a gilt sun over a stag on blue; the Reapers' Grange a wheatsheaf and a scythe on green; the Syndicate its
 * green and gilt bars with the monogram. Invented heraldry: no real flag, arms or script.
 */

export const ATLAS_W = 512;
const BANNER_H = 448;
const SYN_H = 320;
const SIGN_H = 96;
const SIGN_Y = BANNER_H + SYN_H;
/** D-038: the sealed facades' notices (the Grange's, the assay office's, the Chamberlain's, the palace's), one strip each after the signboards. */
const SEALED_TEXTS: readonly string[] = [HIGHMARK_SEALED_SIGNS.grange, HIGHMARK_SEALED_SIGNS.assay, HIGHMARK_SEALED_SIGNS.chamberlain, HIGHMARK_SEALED_SIGNS.palace];
const PLAQUE_Y = SIGN_Y + SIGN_H * HIGHMARK_SIGNS.length;
export const ATLAS_H = PLAQUE_Y + SIGN_H * SEALED_TEXTS.length;

type Rect = readonly [number, number, number, number];
const uvRect = (x: number, y: number, w: number, h: number): Rect => [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
export const BANNER_UV: Record<HighmarkBanner["kind"], Rect> = {
  crown: uvRect(0, 0, 256, BANNER_H),
  grange: uvRect(256, 0, 256, BANNER_H),
  syndicate: uvRect(0, BANNER_H, 256, SYN_H),
};
export const signUv = (i: number): Rect => uvRect(0, SIGN_Y + i * SIGN_H, ATLAS_W, SIGN_H);
export const plaqueUv = (i: number): Rect => uvRect(0, PLAQUE_Y + i * SIGN_H, ATLAS_W, SIGN_H);

const c = cssHex;
const P = PALETTE.highmark;

/** A swallow-tailed cloth: clip to the banner's outline (pixels outside are cut by the material's alpha test). */
function swallow(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, tail: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w, y0 + h);
  ctx.lineTo(x0 + w / 2, y0 + h - tail);
  ctx.lineTo(x0, y0 + h);
  ctx.closePath();
  ctx.clip();
}

/** The sun of the Crown: a gilt disc, sixteen rays, a face of two dots and a line (the Society's reading of it is unkind). */
function drawSun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = c(P.sunGold);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.1) * r * 1.05, cy + Math.sin(a - 0.1) * r * 1.05);
    ctx.lineTo(cx + Math.cos(a) * r * (i % 2 ? 1.5 : 1.8), cy + Math.sin(a) * r * (i % 2 ? 1.5 : 1.8));
    ctx.lineTo(cx + Math.cos(a + 0.1) * r * 1.05, cy + Math.sin(a + 0.1) * r * 1.05);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c(P.stagBrown);
  ctx.lineWidth = 4;
  ctx.stroke();
}

/** A stag passant in two colours: body, neck, head, four legs and the branching antlers, built from strokes. */
function drawStag(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, colour: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = c(colour);
  ctx.strokeStyle = c(colour);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(0, 0, 50, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(36, -8);
  ctx.lineTo(62, -44);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(70, -50, 14, 9, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 7;
  for (const [x, y] of [[-32, 18], [-18, 20], [24, 20], [38, 18]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (x < 0 ? -4 : 4), y + 46);
    ctx.stroke();
  }
  ctx.lineWidth = 4;
  for (const pts of [[[64, -58], [56, -92], [40, -112]], [[60, -76], [84, -100], [94, -122]], [[58, -90], [34, -108]]] as const) {
    ctx.beginPath();
    ctx.moveTo(pts[0]![0]!, pts[0]![1]!);
    for (const q of pts.slice(1)) ctx.lineTo(q[0]!, q[1]!);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws the atlas. Transparent pixels (the swallow-tails) are cut by the material's alpha test. */
export function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  // ---- the Crown: blue field, gilt border, the sun over the stag
  {
    const w = 256, h = BANNER_H;
    ctx.save();
    swallow(ctx, 0, 0, w, h, 52);
    ctx.fillStyle = c(P.crownBlue);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c(P.sunGold);
    ctx.lineWidth = 9;
    ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
    drawSun(ctx, w / 2, 110, 44);
    ctx.fillStyle = c(P.crownCream);
    ctx.fillRect(34, 238, w - 68, 10);
    drawStag(ctx, w / 2 - 8, 330, 1.25, P.crownCream);
    ctx.restore();
  }
  // ---- the Reapers' Grange: green field, a gold wheatsheaf over a crossed scythe
  {
    const x0 = 256, w = 256, h = BANNER_H;
    ctx.save();
    swallow(ctx, x0, 0, w, h, 40);
    ctx.fillStyle = c(P.grangeGreen);
    ctx.fillRect(x0, 0, w, h);
    ctx.strokeStyle = c(P.grangeWheat);
    ctx.lineWidth = 8;
    ctx.strokeRect(x0 + 4, 4, w - 8, h - 8);
    ctx.strokeStyle = c(P.grangeWheat);
    ctx.fillStyle = c(P.grangeWheat);
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (let i = -4; i <= 4; i++) {
      const a = (i / 4) * 0.55;
      ctx.beginPath();
      ctx.moveTo(x0 + w / 2, 260);
      ctx.lineTo(x0 + w / 2 + Math.sin(a) * 150, 260 - Math.cos(a) * 150);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x0 + w / 2 + Math.sin(a) * 160, 260 - Math.cos(a) * 160, 7, 17, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = c(P.crownCream);
    ctx.fillRect(x0 + w / 2 - 36, 236, 72, 14);
    ctx.strokeStyle = c(P.crownCream);
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(x0 + w / 2, 340, 62, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + w / 2 + 44, 296);
    ctx.lineTo(x0 + w / 2 - 70, 380);
    ctx.stroke();
    ctx.restore();
  }
  // ---- the Syndicate: green field, gilt bars, a cream roundel with the monogram
  {
    const w = 256, h = SYN_H, y0 = BANNER_H;
    ctx.save();
    swallow(ctx, 0, y0, w, h, 36);
    ctx.fillStyle = c(P.synGreen);
    ctx.fillRect(0, y0, w, h);
    ctx.fillStyle = c(P.synStripe);
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 60, y0);
      ctx.lineTo(i * 60 + 24, y0);
      ctx.lineTo(i * 60 + 24 + h * 0.5, y0 + h);
      ctx.lineTo(i * 60 + h * 0.5, y0 + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = c(P.crownCream);
    ctx.beginPath();
    ctx.arc(w / 2, y0 + 130, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c(P.synGreen);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = c(P.synGreen);
    ctx.font = 'bold 74px "IM Fell English SC", "IM Fell English", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DV", w / 2, y0 + 134);
    ctx.restore();
  }
  // ---- the signboards: chalk strips, brown lettering
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  [...HIGHMARK_SIGNS, ...SEALED_TEXTS].forEach((text, i) => {
    const y = SIGN_Y + i * SIGN_H;
    ctx.fillStyle = c(P.chalk);
    ctx.fillRect(0, y, ATLAS_W, SIGN_H);
    ctx.strokeStyle = c(P.verdigrisDark);
    ctx.lineWidth = 6;
    ctx.strokeRect(3, y + 3, ATLAS_W - 6, SIGN_H - 6);
    ctx.fillStyle = c(P.timber);
    let size = 38;
    ctx.font = `${size}px "IM Fell English SC", "IM Fell English", serif`;
    while (size > 16 && ctx.measureText(text).width > ATLAS_W - 40) {
      size -= 2;
      ctx.font = `${size}px "IM Fell English SC", "IM Fell English", serif`;
    }
    ctx.fillText(text, 20, y + SIGN_H / 2 + 2);
  });
}

/** The atlas as a texture, or undefined where there is no canvas (Node tests). Redrawn once the bundled fonts have loaded so it never bakes in a fallback face. */
export function createHighmarkAtlas(): CanvasTexture | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  drawAtlas(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const fonts = (document as { fonts?: { load(f: string): Promise<unknown> } }).fonts;
  if (fonts) {
    void Promise.all([fonts.load('40px "IM Fell English SC"'), fonts.load('16px "IM Fell English"')]).then(() => {
      drawAtlas(ctx);
      tex.needsUpdate = true;
    });
  }
  return tex;
}

export const SIGN_SIZE = { w: 2.5, h: 0.468 } as const;

/**
 * The cloth and lettering geometry: position, normal, uv, wave. Banners hang from their rods (the weight grows down the cloth, so the hem ripples and the rod stays put); the
 * signboards' lettering is a decal on both faces of each board (wave 0).
 */
export function buildHighmarkCloth(terrain: Terrain): BufferGeometry | undefined {
  const plan = highmarkPlan();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const wave: number[] = [];
  const COLS = 6;
  const ROWS = 10;
  // the plan's banners, then the skyline's (skyline.ts: bigger cloth on the gate and the palace, one on every terrace mast)
  for (const b of [...plan.banners, ...skylineBanners({ terrainHeight: (x, z) => terrain.height(x, z) })]) {
    const [u0, v0, u1, v1] = BANNER_UV[b.kind];
    const nx = Math.cos(b.yaw);
    const nz = Math.sin(b.yaw);
    const rx = nz;
    const rz = -nx;
    const top = terrain.height(b.x, b.z) + b.top;
    const vert = (i: number, j: number): void => {
      const s = i / COLS - 0.5;
      const t = j / ROWS;
      pos.push(b.x + rx * s * b.w + nx * 0.02, top - t * b.h, b.z + rz * s * b.w + nz * 0.02);
      nor.push(nx, 0, nz);
      uv.push(u0 + (u1 - u0) * (i / COLS), v1 - (v1 - v0) * t);
      wave.push(t * t);
    };
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        vert(i, j);
        vert(i + 1, j + 1);
        vert(i + 1, j);
        vert(i, j);
        vert(i, j + 1);
        vert(i + 1, j + 1);
      }
    }
  }
  for (const s of plan.signs) {
    const [u0, v0, u1, v1] = signUv(s.text);
    const y = terrain.height(s.x, s.z) + 1.85;
    const nx = Math.cos(s.yaw);
    const nz = Math.sin(s.yaw);
    for (const side of [1, -1]) {
      const fx = nx * side;
      const fz = nz * side;
      const rx = fz;
      const rz = -fx;
      const px = s.x + fx * 0.055;
      const pz = s.z + fz * 0.055;
      const hw = SIGN_SIZE.w / 2 - 0.05;
      const hh = SIGN_SIZE.h / 2 - 0.03;
      const corner = (u: number, v: number): [number, number, number] => [px + rx * u * hw, y + v * hh, pz + rz * u * hw];
      const c0 = corner(-1, -1);
      const c1 = corner(1, -1);
      const c2 = corner(1, 1);
      const c3 = corner(-1, 1);
      const push = (p: [number, number, number], uu: number, vv: number): void => {
        pos.push(...p);
        nor.push(fx, 0, fz);
        uv.push(uu, vv);
        wave.push(0);
      };
      push(c0, u0, v0);
      push(c1, u1, v0);
      push(c2, u1, v1);
      push(c0, u0, v0);
      push(c2, u1, v1);
      push(c3, u0, v1);
    }
  }
  pushPlaques(highmarkLevel().buildings, (x, z) => terrain.height(x, z), (b) => (b.sign === undefined ? undefined : plaqueUv(SEALED_TEXTS.indexOf(b.sign))), { pos, nor, uv, wave });
  if (pos.length === 0) return undefined;
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute("wave", new BufferAttribute(new Float32Array(wave), 1));
  g.computeBoundingSphere();
  return g;
}

/** Toon-lit, alpha-tested, two-sided; the ripple runs along each vertex's normal, weighted by `wave` and the wind (and the motion preference). */
export function highmarkClothMaterial(map: CanvasTexture | undefined): MeshToonMaterial {
  const mat = new MeshToonMaterial({ map: map ?? null, alphaTest: 0.5, side: DoubleSide, gradientMap: sharedToonRamp(), color: map ? 0xffffff : P.chalk });
  mat.onBeforeCompile = (shader): void => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uWindK = atmoUniforms.uWindK;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float wave;\nuniform float uTime;\nuniform float uWindK;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float w = wave * uWindK;
        transformed += normal * (sin(uTime * 2.6 + position.x * 1.7 + position.z * 1.7 + position.y * 0.9) * 0.11 + sin(uTime * 4.3 + position.y * 2.3 + position.x * 2.0 - position.z * 2.0) * 0.045) * w;
        transformed.y -= 0.05 * w;`,
      );
  };
  mat.customProgramCacheKey = (): string => "highmark-cloth";
  return mat;
}
