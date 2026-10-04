import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshToonMaterial, SRGBColorSpace } from "three";
import { letterSign } from "../signLettering.ts";
import { PALETTE, cssHex, type Terrain } from "@cb/shared";
import { sharedToonRamp } from "@cb/procedural/three";
import { atmoUniforms } from "../atmosphere.ts";
import { worldTime } from "../toon.ts";
import { KESSAR_SIGNS, kessarPlan, type KessarBanner } from "./shared.ts";

/**
 * Banners and signboards for Kessar Reach: ONE canvas atlas (drawn at runtime from palette colours, in the game's bundled IM Fell faces: no image assets),
 * ONE textured mesh with a `wave` weight per vertex that the material turns into a ripple along the cloth's normal. The Ward of the Nine Lamps flies
 * nine gold lamps over red chevrons on blue; the Syndicate a green field with gilt bars and a monogram; the Society its cream and red.
 * All of it is invented heraldry: no real flag, arms or script.
 */

export const ATLAS_W = 512;
const BANNER_H = 448;
const SOCIETY_H = 320;
const SIGN_H = 96;
const SIGN_Y = BANNER_H + SOCIETY_H;
export const ATLAS_H = SIGN_Y + SIGN_H * KESSAR_SIGNS.length;

type Rect = readonly [number, number, number, number];
const uvRect = (x: number, y: number, w: number, h: number): Rect => [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
export const BANNER_UV: Record<KessarBanner["kind"], Rect> = {
  ward: uvRect(0, 0, 256, BANNER_H),
  syndicate: uvRect(256, 0, 256, BANNER_H),
  society: uvRect(0, BANNER_H, 256, SOCIETY_H),
};
export const signUv = (i: number): Rect => uvRect(0, SIGN_Y + i * SIGN_H, ATLAS_W, SIGN_H);

const c = cssHex;
const K = PALETTE.kessar;

/** Draws the atlas. Transparent pixels (the swallow-tails) are cut by the material's alpha test. */
export function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  // ---- the Ward of the Nine Lamps: blue field, nine gold lamps in three rows, three chevrons, a swallow-tail
  {
    const w = 256;
    const h = BANNER_H;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(w / 2, h - 52);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = c(K.wardBlue);
    ctx.fillRect(0, 0, w, h);
    const chev = (y: number, col: number): void => {
      ctx.fillStyle = c(col);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w / 2, y + 56);
      ctx.lineTo(w, y);
      ctx.lineTo(w, y + 30);
      ctx.lineTo(w / 2, y + 86);
      ctx.lineTo(0, y + 30);
      ctx.closePath();
      ctx.fill();
    };
    chev(250, K.wardRed);
    chev(292, K.wardCream);
    chev(334, K.wardRed);
    for (let r = 0; r < 3; r++) {
      for (let q = 0; q < 3; q++) {
        const x = 52 + q * 76;
        const y = 50 + r * 62;
        ctx.fillStyle = c(K.wardCream);
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c(K.lampGold);
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = c(K.wardBlue);
        ctx.fillRect(x - 1.5, y - 22, 3, 6);
      }
    }
    ctx.strokeStyle = c(K.lampGold);
    ctx.lineWidth = 9;
    ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
    ctx.restore();
  }
  // ---- the Dunmarrow-Vesk Syndicate: green field, gilt diagonal bars, a cream roundel with the monogram
  {
    const x0 = 256;
    const w = 256;
    const h = BANNER_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, w, h - 40);
    ctx.moveTo(x0, h - 40);
    ctx.lineTo(x0 + w, h - 40);
    ctx.lineTo(x0 + w / 2, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = c(K.synGreen);
    ctx.fillRect(x0, 0, w, h);
    ctx.fillStyle = c(K.synStripe);
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(x0 + i * 60, 0);
      ctx.lineTo(x0 + i * 60 + 24, 0);
      ctx.lineTo(x0 + i * 60 + 24 + h * 0.5, h);
      ctx.lineTo(x0 + i * 60 + h * 0.5, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = c(K.wardCream);
    ctx.beginPath();
    ctx.arc(x0 + w / 2, 190, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c(K.synGreen);
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = c(K.synGreen);
    ctx.font = 'bold 84px "IM Fell English SC", "IM Fell English", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DV", x0 + w / 2, 194);
    ctx.restore();
  }
  // ---- the Society's pennant: cream with a red border and a gilt star (the expedition's own; the Hollowmere camp flies the same colours)
  {
    const y0 = BANNER_H;
    const w = 256;
    const h = SOCIETY_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, w, h - 36);
    ctx.moveTo(0, y0 + h - 36);
    ctx.lineTo(w, y0 + h - 36);
    ctx.lineTo(w / 2, y0 + h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = c(PALETTE.camp.canvas);
    ctx.fillRect(0, y0, w, h);
    ctx.strokeStyle = c(PALETTE.camp.canvasTrim);
    ctx.lineWidth = 16;
    ctx.strokeRect(8, y0 + 8, w - 16, h - 16);
    ctx.fillStyle = c(PALETTE.camp.brass);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 26 : 62;
      ctx.lineTo(w / 2 + Math.cos(a) * r, y0 + 130 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // ---- the signboards: cream strips, brown lettering
  KESSAR_SIGNS.forEach((text, i) => {
    const y = SIGN_Y + i * SIGN_H;
    ctx.fillStyle = c(K.wardCream);
    ctx.fillRect(0, y, ATLAS_W, SIGN_H);
    ctx.strokeStyle = c(K.timber);
    ctx.lineWidth = 6;
    ctx.strokeRect(3, y + 3, ATLAS_W - 6, SIGN_H - 6);
    ctx.fillStyle = c(K.timber);
    letterSign(ctx, text, 0, y, ATLAS_W, SIGN_H);
  });
}

/** The atlas as a texture, or undefined where there is no canvas (Node tests). Redrawn once the bundled fonts have loaded so it never bakes in a fallback face. */
export function createKessarAtlas(): CanvasTexture | undefined {
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
 * The cloth and lettering geometry: position, normal, uv, wave. Banners hang from their rods (the weight grows down the cloth, so the hem ripples and
 * the rod stays put); the signboards' lettering is a decal on both faces of each board (wave 0).
 */
export function buildKessarCloth(terrain: Terrain): BufferGeometry | undefined {
  const plan = kessarPlan();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const wave: number[] = [];
  const COLS = 6;
  const ROWS = 10;
  for (const b of plan.banners) {
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
        // counter-clockwise seen from the front (the side the normal points to)
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
export function kessarClothMaterial(map: CanvasTexture | undefined): MeshToonMaterial {
  const mat = new MeshToonMaterial({ map: map ?? null, alphaTest: 0.5, side: DoubleSide, gradientMap: sharedToonRamp(), color: map ? 0xffffff : K.wardCream });
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
  mat.customProgramCacheKey = (): string => "kessar-cloth";
  return mat;
}
