import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshToonMaterial, SRGBColorSpace } from "three";
import { letterSign } from "../signLettering.ts";
import { PALETTE, SALTMARKET_SEALED_SIGNS, SALTMARKET_SIGNS, cssHex, saltmarketLevel, saltmarketPlan, type SaltmarketBanner, type Terrain } from "./shared.ts";
import { sharedToonRamp } from "@cb/procedural/three";
import { atmoUniforms } from "../atmosphere.ts";
import { worldTime } from "../toon.ts";
import { pushPlaques } from "../plaques.ts";

/**
 * Banners and signboards for the delta: ONE canvas atlas (drawn at runtime from palette colours, in the game's bundled IM Fell faces: no image assets), ONE textured mesh with a `wave` weight per vertex that the
 * material turns into a ripple. The Brine Houses fly a salt heron on indigo over three coral waves; the Tide Constabulary an open brass-and-salt eye on coral (it watches; it bills); the Syndicate its green and gilt
 * bars with the monogram; the Society its cream and red with a gilt star. Invented heraldry: no real flag, arms or script.
 */

export const ATLAS_W = 512;
const BANNER_H = 448;
const SMALL_H = 320;
const SIGN_H = 96;
const SIGN_Y = BANNER_H + SMALL_H;
/** D-038: the sealed warehouses' notices, one strip each after the signboards ("CLOSED FOR TIDE"): the door says why it is shut. */
const PLAQUE_Y = SIGN_Y + SIGN_H * SALTMARKET_SIGNS.length;
export const ATLAS_H = PLAQUE_Y + SIGN_H * SALTMARKET_SEALED_SIGNS.length;

type Rect = readonly [number, number, number, number];
const uvRect = (x: number, y: number, w: number, h: number): Rect => [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
export const BANNER_UV: Record<SaltmarketBanner["kind"], Rect> = {
  house: uvRect(0, 0, 256, BANNER_H),
  customs: uvRect(256, 0, 256, BANNER_H),
  syndicate: uvRect(0, BANNER_H, 256, SMALL_H),
  society: uvRect(256, BANNER_H, 256, SMALL_H),
};
export const signUv = (i: number): Rect => uvRect(0, SIGN_Y + i * SIGN_H, ATLAS_W, SIGN_H);
export const plaqueUv = (i: number): Rect => uvRect(0, PLAQUE_Y + i * SIGN_H, ATLAS_W, SIGN_H);

const c = cssHex;
const P = PALETTE.saltmarket;

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

/** A heron standing in the shallows: a long S of neck, a spear of beak, an arched back and two stilt legs, in strokes. */
function drawHeron(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = c(P.salt);
  ctx.fillStyle = c(P.salt);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.ellipse(0, 0, 44, 22, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(34, -12);
  ctx.bezierCurveTo(62, -36, 20, -58, 44, -84);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(48, -88, 12, 8, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(58, -90);
  ctx.lineTo(96, -82);
  ctx.stroke();
  ctx.lineWidth = 6;
  for (const x of [-6, 12]) {
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x + 4, 62);
    ctx.lineTo(x + 18, 70);
    ctx.stroke();
  }
  // a plume off the back
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-40, -6);
  ctx.quadraticCurveTo(-72, -30, -86, -10);
  ctx.stroke();
  ctx.restore();
}

/** An open eye: an almond of salt, a brass iris, an iron pupil and the Constabulary's rays. */
function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = c(P.brass);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.12) * r * 1.2, cy + Math.sin(a - 0.12) * r * 1.2);
    ctx.lineTo(cx + Math.cos(a) * r * (i % 2 ? 1.6 : 1.95), cy + Math.sin(a) * r * (i % 2 ? 1.6 : 1.95));
    ctx.lineTo(cx + Math.cos(a + 0.12) * r * 1.2, cy + Math.sin(a + 0.12) * r * 1.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = c(P.salt);
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.2, cy);
  ctx.quadraticCurveTo(cx, cy - r * 1.1, cx + r * 1.2, cy);
  ctx.quadraticCurveTo(cx, cy + r * 1.1, cx - r * 1.2, cy);
  ctx.fill();
  ctx.fillStyle = c(P.brass);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c(P.iron);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws the atlas. Transparent pixels (the swallow-tails) are cut by the material's alpha test. */
