import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshToonMaterial, SRGBColorSpace } from "three";
import { PALETTE, VESPER_SIGNS, cssHex, type Terrain } from "./shared.ts";
import { sharedToonRamp } from "@cb/procedural/three";
import { atmoUniforms } from "../atmosphere.ts";
import { worldTime } from "../toon.ts";
import { vesperPlan, type VesperBanner } from "./shared.ts";

/**
 * Banners and signboards for Vesper Gorge: ONE canvas atlas (drawn at runtime from palette colours, in the game's bundled IM Fell faces: no image assets), ONE textured mesh with a `wave` weight per vertex that
 * the material turns into a ripple. The Low Vesper Lamentation Guild flies a silver bell on plum between two bands of black crepe; the Lower Gallery Company a pick and hammer on cream with a red chevron; the
 * Syndicate its green and gilt bars with the monogram. Invented heraldry: no real flag, arms or script.
 */

export const ATLAS_W = 512;
const BANNER_H = 448;
const SYN_H = 320;
const SIGN_H = 96;
const SIGN_Y = BANNER_H + SYN_H;
export const ATLAS_H = SIGN_Y + SIGN_H * VESPER_SIGNS.length;

type Rect = readonly [number, number, number, number];
const uvRect = (x: number, y: number, w: number, h: number): Rect => [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
export const BANNER_UV: Record<VesperBanner["kind"], Rect> = {
  guild: uvRect(0, 0, 256, BANNER_H),
  company: uvRect(256, 0, 256, BANNER_H),
  syndicate: uvRect(0, BANNER_H, 256, SYN_H),
};
export const signUv = (i: number): Rect => uvRect(0, SIGN_Y + i * SIGN_H, ATLAS_W, SIGN_H);

const c = cssHex;
const P = PALETTE.vesper;

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

/** A bell: a flared body, a lip, a clapper, a loop (the Guild's whole heraldry; it is paid by the toll). */
function drawBell(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, colour: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = c(colour);
  ctx.strokeStyle = c(colour);
  ctx.beginPath();
  ctx.moveTo(-14, -52);
  ctx.quadraticCurveTo(-18, -78, 0, -80);
  ctx.quadraticCurveTo(18, -78, 14, -52);
  ctx.quadraticCurveTo(24, -8, 52, 18);
  ctx.lineTo(52, 30);
  ctx.lineTo(-52, 30);
  ctx.lineTo(-52, 18);
  ctx.quadraticCurveTo(-24, -8, -14, -52);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, -92, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 44, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  // ---- the Guild: plum field, silver border, a bell between two bands of crepe, a teardrop border
  {
    const w = 256, h = BANNER_H;
    ctx.save();
    swallow(ctx, 0, 0, w, h, 52);
    ctx.fillStyle = c(P.guildPlum);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c(P.crepe);
    ctx.fillRect(0, 0, w, 54);
    ctx.fillRect(0, h - 124, w, 44);
    ctx.strokeStyle = c(P.guildSilver);
    ctx.lineWidth = 9;
    ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
    drawBell(ctx, w / 2, 190, 1.45, P.guildSilver);
    ctx.fillStyle = c(P.guildSilver);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(36 + i * 46, 392, 9, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // ---- the Company: cream field, a red chevron, a pick crossed with a hammer
  {
    const x0 = 256, w = 256, h = BANNER_H;
    ctx.save();
    swallow(ctx, x0, 0, w, h, 40);
    ctx.fillStyle = c(P.companyCream);
    ctx.fillRect(x0, 0, w, h);
    ctx.fillStyle = c(P.companyRed);
    ctx.beginPath();
    ctx.moveTo(x0, 40);
    ctx.lineTo(x0 + w / 2, 150);
    ctx.lineTo(x0 + w, 40);
    ctx.lineTo(x0 + w, 100);
    ctx.lineTo(x0 + w / 2, 210);
    ctx.lineTo(x0, 100);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = c(P.iron);
    ctx.fillStyle = c(P.iron);
    ctx.lineCap = "round";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(x0 + 70, 380);
    ctx.lineTo(x0 + 190, 250);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0 + 186, 380);
    ctx.lineTo(x0 + 66, 250);
    ctx.stroke();
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(x0 + 40, 262);
    ctx.quadraticCurveTo(x0 + 70, 232, x0 + 110, 244);
    ctx.stroke();
    ctx.fillRect(x0 + 176, 232, 44, 28);
    ctx.fillStyle = c(P.companyRed);
    ctx.font = 'bold 54px "IM Fell English SC", "IM Fell English", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("L.G.C.", x0 + w / 2, 62);
    ctx.restore();
  }
  // ---- the Syndicate: green field, gilt bars, a cream roundel with the monogram
  {
    const w = 256, h = SYN_H, y0 = BANNER_H;
    ctx.save();
    swallow(ctx, 0, y0, w, h, 36);
    ctx.fillStyle = c(P.synGreen);
    ctx.fillRect(0, y0, w, h);
    ctx.fillStyle = c(P.synGold);
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 60, y0);
      ctx.lineTo(i * 60 + 24, y0);
      ctx.lineTo(i * 60 + 24 + h * 0.5, y0 + h);
      ctx.lineTo(i * 60 + h * 0.5, y0 + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = c(P.companyCream);
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
  // ---- the signboards: bone strips, brown lettering
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  VESPER_SIGNS.forEach((text, i) => {
    const y = SIGN_Y + i * SIGN_H;
    ctx.fillStyle = c(P.strataBone);
    ctx.fillRect(0, y, ATLAS_W, SIGN_H);
    ctx.strokeStyle = c(P.crepe);
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
export function createVesperAtlas(): CanvasTexture | undefined {
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

/** The cloth and lettering geometry: position, normal, uv, wave. Banners hang from their rods (the weight grows down the cloth); the signboards' lettering is a decal on both faces (wave 0). */
export function buildVesperCloth(terrain: Terrain): BufferGeometry | undefined {
  const plan = vesperPlan();
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
export function vesperClothMaterial(map: CanvasTexture | undefined): MeshToonMaterial {
  const mat = new MeshToonMaterial({ map: map ?? null, alphaTest: 0.5, side: DoubleSide, gradientMap: sharedToonRamp(), color: map ? 0xffffff : P.strataBone });
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
  mat.customProgramCacheKey = (): string => "vesper-cloth";
  return mat;
}