export function drawAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  // ---- the Brine Houses: indigo field, salt border, three coral waves, the heron
  {
    const w = 256, h = BANNER_H;
    ctx.save();
    swallow(ctx, 0, 0, w, h, 52);
    ctx.fillStyle = c(P.indigoCanvas);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c(P.salt);
    ctx.lineWidth = 9;
    ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
    drawHeron(ctx, w / 2 - 10, 190, 1.3);
    ctx.strokeStyle = c(P.coralCanvas);
    ctx.lineWidth = 12;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let x = 24; x <= w - 24; x += 6) ctx.lineTo(x, 330 + k * 30 + Math.sin(x * 0.09 + k) * 9);
      ctx.stroke();
    }
    ctx.restore();
  }
  // ---- the Tide Constabulary: coral field, tarred border, the eye
  {
    const x0 = 256, w = 256, h = BANNER_H;
    ctx.save();
    swallow(ctx, x0, 0, w, h, 44);
    ctx.fillStyle = c(P.coralCanvas);
    ctx.fillRect(x0, 0, w, h);
    ctx.strokeStyle = c(P.tarPlankDark);
    ctx.lineWidth = 9;
    ctx.strokeRect(x0 + 4.5, 4.5, w - 9, h - 9);
    drawEye(ctx, x0 + w / 2, 180, 62);
    ctx.fillStyle = c(P.tarPlankDark);
    ctx.font = 'bold 30px "IM Fell English SC", "IM Fell English", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("WE SEE", x0 + w / 2, 330);
    ctx.fillText("EVERYTHING", x0 + w / 2, 366);
    ctx.restore();
  }
  // ---- the Syndicate: green field, gilt bars, a salt roundel with the monogram
  {
    const w = 256, h = SMALL_H, y0 = BANNER_H;
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
    ctx.fillStyle = c(P.salt);
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
  // ---- the Society's pennant: salt with a coral border and a brass star
  {
    const x0 = 256, w = 256, h = SMALL_H, y0 = BANNER_H;
    ctx.save();
    swallow(ctx, x0, y0, w, h, 30);
    ctx.fillStyle = c(P.salt);
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = c(P.coralCanvas);
    ctx.lineWidth = 12;
    ctx.strokeRect(x0 + 6, y0 + 6, w - 12, h - 12);
    ctx.fillStyle = c(P.brass);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 36 : 82;
      ctx.lineTo(x0 + w / 2 + Math.cos(a) * r, y0 + 130 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // ---- the signboards: salt strips, tarred lettering
  [...SALTMARKET_SIGNS, ...SALTMARKET_SEALED_SIGNS].forEach((text, i) => {
    const y = SIGN_Y + i * SIGN_H;
    ctx.fillStyle = c(P.salt);
    ctx.fillRect(0, y, ATLAS_W, SIGN_H);
    ctx.strokeStyle = c(P.indigoCanvas);
    ctx.lineWidth = 6;
    ctx.strokeRect(3, y + 3, ATLAS_W - 6, SIGN_H - 6);
    ctx.fillStyle = c(P.tarPlankDark);
    letterSign(ctx, text, 0, y, ATLAS_W, SIGN_H);
  });
}

/** The atlas as a texture, or undefined where there is no canvas (Node tests). Redrawn once the bundled fonts have loaded so it never bakes in a fallback face. */
export function createSaltmarketAtlas(): CanvasTexture | undefined {
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
/** The board the lettering is laid on (structures.ts builds it): its centre height over the ground, and its thickness (each decal sits 5 mm proud of a face). */
export const SIGN_BOARD = { w: SIGN_SIZE.w, h: SIGN_SIZE.h, d: 0.1, y: 1.85 } as const;

/**
 * The cloth and lettering geometry: position, normal, uv, wave. Banners hang from their rods (the weight grows down the cloth, so the hem ripples and the rod stays put); the signboards' lettering is a decal on
 * both faces of each board (wave 0); the boards and their posts are structures.ts's (SIGN_BOARD).
 */
export function buildSaltmarketCloth(terrain: Terrain): BufferGeometry | undefined {
  const plan = saltmarketPlan();
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
    const y = terrain.height(s.x, s.z) + SIGN_BOARD.y;
    const nx = Math.cos(s.yaw);
    const nz = Math.sin(s.yaw);
    for (const side of [1, -1]) {
      const fx = nx * side;
      const fz = nz * side;
      const rx = fz;
      const rz = -fx;
      const px = s.x + fx * (SIGN_BOARD.d / 2 + 0.005);
      const pz = s.z + fz * (SIGN_BOARD.d / 2 + 0.005);
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
  // the sealed doors' notices: a small plaque pinned across the boards of each, lettered "CLOSED FOR TIDE"
  pushPlaques(saltmarketLevel().buildings, (x, z) => terrain.height(x, z), (b) => (b.sign === undefined ? undefined : plaqueUv(SALTMARKET_SEALED_SIGNS.indexOf(b.sign as (typeof SALTMARKET_SEALED_SIGNS)[number]))), { pos, nor, uv, wave });
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
export function saltmarketClothMaterial(map: CanvasTexture | undefined): MeshToonMaterial {
  const mat = new MeshToonMaterial({ map: map ?? null, alphaTest: 0.5, side: DoubleSide, gradientMap: sharedToonRamp(), color: map ? 0xffffff : P.salt });
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
  mat.customProgramCacheKey = (): string => "saltmarket-cloth";
  return mat;
}
